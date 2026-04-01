
// ─── Tunnel utility functions ────────────────────────────────────────
// Pure helpers that query global tunnel state without requiring Tauri.
// These are re-exported via `pub use tunnels::*` so tests and other
// crate code can call them directly.

use super::types::*;
use super::{FTP_TUNNELS, RDP_TUNNELS, VNC_TUNNELS};

// ===============================
// FTP Tunnel Queries
// ===============================

/// Get status of an FTP tunnel
pub fn get_ftp_tunnel_status(tunnel_id: String) -> Result<Option<FtpTunnelStatus>, String> {
    let tunnels = FTP_TUNNELS
        .lock()
        .map_err(|e| format!("Failed to lock tunnels: {}", e))?;
    Ok(tunnels.get(&tunnel_id).cloned())
}

/// List all active FTP tunnels
pub fn list_ftp_tunnels() -> Result<Vec<FtpTunnelStatus>, String> {
    let tunnels = FTP_TUNNELS
        .lock()
        .map_err(|e| format!("Failed to lock tunnels: {}", e))?;
    Ok(tunnels.values().cloned().collect())
}

/// List FTP tunnels for a specific SSH session
pub fn list_session_ftp_tunnels(session_id: String) -> Result<Vec<FtpTunnelStatus>, String> {
    let tunnels = FTP_TUNNELS
        .lock()
        .map_err(|e| format!("Failed to lock tunnels: {}", e))?;
    Ok(tunnels
        .values()
        .filter(|t| t.session_id == session_id)
        .cloned()
        .collect())
}

// ===============================
// RDP Tunnel Queries
// ===============================

/// Get status of an RDP tunnel
pub fn get_rdp_tunnel_status(tunnel_id: String) -> Result<Option<RdpTunnelStatus>, String> {
    let tunnels = RDP_TUNNELS
        .lock()
        .map_err(|e| format!("Failed to lock tunnels: {}", e))?;
    Ok(tunnels.get(&tunnel_id).cloned())
}

/// List all active RDP tunnels
pub fn list_rdp_tunnels() -> Result<Vec<RdpTunnelStatus>, String> {
    let tunnels = RDP_TUNNELS
        .lock()
        .map_err(|e| format!("Failed to lock tunnels: {}", e))?;
    Ok(tunnels.values().cloned().collect())
}

/// List RDP tunnels for a specific SSH session
pub fn list_session_rdp_tunnels(session_id: String) -> Result<Vec<RdpTunnelStatus>, String> {
    let tunnels = RDP_TUNNELS
        .lock()
        .map_err(|e| format!("Failed to lock tunnels: {}", e))?;
    Ok(tunnels
        .values()
        .filter(|t| t.session_id == session_id)
        .cloned()
        .collect())
}

/// Generate an RDP file for a tunnel (can be opened directly by Windows Remote Desktop)
pub fn generate_rdp_file(
    tunnel_id: String,
    options: Option<RdpFileOptions>,
) -> Result<String, String> {
    let tunnels = RDP_TUNNELS
        .lock()
        .map_err(|e| format!("Failed to lock tunnels: {}", e))?;

    let tunnel = tunnels.get(&tunnel_id).ok_or("RDP tunnel not found")?;

    let opts = options.unwrap_or_default();

    let mut rdp_content = String::new();

    rdp_content.push_str(&format!("full address:s:{}\n", tunnel.connection_string));
    rdp_content.push_str(&format!("server port:i:{}\n", tunnel.local_port));

    if let Some(width) = opts.screen_width {
        rdp_content.push_str(&format!("desktopwidth:i:{}\n", width));
    }
    if let Some(height) = opts.screen_height {
        rdp_content.push_str(&format!("desktopheight:i:{}\n", height));
    }
    if opts.fullscreen.unwrap_or(false) {
        rdp_content.push_str("screen mode id:i:2\n");
    } else {
        rdp_content.push_str("screen mode id:i:1\n");
    }

    let color_depth = opts.color_depth.unwrap_or(32);
    rdp_content.push_str(&format!("session bpp:i:{}\n", color_depth));

    if tunnel.nla_enabled {
        rdp_content.push_str("enablecredsspsupport:i:1\n");
        rdp_content.push_str("authentication level:i:2\n");
    } else {
        rdp_content.push_str("enablecredsspsupport:i:0\n");
        rdp_content.push_str("authentication level:i:0\n");
    }

    if let Some(username) = &opts.username {
        rdp_content.push_str(&format!("username:s:{}\n", username));
    }

    if let Some(domain) = &opts.domain {
        rdp_content.push_str(&format!("domain:s:{}\n", domain));
    }

    if opts.redirect_clipboard.unwrap_or(true) {
        rdp_content.push_str("redirectclipboard:i:1\n");
    }
    if opts.redirect_printers.unwrap_or(false) {
        rdp_content.push_str("redirectprinters:i:1\n");
    }
    if opts.redirect_drives.unwrap_or(false) {
        rdp_content.push_str("drivestoredirect:s:*\n");
    }
    if opts.redirect_smartcards.unwrap_or(false) {
        rdp_content.push_str("redirectsmartcards:i:1\n");
    }
    if opts.redirect_audio.unwrap_or(true) {
        rdp_content.push_str("audiomode:i:0\n");
    } else {
        rdp_content.push_str("audiomode:i:2\n");
    }

    if opts.disable_wallpaper.unwrap_or(false) {
        rdp_content.push_str("disable wallpaper:i:1\n");
    }
    if opts.disable_themes.unwrap_or(false) {
        rdp_content.push_str("disable themes:i:1\n");
    }
    if opts.disable_font_smoothing.unwrap_or(false) {
        rdp_content.push_str("disable font smoothing:i:1\n");
    }

    rdp_content.push_str("gatewayusagemethod:i:0\n");
    rdp_content.push_str("gatewaycredentialssource:i:0\n");

    rdp_content.push_str("displayconnectionbar:i:1\n");

    rdp_content.push_str("prompt for credentials:i:0\n");

    rdp_content.push_str("negotiate security layer:i:1\n");

    Ok(rdp_content)
}

// ===============================
// VNC Tunnel Queries
// ===============================

/// Get status of a VNC tunnel
pub fn get_vnc_tunnel_status(tunnel_id: String) -> Result<Option<VncTunnelStatus>, String> {
    let tunnels = VNC_TUNNELS
        .lock()
        .map_err(|e| format!("Failed to lock tunnels: {}", e))?;
    Ok(tunnels.get(&tunnel_id).cloned())
}

/// List all active VNC tunnels
pub fn list_vnc_tunnels() -> Result<Vec<VncTunnelStatus>, String> {
    let tunnels = VNC_TUNNELS
        .lock()
        .map_err(|e| format!("Failed to lock tunnels: {}", e))?;
    Ok(tunnels.values().cloned().collect())
}

/// List VNC tunnels for a specific SSH session
pub fn list_session_vnc_tunnels(session_id: String) -> Result<Vec<VncTunnelStatus>, String> {
    let tunnels = VNC_TUNNELS
        .lock()
        .map_err(|e| format!("Failed to lock tunnels: {}", e))?;
    Ok(tunnels
        .values()
        .filter(|t| t.session_id == session_id)
        .cloned()
        .collect())
}

// ===============================
// VNC over SSH Tunnel Commands
// ===============================
