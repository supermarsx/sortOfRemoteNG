use std::cell::RefCell;
use std::collections::HashMap;
use std::fmt;
use std::fs;
use std::path::PathBuf;
use std::sync::{mpsc, Mutex, OnceLock};
use std::time::Duration;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use sorng_core::events::DynEventEmitter;

use super::settings::RdpSettingsPayload;

const DEFAULT_CERT_PROMPT_TIMEOUT_SECS: u64 = 60;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ServerCertValidationMode {
    Validate,
    Warn,
    Ignore,
}

impl ServerCertValidationMode {
    pub fn from_payload(payload: &RdpSettingsPayload) -> Self {
        payload
            .security
            .as_ref()
            .and_then(|security| security.server_cert_validation.as_deref())
            .map(Self::from_str)
            .unwrap_or(Self::Validate)
    }

    pub fn from_str(value: &str) -> Self {
        match value.trim().to_ascii_lowercase().as_str() {
            "warn" => Self::Warn,
            "ignore" => Self::Ignore,
            _ => Self::Validate,
        }
    }

    pub fn permits_invalid_chain(self) -> bool {
        !matches!(self, Self::Validate)
    }
}

pub fn default_prompt_timeout() -> Duration {
    Duration::from_secs(DEFAULT_CERT_PROMPT_TIMEOUT_SECS)
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PresentedCertificate {
    pub host: String,
    pub port: u16,
    pub fingerprint: String,
    pub subject: String,
    pub issuer: String,
    pub valid_from: String,
    pub valid_to: String,
    pub serial: String,
    pub signature_algorithm: String,
    pub san: Vec<String>,
    pub pem: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CertTrustEntry {
    pub host: String,
    pub port: u16,
    pub fingerprint: String,
    pub subject: String,
    pub issuer: String,
    pub valid_from: String,
    pub valid_to: String,
    pub serial: String,
    pub signature_algorithm: String,
    pub san: Vec<String>,
    pub pem: String,
    pub first_seen: String,
    pub last_seen: String,
    pub last_approved_at: String,
}

impl CertTrustEntry {
    fn from_presented(cert: &PresentedCertificate, first_seen: Option<String>) -> Self {
        let now = Utc::now().to_rfc3339();

        Self {
            host: cert.host.clone(),
            port: cert.port,
            fingerprint: cert.fingerprint.clone(),
            subject: cert.subject.clone(),
            issuer: cert.issuer.clone(),
            valid_from: cert.valid_from.clone(),
            valid_to: cert.valid_to.clone(),
            serial: cert.serial.clone(),
            signature_algorithm: cert.signature_algorithm.clone(),
            san: cert.san.clone(),
            pem: cert.pem.clone(),
            first_seen: first_seen.unwrap_or_else(|| now.clone()),
            last_seen: now.clone(),
            last_approved_at: now,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ChainStatus {
    Valid,
    Invalid(String),
}

impl ChainStatus {
    fn is_valid(&self) -> bool {
        matches!(self, Self::Valid)
    }

    fn validation_error(&self) -> Option<String> {
        match self {
            Self::Valid => None,
            Self::Invalid(message) => Some(message.clone()),
        }
    }
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PromptKind {
    Unknown,
    Changed,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CertTrustPrompt {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    pub kind: PromptKind,
    pub host: String,
    pub port: u16,
    pub fingerprint: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_fingerprint: Option<String>,
    pub subject: String,
    pub issuer: String,
    pub valid_from: String,
    pub valid_to: String,
    pub serial: String,
    pub signature_algorithm: String,
    pub san: Vec<String>,
    pub pem: String,
    pub chain_valid: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub validation_error: Option<String>,
    pub timeout_secs: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PromptDecision {
    pub approve: bool,
    pub remember: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CertTrustError {
    InvalidChain(String),
    Rejected,
    PromptTimeout,
    PromptUnavailable(String),
    Store(String),
    Emit(String),
}

impl fmt::Display for CertTrustError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidChain(message) => {
                write!(f, "server certificate validation failed: {message}")
            }
            Self::Rejected => write!(f, "server certificate was rejected"),
            Self::PromptTimeout => write!(
                f,
                "certificate trust prompt timed out — no response received from the UI. \
                 If this connection's 'Server certificate validation' is set to 'Warn' \
                 but no prompt was shown, the trust UI is not yet wired up; switch the \
                 setting to 'Ignore' (auto-accept) or 'Validate' (strict) to avoid the \
                 prompt path"
            ),
            Self::PromptUnavailable(message) => write!(f, "{message}"),
            Self::Store(message) => write!(f, "certificate trust store error: {message}"),
            Self::Emit(message) => write!(f, "failed to emit certificate trust prompt: {message}"),
        }
    }
}

impl std::error::Error for CertTrustError {}

#[derive(Clone, Debug)]
pub struct CertTrustStore {
    path: PathBuf,
}

impl CertTrustStore {
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into() }
    }

    pub fn lookup(&self, host: &str, port: u16) -> Result<Option<CertTrustEntry>, CertTrustError> {
        let document = self.load_document()?;
        Ok(document.entries.get(&store_key(host, port)).cloned())
    }

    pub fn remember(
        &self,
        cert: &PresentedCertificate,
        previous: Option<&CertTrustEntry>,
    ) -> Result<CertTrustEntry, CertTrustError> {
        let mut document = self.load_document()?;
        let entry = CertTrustEntry::from_presented(cert, previous.map(|existing| existing.first_seen.clone()));
        document
            .entries
            .insert(store_key(&cert.host, cert.port), entry.clone());
        self.save_document(&document)?;
        Ok(entry)
    }

    fn load_document(&self) -> Result<CertTrustDocument, CertTrustError> {
        if !self.path.exists() {
            return Ok(CertTrustDocument::default());
        }

        let raw = fs::read_to_string(&self.path).map_err(|error| {
            CertTrustError::Store(format!(
                "failed to read {}: {error}",
                self.path.display()
            ))
        })?;
        if raw.trim().is_empty() {
            return Ok(CertTrustDocument::default());
        }

        serde_json::from_str(&raw).map_err(|error| {
            CertTrustError::Store(format!(
                "failed to parse {}: {error}",
                self.path.display()
            ))
        })
    }

    fn save_document(&self, document: &CertTrustDocument) -> Result<(), CertTrustError> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                CertTrustError::Store(format!(
                    "failed to create {}: {error}",
                    parent.display()
                ))
            })?;
        }

        let raw = serde_json::to_string_pretty(document)
            .map_err(|error| CertTrustError::Store(format!("failed to encode trust store: {error}")))?;
        fs::write(&self.path, raw).map_err(|error| {
            CertTrustError::Store(format!(
                "failed to write {}: {error}",
                self.path.display()
            ))
        })
    }
}

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CertTrustDocument {
    entries: HashMap<String, CertTrustEntry>,
}

