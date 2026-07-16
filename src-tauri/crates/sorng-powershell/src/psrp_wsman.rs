//! Fail-closed PSRP-over-WSMan transport.
//!
//! This adapter binds the transport-agnostic `psrp-rs` core to the
//! PowerShell WSMan plug-in. It intentionally supports only authentication
//! modes whose complete HTTP exchange is available in this crate: Basic over
//! HTTPS and explicit NTLM. Other advertised remoting modes remain rejected
//! until their channel binding and transport integration are proven.

use std::collections::VecDeque;
use std::fmt;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use base64::Engine as _;
use futures::StreamExt;
use psrp_rs::fragment::Reassembler;
use psrp_rs::message::{MessageType, PsrpMessage};
use psrp_rs::{PsrpError, PsrpTransport};
use quick_xml::events::{BytesStart, Event};
use quick_xml::{Reader, XmlVersion};
use reqwest::header::{
    HeaderMap, HeaderName, HeaderValue, AUTHORIZATION, CONTENT_LENGTH, CONTENT_TYPE,
    WWW_AUTHENTICATE,
};
use tokio::sync::Mutex;
use url::Url;

use crate::auth::{create_auth_provider, AuthProvider};
use crate::test_support::WinRmTestTrust;
use crate::tls::{build_winrm_client, build_winrm_client_with_test_trust};
use crate::types::{PsAuthMethod, PsRemotingConfig, PsTransportProtocol};

const ACTION_CREATE: &str = "http://schemas.xmlsoap.org/ws/2004/09/transfer/Create";
const ACTION_DELETE: &str = "http://schemas.xmlsoap.org/ws/2004/09/transfer/Delete";
const ACTION_COMMAND: &str = "http://schemas.microsoft.com/wbem/wsman/1/windows/shell/Command";
const ACTION_RECEIVE: &str = "http://schemas.microsoft.com/wbem/wsman/1/windows/shell/Receive";
const ACTION_SEND: &str = "http://schemas.microsoft.com/wbem/wsman/1/windows/shell/Send";
const ACTION_SIGNAL: &str = "http://schemas.microsoft.com/wbem/wsman/1/windows/shell/Signal";
const SIGNAL_CTRL_C: &str = "http://schemas.microsoft.com/wbem/wsman/1/windows/shell/signal/ctrl_c";
const WSMAN_OPERATION_TIMEOUT: &str = "2150858793";
const MAX_XML_DEPTH: usize = 64;

/// Capabilities that are deliberately not claimed by this milestone.
pub const PSRP_WSMAN_LIMITATIONS: &[&str] = &[
    "Negotiate/SPNEGO is not supported; select NTLM explicitly",
    "NTLM challenge state is wired through the existing provider, but live Windows acceptance is not yet claimed",
    "NTLM over HTTP does not add WSMan message sealing in this milestone; use HTTPS for confidentiality",
    "Kerberos is not supported by this WSMan adapter",
    "certificate authentication is not supported by this WSMan adapter",
    "CredSSP is not supported because channel binding and delegation are not implemented",
    "live Windows WinRM HTTPS interoperability requires a provisioned external fixture",
];

/// Hard limits applied to every WSMan operation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WsmanPsrpLimits {
    pub max_envelope_bytes: usize,
    pub max_response_bytes: usize,
    pub max_auth_rounds: usize,
    pub max_empty_receives: usize,
    pub operation_timeout: Duration,
    pub connect_timeout: Duration,
}

impl Default for WsmanPsrpLimits {
    fn default() -> Self {
        Self {
            max_envelope_bytes: 512 * 1024,
            max_response_bytes: 8 * 1024 * 1024,
            max_auth_rounds: 3,
            max_empty_receives: 32,
            operation_timeout: Duration::from_secs(180),
            connect_timeout: Duration::from_secs(30),
        }
    }
}

