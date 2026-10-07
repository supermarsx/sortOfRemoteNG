//! Wire data for the trusted app shell, matching `types/protocols/originBrowser.ts`.
//!
//! Validation checks shape and bounds, NEVER authority. Native command owners
//! must verify the calling window, saved connection and source URL, protected
//! managed database revision/unlock session, consent and live attempt on use.
//! Routes, parent handles, proxy credentials and readiness reports stay native.
//! There is intentionally no conversion from a wire identity to BrowserIdentity
//! or NativeHostReadiness, and no command registration or host initialization.

use crate::control::ViewportBounds;
use serde::{de, Deserialize, Deserializer, Serialize};
use sorng_protocols::origin_browser::BrowserIdentity;
use std::fmt;
use url::Url;

pub const ORIGIN_BROWSER_STATE_EVENT: &str = "origin-browser-state";
pub const MAX_ID_BYTES: usize = 256;
pub const MAX_URL_BYTES: usize = 16_384;
pub const MAX_TITLE_UTF16: usize = 512;
pub const MAX_FIND_TEXT_BYTES: usize = 1024;

/// Chromium zoom levels are logarithmic: factor = 1.2 ^ level.
pub fn zoom_level_for_percent(percent: f64) -> Result<f64, OriginBrowserIpcError> {
    if !percent.is_finite() || !(25.0..=500.0).contains(&percent) {
        return Err(OriginBrowserIpcError::InvalidRequest);
    }
    Ok((percent / 100.0).ln() / 1.2_f64.ln())
}

pub fn validate_find_text(text: &str) -> Result<(), OriginBrowserIpcError> {
    if text.is_empty() || text.len() > MAX_FIND_TEXT_BYTES || text.contains('\0') {
        return Err(OriginBrowserIpcError::InvalidRequest);
    }
    Ok(())
}
pub const MAX_JS_INTEGER: u64 = 9_007_199_254_740_991;

/// Fixed error codes/messages only. Never retain a rejected value or parser
/// cause: unknown field names and malformed URLs may themselves contain secrets.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, thiserror::Error)]
#[serde(rename_all = "kebab-case")]
pub enum OriginBrowserIpcError {
    #[error("Browser request is invalid")]
    InvalidRequest,
    #[error("Browser owner identity is invalid")]
    InvalidOwner,
    #[error("Browser attempt identity is invalid")]
    InvalidAttempt,
    #[error("Browser request belongs to another owner or attempt")]
    IdentityMismatch,
    #[error("Managed database revision and unlock proof are required")]
    InvalidOwnerProof,
    #[error("Browser request correlation is invalid")]
    InvalidRequestId,
    #[error("Browser URL is invalid")]
    InvalidUrl,
    #[error("Browser viewport bounds are invalid")]
    InvalidBounds,
    #[error("Required browser policy is invalid")]
    InvalidPolicy,
    #[error("Browser presentation is invalid")]
    InvalidPresentation,
    #[error("Browser sequence is invalid")]
    InvalidSequence,
    #[error("Browser status is invalid")]
    InvalidStatus,
}

pub trait ValidateOriginBrowserRequest {
    fn validate(&self) -> Result<(), OriginBrowserIpcError>;
}

/// Use at the IPC decode boundary instead of exposing serde's error text.
/// The return value is structurally valid, not authorized to create/navigate.
pub fn decode_request<'de, T, D>(deserializer: D) -> Result<T, OriginBrowserIpcError>
where
    T: Deserialize<'de> + ValidateOriginBrowserRequest,
    D: Deserializer<'de>,
{
    let request =
        T::deserialize(deserializer).map_err(|_| OriginBrowserIpcError::InvalidRequest)?;
    request.validate()?;
    Ok(request)
}

/// Optional whole-invoke envelope; rejects attempts to pass authority beside
/// `request` as well as inside it. Tauri command handlers may accept T directly.
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OriginBrowserInvokeRequest<T> {
    pub request: T,
}

impl<T: ValidateOriginBrowserRequest> OriginBrowserInvokeRequest<T> {
    pub fn validate(&self) -> Result<(), OriginBrowserIpcError> {
        self.request.validate()
    }
}

