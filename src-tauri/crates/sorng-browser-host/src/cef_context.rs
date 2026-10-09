//! Attempt-private, in-memory CEF request contexts. Preparation does not enable
//! navigation or emit host readiness. The process/bootstrap containment gates
//! and native browser lifecycle must be installed before a host may report Ready.

use crate::cef_session_retention::{
    self, CookieCapture, CookieOwner, RetentionError, SignInCookie,
};
use crate::cef_tls_bridge::{
    NativeTlsBridge, NativeTlsCompletion, NativeTlsConfig, NativeTlsContext, NativeTlsEvidence,
    NativeTlsHooks, NativeTlsStatus,
};
use crate::domain_permissions::WebsitePermissionEngine;
use crate::native_capabilities::NativeBrowserCapabilities;
pub use crate::proxy_config::ContextError;
use crate::proxy_config::{self, FixedProxy, ProxyPreferences};
use cef::*;
use sorng_protocols::origin_browser::{
    BrowserIdentity, BrowserSessionFailure, BrowserSessionStatus, OriginBrowserSession,
};
use std::marker::PhantomData;
use std::rc::Rc as ThreadBound;
use std::sync::{Arc, Mutex, MutexGuard};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PreparationStatus {
    Initializing,
    ProxyConfigured,
    Failed(ContextError),
    Revoked,
}

struct Preparation {
    inspector_bootstrap: Arc<crate::cef_browser::cef_devtools::BootstrapGate>,
    session: Arc<Mutex<OriginBrowserSession>>,
    identity: BrowserIdentity,
    permissions: Arc<WebsitePermissionEngine>,
    status: Mutex<PreparationStatus>,
}

fn lock_session<'a>(
    session: &'a Mutex<OriginBrowserSession>,
    identity: &BrowserIdentity,
) -> Result<MutexGuard<'a, OriginBrowserSession>, ContextError> {
    match session.lock() {
        Ok(session) => Ok(session),
        Err(poisoned) => {
            // Recover only to terminate this attempt's established streams.
            // Keep the mutex poisoned and never revoke a successor's relay.
            let _ = poisoned.into_inner().revoke_for(identity, BrowserSessionFailure::NativeState);
            Err(ContextError::SessionUnavailable)
        }
    }
}

impl Preparation {
    fn verify_browser_binding(
        &self,
        browser: &Browser,
        retained: &mut RequestContext,
    ) -> Result<(), ContextError> {
        if self.current_status() != PreparationStatus::ProxyConfigured {
            return Err(ContextError::SessionUnavailable);
        }
        let endpoint = {
            let session = lock_session(&self.session, &self.identity)?;
            if session.policy().identity() != &self.identity {
                return Err(ContextError::SessionUnavailable);
            }
            session.proxy_endpoint()
        };
        // Do not hold session locks across CEF calls. The returned native
        // browser context, not just the factory argument, must prove ownership.
        let result = verify_native_browser_binding(browser, retained, endpoint);
        if let Err(error) = result {
            self.fail(error);
        }
        result
    }

    fn claim_creation(
        &self,
        session: &Arc<Mutex<OriginBrowserSession>>,
        identity: &BrowserIdentity,
        claimed: &mut bool,
        preferences: &impl ProxyPreferences,
    ) -> Result<(), ContextError> {
        if *claimed
            || !Arc::ptr_eq(session, &self.session)
            || identity != &self.identity
            || self.current_status() != PreparationStatus::ProxyConfigured
        {
            return Err(ContextError::SessionUnavailable);
        }
        let session = lock_session(session, identity)?;
        if session.policy().identity() != identity
            || session.status() != BrowserSessionStatus::NotReady
        {
            return Err(ContextError::SessionUnavailable);
        }
        let expected = FixedProxy {
            mode: "fixed_servers".into(),
            server: format!("http://{}", session.proxy_endpoint()),
            bypass_list: "<-loopback>".into(),
        };
        let result = if !preferences.is_private() {
            Err(ContextError::SharedContext)
        } else if preferences.read().as_ref() != Some(&expected) {
            Err(ContextError::ProxyMismatch)
        } else {
            Ok(())
        };
        drop(session);
        if let Err(error) = result {
            self.fail(error);
            return Err(error);
        }
        *claimed = true;
        Ok(())
    }

    fn fail(&self, reason: ContextError) {
        if !matches!(reason, ContextError::SessionUnavailable) {
            let failure = match reason {
                ContextError::ProxyRejected | ContextError::ProxyMismatch => BrowserSessionFailure::PrivateProxy,
                _ => BrowserSessionFailure::PrivateContext,
            };
            let _ = self.session.lock().unwrap_or_else(|err| err.into_inner())
                .revoke_for(&self.identity, failure);
        }
        self.revoke();
        if let Ok(mut status) = self.status.lock() {
            *status = PreparationStatus::Failed(reason);
        }
    }

    fn revoke(&self) {
        // Even a poisoned owner must stop its retained relay. Identity fencing
        // prevents this stale context from revoking a replacement attempt.
        let mut session = self.session.lock().unwrap_or_else(|err| err.into_inner());
        let _ = session.revoke(&self.identity);
        if let Ok(mut status) = self.status.lock() {
            *status = PreparationStatus::Revoked;
        }
    }

    fn configure(&self, preferences: &mut impl ProxyPreferences) -> Result<(), ContextError> {
        let mut session = lock_session(&self.session, &self.identity)?;
        if session.policy().identity() != &self.identity
            || session.status() != BrowserSessionStatus::NotReady
        {
            return Err(ContextError::SessionUnavailable);
        }
        let mut status = match self.status.lock() {
            Ok(status) => status,
            Err(poisoned) => {
                *poisoned.into_inner() = PreparationStatus::Revoked;
                let _ = session.revoke_for(&self.identity, BrowserSessionFailure::NativeState);
                return Err(ContextError::SessionUnavailable);
            }
        };
        if *status != PreparationStatus::Initializing {
            return Err(ContextError::SessionUnavailable);
        }
        // Keep session identity/relay stable throughout installation and readback.
        proxy_config::install(preferences, session.proxy_endpoint())?;
        *status = PreparationStatus::ProxyConfigured;
        Ok(())
    }

