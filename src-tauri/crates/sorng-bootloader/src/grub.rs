//! GRUB2 boot loader management.
//!
//! Parses `/etc/default/grub`, the generated `grub.cfg`,
//! GRUB environment block, and `/etc/grub.d/` scripts.

use crate::client;
use crate::error::BootloaderError;
use crate::types::{BootloaderHost, GrubConfig, GrubEnvironment, GrubMenuEntry, GrubScript};
use std::collections::HashMap;

// ─── /etc/default/grub ─────────────────────────────────────────────

/// Parse `/etc/default/grub` into a `GrubConfig`.
pub async fn get_grub_config(host: &BootloaderHost) -> Result<GrubConfig, BootloaderError> {
    let content = client::read_remote_file(host, "/etc/default/grub").await?;
    parse_grub_defaults(&content)
}

fn parse_grub_defaults(content: &str) -> Result<GrubConfig, BootloaderError> {
    let mut params = HashMap::new();
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some((key, val)) = line.split_once('=') {
            let key = key.trim().to_string();
            let val = val.trim().trim_matches('"').trim_matches('\'').to_string();
            params.insert(key, val);
        }
    }

    let default_entry = params.get("GRUB_DEFAULT").cloned().unwrap_or_else(|| "0".into());
    let timeout = params
        .get("GRUB_TIMEOUT")
        .and_then(|v| v.parse::<i32>().ok())
        .unwrap_or(5);
    let hidden_timeout = params
        .get("GRUB_HIDDEN_TIMEOUT")
        .and_then(|v| v.parse::<i32>().ok());
    let gfx_mode = params.get("GRUB_GFXMODE").cloned();
    let terminal_output = params.get("GRUB_TERMINAL_OUTPUT").cloned();
    let serial_command = params.get("GRUB_SERIAL_COMMAND").cloned();

    Ok(GrubConfig {
        default_entry,
        timeout,
        hidden_timeout,
        gfx_mode,
        terminal_output,
        serial_command,
        custom_entries: Vec::new(),
        params,
    })
}

/// Set a single parameter in `/etc/default/grub`.
pub async fn set_grub_param(
    host: &BootloaderHost,
    key: &str,
    value: &str,
) -> Result<(), BootloaderError> {
    let content = client::read_remote_file(host, "/etc/default/grub").await?;
    let needle = format!("{key}=");
    let new_line = format!("{key}=\"{value}\"");
    let mut found = false;
    let mut lines: Vec<String> = content
        .lines()
        .map(|l| {
            let trimmed = l.trim();
            if trimmed.starts_with(&needle) || trimmed.starts_with(&format!("#{needle}")) {
                found = true;
                new_line.clone()
            } else {
                l.to_string()
            }
        })
        .collect();
    if !found {
        lines.push(new_line);
    }
    let new_content = lines.join("\n");
    client::write_remote_file(host, "/etc/default/grub", &new_content).await
}

// ─── GRUB environment ──────────────────────────────────────────────

/// Read the GRUB environment block via `grub-editenv list` / `grub2-editenv list`.
pub async fn get_grub_environment(host: &BootloaderHost) -> Result<GrubEnvironment, BootloaderError> {
    let output = try_grub_cmd(host, "editenv", &["list"]).await?;
    parse_grub_env(&output)
}

fn parse_grub_env(output: &str) -> Result<GrubEnvironment, BootloaderError> {
    let mut variables = HashMap::new();
    for line in output.lines() {
        if let Some((k, v)) = line.split_once('=') {
            variables.insert(k.trim().to_string(), v.trim().to_string());
        }
    }
    let saved_entry = variables.get("saved_entry").cloned();
    let next_entry = variables.get("next_entry").cloned();
    Ok(GrubEnvironment { saved_entry, next_entry, variables })
}

/// Set a variable in the GRUB environment block.
pub async fn set_grub_environment(
    host: &BootloaderHost,
    key: &str,
    value: &str,
) -> Result<(), BootloaderError> {
    let set_arg = format!("{key}={value}");
    try_grub_cmd(host, "editenv", &["set", &set_arg]).await?;
    Ok(())
}

// ─── Menu entries (grub.cfg parsing) ────────────────────────────────

/// List all GRUB menu entries by parsing the generated `grub.cfg`.
pub async fn list_grub_entries(host: &BootloaderHost) -> Result<Vec<GrubMenuEntry>, BootloaderError> {
    let cfg_path = find_grub_cfg_path(host).await?;
    let content = client::read_remote_file(host, &cfg_path).await?;
    Ok(parse_grub_cfg_entries(&content))
}

