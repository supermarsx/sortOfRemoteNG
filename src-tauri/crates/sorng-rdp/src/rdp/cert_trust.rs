use std::cell::RefCell;
use std::collections::HashMap;
use std::fmt;
use std::sync::{mpsc, Mutex, OnceLock};
use std::time::Duration;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use sorng_core::events::DynEventEmitter;
use sorng_storage::trust_store::{self, CertIdentity, Identity, SyncTrustStore, TrustRecord};

use super::session_state::FailureClass;
use super::settings::RdpSettingsPayload;

const DEFAULT_CERT_PROMPT_TIMEOUT_SECS: u64 = 60;

/// Trust Center record type for RDP server certificates. Shares the store
/// with the frontend's `rdp` records and with the migration seed that reads
/// the retired sidecar.
const RDP_RECORD_TYPE: &str = "rdp";

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
            .map(Self::from_value)
            .unwrap_or(Self::Validate)
    }

    pub fn from_value(value: &str) -> Self {
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
    /// The Trust Center holds a revoked record for this host. Revocation is
    /// a deliberate user decision, so it is never silently re-approved here —
    /// the record has to be reinstated in the Trust Center first.
    Revoked(String),
    Store(String),
    Emit(String),
}

impl CertTrustError {
    pub fn lifecycle_failure_class(&self) -> FailureClass {
        FailureClass::TrustRejected
    }

    pub fn lifecycle_summary(&self) -> SecurityLifecycleSummary {
        SecurityLifecycleSummary::failure(
            match self {
                Self::InvalidChain(_) => "invalid_chain",
                Self::Rejected => "user_rejected",
                Self::PromptTimeout => "prompt_timeout",
                Self::PromptUnavailable(_) => "prompt_unavailable",
                Self::Revoked(_) => "trust_revoked",
                Self::Store(_) => "trust_store_error",
                Self::Emit(_) => "prompt_emit_error",
            },
            self.lifecycle_failure_class(),
        )
    }
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
            Self::Revoked(host) => write!(
                f,
                "the certificate trust record for {host} is revoked in the Trust Center; \
                 reinstate it there before connecting again"
            ),
            Self::Store(message) => write!(f, "certificate trust store error: {message}"),
            Self::Emit(message) => write!(f, "failed to emit certificate trust prompt: {message}"),
        }
    }
}

impl std::error::Error for CertTrustError {}

/// RDP's view of the Trust Center.
///
/// Server-certificate decisions used to live in a private plaintext
/// `<app_data>/rdp-cert-trust.json` sidecar that nothing else could see —
/// the frontend wrote a second, independent `rdp` record into the Trust
/// Center after every prompt, and the two could disagree. This is now a thin
/// adapter over [`SyncTrustStore::shared`]: one record per `host:port` of
/// type `rdp` in the active database's `databases/<id>.trust.json`, written
/// through the same SDBF ladder and P4 envelope as the database itself.
///
/// Consequences worth knowing:
/// - Trust is **per database**. A host pinned in one database is unknown in
///   another (export/import moves records between them).
/// - With no active database — locked or closed — every lookup and every
///   write fails closed rather than falling back to a local file.
/// - Records revoked in the Trust Center are refused, not re-prompted.
#[derive(Clone)]
pub struct CertTrustStore {
    store: SyncTrustStore,
}

impl Default for CertTrustStore {
    fn default() -> Self {
        Self::shared()
    }
}

impl fmt::Debug for CertTrustStore {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("CertTrustStore").finish_non_exhaustive()
    }
}

impl CertTrustStore {
    /// The Trust Center store for the currently active database.
    pub fn shared() -> Self {
        Self {
            store: SyncTrustStore::shared(),
        }
    }