    fn current_status(&self) -> PreparationStatus {
        let Ok(mut session) = lock_session(&self.session, &self.identity) else {
            return PreparationStatus::Revoked;
        };
        if session.policy().identity() != &self.identity {
            return PreparationStatus::Revoked;
        }
        let status = match self.status.lock() {
            Ok(status) => *status,
            Err(poisoned) => {
                *poisoned.into_inner() = PreparationStatus::Revoked;
                let _ = session.revoke_for(&self.identity, BrowserSessionFailure::NativeState);
                return PreparationStatus::Revoked;
            }
        };
        // Preserve a fixed preparation failure reason even though failing also
        // revokes the relay. Do not report ProxyConfigured after external lock.
        if matches!(
            status,
            PreparationStatus::Failed(_) | PreparationStatus::Revoked
        ) {
            return status;
        }
        if matches!(
            session.status(),
            BrowserSessionStatus::Revoked | BrowserSessionStatus::Unsupported(_)
        ) {
            return PreparationStatus::Revoked;
        }
        status
    }
}

struct CefPreferences<'a>(&'a RequestContext);

fn verify_native_browser_binding(
    browser: &Browser,
    retained: &mut RequestContext,
    endpoint: std::net::SocketAddr,
) -> Result<(), ContextError> {
    let actual = browser
        .host()
        .and_then(|host| host.request_context())
        .ok_or(ContextError::SharedContext)?;
    // IsSharingWith is insufficient: two distinct contexts may share storage.
    // Only IsSame proves that CEF attached this exact retained private context.
    if actual.is_same(Some(retained)) != 1 || !CefPreferences(&actual).is_private() {
        return Err(ContextError::SharedContext);
    }
    let expected = FixedProxy {
        mode: "fixed_servers".into(),
        server: format!("http://{endpoint}"),
        bypass_list: "<-loopback>".into(),
    };
    if CefPreferences(&actual).read().as_ref() != Some(&expected) {
        return Err(ContextError::ProxyMismatch);
    }
    Ok(())
}

impl ProxyPreferences for CefPreferences<'_> {
    fn is_private(&self) -> bool {
        self.0.is_global() == 0 && CefString::from(&self.0.cache_path()).to_string().is_empty()
    }

    fn write(&mut self, settings: &FixedProxy) -> bool {
        let name = CefString::from("proxy");
        if self.0.can_set_preference(Some(&name)) == 0 {
            return false;
        }
        let Some(mut dict) = dictionary_value_create() else {
            return false;
        };
        for (key, value) in [
            ("mode", settings.mode.as_str()),
            ("server", settings.server.as_str()),
            ("bypass_list", settings.bypass_list.as_str()),
        ] {
            if dict.set_string(Some(&CefString::from(key)), Some(&CefString::from(value))) == 0 {
                return false;
            }
        }
        let Some(mut value) = value_create() else {
            return false;
        };
        if value.set_dictionary(Some(&mut dict)) == 0 {
            return false;
        }
        // Engine error text is intentionally not surfaced; it may contain paths
        // or policy values. Public errors remain fixed, non-sensitive messages.
        // cef-rs Default has a null native string pointer; SetPreference needs
        // an allocated output structure even when its initial text is empty.
        let mut error = CefString::from("");
        self.0
            .set_preference(Some(&name), Some(&mut value), Some(&mut error))
            != 0
    }

    fn read(&self) -> Option<FixedProxy> {
        let dict = self
            .0
            .preference(Some(&CefString::from("proxy")))?
            .dictionary()?;
        for key in ["mode", "server", "bypass_list"] {
            if dict.get_type(Some(&CefString::from(key))) != ValueType::STRING {
                return None;
            }
        }
        Some(FixedProxy {
            mode: CefString::from(&dict.string(Some(&CefString::from("mode")))).to_string(),
            server: CefString::from(&dict.string(Some(&CefString::from("server")))).to_string(),
            bypass_list: CefString::from(&dict.string(Some(&CefString::from("bypass_list"))))
                .to_string(),
        })
    }
}

wrap_request_context_handler! {
    struct PrivateContextHandler { preparation: Arc<Preparation> }
    impl RequestContextHandler {
        fn on_request_context_initialized(&self, context: Option<&mut RequestContext>) {
            let result = if currently_on(ThreadId::UI) == 0 {
                Err(ContextError::WrongThread)
            } else if let Some(context) = context {
                self.preparation.configure(&mut CefPreferences(context))
            } else {
                Err(ContextError::CreationFailed)
            };
            if let Err(error) = result { self.preparation.fail(error); }
        }

        fn resource_request_handler(
            &self,
            browser: Option<&mut Browser>,
            frame: Option<&mut Frame>,
            request: Option<&mut Request>,
            is_navigation: i32,
            is_download: i32,
            request_initiator: Option<&CefString>,
            disable_default_handling: Option<&mut i32>,
        ) -> Option<ResourceRequestHandler> {
            if let Some(handler) = self.preparation.inspector_bootstrap.handler(
                &self.preparation.session, &self.preparation.identity,
                browser.is_none(), frame.is_none(), request.as_deref(),
                is_navigation, is_download, request_initiator,
            ) {
                return Some(handler);
            }
            // Workers can have no browser/frame. Never drop their admission hook.
            let navigation_frame = crate::cef_requests::verified_navigation_frame(browser.as_deref(), frame.as_deref(), request.as_deref(), is_navigation);
            Some(crate::cef_requests::context_resource_handler(
                self.preparation.session.clone(), self.preparation.identity.clone(),
                self.preparation.permissions.clone(), request.as_deref(), is_navigation, is_download,
                request_initiator, browser.is_none() || frame.is_none(), navigation_frame, disable_default_handling,
            ))
        }
    }
}

