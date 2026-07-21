//! Strict PSRP-over-SSH transport using PowerShell's OutOfProcess protocol.
//!
//! The adapter requires explicit host-key trust, bounds framing and replay
//! state, sends real command/cancel/close control frames, and keeps one
//! runspace usable across sequential pipelines.

use std::borrow::Cow;
use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use async_trait::async_trait;
use base64::Engine as _;
use psrp_rs::fragment::Reassembler;
use psrp_rs::message::{MessageType, PsrpMessage};
use psrp_rs::{parse_clixml, PsrpError, PsrpTransport};
use russh::keys::key::PrivateKeyWithHashAlg;
use russh::ChannelMsg;
use ssh_key::HashAlg;

const MAX_EVENT_DATA_BYTES: usize = 8 * 1024;
const MAX_OUT_OF_PROCESS_FRAME_BYTES: usize = 4 * 1024 * 1024;
const MAX_PENDING_OUT_OF_PROCESS_ACKS: usize = 1024;
const STRICT_KEX_ALGORITHMS: &[russh::kex::Name] = &[
    russh::kex::CURVE25519,
    russh::kex::EXTENSION_SUPPORT_AS_CLIENT,
    russh::kex::EXTENSION_OPENSSH_STRICT_KEX_AS_CLIENT,
];
const STRICT_HOST_KEY_ALGORITHMS: &[ssh_key::Algorithm] = &[ssh_key::Algorithm::Ed25519];

/// Authentication accepted by the strict adapter.
#[derive(Clone)]
pub enum StrictSshAuth {
    Password(String),
    PrivateKey {
        path: PathBuf,
        passphrase: Option<String>,
    },
    /// Deliberately unsupported until the application's agent broker can
    /// provide an identity without weakening host-key verification.
    Agent,
}

impl std::fmt::Debug for StrictSshAuth {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Password(_) => f.write_str("Password([REDACTED])"),
            Self::PrivateKey { path, passphrase } => f
                .debug_struct("PrivateKey")
                .field("path", path)
                .field("passphrase", &passphrase.as_ref().map(|_| "[REDACTED]"))
                .finish(),
            Self::Agent => f.write_str("Agent(unsupported)"),
        }
    }
}

/// A host key must match exactly one explicit trust source.
#[derive(Debug, Clone)]
pub enum SshHostKeyPolicy {
    PinnedSha256(String),
    KnownHosts(PathBuf),
}

#[derive(Clone)]
pub struct StrictSshPsrpConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth: StrictSshAuth,
    pub subsystem: String,
    pub host_key_policy: SshHostKeyPolicy,
    pub connect_timeout: Duration,
    pub request_timeout: Duration,
    pub event_capacity: usize,
}

impl std::fmt::Debug for StrictSshPsrpConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("StrictSshPsrpConfig")
            .field("host", &self.host)
            .field("port", &self.port)
            .field("username", &self.username)
            .field("auth", &self.auth)
            .field("subsystem", &self.subsystem)
            .field("host_key_policy", &self.host_key_policy)
            .field("connect_timeout", &self.connect_timeout)
            .field("request_timeout", &self.request_timeout)
            .field("event_capacity", &self.event_capacity)
            .finish()
    }
}

impl StrictSshPsrpConfig {
    fn validate(&self) -> Result<(), PsrpError> {
        if self.host.trim().is_empty() {
            return Err(protocol("SSH host must not be empty"));
        }
        if self.username.trim().is_empty() {
            return Err(protocol("SSH username must not be empty"));
        }
        if self.subsystem.is_empty()
            || !self
                .subsystem
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
        {
            return Err(protocol(
                "SSH subsystem must contain only ASCII letters, digits, '.', '_' or '-'",
            ));
        }
        if self.connect_timeout.is_zero() || self.request_timeout.is_zero() {
            return Err(protocol("SSH timeouts must be greater than zero"));
        }
        if self.event_capacity == 0 {
            return Err(protocol("PSRP event capacity must be greater than zero"));
        }
        if matches!(self.auth, StrictSshAuth::Agent) {
            return Err(protocol(
                "SSH agent authentication is not supported by the strict PSRP adapter",
            ));
        }
        match &self.host_key_policy {
            SshHostKeyPolicy::PinnedSha256(fingerprint)
                if normalize_sha256_fingerprint(fingerprint).is_none() =>
            {
                Err(protocol(
                    "pinned SSH host key must be a non-empty SHA256 fingerprint",
                ))
            }
            SshHostKeyPolicy::KnownHosts(path) if path.as_os_str().is_empty() => {
                Err(protocol("known_hosts path must not be empty"))
            }
            _ => Ok(()),
        }
    }
}