impl WsmanPsrpLimits {
    fn validate(self) -> Result<Self, PsrpError> {
        if self.max_envelope_bytes < 1024 {
            return Err(protocol("WSMan envelope limit must be at least 1024 bytes"));
        }
        if self.max_response_bytes < 1024 {
            return Err(protocol("WSMan response limit must be at least 1024 bytes"));
        }
        if self.max_auth_rounds == 0 || self.max_auth_rounds > 8 {
            return Err(protocol(
                "WSMan authentication rounds must be between 1 and 8",
            ));
        }
        if self.max_empty_receives == 0 {
            return Err(protocol(
                "WSMan empty receive limit must be greater than zero",
            ));
        }
        if self.operation_timeout.is_zero() || self.connect_timeout.is_zero() {
            return Err(protocol("WSMan timeouts must be greater than zero"));
        }
        Ok(self)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SupportedAuth {
    Basic,
    Ntlm,
}

struct WsmanState {
    client: reqwest::Client,
    endpoint: String,
    resource_uri: String,
    locale: String,
    idle_timeout: Duration,
    auth_kind: SupportedAuth,
    auth: Box<dyn AuthProvider>,
    auth_header: Option<String>,
    custom_headers: HeaderMap,
    limits: WsmanPsrpLimits,
    opening_fragment: Option<Vec<u8>>,
    opening_rpid: Option<uuid::Uuid>,
    shell_id: Option<String>,
    active_pipeline: Option<uuid::Uuid>,
    command_id: Option<String>,
    pending_chunks: VecDeque<Vec<u8>>,
    request_count: u64,
    closed: bool,
}

/// A persistent PowerShell runspace transported over WSMan SOAP.
#[derive(Clone)]
pub struct WsmanPsrpTransport {
    state: Arc<Mutex<WsmanState>>,
}

impl fmt::Debug for WsmanPsrpTransport {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("WsmanPsrpTransport")
            .field("state", &"[synchronized, credentials redacted]")
            .finish()
    }
}

impl WsmanPsrpTransport {
    /// Construct a transport without opening the remote shell. The PSRP core
    /// opens it when it sends SessionCapability + InitRunspacePool.
    pub fn new(config: &PsRemotingConfig, limits: WsmanPsrpLimits) -> Result<Self, PsrpError> {
        Self::new_inner(config, limits, None)
    }

    /// Construct a transport using an isolated, explicitly pre-pinned test
    /// Trust Center. Production callers should use [`Self::new`].
    #[doc(hidden)]
    pub fn new_with_test_trust(
        config: &PsRemotingConfig,
        limits: WsmanPsrpLimits,
        trust: &WinRmTestTrust,
    ) -> Result<Self, PsrpError> {
        Self::new_inner(config, limits, Some(trust))
    }

    fn new_inner(
        config: &PsRemotingConfig,
        limits: WsmanPsrpLimits,
        test_trust: Option<&WinRmTestTrust>,
    ) -> Result<Self, PsrpError> {
        let limits = limits.validate()?;
        let endpoint = canonical_wsman_endpoint(config)?;
        let auth_kind = validate_auth_and_trust(config)?;
        let resource_uri = powershell_resource_uri(&config.configuration_name)?;
        let custom_headers = validate_custom_headers(&config.custom_headers)?;

        let mut builder = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(limits.operation_timeout)
            .connect_timeout(limits.connect_timeout)
            .pool_max_idle_per_host(1);
        if config.session_option.no_compression {
            builder = builder.no_gzip().no_brotli().no_deflate();
        }
        let client = if endpoint.starts_with("https://") {
            let trust_config = trust_config_for_endpoint(config, &endpoint)?;
            let client = match test_trust {
                Some(trust) => build_winrm_client_with_test_trust(builder, &trust_config, trust),
                None => build_winrm_client(builder, &trust_config),
            };
            client.map_err(|error| protocol(format!("WSMan TLS client setup failed: {error}")))?
        } else {
            builder
                .build()
                .map_err(|error| protocol(format!("WSMan HTTP client setup failed: {error}")))?
        };
        let auth = create_auth_provider(
            &config.auth_method,
            &config.credential,
            &config.computer_name,
        )
        .map_err(|error| protocol(format!("WSMan authentication setup failed: {error}")))?;
        let auth_header = match auth_kind {
            SupportedAuth::Basic => Some(auth.initial_auth_header().map_err(|error| {
                protocol(format!("Basic authentication setup failed: {error}"))
            })?),
            SupportedAuth::Ntlm => None,
        };

        Ok(Self {
            state: Arc::new(Mutex::new(WsmanState {
                client,
                endpoint,
                resource_uri,
                locale: config.session_option.culture.clone(),
                idle_timeout: Duration::from_secs(config.session_option.idle_timeout_sec.into()),
                auth_kind,
                auth,
                auth_header,
                custom_headers,
                limits,
                opening_fragment: None,
                opening_rpid: None,
                shell_id: None,
                active_pipeline: None,
                command_id: None,
                pending_chunks: VecDeque::new(),
                request_count: 0,
                closed: false,
            })),
        })
    }
}

fn trust_config_for_endpoint(
    config: &PsRemotingConfig,
    endpoint: &str,
) -> Result<PsRemotingConfig, PsrpError> {
    let parsed = Url::parse(endpoint)
        .map_err(|error| protocol(format!("invalid WSMan trust endpoint: {error}")))?;
    let host = parsed
        .host_str()
        .ok_or_else(|| protocol("WSMan trust endpoint omitted its host"))?;
    let port = parsed
        .port_or_known_default()
        .ok_or_else(|| protocol("WSMan trust endpoint omitted its port"))?;
    let mut trust_config = config.clone();
    trust_config.computer_name = host.to_string();
    trust_config.port = Some(port);
    trust_config.connection_uri = Some(endpoint.to_string());
    trust_config.transport = PsTransportProtocol::Https;
    trust_config.use_ssl = true;
    Ok(trust_config)
}

/// Resolve every HTTP(S) configuration to exactly one root `/wsman` path.
pub fn canonical_wsman_endpoint(config: &PsRemotingConfig) -> Result<String, PsrpError> {
    let endpoint = config.try_endpoint_uri().map_err(protocol)?;
    let mut parsed = Url::parse(&endpoint)
        .map_err(|error| protocol(format!("invalid WSMan endpoint: {error}")))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(protocol(
            "PSRP-over-WSMan requires an HTTP or HTTPS endpoint",
        ));
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(protocol("WSMan endpoint must not embed credentials"));
    }
    parsed.set_path("/wsman");
    parsed.set_query(None);
    parsed.set_fragment(None);
    Ok(parsed.to_string().trim_end_matches('/').to_string())
}

