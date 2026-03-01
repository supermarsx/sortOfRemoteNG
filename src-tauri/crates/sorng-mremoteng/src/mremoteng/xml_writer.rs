//! XML writer for mRemoteNG confCons.xml format.
//!
//! Writes the hierarchical connection tree to XML, handling:
//! - Root `<Connections>` element with metadata
//! - `<Node>` elements for every connection/container
//! - Per-property inheritance flags
//! - Password encryption

use quick_xml::events::{BytesDecl, BytesEnd, BytesStart, Event};
use quick_xml::Writer;
use std::io::Cursor;

use super::encryption;
use super::error::{MremotengError, MremotengResult};
use super::types::*;

/// Serialize a connection file to XML string.
pub fn write_xml(
    file: &MrngConnectionFile,
    master_password: &str,
) -> MremotengResult<String> {
    let mut writer = Writer::new_with_indent(Cursor::new(Vec::new()), b' ', 4);

    // XML declaration
    writer.write_event(Event::Decl(BytesDecl::new("1.0", Some("utf-8"), None)))
        .map_err(|e| MremotengError::Serialization(e.to_string()))?;

    // <Connections> root element
    let mut root = BytesStart::new("Connections");
    root.push_attribute(("Name", file.name.as_str()));
    root.push_attribute(("Export", "false"));
    root.push_attribute(("EncryptionEngine", match file.encryption.engine {
        BlockCipherEngine::AES => "AES",
        BlockCipherEngine::Serpent => "Serpent",
        BlockCipherEngine::Twofish => "Twofish",
    }));
    root.push_attribute(("BlockCipherMode", match file.encryption.mode {
        BlockCipherMode::GCM => "GCM",
        BlockCipherMode::CCM => "CCM",
        BlockCipherMode::EAX => "EAX",
    }));
    root.push_attribute(("KdfIterations", &*file.encryption.kdf_iterations.to_string()));
    root.push_attribute(("FullFileEncryption", bool_str(file.encryption.full_file_encryption)));
    root.push_attribute(("Protected", file.protected.as_str()));
    root.push_attribute(("ConfVersion", file.conf_version.as_str()));

    writer.write_event(Event::Start(root))
        .map_err(|e| MremotengError::Serialization(e.to_string()))?;

    // Write children
    for child in &file.root.children {
        write_node(&mut writer, child, master_password, file.encryption.kdf_iterations)?;
    }

    // </Connections>
    writer.write_event(Event::End(BytesEnd::new("Connections")))
        .map_err(|e| MremotengError::Serialization(e.to_string()))?;

    let result = writer.into_inner().into_inner();
    String::from_utf8(result).map_err(|e| MremotengError::Serialization(e.to_string()))
}

