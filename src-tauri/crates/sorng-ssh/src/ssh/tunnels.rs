use uuid::Uuid;
use chrono::Utc;

use super::types::*;
use super::{FTP_TUNNELS, RDP_TUNNELS, VNC_TUNNELS};

// ===============================
// FTP over SSH Tunnel Commands
// ===============================

/// Setup an FTP tunnel over SSH
/// This creates port forwards for both control (port 21) and optionally passive data ports
#[tauri::command]
pub async fn setup_ftp_tunnel(
    state: tauri::State<'_, SshServiceState>,
    session_id: String,
    config: FtpTunnelConfig,
) -> Result<FtpTunnelStatus, String> {
    let mut ssh = state.lock().await;

    if !ssh.sessions.contains_key(&session_id) {
        return Err("SSH session not found".to_string());
    }

    let tunnel_id = Uuid::new_v4().to_string();

    let local_control_port = config.local_control_port.unwrap_or(0);
    let control_config = PortForwardConfig {
        local_host: "127.0.0.1".to_string(),
        local_port: local_control_port,
        remote_host: config.remote_ftp_host.clone(),
        remote_port: config.remote_ftp_port,
        direction: PortForwardDirection::Local,
    };

    let control_forward_id = ssh.setup_port_forward(&session_id, control_config).await?;

    let actual_control_port = ssh.sessions.get(&session_id)
        .and_then(|s| s.port_forwards.get(&control_forward_id))
        .map(|pf| pf.config.local_port)
        .unwrap_or(local_control_port);

    let mut data_forward_ids = Vec::new();
    let mut passive_ports = Vec::new();

    if config.passive_mode {
        let start_port = config.passive_port_range_start.unwrap_or(50000);
        let port_count = config.passive_port_count;

        for i in 0..port_count {
            let data_port = start_port + i;
            let data_config = PortForwardConfig {
                local_host: "127.0.0.1".to_string(),
                local_port: data_port,
                remote_host: config.remote_ftp_host.clone(),
                remote_port: data_port,
                direction: PortForwardDirection::Local,
            };

            match ssh.setup_port_forward(&session_id, data_config).await {
                Ok(forward_id) => {
                    data_forward_ids.push(forward_id);
                    passive_ports.push(data_port);
                }
                Err(e) => {
                    log::warn!("Failed to setup passive port forward for port {}: {}", data_port, e);
                }
            }
        }
    }

    let status = FtpTunnelStatus {
        tunnel_id: tunnel_id.clone(),
        session_id: session_id.clone(),
        local_control_port: actual_control_port,
        remote_ftp_host: config.remote_ftp_host,
        remote_ftp_port: config.remote_ftp_port,
        passive_mode: config.passive_mode,
        passive_ports,
        control_forward_id,
        data_forward_ids,
    };

    if let Ok(mut tunnels) = FTP_TUNNELS.lock() {
        tunnels.insert(tunnel_id.clone(), status.clone());
    }

    log::info!("FTP tunnel {} created: local port {} -> {}:{}",
               tunnel_id, actual_control_port, status.remote_ftp_host, status.remote_ftp_port);

    Ok(status)
}

/// Stop an FTP tunnel and clean up port forwards
#[tauri::command]
pub async fn stop_ftp_tunnel(
    state: tauri::State<'_, SshServiceState>,
    tunnel_id: String,
) -> Result<(), String> {
    let tunnel_status = {
        let mut tunnels = FTP_TUNNELS.lock()
            .map_err(|e| format!("Failed to lock tunnels: {}", e))?;
        tunnels.remove(&tunnel_id)
            .ok_or("FTP tunnel not found")?
    };

    let mut ssh = state.lock().await;

    if let Err(e) = ssh.stop_port_forward(&tunnel_status.session_id, &tunnel_status.control_forward_id).await {
        log::warn!("Failed to stop control port forward: {}", e);
    }

    for forward_id in &tunnel_status.data_forward_ids {
        if let Err(e) = ssh.stop_port_forward(&tunnel_status.session_id, forward_id).await {
            log::warn!("Failed to stop data port forward {}: {}", forward_id, e);
        }
    }

    log::info!("FTP tunnel {} stopped", tunnel_id);
    Ok(())
}