fn validate_auth_and_trust(config: &PsRemotingConfig) -> Result<SupportedAuth, PsrpError> {
    if config.transport == PsTransportProtocol::Ssh {
        return Err(protocol("PSRP-over-WSMan cannot use the SSH transport"));
    }
    if config.skip_ca_check || config.skip_cn_check || config.skip_revocation_check {
        return Err(protocol(
            "strict WSMan TLS trust does not permit certificate, hostname, or revocation bypass flags",
        ));
    }
    match config.auth_method {
        PsAuthMethod::Basic | PsAuthMethod::Ntlm if !config.uses_tls() => Err(protocol(
            "WSMan authentication is rejected over HTTP; use HTTPS with Trust Center verification",
        )),
        PsAuthMethod::Basic => Ok(SupportedAuth::Basic),
        PsAuthMethod::Ntlm => Ok(SupportedAuth::Ntlm),
        PsAuthMethod::Negotiate | PsAuthMethod::Default => Err(protocol(
            "Negotiate is not claimed by the WSMan adapter; select NTLM explicitly",
        )),
        PsAuthMethod::Kerberos => Err(protocol(
            "Kerberos is not supported by the WSMan adapter",
        )),
        PsAuthMethod::Certificate => Err(protocol(
            "certificate authentication is not supported by the WSMan adapter",
        )),
        PsAuthMethod::CredSsp => Err(protocol(
            "CredSSP is not supported: channel binding and credential delegation are not implemented",
        )),
        PsAuthMethod::Digest => Err(protocol(
            "Digest authentication is not supported by the WSMan adapter",
        )),
    }
}

fn powershell_resource_uri(configuration_name: &str) -> Result<String, PsrpError> {
    let name = configuration_name.trim();
    if name.is_empty()
        || !name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
    {
        return Err(protocol(
            "PowerShell configuration name must contain only ASCII letters, digits, '.', '_' or '-'",
        ));
    }
    Ok(format!("http://schemas.microsoft.com/powershell/{name}"))
}

fn validate_custom_headers(
    headers: &std::collections::HashMap<String, String>,
) -> Result<HeaderMap, PsrpError> {
    let mut validated = HeaderMap::new();
    for (name, value) in headers {
        let header_name = HeaderName::from_bytes(name.as_bytes())
            .map_err(|_| protocol(format!("invalid WSMan custom header name '{name}'")))?;
        if matches!(
            header_name.as_str().to_ascii_lowercase().as_str(),
            "authorization"
                | "host"
                | "content-length"
                | "content-type"
                | "connection"
                | "transfer-encoding"
        ) {
            return Err(protocol(format!(
                "WSMan custom header '{name}' is transport-controlled"
            )));
        }
        let header_value = HeaderValue::from_str(value)
            .map_err(|_| protocol(format!("invalid value for WSMan custom header '{name}'")))?;
        validated.insert(header_name, header_value);
    }
    Ok(validated)
}