/// UI-thread owner. Drop while CEF is still initialized, after closing browsers.
/// The retained native context is intentionally not exposed to app/page IPC.
pub struct PrivateRequestContext {
    context: RequestContext,
    capabilities: NativeBrowserCapabilities,
    preparation: Arc<Preparation>,
    browser_claimed: bool,
    tls: Option<NativeTlsContext>,
    cookie_import: Option<cef_session_retention::native::CookieImport>,
    _ui_thread: PhantomData<ThreadBound<()>>,
}

impl PrivateRequestContext {
    /// # Safety
    /// CEF must be initialized on its UI thread and remain initialized for this
    /// object's lifetime. Normally retain this owner until browsers close. An
    /// early drop revokes and closes context connections while CEF retains its
    /// own context references. All browsers must finish closing and this owner
    /// must be dropped before CEF shutdown. This is not a readiness grant.
    pub unsafe fn create(
        session: Arc<Mutex<OriginBrowserSession>>,
        identity: BrowserIdentity,
    ) -> Result<Self, ContextError> {
        Self::create_with_permissions(session, identity, crate::cef_requests::deny_permissions())
    }

    /// Installs one immutable shared/per-connection permission snapshot for the
    /// entire attempt, including context-only worker requests. An allow is only
    /// an additional restriction on existing route grants, never a new route,
    /// redirect, credential or worker capability. `create` defaults to deny all.
    ///
    /// # Safety
    /// Same live CEF UI-thread and ordered shutdown requirements as [`Self::create`].
    pub unsafe fn create_with_permissions(
        session: Arc<Mutex<OriginBrowserSession>>,
        identity: BrowserIdentity,
        permissions: Arc<WebsitePermissionEngine>,
    ) -> Result<Self, ContextError> {
        if currently_on(ThreadId::UI) == 0 {
            return Err(ContextError::WrongThread);
        }
        {
            let session = lock_session(&session, &identity)?;
            if session.policy().identity() != &identity
                || session.status() != BrowserSessionStatus::NotReady
            {
                return Err(ContextError::SessionUnavailable);
            }
        }
        let preparation = Arc::new(Preparation {
            inspector_bootstrap: Arc::default(),
            session,
            identity,
            permissions,
            status: Mutex::new(PreparationStatus::Initializing),
        });
        let mut handler = PrivateContextHandler::new(preparation.clone());
        // Empty cache path creates a separate in-memory context. Never use the
        // global or create_context_shared factory, nor another attempt's profile.
        let settings = RequestContextSettings::default();
        let Some(context) = request_context_create_context(Some(&settings), Some(&mut handler))
        else {
            preparation.fail(ContextError::CreationFailed);
            return Err(ContextError::CreationFailed);
        };
        Ok(Self {
            context,
            capabilities: NativeBrowserCapabilities::default(),
            preparation,
            browser_claimed: false,
            tls: None,
            cookie_import: None,
            _ui_thread: PhantomData,
        })
    }

    pub fn status(&self) -> PreparationStatus {
        let status = self.preparation.current_status();
        if let Some(import) = self
            .cookie_import
            .as_ref()
            .filter(|_| !self.browser_claimed)
        {
            match import.status() {
                Ok(()) => {}
                Err(RetentionError::Pending) if status == PreparationStatus::ProxyConfigured => {
                    return PreparationStatus::Initializing
                }
                Err(RetentionError::Pending) => {}
                Err(_) => {
                    self.preparation.fail(ContextError::SessionUnavailable);
                    return PreparationStatus::Failed(ContextError::SessionUnavailable);
                }
            }
        }
        if let Some(tls) = &self.tls {
            if matches!(
                status,
                PreparationStatus::Failed(_) | PreparationStatus::Revoked
            ) {
                tls.revoke();
                return status;
            }
            match tls.status() {
                NativeTlsStatus::Installed => {}
                NativeTlsStatus::Initializing => return PreparationStatus::Initializing,
                _ => {
                    self.preparation.fail(ContextError::CreationFailed);
                    return PreparationStatus::Failed(ContextError::CreationFailed);
                }
            }
        }
        status
    }

    /// Uses the patched loaded engine factory, never stock/shared/disk context.
    /// Main must pump `cef_tls_bridge::pump_tls` on every CEF UI tick, including
    /// after this context moves into a browser, and drain retained callbacks via
    /// `after_cef_shutdown` only after the runtime has actually shut down.
    ///
    /// # Safety
    /// Same initialized UI-thread and shutdown requirements as `create`.
    pub unsafe fn create_with_tls(
        session: Arc<Mutex<OriginBrowserSession>>,
        identity: BrowserIdentity,
        permissions: Arc<WebsitePermissionEngine>,
        bridge: &NativeTlsBridge,
        config: &NativeTlsConfig,
        hooks: Arc<dyn NativeTlsHooks>,
    ) -> Result<Self, ContextError> {
        Self::create_with_tls_capabilities(
            session,
            identity,
            permissions,
            bridge,
            config,
            hooks,
            NativeBrowserCapabilities::default(),
        )
    }

    /// Apply one saved native capability snapshot before any context or page
    /// exists. This does not change proxy, TLS, consent or storage ownership.
    ///
    /// # Safety
    /// Same initialized UI-thread and shutdown requirements as `create`.
    #[allow(clippy::too_many_arguments)]
    pub unsafe fn create_with_tls_capabilities(
        session: Arc<Mutex<OriginBrowserSession>>,
        identity: BrowserIdentity,
        permissions: Arc<WebsitePermissionEngine>,
        bridge: &NativeTlsBridge,
        config: &NativeTlsConfig,
        hooks: Arc<dyn NativeTlsHooks>,
        capabilities: NativeBrowserCapabilities,
    ) -> Result<Self, ContextError> {
        capabilities
            .validate()
            .map_err(|_| ContextError::CreationFailed)?;
        if currently_on(ThreadId::UI) == 0 {
            return Err(ContextError::WrongThread);
        }
        {
            let session = lock_session(&session, &identity)?;
            if session.policy().identity() != &identity
                || session.status() != BrowserSessionStatus::NotReady
            {
                return Err(ContextError::SessionUnavailable);
            }
        }
        let preparation = Arc::new(Preparation {
            inspector_bootstrap: Arc::default(),
            session,
            identity,
            permissions: Arc::new(
                permissions
                    .as_ref()
                    .clone()
                    .restrict_cross_origin_requests(capabilities.cross_origin_requests_enabled),
            ),
            status: Mutex::new(PreparationStatus::Initializing),
        });
        let bound: Arc<dyn NativeTlsHooks> = Arc::new(ContextTlsHooks {
            preparation: Arc::downgrade(&preparation),
            hooks,
        });
        let mut handler = PrivateContextHandler::new(preparation.clone());
        let (context, tls) = match bridge.create_context(
            config,
            bound,
            &mut handler,
            capabilities.cookies_enabled,
        ) {
            Ok(created) => created,
            Err(_) => {
                preparation.fail(ContextError::CreationFailed);
                return Err(ContextError::CreationFailed);
            }
        };
        Ok(Self {
            context,
            capabilities,
            preparation,
            browser_claimed: false,
            tls: Some(tls),
            cookie_import: None,
            _ui_thread: PhantomData,
        })
    }