/// Limitations intentionally exposed instead of silently emulated.
pub const STRICT_SSH_PSRP_LIMITATIONS: &[&str] = &[
    "SSH agent authentication is not yet supported",
    "CLIXML object-reference round trips are not guaranteed by psrp-rs 1.0.0",
    "SSH runspace disconnect/reconnect is not supported",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PsrpEventKind {
    Output,
    Error,
    Warning,
    Verbose,
    Debug,
    Information,
    Progress,
    PipelineState,
    Other(u32),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PsrpEvent {
    pub sequence: u64,
    pub pipeline_id: uuid::Uuid,
    pub kind: PsrpEventKind,
    pub data: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PsrpEventReplay {
    pub oldest_sequence: u64,
    pub next_sequence: u64,
    pub truncated: bool,
    pub events: Vec<PsrpEvent>,
}

#[derive(Clone)]
pub struct PsrpEventLog {
    inner: Arc<Mutex<EventState>>,
}

impl std::fmt::Debug for PsrpEventLog {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let state = lock_or_recover(&self.inner);
        f.debug_struct("PsrpEventLog")
            .field("capacity", &state.capacity)
            .field("len", &state.events.len())
            .field("next_sequence", &state.next_sequence)
            .finish()
    }
}

impl PsrpEventLog {
    fn new(capacity: usize) -> Self {
        Self {
            inner: Arc::new(Mutex::new(EventState {
                reassembler: Reassembler::new(),
                events: VecDeque::with_capacity(capacity),
                capacity,
                next_sequence: 0,
            })),
        }
    }

    pub fn replay_after(&self, after_sequence: Option<u64>) -> PsrpEventReplay {
        let state = lock_or_recover(&self.inner);
        let oldest_sequence = state
            .events
            .front()
            .map_or(state.next_sequence, |event| event.sequence);
        let requested = after_sequence
            .map(|sequence| sequence.saturating_add(1))
            .unwrap_or(oldest_sequence);
        PsrpEventReplay {
            oldest_sequence,
            next_sequence: state.next_sequence,
            truncated: requested < oldest_sequence,
            events: state
                .events
                .iter()
                .filter(|event| after_sequence.is_none_or(|after| event.sequence > after))
                .cloned()
                .collect(),
        }
    }

    fn observe(&self, bytes: &[u8]) -> Result<Vec<uuid::Uuid>, PsrpError> {
        lock_or_recover(&self.inner).observe(bytes)
    }
}

#[derive(Debug)]
struct EventState {
    reassembler: Reassembler,
    events: VecDeque<PsrpEvent>,
    capacity: usize,
    next_sequence: u64,
}

impl EventState {
    fn observe(&mut self, bytes: &[u8]) -> Result<Vec<uuid::Uuid>, PsrpError> {
        let mut terminal_pipelines = Vec::new();
        for raw_message in self.reassembler.feed(bytes)? {
            let message = PsrpMessage::decode(&raw_message)?;
            let kind = match message.message_type {
                MessageType::PipelineOutput => PsrpEventKind::Output,
                MessageType::ErrorRecord => PsrpEventKind::Error,
                MessageType::WarningRecord => PsrpEventKind::Warning,
                MessageType::VerboseRecord => PsrpEventKind::Verbose,
                MessageType::DebugRecord => PsrpEventKind::Debug,
                MessageType::InformationRecord => PsrpEventKind::Information,
                MessageType::ProgressRecord => PsrpEventKind::Progress,
                MessageType::PipelineState => PsrpEventKind::PipelineState,
                other => PsrpEventKind::Other(other.to_u32()),
            };
            let event = PsrpEvent {
                sequence: self.next_sequence,
                pipeline_id: message.pid,
                kind,
                data: truncate_utf8(&message.data, MAX_EVENT_DATA_BYTES),
            };
            self.next_sequence = self.next_sequence.saturating_add(1);
            if self.events.len() == self.capacity {
                self.events.pop_front();
            }
            self.events.push_back(event);

            if message.message_type == MessageType::PipelineState
                && message.pid != uuid::Uuid::nil()
                && parse_clixml(&message.data)?.iter().any(|value| {
                    value
                        .properties()
                        .and_then(|properties| properties.get("PipelineState"))
                        .and_then(psrp_rs::PsValue::as_i32)
                        .is_some_and(|state| matches!(state, 3..=6))
                })
            {
                terminal_pipelines.push(message.pid);
            }
        }
        Ok(terminal_pipelines)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OutOfProcessFrameKind {
    Data,
    DataAck,
    CommandAck,
    SignalAck,
    CloseAck,
    Close,
    Signal,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum PendingAckKind {
    Data,
    Command,
    Signal,
    Close,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
struct PendingAckKey {
    kind: PendingAckKind,
    ps_guid: uuid::Uuid,
}

fn register_pending_ack_in(
    pending: &mut HashMap<PendingAckKey, usize>,
    kind: PendingAckKind,
    pipeline_id: uuid::Uuid,
    allow_multiple: bool,
) -> Result<(), PsrpError> {
    let pending_count: usize = pending.values().sum();
    if pending_count >= MAX_PENDING_OUT_OF_PROCESS_ACKS {
        return Err(protocol(format!(
            "PowerShell OutOfProcess outstanding acknowledgement limit ({MAX_PENDING_OUT_OF_PROCESS_ACKS}) reached"
        )));
    }
    let key = PendingAckKey {
        kind,
        ps_guid: pipeline_id,
    };
    let count = pending.entry(key).or_default();
    if !allow_multiple && *count != 0 {
        return Err(protocol(format!(
            "an OutOfProcess {kind:?} acknowledgement is already pending for {pipeline_id}"
        )));
    }
    *count += 1;
    Ok(())
}

fn consume_pending_ack_in(
    pending: &mut HashMap<PendingAckKey, usize>,
    kind: PendingAckKind,
    pipeline_id: uuid::Uuid,
) -> Result<(), PsrpError> {
    let key = PendingAckKey {
        kind,
        ps_guid: pipeline_id,
    };
    let count = pending.get_mut(&key).ok_or_else(|| {
        protocol(format!(
            "received unsolicited OutOfProcess {kind:?} acknowledgement for {pipeline_id}"
        ))
    })?;
    *count -= 1;
    if *count == 0 {
        pending.remove(&key);
    }
    Ok(())
}

#[derive(Debug)]
struct OutOfProcessFrame {
    kind: OutOfProcessFrameKind,
    ps_guid: uuid::Uuid,
    data: Option<Vec<u8>>,
}

#[derive(Debug, Default)]
struct OutOfProcessDecoder {
    buffer: Vec<u8>,
}

impl OutOfProcessDecoder {
    fn feed(&mut self, bytes: &[u8]) -> Result<Vec<OutOfProcessFrame>, PsrpError> {
        if self.buffer.len().saturating_add(bytes.len()) > MAX_OUT_OF_PROCESS_FRAME_BYTES {
            return Err(protocol(format!(
                "PowerShell OutOfProcess frame exceeded {MAX_OUT_OF_PROCESS_FRAME_BYTES} bytes"
            )));
        }
        self.buffer.extend_from_slice(bytes);
        let mut frames = Vec::new();

        loop {
            let leading_whitespace = self
                .buffer
                .iter()
                .position(|byte| !byte.is_ascii_whitespace())
                .unwrap_or(self.buffer.len());
            if leading_whitespace > 0 {
                self.buffer.drain(..leading_whitespace);
            }
            if self.buffer.is_empty() {
                break;
            }
            if self.buffer.first() != Some(&b'<') {
                return Err(protocol(
                    "PowerShell OutOfProcess channel emitted non-XML data",
                ));
            }

            let end = if self.buffer.starts_with(b"<Data ") || self.buffer.starts_with(b"<Data>") {
                find_subslice(&self.buffer, b"</Data>").map(|index| index + b"</Data>".len())
            } else {
                find_subslice(&self.buffer, b"/>").map(|index| index + 2)
            };
            let Some(end) = end else {
                break;
            };
            let raw: Vec<u8> = self.buffer.drain(..end).collect();
            let xml = std::str::from_utf8(&raw)
                .map_err(|error| protocol(format!("OutOfProcess XML is not UTF-8: {error}")))?;
            frames.push(parse_out_of_process_frame(xml)?);
        }

        Ok(frames)
    }
}

fn parse_out_of_process_frame(xml: &str) -> Result<OutOfProcessFrame, PsrpError> {
    let tag_end = xml
        .find(|character: char| character.is_ascii_whitespace() || matches!(character, '>' | '/'))
        .ok_or_else(|| protocol("OutOfProcess XML has no tag name terminator"))?;
    let tag = xml
        .get(1..tag_end)
        .ok_or_else(|| protocol("OutOfProcess XML has an invalid tag"))?;
    let kind = match tag {
        "Data" => OutOfProcessFrameKind::Data,
        "DataAck" => OutOfProcessFrameKind::DataAck,
        "CommandAck" => OutOfProcessFrameKind::CommandAck,
        "SignalAck" => OutOfProcessFrameKind::SignalAck,
        "CloseAck" => OutOfProcessFrameKind::CloseAck,
        "Close" => OutOfProcessFrameKind::Close,
        "Signal" => OutOfProcessFrameKind::Signal,
        other => {
            return Err(protocol(format!(
                "unsupported PowerShell OutOfProcess frame '{other}'"
            )));
        }
    };
    let guid_text = xml_attribute(xml, "PSGuid")
        .ok_or_else(|| protocol(format!("OutOfProcess {tag} frame is missing PSGuid")))?;
    let ps_guid = uuid::Uuid::parse_str(guid_text).map_err(|error| {
        protocol(format!(
            "OutOfProcess {tag} frame has invalid PSGuid: {error}"
        ))
    })?;

    let data = if kind == OutOfProcessFrameKind::Data {
        let stream = xml_attribute(xml, "Stream")
            .ok_or_else(|| protocol("OutOfProcess Data frame is missing Stream"))?;
        if stream != "Default" {
            return Err(protocol(format!(
                "unsupported OutOfProcess stream '{stream}'"
            )));
        }
        let body_start = xml
            .find('>')
            .map(|index| index + 1)
            .ok_or_else(|| protocol("OutOfProcess Data frame is malformed"))?;
        let body_end = xml
            .rfind("</Data>")
            .ok_or_else(|| protocol("OutOfProcess Data frame has no closing tag"))?;
        let encoded = xml
            .get(body_start..body_end)
            .ok_or_else(|| protocol("OutOfProcess Data frame body is malformed"))?
            .trim();
        Some(
            base64::engine::general_purpose::STANDARD
                .decode(encoded)
                .map_err(|error| {
                    protocol(format!("OutOfProcess Data base64 is invalid: {error}"))
                })?,
        )
    } else {
        None
    };

    Ok(OutOfProcessFrame {
        kind,
        ps_guid,
        data,
    })
}

fn xml_attribute<'a>(xml: &'a str, name: &str) -> Option<&'a str> {
    for quote in ['\'', '"'] {
        let prefix = format!("{name}={quote}");
        if let Some(start) = xml.find(&prefix).map(|index| index + prefix.len()) {
            if let Some(rest) = xml.get(start..) {
                if let Some(end) = rest.find(quote) {
                    return rest.get(..end);
                }
            }
        }
    }
    None
}

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

fn data_frame(ps_guid: uuid::Uuid, bytes: &[u8]) -> Result<String, PsrpError> {
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    let frame = format!("<Data Stream='Default' PSGuid='{ps_guid}'>{encoded}</Data>\n");
    if frame.len() > MAX_OUT_OF_PROCESS_FRAME_BYTES {
        return Err(protocol(format!(
            "outgoing PowerShell OutOfProcess frame exceeded {MAX_OUT_OF_PROCESS_FRAME_BYTES} bytes"
        )));
    }
    Ok(frame)
}

fn control_frame(kind: &str, ps_guid: uuid::Uuid) -> String {
    format!("<{kind} PSGuid='{ps_guid}' />\n")
}

fn fragment_pipeline_id(bytes: &[u8]) -> Result<uuid::Uuid, PsrpError> {
    let messages = decode_fragment_messages(bytes)?;
    let mut pipeline_id = None;
    for message in messages {
        let current = message.pid;
        if pipeline_id.is_some_and(|existing| existing != current) {
            return Err(protocol(
                "one OutOfProcess Data frame cannot contain multiple pipeline IDs",
            ));
        }
        pipeline_id = Some(current);
    }
    pipeline_id.ok_or_else(|| protocol("outgoing PSRP fragments did not contain a full message"))
}

fn decode_fragment_messages(bytes: &[u8]) -> Result<Vec<PsrpMessage>, PsrpError> {
    let mut reassembler = Reassembler::new();
    let messages = reassembler.feed(bytes)?;
    messages
        .into_iter()
        .map(|message| PsrpMessage::decode(&message))
        .collect()
}

#[derive(Clone)]
struct StrictClientHandler {
    host: String,
    port: u16,
    policy: SshHostKeyPolicy,
    rejection: Arc<Mutex<Option<String>>>,
}

impl russh::client::Handler for StrictClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &ssh_key::PublicKey,
    ) -> std::result::Result<bool, Self::Error> {
        let observed = server_public_key.fingerprint(HashAlg::Sha256).to_string();
        let accepted = match &self.policy {
            SshHostKeyPolicy::PinnedSha256(expected) => {
                normalize_sha256_fingerprint(expected).is_some_and(|value| value == observed)
            }
            SshHostKeyPolicy::KnownHosts(path) => {
                match russh::keys::check_known_hosts_path(
                    &self.host,
                    self.port,
                    server_public_key,
                    path,
                ) {
                    Ok(accepted) => accepted,
                    Err(error) => {
                        *lock_or_recover(&self.rejection) = Some(format!(
                            "SSH host key verification failed for {}:{}: {error}",
                            self.host, self.port
                        ));
                        return Err(error.into());
                    }
                }
            }
        };

        if !accepted {
            *lock_or_recover(&self.rejection) = Some(format!(
                "SSH host key rejected for {}:{} (observed {observed})",
                self.host, self.port
            ));
        }
        Ok(accepted)
    }
}

/// Strict PSRP transport over a verified SSH subsystem channel.
pub struct StrictSshPsrpTransport {
    channel: Option<russh::Channel<russh::client::Msg>>,
    handle: Option<russh::client::Handle<StrictClientHandler>>,
    pending_ssh_chunks: VecDeque<Vec<u8>>,
    pending_psrp_chunks: VecDeque<Vec<u8>>,
    opening_fragments: Arc<Mutex<Option<Vec<u8>>>>,
    decoder: OutOfProcessDecoder,
    active_pipeline: Arc<Mutex<Option<uuid::Uuid>>>,
    pending_acks: Arc<Mutex<HashMap<PendingAckKey, usize>>>,
    request_timeout: Duration,
    event_log: PsrpEventLog,
    closed: bool,
}

impl std::fmt::Debug for StrictSshPsrpTransport {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("StrictSshPsrpTransport")
            .field("pending_ssh_chunks", &self.pending_ssh_chunks.len())
            .field("pending_psrp_chunks", &self.pending_psrp_chunks.len())
            .field("event_log", &self.event_log)
            .field("closed", &self.closed)
            .finish()
    }
}

impl StrictSshPsrpTransport {
    pub async fn connect(config: StrictSshPsrpConfig) -> Result<Self, PsrpError> {
        config.validate()?;
        let rejection = Arc::new(Mutex::new(None));
        let handler = StrictClientHandler {
            host: config.host.clone(),
            port: config.port,
            policy: config.host_key_policy.clone(),
            rejection: Arc::clone(&rejection),
        };
        let ssh_config = russh::client::Config {
            preferred: strict_preferred_algorithms(),
            keepalive_interval: Some(Duration::from_secs(10)),
            keepalive_max: 3,
            ..Default::default()
        };

        let mut handle = tokio::time::timeout(
            config.connect_timeout,
            russh::client::connect(
                Arc::new(ssh_config),
                (config.host.as_str(), config.port),
                handler,
            ),
        )
        .await
        .map_err(|_| {
            protocol(format!(
                "SSH connect timed out for {}:{}",
                config.host, config.port
            ))
        })?
        .map_err(|error| {
            let rejection = lock_or_recover(&rejection).take();
            protocol(rejection.unwrap_or_else(|| {
                format!(
                    "SSH connection to {}:{} failed: {error}",
                    config.host, config.port
                )
            }))
        })?;

        let authenticated = tokio::time::timeout(config.request_timeout, async {
            match &config.auth {
                StrictSshAuth::Password(password) => handle
                    .authenticate_password(&config.username, password)
                    .await
                    .map_err(|error| {
                        protocol(format!("SSH password authentication failed: {error}"))
                    }),
                StrictSshAuth::PrivateKey { path, passphrase } => {
                    let private_key = russh::keys::load_secret_key(path, passphrase.as_deref())
                        .map_err(|error| {
                            protocol(format!("SSH private key load failed: {error}"))
                        })?;
                    let key = PrivateKeyWithHashAlg::new(Arc::new(private_key), None);
                    handle
                        .authenticate_publickey(&config.username, key)
                        .await
                        .map_err(|error| {
                            protocol(format!("SSH public key authentication failed: {error}"))
                        })
                }
                StrictSshAuth::Agent => unreachable!("validated before connecting"),
            }
        })
        .await
        .map_err(|_| protocol("SSH authentication timed out"))??;

        if !authenticated.success() {
            return Err(protocol("SSH authentication was rejected"));
        }

        let mut channel =
            tokio::time::timeout(config.request_timeout, handle.channel_open_session())
                .await
                .map_err(|_| protocol("SSH session channel open timed out"))?
                .map_err(|error| protocol(format!("SSH session channel open failed: {error}")))?;

        channel
            .request_subsystem(true, config.subsystem.clone())
            .await
            .map_err(|error| protocol(format!("SSH subsystem request failed: {error}")))?;

        let mut pending_ssh_chunks = VecDeque::new();
        tokio::time::timeout(config.request_timeout, async {
            loop {
                match channel.wait().await {
                    Some(ChannelMsg::Success) => return Ok(()),
                    Some(ChannelMsg::Failure) => {
                        return Err(protocol(format!(
                            "SSH server rejected subsystem '{}'",
                            config.subsystem
                        )));
                    }
                    Some(ChannelMsg::Data { data }) if !data.is_empty() => {
                        pending_ssh_chunks.push_back(data.to_vec());
                    }
                    Some(ChannelMsg::ExtendedData { data, .. }) => {
                        return Err(protocol(format!(
                            "SSH subsystem '{}' wrote stderr before startup: {}",
                            config.subsystem,
                            sanitized_channel_text(&data)
                        )));
                    }
                    Some(ChannelMsg::Eof | ChannelMsg::Close) | None => {
                        return Err(protocol(format!(
                            "SSH subsystem '{}' closed before confirming startup",
                            config.subsystem
                        )));
                    }
                    Some(ChannelMsg::ExitStatus { exit_status }) => {
                        return Err(protocol(format!(
                            "SSH subsystem '{}' exited during startup with status {exit_status}",
                            config.subsystem
                        )));
                    }
                    Some(ChannelMsg::ExitSignal { signal_name, .. }) => {
                        return Err(protocol(format!(
                            "SSH subsystem '{}' exited during startup on signal {signal_name:?}",
                            config.subsystem
                        )));
                    }
                    Some(_) => {}
                }
            }
        })
        .await
        .map_err(|_| {
            protocol(format!(
                "SSH subsystem '{}' confirmation timed out",
                config.subsystem
            ))
        })??;

        Ok(Self {
            channel: Some(channel),
            handle: Some(handle),
            pending_ssh_chunks,
            pending_psrp_chunks: VecDeque::new(),
            opening_fragments: Arc::new(Mutex::new(None)),
            decoder: OutOfProcessDecoder::default(),
            active_pipeline: Arc::new(Mutex::new(None)),
            pending_acks: Arc::new(Mutex::new(HashMap::new())),
            request_timeout: config.request_timeout,
            event_log: PsrpEventLog::new(config.event_capacity),
            closed: false,
        })
    }

    pub fn event_log(&self) -> PsrpEventLog {
        self.event_log.clone()
    }

    fn channel(&self) -> Result<&russh::Channel<russh::client::Msg>, PsrpError> {
        self.channel
            .as_ref()
            .ok_or_else(|| protocol("SSH PSRP transport is closed"))
    }

    async fn send_out_of_process_frame(&self, frame: String) -> Result<(), PsrpError> {
        if frame.len() > MAX_OUT_OF_PROCESS_FRAME_BYTES {
            return Err(protocol(format!(
                "outgoing PowerShell OutOfProcess frame exceeded {MAX_OUT_OF_PROCESS_FRAME_BYTES} bytes"
            )));
        }
        self.channel()?
            .data(frame.as_bytes())
            .await
            .map_err(|error| protocol(format!("SSH OutOfProcess send failed: {error}")))
    }

    async fn send_data_frame(
        &self,
        pipeline_id: uuid::Uuid,
        bytes: &[u8],
    ) -> Result<(), PsrpError> {
        let frame = data_frame(pipeline_id, bytes)?;
        self.register_pending_ack(PendingAckKind::Data, pipeline_id, true)?;
        if let Err(error) = self.send_out_of_process_frame(frame).await {
            self.consume_pending_ack(PendingAckKind::Data, pipeline_id)?;
            return Err(error);
        }
        Ok(())
    }

    async fn send_close_frame(&self, pipeline_id: uuid::Uuid) -> Result<(), PsrpError> {
        self.register_pending_ack(PendingAckKind::Close, pipeline_id, false)?;
        if let Err(error) = self
            .send_out_of_process_frame(control_frame("Close", pipeline_id))
            .await
        {
            self.consume_pending_ack(PendingAckKind::Close, pipeline_id)?;
            return Err(error);
        }
        Ok(())
    }

    fn register_pending_ack(
        &self,
        kind: PendingAckKind,
        pipeline_id: uuid::Uuid,
        allow_multiple: bool,
    ) -> Result<(), PsrpError> {
        let mut pending = lock_or_recover(&self.pending_acks);
        register_pending_ack_in(&mut pending, kind, pipeline_id, allow_multiple)
    }

    fn consume_pending_ack(
        &self,
        kind: PendingAckKind,
        pipeline_id: uuid::Uuid,
    ) -> Result<(), PsrpError> {
        let mut pending = lock_or_recover(&self.pending_acks);
        consume_pending_ack_in(&mut pending, kind, pipeline_id)
    }

    fn consume_control_ack(&self, frame: &OutOfProcessFrame) -> Result<(), PsrpError> {
        let kind = match frame.kind {
            OutOfProcessFrameKind::DataAck => PendingAckKind::Data,
            OutOfProcessFrameKind::CommandAck => PendingAckKind::Command,
            OutOfProcessFrameKind::SignalAck => PendingAckKind::Signal,
            OutOfProcessFrameKind::CloseAck => PendingAckKind::Close,
            _ => return Err(protocol("frame is not an acknowledgement")),
        };
        self.consume_pending_ack(kind, frame.ps_guid)
    }

    async fn next_out_of_process_frames(&mut self) -> Result<Vec<OutOfProcessFrame>, PsrpError> {
        loop {
            let bytes = if let Some(bytes) = self.pending_ssh_chunks.pop_front() {
                bytes
            } else {
                let channel = self
                    .channel
                    .as_mut()
                    .ok_or_else(|| protocol("SSH PSRP transport is closed"))?;
                loop {
                    match channel.wait().await {
                        Some(ChannelMsg::Data { data }) if !data.is_empty() => {
                            break data.to_vec();
                        }
                        Some(ChannelMsg::ExtendedData { data, ext }) => {
                            return Err(protocol(format!(
                                "SSH PSRP subsystem wrote extended stream {ext}: {}",
                                sanitized_channel_text(&data)
                            )));
                        }
                        Some(ChannelMsg::Eof | ChannelMsg::Close) | None => {
                            return Err(protocol("SSH PSRP subsystem closed unexpectedly"));
                        }
                        Some(ChannelMsg::Failure) => {
                            return Err(protocol("SSH PSRP channel request failed"));
                        }
                        Some(ChannelMsg::ExitStatus { exit_status }) => {
                            return Err(protocol(format!(
                                "SSH PSRP subsystem exited with status {exit_status}"
                            )));
                        }
                        Some(ChannelMsg::ExitSignal { signal_name, .. }) => {
                            return Err(protocol(format!(
                                "SSH PSRP subsystem exited on signal {signal_name:?}"
                            )));
                        }
                        Some(_) => {}
                    }
                }
            };

            let frames = self.decoder.feed(&bytes)?;
            if !frames.is_empty() {
                return Ok(frames);
            }
        }
    }

    fn ingest_data_frame(
        &mut self,
        frame: OutOfProcessFrame,
    ) -> Result<Vec<uuid::Uuid>, PsrpError> {
        let bytes = frame
            .data
            .ok_or_else(|| protocol("OutOfProcess Data frame had no payload"))?;
        if bytes.is_empty() {
            return Err(protocol(
                "OutOfProcess Data frame decoded to an empty payload",
            ));
        }
        let message_pipeline = fragment_pipeline_id(&bytes)?;
        if message_pipeline != frame.ps_guid {
            return Err(protocol(format!(
                "OutOfProcess PSGuid {} did not match PSRP pipeline ID {message_pipeline}",
                frame.ps_guid
            )));
        }
        let terminal_pipelines = self.event_log.observe(&bytes)?;
        self.pending_psrp_chunks.push_back(bytes);
        Ok(terminal_pipelines)
    }

    async fn send_pipeline_closes(&self, pipeline_ids: Vec<uuid::Uuid>) -> Result<(), PsrpError> {
        for pipeline_id in pipeline_ids {
            if *lock_or_recover(&self.active_pipeline) == Some(pipeline_id) {
                *lock_or_recover(&self.active_pipeline) = None;
            }
            self.send_close_frame(pipeline_id).await?;
        }
        Ok(())
    }

    async fn wait_for_ack(
        &mut self,
        expected: OutOfProcessFrameKind,
        expected_guid: uuid::Uuid,
    ) -> Result<(), PsrpError> {
        tokio::time::timeout(self.request_timeout, async {
            loop {
                let mut matched = false;
                let mut pipelines_to_close = Vec::new();
                for frame in self.next_out_of_process_frames().await? {
                    if frame.kind == expected {
                        let is_expected = frame.ps_guid == expected_guid;
                        self.consume_control_ack(&frame)?;
                        matched |= is_expected;
                    } else {
                        match frame.kind {
                            OutOfProcessFrameKind::Data => {
                                pipelines_to_close.extend(self.ingest_data_frame(frame)?);
                            }
                            OutOfProcessFrameKind::DataAck
                            | OutOfProcessFrameKind::CommandAck
                            | OutOfProcessFrameKind::SignalAck
                            | OutOfProcessFrameKind::CloseAck => {
                                self.consume_control_ack(&frame)?;
                            }
                            OutOfProcessFrameKind::Close | OutOfProcessFrameKind::Signal => {
                                return Err(protocol(format!(
                                    "server sent unexpected OutOfProcess {:?} for {}",
                                    frame.kind, frame.ps_guid
                                )));
                            }
                        }
                    }
                }
                self.send_pipeline_closes(pipelines_to_close).await?;
                if matched {
                    return Ok(());
                }
            }
        })
        .await
        .map_err(|_| {
            protocol(format!(
                "timed out waiting for OutOfProcess {expected:?} for {expected_guid}"
            ))
        })?
    }
}

#[async_trait]
impl PsrpTransport for StrictSshPsrpTransport {
    async fn send_fragment(&self, bytes: &[u8]) -> Result<(), PsrpError> {
        let messages = decode_fragment_messages(bytes)?;
        if messages.len() == 1
            && messages[0].message_type == MessageType::SessionCapability
            && messages[0].pid == uuid::Uuid::nil()
        {
            let mut opening = lock_or_recover(&self.opening_fragments);
            if opening.is_some() {
                return Err(protocol(
                    "duplicate SessionCapability while batching OutOfProcess runspace creation",
                ));
            }
            *opening = Some(bytes.to_vec());
            return Ok(());
        }
        if messages.len() == 1
            && messages[0].message_type == MessageType::InitRunspacePool
            && messages[0].pid == uuid::Uuid::nil()
        {
            let mut combined = lock_or_recover(&self.opening_fragments)
                .take()
                .ok_or_else(|| {
                    protocol(
                        "InitRunspacePool arrived before SessionCapability in OutOfProcess transport",
                    )
                })?;
            combined.extend_from_slice(bytes);
            return self.send_data_frame(uuid::Uuid::nil(), &combined).await;
        }
        if lock_or_recover(&self.opening_fragments).is_some() {
            return Err(protocol(
                "unexpected PSRP message while OutOfProcess runspace creation is incomplete",
            ));
        }
        let pipeline_id = fragment_pipeline_id(bytes)?;
        self.send_data_frame(pipeline_id, bytes).await
    }

    async fn recv_chunk(&mut self) -> Result<Vec<u8>, PsrpError> {
        if let Some(bytes) = self.pending_psrp_chunks.pop_front() {
            return Ok(bytes);
        }
        loop {
            let mut pipelines_to_close = Vec::new();
            for frame in self.next_out_of_process_frames().await? {
                match frame.kind {
                    OutOfProcessFrameKind::Data => {
                        pipelines_to_close.extend(self.ingest_data_frame(frame)?);
                    }
                    OutOfProcessFrameKind::DataAck
                    | OutOfProcessFrameKind::SignalAck
                    | OutOfProcessFrameKind::CloseAck
                    | OutOfProcessFrameKind::CommandAck => {
                        self.consume_control_ack(&frame)?;
                    }
                    OutOfProcessFrameKind::Close | OutOfProcessFrameKind::Signal => {
                        return Err(protocol(format!(
                            "server sent unexpected OutOfProcess {:?} for {}",
                            frame.kind, frame.ps_guid
                        )));
                    }
                }
            }
            self.send_pipeline_closes(pipelines_to_close).await?;
            if let Some(bytes) = self.pending_psrp_chunks.pop_front() {
                return Ok(bytes);
            }
        }
    }

    async fn execute_pipeline(
        &mut self,
        fragment_bytes: &[u8],
        pipeline_id: uuid::Uuid,
    ) -> Result<(), PsrpError> {
        if fragment_pipeline_id(fragment_bytes)? != pipeline_id {
            return Err(protocol(
                "execute_pipeline ID did not match the encoded CreatePipeline message",
            ));
        }
        self.register_pending_ack(PendingAckKind::Command, pipeline_id, false)?;
        if let Err(error) = self
            .send_out_of_process_frame(control_frame("Command", pipeline_id))
            .await
        {
            self.consume_pending_ack(PendingAckKind::Command, pipeline_id)?;
            return Err(error);
        }
        self.wait_for_ack(OutOfProcessFrameKind::CommandAck, pipeline_id)
            .await?;
        *lock_or_recover(&self.active_pipeline) = Some(pipeline_id);
        self.send_data_frame(pipeline_id, fragment_bytes).await
    }

    async fn signal_stop(&self) -> Result<(), PsrpError> {
        let pipeline_id = (*lock_or_recover(&self.active_pipeline))
            .ok_or_else(|| protocol("cannot stop PSRP because no pipeline is active"))?;
        self.register_pending_ack(PendingAckKind::Signal, pipeline_id, false)?;
        if let Err(error) = self
            .send_out_of_process_frame(control_frame("Signal", pipeline_id))
            .await
        {
            self.consume_pending_ack(PendingAckKind::Signal, pipeline_id)?;
            return Err(error);
        }
        Ok(())
    }

    async fn close_shell(&mut self) -> Result<(), PsrpError> {
        if self.closed {
            return Ok(());
        }
        self.closed = true;
        let mut first_error = self.send_close_frame(uuid::Uuid::nil()).await.err();
        if first_error.is_none() {
            if let Err(error) = self
                .wait_for_ack(OutOfProcessFrameKind::CloseAck, uuid::Uuid::nil())
                .await
            {
                first_error = Some(error);
            }
        }
        if let Some(channel) = self.channel.take() {
            if let Err(error) = channel.eof().await {
                if first_error.is_none() {
                    first_error = Some(protocol(format!("SSH PSRP EOF failed: {error}")));
                }
            }
            if let Err(error) = channel.close().await {
                if first_error.is_none() {
                    first_error = Some(protocol(format!("SSH PSRP channel close failed: {error}")));
                }
            }
        }
        if let Some(handle) = self.handle.take() {
            if let Err(error) = handle
                .disconnect(
                    russh::Disconnect::ByApplication,
                    "PSRP runspace closed",
                    "en",
                )
                .await
            {
                if first_error.is_none() {
                    first_error = Some(protocol(format!("SSH disconnect failed: {error}")));
                }
            }
        }
        first_error.map_or(Ok(()), Err)
    }
}

fn protocol(message: impl Into<String>) -> PsrpError {
    PsrpError::Protocol(message.into())
}

fn strict_preferred_algorithms() -> russh::Preferred {
    russh::Preferred {
        kex: Cow::Borrowed(STRICT_KEX_ALGORITHMS),
        key: Cow::Borrowed(STRICT_HOST_KEY_ALGORITHMS),
        ..russh::Preferred::default()
    }
}

fn normalize_sha256_fingerprint(value: &str) -> Option<String> {
    let value = value.trim();
    let digest = value.strip_prefix("SHA256:")?;
    if digest.is_empty()
        || !digest.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'/' | b'=' | b'_' | b'-')
        })
    {
        return None;
    }
    Some(format!("SHA256:{digest}"))
}

