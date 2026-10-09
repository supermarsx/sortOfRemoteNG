//! App-shell recording command. Remote CEF content has no Tauri command bridge.
use sorng_encryption::EncryptionState;
use tauri::{State, WebviewWindow};

#[path = "origin_browser_recording_contract.rs"]
mod contract;
#[cfg(feature = "native-browser")]
pub(crate) use contract::Operation;
pub(crate) use contract::Request;

#[tauri::command]
pub(crate) async fn origin_browser_recording(
    window: WebviewWindow,
    state: State<'_, EncryptionState>,
    request: Request,
) -> Result<serde_json::Value, String> {
    request.validate()?;
    #[cfg(feature = "native-browser")]
    {
        crate::origin_browser_runtime::recording::operate(window, &state, request).await
    }
    #[cfg(not(feature = "native-browser"))]
    {
        let _ = (window, state, request);
        Err("Native browser recording is unavailable in this build".into())
    }
}
