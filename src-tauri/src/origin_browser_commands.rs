//! App-shell IPC for native website views. Remote CEF pages have no Tauri IPC.
//! The calling window and the native database lease remain authoritative.

use sorng_browser_host::ipc::*;
use sorng_browser_host::native_downloads::{
    DownloadControlRequest, DownloadListRequest, DownloadSnapshot,
};
use sorng_commands_core::origin_browser_authority::prewarm::PrewarmRequest;
use sorng_encryption::EncryptionState;
use tauri::{State, WebviewWindow};

#[cfg(feature = "native-browser")]
type StartupDocument = crate::origin_browser_runtime::StartupDocument;
#[cfg(not(feature = "native-browser"))]
struct StartupDocument;

pub(crate) fn is_startup_command(command: &str) -> bool {
    matches!(command, "origin_browser_create" | "origin_browser_prewarm")
}

/// These two commands cannot use the generated async wrapper: it extracts
/// arguments only after spawning, when a reload may already have replaced the
/// issuing document. Capture the native epoch here and move it into the task.
pub(crate) fn dispatch_startup(invoke: tauri::ipc::Invoke) -> bool {
    use tauri::ipc::{CommandArg, CommandItem, Invoke};
    let Invoke {
        message,
        resolver,
        acl,
    } = invoke;
    let name = match message.command() {
        "origin_browser_create" => "origin_browser_create",
        "origin_browser_prewarm" => "origin_browser_prewarm",
        _ => {
            resolver.reject("Unsupported browser startup command");
            return true;
        }
    };
    let window = match WebviewWindow::from_command(CommandItem {
        plugin: None,
        name,
        key: "window",
        message: &message,
        acl: &acl,
    }) {
        Ok(window) => window,
        Err(error) => {
            resolver.invoke_error(error);
            return true;
        }
    };
    #[cfg(feature = "native-browser")]
    let document = crate::origin_browser_runtime::capture_startup_document(window.label());
    #[cfg(not(feature = "native-browser"))]
    let document = StartupDocument;
    macro_rules! request {
        ($ty:ty) => {
            match <$ty>::from_command(CommandItem {
                plugin: None,
                name,
                key: "request",
                message: &message,
                acl: &acl,
            }) {
                Ok(request) => request,
                Err(_) => {
                    // Do not echo malformed payload fields, URLs or secrets.
                    resolver.reject("Browser creation request is invalid");
                    return true;
                }
            }
        };
    }
    if name == "origin_browser_create" {
        let request = request!(OriginBrowserCreateRequest);
        if crate::application_log_commands::require_shell(&window).is_err() {
            resolver.reject("Browser creation is available only in an app window.");
            return true;
        }
        #[cfg(feature = "native-browser")]
        let request_scope = match sorng_commands_core::origin_browser_authority::ssh_command_review::begin_request(&window, &request) {
            Ok(scope) => scope,
            Err(error) => {
                resolver.reject(error);
                return true;
            }
        };
        resolver.respond_async(crate::origin_browser_startup_task::task(move || async move {
            #[cfg(feature = "native-browser")]
            let _request_scope = request_scope;
            let state: State<'_, EncryptionState> = State::from_command(CommandItem {
                plugin: None,
                name,
                key: "state",
                message: &message,
                acl: &acl,
            })?;
            origin_browser_create(window, state, request, document)
                .await
                .map_err(Into::into)
        }));
    } else {
        let request = request!(PrewarmRequest);
        resolver.respond_async(crate::origin_browser_startup_task::task(move || async move {
            let state: State<'_, EncryptionState> = State::from_command(CommandItem {
                plugin: None,
                name,
                key: "state",
                message: &message,
                acl: &acl,
            })?;
            origin_browser_prewarm(window, state, request, document)
                .await
                .map_err(Into::into)
        }));
    }
    true
}

#[cfg(not(feature = "native-browser"))]
const UNAVAILABLE: &str = "The packaged real-origin browser is unavailable. No website was opened and no direct-network fallback was used.";

pub(crate) fn is_command(command: &str) -> bool {
    matches!(
        command,
        "origin_browser_create"
            | "origin_browser_session_diagnostics"
            | "origin_browser_prewarm"
            | "origin_browser_cancel_prewarm"
            | "origin_browser_retention_capabilities"
            | "origin_browser_status"
            | "origin_browser_navigate"
            | "origin_browser_control"
            | "origin_browser_close"
            | "origin_browser_automation"
            | "origin_browser_downloads"
            | "origin_browser_download_control"
            | "origin_browser_extensions"
            | "origin_browser_popup"
            | "origin_browser_certificate_review"
            | "origin_browser_page_menu"
            | "origin_browser_recording"
            | "origin_browser_appearance"
            | "origin_browser_diagnose"
            | "origin_browser_manual_input"
            | "origin_browser_cancel_login"
            | "origin_browser_retry_login"
            | "origin_browser_ssh_respond_to_command_review"
            | "origin_browser_ssh_cancel_pending_create"
            | "origin_browser_clear_connection_data"
            | "origin_browser_http_cache_usage"
            | "origin_browser_clear_all_http_cache"
    )
}