fn sanitized_channel_text(bytes: &[u8]) -> String {
    let text = String::from_utf8_lossy(bytes);
    truncate_utf8(text.trim(), 1024).replace(['\r', '\n'], " ")
}

fn truncate_utf8(value: &str, max_bytes: usize) -> String {
    if value.len() <= max_bytes {
        return value.to_owned();
    }
    let mut end = max_bytes;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}...", &value[..end])
}

fn lock_or_recover<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

#[cfg(test)]
mod tests {
    use super::*;
    use psrp_rs::fragment::encode_message;
    use psrp_rs::message::Destination;

    fn config() -> StrictSshPsrpConfig {
        StrictSshPsrpConfig {
            host: "localhost".into(),
            port: 22,
            username: "tester".into(),
            auth: StrictSshAuth::Password("secret".into()),
            subsystem: "powershell".into(),
            host_key_policy: SshHostKeyPolicy::PinnedSha256("SHA256:abc".into()),
            connect_timeout: Duration::from_secs(1),
            request_timeout: Duration::from_secs(1),
            event_capacity: 2,
        }
    }

    #[test]
    fn rejects_unsafe_configuration_and_redacts_credentials() {
        let mut candidate = config();
        candidate.auth = StrictSshAuth::Agent;
        assert!(candidate
            .validate()
            .unwrap_err()
            .to_string()
            .contains("agent"));
        candidate.auth = StrictSshAuth::Password("do-not-leak".into());
        candidate.subsystem = "powershell;whoami".into();
        assert!(candidate.validate().is_err());
        let rendered = format!("{candidate:?}");
        assert!(!rendered.contains("do-not-leak"));
        assert!(rendered.contains("[REDACTED]"));
    }