/// Get a single GRUB menu entry by id.
pub async fn get_grub_entry(
    host: &BootloaderHost,
    entry_id: &str,
) -> Result<GrubMenuEntry, BootloaderError> {
    let entries = list_grub_entries(host).await?;
    find_entry_recursive(&entries, entry_id)
        .ok_or_else(|| BootloaderError::BootEntryNotFound(entry_id.into()))
}

fn find_entry_recursive(entries: &[GrubMenuEntry], id: &str) -> Option<GrubMenuEntry> {
    for e in entries {
        if e.id == id {
            return Some(e.clone());
        }
        if let Some(found) = find_entry_recursive(&e.submenu_entries, id) {
            return Some(found);
        }
    }
    None
}

fn parse_grub_cfg_entries(content: &str) -> Vec<GrubMenuEntry> {
    let mut entries = Vec::new();
    let mut idx: u32 = 0;
    let mut lines = content.lines().peekable();
    while let Some(line) = lines.next() {
        let trimmed = line.trim();
        if trimmed.starts_with("menuentry ") {
            if let Some(entry) = parse_menuentry(trimmed, &mut lines, &mut idx) {
                entries.push(entry);
            }
        } else if trimmed.starts_with("submenu ") {
            if let Some(sub) = parse_submenu(trimmed, &mut lines, &mut idx) {
                entries.push(sub);
            }
        }
    }
    entries
}

fn parse_menuentry<'a, I: Iterator<Item = &'a str>>(
    header: &str,
    lines: &mut std::iter::Peekable<I>,
    idx: &mut u32,
) -> Option<GrubMenuEntry> {
    let title = extract_quoted(header)?;
    let entry_class = extract_class(header);
    let mut kernel = None;
    let mut initrd = None;
    let mut root = None;
    let mut extra_params = None;
    let mut depth = 1;

    for line in lines.by_ref() {
        let t = line.trim();
        if t.contains('{') && !t.starts_with("menuentry") && !t.starts_with("submenu") {
            depth += 1;
        }
        if t == "}" {
            depth -= 1;
            if depth == 0 {
                break;
            }
        }
        if t.starts_with("linux") || t.starts_with("linuxefi") {
            let parts: Vec<&str> = t.splitn(3, char::is_whitespace).collect();
            if parts.len() >= 2 {
                kernel = Some(parts[1].to_string());
            }
            if parts.len() >= 3 {
                extra_params = Some(parts[2].to_string());
            }
        } else if t.starts_with("initrd") || t.starts_with("initrdefi") {
            let parts: Vec<&str> = t.splitn(2, char::is_whitespace).collect();
            if parts.len() >= 2 {
                initrd = Some(parts[1].to_string());
            }
        } else if t.starts_with("set root=") {
            root = Some(t.trim_start_matches("set root=").trim_matches('\'').trim_matches('"').to_string());
        }
    }

    let id = format!("{idx}");
    *idx += 1;
    Some(GrubMenuEntry {
        id,
        title,
        entry_class,
        kernel,
        initrd,
        root,
        extra_params,
        submenu_entries: Vec::new(),
    })
}

fn parse_submenu<'a, I: Iterator<Item = &'a str>>(
    header: &str,
    lines: &mut std::iter::Peekable<I>,
    idx: &mut u32,
) -> Option<GrubMenuEntry> {
    let title = extract_quoted(header)?;
    let sub_id = format!("{idx}");
    *idx += 1;
    let mut sub_entries = Vec::new();
    let mut depth = 1;
    let mut collected = Vec::new();

    for line in lines.by_ref() {
        let t = line.trim();
        if t.contains('{') {
            depth += 1;
        }
        if t == "}" {
            depth -= 1;
            if depth == 0 {
                break;
            }
        }
        collected.push(line.to_string());
    }

    let sub_content = collected.join("\n");
    let mut sub_lines = sub_content.lines().peekable();
    while let Some(sl) = sub_lines.next() {
        let st = sl.trim();
        if st.starts_with("menuentry ") {
            if let Some(entry) = parse_menuentry(st, &mut sub_lines, idx) {
                sub_entries.push(entry);
            }
        }
    }

    Some(GrubMenuEntry {
        id: sub_id,
        title,
        entry_class: None,
        kernel: None,
        initrd: None,
        root: None,
        extra_params: None,
        submenu_entries: sub_entries,
    })
}

