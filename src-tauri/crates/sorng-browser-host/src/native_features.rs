//! Native owner contract for website login. Network grants are never consent.
//! Nothing here is deserializable or exposed as a remote-page IPC API.

use sorng_protocols::origin_browser::BrowserIdentity;
use std::collections::HashSet;
use std::time::Instant;

#[path = "native_login_profiles.rs"]
pub mod login_profiles;

pub use crate::native_totp as totp;

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
pub(crate) const FEATURE_PROTOCOL_PIN: &str = "cef154.3.0/native-features-v5";

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
    /// Reviewed declarative login steps (t102 contract L1). Selected only by
    /// the native owner for a configuration carrying `declarativeLogin`, never
    /// from an application id. Which stage may run on which origin, path and
    /// frame comes from those steps (`DeclarativeLoginPolicy`), checked by the
    /// host on every request, delivery and key.
    Declarative,
}

impl NativeLoginAdapter {
    /// Registry must also reject unsupported saved selector/advanced options;
    /// this maps only the application's default reviewed form contract.
    pub fn from_application_id(id: &str) -> Self {
        match id {
            "declarative-steps" => Self::Declarative,
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
    /// Only explicitly selected generic or self-hosted login contracts may use
    /// HTTP. This is transport eligibility, never saved-origin or owner consent.
    fn allows_http_credentials(self) -> bool {
        matches!(
            self,
            Self::Generic
                | Self::ModularForm
                | Self::Bitwarden
                | Self::Synology
                | Self::Yealink
                | Self::ExchangeEcp
                | Self::ExchangeOwa
                | Self::VodafoneSmartRouter
                // Only the connection's own origin; every listed step origin
                // is HTTPS (`DeclarativeLoginPolicy::allows`).
                | Self::Declarative
        )
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
                    | NativeLoginStage::ScmConsent
            ),
            // `form-prepare` is the grant for a `click` pre-step: no
            // credential, once per origin. No bound-password stage.
            Self::Declarative => matches!(
                stage,
                NativeLoginStage::Identifier
                    | NativeLoginStage::Password
                    | NativeLoginStage::Form
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
        } else if value == "declarative-steps" {
            Self::Declarative
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
            Self::Declarative => "declarative-steps",
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
    /// One saved SCM application approval, with fresh submit consent and no secrets.
    ScmConsent,
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
            "scm-consent" => Some(Self::ScmConsent),
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
            Self::ScmConsent => "scm-consent",
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
            | Self::ScmConsent
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
            Self::FormSubmit | Self::IdentifierSubmit | Self::PasswordSubmit | Self::ScmConsent
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
    if stage == NativeLoginStage::ScmConsent {
        return adapter == NativeLoginAdapter::ModularForm && url::Url::parse(url).is_ok_and(|url| url.scheme() == "https" && url.path() == "/login/oauth/authorize" && url.fragment().is_none());
    }
    let stage = match stage {
        NativeLoginStage::IdentifierSubmit => NativeLoginStage::Identifier,
        NativeLoginStage::PasswordSubmit => NativeLoginStage::Password,
        NativeLoginStage::FormSubmit => NativeLoginStage::Form,
        other => other,
    };
    let Some(origin) = browser_origin(url) else {
        return false;
    };
    if !adapter.allows_http_credentials() && !origin.starts_with("https://") {
        return false;
    }
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
        // Shape only, like ModularForm. The browser host additionally checks
        // the steps (`DeclarativeLoginPolicy::allows`) for origin, live path
        // and frame before anything is released or typed.
        NativeLoginAdapter::Declarative => true,
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
    LoginChallengeWaiting,
    LoginChallengeReloading,
    LoginChallengeTimedOut,
    RendererInstalled,
    RendererInstallationFailed,
    LoginFormDetected,
    LoginAdapterCompleted,
    LoginAdapterRejected,
    /// The page adapter stopped and named one fixed cause.
    LoginAdapterStopped(NativeLoginRejection),
    /// Delivery progress only. Neither sent nor accepted means authenticated.
    LoginDelivery(NativeLoginDeliveryStatus),
}

/// Why a page login adapter stopped, as a fixed code the renderer accepts
/// from page script (`form-rejected|<wire>`). Never page text, field values
/// or account data; anything else is the plain, causeless rejection.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NativeLoginRejection {
    /// A CAPTCHA, Turnstile or hCaptcha the user must answer is displayed.
    VerificationRequired,
    /// After the submit, the page showed a refusal next to the login fields.
    CredentialsRejected,
    /// Keyboard focus was held by another text entry or moved away mid-typing.
    FocusUnavailable,
    /// The user typed, clicked or pressed Escape during the attempt.
    UserInput,
    /// The page, form, its destination or address changed during the attempt.
    PageChanged,
    /// A login field already held a value nobody typed for this attempt.
    FieldNotEmpty,
    /// The submit control never became usable within its bound.
    SubmitUnavailable,
    /// The next step of a multi-step login never appeared within its bound.
    StepNotFound,
    /// A grant or the credential's validity ran out.
    Expired,
}

impl NativeLoginRejection {
    pub const ALL: [Self; 9] = [
        Self::VerificationRequired,
        Self::CredentialsRejected,
        Self::FocusUnavailable,
        Self::UserInput,
        Self::PageChanged,
        Self::FieldNotEmpty,
        Self::SubmitUnavailable,
        Self::StepNotFound,
        Self::Expired,
    ];
    /// Renderer-to-browser feature-status prefix; the wire name follows it.
    pub const STATUS_PREFIX: &'static str = "login-rejected:";

    pub fn wire(self) -> &'static str {
        match self {
            Self::VerificationRequired => "verification-required",
            Self::CredentialsRejected => "credentials-rejected",
            Self::FocusUnavailable => "focus-unavailable",
            Self::UserInput => "user-input",
            Self::PageChanged => "page-changed",
            Self::FieldNotEmpty => "field-not-empty",
            Self::SubmitUnavailable => "submit-unavailable",
            Self::StepNotFound => "step-not-found",
            Self::Expired => "expired",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|cause| cause.wire() == value)
    }

    /// The page event `form-rejected|<wire>` names this cause.
    pub fn from_page_event(event: &str) -> Option<Self> {
        Self::parse(event.strip_prefix("form-rejected|")?)
    }

    /// The renderer's feature status for this cause, at most 40 bytes.
    pub fn status(self) -> String {
        format!("{}{}", Self::STATUS_PREFIX, self.wire())
    }

    /// The adapter-stopped status a renderer status names, if any.
    pub fn feature_status(status: &str) -> Option<NativeFeatureStatus> {
        Self::parse(status.strip_prefix(Self::STATUS_PREFIX)?)
            .map(NativeFeatureStatus::LoginAdapterStopped)
    }
}

/// The automatic-login step an explicit user retry re-runs on the page that
/// is open now. A retry never reloads, navigates or reconnects.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NativeLoginRetryStep {
    Credentials,
    Mfa,
}

impl NativeLoginRetryStep {
    pub fn wire(self) -> &'static str {
        match self {
            Self::Credentials => "credentials",
            Self::Mfa => "mfa",
        }
    }
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "credentials" => Some(Self::Credentials),
            "mfa" => Some(Self::Mfa),
            _ => None,
        }
    }
}

/// Host-side reasons a retry did not start. Fixed codes, no page data.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NativeLoginRetryRefusal {
    /// Text is being entered, a manual-input slot owns the keyboard, or the
    /// page is still loading.
    Busy,
    /// The open page has no login document this attempt may fill.
    NoForm,
    /// The native owner declined to re-arm its grant.
    Owner,
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
    /// Live native document pathname; never supplied by page IPC.
    pub path: &'a str,
    /// Exact configured child-frame name, matched against the native frame.
    pub frame: Option<&'a str>,
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

