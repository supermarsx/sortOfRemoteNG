// Tauri command wrappers for the SPICE service.

use super::service::SpiceServiceState;
use super::types::*;

// ── Connection management ───────────────────────────────────────────────

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn connect_spice(
    state: tauri::State<'_, SpiceServiceState>,
    host: String,
    port: Option<u16>,
    tls_port: Option<u16>,
    password: Option<String>,
    label: Option<String>,
    view_only: Option<bool>,
    share_clipboard: Option<bool>,
    usb_redirection: Option<bool>,
    audio_playback: Option<bool>,
    preferred_width: Option<u32>,
    preferred_height: Option<u32>,
) -> Result<String, String> {
    let config = SpiceConfig {
        host,
        port: port.unwrap_or(5900),
        tls_port,
        password,
        label,
        view_only: view_only.unwrap_or(false),
        share_clipboard: share_clipboard.unwrap_or(true),
        usb_redirection: usb_redirection.unwrap_or(false),
        audio_playback: audio_playback.unwrap_or(true),
        preferred_width,
        preferred_height,
        ..SpiceConfig::default()
    };
    let mut svc = state.lock().await;
    svc.connect(config).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn disconnect_spice(
    state: tauri::State<'_, SpiceServiceState>,
    session_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.disconnect_and_remove(&session_id)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn disconnect_all_spice(
    state: tauri::State<'_, SpiceServiceState>,
) -> Result<Vec<String>, String> {
    let mut svc = state.lock().await;
    Ok(svc.disconnect_all().await)
}

#[tauri::command]
pub async fn is_spice_connected(
    state: tauri::State<'_, SpiceServiceState>,
    session_id: String,
) -> Result<bool, String> {
    let svc = state.lock().await;
    Ok(svc.is_connected(&session_id).await)
}

// ── Session info ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_spice_session_info(
    state: tauri::State<'_, SpiceServiceState>,
    session_id: String,
) -> Result<SpiceSession, String> {
    let svc = state.lock().await;
    svc.get_session_info(&session_id)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn list_spice_sessions(
    state: tauri::State<'_, SpiceServiceState>,
) -> Result<Vec<SpiceSession>, String> {
    let svc = state.lock().await;
    Ok(svc.list_sessions().await)
}

#[tauri::command]
pub async fn get_spice_session_stats(
    state: tauri::State<'_, SpiceServiceState>,
    session_id: String,
) -> Result<SpiceStats, String> {
    let svc = state.lock().await;
    svc.get_session_stats(&session_id)
        .await
        .map_err(|e| e.message)
}

// ── Input events ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn send_spice_key_event(
    state: tauri::State<'_, SpiceServiceState>,
    session_id: String,
    scancode: u32,
    down: bool,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.send_key_event(&session_id, scancode, down)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn send_spice_pointer_event(
    state: tauri::State<'_, SpiceServiceState>,
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
pub async fn send_spice_clipboard(
    state: tauri::State<'_, SpiceServiceState>,
    session_id: String,
    text: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.send_clipboard(&session_id, text)
        .await
        .map_err(|e| e.message)
}

// ── Display control ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn request_spice_update(
    state: tauri::State<'_, SpiceServiceState>,
    session_id: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.request_update(&session_id).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn set_spice_resolution(
    state: tauri::State<'_, SpiceServiceState>,
    session_id: String,
    width: u32,
    height: u32,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.set_resolution(&session_id, width, height)
        .await
        .map_err(|e| e.message)
}

// ── USB redirection ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn spice_redirect_usb(
    state: tauri::State<'_, SpiceServiceState>,
    session_id: String,
    vendor_id: u16,
    product_id: u16,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.redirect_usb(&session_id, vendor_id, product_id)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn spice_unredirect_usb(
    state: tauri::State<'_, SpiceServiceState>,
    session_id: String,
    vendor_id: u16,
    product_id: u16,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.unredirect_usb(&session_id, vendor_id, product_id)
        .await
        .map_err(|e| e.message)
}

// ── Session maintenance ─────────────────────────────────────────────────

#[tauri::command]
pub async fn prune_spice_sessions(
    state: tauri::State<'_, SpiceServiceState>,
) -> Result<Vec<String>, String> {
    let mut svc = state.lock().await;
    Ok(svc.prune_disconnected().await)
}

#[tauri::command]
pub async fn get_spice_session_count(
    state: tauri::State<'_, SpiceServiceState>,
) -> Result<usize, String> {
    let svc = state.lock().await;
    Ok(svc.session_count())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spice_config_default() {
        let config = SpiceConfig::default();
        assert_eq!(config.port, 5900);
    }

    #[test]
    fn spice_config_custom() {
        let config = SpiceConfig {
            host: "spice.example.com".into(),
            port: 5901,
            tls_port: Some(5902),
            password: Some("secret".into()),
            label: Some("Test SPICE".into()),
            view_only: true,
            share_clipboard: false,
            usb_redirection: true,
            ..SpiceConfig::default()
        };
        assert_eq!(config.host, "spice.example.com");
        assert_eq!(config.port, 5901);
        assert_eq!(config.tls_port, Some(5902));
    }
}