    #[test]
    fn event_replay_is_bounded_monotonic_and_reports_truncation() {
        let log = PsrpEventLog::new(2);
        for (object_id, kind) in [
            (1, MessageType::PipelineOutput),
            (2, MessageType::WarningRecord),
            (3, MessageType::PipelineState),
            (4, MessageType::InformationRecord),
        ] {
            let message = PsrpMessage {
                destination: Destination::Client,
                message_type: kind,
                rpid: uuid::Uuid::nil(),
                pid: uuid::Uuid::new_v4(),
                data: format!("event-{object_id}"),
            };
            log.observe(&encode_message(object_id, &message.encode()))
                .unwrap();
        }

        let replay = log.replay_after(Some(0));
        assert!(replay.truncated);
        assert_eq!(replay.oldest_sequence, 2);
        assert_eq!(replay.next_sequence, 4);
        assert_eq!(
            replay
                .events
                .iter()
                .map(|event| event.sequence)
                .collect::<Vec<_>>(),
            vec![2, 3]
        );
        assert_eq!(replay.events[0].kind, PsrpEventKind::PipelineState);
        assert_eq!(replay.events[1].kind, PsrpEventKind::Information);
    }

    #[test]
    fn fingerprint_parser_is_strict() {
        assert_eq!(
            normalize_sha256_fingerprint(" SHA256:abc+/= "),
            Some("SHA256:abc+/=".into())
        );
        assert!(normalize_sha256_fingerprint("MD5:abc").is_none());
        assert!(normalize_sha256_fingerprint("SHA256:").is_none());
        assert!(normalize_sha256_fingerprint("SHA256:abc def").is_none());
    }

