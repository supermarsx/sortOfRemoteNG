//! # opkssh Key Management
//!
//! Detect and inspect opkssh-generated SSH keys on disk.

use crate::types::*;
use chrono::{DateTime, Duration, Utc};
use log::debug;
use std::path::{Path, PathBuf};
use tokio::process::Command;

/// Structured key material that future runtime-backed login code can convert
/// into the existing UI shape without going back through directory scanning.
#[derive(Debug, Clone, Default)]
pub struct RuntimeKeyMaterial {
    pub id: Option<String>,
    pub path: Option<String>,
    pub public_key_path: Option<String>,
    pub identity: Option<String>,
    pub provider: Option<String>,
    pub created_at: Option<DateTime<Utc>>,
    pub expires_at: Option<DateTime<Utc>>,
    pub algorithm: Option<String>,
    pub fingerprint: Option<String>,
}

/// Scan the user's `~/.ssh/` for opkssh-generated keys.
pub async fn list_keys() -> Vec<OpksshKey> {
    let Some(ssh_dir) = default_ssh_dir() else {
        return Vec::new();
    };

    list_keys_in_dir(&ssh_dir).await
}

/// Scan a specific SSH directory for opkssh-generated keys.
pub async fn list_keys_in_dir(ssh_dir: &Path) -> Vec<OpksshKey> {
    if !ssh_dir.exists() {
        return Vec::new();
    }

    let mut keys = Vec::new();
    let mut entries = match tokio::fs::read_dir(ssh_dir).await {
        Ok(entries) => entries,
        Err(_) => return Vec::new(),
    };

    while let Ok(Some(entry)) = entries.next_entry().await {
        let file_type = match entry.file_type().await {
            Ok(file_type) => file_type,
            Err(_) => continue,
        };
        if !file_type.is_file() {
            continue;
        }

        let path = entry.path();
        if !is_private_key_candidate(&path) {
            continue;
        }

        let Some((pub_path, pub_content)) = find_public_key(&path).await else {
            continue;
        };

        keys.push(build_scanned_key(&path, &pub_path, &pub_content).await);
    }

    keys.sort_by(|left, right| left.path.cmp(&right.path));
    keys
}

/// Build an `OpksshKey` from structured runtime-owned key material.
pub fn build_key_from_material(material: RuntimeKeyMaterial) -> OpksshKey {
    let path = material.path.unwrap_or_default();
    let public_key_path = material.public_key_path.unwrap_or_else(|| {
        if path.is_empty() {
            String::new()
        } else {
            format!("{}.pub", path)
        }
    });
    let created_at = material.created_at;
    let expires_at = material
        .expires_at
        .or_else(|| created_at.map(|created_at| created_at + Duration::hours(24)));

    OpksshKey {
        id: material.id.unwrap_or_else(|| {
            if !path.is_empty() {
                path.clone()
            } else if !public_key_path.is_empty() {
                public_key_path.clone()
            } else {
                uuid::Uuid::new_v4().to_string()
            }
        }),
        path,
        public_key_path,
        identity: material.identity,
        provider: material.provider,
        created_at,
        is_expired: expires_at
            .map(|expires_at| expires_at < Utc::now())
            .unwrap_or(false),
        expires_at,
        algorithm: material.algorithm.unwrap_or_else(|| "unknown".to_string()),
        fingerprint: material.fingerprint,
    }
}

/// Remove an opkssh key pair from disk.
pub async fn remove_key(key_ref: &str) -> Result<(), String> {
    let ssh_dir = default_ssh_dir().ok_or_else(|| "Failed to resolve ~/.ssh".to_string())?;
    remove_key_from_dir(&ssh_dir, key_ref).await
}

/// Remove an opkssh key pair from a specific SSH directory.
pub async fn remove_key_from_dir(ssh_dir: &Path, key_ref: &str) -> Result<(), String> {
    let path = resolve_key_path(ssh_dir, key_ref).await?;

    if path.exists() {
        tokio::fs::remove_file(&path)
            .await
            .map_err(|error| format!("Failed to remove private key: {error}"))?;
    }

    for pub_path in public_key_candidates(&path) {
        if pub_path.exists() {
            tokio::fs::remove_file(&pub_path)
                .await
                .map_err(|error| format!("Failed to remove public key: {error}"))?;
        }
    }

    debug!("Removed opkssh key pair: {}", key_ref);
    Ok(())
}