/// Get status of an FTP tunnel
#[tauri::command]
pub fn get_ftp_tunnel_status(tunnel_id: String) -> Result<Option<FtpTunnelStatus>, String> {
    let tunnels = FTP_TUNNELS.lock()
        .map_err(|e| format!("Failed to lock tunnels: {}", e))?;
    Ok(tunnels.get(&tunnel_id).cloned())
}

/// List all active FTP tunnels
#[tauri::command]
pub fn list_ftp_tunnels() -> Result<Vec<FtpTunnelStatus>, String> {
    let tunnels = FTP_TUNNELS.lock()
        .map_err(|e| format!("Failed to lock tunnels: {}", e))?;
    Ok(tunnels.values().cloned().collect())
}

/// List FTP tunnels for a specific SSH session
#[tauri::command]
pub fn list_session_ftp_tunnels(session_id: String) -> Result<Vec<FtpTunnelStatus>, String> {
    let tunnels = FTP_TUNNELS.lock()
        .map_err(|e| format!("Failed to lock tunnels: {}", e))?;
    Ok(tunnels.values()
        .filter(|t| t.session_id == session_id)
        .cloned()
        .collect())
}

// ===============================
// RDP over SSH Tunnel Commands
// ===============================

/// Setup an RDP tunnel over SSH
/// Creates a local port forward that tunnels RDP traffic through the SSH connection
#[tauri::command]
pub async fn setup_rdp_tunnel(
    state: tauri::State<'_, SshServiceState>,
    session_id: String,
    config: RdpTunnelConfig,
) -> Result<RdpTunnelStatus, String> {
    let mut ssh = state.lock().await;

    let local_port = config.local_port.unwrap_or(13389);
    let bind_interface = config.bind_interface.clone().unwrap_or_else(|| "127.0.0.1".to_string());

    let forward_config = PortForwardConfig {
        local_host: bind_interface.clone(),
        local_port,
        remote_host: config.remote_rdp_host.clone(),
        remote_port: config.remote_rdp_port,
        direction: PortForwardDirection::Local,
    };

    let forward_id = ssh.setup_port_forward(&session_id, forward_config).await?;

    let actual_port = ssh.sessions.get(&session_id)
        .and_then(|s| s.port_forwards.get(&forward_id))
        .map(|pf| pf.config.local_port)
        .unwrap_or(local_port);

    let tunnel_id = format!("rdp_{}", Uuid::new_v4());
    let connection_string = if bind_interface == "127.0.0.1" || bind_interface == "localhost" {
        format!("localhost:{}", actual_port)
    } else {
        format!("{}:{}", bind_interface, actual_port)
    };

    let status = RdpTunnelStatus {
        tunnel_id: tunnel_id.clone(),
        session_id: session_id.clone(),
        local_port: actual_port,
        remote_rdp_host: config.remote_rdp_host,
        remote_rdp_port: config.remote_rdp_port,
        forward_id,
        bind_address: bind_interface,
        label: config.label,
        nla_enabled: config.nla_enabled,
        enable_udp: config.enable_udp,
        connection_string: connection_string.clone(),
        created_at: Utc::now(),
    };

    if let Ok(mut tunnels) = RDP_TUNNELS.lock() {
        tunnels.insert(tunnel_id.clone(), status.clone());
    }

    log::info!("RDP tunnel {} created: {} -> {}:{}",
               tunnel_id, connection_string, status.remote_rdp_host, status.remote_rdp_port);

    Ok(status)
}

