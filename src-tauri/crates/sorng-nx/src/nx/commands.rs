//! Tauri command wrappers for the NX service.

use crate::nx::service::NxServiceState;
use crate::nx::types::*;

// ── Connection management ───────────────────────────────────────────────

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn connect_nx(
    state: tauri::State<'_, NxServiceState>,
    host: String,
    port: Option<u16>,
    username: Option<String>,
    password: Option<String>,
    private_key: Option<String>,
    label: Option<String>,
    session_type: Option<String>,
    resolution_width: Option<u32>,
    resolution_height: Option<u32>,
    fullscreen: Option<bool>,
    clipboard: Option<bool>,
    audio_enabled: Option<bool>,
    resume_session_id: Option<String>,
) -> Result<String, String> {
    let st = session_type.as_deref().map(|s| match s {
        "unix-gnome" => NxSessionType::UnixGnome,
        "unix-kde" => NxSessionType::UnixKde,
        "unix-xfce" => NxSessionType::UnixXfce,
        "unix-custom" => NxSessionType::UnixCustom,
        "shadow" => NxSessionType::Shadow,
        "windows" => NxSessionType::Windows,
        "vnc" => NxSessionType::Vnc,
        "application" => NxSessionType::Application,
        "console" => NxSessionType::Console,
        _ => NxSessionType::UnixDesktop,
    });

    let config = NxConfig {
        host,
        port: port.unwrap_or(4000),
        username,
        password,
        private_key,
        label,
        session_type: st,
        resolution_width,
        resolution_height,
        fullscreen,
        clipboard,
        audio: audio_enabled.map(|e| NxAudioConfig {
            enabled: e,
            ..NxAudioConfig::default()
        }),
        resume_session_id,
        ..NxConfig::default()
    };
    let mut svc = state.lock().await;
    svc.connect(config).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn disconnect_nx(
    state: tauri::State<'_, NxServiceState>,
    session_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.disconnect_and_remove(&session_id)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn disconnect_all_nx(
    state: tauri::State<'_, NxServiceState>,
) -> Result<Vec<String>, String> {
    let mut svc = state.lock().await;
    Ok(svc.disconnect_all().await)
}

#[tauri::command]
pub async fn suspend_nx(
    state: tauri::State<'_, NxServiceState>,
    session_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.suspend(&session_id).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn is_nx_connected(
    state: tauri::State<'_, NxServiceState>,
    session_id: String,
) -> Result<bool, String> {
    let svc = state.lock().await;
    Ok(svc.is_connected(&session_id).await)
}

// ── Session info ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_nx_session_info(
    state: tauri::State<'_, NxServiceState>,
    session_id: String,
) -> Result<NxSession, String> {
    let svc = state.lock().await;
    svc.get_session_info(&session_id)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn list_nx_sessions(
    state: tauri::State<'_, NxServiceState>,
) -> Result<Vec<NxSession>, String> {
    let svc = state.lock().await;
    Ok(svc.list_sessions().await)
}

#[tauri::command]
pub async fn get_nx_session_stats(
    state: tauri::State<'_, NxServiceState>,
    session_id: String,
) -> Result<NxStats, String> {
    let svc = state.lock().await;
    svc.get_session_stats(&session_id)
        .await
        .map_err(|e| e.message)
}

// ── Input events ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn send_nx_key_event(
    state: tauri::State<'_, NxServiceState>,
    session_id: String,
    keysym: u32,
    down: bool,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.send_key_event(&session_id, keysym, down)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn send_nx_pointer_event(
    state: tauri::State<'_, NxServiceState>,
    session_id: String,
    x: i32,
    y: i32,
    button_mask: u8,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.send_pointer_event(&session_id, x, y, button_mask)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn send_nx_clipboard(
    state: tauri::State<'_, NxServiceState>,
    session_id: String,
    text: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.send_clipboard(&session_id, text)
        .await
        .map_err(|e| e.message)
}

// ── Display ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn resize_nx_display(
    state: tauri::State<'_, NxServiceState>,
    session_id: String,
    width: u32,
    height: u32,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.resize(&session_id, width, height)
        .await
        .map_err(|e| e.message)
}

// ── Session maintenance ─────────────────────────────────────────────────

#[tauri::command]
pub async fn prune_nx_sessions(
    state: tauri::State<'_, NxServiceState>,
) -> Result<Vec<String>, String> {
    let mut svc = state.lock().await;
    Ok(svc.prune_terminated().await)
}

#[tauri::command]
pub async fn get_nx_session_count(
    state: tauri::State<'_, NxServiceState>,
) -> Result<usize, String> {
    let svc = state.lock().await;
    Ok(svc.session_count())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nx_config_default() {
        let config = NxConfig::default();
        assert_eq!(config.port, 4000);
    }

    #[test]
    fn nx_session_type_parse() {
        let types = vec![
            ("unix-gnome", NxSessionType::UnixGnome),
            ("unix-kde", NxSessionType::UnixKde),
            ("shadow", NxSessionType::Shadow),
        ];
        for (name, expected) in types {
            let parsed = match name {
                "unix-gnome" => NxSessionType::UnixGnome,
                "unix-kde" => NxSessionType::UnixKde,
                "shadow" => NxSessionType::Shadow,
                _ => NxSessionType::UnixDesktop,
            };
            assert_eq!(parsed, expected);
        }
    }
}
