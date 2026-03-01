//! Bidirectional converter between mRemoteNG `MrngConnectionInfo` and
//! the application's `Connection` JSON model (`serde_json::Value`).
//!
//! The app Connection is a JSON object with fields matching the TypeScript
//! `Connection` interface in `src/types/connection.ts`.

use serde_json::{json, Map, Value};

use super::error::{MremotengError, MremotengResult};
use super::types::*;

// ─── mRemoteNG → App Connection ─────────────────────────────────────

/// Convert an `MrngConnectionInfo` to the application's Connection JSON.
pub fn mrng_to_app_connection(mrng: &MrngConnectionInfo) -> Value {
    let protocol = mrng_protocol_to_app(&mrng.protocol);

    let mut conn = json!({
        "id": mrng.constant_id,
        "name": mrng.name,
        "protocol": protocol,
        "hostname": mrng.hostname,
        "port": mrng.port as u32,
        "isGroup": mrng.node_type == MrngNodeType::Container || mrng.node_type == MrngNodeType::Root,
        "createdAt": chrono::Utc::now().to_rfc3339(),
        "updatedAt": chrono::Utc::now().to_rfc3339(),
    });

    let obj = conn.as_object_mut().unwrap();

    // Optional fields — only include when non-empty/non-default
    if !mrng.username.is_empty() {
        obj.insert("username".into(), json!(mrng.username));
    }
    if !mrng.password.is_empty() {
        obj.insert("password".into(), json!(mrng.password));
    }
    if !mrng.domain.is_empty() {
        obj.insert("domain".into(), json!(mrng.domain));
    }
    if !mrng.description.is_empty() {
        obj.insert("description".into(), json!(mrng.description));
    }
    if !mrng.icon.is_empty() && mrng.icon != "mRemoteNG" {
        obj.insert("icon".into(), json!(mrng.icon));
    }
    if mrng.favorite {
        obj.insert("favorite".into(), json!(true));
    }
    if !mrng.mac_address.is_empty() {
        obj.insert("macAddress".into(), json!(mrng.mac_address));
    }
    if !mrng.environment_tags.is_empty() {
        let tags: Vec<&str> = mrng.environment_tags.split(',')
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .collect();
        if !tags.is_empty() {
            obj.insert("tags".into(), json!(tags));
        }
    }
    if !mrng.color.is_empty() {
        obj.insert("colorTag".into(), json!(mrng.color));
    }

    // SSH tunnel reference
    if !mrng.ssh_tunnel_connection_name.is_empty() {
        obj.insert("security".into(), json!({
            "sshTunnel": {
                "enabled": true,
                "connectionId": mrng.ssh_tunnel_connection_name,
                "localPort": 0,
                "remoteHost": mrng.hostname,
                "remotePort": mrng.port
            }
        }));
    }

    // Scripts
    let has_pre = !mrng.pre_ext_app.is_empty();
    let has_post = !mrng.post_ext_app.is_empty();
    if has_pre || has_post {
        let mut scripts = Map::new();
        if has_pre {
            scripts.insert("onConnect".into(), json!([mrng.pre_ext_app]));
        }
        if has_post {
            scripts.insert("onDisconnect".into(), json!([mrng.post_ext_app]));
        }
        obj.insert("scripts".into(), Value::Object(scripts));
    }

    // RDP settings
    if mrng.protocol == MrngProtocol::RDP {
        obj.insert("rdpSettings".into(), build_rdp_settings(mrng));
    }

    // Group children
    if !mrng.children.is_empty() {
        // Children are separately referenced by parentId in the app model.
        // We mark the group and set expanded.
        obj.insert("expanded".into(), json!(true));
    }

    conn
}

/// Convert a tree of mRemoteNG connections to a flat list of app connections
/// with `parentId` references.
pub fn mrng_tree_to_flat_connections(root: &MrngConnectionInfo) -> Vec<Value> {
    let mut result = Vec::new();
    flatten_node(root, None, &mut result);
    result
}

