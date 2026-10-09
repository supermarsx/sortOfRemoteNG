//! Production bridge from native saved credentials to the isolated CEF login
//! adapter. Remote content cannot create a grant or choose another database.
use sorng_browser_host::{
    cef_browser::{NativeDocumentHooks, NativeHttpAuthChallenge},
    native_features::{
        NativeLoginAdapter, NativeLoginCredentials, NativeLoginRequest, NativeLoginStage,
    },
};
use sorng_commands_core::origin_browser_authority::{
    NativeBasicAuth, NativeCredentialAvailability, NativeLoginAuthority, NativeLoginConsentVerifier,
    NativeLoginRequest as AuthorityRequest, NativeOwnerLease,
};
use sorng_protocols::origin_browser::BrowserIdentity;
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
use tauri::WebviewWindow;

#[path = "origin_browser_login_consent.rs"]
mod consent;
use consent::AttemptConsent;
#[path = "origin_browser_login_delivery.rs"]
mod delivery;

const CONSENT_LIFETIME: Duration = Duration::from_secs(10 * 60);

// Media ownership is independent of saved-login consent: manual login can
// request devices too. This is only a liveness fence, never a permission grant.
struct MediaOwner {
    identity: BrowserIdentity,
    revoked: AtomicBool,
}

impl MediaOwner {
    fn new(identity: &BrowserIdentity) -> Self {
        Self {
            identity: identity.clone(),
            revoked: AtomicBool::new(false),
        }
    }

    fn current(&self, identity: &BrowserIdentity, lease_current: impl FnOnce() -> bool) -> bool {
        identity == &self.identity
            && !self.revoked.load(Ordering::Acquire)
            && lease_current()
            && !self.revoked.load(Ordering::Acquire)
    }

    fn revoke(&self) {
        self.revoked.store(true, Ordering::Release);
    }
}

pub(crate) struct LoginHooks {
    observations: super::diagnostics::ObservationGate,
    appearance: std::sync::Mutex<sorng_browser_host::native_appearance::AppearanceConfig>,
    window: WebviewWindow,
    authority: Arc<NativeLoginAuthority>,
    lease: NativeOwnerLease,
    media_owner: MediaOwner,
    adapter: NativeLoginAdapter,
    consent: Option<AttemptConsent>,
    basic_auth: Option<Arc<NativeBasicAuth>>,
}

impl LoginHooks {
    pub(crate) fn set_appearance_configuration(
        &self, config: sorng_browser_host::native_appearance::AppearanceConfig,
    ) -> Result<(), String> {
        config.theme.validate().map_err(str::to_owned)?;
        if !self.lease.is_current() { return Err("Website owner unavailable.".into()); }
        *self.appearance.lock().map_err(|_| "Website appearance unavailable.")? = config;
        Ok(())
    }
    /// The owning database's saved automatic-login choice is the authorization;
    /// no extra dialog is needed on each connection. Native validation still
    /// binds it to this attempt and its saved login destinations. An IPC grant
    /// hint cannot enable a saved opt-out or add another destination.
    pub(crate) async fn prepare(
        window: &WebviewWindow,
        identity: &BrowserIdentity,
        authority: Arc<NativeLoginAuthority>,
        lease: NativeOwnerLease,
        basic_auth: Option<Arc<NativeBasicAuth>>,
    ) -> Result<Arc<Self>, String> {
        if !authority.enabled() {
            return Ok(Arc::new(Self {
                observations: Default::default(),
                appearance: std::sync::Mutex::new(Default::default()),
                window: window.clone(),
                authority,
                lease,
                media_owner: MediaOwner::new(identity),
                adapter: NativeLoginAdapter::Manual,
                consent: None,
                basic_auth,
            }));
        }
        let provider = authority
            .form_configuration()
            .and_then(|config| serde_json::from_str::<serde_json::Value>(config).ok())
            .is_some_and(|config| config.get("provider").is_some());
        let adapter = if authority.form_configuration().is_some() && !provider {
            NativeLoginAdapter::ModularForm
        } else {
            NativeLoginAdapter::from_application_id(authority.application_id())
        };
        if !adapter.supported() || !authority.supports_default_adapter() {
            return Err("This saved automatic-login configuration is not supported by the real-origin browser yet. Choose manual login explicitly in this connection's settings to open it without automatic credential entry.".into());
        }
        if authority.availability() != NativeCredentialAvailability::Saved {
            return Err("Automatic website login needs complete saved credentials. Edit this connection's website login credentials or linked database-vault entry, or explicitly choose manual login, then reopen the tab.".into());
        }
        let origins = authority.consent_origins();
        // Keep the entire native-owned destination set bounded. Never truncate
        // it or widen login authority to the browser's resource destinations.
        if origins.is_empty() || origins.len() > 16 || !lease.is_current() {
            return Err("Website login consent could not be prepared. Review this connection's saved login destinations.".into());
        }
        let consent = AttemptConsent::approved(
            identity.clone(),
            origins.to_vec(),
            Instant::now() + CONSENT_LIFETIME,
            authority.auto_submit_allowed(),
        );
        Ok(Arc::new(Self {
            observations: Default::default(),
            appearance: std::sync::Mutex::new(Default::default()),
            window: window.clone(),
            authority,
            lease,
            media_owner: MediaOwner::new(identity),
            adapter,
            consent: Some(consent),
            basic_auth,
        }))
    }