#[tauri::command]
pub(crate) async fn origin_browser_ssh_respond_to_command_review(
    window: WebviewWindow,
    state: State<'_, EncryptionState>,
    nonce: String,
    accepted: bool,
) -> Result<(), String> {
    crate::application_log_commands::require_shell(&window)
        .map_err(|_| "SSH command review is available only in an app window.")?;
    #[cfg(feature = "native-browser")]
    {
        sorng_commands_core::origin_browser_authority::ssh_command_review::respond(
            &window, &state, &nonce, accepted,
        ).await
    }
    #[cfg(not(feature = "native-browser"))]
    {
        let _ = (window, state, nonce, accepted);
        Err(UNAVAILABLE.into())
    }
}

#[tauri::command]
pub(crate) fn origin_browser_ssh_cancel_pending_create(
    window: WebviewWindow,
    state: State<'_, EncryptionState>,
    request_id: String,
) -> Result<(), String> {
    crate::application_log_commands::require_shell(&window)
        .map_err(|_| "Browser cancellation is available only in an app window.")?;
    #[cfg(feature = "native-browser")]
    {
        sorng_commands_core::origin_browser_authority::ssh_command_review::cancel(
            &window, &state, &request_id,
        )
    }
    #[cfg(not(feature = "native-browser"))]
    {
        let _ = (window, state, request_id);
        Err(UNAVAILABLE.into())
    }
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum LoginCancelReason { UserCancelled, AttemptTimeout }

pub(crate) struct CancelLoginRequest {
    pub identity: OriginBrowserIdentity,
    pub reason: LoginCancelReason,
}

impl<'de> serde::Deserialize<'de> for CancelLoginRequest {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct Wire { identity: OriginBrowserIdentity, reason: LoginCancelReason }
        let wire = <Wire as serde::Deserialize>::deserialize(deserializer)
            .map_err(|_| serde::de::Error::custom("Browser login cancellation request is invalid"))?;
        wire.identity.validate()
            .map_err(|_| serde::de::Error::custom("Browser login cancellation request is invalid"))?;
        Ok(Self { identity: wire.identity, reason: wire.reason })
    }
}

/// The automatic-login step a user retries on the page that is open now.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum LoginRetryStep { Credentials, Mfa }

/// Only the attempt and the step: never a credential, code, URL or reload.
pub(crate) struct RetryLoginRequest {
    pub identity: OriginBrowserIdentity,
    pub step: LoginRetryStep,
}

impl<'de> serde::Deserialize<'de> for RetryLoginRequest {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct Wire { identity: OriginBrowserIdentity, step: LoginRetryStep }
        let wire = <Wire as serde::Deserialize>::deserialize(deserializer)
            .map_err(|_| serde::de::Error::custom("Browser login retry request is invalid"))?;
        wire.identity.validate()
            .map_err(|_| serde::de::Error::custom("Browser login retry request is invalid"))?;
        Ok(Self { identity: wire.identity, step: wire.step })
    }
}

