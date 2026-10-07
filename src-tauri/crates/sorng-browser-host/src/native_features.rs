//! Native owner contract for website login. Network grants are never consent.
//! Nothing here is deserializable or exposed as a remote-page IPC API.

use sorng_protocols::origin_browser::BrowserIdentity;
use std::collections::HashSet;
use std::time::Instant;

#[path = "native_login_profiles.rs"]
pub mod login_profiles;

pub const MAX_CREDENTIAL_BYTES: usize = 4096;

/// Fixed for the lifetime of a private native request context. Error callbacks
/// alone cannot enforce pins/TOFU for valid certificates, so those modes are
/// represented explicitly but rejected at host creation, never downgraded.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum NativeCertificatePolicy {
    #[default]
    Strict,
    PromptInvalidCertificate,
    Pinned,
    TrustOnFirstUse,
}

impl NativeCertificatePolicy {
    pub fn supported(self) -> bool {
        matches!(self, Self::Strict | Self::PromptInvalidCertificate)
    }
}

/// Native authority only. No page-provided names, URL paths or trust verdicts.
/// Authority must show the native origin/error/certificate and require an
/// explicit fresh decision. Never serialize DER into general diagnostics.
pub struct NativeCertificateChallenge {
    pub identity: BrowserIdentity,
    pub request_id: u64,
    pub origin: String,
    pub error_code: i32,
    pub certificate_status: u32,
    pub leaf_der: Vec<u8>,
    pub expires_at: Instant,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NativeCertificateDecision {
    Deny,
    /// CEF may cache the exception in this attempt's private request context.
    /// This is NOT a persistent pin, TOFU record, or global trust-store edit.
    AllowForAttempt,
}

/// Denied native capability observations, not grants or prompts. The owner may
/// offer a separately authorized workflow; no browser default is enabled.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NativeCapabilityKind {
    Popup,
    Download,
    Media { requested: u32 },
    Permission { requested: u32 },
}

pub struct NativeCapabilityRequest {
    pub identity: BrowserIdentity,
    pub origin: Option<String>,
    pub target_origin: Option<String>,
    pub kind: NativeCapabilityKind,
    /// None when CEF does not supply a reliable gesture signal.
    pub user_gesture: Option<bool>,
}
pub(crate) const FEATURE_PROTOCOL_PIN: &str = "cef154.3.0/native-features-v4";

/// Explicit saved-application selection; never infer a generic fallback from
/// missing/unknown metadata. Custom selectors/options and multi-step providers
/// still require their own reviewed native adapter.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum NativeLoginAdapter {
    #[default]
    Unsupported,
    /// Explicit native-owner selection for manual/no-auto-login connections.
    /// Feature installation is required, but no credential stage is allowed.
    Manual,
    Generic,
    /// Selected only after native saved-profile configuration validation.
    ModularForm,
    Porkbun,
    Google,
    Bitwarden,
    Synology,
    Cloudflare,
    Yealink,
    Adobe,
    ChatGpt,
    Claude,
    ExchangeEcp,
    ExchangeOwa,
    VodafoneSmartRouter,
}