impl<T: ValidateOriginBrowserRequest> ValidateOriginBrowserRequest
    for OriginBrowserInvokeRequest<T>
{
    fn validate(&self) -> Result<(), OriginBrowserIpcError> {
        self.validate()
    }
}

struct BoundedString<const LIMIT: usize>;

impl<'de, const LIMIT: usize> de::Visitor<'de> for BoundedString<LIMIT> {
    type Value = String;

    fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("a bounded browser string")
    }

    fn visit_str<E: de::Error>(self, value: &str) -> Result<String, E> {
        if value.len() > LIMIT {
            return Err(E::custom("Browser string exceeds its limit"));
        }
        Ok(value.to_owned())
    }

    fn visit_string<E: de::Error>(self, value: String) -> Result<String, E> {
        if value.len() > LIMIT {
            return Err(E::custom("Browser string exceeds its limit"));
        }
        Ok(value)
    }
}

fn deserialize_id<'de, D: Deserializer<'de>>(deserializer: D) -> Result<String, D::Error> {
    deserializer.deserialize_str(BoundedString::<MAX_ID_BYTES>)
}

fn deserialize_url<'de, D: Deserializer<'de>>(deserializer: D) -> Result<String, D::Error> {
    deserializer.deserialize_str(BoundedString::<MAX_URL_BYTES>)
}

fn deserialize_find_text<'de, D: Deserializer<'de>>(deserializer: D) -> Result<String, D::Error> {
    deserializer.deserialize_str(BoundedString::<MAX_FIND_TEXT_BYTES>)
}

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_ID_BYTES
        && !value.chars().any(|c| c.is_control() || c.is_whitespace())
}

fn validate_sequence(value: u64) -> Result<(), OriginBrowserIpcError> {
    if value > MAX_JS_INTEGER {
        Err(OriginBrowserIpcError::InvalidSequence)
    } else {
        Ok(())
    }
}

fn http_url(value: &str) -> Result<Url, OriginBrowserIpcError> {
    if value.is_empty()
        || value.len() > MAX_URL_BYTES
        || !(value.starts_with("http://") || value.starts_with("https://"))
        || value.trim() != value
        || value.chars().any(char::is_control)
        || value.contains('\\')
    {
        return Err(OriginBrowserIpcError::InvalidUrl);
    }
    let parsed = Url::parse(value).map_err(|_| OriginBrowserIpcError::InvalidUrl)?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err(OriginBrowserIpcError::InvalidUrl);
    }
    Ok(parsed)
}

fn validate_navigation_url(value: &str) -> Result<(), OriginBrowserIpcError> {
    let parsed = http_url(value)?;
    if !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.as_str().len() > MAX_URL_BYTES
    {
        return Err(OriginBrowserIpcError::InvalidUrl);
    }
    Ok(())
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OriginBrowserOwner {
    #[serde(deserialize_with = "deserialize_id")]
    pub owner_database_id: String,
    #[serde(deserialize_with = "deserialize_id")]
    pub connection_id: String,
    #[serde(deserialize_with = "deserialize_id")]
    pub session_id: String,
}

impl OriginBrowserOwner {
    pub fn validate(&self) -> Result<(), OriginBrowserIpcError> {
        if [
            &self.owner_database_id,
            &self.connection_id,
            &self.session_id,
        ]
        .into_iter()
        .all(|value| valid_id(value))
        {
            Ok(())
        } else {
            Err(OriginBrowserIpcError::InvalidOwner)
        }
    }

    pub fn matches_native(&self, identity: &BrowserIdentity) -> bool {
        self.owner_database_id == identity.owner_database_id()
            && self.connection_id == identity.connection_id()
            && self.session_id == identity.session_id()
    }
}

/// A reference to an already allocated attempt, not a renderer allocation API.
/// Do not flatten owner here: serde flatten conflicts with deny_unknown_fields.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OriginBrowserIdentity {
    #[serde(deserialize_with = "deserialize_id")]
    pub owner_database_id: String,
    #[serde(deserialize_with = "deserialize_id")]
    pub connection_id: String,
    #[serde(deserialize_with = "deserialize_id")]
    pub session_id: String,
    #[serde(deserialize_with = "deserialize_id")]
    pub attempt_id: String,
}