fn flatten_node(node: &MrngConnectionInfo, parent_id: Option<&str>, result: &mut Vec<Value>) {
    let mut conn = mrng_to_app_connection(node);
    if let Some(pid) = parent_id {
        if let Some(obj) = conn.as_object_mut() {
            obj.insert("parentId".into(), json!(pid));
        }
    }
    let node_id = node.constant_id.clone();
    result.push(conn);

    for child in &node.children {
        flatten_node(child, Some(&node_id), result);
    }
}

// ─── App Connection → mRemoteNG ─────────────────────────────────────

/// Convert an application Connection JSON to `MrngConnectionInfo`.
pub fn app_connection_to_mrng(conn: &Value) -> MremotengResult<MrngConnectionInfo> {
    let obj = conn.as_object()
        .ok_or_else(|| MremotengError::InvalidValue("Expected a JSON object".into()))?;

    let mut mrng = MrngConnectionInfo::default();

    // Identity
    if let Some(id) = obj.get("id").and_then(|v| v.as_str()) {
        mrng.constant_id = id.to_string();
    }
    if let Some(name) = obj.get("name").and_then(|v| v.as_str()) {
        mrng.name = name.to_string();
    }
    if let Some(is_group) = obj.get("isGroup").and_then(|v| v.as_bool()) {
        mrng.node_type = if is_group { MrngNodeType::Container } else { MrngNodeType::Connection };
    }

    // Connection basics
    if let Some(protocol) = obj.get("protocol").and_then(|v| v.as_str()) {
        mrng.protocol = app_protocol_to_mrng(protocol);
    }
    if let Some(hostname) = obj.get("hostname").and_then(|v| v.as_str()) {
        mrng.hostname = hostname.to_string();
    }
    if let Some(port) = obj.get("port").and_then(|v| v.as_u64()) {
        mrng.port = port as u16;
    }

    // Credentials
    if let Some(username) = obj.get("username").and_then(|v| v.as_str()) {
        mrng.username = username.to_string();
    }
    if let Some(password) = obj.get("password").and_then(|v| v.as_str()) {
        mrng.password = password.to_string();
    }
    if let Some(domain) = obj.get("domain").and_then(|v| v.as_str()) {
        mrng.domain = domain.to_string();
    }

    // Display
    if let Some(description) = obj.get("description").and_then(|v| v.as_str()) {
        mrng.description = description.to_string();
    }
    if let Some(icon) = obj.get("icon").and_then(|v| v.as_str()) {
        mrng.icon = icon.to_string();
    }
    if let Some(favorite) = obj.get("favorite").and_then(|v| v.as_bool()) {
        mrng.favorite = favorite;
    }
    if let Some(mac) = obj.get("macAddress").and_then(|v| v.as_str()) {
        mrng.mac_address = mac.to_string();
    }
    if let Some(tags) = obj.get("tags").and_then(|v| v.as_array()) {
        let tag_strs: Vec<String> = tags.iter()
            .filter_map(|t| t.as_str().map(|s| s.to_string()))
            .collect();
        mrng.environment_tags = tag_strs.join(",");
    }
    if let Some(color) = obj.get("colorTag").and_then(|v| v.as_str()) {
        mrng.color = color.to_string();
    }

    // Scripts
    if let Some(scripts) = obj.get("scripts").and_then(|v| v.as_object()) {
        if let Some(on_connect) = scripts.get("onConnect").and_then(|v| v.as_array()) {
            if let Some(first) = on_connect.first().and_then(|v| v.as_str()) {
                mrng.pre_ext_app = first.to_string();
            }
        }
        if let Some(on_disconnect) = scripts.get("onDisconnect").and_then(|v| v.as_array()) {
            if let Some(first) = on_disconnect.first().and_then(|v| v.as_str()) {
                mrng.post_ext_app = first.to_string();
            }
        }
    }

    // SSH Tunnel
    if let Some(security) = obj.get("security").and_then(|v| v.as_object()) {
        if let Some(tunnel) = security.get("sshTunnel").and_then(|v| v.as_object()) {
            if let Some(conn_id) = tunnel.get("connectionId").and_then(|v| v.as_str()) {
                mrng.ssh_tunnel_connection_name = conn_id.to_string();
            }
        }
    }

    // RDP settings
    if let Some(rdp) = obj.get("rdpSettings").and_then(|v| v.as_object()) {
        parse_rdp_settings_from_json(rdp, &mut mrng);
    }

    Ok(mrng)
}