    pub(crate) fn revoke(&self) {
        self.media_owner.revoke();
        self.authority.revoke_totp();
        if let Some(basic_auth) = &self.basic_auth {
            basic_auth.revoke();
        }
        if let Some(consent) = &self.consent {
            consent.revoke();
        }
    }

    /// Renderer setup metadata only; no literal extra-field values. Carver's
    /// NativeDocumentHooks transport must forward this as values, not source.
    pub(crate) fn form_configuration(&self) -> Option<&str> {
        if self.lease.is_current() {
            self.authority.form_configuration()
        } else {
            None
        }
    }

    /// Keep additional field values behind the existing exact-origin consent
    /// verifier. Renderer integration must send these with the single bounded
    /// credential delivery, never during public feature installation.
    pub(crate) fn with_form_credentials(
        &self,
        request: &NativeLoginRequest<'_>,
        deliver: &mut dyn FnMut(NativeLoginCredentials<'_>, Option<&str>),
    ) {
        if request.adapter != self.adapter
            || self.adapter != NativeLoginAdapter::ModularForm
            || !self.adapter.accepts_stage(request.stage)
            || !self.lease.is_current()
        {
            return;
        }
        self.authority.with_form_credentials(
            &AuthorityRequest {
                identity: request.identity,
                origin: request.origin,
            },
            self,
            &mut |credentials, options| {
                if !self.media_owner.current(request.identity, || self.lease.is_current()) {
                    return;
                }
                let Some(credentials) = delivery::project(request, NativeLoginCredentials {
                    identity: credentials.identity,
                    origin: credentials.origin,
                    valid_until: credentials.valid_until,
                    username: credentials.username,
                    password: credentials.password,
                    auto_submit: credentials.auto_submit,
                }, Instant::now()) else { return; };
                if matches!(
                    request.stage,
                    NativeLoginStage::FormPrepare | NativeLoginStage::FormSubmit
                ) {
                    // The preparation/action packets are deliberately secret-free.
                    // Reuse the exact native grant verifier on every stage; do
                    // not cache cleartext values while an SPA or delay settles.
                    let Some(metadata) = options.and_then(delivery::form_metadata) else {
                        return;
                    };
                    deliver(credentials, Some(&metadata));
                    return;
                }
                deliver(credentials, options);
            },
        );
    }
}

impl NativeLoginConsentVerifier for LoginHooks {
    fn with_current_consent(
        &self,
        identity: &BrowserIdentity,
        origin: &str,
        _requested_grant_id: Option<&str>,
        deliver: &mut dyn FnMut(Instant, bool),
    ) {
        if self.lease.is_current() {
            if let Some(consent) = &self.consent {
                consent.with_current(identity, origin, Instant::now(), deliver);
            }
        }
    }
}

impl NativeDocumentHooks for LoginHooks {
    fn on_feature_status(
        &self,
        identity: &BrowserIdentity,
        _origin: &str,
        status: sorng_browser_host::native_features::NativeFeatureStatus,
    ) {
        use sorng_browser_host::native_features::{NativeFeatureStatus as F, NativeLoginDeliveryStatus as D};
        if !self.media_owner.current(identity, || self.lease.is_current()) { return; }
        // Fixed checkpoints only: the origin, page text, credentials and native
        // request identity are deliberately absent from the diagnostic payload.
        let (code, checkpoint) = match status {
            F::RendererInstalled => (0, "renderer-installed"),
            F::RendererInstallationFailed => (1, "renderer-installation-failed"),
            F::LoginFormDetected => (2, "login-form-detected"),
            F::LoginAdapterCompleted => (3, "login-adapter-completed"),
            F::LoginAdapterRejected => (4, "login-adapter-rejected"),
            F::LoginDelivery(delivery) => match delivery {
                D::NativeNotDelivered => (5, "native-not-delivered"),
                D::NativeRejectedCurrent => (6, "native-rejected-current"),
                D::NativeRejectedNavigation => (7, "native-rejected-navigation"),
                D::NativeRejectedGrant => (8, "native-rejected-grant"),
                D::NativeMessageFailed => (9, "native-message-failed"),
                D::NativeSent => (10, "native-sent"),
                D::RendererReceived => (11, "renderer-received"),
                D::RendererRejectedFrame => (12, "renderer-rejected-frame"),
                D::RendererRejectedPayload => (13, "renderer-rejected-payload"),
                D::RendererRejectedDocument => (14, "renderer-rejected-document"),
                D::RendererRejectedContext => (15, "renderer-rejected-context"),
                D::RendererExecuting => (16, "renderer-executing"),
                D::RendererAccepted => (17, "renderer-accepted"),
                D::RendererRejected => (18, "renderer-rejected"),
                D::RendererMissingDocument => (19, "renderer-missing-document"),
                D::RendererNonceMismatch => (20, "renderer-nonce-mismatch"),
                D::RendererOriginMismatch => (21, "renderer-origin-mismatch"),
                D::RendererStageNotRequested => (22, "renderer-stage-not-requested"),
                D::RendererStageNotAllowed => (23, "renderer-stage-not-allowed"),
                D::RendererReplay => (24, "renderer-replay"),
            },
        };
        if let Some(sample) = self.observations.feature(code) {
            super::diagnostics::navigation(super::diagnostics::Navigation::RendererFeature { sample, checkpoint });
        }
    }
    fn appearance_configuration(&self) -> Option<String> {
        if !self.lease.is_current() { return None; }
        self.appearance.lock().ok().and_then(|config| serde_json::to_string(&*config).ok())
    }
    fn with_totp(&self, request: &sorng_browser_host::native_totp::NativeTotpRequest<'_>,
        deliver: &mut dyn FnMut(sorng_browser_host::native_totp::NativeTotpCode<'_>)) -> Option<Duration> {
        if !self.media_owner.current(request.identity, || self.lease.is_current()) { return None; }
        self.authority.with_totp(request, self, deliver)
    }

    fn totp_current(&self, request: &sorng_browser_host::native_totp::NativeTotpRequest<'_>, submit: bool) -> bool {
        self.media_owner.current(request.identity, || self.lease.is_current())
            && self.authority.totp_current(request, self, submit)
    }

    fn with_http_basic_auth(
        &self,
        challenge: &NativeHttpAuthChallenge<'_>,
        deliver: &mut dyn FnMut(&str, &str),
    ) -> bool {
        if !self.media_owner.current(challenge.identity, || self.lease.is_current()) {
            return false;
        }
        self.basic_auth.as_ref().is_some_and(|auth| {
            auth.with_credentials(
                challenge.identity,
                challenge.origin_url,
                challenge.host,
                challenge.port,
                challenge.scheme,
                deliver,
            )
        })
    }

    fn on_navigation_status(
        &self,
        identity: &BrowserIdentity,
        status: sorng_browser_host::cef_browser::NativeNavigationStatus,
    ) {
        use super::diagnostics::{self, Navigation};
        use sorng_browser_host::cef_browser::NativeNavigationStatus as Native;
        if identity != &self.media_owner.identity {
            return;
        }
        // Native-only scalar diagnostics: no URL, title, headers or secrets.
        // Do not log each resource or query the vault from CEF callbacks.
        let status = match status {
            Native::Requested => Navigation::Requested,
            Native::BeforeBrowse {
                allowed,
                main_frame,
            } => Navigation::Browse {
                allowed,
                main_frame,
            },
            Native::AuthChallenge {
                proxy: true,
                callback_present,
            } => Navigation::ProxyAuth { callback_present },
            Native::AuthCompleted { handled } => Navigation::AuthCompleted { handled },
            Native::LoadError { code, main_frame } => Navigation::LoadError { code, main_frame },
            Native::ResourceAdmission { resource_type, is_navigation, browser_present, frame_present,
                initiator_empty, initiator_opaque, default_disabled } => {
                let Some(sample) = self.observations.resource() else { return; };
                Navigation::ResourceAdmission { sample, resource_type, is_navigation, browser_present,
                    frame_present, initiator_empty, initiator_opaque, default_disabled }
            },
            _ => return,
        };
        diagnostics::navigation(status);
    }

    fn media_permission_current(&self, identity: &BrowserIdentity) -> bool {
        // The host separately enforces the saved media capability, exact live
        // document/origin and one-shot prompt decision. Do not grant those here.
        self.media_owner
            .current(identity, || self.lease.is_current())
    }

    fn on_media_permission(
        &self,
        challenge: sorng_browser_host::native_media::NativeMediaChallenge,
        completion: sorng_browser_host::native_media::MediaPermissionCompletion,
    ) {
        if !self.media_permission_current(&challenge.identity) {
            return; // Dropping the completion denies without opening a dialog.
        }
        super::media::request(&self.window, self.lease.clone(), challenge, completion);
    }
    fn on_main_document(&self, _identity: &BrowserIdentity, _sequence: u64) {}

    fn login_adapter(&self) -> NativeLoginAdapter {
        self.adapter
    }

    fn form_configuration(&self) -> Option<String> {
        // Only selectors/readiness metadata may cross the setup boundary.
        LoginHooks::form_configuration(self).map(str::to_owned)
    }

    fn with_form_credentials(
        &self,
        request: &NativeLoginRequest<'_>,
        deliver: &mut dyn FnMut(NativeLoginCredentials<'_>, Option<&str>),
    ) {
        if self.adapter == NativeLoginAdapter::ModularForm {
            // The inherent method supplies the verifier and borrows both the
            // credentials and extra-field options under the same native grant.
            LoginHooks::with_form_credentials(self, request, deliver);
        } else {
            // Preserve explicit staged adapters, including Google's per-stage
            // credential minimization. No ordinary-form options are released.
            self.with_auto_login(request, &mut |credentials| deliver(credentials, None));
        }
    }

    fn with_auto_login(
        &self,
        request: &NativeLoginRequest<'_>,
        deliver: &mut dyn FnMut(NativeLoginCredentials<'_>),
    ) {
        if request.adapter != self.adapter
            || !self.adapter.accepts_stage(request.stage)
            || !self.lease.is_current()
        {
            return;
        }
        self.authority.with_credentials(
            &AuthorityRequest {
                identity: request.identity,
                origin: request.origin,
            },
            self,
            &mut |credentials| {
                if !self.media_owner.current(request.identity, || self.lease.is_current()) {
                    return;
                }
                let Some(credentials) = delivery::project(request, NativeLoginCredentials {
                    identity: credentials.identity,
                    origin: credentials.origin,
                    valid_until: credentials.valid_until,
                    username: credentials.username,
                    password: credentials.password,
                    auto_submit: credentials.auto_submit,
                }, Instant::now()) else { return; };
                deliver(credentials);
            },
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sorng_protocols::origin_browser::OriginBrowserPolicy;

    fn identity(database: &str, connection: &str, session: &str) -> BrowserIdentity {
        OriginBrowserPolicy::new(database, connection, session, "https://media.example")
            .unwrap()
            .identity()
            .clone()
    }

    #[test]
    fn media_owner_current_needs_no_saved_login_consent_but_rechecks_the_lease() {
        let identity = identity("database", "connection", "session");
        let owner = MediaOwner::new(&identity);
        assert!(owner.current(&identity.clone(), || true));
        assert!(!owner.current(&identity, || false));
    }

    #[test]
    fn media_owner_rejects_other_database_connection_session_and_successor_attempt() {
        let captured = identity("database", "connection", "session");
        let owner = MediaOwner::new(&captured);
        for other in [
            identity("other", "connection", "session"),
            identity("database", "other", "session"),
            identity("database", "connection", "other"),
            identity("database", "connection", "session"),
        ] {
            assert!(!owner.current(&other, || panic!("mismatched owner must short-circuit")));
        }
        assert!(owner.current(&captured, || true));
    }

    #[test]
    fn media_owner_revocation_is_terminal_even_with_a_live_lease() {
        let identity = identity("database", "connection", "session");
        let owner = MediaOwner::new(&identity);
        assert!(owner.current(&identity, || true));
        owner.revoke();
        owner.revoke();
        assert!(!owner.current(&identity, || panic!("revoked owner must short-circuit")));
    }

    #[test]
    fn media_owner_revocation_during_lease_check_cannot_release_an_approval() {
        let identity = identity("database", "connection", "session");
        let owner = MediaOwner::new(&identity);
        assert!(!owner.current(&identity, || {
            owner.revoke();
            true
        }));
    }
}