pub fn evaluate_certificate_trust<F>(
    store: &CertTrustStore,
    session_id: Option<&str>,
    validation_mode: ServerCertValidationMode,
    prompt_timeout: Duration,
    cert: PresentedCertificate,
    chain_status: ChainStatus,
    mut prompt: F,
) -> Result<(), CertTrustError>
where
    F: FnMut(CertTrustPrompt, Duration) -> Result<PromptDecision, CertTrustError>,
{
    if let ChainStatus::Invalid(message) = &chain_status {
        if !validation_mode.permits_invalid_chain() {
            return Err(CertTrustError::InvalidChain(message.clone()));
        }
    }

    let existing = store.lookup(&cert.host, cert.port)?;
    if let Some(entry) = existing.as_ref() {
        if entry.fingerprint.eq_ignore_ascii_case(&cert.fingerprint) {
            // Pinned. Record whether this came from a clean chain or whether
            // the local store rescued an otherwise-invalid chain — diagnostics
            // surfaces the difference.
            set_last_verify_outcome(match &chain_status {
                ChainStatus::Valid => VerifyOutcome::ChainValid,
                ChainStatus::Invalid(message) => VerifyOutcome::TrustStorePinned {
                    chain_error: message.clone(),
                },
            });
            return Ok(());
        }
    }

    // `Ignore` is the user's explicit "don't ask, just trust" setting. We skip
    // the prompt entirely so the connection isn't gated on a UI handler that
    // may not exist (the previous behaviour was to emit a prompt event into
    // the void and then fail with `PromptTimeout` after 60s).
    // We deliberately do NOT pin the fingerprint here — `Ignore` means "every
    // time," not "trust on first use," so the cert isn't recorded.
    if matches!(validation_mode, ServerCertValidationMode::Ignore) {
        set_last_verify_outcome(VerifyOutcome::ValidationIgnored);
        return Ok(());
    }

    let prompt_payload = CertTrustPrompt {
        session_id: session_id.map(str::to_string),
        kind: if existing.is_some() {
            PromptKind::Changed
        } else {
            PromptKind::Unknown
        },
        host: cert.host.clone(),
        port: cert.port,
        fingerprint: cert.fingerprint.clone(),
        previous_fingerprint: existing.as_ref().map(|entry| entry.fingerprint.clone()),
        subject: cert.subject.clone(),
        issuer: cert.issuer.clone(),
        valid_from: cert.valid_from.clone(),
        valid_to: cert.valid_to.clone(),
        serial: cert.serial.clone(),
        signature_algorithm: cert.signature_algorithm.clone(),
        san: cert.san.clone(),
        pem: cert.pem.clone(),
        chain_valid: chain_status.is_valid(),
        validation_error: chain_status.validation_error(),
        timeout_secs: prompt_timeout.as_secs().max(1),
    };

    let decision = prompt(prompt_payload, prompt_timeout)?;
    if !decision.approve {
        return Err(CertTrustError::Rejected);
    }

    if decision.remember {
        store.remember(&cert, existing.as_ref())?;
    }

    set_last_verify_outcome(VerifyOutcome::UserApproved {
        remembered: decision.remember,
    });

    Ok(())
}