    #[test]
    fn ssh_negotiation_has_no_kex_or_host_key_fallback() {
        let preferred = strict_preferred_algorithms();
        assert_eq!(preferred.key.as_ref(), [ssh_key::Algorithm::Ed25519]);
        assert_eq!(preferred.kex[0], russh::kex::CURVE25519);
        assert!(!preferred.kex.contains(&russh::kex::CURVE25519_PRE_RFC_8731));
        assert!(!preferred.kex.contains(&russh::kex::DH_G14_SHA256));
        assert!(!preferred.cipher.contains(&russh::cipher::NONE));
        assert!(!preferred.cipher.contains(&russh::cipher::AES_128_CBC));
        assert!(!preferred.mac.contains(&russh::mac::NONE));
        assert!(!preferred.mac.contains(&russh::mac::HMAC_SHA1));
        assert!(!preferred.mac.contains(&russh::mac::HMAC_SHA1_ETM));
    }

    #[test]
    fn out_of_process_decoder_handles_fragmented_and_concatenated_frames() {
        let pipeline_id = uuid::Uuid::from_u128(1);
        let payload = format!(
            "<Data Stream='Default' PSGuid='{pipeline_id}'>aGVsbG8=</Data><DataAck PSGuid=\"{pipeline_id}\" />"
        );
        let split = payload.find("aGVs").unwrap();
        let mut decoder = OutOfProcessDecoder::default();

        assert!(decoder
            .feed(&payload.as_bytes()[..split])
            .unwrap()
            .is_empty());
        let frames = decoder.feed(&payload.as_bytes()[split..]).unwrap();

        assert_eq!(frames.len(), 2);
        assert_eq!(frames[0].kind, OutOfProcessFrameKind::Data);
        assert_eq!(frames[0].ps_guid, pipeline_id);
        assert_eq!(frames[0].data.as_deref(), Some(b"hello".as_slice()));
        assert_eq!(frames[1].kind, OutOfProcessFrameKind::DataAck);
        assert_eq!(frames[1].ps_guid, pipeline_id);
    }

