//! Tauri command wrappers for the VNC service.
//!
//! These are the `#[tauri::command]` functions registered in the app's
//! command handler. They delegate to `VncService` methods.

use crate::vnc::service::VncServiceState;
use crate::vnc::types::*;

// ── Connection management ───────────────────────────────────────────────

#[tauri::command]
pub async fn connect_vnc(
    state: tauri::State<'_, VncServiceState>,
    host: String,
    port: Option<u16>,
    password: Option<String>,
    username: Option<String>,
    label: Option<String>,
    shared: Option<bool>,
    view_only: Option<bool>,
) -> Result<String, String> {
    let config = VncConfig {
        host,
        port: port.unwrap_or(5900),
        password,
        username,
        label,
        shared: shared.unwrap_or(true),
        view_only: view_only.unwrap_or(false),
        ..VncConfig::default()
    };
    let mut svc = state.lock().await;
    svc.connect(config).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn disconnect_vnc(
    state: tauri::State<'_, VncServiceState>,
    session_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.disconnect_and_remove(&session_id)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn disconnect_all_vnc(
    state: tauri::State<'_, VncServiceState>,
) -> Result<Vec<String>, String> {
    let mut svc = state.lock().await;
    Ok(svc.disconnect_all().await)
}

#[tauri::command]
pub async fn is_vnc_connected(
    state: tauri::State<'_, VncServiceState>,
    session_id: String,
) -> Result<bool, String> {
    let svc = state.lock().await;
    Ok(svc.is_connected(&session_id).await)
}

// ── Session info ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_vnc_session_info(
    state: tauri::State<'_, VncServiceState>,
    session_id: String,
) -> Result<VncSession, String> {
    let svc = state.lock().await;
    svc.get_session_info(&session_id)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn list_vnc_sessions(
    state: tauri::State<'_, VncServiceState>,
) -> Result<Vec<VncSession>, String> {
    let svc = state.lock().await;
    Ok(svc.list_session_info().await)
}

#[tauri::command]
pub async fn get_vnc_session_stats(
    state: tauri::State<'_, VncServiceState>,
    session_id: String,
) -> Result<VncStats, String> {
    let svc = state.lock().await;
    svc.get_session_stats(&session_id)
        .await
        .map_err(|e| e.message)
}

// ── Input events ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn send_vnc_key_event(
    state: tauri::State<'_, VncServiceState>,
    session_id: String,
    down: bool,
    key: u32,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.send_key_event(&session_id, down, key)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn send_vnc_pointer_event(
    state: tauri::State<'_, VncServiceState>,
    session_id: String,
    button_mask: u8,
    x: u16,
    y: u16,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.send_pointer_event(&session_id, button_mask, x, y)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn send_vnc_clipboard(
    state: tauri::State<'_, VncServiceState>,
    session_id: String,
    text: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.send_clipboard(&session_id, text)
        .await
        .map_err(|e| e.message)
}

// ── Framebuffer control ─────────────────────────────────────────────────

#[tauri::command]
pub async fn request_vnc_update(
    state: tauri::State<'_, VncServiceState>,
    session_id: String,
    incremental: Option<bool>,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.request_update(&session_id, incremental.unwrap_or(true))
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn set_vnc_pixel_format(
    state: tauri::State<'_, VncServiceState>,
    session_id: String,
    bits_per_pixel: u8,
) -> Result<(), String> {
    let pf = match bits_per_pixel {
        32 => PixelFormat::rgba32(),
        16 => PixelFormat::rgb565(),
        8 => PixelFormat::indexed8(),
        _ => return Err(format!("Unsupported bits_per_pixel: {}", bits_per_pixel)),
    };
    let svc = state.lock().await;
    svc.set_pixel_format(&session_id, pf)
        .await
        .map_err(|e| e.message)
}

// ── Session maintenance ─────────────────────────────────────────────────

#[tauri::command]
pub async fn prune_vnc_sessions(
    state: tauri::State<'_, VncServiceState>,
) -> Result<Vec<String>, String> {
    let mut svc = state.lock().await;
    Ok(svc.prune_disconnected().await)
}

#[tauri::command]
pub async fn get_vnc_session_count(
    state: tauri::State<'_, VncServiceState>,
) -> Result<usize, String> {
    let svc = state.lock().await;
    Ok(svc.session_count())
}

#[cfg(test)]
mod tests {
    use super::*;

    // Command functions are tauri-command wrappers that require State<>.
    // We test them indirectly through the service layer.
    // Here we just verify the types compile and the module exports correctly.

    #[test]
    fn vnc_config_default() {
        let config = VncConfig::default();
        assert_eq!(config.port, 5900);
        assert!(config.shared);
        assert!(!config.view_only);
    }

    #[test]
    fn vnc_config_custom() {
        let config = VncConfig {
            host: "example.com".into(),
            port: 5901,
            password: Some("secret".into()),
            username: Some("admin".into()),
            label: Some("Test".into()),
            shared: false,
            view_only: true,
            ..VncConfig::default()
        };
        assert_eq!(config.host, "example.com");
        assert_eq!(config.port, 5901);
        assert!(!config.shared);
        assert!(config.view_only);
    }

    #[test]
    fn pixel_format_match() {
        let pf32 = PixelFormat::rgba32();
        assert_eq!(pf32.bits_per_pixel, 32);

        let pf16 = PixelFormat::rgb565();
        assert_eq!(pf16.bits_per_pixel, 16);

        let pf8 = PixelFormat::indexed8();
        assert_eq!(pf8.bits_per_pixel, 8);
    }
}