    /// False for stock CEF contexts even when their proxy is configured.
    pub fn tls_hooks_installed(&self) -> bool {
        self.tls
            .as_ref()
            .is_some_and(|tls| tls.status() == NativeTlsStatus::Installed)
            && self.status() == PreparationStatus::ProxyConfigured
    }

    /// Native browser creation must reuse its context's immutable snapshot.
    pub(crate) fn permissions(&self) -> Arc<WebsitePermissionEngine> {
        self.preparation.permissions.clone()
    }

    pub(crate) fn inspector_bootstrap(&self) -> Arc<crate::cef_browser::cef_devtools::BootstrapGate> {
        self.preparation.inspector_bootstrap.clone()
    }

    pub(crate) fn capabilities(&self) -> NativeBrowserCapabilities {
        self.capabilities
    }

    /// Call exactly once after proxy/TLS preparation and before browser creation.
    /// The native owner identity must match this fresh attempt. Readiness remains
    /// blocked until every SetCookie callback succeeds. Failure revokes the relay.
    pub fn import_sign_in_cookies(
        &mut self,
        owner: Arc<dyn CookieOwner>,
        mut cookies: Vec<SignInCookie>,
    ) -> Result<(), RetentionError> {
        if !self.capabilities.cookies_enabled
            || self.browser_claimed
            || self.cookie_import.is_some()
            || owner.identity() != &self.preparation.identity
            || self.status() != PreparationStatus::ProxyConfigured
        {
            return Err(RetentionError::OwnerUnavailable);
        }
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let stamp = cef_session_retention::cef_time(now)?;
        // Loading the encrypted snapshot and preparing its context is async;
        // ordinary cookie expiry during that gap is not a startup failure.
        cookies.retain(|cookie| cookie.expires.is_none_or(|expires| expires > stamp));
        let origins = {
            let session = lock_session(&self.preparation.session, &self.preparation.identity)
                .map_err(|_| RetentionError::OwnerUnavailable)?;
            let policy = session.policy();
            let mut restored = policy
                .retained_network_origins()
                .map_err(|error| match error {
                    sorng_protocols::origin_browser::BrowserPolicyError::TooManyOrigins => {
                        RetentionError::Limit
                    }
                    _ => RetentionError::Invalid,
                })?;
            restored.extend(cookies.iter().map(|cookie| cookie.origin.clone()));
            restored.sort();
            restored.dedup();
            cef_session_retention::validate_retention_origins(
                &restored,
                policy.source_origin(),
                &policy.network_origin_grant(),
            )?;
            cef_session_retention::validate_cookies(&cookies, &restored, now)?;
            // Register only validated, owner-bound cookie origins before CEF
            // import. This neither expands login consent nor grants navigation.
            policy
                .restore_network_origins(&restored)
                .map_err(|error| match error {
                    sorng_protocols::origin_browser::BrowserPolicyError::TooManyOrigins => {
                        RetentionError::Limit
                    }
                    _ => RetentionError::Invalid,
                })?;
            restored
        };
        match cef_session_retention::native::import(&self.context, owner, &origins, cookies) {
            Ok(import) => {
                self.cookie_import = Some(import);
                Ok(())
            }
            Err(error) => {
                self.preparation.fail(ContextError::CreationFailed);
                Err(error)
            }
        }
    }

    /// Native host only. Main must poll completion before closing this context
    /// and save via the authenticated native backend, never via renderer IPC.
    pub fn capture_sign_in_cookies(
        &self,
        owner: Arc<dyn CookieOwner>,
    ) -> Result<CookieCapture, RetentionError> {
        if !self.capabilities.cookies_enabled
            || owner.identity() != &self.preparation.identity
            || self.status() != PreparationStatus::ProxyConfigured
        {
            return Err(RetentionError::OwnerUnavailable);
        }
        let origins = {
            let session = lock_session(&self.preparation.session, &self.preparation.identity)
                .map_err(|_| RetentionError::OwnerUnavailable)?;
            let policy = session.policy();
            let origins = policy
                .retained_network_origins()
                .map_err(|error| match error {
                    sorng_protocols::origin_browser::BrowserPolicyError::TooManyOrigins => {
                        RetentionError::Limit
                    }
                    _ => RetentionError::Invalid,
                })?;
            cef_session_retention::validate_retention_origins(
                &origins,
                policy.source_origin(),
                &policy.network_origin_grant(),
            )?;
            origins
        };
        cef_session_retention::native::capture(&self.context, owner, origins)
    }

    /// Native creation only: claim this attempt's context once, after private
    /// storage and the exact fixed proxy have been read back on the UI thread.
    /// No context handle is exposed through IPC or a readiness assertion.
    pub(crate) fn for_browser_creation(
        &mut self,
        session: &Arc<Mutex<OriginBrowserSession>>,
        identity: &BrowserIdentity,
    ) -> Result<&mut RequestContext, ContextError> {
        if currently_on(ThreadId::UI) == 0 {
            return Err(ContextError::WrongThread);
        }
        if self.status() != PreparationStatus::ProxyConfigured {
            return Err(ContextError::SessionUnavailable);
        }
        self.preparation.claim_creation(
            session,
            identity,
            &mut self.browser_claimed,
            &CefPreferences(&self.context),
        )?;
        Ok(&mut self.context)
    }