    pub fn lookup(&self, host: &str, port: u16) -> Result<Option<CertTrustEntry>, CertTrustError> {
        let key = store_key(host, port);
        let document = trust_store::runtime()
            .and_then(|runtime| runtime.export(None))
            .map_err(CertTrustError::Store)?;

        let Some(record) = document
            .records
            .into_iter()
            .find(|record| record.record_type == RDP_RECORD_TYPE && record.host == key)
        else {
            return Ok(None);
        };

        if record.revoked {
            return Err(CertTrustError::Revoked(key));
        }

        entry_from_record(host, port, &record).map(Some)
    }

    pub fn remember(
        &self,
        cert: &PresentedCertificate,
        previous: Option<&CertTrustEntry>,
    ) -> Result<CertTrustEntry, CertTrustError> {
        let entry = CertTrustEntry::from_presented(
            cert,
            previous.map(|existing| existing.first_seen.clone()),
        );

        self.store
            .trust_identity_blocking(
                store_key(&cert.host, cert.port),
                RDP_RECORD_TYPE.to_string(),
                Identity::Tls(Box::new(identity_from_entry(&entry))),
                true,
            )
            .map_err(CertTrustError::Store)?;

        Ok(entry)
    }
}

/// Project a Trust Center record back into the flat shape the RDP prompt
/// plumbing works with. An `rdp` record carrying an SSH identity is corrupt
/// (or hand-edited) and fails closed rather than being treated as unknown.
fn entry_from_record(
    host: &str,
    port: u16,
    record: &TrustRecord,
) -> Result<CertTrustEntry, CertTrustError> {
    let Identity::Tls(cert) = &record.identity else {
        return Err(CertTrustError::Store(format!(
            "trust record for {}:{} is not a certificate identity",
            host, port
        )));
    };

    Ok(CertTrustEntry {
        host: host.to_string(),
        port,
        fingerprint: cert.fingerprint.clone(),
        subject: cert.subject.clone().unwrap_or_default(),
        issuer: cert.issuer.clone().unwrap_or_default(),
        valid_from: cert.valid_from.clone().unwrap_or_default(),
        valid_to: cert.valid_to.clone().unwrap_or_default(),
        serial: cert.serial.clone().unwrap_or_default(),
        signature_algorithm: cert.signature_algorithm.clone().unwrap_or_default(),
        san: cert.san.clone().unwrap_or_default(),
        pem: cert.pem.clone().unwrap_or_default(),
        first_seen: cert.first_seen.clone(),
        last_seen: cert.last_seen.clone(),
        // The identity is only rewritten when the user approves it, so its
        // `last_seen` is exactly the moment of the last approval.
        last_approved_at: cert.last_seen.clone(),
    })
}