impl NativeLoginAdapter {
    /// Registry must also reject unsupported saved selector/advanced options;
    /// this maps only the application's default reviewed form contract.
    pub fn from_application_id(id: &str) -> Self {
        match id {
            "generic-form" => Self::Generic,
            "porkbun" => Self::Porkbun,
            "exchange-ecp" => Self::ExchangeEcp,
            "exchange-owa" => Self::ExchangeOwa,
            "vodafone-smart-router-3" => Self::VodafoneSmartRouter,
            "bitwarden-self-hosted" | "vaultwarden" => Self::Bitwarden,
            "synology-dsm" => Self::Synology,
            "cloudflare" => Self::Cloudflare,
            "voip-phone" => Self::Yealink,
            "adobe-admin-console" => Self::Adobe,
            "chatgpt" => Self::ChatGpt,
            "claude" => Self::Claude,
            "google-account"
            | "google-cloud-console"
            | "google-analytics"
            | "google-tag-manager"
            | "google-business-profile"
            | "google-search-console"
            | "google-ads"
            | "google-ad-manager"
            | "google-adsense"
            | "google-forms"
            | "google-gemini"
            | "google-workspace-admin"
            | "google-play-store"
            | "google-developers"
            | "google-play-console"
            | "youtube"
            | "youtube-studio"
            | "gmail"
            | "gdrive" => Self::Google,
            _ => Self::Unsupported,
        }
    }
    pub fn supported(self) -> bool {
        self != Self::Unsupported
    }
    /// Stage shape only; native frame URL, owner, consent and expiry must still
    /// be checked by the caller. Manual and unknown adapters release nothing.
    pub fn accepts_stage(self, stage: NativeLoginStage) -> bool {
        match stage {
            NativeLoginStage::IdentifierSubmit => {
                return self.accepts_stage(NativeLoginStage::Identifier)
            }
            NativeLoginStage::PasswordSubmit => {
                return self.accepts_stage(NativeLoginStage::Password)
            }
            NativeLoginStage::FormSubmit if self.reviewed_provider() => {
                return self.accepts_stage(NativeLoginStage::Form)
            }
            _ => {}
        }
        match self {
            Self::Manual | Self::Unsupported => false,
            Self::Google | Self::Bitwarden | Self::Synology | Self::Cloudflare | Self::Adobe => {
                matches!(
                    stage,
                    NativeLoginStage::Identifier | NativeLoginStage::Password
                )
            }
            Self::ChatGpt => matches!(
                stage,
                NativeLoginStage::Identifier
                    | NativeLoginStage::Password
                    | NativeLoginStage::BoundPassword
            ),
            Self::Claude => stage == NativeLoginStage::Identifier,
            Self::ModularForm => matches!(
                stage,
                NativeLoginStage::Form
                    | NativeLoginStage::FormPrepare
                    | NativeLoginStage::FormSubmit
            ),
            Self::Generic
            | Self::Porkbun
            | Self::ExchangeEcp
            | Self::ExchangeOwa
            | Self::VodafoneSmartRouter
            | Self::Yealink => stage == NativeLoginStage::Form,
        }
    }
    pub(crate) fn from_wire(value: &str) -> Self {
        if value == "manual" {
            Self::Manual
        } else if value == "modular-form" {
            Self::ModularForm
        } else {
            Self::from_application_id(value)
        }
    }
    pub(crate) fn wire(self) -> &'static str {
        match self {
            Self::Manual => "manual",
            Self::Generic => "generic-form",
            Self::ModularForm => "modular-form",
            Self::Porkbun => "porkbun",
            Self::Google => "google-account",
            Self::Bitwarden => "bitwarden-self-hosted",
            Self::Synology => "synology-dsm",
            Self::Cloudflare => "cloudflare",
            Self::Yealink => "voip-phone",
            Self::Adobe => "adobe-admin-console",
            Self::ChatGpt => "chatgpt",
            Self::Claude => "claude",
            Self::ExchangeEcp => "exchange-ecp",
            Self::ExchangeOwa => "exchange-owa",
            Self::VodafoneSmartRouter => "vodafone-smart-router-3",
            Self::Unsupported => "unsupported",
        }
    }

    pub(crate) fn reviewed_provider(self) -> bool {
        matches!(
            self,
            Self::Google
                | Self::Bitwarden
                | Self::Synology
                | Self::Cloudflare
                | Self::Yealink
                | Self::Adobe
                | Self::ChatGpt
                | Self::Claude
        )
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum NativeLoginStage {
    Form,
    /// Timing metadata only; no credential or extra-field values.
    FormPrepare,
    /// Fresh consent for one deferred click; no credential values.
    FormSubmit,
    Identifier,
    Password,
    /// ChatGPT redirect document: bind its displayed account to the native
    /// saved identifier before disclosing the password to an input control.
    BoundPassword,
    IdentifierSubmit,
    PasswordSubmit,
}

impl NativeLoginStage {
    pub(crate) fn parse(value: &str) -> Option<Self> {
        match value {
            "form" => Some(Self::Form),
            "form-prepare" => Some(Self::FormPrepare),
            "form-submit" => Some(Self::FormSubmit),
            "identifier" => Some(Self::Identifier),
            "password" => Some(Self::Password),
            "bound-password" => Some(Self::BoundPassword),
            "id-submit" => Some(Self::IdentifierSubmit),
            "pw-submit" => Some(Self::PasswordSubmit),
            _ => None,
        }
    }
    pub(crate) fn wire(self) -> &'static str {
        match self {
            Self::Form => "form",
            Self::FormPrepare => "form-prepare",
            Self::FormSubmit => "form-submit",
            Self::Identifier => "identifier",
            Self::Password => "password",
            Self::BoundPassword => "bound-password",
            Self::IdentifierSubmit => "id-submit",
            Self::PasswordSubmit => "pw-submit",
        }
    }
    /// Only release the field required by this stage into renderer memory.
    pub(crate) fn fields<'a>(self, credentials: &NativeLoginCredentials<'a>) -> (&'a str, &'a str) {
        match self {
            Self::Form | Self::BoundPassword => (credentials.username, credentials.password),
            Self::FormPrepare
            | Self::FormSubmit
            | Self::IdentifierSubmit
            | Self::PasswordSubmit => ("", ""),
            Self::Identifier => (credentials.username, ""),
            Self::Password => ("", credentials.password),
        }
    }

    pub fn is_action(self) -> bool {
        matches!(
            self,
            Self::FormSubmit | Self::IdentifierSubmit | Self::PasswordSubmit
        )
    }
}

