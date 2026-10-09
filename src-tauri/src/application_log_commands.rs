//! Read-only application diagnostics for trusted app windows, never CEF pages.
use crate::application_log_files::{self as files, LogList, LogRead, LogSource};
use sorng_encryption::EncryptionState;
use std::path::PathBuf;
use tauri::{Manager, State, WebviewWindow};

pub(crate) fn is_command(command: &str) -> bool {
    matches!(command, "application_logs_list" | "application_logs_read")
}

pub(crate) fn require_shell(window: &WebviewWindow) -> Result<(), String> {
    let label = window.label();
    if (label != "main" && !label.starts_with("detached-"))
        || window.app_handle().get_webview_window(label).is_none()
    {
        return Err("Application logs are available only in an app window.".into());
    }
    let url = window.url().map_err(|_| "The app window is unavailable.")?;
    let config = window.app_handle().config();
    let configured = if tauri::is_dev() {
        config.build.dev_url.as_ref()
    } else {
        match config.build.frontend_dist.as_ref() {
            Some(tauri::utils::config::FrontendDist::Url(url)) => Some(url),
            _ => None,
        }
    };
    let valid = if let Some(configured) = configured {
        url.origin() == configured.origin()
    } else {
        matches!(url.as_str().split_once("://"), Some(("tauri", rest)) if rest == "localhost" || rest.starts_with("localhost/"))
            || matches!(url.origin().ascii_serialization().as_str(), "http://tauri.localhost" | "https://tauri.localhost")
    };
    if !valid {
        return Err("Application logs cannot be read by website content.".into());
    }
    Ok(())
}

fn root(window: &WebviewWindow, state: &EncryptionState, source: LogSource) -> Result<PathBuf, String> {
    match source {
        LogSource::Application => state.artifact_policy_root()
            .map(Ok)
            .unwrap_or_else(|| window.app_handle().path().app_data_dir().map_err(|_| "Application log directory unavailable.".to_string()))
            .map(|root| root.join("logs")),
        LogSource::Browser => {
            #[cfg(feature = "native-browser")]
            if let Some(root) = crate::origin_browser_startup_diagnostics::journal_root() {
                return Ok(root);
            }
            window.app_handle().path().app_local_data_dir()
                .map(|root| root.join("native-browser"))
                .map_err(|_| "Browser journal directory unavailable.".into())
        }
    }
}

#[tauri::command]
pub(crate) async fn application_logs_list(
    window: WebviewWindow,
    state: State<'_, EncryptionState>,
    source: LogSource,
) -> Result<LogList, String> {
    require_shell(&window)?;
    let root = root(&window, &state, source)?;
    let result = tauri::async_runtime::spawn_blocking(move || files::list(&root, source))
        .await.map_err(|_| "Application log listing could not complete.".to_string())??;
    require_shell(&window)?;
    Ok(result)
}

#[tauri::command]
pub(crate) async fn application_logs_read(
    window: WebviewWindow,
    state: State<'_, EncryptionState>,
    source: LogSource,
    id: String,
) -> Result<LogRead, String> {
    require_shell(&window)?;
    let root = root(&window, &state, source)?;
    let generation = state.key_generation();
    let result = files::read(&root, source, &id, &state).await?;
    require_shell(&window)?;
    if state.key_generation() != generation {
        return Err("Log protection changed while reading. Refresh the log after unlocking the app.".into());
    }
    Ok(result)
}