/// `{status:"started"}` or `{status:"refused", reason}` with a fixed reason:
/// not-current, no-login, busy, no-mfa, code-used, rate-limited or no-form.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
#[cfg_attr(not(feature = "native-browser"), allow(dead_code))]
pub(crate) enum RetryLoginReceipt {
    Started,
    Refused { reason: &'static str },
}

/// Re-run automatic login on the CURRENT page of this exact attempt, in place.
/// Never reloads, navigates or reconnects; refuses rather than falling back.
#[tauri::command]
pub(crate) async fn origin_browser_retry_login(
    window: WebviewWindow,
    state: State<'_, EncryptionState>,
    request: RetryLoginRequest,
) -> Result<RetryLoginReceipt, String> {
    request.identity.validate().map_err(|_| "Browser login retry request is invalid".to_owned())?;
    #[cfg(feature = "native-browser")]
    { crate::origin_browser_runtime::retry_login(window, &state, request).await }
    #[cfg(not(feature = "native-browser"))]
    { let _ = (window, state, request.identity, request.step); Err(UNAVAILABLE.into()) }
}

#[tauri::command]
pub(crate) async fn origin_browser_cancel_login(
    window: WebviewWindow,
    request: CancelLoginRequest,
) -> Result<bool, String> {
    request.identity.validate().map_err(|_| "Browser login cancellation request is invalid".to_owned())?;
    #[cfg(feature = "native-browser")]
    { crate::origin_browser_runtime::cancel_login(window, request) }
    #[cfg(not(feature = "native-browser"))]
    { let _ = (window, request.identity, request.reason); Err(UNAVAILABLE.into()) }
}

#[tauri::command]
pub(crate) fn origin_browser_session_diagnostics(
    window: WebviewWindow,
) -> Result<crate::origin_browser_observability::SessionDiagnosticsResponse, String> {
    crate::application_log_commands::require_shell(&window)?;
    #[cfg(feature = "native-browser")]
    { crate::origin_browser_runtime::observability::snapshot(&window) }
    #[cfg(not(feature = "native-browser"))]
    { Ok(crate::origin_browser_observability::SessionDiagnosticsResponse { available: false, sessions: vec![] }) }
}

#[tauri::command]
pub(crate) async fn origin_browser_manual_input(
    window: WebviewWindow,
    state: State<'_, EncryptionState>,
    request: sorng_browser_host::native_manual_input::ManualInputRequest,
) -> Result<sorng_browser_host::native_manual_input::ManualInputResponse, String> {
    #[cfg(feature = "native-browser")]
    { crate::origin_browser_runtime::manual_input::operate(window, &state, request).await }
    #[cfg(not(feature = "native-browser"))]
    { let _ = (window, state, request); Err(UNAVAILABLE.into()) }
}

#[tauri::command]
pub(crate) async fn origin_browser_diagnose(
    window: WebviewWindow,
    state: State<'_, EncryptionState>,
    request: crate::origin_browser_diagnostics::DiagnoseRequest,
) -> Result<crate::origin_browser_diagnostics::DiagnoseResponse, String> {
    #[cfg(feature = "native-browser")]
    {
        crate::origin_browser_runtime::diagnostics_probe::diagnose(window, &state, request).await
    }
    #[cfg(not(feature = "native-browser"))]
    {
        let _ = (window, state, request);
        Err(UNAVAILABLE.into())
    }
}

#[tauri::command]
pub(crate) async fn origin_browser_appearance(
    window: WebviewWindow,
    state: State<'_, EncryptionState>,
    request: crate::origin_browser_appearance_request::AppearanceRequest,
) -> Result<crate::origin_browser_appearance_request::AppearanceResponse, String> {
    #[cfg(feature = "native-browser")]
    { crate::origin_browser_runtime::appearance::apply(window, &state, request).await }
    #[cfg(not(feature = "native-browser"))]
    { let _ = (window, state, request); Err(UNAVAILABLE.into()) }
}

#[tauri::command]
pub(crate) async fn origin_browser_page_menu(
    window: WebviewWindow,
    state: State<'_, EncryptionState>,
    request: crate::origin_browser_page_request::PageMenuRequest,
) -> Result<serde_json::Value, String> {
    #[cfg(feature = "native-browser")]
    { crate::origin_browser_runtime::page_menu::operate(window, &state, request).await }
    #[cfg(not(feature = "native-browser"))]
    { let _ = (window, state, request); Err(UNAVAILABLE.into()) }
}

#[tauri::command]
pub(crate) fn origin_browser_certificate_review(
    window: WebviewWindow,
    request: crate::origin_browser_certificate_prompt::Request,
) -> Result<crate::origin_browser_certificate_prompt::Snapshot, String> {
    #[cfg(feature = "native-browser")]
    { crate::origin_browser_runtime::certificate_review::operate(&window, request) }
    #[cfg(not(feature = "native-browser"))]
    { let _ = (window, request); Err(UNAVAILABLE.into()) }
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PopupRequest {
    pub source_identity: OriginBrowserIdentity,
    pub action: PopupAction,
}

#[derive(serde::Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", rename_all_fields = "camelCase", deny_unknown_fields)]
pub(crate) enum PopupAction {
    List {},
    Adopt { view_id: String },
    Close { view_id: String },
    Select { view_id: Option<String>, revision: u64 },
    Navigate { view_id: Option<String>, url: String },
    OpenTab { view_id: Option<String>, url: Option<String>, presentation_revision: u64 },
    Control { view_id: Option<String>, action: OriginBrowserAction },
    Downloads { view_id: Option<String> },
    DownloadControl { view_id: Option<String>, request: DownloadControlRequest },
}

impl PopupRequest {
    pub(crate) fn validate(&self) -> Result<(), String> {
        self.source_identity.validate().map_err(|e| e.to_string())?;
        let view = match &self.action {
            PopupAction::List {} => None,
            PopupAction::Adopt { view_id } | PopupAction::Close { view_id } => Some(view_id),
            PopupAction::Select { view_id, revision } => {
                if *revision == 0 || *revision > MAX_JS_INTEGER { return Err("Invalid popup selection".into()); }
                view_id.as_ref()
            }
            PopupAction::Navigate { view_id, url } => {
                OriginBrowserNavigateRequest { identity: self.source_identity.clone(), url: url.clone() }
                    .validate().map_err(|e| e.to_string())?;
                view_id.as_ref()
            }
            PopupAction::OpenTab { view_id, url, presentation_revision } => {
                if *presentation_revision == 0 || *presentation_revision > MAX_JS_INTEGER {
                    return Err("Invalid popup presentation".into());
                }
                if let Some(url) = url {
                    OriginBrowserNavigateRequest { identity: self.source_identity.clone(), url: url.clone() }
                        .validate().map_err(|e| e.to_string())?;
                }
                view_id.as_ref()
            }
            PopupAction::Control { view_id, action } => {
                if matches!(action, OriginBrowserAction::Presentation { .. }) { return Err("Popup geometry uses the source viewport".into()); }
                action.validate().map_err(|e| e.to_string())?;
                view_id.as_ref()
            }
            PopupAction::Downloads { view_id } => view_id.as_ref(),
            PopupAction::DownloadControl { view_id, request } => {
                request.validate().map_err(|_| "Invalid popup download".to_owned())?;
                if request.identity != self.source_identity { return Err("Invalid popup download owner".into()); }
                view_id.as_ref()
            }
        };
        if view.is_some_and(|id| id.is_empty() || id.len() > 256 || id.chars().any(|c| c.is_control() || c.is_whitespace())) {
            return Err("Invalid popup view".into());
        }
        Ok(())
    }
}

#[tauri::command]
pub(crate) async fn origin_browser_popup(
    window: WebviewWindow, state: State<'_, EncryptionState>, request: PopupRequest,
) -> Result<serde_json::Value, String> {
    request.validate()?;
    #[cfg(feature = "native-browser")]
    { crate::origin_browser_runtime::popups::operate(window, &state, request).await }
    #[cfg(not(feature = "native-browser"))]
    { let _ = (window, state, request); Err(UNAVAILABLE.into()) }
}

async fn origin_browser_prewarm(
    window: WebviewWindow,
    state: State<'_, EncryptionState>,
    request: PrewarmRequest,
    document: StartupDocument,
) -> Result<(), String> {
    request.validate().map_err(|error| error.to_string())?;
    #[cfg(feature = "native-browser")]
    {
        crate::origin_browser_runtime::prewarm(window, &state, request, document).await
    }
    #[cfg(not(feature = "native-browser"))]
    {
        let _ = (window, state, request, document);
        Err(UNAVAILABLE.into())
    }
}

#[tauri::command]
pub(crate) fn origin_browser_cancel_prewarm(window: WebviewWindow) {
    #[cfg(feature = "native-browser")]
    crate::origin_browser_runtime::cancel_prewarm(window.label());
    #[cfg(not(feature = "native-browser"))]
    let _ = window;
}

/// Read-only implementation capability; never a database unlock, cookie read,
/// consent grant, or promise that the current database is available.
/// `httpDiskCache` describes the per-connection page cache (t-cefiso C-H5);
/// its presence tells the shell that native parsing accepts the
/// `browserSession.httpCache` override. Since t-mitmproxy the cache lives in
/// the intercepting proxy: `available` means the engine can run intercepting
/// attempts (it trusts a per-attempt CA) and the cache root is device-local.
/// The reason strings are unchanged.
#[tauri::command]
pub(crate) fn origin_browser_retention_capabilities() -> serde_json::Value {
    #[cfg(feature = "native-browser")]
    let available = crate::origin_browser_runtime::retention_available();
    #[cfg(not(feature = "native-browser"))]
    let available = false;
    #[cfg(feature = "native-browser")]
    let http_disk_cache = crate::origin_browser_runtime::http_cache::capability()
        .err()
        .map(crate::origin_browser_runtime::http_cache::Unavailable::code);
    #[cfg(not(feature = "native-browser"))]
    let http_disk_cache = Some("unavailable");
    serde_json::json!({
        "memory": available,
        "encryptedDatabase": available,
        "policyExpiration": available,
        "clearOnDatabaseLock": available,
        "httpDiskCache": http_disk_cache_capability(http_disk_cache),
    })
}

fn http_disk_cache_capability(reason: Option<&'static str>) -> serde_json::Value {
    match reason {
        None => serde_json::json!({ "available": true }),
        Some(reason) => serde_json::json!({ "available": false, "reason": reason }),
    }
}

/// Saved connection id from the shell; never a database id, path or size.
fn valid_connection_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 256 && !id.chars().any(char::is_control)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ClearConnectionDataRequest {
    pub connection_id: String,
    pub cookies: bool,
    pub cache: bool,
}

#[derive(Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(not(feature = "native-browser"), allow(dead_code))]
pub(crate) struct ClearConnectionDataResult {
    pub cookies_cleared: bool,
    pub cache_cleared: bool,
    pub cache_pending_restart: bool,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct HttpCacheUsageRequest {
    #[serde(default)]
    pub connection_id: Option<String>,
}

#[derive(Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HttpCacheUsage {
    pub available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<&'static str>,
    pub bytes: u64,
    pub limit_bytes: u64,
}

#[derive(Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(not(feature = "native-browser"), allow(dead_code))]
pub(crate) struct ClearAllHttpCacheResult {
    pub cleared: bool,
    pub pending_restart: bool,
}

/// Clears one connection's retained sign-in cookies and/or page cache in the
/// databases this window holds unlocked. Refuses with exactly
/// `browser-session-open` while an attempt of that connection is live.
#[tauri::command]
pub(crate) async fn origin_browser_clear_connection_data(
    window: WebviewWindow,
    state: State<'_, EncryptionState>,
    request: ClearConnectionDataRequest,
) -> Result<ClearConnectionDataResult, String> {
    crate::application_log_commands::require_shell(&window)
        .map_err(|_| "Browser data is unavailable outside an app window.")?;
    if !valid_connection_id(&request.connection_id) {
        return Err("Browser data request is invalid".into());
    }
    #[cfg(feature = "native-browser")]
    {
        let (cookies_cleared, cache) = crate::origin_browser_runtime::http_cache::clear_connection_data(
            &window,
            &state,
            &request.connection_id,
            request.cookies,
            request.cache,
        )
        .await?;
        Ok(ClearConnectionDataResult {
            cookies_cleared,
            cache_cleared: cache.cleared,
            cache_pending_restart: cache.pending,
        })
    }
    #[cfg(not(feature = "native-browser"))]
    {
        let _ = (window, state, request.cookies, request.cache);
        Err(UNAVAILABLE.into())
    }
}

/// Page cache bytes and limit for one connection (databases this window holds
/// unlocked) or for the whole device cache. Never a path.
#[tauri::command]
pub(crate) async fn origin_browser_http_cache_usage(
    window: WebviewWindow,
    state: State<'_, EncryptionState>,
    request: HttpCacheUsageRequest,
) -> Result<HttpCacheUsage, String> {
    crate::application_log_commands::require_shell(&window)
        .map_err(|_| "Browser data is unavailable outside an app window.")?;
    if request
        .connection_id
        .as_deref()
        .is_some_and(|id| !valid_connection_id(id))
    {
        return Err("Browser data request is invalid".into());
    }
    #[cfg(feature = "native-browser")]
    {
        let (reason, bytes, limit_bytes) = crate::origin_browser_runtime::http_cache::usage_report(
            &window,
            &state,
            request.connection_id.as_deref(),
        )
        .await?;
        Ok(HttpCacheUsage {
            available: reason.is_none(),
            reason,
            bytes: bytes.min(MAX_JS_INTEGER),
            limit_bytes: limit_bytes.min(MAX_JS_INTEGER),
        })
    }
    #[cfg(not(feature = "native-browser"))]
    {
        let _ = (window, state, request.connection_id);
        Ok(HttpCacheUsage {
            available: false,
            reason: Some("unavailable"),
            bytes: 0,
            limit_bytes: 0,
        })
    }
}

/// Deletes every page cache of this device profile. Directories still held by
/// an attempt are deleted when released or on the next start.
#[tauri::command]
pub(crate) async fn origin_browser_clear_all_http_cache(
    window: WebviewWindow,
) -> Result<ClearAllHttpCacheResult, String> {
    crate::application_log_commands::require_shell(&window)
        .map_err(|_| "Browser data is unavailable outside an app window.")?;
    #[cfg(feature = "native-browser")]
    {
        let outcome = crate::origin_browser_runtime::http_cache::clear_all_report().await?;
        Ok(ClearAllHttpCacheResult {
            cleared: outcome.cleared,
            pending_restart: outcome.pending,
        })
    }
    #[cfg(not(feature = "native-browser"))]
    {
        let _ = window;
        Err(UNAVAILABLE.into())
    }
}

async fn origin_browser_create(
    window: WebviewWindow,
    state: State<'_, EncryptionState>,
    request: OriginBrowserCreateRequest,
    document: StartupDocument,
) -> Result<OriginBrowserCreateResult, String> {
    #[cfg(feature = "native-browser")]
    let timing = crate::origin_browser_startup_diagnostics::Trace::startup(false);
    request.validate().map_err(|error| error.to_string())?;
    #[cfg(feature = "native-browser")]
    {
        timing.mark(crate::origin_browser_startup_diagnostics::TimingStage::CommandValidated);
        crate::origin_browser_runtime::create(window, &state, request, timing, document).await
    }
    #[cfg(not(feature = "native-browser"))]
    {
        let _ = (window, state, request, document);
        Err(UNAVAILABLE.into())
    }
}

#[tauri::command]
pub(crate) fn origin_browser_status(
    window: WebviewWindow,
    request: OriginBrowserStatusRequest,
) -> Result<OriginBrowserStatusResult, String> {
    request.validate().map_err(|error| error.to_string())?;
    #[cfg(feature = "native-browser")]
    {
        crate::origin_browser_runtime::status(&window, &request)
    }
    #[cfg(not(feature = "native-browser"))]
    {
        let _ = window;
        Ok(OriginBrowserStatusResult::unavailable(
            OriginBrowserUnavailableReason::RuntimeMissing,
        ))
    }
}

#[tauri::command]
pub(crate) async fn origin_browser_navigate(
    window: WebviewWindow,
    state: State<'_, EncryptionState>,
    request: OriginBrowserNavigateRequest,
) -> Result<(), String> {
    request.validate().map_err(|error| error.to_string())?;
    #[cfg(feature = "native-browser")]
    {
        crate::origin_browser_runtime::navigate(window, &state, request).await
    }
    #[cfg(not(feature = "native-browser"))]
    {
        let _ = (window, state, request);
        Err(UNAVAILABLE.into())
    }
}

#[tauri::command]
pub(crate) async fn origin_browser_control(
    window: WebviewWindow,
    state: State<'_, EncryptionState>,
    request: OriginBrowserControlRequest,
) -> Result<(), String> {
    request.validate().map_err(|error| error.to_string())?;
    #[cfg(feature = "native-browser")]
    {
        crate::origin_browser_runtime::control(window, &state, request).await
    }
    #[cfg(not(feature = "native-browser"))]
    {
        let _ = (window, state, request);
        Err(UNAVAILABLE.into())
    }
}

#[tauri::command]
pub(crate) async fn origin_browser_close(
    window: WebviewWindow,
    request: OriginBrowserCloseRequest,
) -> Result<(), String> {
    request.validate().map_err(|error| error.to_string())?;
    #[cfg(feature = "native-browser")]
    {
        crate::origin_browser_runtime::close(window, request).await
    }
    #[cfg(not(feature = "native-browser"))]
    {
        let _ = (window, request);
        Ok(())
    }
}

#[tauri::command]
pub(crate) async fn origin_browser_automation(
    window: WebviewWindow,
    state: State<'_, EncryptionState>,
    request: OriginBrowserAutomationRequest,
) -> Result<sorng_browser_host::native_automation::NativeAutomationReply, String> {
    request.validate().map_err(|error| error.to_string())?;
    #[cfg(feature = "native-browser")]
    {
        crate::origin_browser_runtime::automation(window, &state, request).await
    }
    #[cfg(not(feature = "native-browser"))]
    {
        let _ = (window, state, request);
        Err(UNAVAILABLE.into())
    }
}

#[tauri::command]
pub(crate) async fn origin_browser_downloads(
    window: WebviewWindow,
    request: DownloadListRequest,
) -> Result<Vec<DownloadSnapshot>, String> {
    request.validate().map_err(|error| error.to_string())?;
    #[cfg(feature = "native-browser")]
    {
        crate::origin_browser_runtime::downloads(window, request).await
    }
    #[cfg(not(feature = "native-browser"))]
    {
        let _ = (window, request);
        Err(UNAVAILABLE.into())
    }
}

#[tauri::command]
pub(crate) async fn origin_browser_download_control(
    window: WebviewWindow,
    request: DownloadControlRequest,
) -> Result<(), String> {
    request.validate().map_err(|error| error.to_string())?;
    #[cfg(feature = "native-browser")]
    {
        crate::origin_browser_runtime::download_control(window, request).await
    }
    #[cfg(not(feature = "native-browser"))]
    {
        let _ = (window, request);
        Err(UNAVAILABLE.into())
    }
}

#[tauri::command]
pub(crate) fn origin_browser_extensions(
    window: WebviewWindow,
    request: sorng_browser_host::native_extensions::NativeBrowserExtensionRequest,
) -> Result<sorng_browser_host::native_extensions::NativeBrowserExtensionReceipt, String> {
    request.validate().map_err(|error| error.to_string())?;
    #[cfg(feature = "native-browser")]
    {
        crate::origin_browser_runtime::extensions(window, request)
    }
    #[cfg(not(feature = "native-browser"))]
    {
        let _ = (window, request);
        Err(UNAVAILABLE.into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn router_claims_only_native_view_and_read_only_capability_commands() {
        for command in [
            "origin_browser_create",
            "origin_browser_prewarm",
            "origin_browser_cancel_prewarm",
            "origin_browser_retention_capabilities",
            "origin_browser_status",
            "origin_browser_navigate",
            "origin_browser_control",
            "origin_browser_close",
            "origin_browser_automation",
            "origin_browser_downloads",
            "origin_browser_download_control",
            "origin_browser_extensions",
            "origin_browser_diagnose",
            "origin_browser_manual_input",
            "origin_browser_cancel_login",
            "origin_browser_retry_login",
            "origin_browser_ssh_respond_to_command_review",
            "origin_browser_ssh_cancel_pending_create",
            "origin_browser_clear_connection_data",
            "origin_browser_http_cache_usage",
            "origin_browser_clear_all_http_cache",
        ] {
            assert!(is_command(command));
        }
        for command in [
            "origin_browser_evaluate",
            "origin_browser_grant",
            "origin_browser_ready",
            "origin_browser_credentials",
            "origin_browser_create_extra",
            "read_app_settings",
        ] {
            assert!(!is_command(command));
        }
    }

    #[test]
    fn login_cancellation_accepts_only_exact_identity_and_fixed_reasons() {
        let request = serde_json::json!({"identity":{"ownerDatabaseId":"db","connectionId":"connection",
            "sessionId":"tab","attemptId":"550e8400-e29b-41d4-a716-446655440000"},"reason":"user-cancelled"});
        assert!(serde_json::from_value::<CancelLoginRequest>(request.clone()).is_ok());
        let mut timeout = request.clone(); timeout["reason"] = "attempt-timeout".into();
        assert!(serde_json::from_value::<CancelLoginRequest>(timeout).is_ok());
        for (pointer,value) in [("/reason",serde_json::json!("untrusted-private-text")),
            ("/identity/attemptId",serde_json::json!("bad")),("/identity/ownerDatabaseId",serde_json::json!(""))] {
            let mut invalid = request.clone(); *invalid.pointer_mut(pointer).unwrap() = value;
            let error = serde_json::from_value::<CancelLoginRequest>(invalid).err().unwrap().to_string();
            assert!(!error.contains("untrusted-private-text"));
        }
        let mut extra = request; extra["url"] = "https://private.invalid".into();
        assert!(serde_json::from_value::<CancelLoginRequest>(extra).is_err());
    }

    #[test]
    fn login_retry_accepts_only_exact_identity_and_two_fixed_steps() {
        let request = serde_json::json!({"identity":{"ownerDatabaseId":"db","connectionId":"connection",
            "sessionId":"tab","attemptId":"550e8400-e29b-41d4-a716-446655440000"},"step":"credentials"});
        let parsed = serde_json::from_value::<RetryLoginRequest>(request.clone()).unwrap();
        assert_eq!(parsed.step, LoginRetryStep::Credentials);
        let mut mfa = request.clone(); mfa["step"] = "mfa".into();
        assert_eq!(serde_json::from_value::<RetryLoginRequest>(mfa).unwrap().step, LoginRetryStep::Mfa);
        for (pointer, value) in [("/step", serde_json::json!("untrusted-private-text")),
            ("/step", serde_json::json!("Credentials")), ("/step", serde_json::json!(null)),
            ("/identity/attemptId", serde_json::json!("bad")), ("/identity/ownerDatabaseId", serde_json::json!(""))] {
            let mut invalid = request.clone(); *invalid.pointer_mut(pointer).unwrap() = value;
            let error = serde_json::from_value::<RetryLoginRequest>(invalid).err().unwrap().to_string();
            assert!(!error.contains("untrusted-private-text"));
        }
        // No credential, code, address or reload instruction rides along.
        for field in ["password", "code", "url", "reload"] {
            let mut extra = request.clone(); extra[field] = "x".into();
            assert!(serde_json::from_value::<RetryLoginRequest>(extra).is_err(), "{field}");
        }
    }

    #[test]
    fn login_retry_receipts_serialize_as_the_shell_parses_them() {
        assert_eq!(serde_json::to_value(RetryLoginReceipt::Started).unwrap(),
            serde_json::json!({"status":"started"}));
        assert_eq!(serde_json::to_value(RetryLoginReceipt::Refused { reason: "code-used" }).unwrap(),
            serde_json::json!({"status":"refused","reason":"code-used"}));
    }

    #[test]
    fn browser_data_requests_take_only_a_connection_id_and_two_switches() {
        let request = serde_json::json!({"connectionId":"conn-1","cookies":true,"cache":false});
        let parsed = serde_json::from_value::<ClearConnectionDataRequest>(request.clone()).unwrap();
        assert_eq!((parsed.connection_id.as_str(), parsed.cookies, parsed.cache), ("conn-1", true, false));
        // No database id, path, size or unknown field rides along.
        for field in ["databaseId", "ownerDatabaseId", "path", "directory", "maxBytes"] {
            let mut extra = request.clone();
            extra[field] = "x".into();
            assert!(serde_json::from_value::<ClearConnectionDataRequest>(extra).is_err(), "{field}");
        }
        for missing in ["connectionId", "cookies", "cache"] {
            let mut partial = request.clone();
            partial.as_object_mut().unwrap().remove(missing);
            assert!(serde_json::from_value::<ClearConnectionDataRequest>(partial).is_err(), "{missing}");
        }
        assert!(serde_json::from_value::<ClearConnectionDataRequest>(
            serde_json::json!({"connectionId":"c","cookies":"true","cache":false})
        )
        .is_err());
        assert!(serde_json::from_value::<HttpCacheUsageRequest>(serde_json::json!({})).unwrap().connection_id.is_none());
        assert_eq!(
            serde_json::from_value::<HttpCacheUsageRequest>(serde_json::json!({"connectionId":"c"}))
                .unwrap()
                .connection_id
                .as_deref(),
            Some("c")
        );
        assert!(serde_json::from_value::<HttpCacheUsageRequest>(serde_json::json!({"databaseId":"d"})).is_err());
        for valid in ["c", "550e8400-e29b-41d4-a716-446655440000", "a/b", "../x"] {
            assert!(valid_connection_id(valid), "{valid}");
        }
        for invalid in ["", "a\u{0}b", "line\nbreak"] {
            assert!(!valid_connection_id(invalid), "{invalid:?}");
        }
        assert!(!valid_connection_id(&"x".repeat(257)));
    }

    #[test]
    fn browser_data_results_serialize_as_the_shell_parses_them() {
        assert_eq!(
            serde_json::to_value(ClearConnectionDataResult {
                cookies_cleared: true,
                cache_cleared: false,
                cache_pending_restart: true,
            })
            .unwrap(),
            serde_json::json!({"cookiesCleared":true,"cacheCleared":false,"cachePendingRestart":true})
        );
        assert_eq!(
            serde_json::to_value(HttpCacheUsage { available: true, reason: None, bytes: 5, limit_bytes: 6 }).unwrap(),
            serde_json::json!({"available":true,"bytes":5,"limitBytes":6})
        );
        assert_eq!(
            serde_json::to_value(HttpCacheUsage {
                available: false,
                reason: Some("engine-unsupported"),
                bytes: 0,
                limit_bytes: 134217728,
            })
            .unwrap(),
            serde_json::json!({"available":false,"reason":"engine-unsupported","bytes":0,"limitBytes":134217728})
        );
        assert_eq!(
            serde_json::to_value(ClearAllHttpCacheResult { cleared: true, pending_restart: false }).unwrap(),
            serde_json::json!({"cleared":true,"pendingRestart":false})
        );
        assert_eq!(http_disk_cache_capability(None), serde_json::json!({"available":true}));
        for reason in ["disabled", "cache-location-not-local", "engine-unsupported", "unavailable"] {
            assert_eq!(
                http_disk_cache_capability(Some(reason)),
                serde_json::json!({"available":false,"reason":reason})
            );
        }
        let capabilities = origin_browser_retention_capabilities();
        assert!(capabilities["httpDiskCache"]["available"].is_boolean());
    }

    /// The shell maps exactly this string to "Close this connection's tab
    /// first" (src/services/originBrowserData.ts); any other text reads as
    /// unavailable or failed.
    #[cfg(feature = "native-browser")]
    #[test]
    fn clear_connection_data_refusal_is_the_exact_shell_string() {
        use crate::origin_browser_runtime::http_cache::{refuse_open_session, SESSION_OPEN};
        let shell = include_str!("../../src/services/originBrowserData.ts");
        assert!(shell.contains(&format!("text.trim() === \"{SESSION_OPEN}\"")));
        assert_eq!(
            refuse_open_session(["db"], "conn", |_, _| true).unwrap_err(),
            "browser-session-open"
        );
        assert!(refuse_open_session(["db"], "conn", |_, _| false).is_ok());
    }
}