/// Stop an RDP tunnel and clean up port forward
#[tauri::command]
pub async fn stop_rdp_tunnel(
    state: tauri::State<'_, SshServiceState>,
    tunnel_id: String,
) -> Result<(), String> {
    let tunnel_status = {
        let mut tunnels = RDP_TUNNELS.lock()
            .map_err(|e| format!("Failed to lock tunnels: {}", e))?;
        tunnels.remove(&tunnel_id)
            .ok_or("RDP tunnel not found")?
    };

    let mut ssh = state.lock().await;

    if let Err(e) = ssh.stop_port_forward(&tunnel_status.session_id, &tunnel_status.forward_id).await {
        log::warn!("Failed to stop RDP port forward: {}", e);
    }

    log::info!("RDP tunnel {} stopped", tunnel_id);
    Ok(())
}

/// Get status of an RDP tunnel
#[tauri::command]
pub fn get_rdp_tunnel_status(tunnel_id: String) -> Result<Option<RdpTunnelStatus>, String> {
    let tunnels = RDP_TUNNELS.lock()
        .map_err(|e| format!("Failed to lock tunnels: {}", e))?;
    Ok(tunnels.get(&tunnel_id).cloned())
}

/// List all active RDP tunnels
#[tauri::command]
pub fn list_rdp_tunnels() -> Result<Vec<RdpTunnelStatus>, String> {
    let tunnels = RDP_TUNNELS.lock()
        .map_err(|e| format!("Failed to lock tunnels: {}", e))?;
    Ok(tunnels.values().cloned().collect())
}

/// List RDP tunnels for a specific SSH session
#[tauri::command]
pub fn list_session_rdp_tunnels(session_id: String) -> Result<Vec<RdpTunnelStatus>, String> {
    let tunnels = RDP_TUNNELS.lock()
        .map_err(|e| format!("Failed to lock tunnels: {}", e))?;
    Ok(tunnels.values()
        .filter(|t| t.session_id == session_id)
        .cloned()
        .collect())
}

/// Setup multiple RDP tunnels for bulk remote desktop access
#[tauri::command]
pub async fn setup_bulk_rdp_tunnels(
    state: tauri::State<'_, SshServiceState>,
    session_id: String,
    targets: Vec<RdpTunnelConfig>,
) -> Result<Vec<RdpTunnelStatus>, String> {
    let mut results = Vec::new();
    let mut base_port = 13390u16;

    for mut config in targets {
        if config.local_port.is_none() {
            config.local_port = Some(base_port);
            base_port += 1;
        }

        match setup_rdp_tunnel(state.clone(), session_id.clone(), config).await {
            Ok(status) => results.push(status),
            Err(e) => {
                log::warn!("Failed to setup RDP tunnel: {}", e);
            }
        }
    }

    Ok(results)
}

/// Stop all RDP tunnels for a session
#[tauri::command]
pub async fn stop_session_rdp_tunnels(
    state: tauri::State<'_, SshServiceState>,
    session_id: String,
) -> Result<u32, String> {
    let tunnel_ids: Vec<String> = {
        let tunnels = RDP_TUNNELS.lock()
            .map_err(|e| format!("Failed to lock tunnels: {}", e))?;
        tunnels.values()
            .filter(|t| t.session_id == session_id)
            .map(|t| t.tunnel_id.clone())
            .collect()
    };

    let mut stopped = 0u32;
    for tunnel_id in tunnel_ids {
        if stop_rdp_tunnel(state.clone(), tunnel_id).await.is_ok() {
            stopped += 1;
        }
    }

    Ok(stopped)
}

