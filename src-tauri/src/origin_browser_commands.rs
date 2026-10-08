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
        resolver.respond_async(async move {
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
        });
    } else {
        let request = request!(PrewarmRequest);
        resolver.respond_async(async move {
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
        });
    }
    true
}

#[cfg(not(feature = "native-browser"))]
const UNAVAILABLE: &str = "The packaged real-origin browser is unavailable. No website was opened and no direct-network fallback was used.";

pub(crate) fn is_command(command: &str) -> bool {
    matches!(
        command,
        "origin_browser_create"
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
    )
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
#[tauri::command]
pub(crate) fn origin_browser_retention_capabilities() -> serde_json::Value {
    #[cfg(feature = "native-browser")]
    let available = crate::origin_browser_runtime::retention_available();
    #[cfg(not(feature = "native-browser"))]
    let available = false;
    serde_json::json!({
        "memory": available,
        "encryptedDatabase": available,
        "policyExpiration": available,
        "clearOnDatabaseLock": available,
    })
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
}
