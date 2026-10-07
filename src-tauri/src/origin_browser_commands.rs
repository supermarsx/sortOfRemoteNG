//! App-shell IPC for native website views. Remote CEF pages have no Tauri IPC.
//! The calling window and the native database lease remain authoritative.

use sorng_browser_host::ipc::*;
use sorng_encryption::EncryptionState;
use tauri::{State, WebviewWindow};

#[cfg(not(feature = "native-browser"))]
const UNAVAILABLE: &str = "The packaged real-origin browser is unavailable. No website was opened and no direct-network fallback was used.";

pub(crate) fn is_command(command: &str) -> bool {
    matches!(
        command,
        "origin_browser_create"
            | "origin_browser_retention_capabilities"
            | "origin_browser_status"
            | "origin_browser_navigate"
            | "origin_browser_control"
            | "origin_browser_close"
            | "origin_browser_automation"
    )
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

#[tauri::command]
pub(crate) async fn origin_browser_create(
    window: WebviewWindow,
    state: State<'_, EncryptionState>,
    request: OriginBrowserCreateRequest,
) -> Result<OriginBrowserCreateResult, String> {
    request.validate().map_err(|error| error.to_string())?;
    #[cfg(feature = "native-browser")]
    {
        crate::origin_browser_runtime::create(window, &state, request).await
    }
    #[cfg(not(feature = "native-browser"))]
    {
        let _ = (window, state, request);
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn router_claims_only_native_view_and_read_only_capability_commands() {
        for command in [
            "origin_browser_create",
            "origin_browser_retention_capabilities",
            "origin_browser_status",
            "origin_browser_navigate",
            "origin_browser_control",
            "origin_browser_close",
            "origin_browser_automation",
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