#[derive(Clone)]
pub struct SessionPromptContext {
    session_id: String,
    validation_mode: ServerCertValidationMode,
    prompt_timeout: Duration,
    event_emitter: DynEventEmitter,
}

impl SessionPromptContext {
    pub fn new(
        session_id: String,
        validation_mode: ServerCertValidationMode,
        prompt_timeout: Duration,
        event_emitter: DynEventEmitter,
    ) -> Self {
        Self {
            session_id,
            validation_mode,
            prompt_timeout,
            event_emitter,
        }
    }
}

thread_local! {
    static SESSION_CONTEXT: RefCell<Option<SessionPromptContext>> = RefCell::new(None);
    static HANDSHAKE_PORT: RefCell<Option<u16>> = RefCell::new(None);
    static LAST_VERIFY_OUTCOME: RefCell<Option<VerifyOutcome>> = RefCell::new(None);
}

/// Outcome of the most recent `evaluate_certificate_trust` call on this thread.
/// Diagnostics consumes this so it can distinguish "TLS passed because the
/// chain validates" from "TLS passed only because the user pinned the cert in
/// the local trust store" — the latter must be flagged as a partial pass.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum VerifyOutcome {
    /// Chain validated cleanly against system roots. No store override needed.
    ChainValid,
    /// Chain failed but the presented fingerprint matches a local trust-store
    /// entry. The connection proceeds, but compliance is partial.
    TrustStorePinned { chain_error: String },
    /// Validation mode is `Ignore`. The chain wasn't checked / a failure was
    /// silently accepted because the user opted out of validation entirely.
    ValidationIgnored,
    /// The user approved a prompt. May or may not be remembered.
    UserApproved { remembered: bool },
}

fn set_last_verify_outcome(outcome: VerifyOutcome) {
    LAST_VERIFY_OUTCOME.with(|slot| {
        slot.replace(Some(outcome));
    });
}