pub(crate) fn stage_allowed(
    adapter: NativeLoginAdapter,
    stage: NativeLoginStage,
    url: &str,
) -> bool {
    if !adapter.accepts_stage(stage) {
        return false;
    }
    let stage = match stage {
        NativeLoginStage::IdentifierSubmit => NativeLoginStage::Identifier,
        NativeLoginStage::PasswordSubmit => NativeLoginStage::Password,
        NativeLoginStage::FormSubmit => NativeLoginStage::Form,
        other => other,
    };
    let Some(origin) = https_origin(url) else {
        return false;
    };
    match adapter {
        NativeLoginAdapter::Cloudflare => {
            origin == "https://dash.cloudflare.com"
                && url::Url::parse(url).is_ok_and(|url| {
                    matches!(url.path(), "/login" | "/login/") && url.fragment().is_none()
                })
        }
        NativeLoginAdapter::Adobe => {
            origin == "https://auth.services.adobe.com"
                && url::Url::parse(url).is_ok_and(|url| {
                    url.path() == "/en_US/index.html"
                        && match stage {
                            NativeLoginStage::Identifier => {
                                matches!(url.fragment().unwrap_or(""), "" | "/")
                            }
                            NativeLoginStage::Password => url
                                .fragment()
                                .is_some_and(|hash| hash.split('?').next() == Some("/password")),
                            _ => false,
                        }
                })
        }
        NativeLoginAdapter::ChatGpt => url::Url::parse(url).is_ok_and(|url| {
            url.fragment().is_none()
                && !url.query_pairs().any(|(key, _)| key == "error")
                && match stage {
                    NativeLoginStage::Identifier => {
                        (origin == "https://auth.openai.com" && url.path() == "/log-in")
                            || (origin == "https://chatgpt.com" && url.path() == "/auth/login")
                    }
                    NativeLoginStage::Password | NativeLoginStage::BoundPassword => {
                        origin == "https://auth.openai.com" && url.path() == "/log-in/password"
                    }
                    _ => false,
                }
        }),
        NativeLoginAdapter::Claude => {
            origin == "https://claude.ai"
                && url::Url::parse(url).is_ok_and(|url| {
                    matches!(url.path(), "/login" | "/login/")
                        && url.fragment().is_none()
                        && !url.query_pairs().any(|(key, _)| key == "error")
                })
        }
        // Exact saved origins are additionally enforced by the owner grant.
        NativeLoginAdapter::Bitwarden | NativeLoginAdapter::Yealink => true,
        NativeLoginAdapter::Synology => url::Url::parse(url).is_ok_and(|url| match stage {
            NativeLoginStage::Identifier => matches!(
                url.fragment().unwrap_or(""),
                "" | "/" | "/signin" | "/signin/"
            ),
            NativeLoginStage::Password => url.fragment() == Some("/signin/password"),
            _ => false,
        }),
        NativeLoginAdapter::Google => {
            if origin != "https://accounts.google.com" {
                return false;
            }
            let Ok(url) = url::Url::parse(url) else {
                return false;
            };
            match stage {
                NativeLoginStage::Identifier => [
                    "/v3/signin/identifier",
                    "/signin/v2/identifier",
                    "/signin/identifier",
                ]
                .contains(&url.path()),
                NativeLoginStage::Password => [
                    "/v3/signin/challenge/pwd",
                    "/signin/v2/challenge/pwd",
                    "/signin/challenge/pwd",
                ]
                .contains(&url.path()),
                _ => false,
            }
        }
        NativeLoginAdapter::ModularForm => true,
        NativeLoginAdapter::Generic => stage == NativeLoginStage::Form,
        NativeLoginAdapter::VodafoneSmartRouter => stage == NativeLoginStage::Form,
        NativeLoginAdapter::ExchangeEcp | NativeLoginAdapter::ExchangeOwa => url::Url::parse(url)
            .is_ok_and(|url| {
                url.path().eq_ignore_ascii_case("/owa/auth/logon.aspx")
                    && url
                        .query_pairs()
                        .filter(|(key, _)| key == "reason")
                        .all(|(_, value)| value == "0")
            }),
        NativeLoginAdapter::Porkbun => {
            stage == NativeLoginStage::Form
                && ["https://porkbun.com", "https://www.porkbun.com"].contains(&origin.as_str())
                && url::Url::parse(url).is_ok_and(|url| url.path() == "/account/login")
        }
        NativeLoginAdapter::Manual | NativeLoginAdapter::Unsupported => false,
    }
}

#[derive(Default)]
pub(crate) struct RendererFeatureGate {
    installed: bool,
    failed: bool,
}

impl RendererFeatureGate {
    pub fn observe(&mut self, origin: &str, pin: &str, status: NativeFeatureStatus) -> bool {
        if pin != FEATURE_PROTOCOL_PIN || status == NativeFeatureStatus::RendererInstallationFailed
        {
            self.failed = true;
        }
        if !self.failed
            && origin == "about:blank"
            && status == NativeFeatureStatus::RendererInstalled
        {
            self.installed = true;
        }
        !self.failed
    }
    pub fn ready(&self) -> bool {
        self.installed && !self.failed
    }
}

/// Engineering observations only, never NativeHostReadiness::Ready. In
/// particular, adapter completion does not establish authenticated login.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NativeFeatureStatus {
    RendererInstalled,
    RendererInstallationFailed,
    LoginFormDetected,
    LoginAdapterCompleted,
    LoginAdapterRejected,
    /// Delivery progress only. Neither sent nor accepted means authenticated.
    LoginDelivery(NativeLoginDeliveryStatus),
}

/// Fixed, secret-free checkpoints. No page strings, nonce or credential data.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NativeLoginDeliveryStatus {
    NativeNotDelivered,
    NativeRejectedCurrent,
    NativeRejectedNavigation,
    NativeRejectedGrant,
    NativeMessageFailed,
    NativeSent,
    RendererReceived,
    RendererRejectedFrame,
    RendererRejectedPayload,
    RendererRejectedDocument,
    RendererRejectedContext,
    RendererExecuting,
    RendererAccepted,
    RendererRejected,
    RendererMissingDocument,
    RendererNonceMismatch,
    RendererOriginMismatch,
    RendererStageNotRequested,
    RendererStageNotAllowed,
    RendererReplay,
}

impl NativeLoginDeliveryStatus {
    // Only renderer observations can be decoded from renderer IPC. A renderer
    // cannot claim a native consent or send checkpoint.
    pub(crate) fn renderer_wire(self) -> Option<i32> {
        Some(match self {
            Self::RendererReceived => 1,
            Self::RendererRejectedFrame => 2,
            Self::RendererRejectedPayload => 3,
            Self::RendererRejectedDocument => 4,
            Self::RendererRejectedContext => 5,
            Self::RendererExecuting => 6,
            Self::RendererAccepted => 7,
            Self::RendererRejected => 8,
            Self::RendererMissingDocument => 9,
            Self::RendererNonceMismatch => 10,
            Self::RendererOriginMismatch => 11,
            Self::RendererStageNotRequested => 12,
            Self::RendererStageNotAllowed => 13,
            Self::RendererReplay => 14,
            _ => return None,
        })
    }