fn identity_from_entry(entry: &CertTrustEntry) -> CertIdentity {
    let non_empty = |value: &str| {
        if value.is_empty() {
            None
        } else {
            Some(value.to_string())
        }
    };

    CertIdentity {
        fingerprint: entry.fingerprint.clone(),
        subject: non_empty(&entry.subject),
        issuer: non_empty(&entry.issuer),
        first_seen: entry.first_seen.clone(),
        last_seen: entry.last_seen.clone(),
        valid_from: non_empty(&entry.valid_from),
        valid_to: non_empty(&entry.valid_to),
        pem: non_empty(&entry.pem),
        serial: non_empty(&entry.serial),
        signature_algorithm: non_empty(&entry.signature_algorithm),
        san: if entry.san.is_empty() {
            None
        } else {
            Some(entry.san.clone())
        },
        chain_fingerprints: Vec::new(),
        subject_cn: None,
        subject_org: None,
        subject_ou: None,
        subject_country: None,
        subject_state: None,
        subject_locality: None,
        subject_email: None,
        issuer_cn: None,
        issuer_org: None,
        issuer_country: None,
        key_algorithm: None,
        key_size: None,
        version: None,
        chain: None,
    }
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
    static SESSION_CONTEXT: RefCell<Option<SessionPromptContext>> = const { RefCell::new(None) };
    static HANDSHAKE_PORT: RefCell<Option<u16>> = const { RefCell::new(None) };
    static LAST_VERIFY_OUTCOME: RefCell<Option<VerifyOutcome>> = const { RefCell::new(None) };
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

impl VerifyOutcome {
    pub fn lifecycle_summary(&self) -> SecurityLifecycleSummary {
        match self {
            Self::ChainValid => {
                SecurityLifecycleSummary::trust_success("chain_valid", "system_roots", true, None)
            }
            Self::TrustStorePinned { .. } => SecurityLifecycleSummary::trust_success(
                "trust_store_pinned",
                "local_trust_store",
                false,
                None,
            ),
            Self::ValidationIgnored => SecurityLifecycleSummary::trust_success(
                "validation_ignored",
                "validation_disabled",
                false,
                None,
            ),
            Self::UserApproved { remembered } => SecurityLifecycleSummary::trust_success(
                "user_approved",
                "user_decision",
                false,
                Some(*remembered),
            ),
        }
    }
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SecurityLifecycleSummary {
    pub outcome: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_class: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trust_source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chain_valid: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remembered: Option<bool>,
}

impl SecurityLifecycleSummary {
    fn trust_success(
        outcome: &str,
        trust_source: &str,
        chain_valid: bool,
        remembered: Option<bool>,
    ) -> Self {
        Self {
            outcome: outcome.to_string(),
            failure_class: None,
            trust_source: Some(trust_source.to_string()),
            chain_valid: Some(chain_valid),
            remembered,
        }
    }

    fn failure(outcome: &str, failure_class: FailureClass) -> Self {
        Self {
            outcome: outcome.to_string(),
            failure_class: Some(failure_class.as_str().to_string()),
            trust_source: None,
            chain_valid: None,
            remembered: None,
        }
    }
}

pub fn classify_security_error_for_lifecycle(message: &str) -> FailureClass {
    let lower = message.to_ascii_lowercase();

    if lower.contains("certificate")
        || lower.contains("cert trust")
        || lower.contains("trust prompt")
        || lower.contains("unknownissuer")
        || lower.contains("unknown issuer")
        || lower.contains("notvalidforname")
        || lower.contains("not valid for name")
    {
        return FailureClass::TrustRejected;
    }

    if lower.contains("credssp")
        || lower.contains("nla")
        || lower.contains("invalidtoken")
        || lower.contains("access denied")
        || lower.contains("empty identity")
        || lower.contains("credential")
        || lower.contains("authentication")
        || lower.contains("password")
    {
        return FailureClass::AuthRejected;
    }

    if lower.contains("timed out")
        || lower.contains("timeout")
        || lower.contains("10054")
        || lower.contains("forcibly closed")
        || lower.contains("connection reset")
    {
        return FailureClass::NetworkTransient;
    }

    FailureClass::ProtocolViolation
}

pub fn security_error_lifecycle_summary(message: &str) -> SecurityLifecycleSummary {
    let failure_class = classify_security_error_for_lifecycle(message);
    SecurityLifecycleSummary::failure(failure_class.as_str(), failure_class)
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
    pending: Mutex<HashMap<PendingPromptKey, PendingPrompt>>,
}

static RUNTIME_TRUST_STATE: OnceLock<RuntimeTrustState> = OnceLock::new();

fn runtime_state() -> &'static RuntimeTrustState {
    RUNTIME_TRUST_STATE.get_or_init(RuntimeTrustState::default)
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
    let session_id = session_context
        .as_ref()
        .map(|context| context.session_id.as_str());
    let store = CertTrustStore::shared();

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

        let decision = receiver
            .recv_timeout(timeout)
            .map_err(|error| match error {
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
                    .ok_or_else(|| {
                        "No pending certificate trust prompt matched the response".to_string()
                    })?
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

fn store_key(host: &str, port: u16) -> String {
    format!("{host}:{port}")
}

fn normalize_fingerprint(fingerprint: &str) -> String {
    fingerprint.trim().to_ascii_lowercase()
}