/// Convert a flat list of app connections (with parentId) back into a tree.
pub fn flat_connections_to_mrng_tree(connections: &[Value]) -> MremotengResult<Vec<MrngConnectionInfo>> {
    use std::collections::HashMap;

    // First convert all to MrngConnectionInfo
    let mut node_map: HashMap<String, MrngConnectionInfo> = HashMap::new();
    let mut parent_map: HashMap<String, String> = HashMap::new();
    let mut order: Vec<String> = Vec::new();

    for conn_json in connections {
        let mrng = app_connection_to_mrng(conn_json)?;
        let id = mrng.constant_id.clone();
        order.push(id.clone());

        if let Some(parent_id) = conn_json.get("parentId").and_then(|v| v.as_str()) {
            parent_map.insert(id.clone(), parent_id.to_string());
        }

        node_map.insert(id, mrng);
    }

    // Build tree bottom-up
    let mut roots: Vec<String> = Vec::new();
    let mut children_map: HashMap<String, Vec<String>> = HashMap::new();

    for id in &order {
        if let Some(parent_id) = parent_map.get(id) {
            children_map.entry(parent_id.clone()).or_default().push(id.clone());
        } else {
            roots.push(id.clone());
        }
    }

    fn build_tree(
        id: &str,
        node_map: &mut HashMap<String, MrngConnectionInfo>,
        children_map: &HashMap<String, Vec<String>>,
    ) -> Option<MrngConnectionInfo> {
        let mut node = node_map.remove(id)?;
        if let Some(child_ids) = children_map.get(id) {
            for child_id in child_ids {
                if let Some(child) = build_tree(child_id, node_map, children_map) {
                    node.children.push(child);
                }
            }
        }
        Some(node)
    }

    let mut result = Vec::new();
    for root_id in &roots {
        if let Some(node) = build_tree(root_id, &mut node_map, &children_map) {
            result.push(node);
        }
    }

    Ok(result)
}

// ─── Protocol Mapping ───────────────────────────────────────────────

/// Map mRemoteNG protocol to the app's protocol string.
fn mrng_protocol_to_app(protocol: &MrngProtocol) -> &'static str {
    match protocol {
        MrngProtocol::RDP => "rdp",
        MrngProtocol::VNC => "vnc",
        MrngProtocol::SSH1 | MrngProtocol::SSH2 => "ssh",
        MrngProtocol::Telnet => "telnet",
        MrngProtocol::Rlogin => "rlogin",
        MrngProtocol::RAW => "telnet",    // Closest app equivalent
        MrngProtocol::HTTP => "http",
        MrngProtocol::HTTPS => "https",
        MrngProtocol::PowerShell => "winrm",  // PowerShell remoting → WinRM
        MrngProtocol::Winbox => "http",    // Winbox → HTTP as closest
        MrngProtocol::IntApp => "ssh",     // External app → SSH as default
    }
}

/// Map app protocol string to mRemoteNG protocol.
fn app_protocol_to_mrng(protocol: &str) -> MrngProtocol {
    match protocol {
        "rdp" => MrngProtocol::RDP,
        "vnc" => MrngProtocol::VNC,
        "ssh" | "sftp" | "scp" => MrngProtocol::SSH2,
        "telnet" => MrngProtocol::Telnet,
        "rlogin" => MrngProtocol::Rlogin,
        "http" => MrngProtocol::HTTP,
        "https" => MrngProtocol::HTTPS,
        "winrm" => MrngProtocol::PowerShell,
        "ftp" => MrngProtocol::RAW, // No direct match, use RAW
        _ => MrngProtocol::RDP,
    }
}

// ─── RDP Settings Helpers ───────────────────────────────────────────