    pub(crate) fn from_renderer_wire(value: i32) -> Option<Self> {
        Some(match value {
            1 => Self::RendererReceived,
            2 => Self::RendererRejectedFrame,
            3 => Self::RendererRejectedPayload,
            4 => Self::RendererRejectedDocument,
            5 => Self::RendererRejectedContext,
            6 => Self::RendererExecuting,
            7 => Self::RendererAccepted,
            8 => Self::RendererRejected,
            9 => Self::RendererMissingDocument,
            10 => Self::RendererNonceMismatch,
            11 => Self::RendererOriginMismatch,
            12 => Self::RendererStageNotRequested,
            13 => Self::RendererStageNotAllowed,
            14 => Self::RendererReplay,
            _ => return None,
        })
    }
}

/// Constructed from CEF's authenticated main-frame callback, not page input.
pub struct NativeLoginRequest<'a> {
    pub identity: &'a BrowserIdentity,
    pub origin: &'a str,
    pub adapter: NativeLoginAdapter,
    pub stage: NativeLoginStage,
}

/// Borrow credentials only while the native owner holds a current, unlocked,
/// exact-origin consent grant. The owner must recheck consent on every call.
/// `auto_submit` requires submission consent in addition to disclosure consent.
/// No Debug/Clone/serde: these values must never become diagnostics or app IPC.
pub struct NativeLoginCredentials<'a> {
    pub identity: &'a BrowserIdentity,
    pub origin: &'a str,
    pub valid_until: Instant,
    pub username: &'a str,
    pub password: &'a str,
    pub auto_submit: bool,
}

pub(crate) fn https_origin(value: &str) -> Option<String> {
    if value.len() > 16_384 || value.contains('\\') || value.chars().any(char::is_control) {
        return None;
    }
    let url = url::Url::parse(value).ok()?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return None;
    }
    Some(url.origin().ascii_serialization())
}

/// One release per exact origin and stage for this attempt. Reloads,
/// renderer restarts and form mutations cannot start a submission loop.
#[derive(Default)]
pub(crate) struct LoginBudget {
    released: HashSet<(String, NativeLoginStage)>,
}