    /// Verify CEF's actual browser/context binding before any website navigation.
    /// A matching preference on the supplied factory argument is not sufficient.
    /// This proves identity/configuration, not Network Service socket routing.
    pub(crate) fn verify_browser_binding(&self, browser: &Browser) -> Result<(), ContextError> {
        if currently_on(ThreadId::UI) != 1 {
            return Err(ContextError::WrongThread);
        }
        if !self.browser_claimed || self.status() != PreparationStatus::ProxyConfigured {
            return Err(ContextError::SessionUnavailable);
        }
        self.preparation
            .verify_browser_binding(browser, &mut self.context.clone())
    }
}

impl Drop for PrivateRequestContext {
    fn drop(&mut self) {
        self.preparation.revoke();
        if let Some(tls) = &self.tls {
            tls.revoke();
        }
        // The owner is !Send/!Sync and requires a live CEF UI-thread lifetime.
        self.context.close_all_connections(None);
    }
}

struct ContextTlsHooks {
    preparation: std::sync::Weak<Preparation>,
    hooks: Arc<dyn NativeTlsHooks>,
}
impl NativeTlsHooks for ContextTlsHooks {
    fn on_evidence(&self, evidence: NativeTlsEvidence, completion: NativeTlsCompletion) {
        if self.is_current() {
            self.hooks.on_evidence(evidence, completion);
        }
        // Otherwise completion drops as Deny; never recapture a new owner.
    }
    fn is_current(&self) -> bool {
        self.preparation.upgrade().is_some_and(|preparation| {
            !matches!(
                preparation.current_status(),
                PreparationStatus::Failed(_) | PreparationStatus::Revoked
            )
        }) && self.hooks.is_current()
    }
    fn on_failure(&self) {
        if let Some(preparation) = self.preparation.upgrade() {
            let _ = preparation.session.lock().unwrap_or_else(|err| err.into_inner())
                .revoke_for(&preparation.identity, BrowserSessionFailure::CertificateBridge);
            preparation.fail(ContextError::CreationFailed);
        }
        self.hooks.on_failure();
    }

    fn on_failure_reason(&self, reason: crate::cef_tls_bridge::NativeTlsFailure) {
        if let Some(preparation) = self.preparation.upgrade() {
            // A stale owner is not evidence of a broken TLS bridge. Let the
            // owning attempt record its document/lease evidence before cleanup.
            if reason == crate::cef_tls_bridge::NativeTlsFailure::OwnerUnavailable {
                preparation.revoke();
            } else {
                let _ = preparation.session.lock().unwrap_or_else(|err| err.into_inner())
                    .revoke_for(&preparation.identity, BrowserSessionFailure::CertificateBridge);
                preparation.fail(ContextError::CreationFailed);
            }
        }
        // Forward the fixed reason rather than dropping it at this adapter.
        // Context cleanup above still happens if the application hook panics.
        self.hooks.on_failure_reason(reason);
    }
}