/// Build the rdpSettings JSON from mRemoteNG RDP fields.
fn build_rdp_settings(mrng: &MrngConnectionInfo) -> Value {
    let mut rdp = Map::new();

    // Display
    let mut display = Map::new();
    let (width, height) = resolution_to_dimensions(&mrng.resolution);
    if width > 0 {
        display.insert("width".into(), json!(width));
        display.insert("height".into(), json!(height));
    }
    display.insert("resizeToWindow".into(), json!(mrng.automatic_resize));
    display.insert("colorDepth".into(), json!(rdp_colors_to_depth(&mrng.colors)));
    display.insert("smartSizing".into(), json!(mrng.resolution == RDPResolutions::SmartSize));
    rdp.insert("display".into(), Value::Object(display));

    // Audio
    let playback = match mrng.redirect_sound {
        RDPSounds::BringToThisComputer => "local",
        RDPSounds::LeaveAtRemoteComputer => "remote",
        RDPSounds::DoNotPlay => "disabled",
    };
    let recording = if mrng.redirect_audio_capture { "enabled" } else { "disabled" };
    let quality = match mrng.sound_quality {
        RDPSoundQuality::Dynamic => "dynamic",
        RDPSoundQuality::Medium => "medium",
        RDPSoundQuality::High => "high",
    };
    rdp.insert("audio".into(), json!({
        "playbackMode": playback,
        "recordingMode": recording,
        "audioQuality": quality
    }));

    // Input
    rdp.insert("input".into(), json!({
        "mouseMode": "relative"
    }));

    // Device Redirection
    let mut redir = Map::new();
    redir.insert("clipboard".into(), json!(mrng.redirect_clipboard));
    redir.insert("printers".into(), json!(mrng.redirect_printers));
    redir.insert("ports".into(), json!(mrng.redirect_ports));
    redir.insert("smartCards".into(), json!(mrng.redirect_smart_cards));
    if mrng.redirect_disk_drives != RDPDiskDrives::None {
        redir.insert("drives".into(), json!([]));
    }
    rdp.insert("deviceRedirection".into(), Value::Object(redir));

    // Performance
    let mut perf = Map::new();
    perf.insert("disableWallpaper".into(), json!(!mrng.display_wallpaper));
    perf.insert("disableFullWindowDrag".into(), json!(mrng.disable_full_window_drag));
    perf.insert("disableMenuAnimations".into(), json!(mrng.disable_menu_animations));
    perf.insert("disableTheming".into(), json!(!mrng.display_themes));
    perf.insert("disableCursorShadow".into(), json!(mrng.disable_cursor_shadow));
    perf.insert("disableCursorSettings".into(), json!(mrng.disable_cursor_blinking));
    perf.insert("enableFontSmoothing".into(), json!(mrng.enable_font_smoothing));
    perf.insert("enableDesktopComposition".into(), json!(mrng.enable_desktop_composition));
    perf.insert("persistentBitmapCaching".into(), json!(mrng.cache_bitmaps));
    rdp.insert("performance".into(), Value::Object(perf));

    // Security
    let mut sec = Map::new();
    sec.insert("useCredSsp".into(), json!(mrng.use_cred_ssp));
    sec.insert("restrictedAdmin".into(), json!(mrng.use_restricted_admin));
    sec.insert("remoteCredentialGuard".into(), json!(mrng.use_rcg));
    rdp.insert("security".into(), Value::Object(sec));

    // Gateway
    if mrng.rd_gateway_usage_method != RDGatewayUsageMethod::Never {
        let cred_source = match mrng.rd_gateway_use_connection_credentials {
            RDGatewayUseConnectionCredentials::Yes => "same-as-connection",
            RDGatewayUseConnectionCredentials::SmartCard => "separate",
            RDGatewayUseConnectionCredentials::AskForCredentials => "ask",
        };
        let mut gw = Map::new();
        gw.insert("enabled".into(), json!(true));
        if !mrng.rd_gateway_hostname.is_empty() {
            gw.insert("hostname".into(), json!(mrng.rd_gateway_hostname));
        }
        gw.insert("credentialSource".into(), json!(cred_source));
        if !mrng.rd_gateway_username.is_empty() {
            gw.insert("username".into(), json!(mrng.rd_gateway_username));
        }
        if !mrng.rd_gateway_domain.is_empty() {
            gw.insert("domain".into(), json!(mrng.rd_gateway_domain));
        }
        rdp.insert("gateway".into(), Value::Object(gw));
    }

    // HyperV
    if mrng.use_vm_id || mrng.use_enhanced_mode {
        rdp.insert("hyperv".into(), json!({
            "vmId": mrng.vm_id,
            "useVmId": mrng.use_vm_id,
            "useEnhancedSession": mrng.use_enhanced_mode
        }));
    }

    // Advanced
    if mrng.use_console_session || !mrng.load_balance_info.is_empty()
        || !mrng.rdp_start_program.is_empty()
    {
        let mut adv = Map::new();
        if mrng.use_console_session {
            adv.insert("connectToConsole".into(), json!(true));
        }
        if !mrng.load_balance_info.is_empty() {
            adv.insert("loadBalanceInfo".into(), json!(mrng.load_balance_info));
        }
        if !mrng.rdp_start_program.is_empty() {
            adv.insert("alternateShell".into(), json!(mrng.rdp_start_program));
        }
        if !mrng.rdp_start_program_work_dir.is_empty() {
            adv.insert("shellWorkingDirectory".into(), json!(mrng.rdp_start_program_work_dir));
        }
        rdp.insert("advanced".into(), Value::Object(adv));
    }

    Value::Object(rdp)
}