    #[test]
    fn out_of_process_decoder_fails_closed_on_invalid_frames() {
        let pipeline_id = uuid::Uuid::from_u128(2);
        for invalid in [
            "<DataAck PSGuid='not-a-guid' />".to_owned(),
            format!("<Unsupported PSGuid='{pipeline_id}' />"),
            format!("<Data Stream='Error' PSGuid='{pipeline_id}'>aGVsbG8=</Data>"),
            format!("<Data Stream='Default' PSGuid='{pipeline_id}'>not-base64!</Data>"),
        ] {
            assert!(
                OutOfProcessDecoder::default()
                    .feed(invalid.as_bytes())
                    .is_err(),
                "invalid frame was accepted: {invalid}"
            );
        }
    }

    #[test]
    fn out_of_process_decoder_enforces_its_buffer_limit() {
        let oversized = vec![b'<'; MAX_OUT_OF_PROCESS_FRAME_BYTES + 1];
        let error = OutOfProcessDecoder::default()
            .feed(&oversized)
            .unwrap_err()
            .to_string();
        assert!(error.contains("exceeded"));
    }

    #[test]
    fn acknowledgement_registry_rejects_duplicate_unsolicited_and_overflow() {
        let pipeline_id = uuid::Uuid::from_u128(3);
        let mut pending = HashMap::new();

        register_pending_ack_in(&mut pending, PendingAckKind::Command, pipeline_id, false).unwrap();
        assert!(
            register_pending_ack_in(&mut pending, PendingAckKind::Command, pipeline_id, false)
                .is_err()
        );
        consume_pending_ack_in(&mut pending, PendingAckKind::Command, pipeline_id).unwrap();
        assert!(
            consume_pending_ack_in(&mut pending, PendingAckKind::Command, pipeline_id).is_err()
        );

        register_pending_ack_in(&mut pending, PendingAckKind::Data, pipeline_id, true).unwrap();
        register_pending_ack_in(&mut pending, PendingAckKind::Data, pipeline_id, true).unwrap();
        assert_eq!(pending.values().sum::<usize>(), 2);

        pending.clear();
        pending.insert(
            PendingAckKey {
                kind: PendingAckKind::Data,
                ps_guid: pipeline_id,
            },
            MAX_PENDING_OUT_OF_PROCESS_ACKS,
        );
        assert!(
            register_pending_ack_in(&mut pending, PendingAckKind::Signal, pipeline_id, false)
                .unwrap_err()
                .to_string()
                .contains("limit")
        );
    }
}