fn default_ssh_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(".ssh"))
}

fn is_private_key_candidate(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };

    !name.ends_with(".pub")
        && name != "known_hosts"
        && name != "known_hosts.old"
        && name != "config"
        && name != "authorized_keys"
}

async fn find_public_key(key_path: &Path) -> Option<(PathBuf, String)> {
    for candidate in public_key_candidates(key_path) {
        if !candidate.exists() {
            continue;
        }

        let Ok(content) = tokio::fs::read_to_string(&candidate).await else {
            continue;
        };

        if is_opkssh_key(&content) {
            return Some((candidate, content));
        }
    }

    None
}

fn public_key_candidates(key_path: &Path) -> Vec<PathBuf> {
    vec![
        PathBuf::from(format!("{}.pub", key_path.display())),
        PathBuf::from(format!("{}-cert.pub", key_path.display())),
    ]
}

/// Check if a public key file contains an opkssh PK Token (SSH certificate).
fn is_opkssh_key(pub_content: &str) -> bool {
    let key_type = pub_content.split_whitespace().next().unwrap_or_default();
    key_type.contains("-cert-v01") || pub_content.contains("openpubkey")
}

/// Build key info from file paths and content.
async fn build_scanned_key(key_path: &Path, pub_path: &Path, pub_content: &str) -> OpksshKey {
    let created_at = tokio::fs::metadata(key_path)
        .await
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .map(DateTime::<Utc>::from);
    let fingerprint = get_key_fingerprint(pub_path).await;

    build_key_from_material(RuntimeKeyMaterial {
        id: Some(key_path.to_string_lossy().to_string()),
        path: Some(key_path.to_string_lossy().to_string()),
        public_key_path: Some(pub_path.to_string_lossy().to_string()),
        identity: extract_identity_from_public_key(pub_content),
        provider: None,
        created_at,
        expires_at: created_at.map(|created_at| created_at + Duration::hours(24)),
        algorithm: Some(detect_algorithm(pub_content)),
        fingerprint,
    })
}

fn detect_algorithm(pub_content: &str) -> String {
    let key_type = pub_content.split_whitespace().next().unwrap_or_default();
    if key_type.contains("ecdsa-sha2-nistp256") {
        "ecdsa-sha2-nistp256".to_string()
    } else if key_type.contains("ssh-ed25519") {
        "ssh-ed25519".to_string()
    } else if key_type.contains("ssh-rsa") || key_type.contains("rsa-sha2-") {
        "ssh-rsa".to_string()
    } else if key_type.is_empty() {
        "unknown".to_string()
    } else {
        key_type.to_string()
    }
}

fn extract_identity_from_public_key(pub_content: &str) -> Option<String> {
    let mut parts = pub_content.split_whitespace();
    parts.next()?;
    parts.next()?;
    let comment = parts.collect::<Vec<_>>().join(" ");
    if comment.is_empty() {
        None
    } else {
        Some(comment)
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
            out.split_whitespace()
                .nth(1)
                .map(|fingerprint| fingerprint.to_string())
        }
        _ => None,
    }
}

async fn resolve_key_path(ssh_dir: &Path, key_ref: &str) -> Result<PathBuf, String> {
    let direct_path = strip_public_suffix(&PathBuf::from(key_ref));
    if direct_path.exists() {
        return Ok(direct_path);
    }

    let ssh_dir_path = strip_public_suffix(&ssh_dir.join(key_ref));
    if ssh_dir_path.exists() {
        return Ok(ssh_dir_path);
    }

    let keys = list_keys_in_dir(ssh_dir).await;
    if let Some(key) = keys
        .iter()
        .find(|key| key.id == key_ref || key.path == key_ref || key.public_key_path == key_ref)
    {
        return Ok(PathBuf::from(&key.path));
    }

    Err(format!("Failed to find opkssh key {key_ref}"))
}