/// Parse RDP settings from JSON back into MrngConnectionInfo fields.
fn parse_rdp_settings_from_json(rdp: &Map<String, Value>, mrng: &mut MrngConnectionInfo) {
    // Display
    if let Some(display) = rdp.get("display").and_then(|v| v.as_object()) {
        if let Some(w) = display.get("width").and_then(|v| v.as_u64()) {
            mrng.resolution = dimensions_to_resolution(w as u32, display.get("height").and_then(|v| v.as_u64()).unwrap_or(0) as u32);
        }
        if let Some(resize) = display.get("resizeToWindow").and_then(|v| v.as_bool()) {
            mrng.automatic_resize = resize;
        }
        if let Some(depth) = display.get("colorDepth").and_then(|v| v.as_u64()) {
            mrng.colors = depth_to_rdp_colors(depth as u32);
        }
    }

    // Audio
    if let Some(audio) = rdp.get("audio").and_then(|v| v.as_object()) {
        if let Some(playback) = audio.get("playbackMode").and_then(|v| v.as_str()) {
            mrng.redirect_sound = match playback {
                "local" => RDPSounds::BringToThisComputer,
                "remote" => RDPSounds::LeaveAtRemoteComputer,
                _ => RDPSounds::DoNotPlay,
            };
        }
        if let Some(recording) = audio.get("recordingMode").and_then(|v| v.as_str()) {
            mrng.redirect_audio_capture = recording == "enabled";
        }
        if let Some(quality) = audio.get("audioQuality").and_then(|v| v.as_str()) {
            mrng.sound_quality = match quality {
                "medium" => RDPSoundQuality::Medium,
                "high" => RDPSoundQuality::High,
                _ => RDPSoundQuality::Dynamic,
            };
        }
    }

    // Device Redirection
    if let Some(redir) = rdp.get("deviceRedirection").and_then(|v| v.as_object()) {
        mrng.redirect_clipboard = redir.get("clipboard").and_then(|v| v.as_bool()).unwrap_or(true);
        mrng.redirect_printers = redir.get("printers").and_then(|v| v.as_bool()).unwrap_or(false);
        mrng.redirect_ports = redir.get("ports").and_then(|v| v.as_bool()).unwrap_or(false);
        mrng.redirect_smart_cards = redir.get("smartCards").and_then(|v| v.as_bool()).unwrap_or(false);
        if redir.get("drives").is_some() {
            mrng.redirect_disk_drives = RDPDiskDrives::All;
        }
    }

    // Performance
    if let Some(perf) = rdp.get("performance").and_then(|v| v.as_object()) {
        mrng.display_wallpaper = !perf.get("disableWallpaper").and_then(|v| v.as_bool()).unwrap_or(false);
        mrng.disable_full_window_drag = perf.get("disableFullWindowDrag").and_then(|v| v.as_bool()).unwrap_or(false);
        mrng.disable_menu_animations = perf.get("disableMenuAnimations").and_then(|v| v.as_bool()).unwrap_or(false);
        mrng.display_themes = !perf.get("disableTheming").and_then(|v| v.as_bool()).unwrap_or(false);
        mrng.disable_cursor_shadow = perf.get("disableCursorShadow").and_then(|v| v.as_bool()).unwrap_or(false);
        mrng.disable_cursor_blinking = perf.get("disableCursorSettings").and_then(|v| v.as_bool()).unwrap_or(false);
        mrng.enable_font_smoothing = perf.get("enableFontSmoothing").and_then(|v| v.as_bool()).unwrap_or(false);
        mrng.enable_desktop_composition = perf.get("enableDesktopComposition").and_then(|v| v.as_bool()).unwrap_or(false);
        mrng.cache_bitmaps = perf.get("persistentBitmapCaching").and_then(|v| v.as_bool()).unwrap_or(false);
    }

    // Security
    if let Some(sec) = rdp.get("security").and_then(|v| v.as_object()) {
        mrng.use_cred_ssp = sec.get("useCredSsp").and_then(|v| v.as_bool()).unwrap_or(true);
        mrng.use_restricted_admin = sec.get("restrictedAdmin").and_then(|v| v.as_bool()).unwrap_or(false);
        mrng.use_rcg = sec.get("remoteCredentialGuard").and_then(|v| v.as_bool()).unwrap_or(false);
    }

    // Gateway
    if let Some(gw) = rdp.get("gateway").and_then(|v| v.as_object()) {
        let enabled = gw.get("enabled").and_then(|v| v.as_bool()).unwrap_or(false);
        mrng.rd_gateway_usage_method = if enabled { RDGatewayUsageMethod::Always } else { RDGatewayUsageMethod::Never };
        if let Some(hostname) = gw.get("hostname").and_then(|v| v.as_str()) {
            mrng.rd_gateway_hostname = hostname.to_string();
        }
        if let Some(cred) = gw.get("credentialSource").and_then(|v| v.as_str()) {
            mrng.rd_gateway_use_connection_credentials = match cred {
                "same-as-connection" => RDGatewayUseConnectionCredentials::Yes,
                "separate" => RDGatewayUseConnectionCredentials::SmartCard,
                "ask" => RDGatewayUseConnectionCredentials::AskForCredentials,
                _ => RDGatewayUseConnectionCredentials::Yes,
            };
        }
        if let Some(user) = gw.get("username").and_then(|v| v.as_str()) {
            mrng.rd_gateway_username = user.to_string();
        }
        if let Some(domain) = gw.get("domain").and_then(|v| v.as_str()) {
            mrng.rd_gateway_domain = domain.to_string();
        }
    }

    // HyperV
    if let Some(hv) = rdp.get("hyperv").and_then(|v| v.as_object()) {
        if let Some(vm_id) = hv.get("vmId").and_then(|v| v.as_str()) {
            mrng.vm_id = vm_id.to_string();
        }
        mrng.use_vm_id = hv.get("useVmId").and_then(|v| v.as_bool()).unwrap_or(false);
        mrng.use_enhanced_mode = hv.get("useEnhancedSession").and_then(|v| v.as_bool()).unwrap_or(false);
    }

    // Advanced
    if let Some(adv) = rdp.get("advanced").and_then(|v| v.as_object()) {
        mrng.use_console_session = adv.get("connectToConsole").and_then(|v| v.as_bool()).unwrap_or(false);
        if let Some(lb) = adv.get("loadBalanceInfo").and_then(|v| v.as_str()) {
            mrng.load_balance_info = lb.to_string();
        }
        if let Some(shell) = adv.get("alternateShell").and_then(|v| v.as_str()) {
            mrng.rdp_start_program = shell.to_string();
        }
        if let Some(wd) = adv.get("shellWorkingDirectory").and_then(|v| v.as_str()) {
            mrng.rdp_start_program_work_dir = wd.to_string();
        }
    }
}