/// Write a single `<Node>` element (recursive for containers).
fn write_node<W: std::io::Write>(
    writer: &mut Writer<W>,
    node: &MrngConnectionInfo,
    master_password: &str,
    kdf_iterations: u32,
) -> MremotengResult<()> {
    let mut elem = BytesStart::new("Node");

    // ── Identity ─────────────────────────────────────────────────
    elem.push_attribute(("Name", node.name.as_str()));
    elem.push_attribute(("Type", node.node_type.as_str()));
    elem.push_attribute(("Id", node.constant_id.as_str()));

    // ── Display ──────────────────────────────────────────────────
    elem.push_attribute(("Descr", node.description.as_str()));
    elem.push_attribute(("Icon", node.icon.as_str()));
    elem.push_attribute(("Panel", node.panel.as_str()));
    elem.push_attribute(("Color", node.color.as_str()));
    elem.push_attribute(("TabColor", node.tab_color.as_str()));
    elem.push_attribute(("ConnectionFrameColor", &*u32_str(node.connection_frame_color as u32)));

    // ── Connection ───────────────────────────────────────────────
    elem.push_attribute(("Hostname", node.hostname.as_str()));
    elem.push_attribute(("Port", &*node.port.to_string()));
    elem.push_attribute(("Protocol", node.protocol.as_str()));
    elem.push_attribute(("RdpVersion", &*u32_str(node.rdp_version as u32)));
    elem.push_attribute(("ExtApp", node.ext_app.as_str()));
    elem.push_attribute(("PuttySession", node.putty_session.as_str()));
    elem.push_attribute(("SSHOptions", node.ssh_options.as_str()));
    elem.push_attribute(("SSHTunnelConnectionName", node.ssh_tunnel_connection_name.as_str()));
    elem.push_attribute(("OpeningCommand", node.opening_command.as_str()));

    // ── Credentials ──────────────────────────────────────────────
    elem.push_attribute(("Username", node.username.as_str()));
    let encrypted_pw = encryption::encrypt_password(&node.password, master_password, kdf_iterations)
        .unwrap_or_default();
    elem.push_attribute(("Password", encrypted_pw.as_str()));
    elem.push_attribute(("Domain", node.domain.as_str()));
    elem.push_attribute(("ExternalCredentialProvider", &*u32_str(node.external_credential_provider as u32)));
    elem.push_attribute(("UserViaAPI", node.user_via_api.as_str()));
    elem.push_attribute(("VaultOpenbaoMount", node.vault_openbao_mount.as_str()));
    elem.push_attribute(("VaultOpenbaoRole", node.vault_openbao_role.as_str()));

    // ── External Address ─────────────────────────────────────────
    elem.push_attribute(("ExternalAddressProvider", &*u32_str(node.external_address_provider as u32)));
    elem.push_attribute(("EC2InstanceId", node.ec2_instance_id.as_str()));
    elem.push_attribute(("EC2Region", node.ec2_region.as_str()));

    // ── Hyper-V ──────────────────────────────────────────────────
    elem.push_attribute(("VmId", node.vm_id.as_str()));
    elem.push_attribute(("UseVmId", bool_str(node.use_vm_id)));
    elem.push_attribute(("UseEnhancedMode", bool_str(node.use_enhanced_mode)));

    // ── RDP Protocol ─────────────────────────────────────────────
    elem.push_attribute(("UseConsoleSession", bool_str(node.use_console_session)));
    elem.push_attribute(("RDPAuthenticationLevel", &*u32_str(node.rdp_authentication_level as u32)));
    elem.push_attribute(("RDPMinutesToIdleTimeout", &*node.rdp_minutes_to_idle_timeout.to_string()));
    elem.push_attribute(("RDPAlertIdleTimeout", bool_str(node.rdp_alert_idle_timeout)));
    elem.push_attribute(("LoadBalanceInfo", node.load_balance_info.as_str()));
    elem.push_attribute(("RenderingEngine", &*u32_str(node.rendering_engine as u32)));
    elem.push_attribute(("UseCredSsp", bool_str(node.use_cred_ssp)));
    elem.push_attribute(("UseRestrictedAdmin", bool_str(node.use_restricted_admin)));
    elem.push_attribute(("UseRCG", bool_str(node.use_rcg)));

    // ── RD Gateway ───────────────────────────────────────────────
    elem.push_attribute(("RDGatewayUsageMethod", &*u32_str(node.rd_gateway_usage_method as u32)));
    elem.push_attribute(("RDGatewayHostname", node.rd_gateway_hostname.as_str()));
    elem.push_attribute(("RDGatewayUseConnectionCredentials", &*u32_str(node.rd_gateway_use_connection_credentials as u32)));
    elem.push_attribute(("RDGatewayUsername", node.rd_gateway_username.as_str()));
    let encrypted_gw_pw = encryption::encrypt_password(&node.rd_gateway_password, master_password, kdf_iterations)
        .unwrap_or_default();
    elem.push_attribute(("RDGatewayPassword", encrypted_gw_pw.as_str()));
    elem.push_attribute(("RDGatewayDomain", node.rd_gateway_domain.as_str()));
    elem.push_attribute(("RDGatewayAccessToken", node.rd_gateway_access_token.as_str()));
    elem.push_attribute(("RDGatewayExternalCredentialProvider", &*u32_str(node.rd_gateway_external_credential_provider as u32)));
    elem.push_attribute(("RDGatewayUserViaAPI", node.rd_gateway_user_via_api.as_str()));

    // ── Appearance ───────────────────────────────────────────────
    elem.push_attribute(("Resolution", &*u32_str(node.resolution as u32)));
    elem.push_attribute(("AutomaticResize", bool_str(node.automatic_resize)));
    elem.push_attribute(("Colors", &*u32_str(node.colors as u32)));
    elem.push_attribute(("CacheBitmaps", bool_str(node.cache_bitmaps)));
    elem.push_attribute(("DisplayWallpaper", bool_str(node.display_wallpaper)));
    elem.push_attribute(("DisplayThemes", bool_str(node.display_themes)));
    elem.push_attribute(("EnableFontSmoothing", bool_str(node.enable_font_smoothing)));
    elem.push_attribute(("EnableDesktopComposition", bool_str(node.enable_desktop_composition)));
    elem.push_attribute(("DisableFullWindowDrag", bool_str(node.disable_full_window_drag)));
    elem.push_attribute(("DisableMenuAnimations", bool_str(node.disable_menu_animations)));
    elem.push_attribute(("DisableCursorShadow", bool_str(node.disable_cursor_shadow)));
    elem.push_attribute(("DisableCursorBlinking", bool_str(node.disable_cursor_blinking)));

    // ── Redirect ─────────────────────────────────────────────────
    elem.push_attribute(("RedirectKeys", bool_str(node.redirect_keys)));
    elem.push_attribute(("RedirectDiskDrives", &*u32_str(node.redirect_disk_drives as u32)));
    elem.push_attribute(("RedirectDiskDrivesCustom", node.redirect_disk_drives_custom.as_str()));
    elem.push_attribute(("RedirectPrinters", bool_str(node.redirect_printers)));
    elem.push_attribute(("RedirectClipboard", bool_str(node.redirect_clipboard)));
    elem.push_attribute(("RedirectPorts", bool_str(node.redirect_ports)));
    elem.push_attribute(("RedirectSmartCards", bool_str(node.redirect_smart_cards)));
    elem.push_attribute(("RedirectSound", &*u32_str(node.redirect_sound as u32)));
    elem.push_attribute(("SoundQuality", &*u32_str(node.sound_quality as u32)));
    elem.push_attribute(("RedirectAudioCapture", bool_str(node.redirect_audio_capture)));

    // ── RDS ──────────────────────────────────────────────────────
    elem.push_attribute(("RDPStartProgram", node.rdp_start_program.as_str()));
    elem.push_attribute(("RDPStartProgramWorkDir", node.rdp_start_program_work_dir.as_str()));

    // ── VNC ──────────────────────────────────────────────────────
    elem.push_attribute(("VNCCompression", &*u32_str(node.vnc_compression as u32)));
    elem.push_attribute(("VNCEncoding", &*u32_str(node.vnc_encoding as u32)));
    elem.push_attribute(("VNCAuthMode", &*u32_str(node.vnc_auth_mode as u32)));
    elem.push_attribute(("VNCProxyType", &*u32_str(node.vnc_proxy_type as u32)));
    elem.push_attribute(("VNCProxyIP", node.vnc_proxy_ip.as_str()));
    elem.push_attribute(("VNCProxyPort", &*node.vnc_proxy_port.to_string()));
    elem.push_attribute(("VNCProxyUsername", node.vnc_proxy_username.as_str()));
    let encrypted_vnc_pw = encryption::encrypt_password(&node.vnc_proxy_password, master_password, kdf_iterations)
        .unwrap_or_default();
    elem.push_attribute(("VNCProxyPassword", encrypted_vnc_pw.as_str()));
    elem.push_attribute(("VNCColors", &*u32_str(node.vnc_colors as u32)));
    elem.push_attribute(("VNCSmartSizeMode", &*u32_str(node.vnc_smart_size_mode as u32)));
    elem.push_attribute(("VNCViewOnly", bool_str(node.vnc_view_only)));

    // ── Miscellaneous ────────────────────────────────────────────
    elem.push_attribute(("PreExtApp", node.pre_ext_app.as_str()));
    elem.push_attribute(("PostExtApp", node.post_ext_app.as_str()));
    elem.push_attribute(("MacAddress", node.mac_address.as_str()));
    elem.push_attribute(("UserField", node.user_field.as_str()));
    elem.push_attribute(("EnvironmentTags", node.environment_tags.as_str()));
    elem.push_attribute(("Favorite", bool_str(node.favorite)));

    // ── Inheritance ──────────────────────────────────────────────
    write_inheritance_attrs(&mut elem, &node.inheritance);

    if node.children.is_empty() {
        // Self-closing <Node ... />
        writer.write_event(Event::Empty(elem))
            .map_err(|e| MremotengError::Serialization(e.to_string()))?;
    } else {
        // <Node ...> ... children ... </Node>
        writer.write_event(Event::Start(elem))
            .map_err(|e| MremotengError::Serialization(e.to_string()))?;

        for child in &node.children {
            write_node(writer, child, master_password, kdf_iterations)?;
        }

        writer.write_event(Event::End(BytesEnd::new("Node")))
            .map_err(|e| MremotengError::Serialization(e.to_string()))?;
    }

    Ok(())
}