/// Generate an RDP file for a tunnel (can be opened directly by Windows Remote Desktop)
#[tauri::command]
pub fn generate_rdp_file(tunnel_id: String, options: Option<RdpFileOptions>) -> Result<String, String> {
    let tunnels = RDP_TUNNELS.lock()
        .map_err(|e| format!("Failed to lock tunnels: {}", e))?;

    let tunnel = tunnels.get(&tunnel_id)
        .ok_or("RDP tunnel not found")?;

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
// VNC over SSH Tunnel Commands
// ===============================

/// Setup a VNC tunnel over SSH
#[tauri::command]
pub async fn setup_vnc_tunnel(
    state: tauri::State<'_, SshServiceState>,
    session_id: String,
    config: VncTunnelConfig,
) -> Result<VncTunnelStatus, String> {
    let mut ssh = state.lock().await;

    let remote_port = if let Some(display) = config.display_number {
        5900 + display
    } else {
        config.remote_vnc_port
    };

    let local_port = config.local_port.unwrap_or(15900);
    let bind_interface = config.bind_interface.clone().unwrap_or_else(|| "127.0.0.1".to_string());

    let forward_config = PortForwardConfig {
        local_host: bind_interface.clone(),
        local_port,
        remote_host: config.remote_vnc_host.clone(),
        remote_port,
        direction: PortForwardDirection::Local,
    };

    let forward_id = ssh.setup_port_forward(&session_id, forward_config).await?;

    let actual_port = ssh.sessions.get(&session_id)
        .and_then(|s| s.port_forwards.get(&forward_id))
        .map(|pf| pf.config.local_port)
        .unwrap_or(local_port);

    let tunnel_id = format!("vnc_{}", Uuid::new_v4());
    let connection_string = if bind_interface == "127.0.0.1" || bind_interface == "localhost" {
        format!("localhost:{}", actual_port)
    } else {
        format!("{}:{}", bind_interface, actual_port)
    };

    let status = VncTunnelStatus {
        tunnel_id: tunnel_id.clone(),
        session_id: session_id.clone(),
        local_port: actual_port,
        remote_vnc_host: config.remote_vnc_host,
        remote_vnc_port: remote_port,
        forward_id,
        bind_address: bind_interface,
        label: config.label,
        connection_string: connection_string.clone(),
        created_at: Utc::now(),
    };

    if let Ok(mut tunnels) = VNC_TUNNELS.lock() {
        tunnels.insert(tunnel_id.clone(), status.clone());
    }

    log::info!("VNC tunnel {} created: {} -> {}:{}",
               tunnel_id, connection_string, status.remote_vnc_host, status.remote_vnc_port);

    Ok(status)
}

/// Stop a VNC tunnel
#[tauri::command]
pub async fn stop_vnc_tunnel(
    state: tauri::State<'_, SshServiceState>,
    tunnel_id: String,
) -> Result<(), String> {
    let tunnel_status = {
        let mut tunnels = VNC_TUNNELS.lock()
            .map_err(|e| format!("Failed to lock tunnels: {}", e))?;
        tunnels.remove(&tunnel_id)
            .ok_or("VNC tunnel not found")?
    };

    let mut ssh = state.lock().await;

    if let Err(e) = ssh.stop_port_forward(&tunnel_status.session_id, &tunnel_status.forward_id).await {
        log::warn!("Failed to stop VNC port forward: {}", e);
    }

    log::info!("VNC tunnel {} stopped", tunnel_id);
    Ok(())
}

/// Get status of a VNC tunnel
#[tauri::command]
pub fn get_vnc_tunnel_status(tunnel_id: String) -> Result<Option<VncTunnelStatus>, String> {
    let tunnels = VNC_TUNNELS.lock()
        .map_err(|e| format!("Failed to lock tunnels: {}", e))?;
    Ok(tunnels.get(&tunnel_id).cloned())
}

/// List all active VNC tunnels
#[tauri::command]
pub fn list_vnc_tunnels() -> Result<Vec<VncTunnelStatus>, String> {
    let tunnels = VNC_TUNNELS.lock()
        .map_err(|e| format!("Failed to lock tunnels: {}", e))?;
    Ok(tunnels.values().cloned().collect())
}

/// List VNC tunnels for a specific SSH session
#[tauri::command]
pub fn list_session_vnc_tunnels(session_id: String) -> Result<Vec<VncTunnelStatus>, String> {
    let tunnels = VNC_TUNNELS.lock()
        .map_err(|e| format!("Failed to lock tunnels: {}", e))?;
    Ok(tunnels.values()
        .filter(|t| t.session_id == session_id)
        .cloned()
        .collect())
}