/// Reads and clears the most recent verification outcome. Diagnostics calls
/// this immediately after the TLS upgrade returns so each diagnostic step
/// observes a fresh result.
pub fn take_last_verify_outcome() -> Option<VerifyOutcome> {
    LAST_VERIFY_OUTCOME.with(|slot| slot.borrow_mut().take())
}

pub struct SessionPromptContextGuard {
    previous: Option<SessionPromptContext>,
}

impl Drop for SessionPromptContextGuard {
    fn drop(&mut self) {
        SESSION_CONTEXT.with(|slot| {
            slot.replace(self.previous.take());
        });
    }
}

pub fn bind_session_prompt_context(context: SessionPromptContext) -> SessionPromptContextGuard {
    let previous = SESSION_CONTEXT.with(|slot| slot.replace(Some(context)));
    SessionPromptContextGuard { previous }
}

pub struct TlsHandshakeContextGuard {
    previous_port: Option<u16>,
}

impl Drop for TlsHandshakeContextGuard {
    fn drop(&mut self) {
        HANDSHAKE_PORT.with(|slot| {
            slot.replace(self.previous_port.take());
        });
    }
}

pub fn enter_tls_handshake_context(port: u16) -> TlsHandshakeContextGuard {
    let previous_port = HANDSHAKE_PORT.with(|slot| slot.replace(Some(port)));
    TlsHandshakeContextGuard { previous_port }
}

pub(crate) fn current_tls_port() -> Option<u16> {
    HANDSHAKE_PORT.with(|slot| *slot.borrow())
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
struct PendingPromptKey {
    session_id: String,
    host: String,
    port: u16,
    fingerprint: String,
}

impl PendingPromptKey {
    fn from_prompt(prompt: &CertTrustPrompt) -> Result<Self, CertTrustError> {
        let session_id = prompt.session_id.clone().ok_or_else(|| {
            CertTrustError::PromptUnavailable(
                "certificate trust prompt is missing a session identifier".to_string(),
            )
        })?;

        Ok(Self {
            session_id,
            host: prompt.host.clone(),
            port: prompt.port,
            fingerprint: normalize_fingerprint(&prompt.fingerprint),
        })
    }
}

struct PendingPrompt {
    sender: mpsc::SyncSender<PromptDecision>,
}

#[derive(Default)]
struct RuntimeTrustState {
    store_path: Mutex<Option<PathBuf>>,
    pending: Mutex<HashMap<PendingPromptKey, PendingPrompt>>,
}

static RUNTIME_TRUST_STATE: OnceLock<RuntimeTrustState> = OnceLock::new();

fn runtime_state() -> &'static RuntimeTrustState {
    RUNTIME_TRUST_STATE.get_or_init(RuntimeTrustState::default)
}

pub fn initialize_store_path(app_data_dir: Option<PathBuf>) {
    let mut slot = runtime_state()
        .store_path
        .lock()
        .expect("certificate trust store path lock poisoned");
    *slot = Some(resolve_store_path(app_data_dir));
}

pub fn evaluate_presented_certificate(
    cert: PresentedCertificate,
    chain_status: ChainStatus,
) -> Result<(), CertTrustError> {
    let session_context = SESSION_CONTEXT.with(|slot| slot.borrow().clone());
    let validation_mode = session_context
        .as_ref()
        .map(|context| context.validation_mode)
        .unwrap_or(ServerCertValidationMode::Validate);
    let prompt_timeout = session_context
        .as_ref()
        .map(|context| context.prompt_timeout)
        .unwrap_or_else(default_prompt_timeout);
    let session_id = session_context.as_ref().map(|context| context.session_id.as_str());
    let store = current_store();

    evaluate_certificate_trust(
        &store,
        session_id,
        validation_mode,
        prompt_timeout,
        cert,
        chain_status,
        |prompt, timeout| {
            let context = session_context.as_ref().ok_or_else(|| {
                CertTrustError::PromptUnavailable(
                    "interactive certificate trust is unavailable for this TLS handshake"
                        .to_string(),
                )
            })?;

            runtime_state().dispatch_prompt(context, prompt, timeout)
        },
    )
}