fn strip_public_suffix(path: &Path) -> PathBuf {
    let path_str = path.to_string_lossy();
    if let Some(base) = path_str.strip_suffix("-cert.pub") {
        PathBuf::from(base)
    } else if let Some(base) = path_str.strip_suffix(".pub") {
        PathBuf::from(base)
    } else {
        path.to_path_buf()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_dir(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "sortofremoteng-opkssh-{}-{}",
            name,
            uuid::Uuid::new_v4()
        ))
    }

    #[tokio::test]
    async fn list_keys_in_dir_detects_cert_files_without_plain_ecdsa_fallback() {
        let dir = test_dir("keys-scan");
        tokio::fs::create_dir_all(&dir).await.expect("create dir");

        let private_key = dir.join("id_opkssh");
        let public_key = dir.join("id_opkssh-cert.pub");
        tokio::fs::write(&private_key, b"private")
            .await
            .expect("write private key");
        tokio::fs::write(
            &public_key,
            b"ssh-ed25519-cert-v01@openssh.com AAAA alice@example.com",
        )
        .await
        .expect("write public key");

        let keys = list_keys_in_dir(&dir).await;
        assert_eq!(keys.len(), 1);
        assert_eq!(keys[0].path, private_key.to_string_lossy());
        assert_eq!(keys[0].public_key_path, public_key.to_string_lossy());
        assert_eq!(keys[0].identity.as_deref(), Some("alice@example.com"));

        tokio::fs::remove_dir_all(&dir).await.expect("cleanup dir");
    }

    #[tokio::test]
    async fn list_keys_in_dir_ignores_plain_ecdsa_public_keys() {
        let dir = test_dir("keys-ignore");
        tokio::fs::create_dir_all(&dir).await.expect("create dir");

        let private_key = dir.join("id_ecdsa");
        let public_key = dir.join("id_ecdsa.pub");
        tokio::fs::write(&private_key, b"private")
            .await
            .expect("write private key");
        tokio::fs::write(&public_key, b"ecdsa-sha2-nistp256 AAAA user@example.com")
            .await
            .expect("write public key");

        let keys = list_keys_in_dir(&dir).await;
        assert!(keys.is_empty());

        tokio::fs::remove_dir_all(&dir).await.expect("cleanup dir");
    }

    #[tokio::test]
    async fn remove_key_from_dir_accepts_existing_key_id() {
        let dir = test_dir("keys-remove");
        tokio::fs::create_dir_all(&dir).await.expect("create dir");

        let private_key = dir.join("id_opkssh");
        let public_key = dir.join("id_opkssh.pub");
        tokio::fs::write(&private_key, b"private")
            .await
            .expect("write private key");
        tokio::fs::write(
            &public_key,
            b"ssh-ed25519-cert-v01@openssh.com AAAA alice@example.com",
        )
        .await
        .expect("write public key");

        remove_key_from_dir(&dir, &private_key.to_string_lossy())
            .await
            .expect("remove key");

        assert!(!private_key.exists());
        assert!(!public_key.exists());

        tokio::fs::remove_dir_all(&dir).await.expect("cleanup dir");
    }

    #[test]
    fn build_key_from_material_preserves_runtime_metadata() {
        let expires_at = Utc::now() + Duration::hours(1);
        let key = build_key_from_material(RuntimeKeyMaterial {
            id: Some("runtime-key".into()),
            path: Some("/tmp/id_runtime".into()),
            public_key_path: Some("/tmp/id_runtime-cert.pub".into()),
            identity: Some("alice@example.com".into()),
            provider: Some("google".into()),
            created_at: None,
            expires_at: Some(expires_at),
            algorithm: Some("ssh-ed25519".into()),
            fingerprint: Some("SHA256:abc".into()),
        });

        assert_eq!(key.id, "runtime-key");
        assert_eq!(key.provider.as_deref(), Some("google"));
        assert_eq!(key.expires_at, Some(expires_at));
        assert!(!key.is_expired);
    }
}