/// HTTP(S) document origin, including its scheme and non-default port. Parsing
/// never authorizes a destination: callers must still match the exact saved
/// source/consent and current native frame/owner. HTTPS grants do not cover HTTP.
pub(crate) fn browser_origin(value: &str) -> Option<String> {
    if value.len() > 16_384 || value.contains('\\') || value.chars().any(char::is_control) {
        return None;
    }
    let url = url::Url::parse(value).ok()?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return None;
    }
    Some(url.origin().ascii_serialization())
}

/// Keep secure-only capabilities separate from credential/manual-input support.
pub(crate) fn https_origin(value: &str) -> Option<String> {
    browser_origin(value).filter(|origin| origin.starts_with("https://"))
}

/// One release per exact origin and stage for this attempt. Reloads,
/// renderer restarts and form mutations cannot start a submission loop.
/// A release that ended before its stage's first key gets one more.
#[derive(Default)]
pub(crate) struct LoginBudget {
    released: HashSet<(String, NativeLoginStage)>,
    rearmed: HashSet<(String, NativeLoginStage)>,
}

impl LoginBudget {
    pub(crate) fn released(&self, origin: &str, stage: NativeLoginStage) -> bool {
        self.released.contains(&(origin.to_owned(), stage))
    }
    /// This release ended before the stage's first key event: its typing
    /// stopped, or its document was replaced. Nothing was entered or submitted.
    /// Only the typing host knows that; a renderer status cannot report it. The
    /// stage may be reserved once more, never a third time and never after its
    /// submit was released. The modular prepare and fill stages are one chain:
    /// it is re-armed once, at whichever of the two ended unused.
    pub(crate) fn cancelled(
        &mut self,
        adapter: NativeLoginAdapter,
        origin: &str,
        stage: NativeLoginStage,
    ) -> bool {
        let submit = match stage {
            NativeLoginStage::Form | NativeLoginStage::FormPrepare => NativeLoginStage::FormSubmit,
            NativeLoginStage::Identifier => NativeLoginStage::IdentifierSubmit,
            NativeLoginStage::Password | NativeLoginStage::BoundPassword => {
                NativeLoginStage::PasswordSubmit
            }
            _ => return false,
        };
        let key = (origin.to_owned(), stage);
        let prepare = stage == NativeLoginStage::FormPrepare;
        let chain = if prepare {
            (origin.to_owned(), NativeLoginStage::Form)
        } else {
            key.clone()
        };
        // Script-filled adapters send no key, so "no key" proves nothing there.
        // A declarative pre-step click enters no key either: its grant is
        // never re-armed, so a click that reloads its page cannot repeat.
        if !(adapter == NativeLoginAdapter::ModularForm
            || adapter == NativeLoginAdapter::Declarative
            || adapter.reviewed_provider())
            || (adapter == NativeLoginAdapter::Declarative && prepare)
            || !self.released.contains(&key)
            || self.rearmed.contains(&chain)
            || self.released.contains(&(origin.to_owned(), submit))
            // A prepare whose fill was released is settled through that fill.
            || (prepare && self.released.contains(&chain))
            // A released password stage means the identifier was accepted,
            // possibly on another origin of the same provider.
            || (stage == NativeLoginStage::Identifier
                && self.released.iter().any(|(_, released)| {
                    matches!(
                        released,
                        NativeLoginStage::Password | NativeLoginStage::BoundPassword
                    )
                }))
        {
            return false;
        }
        self.released.remove(&key);
        if stage == NativeLoginStage::Form {
            // The modular chain starts again from its metadata stage.
            self.released
                .remove(&(origin.to_owned(), NativeLoginStage::FormPrepare));
        }
        self.rearmed.insert(chain)
    }
    pub fn reserve(
        &mut self,
        request: &NativeLoginRequest<'_>,
        credentials: &NativeLoginCredentials<'_>,
    ) -> bool {
        let metadata = request.stage == NativeLoginStage::FormPrepare || request.stage.is_action();
        if credentials.identity != request.identity
            || !request.adapter.accepts_stage(request.stage)
            || credentials.origin != request.origin
            || browser_origin(request.origin).as_deref() != Some(request.origin)
            || (!request.adapter.allows_http_credentials()
                && !request.origin.starts_with("https://"))
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
                NativeLoginStage::ScmConsent if credentials.auto_submit => None,
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
        } else if request.adapter == NativeLoginAdapter::Declarative {
            // Actions were settled above (same origin, credential stage first,
            // submit consent). The order between steps, across origins and
            // documents, is the steps' own: the browser host checks it with
            // `DeclarativeLoginPolicy::ready` before reserving. Here each
            // (origin, stage) is released once.
            if !matches!(
                request.stage,
                NativeLoginStage::FormPrepare
                    | NativeLoginStage::Identifier
                    | NativeLoginStage::Password
                    | NativeLoginStage::Form
            ) {
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

/// A JSON value of the native-owned login configuration, after
/// `parse_login_configuration` has bounded it. Built by the CEF layer; kept
/// free of CEF types so the steps rules are tested without the runtime.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum LoginJson {
    Null,
    Bool(bool),
    Number(f64),
    String(String),
    List(Vec<LoginJson>),
    Object(Vec<(String, LoginJson)>),
}

impl LoginJson {
    fn get(&self, key: &str) -> Option<&LoginJson> {
        match self {
            Self::Object(entries) => entries.iter().find(|(name, _)| name == key).map(|(_, v)| v),
            _ => None,
        }
    }
    fn keys_within(&self, allowed: &[&str]) -> bool {
        matches!(self, Self::Object(entries)
            if entries.iter().all(|(name, _)| allowed.contains(&name.as_str()))
                && entries.iter().enumerate().all(|(index, (name, _))|
                    entries[..index].iter().all(|(other, _)| other != name)))
    }
    fn text(&self) -> Option<&str> {
        match self {
            Self::String(value) => Some(value),
            _ => None,
        }
    }
    fn list(&self) -> Option<&[LoginJson]> {
        match self {
            Self::List(values) => Some(values),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum DeclarativeStepKind {
    Click,
    Identifier,
    Password,
    Form,
    Submit,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct DeclarativeStep {
    kind: DeclarativeStepKind,
    /// Concrete origin: the step's own, or the connection's.
    origin: String,
    paths: Vec<String>,
    prefixes: Vec<String>,
    /// DOM id or name of a direct same-origin child frame; None = top document.
    frame: Option<String>,
    /// `submit` only: the credential step it sends.
    submits: Option<DeclarativeStepKind>,
}

/// The host's copy of a reviewed steps file for one connection: where each
/// stage may run. It is parsed from the native-owned configuration with the
/// validator's structural and order rules (src/utils/connection/httpLoginSteps.ts)
/// and fails closed: anything it does not accept yields no policy at all, and
/// without a policy the declarative adapter releases nothing. Selectors are
/// checked for shape only; the page client applies them.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct DeclarativeLoginPolicy {
    connection_origin: String,
    password_only: bool,
    steps: Vec<DeclarativeStep>,
}

const DECLARATIVE_MAX_STEPS: usize = 16;
const DECLARATIVE_MAX_ORIGINS: usize = 8;
const DECLARATIVE_MAX_PATHS: usize = 16;
const DECLARATIVE_MAX_SELECTOR_UNITS: usize = 512;
const DECLARATIVE_MAX_PATH_BYTES: usize = 512;
const DECLARATIVE_MAX_FRAME_BYTES: usize = 128;

fn declarative_selector(value: &LoginJson) -> bool {
    value.text().is_some_and(|text| {
        let units = text.encode_utf16().count();
        units > 0
            && units <= DECLARATIVE_MAX_SELECTOR_UNITS
            && !text
                .chars()
                .any(|c| (c as u32) < 32 || (127..=159).contains(&(c as u32)))
            && !text.starts_with(' ')
            && !text.ends_with(' ')
    })
}

fn declarative_path(value: &str) -> bool {
    value.len() <= DECLARATIVE_MAX_PATH_BYTES && value.starts_with('/') && {
        let segments: Vec<&str> = value[1..].split('/').collect();
        segments.iter().enumerate().all(|(index, segment)| {
            if segment.is_empty() {
                index == segments.len() - 1
            } else {
                segment
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"._~-".contains(&b))
                    && *segment != "."
                    && *segment != ".."
            }
        })
    }
}

fn declarative_strings(
    value: &LoginJson,
    max: usize,
    valid: impl Fn(&str) -> bool,
) -> Option<Vec<String>> {
    let list = value.list()?;
    if list.is_empty() || list.len() > max {
        return None;
    }
    let mut entries = Vec::with_capacity(list.len());
    for entry in list {
        let text = entry.text()?;
        if !valid(text) || entries.iter().any(|seen| seen == text) {
            return None;
        }
        entries.push(text.to_owned());
    }
    Some(entries)
}

/// A listed origin: exact, canonical HTTPS. Private names are the validator's
/// to refuse; the host only needs the exact HTTPS form.
fn declarative_listed_origin(value: &str) -> bool {
    value.len() <= 512
        && value.starts_with("https://")
        && browser_origin(value).as_deref() == Some(value)
}

impl DeclarativeLoginPolicy {
    /// `configuration` is the whole factory configuration; only its
    /// `declarativeLogin` member is read here.
    pub(crate) fn parse(configuration: &LoginJson) -> Option<Self> {
        let login = configuration.get("declarativeLogin")?;
        if !login.keys_within(&[
            "connectionOrigin",
            "passwordOnly",
            "credentialOrigins",
            "loginSteps",
        ]) {
            return None;
        }
        let connection_origin = login.get("connectionOrigin")?.text()?;
        if connection_origin.len() > 2048
            || browser_origin(connection_origin).as_deref() != Some(connection_origin)
        {
            return None;
        }
        let password_only = match login.get("passwordOnly")? {
            LoginJson::Bool(value) => *value,
            _ => return None,
        };
        let listed = match login.get("credentialOrigins")? {
            LoginJson::List(values) if values.is_empty() => Vec::new(),
            value => {
                declarative_strings(value, DECLARATIVE_MAX_ORIGINS, declarative_listed_origin)?
            }
        };
        let raw = login.get("loginSteps")?.list()?;
        if raw.is_empty() || raw.len() > DECLARATIVE_MAX_STEPS {
            return None;
        }
        let mut steps: Vec<DeclarativeStep> = Vec::with_capacity(raw.len());
        for value in raw {
            let kind = match value.get("kind")?.text()? {
                "click" => DeclarativeStepKind::Click,
                "identifier" => DeclarativeStepKind::Identifier,
                "password" => DeclarativeStepKind::Password,
                "form" => DeclarativeStepKind::Form,
                "submit" => DeclarativeStepKind::Submit,
                _ => return None,
            };
            if password_only
                && matches!(
                    kind,
                    DeclarativeStepKind::Identifier | DeclarativeStepKind::Form
                )
            {
                return None;
            }
            if let Some(wait) = value.get("waitFor") {
                if !declarative_selector(wait) {
                    return None;
                }
            }
            if kind == DeclarativeStepKind::Submit {
                let submission = value.get("submission")?.text()?;
                let control = match submission {
                    "click" | "spa" => true,
                    "enter" => false,
                    _ => return None,
                };
                let allowed: &[&str] = if control {
                    &["kind", "submission", "waitFor", "selectors"]
                } else {
                    &["kind", "submission", "waitFor"]
                };
                if !value.keys_within(allowed) {
                    return None;
                }
                if control {
                    let selectors = value.get("selectors")?;
                    if !selectors.keys_within(&["control"])
                        || !declarative_selector(selectors.get("control")?)
                    {
                        return None;
                    }
                }
                // Directly after the credential step it submits, in its scope.
                let target = steps.last()?;
                if !matches!(
                    target.kind,
                    DeclarativeStepKind::Identifier
                        | DeclarativeStepKind::Password
                        | DeclarativeStepKind::Form
                ) {
                    return None;
                }
                let submits = target.kind;
                let step = DeclarativeStep {
                    kind,
                    origin: target.origin.clone(),
                    paths: target.paths.clone(),
                    prefixes: target.prefixes.clone(),
                    frame: target.frame.clone(),
                    submits: Some(submits),
                };
                steps.push(step);
                continue;
            }
            if !value.keys_within(&[
                "kind",
                "origin",
                "paths",
                "pathPrefixes",
                "frame",
                "waitFor",
                "selectors",
            ]) {
                return None;
            }
            let origin = match value.get("origin") {
                None => connection_origin.to_owned(),
                Some(origin) => {
                    let origin = origin.text()?;
                    if !declarative_listed_origin(origin) || !listed.iter().any(|o| o == origin) {
                        return None;
                    }
                    origin.to_owned()
                }
            };
            let paths = match value.get("paths") {
                None => Vec::new(),
                Some(list) => declarative_strings(list, DECLARATIVE_MAX_PATHS, declarative_path)?,
            };
            let prefixes = match value.get("pathPrefixes") {
                None => Vec::new(),
                Some(list) => declarative_strings(list, DECLARATIVE_MAX_PATHS, |p| {
                    declarative_path(p) && p.len() > 1 && p.ends_with('/')
                })?,
            };
            let frame = match value.get("frame") {
                None => None,
                Some(frame) => {
                    let frame = frame.text()?;
                    if frame.is_empty()
                        || frame.len() > DECLARATIVE_MAX_FRAME_BYTES
                        || !frame
                            .bytes()
                            .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
                    {
                        return None;
                    }
                    Some(frame.to_owned())
                }
            };
            let keys: &[&str] = match kind {
                DeclarativeStepKind::Click => &["control"],
                DeclarativeStepKind::Identifier => &["username"],
                DeclarativeStepKind::Password => &["password"],
                DeclarativeStepKind::Form => &["username", "password"],
                DeclarativeStepKind::Submit => return None,
            };
            let selectors = value.get("selectors")?;
            if !selectors.keys_within(keys)
                || !keys
                    .iter()
                    .all(|key| selectors.get(key).is_some_and(declarative_selector))
            {
                return None;
            }
            steps.push(DeclarativeStep {
                kind,
                origin,
                paths,
                prefixes,
                frame,
                submits: None,
            });
        }
        let policy = Self {
            connection_origin: connection_origin.to_owned(),
            password_only,
            steps,
        };
        (policy.sequence_valid() && policy.frames().len() <= 8).then_some(policy)
    }

    /// The validator's order rules on concrete origins (`checkSequence`).
    fn sequence_valid(&self) -> bool {
        use DeclarativeStepKind::*;
        let credential = |kind| matches!(kind, Identifier | Password | Form);
        if !self.steps.iter().any(|step| credential(step.kind)) {
            return false;
        }
        let mut typed = HashSet::new();
        let mut submitted = HashSet::new();
        let mut clicked = HashSet::new();
        let mut username_seen = false;
        for (index, step) in self.steps.iter().enumerate() {
            match step.kind {
                Identifier | Password | Form => {
                    let fields: &[&str] = match step.kind {
                        Form => &["username", "password"],
                        Identifier => &["username"],
                        _ => &["password"],
                    };
                    for field in fields {
                        if !typed.insert((*field, step.origin.as_str())) {
                            return false;
                        }
                    }
                    if step.kind == Password && !username_seen && !self.password_only {
                        return false;
                    }
                    if step.kind != Password {
                        username_seen = true;
                    }
                }
                Click => {
                    // One pre-step per origin: its grant is one release per
                    // origin and attempt. A second would never be granted.
                    if !clicked.insert(step.origin.as_str())
                        || !self.steps[index + 1..]
                            .iter()
                            .any(|later| credential(later.kind) && later.origin == step.origin)
                    {
                        return false;
                    }
                }
                Submit => {
                    let stage = if step.submits == Some(Identifier) {
                        "identifier"
                    } else {
                        "password"
                    };
                    if !submitted.insert((stage, step.origin.as_str())) {
                        return false;
                    }
                }
            }
        }
        true
    }

    /// Unique frame names the steps use, in file order.
    pub(crate) fn frames(&self) -> Vec<String> {
        let mut names: Vec<String> = Vec::new();
        for frame in self.steps.iter().filter_map(|step| step.frame.as_ref()) {
            if !names.contains(frame) {
                names.push(frame.clone());
            }
        }
        names
    }

    fn matches(step: &DeclarativeStep, origin: &str, path: &str, main_frame: bool) -> bool {
        step.origin == origin
            && step.frame.is_none() == main_frame
            && ((step.paths.is_empty() && step.prefixes.is_empty())
                || step.paths.iter().any(|p| p == path)
                || step.prefixes.iter().any(|p| path.starts_with(p.as_str())))
    }

    fn kind_for(step: &DeclarativeStep, stage: NativeLoginStage) -> bool {
        use DeclarativeStepKind::*;
        match stage {
            NativeLoginStage::FormPrepare => step.kind == Click,
            NativeLoginStage::Identifier => step.kind == Identifier,
            NativeLoginStage::Password => step.kind == Password,
            NativeLoginStage::Form => step.kind == Form,
            NativeLoginStage::IdentifierSubmit => step.submits == Some(Identifier),
            NativeLoginStage::PasswordSubmit => step.submits == Some(Password),
            NativeLoginStage::FormSubmit => step.submits == Some(Form),
            NativeLoginStage::BoundPassword => false,
            NativeLoginStage::ScmConsent => false,
        }
    }

    /// The step this stage would run as in the document at `url`, if any:
    /// its origin, its path gate on the LIVE address, and top document or
    /// child frame. Listed origins are HTTPS; only the connection's own origin
    /// may be HTTP.
    fn step_for(&self, stage: NativeLoginStage, url: &str, main_frame: bool) -> Option<usize> {
        let origin = browser_origin(url)?;
        if !origin.starts_with("https://") && origin != self.connection_origin {
            return None;
        }
        let parsed = url::Url::parse(url).ok()?;
        let path = parsed.path();
        self.steps.iter().position(|step| {
            Self::kind_for(step, stage) && Self::matches(step, &origin, path, main_frame)
        })
    }

    pub(crate) fn allows(&self, stage: NativeLoginStage, url: &str, main_frame: bool) -> bool {
        self.step_for(stage, url, main_frame).is_some()
    }

    /// The pending position: every credential step before this one has been
    /// released in this attempt (on its own origin), and this stage has not.
    /// A page reloaded at a later stage therefore cannot ask for an earlier or
    /// the same release again, and a later stage never runs first.
    pub(crate) fn ready(
        &self,
        stage: NativeLoginStage,
        url: &str,
        main_frame: bool,
        released: impl Fn(&str, NativeLoginStage) -> bool,
    ) -> bool {
        use DeclarativeStepKind::*;
        let Some(index) = self.step_for(stage, url, main_frame) else {
            return false;
        };
        let step = &self.steps[index];
        if released(&step.origin, stage) {
            return false;
        }
        let credential_stage = |kind| match kind {
            Identifier => Some(NativeLoginStage::Identifier),
            Password => Some(NativeLoginStage::Password),
            Form => Some(NativeLoginStage::Form),
            _ => None,
        };
        // A submit sends the credential step directly before it.
        let before = if step.kind == Submit {
            index.saturating_sub(1)
        } else {
            index
        };
        self.steps[..before].iter().all(|earlier| {
            credential_stage(earlier.kind)
                .is_none_or(|earlier_stage| released(&earlier.origin, earlier_stage))
        }) && (step.kind != Submit
            || credential_stage(self.steps[index - 1].kind)
                .is_some_and(|previous| released(&step.origin, previous)))
    }
}

#[cfg(test)]
mod rejection_tests {
    use super::*;

    #[test]
    fn every_rejection_cause_round_trips_through_its_fixed_wire_name() {
        let mut seen = std::collections::HashSet::new();
        for cause in NativeLoginRejection::ALL {
            assert!(seen.insert(cause.wire()), "duplicate wire {}", cause.wire());
            assert_eq!(NativeLoginRejection::parse(cause.wire()), Some(cause));
            assert_eq!(
                NativeLoginRejection::from_page_event(&format!("form-rejected|{}", cause.wire())),
                Some(cause)
            );
            // The renderer passes the status in a 40-byte message slot.
            assert!(cause.status().len() <= 40, "{}", cause.status());
            assert_eq!(
                NativeLoginRejection::feature_status(&cause.status()),
                Some(NativeFeatureStatus::LoginAdapterStopped(cause))
            );
        }
        assert_eq!(seen.len(), 9);
    }

    #[test]
    fn only_exact_fixed_causes_are_accepted_from_page_events() {
        for event in [
            "form-rejected",
            "form-rejected|",
            "form-rejected|Expired",
            "form-rejected|expired ",
            "form-rejected|expired|x",
            "form-rejected|wrong password for alice@example.test",
            "form-completed|expired",
            "google-rejected|expired",
            "expired",
        ] {
            assert_eq!(
                NativeLoginRejection::from_page_event(event),
                None,
                "{event}"
            );
        }
        for status in [
            "login-rejected",
            "login-rejected:",
            "login-rejected:other",
            "expired",
        ] {
            assert_eq!(
                NativeLoginRejection::feature_status(status),
                None,
                "{status}"
            );
        }
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
        assert!(stage_allowed(
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
            assert_eq!(
                stage_allowed(
                    adapter,
                    NativeLoginStage::Identifier,
                    &url.replacen("https:", "http:", 1)
                ),
                matches!(adapter, NativeLoginAdapter::Bitwarden | NativeLoginAdapter::Synology),
                "only the self-hosted provider contracts admit HTTP"
            );
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
            path: "/",
            frame: None,
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

    fn reserve_stage(
        budget: &mut LoginBudget,
        policy: &OriginBrowserPolicy,
        adapter: NativeLoginAdapter,
        origin: &str,
        stage: NativeLoginStage,
    ) -> bool {
        let metadata = stage.is_action() || stage == NativeLoginStage::FormPrepare;
        budget.reserve(
            &NativeLoginRequest {
                identity: policy.identity(),
                origin,
                adapter,
                stage,
                path: "/",
                frame: None,
            },
            &NativeLoginCredentials {
                identity: policy.identity(),
                origin,
                valid_until: Instant::now() + Duration::from_secs(30),
                username: if metadata { "" } else { "synthetic-user" },
                password: if metadata { "" } else { "synthetic-password" },
                auto_submit: true,
            },
        )
    }

    // Finding M2: one interrupted start used to end automatic login for the
    // whole attempt. The typing host reports a stage it never sent a key for.
    #[test]
    fn a_release_cancelled_before_its_first_key_is_reserved_once_more_and_never_a_third_time() {
        use NativeLoginStage::{Form, FormPrepare};
        let (adapter, origin) = (NativeLoginAdapter::ModularForm, "https://device.test");
        let policy = OriginBrowserPolicy::new("owner", "connection", "tab", origin).unwrap();
        let mut budget = LoginBudget::default();
        let reserve = |budget: &mut LoginBudget, stage| {
            reserve_stage(budget, &policy, adapter, origin, stage)
        };
        // Nothing can be cancelled before it was released.
        assert!(!budget.cancelled(adapter, origin, Form));
        assert!(reserve(&mut budget, FormPrepare));
        assert!(reserve(&mut budget, Form));
        // A live release stays exclusive: a reload cannot take it again.
        assert!(!reserve(&mut budget, FormPrepare));
        assert!(!reserve(&mut budget, Form));
        assert!(budget.cancelled(adapter, origin, Form));
        // The old document can no longer type under the withdrawn release.
        assert!(!budget.released(origin, Form));
        assert!(reserve(&mut budget, FormPrepare));
        assert!(reserve(&mut budget, Form));
        // The second release is live again, and it is the last one.
        assert!(!reserve(&mut budget, FormPrepare));
        assert!(!reserve(&mut budget, Form));
        assert!(!budget.cancelled(adapter, origin, Form));
        assert!(budget.released(origin, Form));
        assert!(!reserve(&mut budget, FormPrepare));
        assert!(!reserve(&mut budget, Form));
    }

    #[test]
    fn a_rearmed_release_never_allows_two_submits_for_one_origin() {
        use NativeLoginStage::{Form, FormPrepare, FormSubmit};
        let (adapter, origin) = (NativeLoginAdapter::ModularForm, "https://device.test");
        let policy = OriginBrowserPolicy::new("owner", "connection", "tab", origin).unwrap();
        let reserve = |budget: &mut LoginBudget, stage| {
            reserve_stage(budget, &policy, adapter, origin, stage)
        };
        // A re-armed fill submits exactly once.
        let mut budget = LoginBudget::default();
        assert!(reserve(&mut budget, FormPrepare));
        assert!(reserve(&mut budget, Form));
        assert!(budget.cancelled(adapter, origin, Form));
        // The submit of the withdrawn fill cannot be taken on its own.
        assert!(!reserve(&mut budget, FormSubmit));
        assert!(reserve(&mut budget, FormPrepare));
        assert!(reserve(&mut budget, Form));
        assert!(reserve(&mut budget, FormSubmit));
        assert!(!reserve(&mut budget, FormSubmit));
        for stage in [Form, FormPrepare, FormSubmit] {
            assert!(!budget.cancelled(adapter, origin, stage));
            assert!(!reserve(&mut budget, stage));
        }
        // Once the submit was released nothing for that origin is re-armed.
        let mut budget = LoginBudget::default();
        assert!(reserve(&mut budget, FormPrepare));
        assert!(reserve(&mut budget, Form));
        assert!(reserve(&mut budget, FormSubmit));
        assert!(!budget.cancelled(adapter, origin, Form));
        for stage in [FormPrepare, Form, FormSubmit] {
            assert!(!reserve(&mut budget, stage));
        }
        // A submit cannot report itself cancelled, nor can a prepare stage
        // whose fill was released: that chain is settled through its fill.
        let mut budget = LoginBudget::default();
        assert!(reserve(&mut budget, FormPrepare));
        assert!(reserve(&mut budget, Form));
        assert!(!budget.cancelled(adapter, origin, FormPrepare));
        assert!(!budget.cancelled(adapter, origin, FormSubmit));
        assert!(!reserve(&mut budget, FormPrepare));
        assert!(!reserve(&mut budget, Form));
    }

    // A document that reserved only the metadata stage and then went away
    // used to block every later document of that origin for the whole attempt.
    #[test]
    fn a_prepare_only_release_is_rearmed_once_and_only_while_its_fill_is_unreleased() {
        use NativeLoginStage::{Form, FormPrepare, FormSubmit};
        let (adapter, origin) = (NativeLoginAdapter::ModularForm, "https://device.test");
        let policy = OriginBrowserPolicy::new("owner", "connection", "tab", origin).unwrap();
        let reserve = |budget: &mut LoginBudget, stage| {
            reserve_stage(budget, &policy, adapter, origin, stage)
        };
        let mut budget = LoginBudget::default();
        assert!(!budget.cancelled(adapter, origin, FormPrepare));
        assert!(reserve(&mut budget, FormPrepare));
        // A live prepare stays exclusive.
        assert!(!reserve(&mut budget, FormPrepare));
        assert!(budget.cancelled(adapter, origin, FormPrepare));
        // The replaced document cannot take the fill under its withdrawn prepare.
        assert!(!budget.released(origin, FormPrepare));
        assert!(!reserve(&mut budget, Form));
        assert!(reserve(&mut budget, FormPrepare));
        // The chain was re-armed once: no third prepare, and no second fill.
        assert!(!budget.cancelled(adapter, origin, FormPrepare));
        assert!(!reserve(&mut budget, FormPrepare));
        assert!(reserve(&mut budget, Form));
        assert!(!budget.cancelled(adapter, origin, Form));
        assert!(!budget.cancelled(adapter, origin, FormPrepare));
        assert!(!reserve(&mut budget, FormPrepare));
        assert!(!reserve(&mut budget, Form));
        assert!(reserve(&mut budget, FormSubmit));
        assert!(!reserve(&mut budget, FormSubmit));
        // Re-armed at the fill instead: a later prepare-only document does not
        // get a third prepare either.
        let mut budget = LoginBudget::default();
        assert!(reserve(&mut budget, FormPrepare));
        assert!(reserve(&mut budget, Form));
        assert!(budget.cancelled(adapter, origin, Form));
        assert!(reserve(&mut budget, FormPrepare));
        assert!(!budget.cancelled(adapter, origin, FormPrepare));
        assert!(!reserve(&mut budget, FormPrepare));
        assert!(reserve(&mut budget, Form));
        assert!(!reserve(&mut budget, Form));
        // Another origin's prepare is its own chain.
        assert!(!budget.cancelled(adapter, "https://other.test", FormPrepare));
        assert!(budget.released(origin, FormPrepare));
    }

    #[test]
    fn only_key_typed_adapters_rearm_and_only_the_cancelled_origin_and_stage() {
        use NativeLoginStage::{
            BoundPassword, Form, Identifier, IdentifierSubmit, Password, PasswordSubmit,
        };
        let origin = "https://fixture.test";
        let policy = OriginBrowserPolicy::new("owner", "connection", "tab", origin).unwrap();
        // Script-filled adapters send no key, so "no key" proves nothing there.
        for adapter in [
            NativeLoginAdapter::Generic,
            NativeLoginAdapter::ExchangeOwa,
            NativeLoginAdapter::VodafoneSmartRouter,
        ] {
            let mut budget = LoginBudget::default();
            assert!(reserve_stage(&mut budget, &policy, adapter, origin, Form));
            assert!(!budget.cancelled(adapter, origin, Form));
            assert!(!reserve_stage(&mut budget, &policy, adapter, origin, Form));
        }
        let provider = NativeLoginAdapter::Bitwarden;
        let reserve = |budget: &mut LoginBudget, stage| {
            reserve_stage(budget, &policy, provider, origin, stage)
        };
        let mut budget = LoginBudget::default();
        assert!(reserve(&mut budget, Identifier));
        // Another origin or stage does not re-arm this one.
        assert!(!budget.cancelled(provider, "https://other.test", Identifier));
        assert!(!budget.cancelled(provider, origin, Password));
        assert!(!reserve(&mut budget, Identifier));
        assert!(budget.cancelled(provider, origin, Identifier));
        assert!(reserve(&mut budget, Identifier));
        assert!(!budget.cancelled(provider, origin, Identifier));
        assert!(!reserve(&mut budget, Identifier));
        assert!(reserve(&mut budget, Password));
        // The identifier was accepted: it is spent, the password is not.
        assert!(!budget.cancelled(provider, origin, Identifier));
        assert!(budget.cancelled(provider, origin, Password));
        // The alternative password stage stays exclusive with the released one.
        assert!(reserve(&mut budget, Password));
        assert!(!reserve_stage(
            &mut budget,
            &policy,
            NativeLoginAdapter::ChatGpt,
            origin,
            BoundPassword
        ));
        assert!(reserve(&mut budget, PasswordSubmit));
        assert!(!budget.cancelled(provider, origin, Password));
        assert!(!reserve(&mut budget, Password));
        assert!(!reserve(&mut budget, PasswordSubmit));
        // An identifier whose submit was released is spent.
        let mut budget = LoginBudget::default();
        assert!(reserve(&mut budget, Identifier));
        assert!(reserve(&mut budget, IdentifierSubmit));
        assert!(!budget.cancelled(provider, origin, Identifier));
        assert!(!reserve(&mut budget, Identifier));
        assert!(!reserve(&mut budget, IdentifierSubmit));
    }

    #[test]
    fn retry_steps_have_exactly_two_fixed_wire_names() {
        for step in [NativeLoginRetryStep::Credentials, NativeLoginRetryStep::Mfa] {
            assert_eq!(NativeLoginRetryStep::parse(step.wire()), Some(step));
        }
        for other in ["", "Credentials", "mfa ", "totp", "password", "credentials|mfa"] {
            assert_eq!(NativeLoginRetryStep::parse(other), None);
        }
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
            path: "/",
            frame: None,
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
                path: "/",
                frame: None,
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
                    path: "/",
                    frame: None,
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
    fn secure_capability_origins_exclude_inherited_opaque_cleartext_and_userinfo() {
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
    fn browser_origins_preserve_http_scheme_and_custom_port_without_secure_grants() {
        for (url, origin) in [
            ("http://DEVICE.test:8080/login?q=x#f", "http://device.test:8080"),
            ("http://device.test:80/login", "http://device.test"),
            ("https://device.test:8443/login", "https://device.test:8443"),
            ("http://[::1]:8080/login", "http://[::1]:8080"),
        ] {
            assert_eq!(browser_origin(url).as_deref(), Some(origin));
            if origin.starts_with("http://") {
                assert_eq!(https_origin(url), None);
            }
        }
        for url in [
            "about:blank", "data:text/html,x", "file:///login.html",
            "blob:http://device.test/id", "ftp://device.test", "ws://device.test",
            "http://user:pass@device.test", "http://device.test\\@evil.test",
            "http://device.test\n", "http://",
        ] {
            assert_eq!(browser_origin(url), None, "{url}");
        }
    }

    #[test]
    fn http_login_stages_support_generic_modular_and_self_hosted_contracts() {
        use NativeLoginAdapter::*;
        use NativeLoginStage::*;
        for (adapter, stage, path) in [
            (Generic, Form, "/login"),
            (ModularForm, FormPrepare, "/login"),
            (ModularForm, Form, "/login"),
            (ModularForm, FormSubmit, "/login"),
            (Bitwarden, Identifier, "/#/login"),
            (Bitwarden, Password, "/#/login"),
            (Bitwarden, PasswordSubmit, "/#/login"),
            (Synology, Identifier, "/#/signin"),
            (Synology, Password, "/#/signin/password"),
            (Synology, PasswordSubmit, "/#/signin/password"),
            (Yealink, Form, "/servlet?p=login"),
            (Yealink, FormSubmit, "/servlet?p=login"),
            (ExchangeEcp, Form, "/owa/auth/logon.aspx?reason=0"),
            (ExchangeOwa, Form, "/owa/auth/logon.aspx?reason=0"),
            (VodafoneSmartRouter, Form, "/login"),
        ] {
            let url = format!("http://device.test:8080{path}");
            assert!(stage_allowed(adapter, stage, &url), "{adapter:?} {stage:?}");
        }
        for adapter in [ExchangeEcp, ExchangeOwa] {
            assert!(!stage_allowed(adapter, Form, "http://device.test:8080/owa/auth/logon.aspx?reason=2"));
            assert!(!stage_allowed(adapter, Form, "http://device.test:8080/owa/auth/change.aspx"));
        }
        assert!(!stage_allowed(Synology, Password, "http://device.test:8080/#/signin"));
        for adapter in [Manual, Unsupported] {
            assert!(!stage_allowed(adapter, Form, "http://device.test:8080/login"));
        }
    }

    #[test]
    fn fixed_public_provider_stages_and_budgets_stay_https_only() {
        use NativeLoginAdapter::*;
        use NativeLoginStage::*;
        for (adapter, stage, url) in [
            (Porkbun, Form, "https://porkbun.com/account/login"),
            (Google, Identifier, "https://accounts.google.com/v3/signin/identifier"),
            (Cloudflare, Identifier, "https://dash.cloudflare.com/login"),
            (Adobe, Identifier, "https://auth.services.adobe.com/en_US/index.html"),
            (ChatGpt, Identifier, "https://auth.openai.com/log-in"),
            (Claude, Identifier, "https://claude.ai/login"),
        ] {
            assert!(stage_allowed(adapter, stage, url));
            let http = url.replacen("https://", "http://", 1);
            assert!(!stage_allowed(adapter, stage, &http));
            let origin = browser_origin(&http).unwrap();
            let policy = OriginBrowserPolicy::new("owner", "connection", "tab", &origin).unwrap();
            let request = NativeLoginRequest { identity: policy.identity(), origin: &origin, adapter, stage , path: "/", frame: None };
            let credentials = NativeLoginCredentials {
                identity: policy.identity(), origin: &origin,
                valid_until: Instant::now() + Duration::from_secs(30),
                username: "synthetic-user", password: "synthetic-password", auto_submit: true,
            };
            assert!(!LoginBudget::default().reserve(&request, &credentials));
        }
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
            assert!(stage_allowed(
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
            path: "/",
            frame: None,
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
    fn scm_approval_is_action_only_https_and_once_per_attempt() {
        let policy = OriginBrowserPolicy::new("db", "connection", "tab", "https://git.example.test").unwrap();
        let request = NativeLoginRequest { identity: policy.identity(), origin: policy.source_origin(), adapter: NativeLoginAdapter::ModularForm, stage: NativeLoginStage::ScmConsent, path: "/login/oauth/authorize", frame: None };
        let mut credentials = NativeLoginCredentials { identity: policy.identity(), origin: request.origin, username: "", password: "", auto_submit: false, valid_until: Instant::now() + Duration::from_secs(10) };
        let mut budget = LoginBudget::default();
        assert!(!budget.reserve(&request, &credentials));
        credentials.auto_submit = true;
        assert!(budget.reserve(&request, &credentials));
        assert!(!budget.reserve(&request, &credentials));
        assert!(stage_allowed(request.adapter, request.stage, "https://git.example.test/login/oauth/authorize"));
        assert!(!stage_allowed(request.adapter, request.stage, "http://git.example.test/login/oauth/authorize"));
        assert!(!stage_allowed(request.adapter, request.stage, "https://git.example.test/user/login"));
        assert_eq!(request.stage.fields(&credentials), ("", ""));
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
            path: "/",
            frame: None,
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

    #[test]
    fn http_disclosure_still_requires_exact_consent_owner_origin_port_and_expiry() {
        let origin = "http://device.test:8080";
        let policy = OriginBrowserPolicy::new("owner", "connection", "tab", origin).unwrap();
        let other = OriginBrowserPolicy::new("owner", "connection", "tab", origin).unwrap();
        let request = NativeLoginRequest {
            identity: policy.identity(), origin,
            adapter: NativeLoginAdapter::Generic, stage: NativeLoginStage::Form,
            path: "/",
            frame: None,
        };
        let mut credentials = NativeLoginCredentials {
            identity: policy.identity(), origin,
            valid_until: Instant::now() + Duration::from_secs(30),
            username: "synthetic-user", password: "synthetic-password", auto_submit: false,
        };
        let mut budget = LoginBudget::default();
        for other_origin in [
            "https://device.test:8080", "http://device.test", "http://device.test:8081",
            "http://sub.device.test:8080", "http://device.test:8080/login",
        ] {
            credentials.origin = other_origin;
            assert!(!budget.reserve(&request, &credentials));
        }
        credentials.origin = origin;
        credentials.identity = other.identity();
        assert!(!budget.reserve(&request, &credentials));
        credentials.identity = policy.identity();
        credentials.valid_until = Instant::now();
        assert!(!budget.reserve(&request, &credentials));
        credentials.valid_until = Instant::now() + Duration::from_secs(30);
        assert!(budget.reserve(&request, &credentials));
        assert!(!budget.reserve(&request, &credentials));
    }

    #[test]
    fn http_password_budget_cannot_reuse_https_or_another_port_identifier_stage() {
        let origin = "http://device.test:8080";
        let policy = OriginBrowserPolicy::new("owner", "connection", "tab", origin).unwrap();
        let mut request = NativeLoginRequest {
            identity: policy.identity(), origin,
            adapter: NativeLoginAdapter::Bitwarden, stage: NativeLoginStage::Identifier,
            path: "/",
            frame: None,
        };
        let mut credentials = NativeLoginCredentials {
            identity: policy.identity(), origin,
            valid_until: Instant::now() + Duration::from_secs(30),
            username: "synthetic-user", password: "synthetic-password", auto_submit: true,
        };
        let mut budget = LoginBudget::default();
        for identifier_origin in ["https://device.test:8080", "http://device.test:8081"] {
            request.origin = identifier_origin;
            credentials.origin = identifier_origin;
            assert!(budget.reserve(&request, &credentials));
        }
        request.origin = origin;
        credentials.origin = origin;
        request.stage = NativeLoginStage::Password;
        assert!(!budget.reserve(&request, &credentials));
        request.stage = NativeLoginStage::Identifier;
        assert!(budget.reserve(&request, &credentials));
        request.stage = NativeLoginStage::Password;
        assert!(budget.reserve(&request, &credentials));
    }
}

#[cfg(test)]
mod declarative_tests {
    use super::*;
    use sorng_protocols::origin_browser::OriginBrowserPolicy;
    use std::time::Duration;
    use NativeLoginStage::*;

    fn json(value: &serde_json::Value) -> LoginJson {
        match value {
            serde_json::Value::Null => LoginJson::Null,
            serde_json::Value::Bool(v) => LoginJson::Bool(*v),
            serde_json::Value::Number(v) => LoginJson::Number(v.as_f64().unwrap()),
            serde_json::Value::String(v) => LoginJson::String(v.clone()),
            serde_json::Value::Array(v) => LoginJson::List(v.iter().map(json).collect()),
            serde_json::Value::Object(v) => {
                LoginJson::Object(v.iter().map(|(k, v)| (k.clone(), json(v))).collect())
            }
        }
    }

    fn configuration(origin: &str, file: serde_json::Value) -> LoginJson {
        json(&serde_json::json!({
            "declarativeLogin": {
                "connectionOrigin": origin,
                "passwordOnly": file.get("passwordOnly").cloned().unwrap_or(false.into()),
                "credentialOrigins": file["credentialOrigins"],
                "loginSteps": file["loginSteps"],
            },
            "readiness": {"detectionTimeoutMs": 8000},
        }))
    }

    const MS: &str = "https://login.microsoftonline.com";

    fn identifier_first() -> serde_json::Value {
        serde_json::json!({
            "credentialOrigins": [MS],
            "loginSteps": [
                {"kind": "identifier", "origin": MS, "paths": ["/common/oauth2/v2.0/authorize"],
                 "selectors": {"username": "input#i0116"}},
                {"kind": "submit", "submission": "click", "selectors": {"control": "#idSIButton9"}},
                {"kind": "password", "origin": MS, "paths": ["/common/oauth2/v2.0/authorize"],
                 "selectors": {"password": "input#i0118"}},
                {"kind": "submit", "submission": "click", "selectors": {"control": "#idSIButton9"}}
            ]
        })
    }

    fn policy(origin: &str, file: serde_json::Value) -> Option<DeclarativeLoginPolicy> {
        DeclarativeLoginPolicy::parse(&configuration(origin, file))
    }

    #[test]
    fn adapter_is_selected_by_reserved_id_and_has_exactly_its_stages() {
        let adapter = NativeLoginAdapter::Declarative;
        assert_eq!(NativeLoginAdapter::from_wire("declarative-steps"), adapter);
        assert_eq!(adapter.wire(), "declarative-steps");
        assert_eq!(
            NativeLoginAdapter::from_application_id("declarative-steps"),
            adapter
        );
        assert!(!adapter.reviewed_provider());
        for stage in [
            Identifier,
            Password,
            Form,
            FormPrepare,
            IdentifierSubmit,
            PasswordSubmit,
            FormSubmit,
        ] {
            assert!(adapter.accepts_stage(stage), "{stage:?}");
        }
        assert!(!adapter.accepts_stage(BoundPassword));
        assert!(!stage_allowed(
            adapter,
            BoundPassword,
            "https://device.test/login"
        ));
    }

    #[test]
    fn every_reviewed_steps_file_parses_for_https_and_http_connections() {
        let root =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../src/data/loginSteps");
        let mut count = 0;
        for family in std::fs::read_dir(&root).unwrap() {
            for file in std::fs::read_dir(family.unwrap().path()).unwrap() {
                let path = file.unwrap().path();
                let value: serde_json::Value =
                    serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
                for origin in ["https://device.example:8443", "http://192.168.1.10:8080"] {
                    let parsed = policy(origin, value.clone());
                    assert!(parsed.is_some(), "{} with {origin}", path.display());
                }
                count += 1;
            }
        }
        assert!(count > 0, "{count}");
    }

    #[test]
    fn invalid_or_unsupported_steps_yield_no_policy() {
        let origin = "https://device.test";
        let base = identifier_first();
        assert!(policy(origin, base.clone()).is_some());
        let mut cases: Vec<serde_json::Value> = Vec::new();
        let mut edit = |change: &dyn Fn(&mut serde_json::Value)| {
            let mut file = base.clone();
            change(&mut file);
            cases.push(file);
        };
        edit(&|f| f["credentialOrigins"] = serde_json::json!([]));
        edit(&|f| f["credentialOrigins"] = serde_json::json!(["http://login.microsoftonline.com"]));
        edit(&|f| f["loginSteps"][0]["origin"] = "https://evil.test".into());
        edit(&|f| f["loginSteps"][0]["unknown"] = true.into());
        edit(&|f| f["loginSteps"][0]["kind"] = "type".into());
        edit(&|f| f["loginSteps"][0]["selectors"]["password"] = "#p".into());
        edit(&|f| f["loginSteps"][0]["selectors"]["username"] = "a\u{7}b".into());
        edit(&|f| f["loginSteps"][0]["selectors"]["username"] = "x".repeat(513).into());
        edit(&|f| f["loginSteps"][0]["paths"] = serde_json::json!(["/a/../b"]));
        edit(&|f| f["loginSteps"][0]["paths"] = serde_json::json!([]));
        edit(&|f| f["loginSteps"][0]["frame"] = "a.b".into());
        edit(&|f| f["loginSteps"][1]["submission"] = "auto".into());
        edit(&|f| f["loginSteps"][1]["origin"] = MS.into());
        edit(&|f| {
            f["loginSteps"].as_array_mut().unwrap().remove(0);
        });
        edit(&|f| {
            f["loginSteps"].as_array_mut().unwrap().swap(0, 1);
        });
        edit(&|f| f["passwordOnly"] = true.into());
        edit(&|f| f["loginSteps"] = serde_json::json!([]));
        edit(&|f| {
            let step = f["loginSteps"][0].clone();
            f["loginSteps"] = serde_json::Value::Array(vec![step; 17]);
        });
        edit(&|f| {
            let steps = f["loginSteps"].as_array_mut().unwrap();
            steps.push(serde_json::json!({"kind": "click", "selectors": {"control": "#later"}}));
        });
        edit(&|f| {
            let steps = f["loginSteps"].as_array_mut().unwrap();
            let again = steps[2].clone();
            steps.push(again);
        });
        edit(&|f| {
            let steps = f["loginSteps"].as_array_mut().unwrap();
            for name in ["#cookies", "#open"] {
                steps.insert(0, serde_json::json!({"kind": "click", "origin": MS, "selectors": {"control": name}}));
            }
        });
        for (index, file) in cases.into_iter().enumerate() {
            assert!(policy(origin, file).is_none(), "case {index}");
        }
        for bad in [
            "https://device.test/",
            "device.test",
            "ftp://device.test",
            "https://u:p@device.test",
        ] {
            assert!(policy(bad, base.clone()).is_none(), "{bad}");
        }
        let mut config = configuration(origin, base.clone());
        if let LoginJson::Object(entries) = &mut config {
            if let LoginJson::Object(login) = &mut entries[0].1 {
                login.push(("extra".into(), LoginJson::Bool(true)));
            }
        }
        assert!(DeclarativeLoginPolicy::parse(&config).is_none());
    }

    #[test]
    fn stages_run_only_on_their_step_origin_live_path_and_frame() {
        let p = policy("https://outlook.office.com", identifier_first()).unwrap();
        let at = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?x=1";
        for stage in [Identifier, IdentifierSubmit, Password, PasswordSubmit] {
            assert!(p.allows(stage, at, true), "{stage:?}");
            assert!(
                !p.allows(stage, at, false),
                "a child frame is not the step's document"
            );
            assert!(!p.allows(stage, "https://login.microsoftonline.com/other", true));
            assert!(!p.allows(
                stage,
                "https://outlook.office.com/common/oauth2/v2.0/authorize",
                true
            ));
            assert!(!p.allows(
                stage,
                "http://login.microsoftonline.com/common/oauth2/v2.0/authorize",
                true
            ));
        }
        for stage in [Form, FormPrepare, FormSubmit, BoundPassword] {
            assert!(!p.allows(stage, at, true), "{stage:?}");
        }
        // A same-origin frame step, on the connection's own HTTP origin.
        let ilo = serde_json::json!({"credentialOrigins": [], "loginSteps": [
            {"kind": "click", "selectors": {"control": "#open"}},
            {"kind": "form", "frame": "appFrame", "selectors": {"username": "#u", "password": "#p"}},
            {"kind": "submit", "submission": "enter"}]});
        let p = policy("http://ilo.test:8080", ilo).unwrap();
        assert_eq!(p.frames(), vec!["appFrame".to_owned()]);
        assert!(p.allows(Form, "http://ilo.test:8080/html/login.html", false));
        assert!(p.allows(FormSubmit, "http://ilo.test:8080/html/login.html", false));
        assert!(!p.allows(Form, "http://ilo.test:8080/html/login.html", true));
        assert!(p.allows(FormPrepare, "http://ilo.test:8080/index.html", true));
        assert!(!p.allows(FormPrepare, "http://ilo.test:8080/index.html", false));
        assert!(!p.allows(Form, "http://ilo.test:8081/html/login.html", false));
        assert!(!p.allows(Form, "https://ilo.test:8080/html/login.html", false));
        // Prefixes: the directory and below only.
        let prefixed = serde_json::json!({"credentialOrigins": [], "loginSteps": [
            {"kind": "form", "pathPrefixes": ["/ui/"], "selectors": {"username": "#u", "password": "#p"}}]});
        let p = policy("https://vc.test", prefixed).unwrap();
        assert!(p.allows(Form, "https://vc.test/ui/login", true));
        assert!(!p.allows(Form, "https://vc.test/uix/login", true));
        assert!(!p.allows(Form, "https://vc.test/ui", true));
    }

    #[test]
    fn the_pending_position_is_the_released_steps_and_cannot_go_back_or_repeat() {
        let p = policy("https://outlook.office.com", identifier_first()).unwrap();
        let at = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
        let mut released: HashSet<(String, NativeLoginStage)> = HashSet::new();
        let ready = |released: &HashSet<(String, NativeLoginStage)>, stage| {
            p.ready(stage, at, true, |origin, stage| {
                released.contains(&(origin.to_owned(), stage))
            })
        };
        assert!(ready(&released, Identifier));
        assert!(
            !ready(&released, IdentifierSubmit),
            "submit before its credential step"
        );
        assert!(!ready(&released, Password), "a later step never runs first");
        released.insert((MS.into(), Identifier));
        assert!(!ready(&released, Identifier), "a reload cannot ask again");
        assert!(ready(&released, IdentifierSubmit));
        assert!(ready(&released, Password));
        released.insert((MS.into(), Password));
        assert!(!ready(&released, Password), "no second password");
        assert!(ready(&released, PasswordSubmit));
        released.insert((MS.into(), PasswordSubmit));
        assert!(!ready(&released, PasswordSubmit));
        // Password-only: the password step needs no identifier.
        let device = serde_json::json!({"credentialOrigins": [], "passwordOnly": true, "loginSteps": [
            {"kind": "password", "selectors": {"password": "#p"}},
            {"kind": "submit", "submission": "click", "selectors": {"control": "#go"}}]});
        let p = policy("http://router.test", device).unwrap();
        assert!(p.ready(Password, "http://router.test/", true, |_, _| false));
        assert!(!p.ready(Identifier, "http://router.test/", true, |_, _| false));
    }

    fn reserve(
        budget: &mut LoginBudget,
        policy: &OriginBrowserPolicy,
        origin: &str,
        stage: NativeLoginStage,
        auto_submit: bool,
        username: &str,
        password: &str,
    ) -> bool {
        budget.reserve(
            &NativeLoginRequest {
                identity: policy.identity(),
                origin,
                adapter: NativeLoginAdapter::Declarative,
                stage,
                path: "/",
                frame: None,
            },
            &NativeLoginCredentials {
                identity: policy.identity(),
                origin,
                valid_until: Instant::now() + Duration::from_secs(30),
                username,
                password,
                auto_submit,
            },
        )
    }

    #[test]
    fn declarative_budget_releases_each_stage_once_and_submits_only_after_its_step() {
        let origin = "https://device.test";
        let policy = OriginBrowserPolicy::new("owner", "connection", "tab", origin).unwrap();
        let mut budget = LoginBudget::default();
        let b = &mut budget;
        assert!(!reserve(b, &policy, origin, PasswordSubmit, true, "", ""));
        assert!(
            reserve(b, &policy, origin, Password, true, "", "secret"),
            "password-only device"
        );
        assert!(!reserve(b, &policy, origin, Password, true, "", "secret"));
        assert!(
            !reserve(b, &policy, origin, PasswordSubmit, false, "", ""),
            "fill-only consent"
        );
        assert!(reserve(b, &policy, origin, PasswordSubmit, true, "", ""));
        assert!(!reserve(b, &policy, origin, PasswordSubmit, true, "", ""));
        assert!(reserve(b, &policy, origin, FormPrepare, true, "", ""));
        assert!(!reserve(b, &policy, origin, FormPrepare, true, "", ""));
        assert!(!reserve(
            b,
            &policy,
            origin,
            BoundPassword,
            true,
            "user",
            "secret"
        ));
        assert!(reserve(b, &policy, origin, Identifier, true, "user", ""));
        assert!(
            reserve(b, &policy, "https://idp.test", Form, true, "user", "secret"),
            "no prepare stage needed"
        );
        assert!(!reserve(
            b,
            &policy,
            "https://idp.test",
            IdentifierSubmit,
            true,
            "",
            ""
        ));
        assert!(reserve(
            b,
            &policy,
            "https://idp.test",
            FormSubmit,
            true,
            "",
            ""
        ));
    }

    #[test]
    fn a_click_grant_is_never_rearmed_and_a_credential_stage_once() {
        let origin = "https://device.test";
        let adapter = NativeLoginAdapter::Declarative;
        let policy = OriginBrowserPolicy::new("owner", "connection", "tab", origin).unwrap();
        let mut budget = LoginBudget::default();
        assert!(reserve(
            &mut budget,
            &policy,
            origin,
            FormPrepare,
            true,
            "",
            ""
        ));
        assert!(!budget.cancelled(adapter, origin, FormPrepare));
        assert!(!reserve(
            &mut budget,
            &policy,
            origin,
            FormPrepare,
            true,
            "",
            ""
        ));
        assert!(reserve(
            &mut budget,
            &policy,
            origin,
            Identifier,
            true,
            "user",
            ""
        ));
        assert!(budget.cancelled(adapter, origin, Identifier));
        assert!(reserve(
            &mut budget,
            &policy,
            origin,
            Identifier,
            true,
            "user",
            ""
        ));
        assert!(!budget.cancelled(adapter, origin, Identifier));
        assert!(!reserve(
            &mut budget,
            &policy,
            origin,
            Identifier,
            true,
            "user",
            ""
        ));
    }
}