// ─── Resolution helpers ─────────────────────────────────────────────

fn resolution_to_dimensions(res: &RDPResolutions) -> (u32, u32) {
    match res {
        RDPResolutions::Res800x600 => (800, 600),
        RDPResolutions::Res1024x768 => (1024, 768),
        RDPResolutions::Res1280x1024 => (1280, 1024),
        RDPResolutions::Res1600x1200 => (1600, 1200),
        _ => (0, 0),
    }
}

fn dimensions_to_resolution(w: u32, h: u32) -> RDPResolutions {
    match (w, h) {
        (800, 600) => RDPResolutions::Res800x600,
        (1024, 768) => RDPResolutions::Res1024x768,
        (1280, 1024) => RDPResolutions::Res1280x1024,
        (1600, 1200) => RDPResolutions::Res1600x1200,
        _ => RDPResolutions::FitToWindow,
    }
}

fn rdp_colors_to_depth(colors: &RDPColors) -> u32 {
    match colors {
        RDPColors::Colors256 => 8,
        RDPColors::Colors15Bit => 15,
        RDPColors::Colors16Bit => 16,
        RDPColors::Colors24Bit => 24,
        RDPColors::Colors32Bit => 32,
    }
}

fn depth_to_rdp_colors(depth: u32) -> RDPColors {
    match depth {
        8 => RDPColors::Colors256,
        15 => RDPColors::Colors15Bit,
        16 => RDPColors::Colors16Bit,
        24 => RDPColors::Colors24Bit,
        _ => RDPColors::Colors32Bit,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mrng_to_app_rdp() {
        let mut mrng = MrngConnectionInfo::default();
        mrng.name = "TestServer".into();
        mrng.hostname = "10.0.0.1".into();
        mrng.port = 3389;
        mrng.protocol = MrngProtocol::RDP;
        mrng.username = "admin".into();
        mrng.redirect_clipboard = true;
        mrng.enable_font_smoothing = true;

        let conn = mrng_to_app_connection(&mrng);
        assert_eq!(conn["name"], "TestServer");
        assert_eq!(conn["protocol"], "rdp");
        assert_eq!(conn["hostname"], "10.0.0.1");
        assert_eq!(conn["port"], 3389);
        assert_eq!(conn["username"], "admin");
        assert!(conn["rdpSettings"]["performance"]["enableFontSmoothing"].as_bool().unwrap());
    }

    #[test]
    fn test_app_to_mrng_ssh() {
        let conn = json!({
            "id": "abc-123",
            "name": "SSH Box",
            "protocol": "ssh",
            "hostname": "192.168.1.100",
            "port": 22,
            "username": "root",
            "isGroup": false,
            "createdAt": "2024-01-01T00:00:00Z",
            "updatedAt": "2024-01-01T00:00:00Z"
        });

        let mrng = app_connection_to_mrng(&conn).unwrap();
        assert_eq!(mrng.name, "SSH Box");
        assert_eq!(mrng.protocol, MrngProtocol::SSH2);
        assert_eq!(mrng.hostname, "192.168.1.100");
        assert_eq!(mrng.port, 22);
        assert_eq!(mrng.username, "root");
    }

    #[test]
    fn test_roundtrip_conversion() {
        let mut mrng = MrngConnectionInfo::default();
        mrng.name = "Roundtrip".into();
        mrng.hostname = "server.test".into();
        mrng.port = 5900;
        mrng.protocol = MrngProtocol::VNC;
        mrng.description = "Test VNC".into();
        mrng.favorite = true;

        let json = mrng_to_app_connection(&mrng);
        let back = app_connection_to_mrng(&json).unwrap();

        assert_eq!(back.name, mrng.name);
        assert_eq!(back.hostname, mrng.hostname);
        assert_eq!(back.port, mrng.port);
        assert_eq!(back.protocol, MrngProtocol::VNC);
        assert_eq!(back.favorite, true);
    }

    #[test]
    fn test_protocol_mapping() {
        assert_eq!(mrng_protocol_to_app(&MrngProtocol::RDP), "rdp");
        assert_eq!(mrng_protocol_to_app(&MrngProtocol::SSH2), "ssh");
        assert_eq!(mrng_protocol_to_app(&MrngProtocol::VNC), "vnc");
        assert_eq!(mrng_protocol_to_app(&MrngProtocol::Telnet), "telnet");
        assert_eq!(mrng_protocol_to_app(&MrngProtocol::HTTPS), "https");
        assert_eq!(mrng_protocol_to_app(&MrngProtocol::PowerShell), "winrm");

        assert_eq!(app_protocol_to_mrng("rdp"), MrngProtocol::RDP);
        assert_eq!(app_protocol_to_mrng("ssh"), MrngProtocol::SSH2);
        assert_eq!(app_protocol_to_mrng("vnc"), MrngProtocol::VNC);
    }
}