fn extract_quoted(line: &str) -> Option<String> {
    let start = line.find('\'')?;
    let rest = &line[start + 1..];
    let end = rest.find('\'')?;
    Some(rest[..end].to_string())
}

fn extract_class(line: &str) -> Option<String> {
    if let Some(pos) = line.find("--class ") {
        let rest = &line[pos + 8..];
        let end = rest.find(|c: char| c.is_whitespace()).unwrap_or(rest.len());
        Some(rest[..end].to_string())
    } else {
        None
    }
}

// ─── Default entry ─────────────────────────────────────────────────

/// Set the default boot entry via `grub-set-default` or GRUB_DEFAULT.
pub async fn set_default_entry(
    host: &BootloaderHost,
    entry_id: &str,
) -> Result<(), BootloaderError> {
    match try_grub_cmd(host, "set-default", &[entry_id]).await {
        Ok(_) => Ok(()),
        Err(_) => set_grub_param(host, "GRUB_DEFAULT", entry_id).await,
    }
}

// ─── update-grub / grub-mkconfig ────────────────────────────────────

/// Regenerate `grub.cfg` via `update-grub` or `grub-mkconfig`.
pub async fn update_grub(host: &BootloaderHost) -> Result<String, BootloaderError> {
    // Try update-grub first (Debian/Ubuntu), then grub-mkconfig (RHEL/Fedora/Arch)
    let cfg_path = find_grub_cfg_path(host).await.unwrap_or_else(|_| "/boot/grub/grub.cfg".into());
    match client::exec_ok(host, "update-grub", &[]).await {
        Ok(out) => Ok(out),
        Err(_) => {
            match try_grub_cmd(host, "mkconfig", &["-o", &cfg_path]).await {
                Ok(out) => Ok(out),
                Err(e) => Err(e),
            }
        }
    }
}

/// Install GRUB to a device (e.g., /dev/sda).
pub async fn install_grub(
    host: &BootloaderHost,
    device: &str,
) -> Result<String, BootloaderError> {
    try_grub_cmd(host, "install", &[device]).await
}

// ─── Custom entries (/etc/grub.d/40_custom) ─────────────────────────

/// Read the content of `/etc/grub.d/40_custom`.
pub async fn get_custom_entries(host: &BootloaderHost) -> Result<String, BootloaderError> {
    client::read_remote_file(host, "/etc/grub.d/40_custom").await
}

/// Write custom entries to `/etc/grub.d/40_custom`.
pub async fn set_custom_entries(
    host: &BootloaderHost,
    content: &str,
) -> Result<(), BootloaderError> {
    client::write_remote_file(host, "/etc/grub.d/40_custom", content).await
}

// ─── /etc/grub.d/ scripts ──────────────────────────────────────────

/// List scripts in `/etc/grub.d/` with their enabled (executable) status.
pub async fn list_grub_scripts(host: &BootloaderHost) -> Result<Vec<GrubScript>, BootloaderError> {
    let output = client::exec_ok(host, "ls", &["-la", "/etc/grub.d/"]).await?;
    let mut scripts = Vec::new();
    for line in output.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 9 {
            continue;
        }
        let perms = parts[0];
        let name = parts[parts.len() - 1].to_string();
        if name == "." || name == ".." {
            continue;
        }
        let enabled = perms.contains('x');
        scripts.push(GrubScript {
            name: name.clone(),
            path: format!("/etc/grub.d/{name}"),
            enabled,
        });
    }
    Ok(scripts)
}

/// Enable a GRUB script by making it executable.
pub async fn enable_grub_script(
    host: &BootloaderHost,
    name: &str,
) -> Result<(), BootloaderError> {
    client::exec_ok(host, "chmod", &["+x", &format!("/etc/grub.d/{name}")]).await?;
    Ok(())
}

/// Disable a GRUB script by removing its executable bit.
pub async fn disable_grub_script(
    host: &BootloaderHost,
    name: &str,
) -> Result<(), BootloaderError> {
    client::exec_ok(host, "chmod", &["-x", &format!("/etc/grub.d/{name}")]).await?;
    Ok(())
}

/// Generate a preview of the GRUB config without writing it.
pub async fn generate_grub_config_preview(
    host: &BootloaderHost,
) -> Result<String, BootloaderError> {
    try_grub_cmd(host, "mkconfig", &[]).await
}

