// Tauri command wrappers for the VNC service.
//
// These are the `#[tauri::command]` functions registered in the app's
// command handler. They delegate to `VncService` methods.

use super::service::VncServiceState;
use super::types::*;

// ── Connection management ───────────────────────────────────────────────

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn connect_vnc(
    state: tauri::State<'_, VncServiceState>,
    host: String,
    port: Option<u16>,
    password: Option<String>,
    username: Option<String>,
    label: Option<String>,
    shared: Option<bool>,
    view_only: Option<bool>,
    allow_unencrypted_transport: Option<bool>,
    allow_weak_authentication: Option<bool>,
    allow_unauthenticated: Option<bool>,
) -> Result<String, String> {
    let config = VncConfig {
        host,
        port: port.unwrap_or(5900),
        password,
        username,
        label,
        shared: shared.unwrap_or(true),
        view_only: view_only.unwrap_or(false),
        allow_unencrypted_transport: allow_unencrypted_transport.unwrap_or(false),
        allow_weak_authentication: allow_weak_authentication.unwrap_or(false),
        allow_unauthenticated: allow_unauthenticated.unwrap_or(false),
        ..VncConfig::default()
    };
    state.connect(config).await.map_err(|e| e.message)
}

#[tauri::command]
pub async fn disconnect_vnc(
    state: tauri::State<'_, VncServiceState>,
    session_id: String,
) -> Result<(), String> {
    state
        .disconnect_and_remove(&session_id)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn disconnect_all_vnc(
    state: tauri::State<'_, VncServiceState>,
) -> Result<Vec<String>, String> {
    Ok(state.disconnect_all().await)
}

#[tauri::command]
pub async fn is_vnc_connected(
    state: tauri::State<'_, VncServiceState>,
    session_id: String,
) -> Result<bool, String> {
    Ok(state.is_connected(&session_id).await)
}

// ── Session info ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_vnc_session_info(
    state: tauri::State<'_, VncServiceState>,
    session_id: String,
) -> Result<VncSession, String> {
    state
        .get_session_info(&session_id)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn list_vnc_sessions(
    state: tauri::State<'_, VncServiceState>,
) -> Result<Vec<VncSession>, String> {
    Ok(state.list_session_info().await)
}

// This remains a service-level helper. The app-facing shim owns the sole
// `#[tauri::command]` registration because it returns stats together with the
// bounded native event drain expected by the renderer.
pub async fn get_vnc_session_stats(
    state: tauri::State<'_, VncServiceState>,
    session_id: String,
) -> Result<VncStats, String> {
    state
        .get_session_stats(&session_id)
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
    state
        .send_key_event(&session_id, down, key)
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
    state
        .send_pointer_event(&session_id, button_mask, x, y)
        .await
        .map_err(|e| e.message)
}

#[tauri::command]
pub async fn send_vnc_clipboard(
    state: tauri::State<'_, VncServiceState>,
    session_id: String,
    text: String,
) -> Result<(), String> {
    state
        .send_clipboard(&session_id, text)
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
    state
        .request_update(&session_id, incremental.unwrap_or(true))
        .await
        .map_err(|e| e.message)
}

/// Replace the renderer activity authority only when `activity_generation` is
/// strictly newer than the native generation. The authoritative result is
/// returned even when a stale/equal request is rejected.
#[tauri::command]
pub async fn set_vnc_session_activity(
    state: tauri::State<'_, VncServiceState>,
    session_id: String,
    active: bool,
    activity_generation: u64,
) -> Result<VncActivityResult, String> {
    state
        .set_session_activity(&session_id, active, activity_generation)
        .await
        .map_err(|error| error.message)
}

/// Acknowledge exactly the in-flight frame identified by its renderer epoch
/// and opaque frame token. Logical stale/wrong ACKs return `accepted: false`.
#[tauri::command]
pub async fn acknowledge_vnc_frame(
    state: tauri::State<'_, VncServiceState>,
    session_id: String,
    delivery_epoch: u64,
    frame_token: u64,
) -> Result<VncFrameAckResult, String> {
    state
        .acknowledge_frame(&session_id, delivery_epoch, frame_token)
        .await
        .map_err(|error| error.message)
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
    state
        .set_pixel_format(&session_id, pf)
        .await
        .map_err(|e| e.message)
}

// ── Session maintenance ─────────────────────────────────────────────────

#[tauri::command]
pub async fn prune_vnc_sessions(
    state: tauri::State<'_, VncServiceState>,
) -> Result<Vec<String>, String> {
    Ok(state.prune_disconnected().await)
}

#[tauri::command]
pub async fn get_vnc_session_count(
    state: tauri::State<'_, VncServiceState>,
) -> Result<usize, String> {
    Ok(state.session_count().await)
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
        assert!(!config.allow_unencrypted_transport);
        assert!(!config.allow_weak_authentication);
        assert!(!config.allow_unauthenticated);
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