#[async_trait]
impl PsrpTransport for WsmanPsrpTransport {
    async fn send_fragment(&self, bytes: &[u8]) -> Result<(), PsrpError> {
        let messages = decode_fragment_messages(bytes)?;
        if messages.len() != 1 {
            return Err(protocol(
                "one WSMan send operation must contain one complete PSRP message",
            ));
        }
        let message = &messages[0];
        let mut state = self.state.lock().await;
        ensure_open_for_operation(&state)?;

        if message.message_type == MessageType::SessionCapability && message.pid.is_nil() {
            if state.shell_id.is_some() || state.opening_fragment.is_some() {
                return Err(protocol("duplicate WSMan runspace SessionCapability"));
            }
            state.opening_fragment = Some(bytes.to_vec());
            state.opening_rpid = Some(message.rpid);
            return Ok(());
        }

        if message.message_type == MessageType::InitRunspacePool && message.pid.is_nil() {
            if state.shell_id.is_some() {
                return Err(protocol("WSMan runspace shell is already open"));
            }
            if state.opening_rpid != Some(message.rpid) {
                return Err(protocol(
                    "WSMan opening PSRP messages used different runspace IDs",
                ));
            }
            let mut creation = state
                .opening_fragment
                .take()
                .ok_or_else(|| protocol("InitRunspacePool arrived before SessionCapability"))?;
            creation.extend_from_slice(bytes);
            let body = create_body(&creation, state.idle_timeout);
            let response = perform_operation(&mut state, ACTION_CREATE, None, body).await?;
            let shell_id = response
                .shell_id
                .ok_or_else(|| protocol("WSMan Create response omitted ShellId"))?;
            state.shell_id = Some(validate_identifier("ShellId", shell_id)?);
            state.pending_chunks.extend(response.chunks);
            return Ok(());
        }

        let shell_id = state
            .shell_id
            .clone()
            .ok_or_else(|| protocol("WSMan shell is not open"))?;
        let body = send_body(state.command_id.as_deref(), bytes);
        let response = perform_operation(&mut state, ACTION_SEND, Some(&shell_id), body).await?;
        state.pending_chunks.extend(response.chunks);
        Ok(())
    }

    async fn recv_chunk(&mut self) -> Result<Vec<u8>, PsrpError> {
        let mut state = self.state.lock().await;
        ensure_open_for_operation(&state)?;
        if let Some(chunk) = state.pending_chunks.pop_front() {
            return Ok(chunk);
        }
        let shell_id = state
            .shell_id
            .clone()
            .ok_or_else(|| protocol("WSMan shell is not open"))?;

        for _ in 0..state.limits.max_empty_receives {
            let body = receive_body(state.command_id.as_deref());
            match perform_operation(&mut state, ACTION_RECEIVE, Some(&shell_id), body).await {
                Ok(response) => {
                    validate_command_correlation(&response, state.command_id.as_deref())?;
                    let done = response.command_done;
                    state.pending_chunks.extend(response.chunks);
                    if done {
                        state.command_id = None;
                        state.active_pipeline = None;
                    }
                    if let Some(chunk) = state.pending_chunks.pop_front() {
                        return Ok(chunk);
                    }
                    if done {
                        return Ok(Vec::new());
                    }
                }
                Err(PsrpError::Protocol(message))
                    if message.starts_with("WSMan operation timed out") => {}
                Err(error) => return Err(error),
            }
        }
        Err(protocol(format!(
            "WSMan receive produced no PSRP data after {} bounded polls",
            state.limits.max_empty_receives
        )))
    }

    async fn execute_pipeline(
        &mut self,
        fragment_bytes: &[u8],
        pipeline_id: uuid::Uuid,
    ) -> Result<(), PsrpError> {
        let messages = decode_fragment_messages(fragment_bytes)?;
        if messages.len() != 1
            || messages[0].message_type != MessageType::CreatePipeline
            || messages[0].pid != pipeline_id
        {
            return Err(protocol(
                "WSMan Command requires one CreatePipeline message matching the pipeline ID",
            ));
        }
        let mut state = self.state.lock().await;
        ensure_open_for_operation(&state)?;
        if state.command_id.is_some() {
            return Err(protocol("a WSMan pipeline command is already active"));
        }
        let shell_id = state
            .shell_id
            .clone()
            .ok_or_else(|| protocol("WSMan shell is not open"))?;
        let response = perform_operation(
            &mut state,
            ACTION_COMMAND,
            Some(&shell_id),
            command_body(fragment_bytes),
        )
        .await?;
        let command_id = response
            .command_id
            .ok_or_else(|| protocol("WSMan Command response omitted CommandId"))?;
        state.command_id = Some(validate_identifier("CommandId", command_id)?);
        state.active_pipeline = Some(pipeline_id);
        state.pending_chunks.extend(response.chunks);
        Ok(())
    }

    async fn signal_stop(&self) -> Result<(), PsrpError> {
        let mut state = self.state.lock().await;
        ensure_open_for_operation(&state)?;
        let shell_id = state
            .shell_id
            .clone()
            .ok_or_else(|| protocol("WSMan shell is not open"))?;
        let command_id = state
            .command_id
            .clone()
            .ok_or_else(|| protocol("cannot signal WSMan stop without an active command"))?;
        perform_operation(
            &mut state,
            ACTION_SIGNAL,
            Some(&shell_id),
            signal_body(&command_id),
        )
        .await?;
        Ok(())
    }

    async fn close_shell(&mut self) -> Result<(), PsrpError> {
        let mut state = self.state.lock().await;
        if state.closed {
            return Ok(());
        }
        state.closed = true;
        state.opening_fragment = None;
        state.opening_rpid = None;
        state.command_id = None;
        state.active_pipeline = None;
        state.pending_chunks.clear();
        let Some(shell_id) = state.shell_id.take() else {
            return Ok(());
        };
        perform_operation(&mut state, ACTION_DELETE, Some(&shell_id), String::new()).await?;
        Ok(())
    }
}

