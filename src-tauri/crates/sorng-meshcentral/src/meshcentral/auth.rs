//! Authentication handling for MeshCentral.
//!
//! Supports three authentication methods:
//! 1. Username + password (+ optional 2FA token) → `x-meshauth` header
//! 2. Login token → `x-meshauth` header with token credentials
//! 3. Login key → `auth` query parameter (cookie encoding)

use crate::meshcentral::error::MeshCentralResult;
use crate::meshcentral::types::McAuthConfig;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};

/// Build authentication credentials from the config.
///
/// Returns `(Option<x-meshauth header>, Option<auth cookie>)`.
pub fn build_auth(
    config: &McAuthConfig,
    _domain: &str,
) -> MeshCentralResult<(Option<String>, Option<String>)> {
    match config {
        McAuthConfig::Password {
            username,
            password,
            token,
        } => {
            let user_b64 = BASE64.encode(username.as_bytes());
            let pass_b64 = BASE64.encode(password.as_bytes());
            let header = if let Some(tok) = token {
                let tok_b64 = BASE64.encode(tok.as_bytes());
                format!("{},{},{}", user_b64, pass_b64, tok_b64)
            } else {
                format!("{},{}", user_b64, pass_b64)
            };
            Ok((Some(header), None))
        }
        McAuthConfig::LoginToken {
            token_user,
            token_pass,
        } => {
            let user_b64 = BASE64.encode(token_user.as_bytes());
            let pass_b64 = BASE64.encode(token_pass.as_bytes());
            let header = format!("{},{}", user_b64, pass_b64);
            Ok((Some(header), None))
        }
        McAuthConfig::LoginKey { key_hex, username: _ } => {
            // Login keys are 80 bytes (160 hex chars).
            // They get passed as the `auth` query parameter.
            if key_hex.len() == 160 {
                // For a proper login key we would AES-GCM encode a cookie.
                // For now we pass it directly as the auth parameter.
                Ok((None, Some(key_hex.clone())))
            } else {
                // Treat as a pre-encoded login cookie.
                Ok((None, Some(key_hex.clone())))
            }
        }
    }
}

/// Parse site admin rights from a string like `full`, `none`, or
/// comma-separated values (manageusers, serverbackup, etc.).
pub fn parse_site_rights(rights_str: &str) -> u64 {
    let lower = rights_str.to_lowercase();
    let parts: Vec<&str> = lower.split(',').map(|s| s.trim()).collect();

    if parts.contains(&"full") {
        return 0xFFFFFFFF;
    }
    if parts.contains(&"none") {
        return 0;
    }

    let mut rights: u64 = 0;
    for part in &parts {
        match *part {
            "manageusers" => rights |= 0x00000002,
            "serverbackup" | "backup" => rights |= 0x00000001,
            "serverrestore" | "restore" => rights |= 0x00000004,
            "fileaccess" => rights |= 0x00000008,
            "serverupdate" | "update" => rights |= 0x00000010,
            "locked" => rights |= 0x00000020,
            "nonewgroups" => rights |= 0x00000040,
            "notools" => rights |= 0x00000080,
            "usergroups" => rights |= 0x00000100,
            "recordings" => rights |= 0x00000200,
            "locksettings" => rights |= 0x00000400,
            "allevents" => rights |= 0x00000800,
            "nonewdevices" => rights |= 0x00001000,
            _ => {}
        }
    }
    rights
}

/// Parse mesh (device group) rights from common permission names.
pub fn parse_mesh_rights(
    full_rights: bool,
    individual: &[&str],
) -> u64 {
    if full_rights {
        return 0xFFFFFFFF;
    }

    let mut rights: u64 = 0;
    for perm in individual {
        match *perm {
            "editgroup" => rights |= 1,
            "manageusers" => rights |= 2,
            "managedevices" | "managecomputers" => rights |= 4,
            "remotecontrol" => rights |= 8,
            "agentconsole" => rights |= 16,
            "serverfiles" => rights |= 32,
            "wakedevices" | "wake" => rights |= 64,
            "notes" | "setnotes" => rights |= 128,
            "desktopviewonly" | "viewonly" => rights |= 256,
            "noterminal" => rights |= 512,
            "nofiles" => rights |= 1024,
            "noamt" => rights |= 2048,
            "limiteddesktop" => rights |= 4096,
            "limitedevents" => rights |= 8192,
            "chatnotify" => rights |= 16384,
            "uninstall" => rights |= 32768,
            "noremotedesktop" => rights |= 65536,
            "remotecommands" => rights |= 131072,
            "resetpoweroff" => rights |= 262144,
            _ => {}
        }
    }
    rights
}
