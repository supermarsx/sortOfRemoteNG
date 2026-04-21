//! # opkssh Key Management
//!
//! Detect and inspect opkssh-generated SSH keys on disk.

use crate::types::*;
use chrono::{DateTime, Duration, Utc};
use log::debug;
use std::path::{Path, PathBuf};
use tokio::process::Command;

/// Scan the user's `~/.ssh/` for opkssh-generated keys.
pub async fn list_keys() -> Vec<OpksshKey> {
    let ssh_dir = match dirs::home_dir() {
        Some(h) => h.join(".ssh"),
        None => return Vec::new(),
    };

    if !ssh_dir.exists() {
        return Vec::new();
    }

    let mut keys = Vec::new();

    // Read directory entries
    let entries = match tokio::fs::read_dir(&ssh_dir).await {
        Ok(e) => e,
        Err(_) => return Vec::new(),
    };

    let mut entries = entries;
    while let Ok(Some(entry)) = entries.next_entry().await {
        let path = entry.path();

        // Look for key files (not .pub files, not known_hosts, etc.)
        if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
            if name.ends_with(".pub")
                || name == "known_hosts"
                || name == "known_hosts.old"
                || name == "config"
                || name == "authorized_keys"
            {
                continue;
            }
        }

        // Check if this is an opkssh key by examining the .pub file
        let pub_path = PathBuf::from(format!("{}.pub", path.display()));
        if !pub_path.exists() {
            continue;
        }

        // Read the public key to check for opkssh certificate markers
        if let Ok(pub_content) = tokio::fs::read_to_string(&pub_path).await {
            if is_opkssh_key(&pub_content) {
                let key = build_key_info(&path, &pub_path, &pub_content).await;
                keys.push(key);
            }
        }
    }

    keys
}

/// Check if a public key file contains an opkssh PK Token (SSH certificate).
fn is_opkssh_key(pub_content: &str) -> bool {
    // opkssh generates SSH certificates (not plain keys)
    // SSH certificates contain "-cert-v01" in the key type
    // Also check for ecdsa keys which opkssh uses by default
    pub_content.contains("-cert-v01")
        || pub_content.contains("ecdsa-sha2-nistp256")
        // If we find an ecdsa key in ~/.ssh, check if there's a corresponding cert
        || pub_content.contains("openpubkey")
}

/// Build key info from file paths and content.
async fn build_key_info(key_path: &PathBuf, pub_path: &Path, pub_content: &str) -> OpksshKey {
    let id = uuid::Uuid::new_v4().to_string();

    // Try to get file creation time as an approximation
    let created_at = tokio::fs::metadata(key_path)
        .await
        .ok()
        .and_then(|m| m.modified().ok())
        .map(DateTime::<Utc>::from);

    // Default 24h expiry from creation
    let expires_at = created_at.map(|c| c + Duration::hours(24));
    let is_expired = expires_at.map(|e| e < Utc::now()).unwrap_or(false);

    // Detect algorithm from public key content
    let algorithm = if pub_content.contains("ecdsa") {
        "ecdsa-sha2-nistp256".to_string()
    } else if pub_content.contains("ed25519") {
        "ssh-ed25519".to_string()
    } else if pub_content.contains("rsa") {
        "ssh-rsa".to_string()
    } else {
        "unknown".to_string()
    };

    // Try to get fingerprint using ssh-keygen
    let fingerprint = get_key_fingerprint(pub_path).await;

    OpksshKey {
        id,
        path: key_path.to_string_lossy().to_string(),
        public_key_path: pub_path.to_string_lossy().to_string(),
        identity: None, // Will be populated when we can parse the cert
        provider: None,
        created_at,
        expires_at,
        is_expired,
        algorithm,
        fingerprint,
    }
}

/// Get SSH key fingerprint using ssh-keygen.
async fn get_key_fingerprint(pub_path: &Path) -> Option<String> {
    match Command::new("ssh-keygen")
        .args(["-lf", &pub_path.to_string_lossy()])
        .output()
        .await
    {
        Ok(output) if output.status.success() => {
            let out = String::from_utf8_lossy(&output.stdout);
            // Output: "256 SHA256:... user@host (ECDSA)"
            out.split_whitespace().nth(1).map(|s| s.to_string())
        }
        _ => None,
    }
}

/// Remove an opkssh key pair from disk.
pub async fn remove_key(key_path: &str) -> Result<(), String> {
    let path = PathBuf::from(key_path);
    let pub_path = PathBuf::from(format!("{}.pub", key_path));

    if path.exists() {
        tokio::fs::remove_file(&path)
            .await
            .map_err(|e| format!("Failed to remove private key: {}", e))?;
    }
    if pub_path.exists() {
        tokio::fs::remove_file(&pub_path)
            .await
            .map_err(|e| format!("Failed to remove public key: {}", e))?;
    }

    debug!("Removed opkssh key pair: {}", key_path);
    Ok(())
}