impl LoginBudget {
    pub fn reserve(
        &mut self,
        request: &NativeLoginRequest<'_>,
        credentials: &NativeLoginCredentials<'_>,
    ) -> bool {
        let metadata = request.stage == NativeLoginStage::FormPrepare || request.stage.is_action();
        if credentials.identity != request.identity
            || !request.adapter.accepts_stage(request.stage)
            || credentials.origin != request.origin
            || https_origin(request.origin).as_deref() != Some(request.origin)
            || credentials.valid_until <= Instant::now()
            || (!metadata
                && request.stage != NativeLoginStage::Password
                && credentials.username.is_empty())
            || (!metadata
                && request.stage != NativeLoginStage::Identifier
                && credentials.password.is_empty())
            || (metadata && (!credentials.username.is_empty() || !credentials.password.is_empty()))
            || credentials.username.len() > MAX_CREDENTIAL_BYTES
            || credentials.password.len() > MAX_CREDENTIAL_BYTES
            || self.released.len() >= 128
        {
            return false;
        }
        if request.stage.is_action() && request.adapter != NativeLoginAdapter::ModularForm {
            let previous = match request.stage {
                NativeLoginStage::IdentifierSubmit => NativeLoginStage::Identifier,
                NativeLoginStage::PasswordSubmit
                    if self.released.contains(&(
                        request.origin.to_owned(),
                        NativeLoginStage::BoundPassword,
                    )) =>
                {
                    NativeLoginStage::BoundPassword
                }
                NativeLoginStage::PasswordSubmit => NativeLoginStage::Password,
                NativeLoginStage::FormSubmit => NativeLoginStage::Form,
                _ => return false,
            };
            if !credentials.auto_submit
                || !self
                    .released
                    .contains(&(request.origin.to_owned(), previous))
            {
                return false;
            }
        } else if request.adapter == NativeLoginAdapter::ModularForm {
            let previous = match request.stage {
                NativeLoginStage::FormPrepare => None,
                NativeLoginStage::Form => Some(NativeLoginStage::FormPrepare),
                NativeLoginStage::FormSubmit if credentials.auto_submit => {
                    Some(NativeLoginStage::Form)
                }
                _ => return false,
            };
            if previous
                .is_some_and(|stage| !self.released.contains(&(request.origin.to_owned(), stage)))
            {
                return false;
            }
        } else if request.adapter.accepts_stage(NativeLoginStage::Identifier) {
            if request.adapter == NativeLoginAdapter::Google
                && request.origin != "https://accounts.google.com"
            {
                return false;
            }
            let password = matches!(
                request.stage,
                NativeLoginStage::Password | NativeLoginStage::BoundPassword
            );
            let identifier_origin = if request.adapter == NativeLoginAdapter::ChatGpt
                && request.origin == "https://auth.openai.com"
                && self
                    .released
                    .contains(&("https://chatgpt.com".into(), NativeLoginStage::Identifier))
            {
                "https://chatgpt.com"
            } else {
                request.origin
            };
            if password
                && !self
                    .released
                    .contains(&(identifier_origin.to_owned(), NativeLoginStage::Identifier))
            {
                return false;
            }
            if password
                && [NativeLoginStage::Password, NativeLoginStage::BoundPassword]
                    .iter()
                    .any(|stage| self.released.contains(&(request.origin.to_owned(), *stage)))
            {
                return false;
            }
        } else if request.stage != NativeLoginStage::Form {
            return false;
        }
        self.released
            .insert((request.origin.to_owned(), request.stage))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sorng_protocols::origin_browser::OriginBrowserPolicy;
    use std::time::Duration;

    #[test]
    fn modular_form_is_native_selected_with_explicit_deferred_action_stages() {
        assert_eq!(
            NativeLoginAdapter::from_application_id("modular-form"),
            NativeLoginAdapter::Unsupported
        );
        assert_eq!(
            NativeLoginAdapter::from_wire("modular-form"),
            NativeLoginAdapter::ModularForm
        );
        assert!(stage_allowed(
            NativeLoginAdapter::ModularForm,
            NativeLoginStage::Form,
            "https://device.test/login"
        ));
        for stage in [NativeLoginStage::FormPrepare, NativeLoginStage::FormSubmit] {
            assert!(stage_allowed(
                NativeLoginAdapter::ModularForm,
                stage,
                "https://device.test/login"
            ));
            assert!(!stage_allowed(
                NativeLoginAdapter::Generic,
                stage,
                "https://device.test/login"
            ));
        }
        assert!(!stage_allowed(
            NativeLoginAdapter::ModularForm,
            NativeLoginStage::Identifier,
            "https://device.test/login"
        ));
        assert!(!stage_allowed(
            NativeLoginAdapter::ModularForm,
            NativeLoginStage::Form,
            "http://device.test/login"
        ));
    }

    #[test]
    fn login_delivery_diagnostics_cannot_claim_native_consent_or_success() {
        use NativeLoginDeliveryStatus::*;
        for native in [
            NativeNotDelivered,
            NativeRejectedCurrent,
            NativeRejectedNavigation,
            NativeRejectedGrant,
            NativeMessageFailed,
            NativeSent,
        ] {
            assert_eq!(native.renderer_wire(), None);
        }
        for renderer in [
            RendererReceived,
            RendererRejectedFrame,
            RendererRejectedPayload,
            RendererRejectedDocument,
            RendererRejectedContext,
            RendererExecuting,
            RendererAccepted,
            RendererRejected,
            RendererMissingDocument,
            RendererNonceMismatch,
            RendererOriginMismatch,
            RendererStageNotRequested,
            RendererStageNotAllowed,
            RendererReplay,
        ] {
            assert_eq!(
                NativeLoginDeliveryStatus::from_renderer_wire(renderer.renderer_wire().unwrap()),
                Some(renderer)
            );
            let mut gate = RendererFeatureGate::default();
            assert!(gate.observe(
                "about:blank",
                FEATURE_PROTOCOL_PIN,
                NativeFeatureStatus::LoginDelivery(renderer)
            ));
            assert!(!gate.ready());
        }
        for unknown in [i32::MIN, -1, 0, 15, i32::MAX] {
            assert_eq!(NativeLoginDeliveryStatus::from_renderer_wire(unknown), None);
        }
    }

    #[test]
    fn login_stage_wire_round_trips_and_rejects_unknown_requests() {
        for stage in [
            NativeLoginStage::Form,
            NativeLoginStage::FormPrepare,
            NativeLoginStage::FormSubmit,
            NativeLoginStage::Identifier,
            NativeLoginStage::Password,
            NativeLoginStage::BoundPassword,
            NativeLoginStage::IdentifierSubmit,
            NativeLoginStage::PasswordSubmit,
        ] {
            assert_eq!(NativeLoginStage::parse(stage.wire()), Some(stage));
        }
        for unknown in ["", "FORM", "form\0", "password ", "all", "manual"] {
            assert_eq!(NativeLoginStage::parse(unknown), None);
        }
    }

    #[test]
    fn reviewed_provider_routes_and_stages_never_become_generic() {
        for (id, adapter, url) in [
            (
                "bitwarden-self-hosted",
                NativeLoginAdapter::Bitwarden,
                "https://vault.test/#/login",
            ),
            (
                "vaultwarden",
                NativeLoginAdapter::Bitwarden,
                "https://vault.test/#/login",
            ),
            (
                "synology-dsm",
                NativeLoginAdapter::Synology,
                "https://nas.test/#/signin",
            ),
            (
                "cloudflare",
                NativeLoginAdapter::Cloudflare,
                "https://dash.cloudflare.com/login",
            ),
            (
                "adobe-admin-console",
                NativeLoginAdapter::Adobe,
                "https://auth.services.adobe.com/en_US/index.html#/",
            ),
            (
                "chatgpt",
                NativeLoginAdapter::ChatGpt,
                "https://auth.openai.com/log-in",
            ),
            (
                "claude",
                NativeLoginAdapter::Claude,
                "https://claude.ai/login",
            ),
        ] {
            assert_eq!(NativeLoginAdapter::from_application_id(id), adapter);
            assert_eq!(NativeLoginAdapter::from_wire(adapter.wire()), adapter);
            assert!(stage_allowed(adapter, NativeLoginStage::Identifier, url));
            assert!(!stage_allowed(adapter, NativeLoginStage::Form, url));
            assert!(!stage_allowed(
                adapter,
                NativeLoginStage::Identifier,
                &url.replacen("https:", "http:", 1)
            ));
        }
        for (adapter, url) in [
            (
                NativeLoginAdapter::Cloudflare,
                "https://dash.cloudflare.com.evil.test/login",
            ),
            (
                NativeLoginAdapter::Adobe,
                "https://ims-na1.adobelogin.com/en_US/index.html",
            ),
            (
                NativeLoginAdapter::ChatGpt,
                "https://chatgpt.com/auth/login",
            ),
            (NativeLoginAdapter::Claude, "https://claude.ai/login"),
            (
                NativeLoginAdapter::Synology,
                "https://nas.test/#/signin/otp",
            ),
        ] {
            assert!(!stage_allowed(adapter, NativeLoginStage::Password, url));
        }
    }

    #[test]
    fn deferred_actions_require_preparation_then_fill_then_fresh_submit_consent() {
        let policy =
            OriginBrowserPolicy::new("owner", "connection", "tab", "https://device.test").unwrap();
        let mut request = NativeLoginRequest {
            identity: policy.identity(),
            origin: "https://device.test",
            adapter: NativeLoginAdapter::ModularForm,
            stage: NativeLoginStage::FormSubmit,
        };
        let mut credentials = NativeLoginCredentials {
            identity: policy.identity(),
            origin: request.origin,
            valid_until: Instant::now() + Duration::from_secs(30),
            username: "",
            password: "",
            auto_submit: true,
        };
        let mut budget = LoginBudget::default();
        assert!(!budget.reserve(&request, &credentials));
        request.stage = NativeLoginStage::FormPrepare;
        assert!(budget.reserve(&request, &credentials));
        assert!(!budget.reserve(&request, &credentials));
        assert_eq!(request.stage.fields(&credentials), ("", ""));
        request.stage = NativeLoginStage::Form;
        credentials.username = "synthetic-user";
        credentials.password = "synthetic-password";
        assert!(budget.reserve(&request, &credentials));
        request.stage = NativeLoginStage::FormSubmit;
        assert!(!budget.reserve(&request, &credentials));
        credentials.username = "";
        credentials.password = "";
        credentials.auto_submit = false;
        assert!(!budget.reserve(&request, &credentials));
        credentials.auto_submit = true;
        assert!(budget.reserve(&request, &credentials));
        assert!(!budget.reserve(&request, &credentials));
        assert_eq!(request.stage.fields(&credentials), ("", ""));
    }

    #[test]
    fn redirected_chatgpt_password_requires_identifier_and_cannot_replay_as_another_stage() {
        let policy =
            OriginBrowserPolicy::new("owner", "connection", "tab", "https://chatgpt.com").unwrap();
        let mut request = NativeLoginRequest {
            identity: policy.identity(),
            origin: "https://auth.openai.com",
            adapter: NativeLoginAdapter::ChatGpt,
            stage: NativeLoginStage::BoundPassword,
        };
        let mut credentials = NativeLoginCredentials {
            identity: policy.identity(),
            origin: request.origin,
            valid_until: Instant::now() + Duration::from_secs(30),
            username: "saved-identity",
            password: "synthetic-password",
            auto_submit: true,
        };
        let mut budget = LoginBudget::default();
        assert!(!budget.reserve(&request, &credentials));
        request.stage = NativeLoginStage::Identifier;
        request.origin = "https://chatgpt.com";
        credentials.origin = request.origin;
        assert!(budget.reserve(&request, &credentials));
        request.stage = NativeLoginStage::BoundPassword;
        request.origin = "https://auth.openai.com";
        credentials.origin = request.origin;
        assert!(budget.reserve(&request, &credentials));
        request.stage = NativeLoginStage::Password;
        assert!(!budget.reserve(&request, &credentials));
        assert!(!NativeLoginAdapter::Google.accepts_stage(NativeLoginStage::BoundPassword));
        assert!(!stage_allowed(
            NativeLoginAdapter::ChatGpt,
            NativeLoginStage::BoundPassword,
            "https://chatgpt.com/auth/login"
        ));
    }

    #[test]
    fn provider_actions_are_secret_free_one_shot_and_require_current_submit_consent() {
        for adapter in [
            NativeLoginAdapter::Google,
            NativeLoginAdapter::Bitwarden,
            NativeLoginAdapter::Synology,
            NativeLoginAdapter::Cloudflare,
            NativeLoginAdapter::Adobe,
            NativeLoginAdapter::ChatGpt,
            NativeLoginAdapter::Claude,
        ] {
            let origin = if adapter == NativeLoginAdapter::Google {
                "https://accounts.google.com"
            } else {
                "https://fixture.test"
            };
            let policy = OriginBrowserPolicy::new("owner", "connection", "tab", origin).unwrap();
            let mut request = NativeLoginRequest {
                identity: policy.identity(),
                origin,
                adapter,
                stage: NativeLoginStage::IdentifierSubmit,
            };
            let mut credentials = NativeLoginCredentials {
                identity: policy.identity(),
                origin,
                valid_until: Instant::now() + Duration::from_secs(30),
                username: "",
                password: "",
                auto_submit: true,
            };
            let mut budget = LoginBudget::default();
            assert!(!budget.reserve(&request, &credentials));
            request.stage = NativeLoginStage::Identifier;
            credentials.username = "synthetic-user";
            assert!(budget.reserve(&request, &credentials));
            request.stage = NativeLoginStage::IdentifierSubmit;
            assert!(!budget.reserve(&request, &credentials));
            credentials.username = "";
            credentials.auto_submit = false;
            assert!(!budget.reserve(&request, &credentials));
            credentials.auto_submit = true;
            let deadline = credentials.valid_until;
            credentials.valid_until = Instant::now();
            assert!(!budget.reserve(&request, &credentials));
            credentials.valid_until = deadline;
            assert!(budget.reserve(&request, &credentials));
            assert_eq!(request.stage.fields(&credentials), ("", ""));
            assert!(!budget.reserve(&request, &credentials));
        }
    }

    #[test]
    fn manual_installs_features_but_cannot_request_or_release_any_stage() {
        assert!(NativeLoginAdapter::Manual.supported());
        assert_eq!(
            NativeLoginAdapter::from_wire(NativeLoginAdapter::Manual.wire()),
            NativeLoginAdapter::Manual
        );
        // Missing metadata and hooks must not silently opt into manual mode.
        assert_eq!(
            NativeLoginAdapter::default(),
            NativeLoginAdapter::Unsupported
        );
        assert_eq!(
            NativeLoginAdapter::from_application_id("manual"),
            NativeLoginAdapter::Unsupported
        );
        let policy =
            OriginBrowserPolicy::new("owner", "connection", "tab", "https://example.test").unwrap();
        let credentials = NativeLoginCredentials {
            identity: policy.identity(),
            origin: "https://example.test",
            valid_until: Instant::now() + Duration::from_secs(30),
            username: "synthetic-user",
            password: "synthetic-password",
            auto_submit: true,
        };
        for stage in [
            NativeLoginStage::Form,
            NativeLoginStage::Identifier,
            NativeLoginStage::Password,
        ] {
            for adapter in [NativeLoginAdapter::Manual, NativeLoginAdapter::Unsupported] {
                assert!(!adapter.accepts_stage(stage));
                assert!(!stage_allowed(adapter, stage, "https://example.test/login"));
                let request = NativeLoginRequest {
                    identity: policy.identity(),
                    origin: credentials.origin,
                    adapter,
                    stage,
                };
                assert!(!LoginBudget::default().reserve(&request, &credentials));
            }
            assert_eq!(
                NativeLoginAdapter::Google.accepts_stage(stage),
                stage != NativeLoginStage::Form
            );
            assert_eq!(
                NativeLoginAdapter::Generic.accepts_stage(stage),
                stage == NativeLoginStage::Form
            );
            assert_eq!(
                NativeLoginAdapter::Porkbun.accepts_stage(stage),
                stage == NativeLoginStage::Form
            );
        }
        let mut gate = RendererFeatureGate::default();
        assert!(gate.observe(
            "about:blank",
            FEATURE_PROTOCOL_PIN,
            NativeFeatureStatus::RendererInstalled
        ));
        assert!(gate.ready());
    }

    #[test]
    fn credential_origins_exclude_inherited_opaque_cleartext_and_userinfo() {
        for url in [
            "http://example.test",
            "about:blank",
            "data:text/html,x",
            "https://u:p@example.test",
            "https://example.test\\@evil.test",
            "https://example.test\n",
        ] {
            assert_eq!(https_origin(url), None);
        }
        assert_eq!(
            https_origin("https://EXAMPLE.test:443/login?q=x#f").as_deref(),
            Some("https://example.test")
        );
    }

    #[test]
    fn only_pinned_bootstrap_handshake_opens_feature_gate_and_failure_is_terminal() {
        let mut old_helper = RendererFeatureGate::default();
        assert!(!old_helper.observe(
            "about:blank",
            "cef154.3.0/native-features-v3",
            NativeFeatureStatus::RendererInstalled
        ));
        assert!(!old_helper.ready());
        let mut gate = RendererFeatureGate::default();
        assert!(!gate.ready());
        assert!(gate.observe(
            "https://example.test",
            FEATURE_PROTOCOL_PIN,
            NativeFeatureStatus::RendererInstalled
        ));
        assert!(!gate.ready());
        assert!(gate.observe(
            "about:blank",
            FEATURE_PROTOCOL_PIN,
            NativeFeatureStatus::RendererInstalled
        ));
        assert!(gate.ready());
        assert!(!gate.observe(
            "about:blank",
            "wrong-pin",
            NativeFeatureStatus::RendererInstalled
        ));
        assert!(!gate.ready());
        assert!(!gate.observe(
            "about:blank",
            FEATURE_PROTOCOL_PIN,
            NativeFeatureStatus::RendererInstalled
        ));
        let mut failed = RendererFeatureGate::default();
        assert!(!failed.observe(
            "about:blank",
            FEATURE_PROTOCOL_PIN,
            NativeFeatureStatus::RendererInstallationFailed
        ));
        assert!(!failed.ready());
    }

    #[test]
    fn selected_applications_never_silently_become_generic() {
        assert_eq!(
            NativeLoginAdapter::from_application_id("generic-form"),
            NativeLoginAdapter::Generic
        );
        assert_eq!(
            NativeLoginAdapter::from_application_id("porkbun"),
            NativeLoginAdapter::Porkbun
        );
        for id in [
            "google-account",
            "google-cloud-console",
            "gmail",
            "youtube",
            "gdrive",
        ] {
            assert_eq!(
                NativeLoginAdapter::from_application_id(id),
                NativeLoginAdapter::Google
            );
        }
        for id in ["", "generic", "custom", "cpanel", "unknown"] {
            assert_eq!(
                NativeLoginAdapter::from_application_id(id),
                NativeLoginAdapter::Unsupported
            );
        }
    }

    #[test]
    fn reviewed_native_application_ids_round_trip_and_stages_remain_explicit() {
        for (id, adapter) in [
            ("exchange-ecp", NativeLoginAdapter::ExchangeEcp),
            ("exchange-owa", NativeLoginAdapter::ExchangeOwa),
            (
                "vodafone-smart-router-3",
                NativeLoginAdapter::VodafoneSmartRouter,
            ),
        ] {
            assert_eq!(NativeLoginAdapter::from_application_id(id), adapter);
            assert_eq!(NativeLoginAdapter::from_wire(adapter.wire()), adapter);
            assert!(adapter.accepts_stage(NativeLoginStage::Form));
            assert!(!adapter.accepts_stage(NativeLoginStage::Identifier));
            assert!(!adapter.accepts_stage(NativeLoginStage::Password));
            assert!(!stage_allowed(
                adapter,
                NativeLoginStage::Form,
                "http://fixture.test/owa/auth/logon.aspx"
            ));
        }
        for adapter in [
            NativeLoginAdapter::ExchangeEcp,
            NativeLoginAdapter::ExchangeOwa,
        ] {
            assert!(stage_allowed(
                adapter,
                NativeLoginStage::Form,
                "https://fixture.test/owa/auth/logon.aspx?reason=0"
            ));
            assert!(!stage_allowed(
                adapter,
                NativeLoginStage::Form,
                "https://fixture.test/owa/auth/logon.aspx?reason=2"
            ));
            assert!(!stage_allowed(
                adapter,
                NativeLoginStage::Form,
                "https://fixture.test/owa/auth/change.aspx"
            ));
        }
    }

    #[test]
    fn google_native_stage_paths_and_origin_are_exact() {
        assert!(stage_allowed(
            NativeLoginAdapter::Google,
            NativeLoginStage::Identifier,
            "https://accounts.google.com/v3/signin/identifier?continue=x"
        ));
        assert!(stage_allowed(
            NativeLoginAdapter::Google,
            NativeLoginStage::Password,
            "https://accounts.google.com/signin/v2/challenge/pwd"
        ));
        for url in [
            "https://accounts.google.com:444/v3/signin/identifier",
            "http://accounts.google.com/v3/signin/identifier",
            "https://accounts.google.com.evil.test/v3/signin/identifier",
            "https://accounts.google.com/v3/signin/challenge/totp",
            "https://accounts.google.com/v3/signin/identifier/",
            "https://accounts.google.com/v3/signin/challenge/recaptcha",
        ] {
            assert!(!stage_allowed(
                NativeLoginAdapter::Google,
                NativeLoginStage::Identifier,
                url
            ));
            assert!(!stage_allowed(
                NativeLoginAdapter::Google,
                NativeLoginStage::Password,
                url
            ));
        }
        assert!(!stage_allowed(
            NativeLoginAdapter::Google,
            NativeLoginStage::Form,
            "https://accounts.google.com/v3/signin/identifier"
        ));
        assert!(!stage_allowed(
            NativeLoginAdapter::Generic,
            NativeLoginStage::Password,
            "https://example.test/login"
        ));
    }

    #[test]
    fn google_releases_one_field_per_stage_and_requires_prior_identifier_in_same_attempt() {
        let policy =
            OriginBrowserPolicy::new("owner", "connection", "tab", "https://accounts.google.com")
                .unwrap();
        let mut request = NativeLoginRequest {
            identity: policy.identity(),
            origin: "https://accounts.google.com",
            adapter: NativeLoginAdapter::Google,
            stage: NativeLoginStage::Password,
        };
        let credentials = NativeLoginCredentials {
            identity: policy.identity(),
            origin: request.origin,
            valid_until: Instant::now() + Duration::from_secs(30),
            username: "synthetic-user",
            password: "synthetic-password",
            auto_submit: true,
        };
        let mut budget = LoginBudget::default();
        assert!(!budget.reserve(&request, &credentials));
        request.stage = NativeLoginStage::Identifier;
        assert!(budget.reserve(&request, &credentials));
        assert!(!budget.reserve(&request, &credentials));
        assert_eq!(request.stage.fields(&credentials), ("synthetic-user", ""));
        request.stage = NativeLoginStage::Password;
        assert!(budget.reserve(&request, &credentials));
        assert_eq!(
            request.stage.fields(&credentials),
            ("", "synthetic-password")
        );
        assert!(!budget.reserve(&request, &credentials));
        assert!(!LoginBudget::default().reserve(&request, &credentials));
    }

    #[test]
    fn disclosure_requires_exact_attempt_origin_expiry_and_one_shot_budget() {
        let policy =
            OriginBrowserPolicy::new("owner", "connection", "tab", "https://example.test").unwrap();
        let other =
            OriginBrowserPolicy::new("owner", "connection", "tab", "https://example.test").unwrap();
        let request = NativeLoginRequest {
            identity: policy.identity(),
            origin: "https://example.test",
            adapter: NativeLoginAdapter::Generic,
            stage: NativeLoginStage::Form,
        };
        let mut credentials = NativeLoginCredentials {
            identity: other.identity(),
            origin: request.origin,
            valid_until: Instant::now() + Duration::from_secs(30),
            username: "synthetic-user",
            password: "synthetic-password",
            auto_submit: true,
        };
        let mut budget = LoginBudget::default();
        assert!(!budget.reserve(&request, &credentials));
        credentials.identity = policy.identity();
        credentials.origin = "https://child.example.test";
        assert!(!budget.reserve(&request, &credentials));
        credentials.origin = request.origin;
        credentials.valid_until = Instant::now();
        assert!(!budget.reserve(&request, &credentials));
        credentials.valid_until = Instant::now() + Duration::from_secs(30);
        assert!(budget.reserve(&request, &credentials));
        assert!(!budget.reserve(&request, &credentials));
    }
}