/// Write all inheritance attributes on a `<Node>` element.
fn write_inheritance_attrs(elem: &mut BytesStart, inh: &MrngInheritance) {
    elem.push_attribute(("InheritCacheBitmaps", bool_str(inh.cache_bitmaps)));
    elem.push_attribute(("InheritColors", bool_str(inh.colors)));
    elem.push_attribute(("InheritDescription", bool_str(inh.description)));
    elem.push_attribute(("InheritDisplayThemes", bool_str(inh.display_themes)));
    elem.push_attribute(("InheritDisplayWallpaper", bool_str(inh.display_wallpaper)));
    elem.push_attribute(("InheritEnableFontSmoothing", bool_str(inh.enable_font_smoothing)));
    elem.push_attribute(("InheritEnableDesktopComposition", bool_str(inh.enable_desktop_composition)));
    elem.push_attribute(("InheritDisableFullWindowDrag", bool_str(inh.disable_full_window_drag)));
    elem.push_attribute(("InheritDisableMenuAnimations", bool_str(inh.disable_menu_animations)));
    elem.push_attribute(("InheritDisableCursorShadow", bool_str(inh.disable_cursor_shadow)));
    elem.push_attribute(("InheritDisableCursorBlinking", bool_str(inh.disable_cursor_blinking)));
    elem.push_attribute(("InheritDomain", bool_str(inh.domain)));
    elem.push_attribute(("InheritExtApp", bool_str(inh.ext_app)));
    elem.push_attribute(("InheritIcon", bool_str(inh.icon)));
    elem.push_attribute(("InheritPanel", bool_str(inh.panel)));
    elem.push_attribute(("InheritPassword", bool_str(inh.password)));
    elem.push_attribute(("InheritPort", bool_str(inh.port)));
    elem.push_attribute(("InheritProtocol", bool_str(inh.protocol)));
    elem.push_attribute(("InheritPuttySession", bool_str(inh.putty_session)));
    elem.push_attribute(("InheritSSHOptions", bool_str(inh.ssh_options)));
    elem.push_attribute(("InheritRDPAuthenticationLevel", bool_str(inh.rdp_authentication_level)));
    elem.push_attribute(("InheritRDPMinutesToIdleTimeout", bool_str(inh.rdp_minutes_to_idle_timeout)));
    elem.push_attribute(("InheritRDPAlertIdleTimeout", bool_str(inh.rdp_alert_idle_timeout)));
    elem.push_attribute(("InheritLoadBalanceInfo", bool_str(inh.load_balance_info)));
    elem.push_attribute(("InheritRedirectDiskDrives", bool_str(inh.redirect_disk_drives)));
    elem.push_attribute(("InheritRedirectDiskDrivesCustom", bool_str(inh.redirect_disk_drives_custom)));
    elem.push_attribute(("InheritRedirectKeys", bool_str(inh.redirect_keys)));
    elem.push_attribute(("InheritRedirectPrinters", bool_str(inh.redirect_printers)));
    elem.push_attribute(("InheritRedirectClipboard", bool_str(inh.redirect_clipboard)));
    elem.push_attribute(("InheritRedirectPorts", bool_str(inh.redirect_ports)));
    elem.push_attribute(("InheritRedirectSmartCards", bool_str(inh.redirect_smart_cards)));
    elem.push_attribute(("InheritRedirectSound", bool_str(inh.redirect_sound)));
    elem.push_attribute(("InheritSoundQuality", bool_str(inh.sound_quality)));
    elem.push_attribute(("InheritRedirectAudioCapture", bool_str(inh.redirect_audio_capture)));
    elem.push_attribute(("InheritRenderingEngine", bool_str(inh.rendering_engine)));
    elem.push_attribute(("InheritResolution", bool_str(inh.resolution)));
    elem.push_attribute(("InheritAutomaticResize", bool_str(inh.automatic_resize)));
    elem.push_attribute(("InheritUseConsoleSession", bool_str(inh.use_console_session)));
    elem.push_attribute(("InheritUseCredSsp", bool_str(inh.use_cred_ssp)));
    elem.push_attribute(("InheritUseRestrictedAdmin", bool_str(inh.use_restricted_admin)));
    elem.push_attribute(("InheritUseRCG", bool_str(inh.use_rcg)));
    elem.push_attribute(("InheritUseVmId", bool_str(inh.use_vm_id)));
    elem.push_attribute(("InheritUseEnhancedMode", bool_str(inh.use_enhanced_mode)));
    elem.push_attribute(("InheritUsername", bool_str(inh.username)));
    elem.push_attribute(("InheritRdpVersion", bool_str(inh.rdp_version)));
    elem.push_attribute(("InheritVNCAuthMode", bool_str(inh.vnc_auth_mode)));
    elem.push_attribute(("InheritVNCColors", bool_str(inh.vnc_colors)));
    elem.push_attribute(("InheritVNCCompression", bool_str(inh.vnc_compression)));
    elem.push_attribute(("InheritVNCEncoding", bool_str(inh.vnc_encoding)));
    elem.push_attribute(("InheritVNCProxyIP", bool_str(inh.vnc_proxy_ip)));
    elem.push_attribute(("InheritVNCProxyPassword", bool_str(inh.vnc_proxy_password)));
    elem.push_attribute(("InheritVNCProxyPort", bool_str(inh.vnc_proxy_port)));
    elem.push_attribute(("InheritVNCProxyType", bool_str(inh.vnc_proxy_type)));
    elem.push_attribute(("InheritVNCProxyUsername", bool_str(inh.vnc_proxy_username)));
    elem.push_attribute(("InheritVNCSmartSizeMode", bool_str(inh.vnc_smart_size_mode)));
    elem.push_attribute(("InheritVNCViewOnly", bool_str(inh.vnc_view_only)));
    elem.push_attribute(("InheritRDGatewayUsageMethod", bool_str(inh.rd_gateway_usage_method)));
    elem.push_attribute(("InheritRDGatewayHostname", bool_str(inh.rd_gateway_hostname)));
    elem.push_attribute(("InheritRDGatewayUseConnectionCredentials", bool_str(inh.rd_gateway_use_connection_credentials)));
    elem.push_attribute(("InheritRDGatewayUsername", bool_str(inh.rd_gateway_username)));
    elem.push_attribute(("InheritRDGatewayPassword", bool_str(inh.rd_gateway_password)));
    elem.push_attribute(("InheritRDGatewayDomain", bool_str(inh.rd_gateway_domain)));
    elem.push_attribute(("InheritRDGatewayExternalCredentialProvider", bool_str(inh.rd_gateway_external_credential_provider)));
    elem.push_attribute(("InheritRDGatewayUserViaAPI", bool_str(inh.rd_gateway_user_via_api)));
    elem.push_attribute(("InheritExternalCredentialProvider", bool_str(inh.external_credential_provider)));
    elem.push_attribute(("InheritUserViaAPI", bool_str(inh.user_via_api)));
    elem.push_attribute(("InheritExternalAddressProvider", bool_str(inh.external_address_provider)));
    elem.push_attribute(("InheritUserField", bool_str(inh.user_field)));
    elem.push_attribute(("InheritEnvironmentTags", bool_str(inh.environment_tags)));
    elem.push_attribute(("InheritFavorite", bool_str(inh.favorite)));
    elem.push_attribute(("InheritPreExtApp", bool_str(inh.pre_ext_app)));
    elem.push_attribute(("InheritPostExtApp", bool_str(inh.post_ext_app)));
    elem.push_attribute(("InheritMacAddress", bool_str(inh.mac_address)));
    elem.push_attribute(("InheritSSHTunnelConnectionName", bool_str(inh.ssh_tunnel_connection_name)));
    elem.push_attribute(("InheritOpeningCommand", bool_str(inh.opening_command)));
    elem.push_attribute(("InheritRDPStartProgram", bool_str(inh.rdp_start_program)));
    elem.push_attribute(("InheritRDPStartProgramWorkDir", bool_str(inh.rdp_start_program_work_dir)));
    elem.push_attribute(("InheritVmId", bool_str(inh.vm_id)));
}

// ─── Helpers ────────────────────────────────────────────────────────

fn bool_str(val: bool) -> &'static str {
    if val { "True" } else { "False" }
}

fn u32_str(val: u32) -> String {
    val.to_string()
}