fn ensure_open_for_operation(state: &WsmanState) -> Result<(), PsrpError> {
    if state.closed {
        Err(protocol("WSMan PSRP transport is closed"))
    } else {
        Ok(())
    }
}

async fn perform_operation(
    state: &mut WsmanState,
    action: &str,
    shell_id: Option<&str>,
    body: String,
) -> Result<ParsedResponse, PsrpError> {
    state.request_count = state.request_count.saturating_add(1);
    let envelope = soap_envelope(state, action, shell_id, &body);
    if envelope.len() > state.limits.max_envelope_bytes {
        return Err(protocol(format!(
            "WSMan request envelope exceeded {} bytes",
            state.limits.max_envelope_bytes
        )));
    }

    for round in 0..=state.limits.max_auth_rounds {
        let mut request = state
            .client
            .post(&state.endpoint)
            .header(CONTENT_TYPE, "application/soap+xml;charset=UTF-8")
            .headers(state.custom_headers.clone())
            .body(envelope.clone());
        if let Some(header) = state.auth_header.as_deref() {
            request = request.header(AUTHORIZATION, header);
        }

        let response = tokio::time::timeout(state.limits.operation_timeout, request.send())
            .await
            .map_err(|_| protocol("WSMan HTTP operation timed out"))?
            .map_err(|error| protocol(format!("WSMan HTTP request failed: {error}")))?;
        let status = response.status();
        let challenge = select_auth_challenge(response.headers(), state.auth_kind);
        let bytes = read_bounded_response(response, state.limits.max_response_bytes).await?;

        if status == reqwest::StatusCode::UNAUTHORIZED {
            if round == state.limits.max_auth_rounds {
                return Err(protocol(format!(
                    "WSMan {} authentication exceeded {} challenge rounds",
                    auth_name(state.auth_kind),
                    state.limits.max_auth_rounds
                )));
            }
            let challenge = challenge.ok_or_else(|| {
                protocol(format!(
                    "WSMan server did not offer {} authentication",
                    auth_name(state.auth_kind)
                ))
            })?;
            let next = state
                .auth
                .process_challenge(&challenge)
                .await
                .map_err(|error| {
                    protocol(format!("WSMan authentication challenge failed: {error}"))
                })?
                .ok_or_else(|| protocol("WSMan authentication failed after challenge"))?;
            state.auth_header = Some(normalize_auth_header(state.auth_kind, next)?);
            continue;
        }

        let parsed = parse_wsman_response(&bytes, state.limits.max_response_bytes)?;
        if let Some(fault) = parsed.fault.as_ref() {
            if fault.code.as_deref() == Some(WSMAN_OPERATION_TIMEOUT) {
                return Err(protocol(format!(
                    "WSMan operation timed out{}",
                    fault
                        .reason
                        .as_deref()
                        .map(|reason| format!(": {reason}"))
                        .unwrap_or_default()
                )));
            }
            return Err(protocol(format_fault(status, fault)));
        }
        if !status.is_success() {
            return Err(protocol(format!(
                "WSMan HTTP operation failed with status {}",
                status.as_u16()
            )));
        }
        return Ok(parsed);
    }
    Err(protocol("WSMan authentication state exhausted"))
}

