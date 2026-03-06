//! smb.conf parser.
use crate::client;
use crate::error::FileSharingError;
use crate::types::*;
use std::collections::HashMap;

pub async fn get_config(host: &FileSharingHost) -> Result<SambaFullConfig, FileSharingError> {
    let content = client::read_file(host, "/etc/samba/smb.conf").await?;
    Ok(parse_smb_conf(&content))
}
pub async fn test_config(host: &FileSharingHost) -> Result<String, FileSharingError> { client::exec_ok(host, "testparm", &["-s"]).await }
pub async fn restart(host: &FileSharingHost) -> Result<(), FileSharingError> { client::exec_ok(host, "systemctl", &["restart", "smbd"]).await?; Ok(()) }

pub fn parse_smb_conf(content: &str) -> SambaFullConfig {
    let mut global = SambaGlobalConfig { workgroup: None, server_string: None, netbios_name: None, security: None, map_to_guest: None, log_file: None, max_log_size: None, settings: HashMap::new() };
    let mut shares: Vec<SambaShare> = Vec::new();
    let mut current_section: Option<String> = None;
    let mut current_settings: HashMap<String, String> = HashMap::new();

    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with(';') { continue; }
        if line.starts_with('[') && line.ends_with(']') {
            if let Some(ref section) = current_section {
                if section == "global" { apply_global(&mut global, &current_settings); }
                else { shares.push(settings_to_share(section, &current_settings)); }
            }
            current_section = Some(line[1..line.len()-1].to_string());
            current_settings.clear();
        } else if let Some((k, v)) = line.split_once('=') {
            current_settings.insert(k.trim().to_lowercase(), v.trim().to_string());
        }
    }
    if let Some(ref section) = current_section {
        if section == "global" { apply_global(&mut global, &current_settings); }
        else { shares.push(settings_to_share(section, &current_settings)); }
    }
    SambaFullConfig { global, shares }
}

fn apply_global(g: &mut SambaGlobalConfig, s: &HashMap<String, String>) {
    g.workgroup = s.get("workgroup").cloned();
    g.server_string = s.get("server string").cloned();
    g.netbios_name = s.get("netbios name").cloned();
    g.security = s.get("security").cloned();
    g.map_to_guest = s.get("map to guest").cloned();
    g.log_file = s.get("log file").cloned();
    g.max_log_size = s.get("max log size").and_then(|v| v.parse().ok());
    g.settings = s.clone();
}

fn settings_to_share(name: &str, s: &HashMap<String, String>) -> SambaShare {
    let bool_val = |k: &str, def: bool| s.get(k).map(|v| v == "yes" || v == "true").unwrap_or(def);
    SambaShare {
        name: name.into(), path: s.get("path").cloned().unwrap_or_default(),
        comment: s.get("comment").cloned(), browseable: bool_val("browseable", true),
        writable: bool_val("writable", false), guest_ok: bool_val("guest ok", false),
        read_only: bool_val("read only", true),
        valid_users: s.get("valid users").map(|v| v.split(',').map(|u| u.trim().to_string()).collect()).unwrap_or_default(),
        write_list: s.get("write list").map(|v| v.split(',').map(|u| u.trim().to_string()).collect()).unwrap_or_default(),
        create_mask: s.get("create mask").cloned(), directory_mask: s.get("directory mask").cloned(),
        force_user: s.get("force user").cloned(), force_group: s.get("force group").cloned(),
        settings: s.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn test_parse_smb_conf() {
        let content = "[global]\nworkgroup = WORKGROUP\nsecurity = user\n\n[share1]\npath = /srv/share\nwritable = yes\nguest ok = no\n";
        let cfg = parse_smb_conf(content);
        assert_eq!(cfg.global.workgroup, Some("WORKGROUP".into()));
        assert_eq!(cfg.shares.len(), 1);
        assert_eq!(cfg.shares[0].name, "share1");
        assert!(cfg.shares[0].writable);
    }
}