impl OriginBrowserIdentity {
    pub fn from_native(identity: &BrowserIdentity) -> Self {
        Self {
            owner_database_id: identity.owner_database_id().to_owned(),
            connection_id: identity.connection_id().to_owned(),
            session_id: identity.session_id().to_owned(),
            attempt_id: identity.attempt_id().to_string(),
        }
    }

    pub fn owner(&self) -> OriginBrowserOwner {
        OriginBrowserOwner {
            owner_database_id: self.owner_database_id.clone(),
            connection_id: self.connection_id.clone(),
            session_id: self.session_id.clone(),
        }
    }

    pub fn validate(&self) -> Result<(), OriginBrowserIpcError> {
        if ![
            &self.owner_database_id,
            &self.connection_id,
            &self.session_id,
        ]
        .into_iter()
        .all(|value| valid_id(value))
        {
            return Err(OriginBrowserIpcError::InvalidOwner);
        }
        // Native UUID Display uses this canonical form. The nil UUID cannot
        // identify an allocated attempt. No UUID is created from requestId.
        let bytes = self.attempt_id.as_bytes();
        if bytes.len() != 36
            || bytes.iter().enumerate().any(|(index, byte)| {
                if matches!(index, 8 | 13 | 18 | 23) {
                    *byte != b'-'
                } else {
                    !matches!(byte, b'0'..=b'9' | b'a'..=b'f')
                }
            })
            || self.attempt_id == "00000000-0000-0000-0000-000000000000"
        {
            return Err(OriginBrowserIpcError::InvalidAttempt);
        }
        Ok(())
    }

    /// Comparison only. The registry must still check the current owner grant,
    /// revocation and permissions immediately before acting on the host.
    pub fn validate_matches(&self, native: &BrowserIdentity) -> Result<(), OriginBrowserIpcError> {
        self.validate()?;
        if !self.owner().matches_native(native)
            || self.attempt_id != native.attempt_id().to_string()
        {
            return Err(OriginBrowserIpcError::IdentityMismatch);
        }
        Ok(())
    }
}