async fn read_bounded_response(
    response: reqwest::Response,
    limit: usize,
) -> Result<Vec<u8>, PsrpError> {
    if response
        .headers()
        .get(CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<usize>().ok())
        .is_some_and(|length| length > limit)
    {
        return Err(protocol(format!(
            "WSMan response Content-Length exceeded {limit} bytes"
        )));
    }
    let mut body = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk =
            chunk.map_err(|error| protocol(format!("WSMan response read failed: {error}")))?;
        if body.len().saturating_add(chunk.len()) > limit {
            return Err(protocol(format!("WSMan response exceeded {limit} bytes")));
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

fn select_auth_challenge(headers: &HeaderMap, auth: SupportedAuth) -> Option<String> {
    let wanted = match auth {
        SupportedAuth::Basic => "basic",
        SupportedAuth::Ntlm => "ntlm",
    };
    let fallback = (auth == SupportedAuth::Ntlm).then_some("negotiate");
    let values: Vec<String> = headers
        .get_all(WWW_AUTHENTICATE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(split_challenges)
        .collect();
    values
        .iter()
        .find(|value| scheme_name(value).eq_ignore_ascii_case(wanted))
        .cloned()
        .or_else(|| {
            fallback.and_then(|scheme| {
                values
                    .iter()
                    .find(|value| scheme_name(value).eq_ignore_ascii_case(scheme))
                    .cloned()
            })
        })
}

fn split_challenges(value: &str) -> impl Iterator<Item = String> + '_ {
    value.split(',').map(|part| part.trim().to_string())
}

fn scheme_name(value: &str) -> &str {
    value.split_ascii_whitespace().next().unwrap_or_default()
}

fn normalize_auth_header(auth: SupportedAuth, value: String) -> Result<String, PsrpError> {
    let value = value.trim();
    match auth {
        SupportedAuth::Basic if value.starts_with("Basic ") => Ok(value.to_string()),
        SupportedAuth::Ntlm => value
            .strip_prefix("Negotiate ")
            .or_else(|| value.strip_prefix("NTLM "))
            .map(|token| format!("NTLM {token}"))
            .ok_or_else(|| protocol("NTLM provider produced a non-NTLM authorization header")),
        _ => Err(protocol(
            "authentication provider produced an unexpected header",
        )),
    }
}

fn auth_name(auth: SupportedAuth) -> &'static str {
    match auth {
        SupportedAuth::Basic => "Basic",
        SupportedAuth::Ntlm => "NTLM",
    }
}

#[derive(Debug, Default)]
struct ParsedResponse {
    shell_id: Option<String>,
    command_id: Option<String>,
    chunks: Vec<Vec<u8>>,
    command_done: bool,
    fault: Option<SanitizedFault>,
}

#[derive(Debug, Default)]
struct SanitizedFault {
    code: Option<String>,
    reason: Option<String>,
}

#[derive(Debug, Default)]
struct ElementContext {
    name: String,
    selector_name: Option<String>,
    stream_name: Option<String>,
}

fn parse_wsman_response(bytes: &[u8], decoded_limit: usize) -> Result<ParsedResponse, PsrpError> {
    let xml =
        std::str::from_utf8(bytes).map_err(|_| protocol("WSMan response was not valid UTF-8"))?;
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);
    let mut buffer = Vec::new();
    let mut stack: Vec<ElementContext> = Vec::new();
    let mut parsed = ParsedResponse::default();
    let mut decoded_bytes = 0usize;

    loop {
        match reader.read_event_into(&mut buffer) {
            Ok(Event::Start(element)) => {
                if stack.len() >= MAX_XML_DEPTH {
                    return Err(protocol("WSMan response exceeded the XML depth limit"));
                }
                let context = response_start_context(&element, &reader, &mut parsed)?;
                stack.push(context);
            }
            Ok(Event::Empty(element)) => {
                response_start_context(&element, &reader, &mut parsed)?;
            }
            Ok(Event::Text(text)) => {
                let decoded = text
                    .decode()
                    .map_err(|_| protocol("WSMan response contained invalid text encoding"))?;
                let value = quick_xml::escape::unescape(&decoded)
                    .map_err(|_| protocol("WSMan response contained invalid XML escaping"))?;
                if let Some(context) = stack.last() {
                    apply_response_text(
                        context,
                        value.trim(),
                        &mut parsed,
                        &mut decoded_bytes,
                        decoded_limit,
                    )?;
                }
            }
            Ok(Event::End(_)) => {
                stack.pop();
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(error) => {
                return Err(protocol(format!(
                    "WSMan response XML was malformed near byte {}: {error}",
                    reader.error_position()
                )))
            }
        }
        buffer.clear();
    }
    Ok(parsed)
}

fn response_start_context(
    element: &BytesStart<'_>,
    reader: &Reader<&[u8]>,
    parsed: &mut ParsedResponse,
) -> Result<ElementContext, PsrpError> {
    let name = local_name(element.name().as_ref())?.to_string();
    let mut context = ElementContext {
        name: name.clone(),
        ..ElementContext::default()
    };
    let mut state_value = None;
    for attribute in element.attributes().with_checks(false) {
        let attribute =
            attribute.map_err(|_| protocol("WSMan response had a malformed attribute"))?;
        let key = local_name(attribute.key.as_ref())?;
        let value = attribute
            .decoded_and_normalized_value(XmlVersion::Implicit1_0, reader.decoder())
            .map_err(|_| protocol("WSMan response had an invalid attribute value"))?
            .into_owned();
        match (name.as_str(), key) {
            ("Shell", "ShellId") => parsed.shell_id = Some(value),
            ("CommandResponse", "CommandId") | ("CommandState", "CommandId") => {
                parsed.command_id = Some(value)
            }
            ("Stream", "CommandId") if parsed.command_id.is_none() => {
                parsed.command_id = Some(value)
            }
            ("Selector", "Name") => context.selector_name = Some(value),
            ("Stream", "Name") => context.stream_name = Some(value),
            ("CommandState", "State") => state_value = Some(value),
            ("WSManFault", "Code") => {
                parsed.fault.get_or_insert_with(Default::default).code =
                    Some(sanitize_fault_text(&value))
            }
            _ => {}
        }
    }
    if state_value
        .as_deref()
        .is_some_and(|state| state.eq_ignore_ascii_case("Done") || state.ends_with("/Done"))
    {
        parsed.command_done = true;
    }
    if name == "Fault" {
        parsed.fault.get_or_insert_with(Default::default);
    }
    Ok(context)
}

fn apply_response_text(
    context: &ElementContext,
    value: &str,
    parsed: &mut ParsedResponse,
    decoded_bytes: &mut usize,
    decoded_limit: usize,
) -> Result<(), PsrpError> {
    if value.is_empty() {
        return Ok(());
    }
    match context.name.as_str() {
        "ShellId" => parsed.shell_id = Some(value.to_string()),
        "CommandId" => parsed.command_id = Some(value.to_string()),
        "Selector" if context.selector_name.as_deref() == Some("ShellId") => {
            parsed.shell_id = Some(value.to_string())
        }
        "creationXml" => push_base64_chunk(value, parsed, decoded_bytes, decoded_limit)?,
        "Stream" if context.stream_name.as_deref() == Some("stdout") => {
            push_base64_chunk(value, parsed, decoded_bytes, decoded_limit)?
        }
        "Stream" if context.stream_name.as_deref() == Some("stderr") => {
            let decoded = decode_base64_bounded(value, decoded_bytes, decoded_limit)?;
            let reason = sanitize_fault_text(&String::from_utf8_lossy(&decoded));
            parsed.fault.get_or_insert_with(Default::default).reason = Some(if reason.is_empty() {
                "PowerShell WSMan plug-in returned stderr".to_string()
            } else {
                reason
            });
        }
        "Text" | "Message" if parsed.fault.is_some() => {
            let reason = sanitize_fault_text(value);
            if !reason.is_empty() {
                parsed.fault.get_or_insert_with(Default::default).reason = Some(reason);
            }
        }
        _ => {}
    }
    Ok(())
}

fn push_base64_chunk(
    value: &str,
    parsed: &mut ParsedResponse,
    decoded_bytes: &mut usize,
    decoded_limit: usize,
) -> Result<(), PsrpError> {
    let decoded = decode_base64_bounded(value, decoded_bytes, decoded_limit)?;
    if !decoded.is_empty() {
        parsed.chunks.push(decoded);
    }
    Ok(())
}

fn decode_base64_bounded(
    value: &str,
    decoded_bytes: &mut usize,
    decoded_limit: usize,
) -> Result<Vec<u8>, PsrpError> {
    let compact: Vec<u8> = value
        .bytes()
        .filter(|byte| !byte.is_ascii_whitespace())
        .collect();
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(compact)
        .map_err(|_| protocol("WSMan response contained invalid base64 stream data"))?;
    *decoded_bytes = decoded_bytes.saturating_add(decoded.len());
    if *decoded_bytes > decoded_limit {
        return Err(protocol(format!(
            "WSMan decoded stream data exceeded {decoded_limit} bytes"
        )));
    }
    Ok(decoded)
}

fn validate_command_correlation(
    response: &ParsedResponse,
    expected: Option<&str>,
) -> Result<(), PsrpError> {
    let Some(expected) = expected else {
        return Ok(());
    };
    if response.chunks.is_empty() && !response.command_done {
        return Ok(());
    }
    match response.command_id.as_deref() {
        Some(actual) if actual == expected => Ok(()),
        Some(_) => Err(protocol(
            "WSMan response CommandId did not match the active pipeline",
        )),
        None => Err(protocol(
            "WSMan response for an active pipeline omitted CommandId",
        )),
    }
}

fn format_fault(status: reqwest::StatusCode, fault: &SanitizedFault) -> String {
    let mut message = format!("WSMan fault (HTTP {})", status.as_u16());
    if let Some(code) = fault.code.as_deref().filter(|code| !code.is_empty()) {
        message.push_str(&format!(" code {code}"));
    }
    if let Some(reason) = fault.reason.as_deref().filter(|reason| !reason.is_empty()) {
        message.push_str(&format!(": {reason}"));
    }
    message
}

fn sanitize_fault_text(value: &str) -> String {
    let collapsed = value
        .chars()
        .map(|character| {
            if character.is_control() {
                ' '
            } else {
                character
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    truncate_utf8(&collapsed, 512)
}

fn validate_identifier(kind: &str, value: String) -> Result<String, PsrpError> {
    let value = value.trim();
    if value.is_empty()
        || value.len() > 256
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'{' | b'}' | b'-' | b'_'))
    {
        return Err(protocol(format!("WSMan {kind} was invalid")));
    }
    Ok(value.to_string())
}

fn decode_fragment_messages(bytes: &[u8]) -> Result<Vec<PsrpMessage>, PsrpError> {
    let mut reassembler = Reassembler::new();
    let messages = reassembler.feed(bytes)?;
    if messages.is_empty() || !reassembler.is_idle() {
        return Err(protocol(
            "WSMan PSRP payload did not contain a complete message",
        ));
    }
    messages
        .into_iter()
        .map(|message| PsrpMessage::decode(&message))
        .collect()
}

fn soap_envelope(state: &WsmanState, action: &str, shell_id: Option<&str>, body: &str) -> String {
    let selector = shell_id
        .map(|id| {
            format!(
                "<w:SelectorSet><w:Selector Name=\"ShellId\">{}</w:Selector></w:SelectorSet>",
                xml_escape(id)
            )
        })
        .unwrap_or_default();
    let options = if action == ACTION_CREATE {
        "<w:OptionSet><w:Option Name=\"protocolversion\" MustComply=\"true\">2.3</w:Option></w:OptionSet>"
    } else {
        ""
    };
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\
<s:Envelope xmlns:s=\"http://www.w3.org/2003/05/soap-envelope\" \
xmlns:a=\"http://schemas.xmlsoap.org/ws/2004/08/addressing\" \
xmlns:w=\"http://schemas.dmtf.org/wbem/wsman/1/wsman.xsd\" \
xmlns:p=\"http://schemas.microsoft.com/wbem/wsman/1/wsman.xsd\" \
xmlns:rsp=\"http://schemas.microsoft.com/wbem/wsman/1/windows/shell\" \
xmlns:pwsh=\"http://schemas.microsoft.com/powershell\">\
<s:Header>\
<a:To>{endpoint}</a:To>\
<a:Action s:mustUnderstand=\"true\">{action}</a:Action>\
<w:ResourceURI s:mustUnderstand=\"true\">{resource}</w:ResourceURI>\
<a:MessageID>uuid:{message_id}</a:MessageID>\
<a:ReplyTo><a:Address>http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</a:Address></a:ReplyTo>\
<w:MaxEnvelopeSize s:mustUnderstand=\"true\">{max_envelope}</w:MaxEnvelopeSize>\
<w:OperationTimeout>PT{timeout}S</w:OperationTimeout>\
<p:Locale xml:lang=\"{locale}\" s:mustUnderstand=\"false\"/>\
{selector}{options}</s:Header><s:Body>{body}</s:Body></s:Envelope>",
        endpoint = xml_escape(&state.endpoint),
        action = action,
        resource = xml_escape(&state.resource_uri),
        message_id = uuid::Uuid::new_v4(),
        max_envelope = state.limits.max_envelope_bytes,
        timeout = state.limits.operation_timeout.as_secs(),
        locale = xml_escape(&state.locale),
        selector = selector,
        options = options,
        body = body,
    )
}

fn create_body(creation: &[u8], idle_timeout: Duration) -> String {
    let encoded = base64::engine::general_purpose::STANDARD.encode(creation);
    format!(
        "<rsp:Shell><rsp:InputStreams>stdin pr</rsp:InputStreams>\
<rsp:OutputStreams>stdout</rsp:OutputStreams>\
<rsp:IdleTimeout>PT{}S</rsp:IdleTimeout>\
<pwsh:creationXml>{encoded}</pwsh:creationXml></rsp:Shell>",
        idle_timeout.as_secs()
    )
}

fn command_body(fragment: &[u8]) -> String {
    let encoded = base64::engine::general_purpose::STANDARD.encode(fragment);
    format!("<rsp:CommandLine><rsp:Command>{encoded}</rsp:Command></rsp:CommandLine>")
}

fn receive_body(command_id: Option<&str>) -> String {
    let command = command_id
        .map(|id| format!(" CommandId=\"{}\"", xml_escape(id)))
        .unwrap_or_default();
    format!("<rsp:Receive><rsp:DesiredStream{command}>stdout</rsp:DesiredStream></rsp:Receive>")
}

fn send_body(command_id: Option<&str>, fragment: &[u8]) -> String {
    let command = command_id
        .map(|id| format!(" CommandId=\"{}\"", xml_escape(id)))
        .unwrap_or_default();
    let encoded = base64::engine::general_purpose::STANDARD.encode(fragment);
    format!("<rsp:Send><rsp:Stream Name=\"stdin\"{command}>{encoded}</rsp:Stream></rsp:Send>")
}

fn signal_body(command_id: &str) -> String {
    format!(
        "<rsp:Signal CommandId=\"{}\"><rsp:Code>{SIGNAL_CTRL_C}</rsp:Code></rsp:Signal>",
        xml_escape(command_id)
    )
}

fn local_name(name: &[u8]) -> Result<&str, PsrpError> {
    let local = name.rsplit(|byte| *byte == b':').next().unwrap_or(name);
    std::str::from_utf8(local).map_err(|_| protocol("WSMan response had an invalid XML name"))
}

fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn truncate_utf8(value: &str, max_bytes: usize) -> String {
    if value.len() <= max_bytes {
        return value.to_string();
    }
    let mut end = max_bytes;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}...", &value[..end])
}

fn protocol(message: impl Into<String>) -> PsrpError {
    PsrpError::Protocol(message.into())
}