// ─── Helpers ────────────────────────────────────────────────────────

/// Try `grub-<subcmd>` then `grub2-<subcmd>` (distro compat).
async fn try_grub_cmd(
    host: &BootloaderHost,
    subcmd: &str,
    args: &[&str],
) -> Result<String, BootloaderError> {
    let cmd1 = format!("grub-{subcmd}");
    match client::exec_ok(host, &cmd1, args).await {
        Ok(out) => Ok(out),
        Err(_) => {
            let cmd2 = format!("grub2-{subcmd}");
            client::exec_ok(host, &cmd2, args).await
        }
    }
}

/// Locate grub.cfg — try common paths.
async fn find_grub_cfg_path(host: &BootloaderHost) -> Result<String, BootloaderError> {
    for path in &[
        "/boot/grub/grub.cfg",
        "/boot/grub2/grub.cfg",
        "/boot/efi/EFI/fedora/grub.cfg",
        "/boot/efi/EFI/centos/grub.cfg",
        "/boot/efi/EFI/ubuntu/grub.cfg",
    ] {
        let (_, _, code) = client::exec(host, "test", &["-f", path]).await?;
        if code == 0 {
            return Ok((*path).to_string());
        }
    }
    Err(BootloaderError::ConfigError("grub.cfg not found".into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_DEFAULTS: &str = r#"
# /etc/default/grub
GRUB_DEFAULT=saved
GRUB_TIMEOUT=10
GRUB_DISTRIBUTOR="Arch"
GRUB_CMDLINE_LINUX_DEFAULT="quiet splash"
GRUB_CMDLINE_LINUX=""
GRUB_GFXMODE=1024x768
"#;

    #[test]
    fn test_parse_grub_defaults() {
        let cfg = parse_grub_defaults(SAMPLE_DEFAULTS).unwrap();
        assert_eq!(cfg.default_entry, "saved");
        assert_eq!(cfg.timeout, 10);
        assert_eq!(cfg.gfx_mode.as_deref(), Some("1024x768"));
        assert_eq!(cfg.params.get("GRUB_CMDLINE_LINUX_DEFAULT").unwrap(), "quiet splash");
    }

    const SAMPLE_ENV: &str = "saved_entry=0\nnext_entry=\nrecordfail=1\n";

    #[test]
    fn test_parse_grub_env() {
        let env = parse_grub_env(SAMPLE_ENV).unwrap();
        assert_eq!(env.saved_entry.as_deref(), Some("0"));
        assert_eq!(env.variables.get("recordfail").unwrap(), "1");
    }

    const SAMPLE_CFG: &str = r#"
menuentry 'Ubuntu' --class ubuntu --class os {
    set root='hd0,gpt2'
    linux /vmlinuz-5.15.0-91-generic root=/dev/sda2 ro quiet splash
    initrd /initrd.img-5.15.0-91-generic
}
submenu 'Advanced options for Ubuntu' {
    menuentry 'Ubuntu, with Linux 5.15.0-91-generic' --class ubuntu {
        set root='hd0,gpt2'
        linux /vmlinuz-5.15.0-91-generic root=/dev/sda2 ro
        initrd /initrd.img-5.15.0-91-generic
    }
    menuentry 'Ubuntu, with Linux 5.15.0-91-generic (recovery mode)' --class ubuntu {
        set root='hd0,gpt2'
        linux /vmlinuz-5.15.0-91-generic root=/dev/sda2 ro recovery nomodeset
        initrd /initrd.img-5.15.0-91-generic
    }
}
menuentry 'Windows Boot Manager' --class windows {
    chainloader /EFI/Microsoft/Boot/bootmgfw.efi
}
"#;

    #[test]
    fn test_parse_grub_cfg_entries() {
        let entries = parse_grub_cfg_entries(SAMPLE_CFG);
        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].title, "Ubuntu");
        assert_eq!(entries[0].kernel.as_deref(), Some("/vmlinuz-5.15.0-91-generic"));
        assert_eq!(entries[0].entry_class.as_deref(), Some("ubuntu"));
        // submenu
        assert_eq!(entries[1].title, "Advanced options for Ubuntu");
        assert_eq!(entries[1].submenu_entries.len(), 2);
        assert_eq!(entries[1].submenu_entries[0].title, "Ubuntu, with Linux 5.15.0-91-generic");
        // windows
        assert_eq!(entries[2].title, "Windows Boot Manager");
    }
}