#[derive(Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OriginBrowserBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl OriginBrowserBounds {
    pub fn validate(&self) -> Result<(), OriginBrowserIpcError> {
        self.to_native().map(|_| ())
    }

    pub fn to_native(&self) -> Result<ViewportBounds, OriginBrowserIpcError> {
        ViewportBounds::new(self.x, self.y, self.width, self.height)
            .map_err(|_| OriginBrowserIpcError::InvalidBounds)
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum OriginBrowserConsent {
    Required {},
    ExistingGrant {
        #[serde(deserialize_with = "deserialize_id")]
        grant_id: String,
    },
}

impl OriginBrowserConsent {
    pub fn validate(&self) -> Result<(), OriginBrowserIpcError> {
        match self {
            Self::Required {} => Ok(()),
            Self::ExistingGrant { grant_id } if valid_id(grant_id) => Ok(()),
            _ => Err(OriginBrowserIpcError::InvalidPolicy),
        }
    }
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum OriginBrowserDarkMode {
    Forced,
}

impl<'de> Deserialize<'de> for OriginBrowserDarkMode {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        // A derived externally tagged unit enum would also accept
        // {"forced":null}; the renderer contract requires the literal string.
        match deserialize_id(deserializer)?.as_str() {
            "forced" => Ok(Self::Forced),
            _ => Err(de::Error::custom("Required browser policy is invalid")),
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OriginBrowserAutoLogin {
    pub enabled: bool,
    pub consent: OriginBrowserConsent,
}

impl OriginBrowserAutoLogin {
    pub fn validate(&self) -> Result<(), OriginBrowserIpcError> {
        if !self.enabled {
            return Err(OriginBrowserIpcError::InvalidPolicy);
        }
        self.consent.validate()
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OriginBrowserPolicy {
    pub dark_mode: OriginBrowserDarkMode,
    pub auto_login: OriginBrowserAutoLogin,
}

impl OriginBrowserPolicy {
    pub fn validate(&self) -> Result<(), OriginBrowserIpcError> {
        self.auto_login.validate()
    }
}

// Sensitive requests deliberately have no Debug implementation.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OriginBrowserCreateRequest {
    pub owner: OriginBrowserOwner,
    #[serde(deserialize_with = "deserialize_id")]
    pub expected_security_revision: String,
    #[serde(deserialize_with = "deserialize_id")]
    pub source_session_id: String,
    #[serde(deserialize_with = "deserialize_id")]
    pub request_id: String,
    #[serde(deserialize_with = "deserialize_url")]
    pub initial_url: String,
    pub bounds: OriginBrowserBounds,
    pub visible: bool,
    pub policy: OriginBrowserPolicy,
}

impl OriginBrowserCreateRequest {
    pub fn validate(&self) -> Result<(), OriginBrowserIpcError> {
        self.owner.validate()?;
        if !valid_id(&self.expected_security_revision) || !valid_id(&self.source_session_id) {
            return Err(OriginBrowserIpcError::InvalidOwnerProof);
        }
        if !valid_id(&self.request_id) {
            return Err(OriginBrowserIpcError::InvalidRequestId);
        }
        validate_navigation_url(&self.initial_url)?;
        self.bounds.validate()?;
        if self.visible {
            return Err(OriginBrowserIpcError::InvalidPresentation);
        }
        self.policy.validate()
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OriginBrowserNavigateRequest {
    pub identity: OriginBrowserIdentity,
    #[serde(deserialize_with = "deserialize_url")]
    pub url: String,
}

impl OriginBrowserNavigateRequest {
    pub fn validate(&self) -> Result<(), OriginBrowserIpcError> {
        self.identity.validate()?;
        validate_navigation_url(&self.url)
    }
}

fn deserialize_nullable_bounds<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<OriginBrowserBounds>, D::Error> {
    Option::deserialize(deserializer)
}

#[derive(Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum OriginBrowserAction {
    Zoom {
        percent: f64,
        presentation_revision: u64,
    },
    Find {
        #[serde(deserialize_with = "deserialize_find_text")]
        text: String,
        forward: bool,
        match_case: bool,
        find_next: bool,
        presentation_revision: u64,
    },
    StopFind {
        clear_selection: bool,
        presentation_revision: u64,
    },
    Presentation {
        revision: u64,
        #[serde(deserialize_with = "deserialize_nullable_bounds")]
        bounds: Option<OriginBrowserBounds>,
        visible: bool,
    },
    Focus {
        presentation_revision: u64,
    },
    Back {},
    Forward {},
    Reload {},
    Stop {},
}

impl OriginBrowserAction {
    pub fn validate(&self) -> Result<(), OriginBrowserIpcError> {
        match self {
            Self::Zoom { percent, .. } => {
                zoom_level_for_percent(*percent)?;
            }
            Self::Find { text, .. } => validate_find_text(text)?,
            _ => {}
        }
        match self {
            Self::Presentation {
                revision,
                bounds,
                visible,
            } => {
                validate_sequence(*revision)?;
                if *revision == 0 || (*visible && bounds.is_none()) {
                    return Err(OriginBrowserIpcError::InvalidPresentation);
                }
                if let Some(bounds) = bounds {
                    bounds.validate()?;
                }
                Ok(())
            }
            Self::Focus {
                presentation_revision,
            }
            | Self::Zoom {
                presentation_revision,
                ..
            }
            | Self::Find {
                presentation_revision,
                ..
            }
            | Self::StopFind {
                presentation_revision,
                ..
            } => {
                validate_sequence(*presentation_revision)?;
                if *presentation_revision == 0 {
                    return Err(OriginBrowserIpcError::InvalidPresentation);
                }
                Ok(())
            }
            Self::Back {} | Self::Forward {} | Self::Reload {} | Self::Stop {} => Ok(()),
        }
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OriginBrowserControlRequest {
    pub identity: OriginBrowserIdentity,
    pub action: OriginBrowserAction,
}

impl OriginBrowserControlRequest {
    pub fn validate(&self) -> Result<(), OriginBrowserIpcError> {
        self.identity.validate()?;
        self.action.validate()
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OriginBrowserCloseRequest {
    pub identity: OriginBrowserIdentity,
}

/// Saved native consent and the current document receipt are checked again
/// when dispatched. This envelope carries no permission grants.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OriginBrowserAutomationRequest {
    pub identity: OriginBrowserIdentity,
    pub operation: crate::native_automation::NativeAutomationAction,
}

impl OriginBrowserAutomationRequest {
    pub fn validate(&self) -> Result<(), OriginBrowserIpcError> {
        self.identity.validate()
    }
}

impl OriginBrowserCloseRequest {
    pub fn validate(&self) -> Result<(), OriginBrowserIpcError> {
        self.identity.validate()
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OriginBrowserStatusRequest {
    pub owner: OriginBrowserOwner,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub identity: Option<OriginBrowserIdentity>,
}

impl OriginBrowserStatusRequest {
    pub fn validate(&self) -> Result<(), OriginBrowserIpcError> {
        self.owner.validate()?;
        if let Some(identity) = &self.identity {
            identity.validate()?;
            if identity.owner() != self.owner {
                return Err(OriginBrowserIpcError::IdentityMismatch);
            }
        }
        Ok(())
    }
}

macro_rules! validate_requests {
    ($($request:ty),+ $(,)?) => { $(
        impl ValidateOriginBrowserRequest for $request {
            fn validate(&self) -> Result<(), OriginBrowserIpcError> { self.validate() }
        }
    )+ };
}

validate_requests!(
    OriginBrowserOwner,
    OriginBrowserIdentity,
    OriginBrowserBounds,
    OriginBrowserConsent,
    OriginBrowserAutoLogin,
    OriginBrowserPolicy,
    OriginBrowserCreateRequest,
    OriginBrowserNavigateRequest,
    OriginBrowserAction,
    OriginBrowserControlRequest,
    OriginBrowserCloseRequest,
    OriginBrowserAutomationRequest,
    OriginBrowserStatusRequest,
);

// Output-only types. In particular these cannot be submitted to claim native
// capabilities, installed policy, an authenticated page or transport readiness.
#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum OriginBrowserUnavailableReason {
    RuntimeMissing,
    PlatformUnsupported,
    ContainmentUnverified,
    PolicyUnavailable,
    OwnerUnavailable,
    HostUnavailable,
}

#[derive(Clone, Copy, Serialize)]
#[serde(tag = "availability", rename_all = "kebab-case")]
pub enum OriginBrowserCapability {
    /// Only trusted native acceptance of all required policies can report this.
    /// This wire value is not NativeHostReadiness and cannot grant admission.
    Available,
    Unavailable {
        reason: OriginBrowserUnavailableReason,
    },
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum OriginBrowserPhase {
    Starting,
    Attached,
    Closing,
    Closed,
    Failed,
}

/// Input from a native host callback, never IPC. Values are validated/bounded
/// before owner-window output. Full URLs are address-bar state, not diagnostics.
pub struct OriginBrowserPageState<'a> {
    pub url: &'a str,
    pub title: &'a str,
    pub loading: bool,
    pub can_go_back: bool,
    pub can_go_forward: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OriginBrowserSnapshot {
    identity: OriginBrowserIdentity,
    sequence: u64,
    phase: OriginBrowserPhase,
    /// Only the trusted owning window receives this address-bar value. Never
    /// log/persist this object or use current_url in diagnostic reports.
    current_url: String,
    display_url: String,
    title: String,
    loading: bool,
    can_go_back: bool,
    can_go_forward: bool,
}

impl OriginBrowserSnapshot {
    pub fn new(
        identity: &BrowserIdentity,
        sequence: u64,
        phase: OriginBrowserPhase,
        page: OriginBrowserPageState<'_>,
    ) -> Result<Self, OriginBrowserIpcError> {
        validate_sequence(sequence)?;
        let identity = OriginBrowserIdentity::from_native(identity);
        identity.validate()?;
        let (current_url, display_url) = if page.url.is_empty() {
            (String::new(), String::new())
        } else {
            let mut url = http_url(page.url)?;
            // Navigation and address-bar state reject URL credentials; never
            // display a credential-bearing URI even from a host callback.
            if !url.username().is_empty() || url.password().is_some() {
                return Err(OriginBrowserIpcError::InvalidUrl);
            }
            let current = url.to_string();
            if current.len() > MAX_URL_BYTES {
                return Err(OriginBrowserIpcError::InvalidUrl);
            }
            url.set_username("")
                .map_err(|_| OriginBrowserIpcError::InvalidUrl)?;
            url.set_password(None)
                .map_err(|_| OriginBrowserIpcError::InvalidUrl)?;
            url.set_query(None);
            url.set_fragment(None);
            let safe = url.to_string();
            if safe.len() > MAX_URL_BYTES {
                return Err(OriginBrowserIpcError::InvalidUrl);
            }
            (current, safe)
        };
        // Bound both traversal and allocation, preserving whole Unicode chars.
        let mut title = String::new();
        let mut units = 0;
        for character in page.title.chars().take(MAX_TITLE_UTF16 * 2) {
            if character.is_control() {
                continue;
            }
            units += character.len_utf16();
            if units > MAX_TITLE_UTF16 {
                break;
            }
            title.push(character);
        }
        Ok(Self {
            identity,
            sequence,
            phase,
            current_url,
            display_url,
            title,
            loading: page.loading,
            can_go_back: page.can_go_back,
            can_go_forward: page.can_go_forward,
        })
    }

    pub fn identity(&self) -> &OriginBrowserIdentity {
        &self.identity
    }

    pub fn sequence(&self) -> u64 {
        self.sequence
    }

    /// Retain identity, lifecycle and ordering, but remove owner-private page
    /// data and activity when the native owner is no longer authorized.
    /// This is logical scrubbing for retention/serialization, not zeroization.
    pub fn scrub_page_state(&mut self) {
        self.current_url.clear();
        self.display_url.clear();
        self.title.clear();
        self.loading = false;
        self.can_go_back = false;
        self.can_go_forward = false;
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OriginBrowserCreateResult {
    request_id: String,
    snapshot: OriginBrowserSnapshot,
}

impl OriginBrowserCreateResult {
    pub fn new(
        request_id: &str,
        snapshot: OriginBrowserSnapshot,
    ) -> Result<Self, OriginBrowserIpcError> {
        if !valid_id(request_id) {
            return Err(OriginBrowserIpcError::InvalidRequestId);
        }
        Ok(Self {
            request_id: request_id.to_owned(),
            snapshot,
        })
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OriginBrowserStatusResult {
    capability: OriginBrowserCapability,
    snapshot: Option<OriginBrowserSnapshot>,
}

impl OriginBrowserStatusResult {
    /// Default/unsupported paths must be explicit, with no fallback selection.
    pub fn unavailable(reason: OriginBrowserUnavailableReason) -> Self {
        Self {
            capability: OriginBrowserCapability::Unavailable { reason },
            snapshot: None,
        }
    }

    /// This is output formatting, not host validation. The caller must first
    /// establish native platform/policy acceptance for the requested owner.
    pub fn from_native(
        request: &OriginBrowserStatusRequest,
        capability: OriginBrowserCapability,
        snapshot: Option<OriginBrowserSnapshot>,
    ) -> Result<Self, OriginBrowserIpcError> {
        request.validate()?;
        match (&capability, &request.identity, &snapshot) {
            (OriginBrowserCapability::Unavailable { .. }, _, Some(_)) => {
                return Err(OriginBrowserIpcError::InvalidStatus);
            }
            (_, Some(expected), Some(actual)) if expected != actual.identity() => {
                return Err(OriginBrowserIpcError::IdentityMismatch);
            }
            (_, None, Some(_)) => return Err(OriginBrowserIpcError::InvalidStatus),
            _ => {}
        }
        Ok(Self {
            capability,
            snapshot,
        })
    }
}

impl Default for OriginBrowserStatusResult {
    fn default() -> Self {
        Self::unavailable(OriginBrowserUnavailableReason::HostUnavailable)
    }
}