pub fn submit_prompt_response(
    session_id: Option<String>,
    host: String,
    port: u16,
    fingerprint: String,
    approve: bool,
    remember: bool,
) -> Result<(), String> {
    runtime_state().respond_to_prompt(
        session_id,
        host,
        port,
        fingerprint,
        PromptDecision { approve, remember },
    )
}

impl RuntimeTrustState {
    fn dispatch_prompt(
        &self,
        context: &SessionPromptContext,
        prompt: CertTrustPrompt,
        timeout: Duration,
    ) -> Result<PromptDecision, CertTrustError> {
        let key = PendingPromptKey::from_prompt(&prompt)?;
        let (sender, receiver) = mpsc::sync_channel(1);

        {
            let mut pending = self
                .pending
                .lock()
                .expect("certificate trust pending-prompt lock poisoned");
            pending.insert(key.clone(), PendingPrompt { sender });
        }

        let event_name = match prompt.kind {
            PromptKind::Unknown => "rdp://cert-trust-prompt",
            PromptKind::Changed => "rdp://cert-trust-change",
        };
        let payload = serde_json::to_value(&prompt).unwrap_or_default();
        if let Err(error) = context.event_emitter.emit_event(event_name, payload) {
            self.pending
                .lock()
                .expect("certificate trust pending-prompt lock poisoned")
                .remove(&key);
            return Err(CertTrustError::Emit(error));
        }

        let decision = receiver.recv_timeout(timeout).map_err(|error| match error {
            mpsc::RecvTimeoutError::Timeout => CertTrustError::PromptTimeout,
            mpsc::RecvTimeoutError::Disconnected => CertTrustError::PromptUnavailable(
                "certificate trust prompt closed before a decision was received".to_string(),
            ),
        })?;

        self.pending
            .lock()
            .expect("certificate trust pending-prompt lock poisoned")
            .remove(&key);

        Ok(decision)
    }

    fn respond_to_prompt(
        &self,
        session_id: Option<String>,
        host: String,
        port: u16,
        fingerprint: String,
        decision: PromptDecision,
    ) -> Result<(), String> {
        let fingerprint = normalize_fingerprint(&fingerprint);

        let sender = {
            let pending = self
                .pending
                .lock()
                .expect("certificate trust pending-prompt lock poisoned");

            if let Some(session_id) = session_id {
                let key = PendingPromptKey {
                    session_id,
                    host,
                    port,
                    fingerprint,
                };

                pending
                    .get(&key)
                    .map(|prompt| prompt.sender.clone())
                    .ok_or_else(|| "No pending certificate trust prompt matched the response".to_string())?
            } else {
                let mut matches = pending
                    .iter()
                    .filter(|(key, _)| {
                        key.host == host && key.port == port && key.fingerprint == fingerprint
                    })
                    .map(|(_, prompt)| prompt.sender.clone());

                let first = matches.next().ok_or_else(|| {
                    "No pending certificate trust prompt matched the response".to_string()
                })?;
                if matches.next().is_some() {
                    return Err(
                        "Multiple pending certificate trust prompts matched; provide session_id"
                            .to_string(),
                    );
                }
                first
            }
        };

        sender
            .send(decision)
            .map_err(|_| "The pending certificate trust prompt is no longer waiting".to_string())
    }
}

fn current_store() -> CertTrustStore {
    let path = runtime_state()
        .store_path
        .lock()
        .expect("certificate trust store path lock poisoned")
        .clone()
        .unwrap_or_else(|| resolve_store_path(None));
    CertTrustStore::new(path)
}

fn resolve_store_path(app_data_dir: Option<PathBuf>) -> PathBuf {
    match app_data_dir {
        Some(path) => path.join("rdp-cert-trust.json"),
        None => dirs::data_local_dir()
            .unwrap_or_else(std::env::temp_dir)
            .join("sortOfRemoteNG")
            .join("rdp-cert-trust.json"),
    }
}

fn store_key(host: &str, port: u16) -> String {
    format!("{host}:{port}")
}

fn normalize_fingerprint(fingerprint: &str) -> String {
    fingerprint.trim().to_ascii_lowercase()
}