#[cfg(test)]
#[path = "cef_context_binding_tests.rs"]
mod binding_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;
    use sorng_protocols::origin_browser::OriginBrowserPolicy;
    use sorng_protocols::private_forward_proxy::{Authority, DialFuture, ProxyLimits};
    use std::time::Duration;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::{TcpListener, TcpStream};
    use tokio::time::timeout;
    use zeroize::Zeroizing;

    #[derive(Default)]
    struct Preferences {
        written: Option<FixedProxy>,
    }

    impl ProxyPreferences for Preferences {
        fn is_private(&self) -> bool {
            true
        }
        fn write(&mut self, value: &FixedProxy) -> bool {
            self.written = Some(value.clone());
            true
        }
        fn read(&self) -> Option<FixedProxy> {
            self.written.clone()
        }
    }

    async fn preparation() -> Preparation {
        preparation_for("owner", "connection", "tab").await
    }

    async fn preparation_for(database: &str, connection: &str, tab: &str) -> Preparation {
        let policy =
            OriginBrowserPolicy::new(database, connection, tab, "https://fixture.invalid").unwrap();
        let identity = policy.identity().clone();
        let session = OriginBrowserSession::start(
            policy,
            Arc::new(|_: Authority| -> DialFuture {
                panic!("preparation fixture must not dial a destination")
            }),
            ProxyLimits::default(),
        )
        .await
        .unwrap();
        Preparation {
            inspector_bootstrap: Arc::default(),
            session: Arc::new(Mutex::new(session)),
            identity,
            permissions: crate::cef_requests::deny_permissions(),
            status: Mutex::new(PreparationStatus::Initializing),
        }
    }

    // These exercise native preparation identity/proxy ownership. Actual CEF
    // cookie/storage isolation still needs the packaged-engine acceptance test.
    #[tokio::test]
    async fn same_url_connections_and_databases_cannot_claim_each_others_context() {
        let first = preparation_for("owner", "first", "tab-a").await;
        for other in [
            preparation_for("owner", "second", "tab-b").await,
            preparation_for("other-owner", "first", "tab-c").await,
        ] {
            let mut preferences = Preferences::default();
            other.configure(&mut preferences).unwrap();
            assert_ne!(
                first.session.lock().unwrap().proxy_endpoint(),
                other.session.lock().unwrap().proxy_endpoint(),
            );
            let mut claimed = false;
            // Even substituting both a foreign session and its matching
            // identity cannot claim a prepared context owned by this attempt.
            assert_eq!(
                other.claim_creation(&first.session, &first.identity, &mut claimed, &preferences,),
                Err(ContextError::SessionUnavailable),
            );
            assert!(!claimed);
            other
                .claim_creation(&other.session, &other.identity, &mut claimed, &preferences)
                .unwrap();
            assert!(claimed);
            other.revoke();
            assert_eq!(
                first.session.lock().unwrap().status(),
                BrowserSessionStatus::NotReady,
            );
        }
    }

    #[tokio::test]
    async fn reconnect_same_owner_connection_and_tab_requires_a_fresh_attempt() {
        let previous = preparation().await;
        let next = preparation().await;
        assert_ne!(previous.identity.attempt_id(), next.identity.attempt_id());
        let mut preferences = Preferences::default();
        next.configure(&mut preferences).unwrap();
        let mut claimed = false;
        assert_eq!(
            next.claim_creation(
                &next.session,
                &previous.identity,
                &mut claimed,
                &preferences,
            ),
            Err(ContextError::SessionUnavailable),
        );
        assert!(!claimed);
        previous.revoke();
        next.claim_creation(&next.session, &next.identity, &mut claimed, &preferences)
            .unwrap();
        assert!(claimed);
    }

    #[tokio::test]
    async fn configuration_is_one_time_and_never_reports_host_ready() {
        let preparation = preparation().await;
        let mut prefs = Preferences::default();
        preparation.configure(&mut prefs).unwrap();
        assert_eq!(
            *preparation.status.lock().unwrap(),
            PreparationStatus::ProxyConfigured
        );
        let session = preparation.session.lock().unwrap();
        assert_eq!(session.status(), BrowserSessionStatus::NotReady);
        assert!(session
            .authorize_navigation(&preparation.identity, "https://fixture.invalid/")
            .is_err());
        drop(session);
        assert_eq!(
            preparation.configure(&mut prefs),
            Err(ContextError::SessionUnavailable)
        );
    }

    #[tokio::test]
    async fn browser_claim_requires_installed_proxy_and_is_single_use() {
        let preparation = preparation().await;
        let mut prefs = Preferences::default();
        let mut claimed = false;
        assert_eq!(
            preparation.claim_creation(
                &preparation.session,
                &preparation.identity,
                &mut claimed,
                &prefs
            ),
            Err(ContextError::SessionUnavailable)
        );
        assert!(!claimed);
        preparation.configure(&mut prefs).unwrap();
        preparation
            .claim_creation(
                &preparation.session,
                &preparation.identity,
                &mut claimed,
                &prefs,
            )
            .unwrap();
        assert!(claimed);
        assert_eq!(
            preparation.session.lock().unwrap().status(),
            BrowserSessionStatus::NotReady
        );
        assert_eq!(
            preparation.claim_creation(
                &preparation.session,
                &preparation.identity,
                &mut claimed,
                &prefs
            ),
            Err(ContextError::SessionUnavailable)
        );
    }

    #[tokio::test]
    async fn browser_claim_rechecks_proxy_and_owner_immediately_before_creation() {
        let preparation = preparation().await;
        let foreign = self::preparation().await;
        let mut prefs = Preferences::default();
        preparation.configure(&mut prefs).unwrap();
        let mut claimed = false;
        assert_eq!(
            preparation.claim_creation(
                &foreign.session,
                &preparation.identity,
                &mut claimed,
                &prefs
            ),
            Err(ContextError::SessionUnavailable)
        );
        assert_eq!(
            preparation.claim_creation(
                &preparation.session,
                &foreign.identity,
                &mut claimed,
                &prefs
            ),
            Err(ContextError::SessionUnavailable)
        );
        assert!(!claimed);
        prefs.written.as_mut().unwrap().bypass_list.clear();
        assert_eq!(
            preparation.claim_creation(
                &preparation.session,
                &preparation.identity,
                &mut claimed,
                &prefs
            ),
            Err(ContextError::ProxyMismatch)
        );
        assert!(!claimed);
        assert_revoked(&preparation);
        assert_eq!(
            foreign.session.lock().unwrap().status(),
            BrowserSessionStatus::NotReady
        );
    }

    #[tokio::test]
    async fn revoked_preparation_cannot_install_proxy() {
        let preparation = preparation().await;
        preparation.revoke();
        let mut prefs = Preferences::default();
        assert_eq!(
            preparation.configure(&mut prefs),
            Err(ContextError::SessionUnavailable)
        );
        assert!(prefs.written.is_none());
    }

    #[tokio::test]
    async fn stale_initializer_cannot_configure_or_revoke_replacement() {
        let mut stale = preparation().await;
        let replacement = preparation().await;
        stale.session = replacement.session.clone();
        let mut prefs = Preferences::default();
        assert_eq!(
            stale.configure(&mut prefs),
            Err(ContextError::SessionUnavailable)
        );
        assert!(prefs.written.is_none());
        stale.fail(ContextError::SessionUnavailable);
        assert_eq!(
            replacement.session.lock().unwrap().status(),
            BrowserSessionStatus::NotReady
        );
    }

    #[tokio::test]
    async fn failed_preparation_revokes_retained_relay() {
        let preparation = preparation().await;
        preparation.fail(ContextError::ProxyMismatch);
        assert_eq!(
            *preparation.status.lock().unwrap(),
            PreparationStatus::Failed(ContextError::ProxyMismatch)
        );
        assert_eq!(
            preparation.session.lock().unwrap().status(),
            BrowserSessionStatus::Revoked
        );
        assert!(preparation
            .session
            .lock()
            .unwrap()
            .with_proxy_credentials(|_, _| ())
            .is_none());
    }

    fn poison<T>(mutex: &Mutex<T>) {
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _guard = mutex.lock().unwrap();
            panic!("poison fixture");
        }));
        assert!(mutex.is_poisoned());
    }

    fn assert_revoked(preparation: &Preparation) {
        let session = preparation
            .session
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        assert_eq!(session.status(), BrowserSessionStatus::Revoked);
        assert!(session.with_proxy_credentials(|_, _| ()).is_none());
    }

    #[tokio::test]
    async fn reading_poisoned_preparation_revokes_transport_without_clearing_poison() {
        for poison_session in [true, false] {
            let preparation = preparation().await;
            preparation.configure(&mut Preferences::default()).unwrap();
            if poison_session {
                poison(&preparation.session);
            } else {
                poison(&preparation.status);
            }
            assert_eq!(preparation.current_status(), PreparationStatus::Revoked);
            assert_revoked(&preparation);
            assert_eq!(preparation.session.is_poisoned(), poison_session);
            assert_eq!(preparation.status.is_poisoned(), !poison_session);
        }
    }

    #[tokio::test]
    async fn poisoned_preparation_cannot_configure_and_revokes_existing_transport() {
        for poison_session in [true, false] {
            let preparation = preparation().await;
            if poison_session {
                poison(&preparation.session);
            } else {
                poison(&preparation.status);
            }
            let mut prefs = Preferences::default();
            assert_eq!(
                preparation.configure(&mut prefs),
                Err(ContextError::SessionUnavailable)
            );
            assert!(prefs.written.is_none());
            assert_revoked(&preparation);
            assert_eq!(preparation.session.is_poisoned(), poison_session);
            assert_eq!(preparation.status.is_poisoned(), !poison_session);
        }
    }

    #[tokio::test]
    async fn stale_poisoned_preparation_never_revokes_replacement() {
        for poison_session in [true, false] {
            let mut stale = preparation().await;
            let replacement = preparation().await;
            stale.session = replacement.session.clone();
            if poison_session {
                poison(&stale.session);
            } else {
                poison(&stale.status);
            }
            assert_eq!(stale.current_status(), PreparationStatus::Revoked);
            assert_eq!(
                stale.configure(&mut Preferences::default()),
                Err(ContextError::SessionUnavailable)
            );
            let session = replacement
                .session
                .lock()
                .unwrap_or_else(|err| err.into_inner());
            assert_eq!(session.status(), BrowserSessionStatus::NotReady);
            assert!(session.with_proxy_credentials(|_, _| ()).is_some());
        }
    }

    #[tokio::test]
    async fn status_inspection_closes_established_tunnel_after_either_lock_is_poisoned() {
        timeout(Duration::from_secs(10), async {
            for poison_session in [true, false] {
                let destination = TcpListener::bind("127.0.0.1:0").await.unwrap();
                let address = destination.local_addr().unwrap();
                let policy = OriginBrowserPolicy::new(
                    "owner", "connection", "tab", "https://fixture.invalid",
                ).unwrap();
                let identity = policy.identity().clone();
                let session = OriginBrowserSession::start(
                    policy,
                    Arc::new(move |authority: Authority| -> DialFuture {
                        assert_eq!(authority.host(), "fixture.invalid");
                        assert_eq!(authority.port(), 443);
                        Box::pin(async move {
                            Ok(Box::new(TcpStream::connect(address).await?) as _)
                        })
                    }),
                    ProxyLimits::default(),
                ).await.unwrap();
                let endpoint = session.proxy_endpoint();
                let request = session.with_proxy_credentials(|username, password| {
                    let credentials = Zeroizing::new(format!("{username}:{password}"));
                    let encoded = Zeroizing::new(base64::engine::general_purpose::STANDARD.encode(credentials.as_bytes()));
                    Zeroizing::new(format!("CONNECT fixture.invalid:443 HTTP/1.1\r\nHost: fixture.invalid:443\r\nProxy-Authorization: Basic {}\r\n\r\n", encoded.as_str()))
                }).unwrap();
                let preparation = Preparation {
                    inspector_bootstrap: Arc::default(),
                    session: Arc::new(Mutex::new(session)),
                    identity,
                    permissions: crate::cef_requests::deny_permissions(),
                    status: Mutex::new(PreparationStatus::Initializing),
                };
                preparation.configure(&mut Preferences::default()).unwrap();
                let mut client = TcpStream::connect(endpoint).await.unwrap();
                client.write_all(request.as_bytes()).await.unwrap();
                drop(request);
                let mut head = Vec::new();
                while !head.ends_with(b"\r\n\r\n") {
                    assert!(head.len() < 8192);
                    head.push(client.read_u8().await.unwrap());
                }
                assert!(head.starts_with(b"HTTP/1.1 200 "));
                let (mut upstream, _) = destination.accept().await.unwrap();
                client.write_all(b"alive").await.unwrap();
                let mut marker = [0; 5];
                upstream.read_exact(&mut marker).await.unwrap();
                assert_eq!(&marker, b"alive");
                if poison_session {
                    poison(&preparation.session);
                } else {
                    poison(&preparation.status);
                }
                assert_eq!(preparation.current_status(), PreparationStatus::Revoked);
                assert_revoked(&preparation);
                assert_eq!(preparation.session.is_poisoned(), poison_session);
                assert_eq!(preparation.status.is_poisoned(), !poison_session);
                let mut byte = [0];
                for stream in [&mut client, &mut upstream] {
                    match stream.read(&mut byte).await {
                        Ok(0) => {}
                        Err(error) if matches!(error.kind(),
                            std::io::ErrorKind::ConnectionReset |
                            std::io::ErrorKind::ConnectionAborted |
                            std::io::ErrorKind::BrokenPipe) => {}
                        _ => panic!("revoked context tunnel remained readable"),
                    }
                }
            }
        }).await.expect("poisoned context did not close its active tunnel");
    }

    mod tls_failure_adapter {
        use super::*;
        use crate::cef_tls_bridge::NativeTlsFailure;
        use std::sync::atomic::{AtomicUsize, Ordering};

        #[derive(Debug, PartialEq, Eq)]
        struct Observation {
            reason: Option<NativeTlsFailure>,
            session_status: Option<BrowserSessionStatus>,
            preparation_status: Option<PreparationStatus>,
            first_failure: Option<BrowserSessionFailure>,
            owner_reason_applied: bool,
        }

        struct Hooks {
            preparation: std::sync::Weak<Preparation>,
            owner_reason: Option<BrowserSessionFailure>,
            observations: Mutex<Vec<Observation>>,
            completed: AtomicUsize,
        }

        impl Hooks {
            fn observe(&self, reason: Option<NativeTlsFailure>) {
                let mut observed = Observation {
                    reason,
                    session_status: None,
                    preparation_status: None,
                    first_failure: None,
                    owner_reason_applied: false,
                };
                if let Some(preparation) = self.preparation.upgrade() {
                    // Record failed try_lock as None; assert only outside the
                    // callback, where production catch_unwind cannot hide it.
                    if let Ok(session) = preparation.session.try_lock() {
                        observed.session_status = Some(session.status());
                        observed.first_failure = session.failure_reason();
                    }
                    if let Ok(status) = preparation.status.try_lock() {
                        observed.preparation_status = Some(*status);
                    }
                    if let Some(owner_reason) = self.owner_reason {
                        if let Ok(mut session) = preparation.session.try_lock() {
                            observed.owner_reason_applied = session
                                .revoke_for(&preparation.identity, owner_reason)
                                .is_ok();
                        }
                    }
                }
                self.observations.lock().unwrap().push(observed);
                self.completed.fetch_add(1, Ordering::SeqCst);
            }
        }

        impl NativeTlsHooks for Hooks {
            fn on_evidence(&self, _: NativeTlsEvidence, _: NativeTlsCompletion) {}
            fn is_current(&self) -> bool {
                true
            }
            fn on_failure(&self) {
                self.observe(None);
            }
            fn on_failure_reason(&self, reason: NativeTlsFailure) {
                self.observe(Some(reason));
            }
        }

        fn adapter(
            preparation: &Arc<Preparation>,
            owner_reason: Option<BrowserSessionFailure>,
        ) -> (ContextTlsHooks, Arc<Hooks>) {
            let hooks = Arc::new(Hooks {
                preparation: Arc::downgrade(preparation),
                owner_reason,
                observations: Mutex::new(Vec::new()),
                completed: AtomicUsize::new(0),
            });
            (
                ContextTlsHooks {
                    preparation: Arc::downgrade(preparation),
                    hooks: hooks.clone(),
                },
                hooks,
            )
        }

        fn assert_callback(hooks: &Hooks, expected: Observation) {
            assert_eq!(hooks.completed.load(Ordering::SeqCst), 1);
            assert_eq!(*hooks.observations.lock().unwrap(), vec![expected]);
        }

        #[tokio::test]
        async fn bridge_reason_precedes_cleanup_and_typed_or_legacy_delivery_is_unlocked() {
            for reason in [
                Some(NativeTlsFailure::CompleteRejected),
                Some(NativeTlsFailure::EngineFailure),
                None,
            ] {
                let preparation = Arc::new(preparation().await);
                let (adapter, hooks) = adapter(&preparation, None);
                match reason {
                    Some(reason) => adapter.on_failure_reason(reason),
                    None => adapter.on_failure(),
                }
                assert_callback(
                    &hooks,
                    Observation {
                        reason,
                        session_status: Some(BrowserSessionStatus::Revoked),
                        preparation_status: Some(PreparationStatus::Failed(
                            ContextError::CreationFailed,
                        )),
                        first_failure: Some(BrowserSessionFailure::CertificateBridge),
                        owner_reason_applied: false,
                    },
                );
                assert!(preparation
                    .session
                    .lock()
                    .unwrap()
                    .with_proxy_credentials(|_, _| ())
                    .is_none());
            }
        }

        #[tokio::test]
        async fn owner_unavailable_leaves_first_cause_for_owner_evidence() {
            let preparation = Arc::new(preparation().await);
            let owner_reason = BrowserSessionFailure::owner_loss(true, false, false).unwrap();
            let (adapter, hooks) = adapter(&preparation, Some(owner_reason));
            adapter.on_failure_reason(NativeTlsFailure::OwnerUnavailable);
            assert_callback(
                &hooks,
                Observation {
                    reason: Some(NativeTlsFailure::OwnerUnavailable),
                    session_status: Some(BrowserSessionStatus::Revoked),
                    preparation_status: Some(PreparationStatus::Revoked),
                    first_failure: None,
                    owner_reason_applied: true,
                },
            );
            assert_eq!(
                preparation.session.lock().unwrap().failure_reason(),
                Some(BrowserSessionFailure::DatabaseOwner)
            );
        }

        #[tokio::test]
        async fn bridge_cleanup_preserves_an_existing_session_failure() {
            for first in [
                BrowserSessionFailure::PrivateProxy,
                BrowserSessionFailure::Watchdog,
            ] {
                let preparation = Arc::new(preparation().await);
                preparation
                    .session
                    .lock()
                    .unwrap()
                    .revoke_for(&preparation.identity, first)
                    .unwrap();
                let (adapter, hooks) = adapter(&preparation, None);
                adapter.on_failure_reason(NativeTlsFailure::CompleteRejected);
                assert_callback(
                    &hooks,
                    Observation {
                        reason: Some(NativeTlsFailure::CompleteRejected),
                        session_status: Some(BrowserSessionStatus::Revoked),
                        preparation_status: Some(PreparationStatus::Failed(
                            ContextError::CreationFailed,
                        )),
                        first_failure: Some(first),
                        owner_reason_applied: false,
                    },
                );
            }
        }

        #[tokio::test]
        async fn stale_adapter_cannot_relabel_or_revoke_a_successor_session() {
            let mut stale = preparation().await;
            let successor = preparation().await;
            assert!(stale.identity != successor.identity);
            stale.session = successor.session.clone();
            let stale = Arc::new(stale);
            let (adapter, hooks) = adapter(&stale, None);
            adapter.on_failure_reason(NativeTlsFailure::EngineRevoked);
            assert_callback(
                &hooks,
                Observation {
                    reason: Some(NativeTlsFailure::EngineRevoked),
                    session_status: Some(BrowserSessionStatus::NotReady),
                    preparation_status: Some(PreparationStatus::Failed(ContextError::CreationFailed)),
                    first_failure: None,
                    owner_reason_applied: false,
                },
            );
            assert_eq!(
                *successor.status.lock().unwrap(),
                PreparationStatus::Initializing
            );
            let session = successor.session.lock().unwrap();
            assert_eq!(session.failure_reason(), None);
            assert_eq!(session.status(), BrowserSessionStatus::NotReady);
            assert!(session.with_proxy_credentials(|_, _| ()).is_some());
        }
    }
}
