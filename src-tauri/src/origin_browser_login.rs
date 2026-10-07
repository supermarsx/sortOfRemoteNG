//! Production bridge from native saved credentials to the isolated CEF login
//! adapter. Remote content cannot create a grant or choose another database.
use sorng_browser_host::{
    cef_browser::NativeDocumentHooks,
    native_features::{
        NativeLoginAdapter, NativeLoginCredentials, NativeLoginRequest, NativeLoginStage,
    },
};
use sorng_commands_core::origin_browser_authority::{
    NativeCredentialAvailability, NativeLoginAuthority, NativeLoginConsentVerifier,
    NativeLoginRequest as AuthorityRequest, NativeOwnerLease,
};
use sorng_protocols::origin_browser::BrowserIdentity;
use std::{
    collections::HashSet,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::{Duration, Instant},
};
use tauri::WebviewWindow;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

#[path = "origin_browser_login_consent.rs"]
mod consent;
use consent::AttemptConsent;

const CONSENT_LIFETIME: Duration = Duration::from_secs(10 * 60);
const CANCELLED: &str = "Website login was not authorized. No saved credentials were sent. Reopen the website to review consent, or select manual login in its connection settings.";

// One native consent dialog per owning app window. The callback retains this
// slot until the actual dialog closes, even if its command future is dropped.
struct PromptSlot(String);
fn prompts() -> &'static Mutex<HashSet<String>> {
    static PROMPTS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    PROMPTS.get_or_init(Mutex::default)
}
impl PromptSlot {
    fn reserve(window: &WebviewWindow) -> Result<Self, String> {
        let mut active = prompts().lock().map_err(|_| CANCELLED.to_owned())?;
        if !active.insert(window.label().to_owned()) {
            return Err("Finish the existing website login consent dialog first.".into());
        }
        Ok(Self(window.label().to_owned()))
    }
}
impl Drop for PromptSlot {
    fn drop(&mut self) {
        prompts()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&self.0);
    }
}

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
    window: WebviewWindow,
    authority: Arc<NativeLoginAuthority>,
    lease: NativeOwnerLease,
    media_owner: MediaOwner,
    adapter: NativeLoginAdapter,
    consent: Option<AttemptConsent>,
}

impl LoginHooks {
    /// Runs before a website surface or relay is created. An ExistingGrant
    /// supplied by application IPC is only a hint: it cannot skip this native
    /// approval. No usernames, passwords, URL queries or grant IDs are shown.
    pub(crate) async fn prepare(
        window: &WebviewWindow,
        identity: &BrowserIdentity,
        authority: Arc<NativeLoginAuthority>,
        lease: NativeOwnerLease,
    ) -> Result<Arc<Self>, String> {
        if !authority.enabled() {
            return Ok(Arc::new(Self {
                window: window.clone(),
                authority,
                lease,
                media_owner: MediaOwner::new(identity),
                adapter: NativeLoginAdapter::Manual,
                consent: None,
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
            return Err("Saved website credentials are unavailable. Unlock the owning database and review this connection's credential source before retrying.".into());
        }
        let origins = authority.consent_origins();
        // Keep the complete disclosure visible and bounded, never truncate an
        // origin list into an approval for unseen destinations.
        if origins.is_empty() || origins.len() > 16 || !lease.is_current() {
            return Err("Website login consent could not be prepared. Review this connection's saved login destinations.".into());
        }
        let slot = PromptSlot::reserve(window)?;
        let behavior = if adapter == NativeLoginAdapter::Claude && authority.auto_submit_allowed() {
            "Fill and submit the saved email address; complete email verification yourself"
        } else if adapter == NativeLoginAdapter::Claude {
            "Fill the saved email address without automatically submitting"
        } else if authority.auto_submit_allowed() {
            "Fill and submit the saved username and password"
        } else {
            "Fill the saved username and password without automatically submitting"
        };
        let message = format!(
            "{behavior} on these exact website origins?\n\n{}\n\nOnly approve websites you trust. Their scripts can read information entered on the page. This approval is limited to this browser attempt for 10 minutes. It does not authorize other websites, MFA, or CAPTCHA completion.",
            origins.join("\n")
        );
        let (sender, receiver) = tokio::sync::oneshot::channel();
        let parent = window.clone();
        let prompt_lease = lease.clone();
        window
            .run_on_main_thread(move || {
                if sender.is_closed() || !prompt_lease.is_current() {
                    return;
                }
                parent
                    .dialog()
                    .message(message)
                    .title("Authorize website login")
                    .parent(&parent)
                    .kind(MessageDialogKind::Warning)
                    .buttons(MessageDialogButtons::OkCancelCustom(
                        "Allow this login".into(),
                        "Cancel".into(),
                    ))
                    .show(move |approved| {
                        let _slot = slot;
                        let _ = sender.send(approved);
                    });
            })
            .map_err(|_| CANCELLED.to_owned())?;
        let approved = tokio::time::timeout(CONSENT_LIFETIME, receiver)
            .await
            .ok()
            .and_then(Result::ok)
            .unwrap_or(false);
        if !approved || !lease.is_current() {
            return Err(CANCELLED.into());
        }
        let consent = AttemptConsent::approved(
            identity.clone(),
            origins.to_vec(),
            Instant::now() + CONSENT_LIFETIME,
            authority.auto_submit_allowed(),
        );
        Ok(Arc::new(Self {
            window: window.clone(),
            authority,
            lease,
            media_owner: MediaOwner::new(identity),
            adapter,
            consent: Some(consent),
        }))
    }

    pub(crate) fn revoke(&self) {
        self.media_owner.revoke();
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
                if matches!(
                    request.stage,
                    NativeLoginStage::FormPrepare | NativeLoginStage::FormSubmit
                ) {
                    // The preparation/action packets are deliberately secret-free.
                    // Reuse the exact native grant verifier on every stage; do
                    // not cache cleartext values while an SPA or delay settles.
                    let Some(mut metadata) =
                        options.and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
                    else {
                        return;
                    };
                    metadata["fields"] = serde_json::json!([]);
                    let metadata = metadata.to_string();
                    deliver(
                        NativeLoginCredentials {
                            identity: credentials.identity,
                            origin: credentials.origin,
                            valid_until: credentials.valid_until,
                            username: "",
                            password: "",
                            auto_submit: credentials.auto_submit,
                        },
                        Some(&metadata),
                    );
                    return;
                }
                deliver(
                    NativeLoginCredentials {
                        identity: credentials.identity,
                        origin: credentials.origin,
                        valid_until: credentials.valid_until,
                        username: credentials.username,
                        password: credentials.password,
                        auto_submit: credentials.auto_submit,
                    },
                    options,
                );
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
                let action = request.stage.is_action();
                deliver(NativeLoginCredentials {
                    identity: credentials.identity,
                    origin: credentials.origin,
                    valid_until: credentials.valid_until,
                    username: if action { "" } else { credentials.username },
                    password: if action { "" } else { credentials.password },
                    auto_submit: credentials.auto_submit,
                });
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
