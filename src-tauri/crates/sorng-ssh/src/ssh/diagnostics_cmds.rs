use super::diagnostics::*;

/// Retrieve the host key information for an active SSH session.
#[tauri::command]
pub async fn get_ssh_host_key_info(
    state: tauri::State<'_, SshServiceState>,
    session_id: String,
) -> Result<SshHostKeyInfo, String> {
    let guard = state.lock().await;
    let ssh_session = guard
        .sessions
        .get(&session_id)
        .ok_or_else(|| format!("Session {} not found", session_id))?;

    let (raw_key, host_key_type) = ssh_session
        .session
        .host_key()
        .ok_or("No host key available for this session")?;

    // SHA-256 fingerprint
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(raw_key);
    let fingerprint = hex::encode(hasher.finalize());

    let key_type_str = match host_key_type {
        ssh2::HostKeyType::Rsa => "ssh-rsa",
        ssh2::HostKeyType::Dss => "ssh-dss",
        ssh2::HostKeyType::Ecdsa256 => "ecdsa-sha2-nistp256",
        ssh2::HostKeyType::Ecdsa384 => "ecdsa-sha2-nistp384",
        ssh2::HostKeyType::Ecdsa521 => "ecdsa-sha2-nistp521",
        ssh2::HostKeyType::Ed25519 => "ssh-ed25519",
        _ => "unknown",
    };

    let key_bits: Option<u32> = match host_key_type {
        ssh2::HostKeyType::Rsa => Some((raw_key.len() as u32).saturating_mul(8)),
        ssh2::HostKeyType::Ed25519 => Some(256),
        ssh2::HostKeyType::Ecdsa256 => Some(256),
        ssh2::HostKeyType::Ecdsa384 => Some(384),
        ssh2::HostKeyType::Ecdsa521 => Some(521),
        _ => None,
    };

    let public_key = Some(base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        raw_key,
    ));

    Ok(SshHostKeyInfo {
        fingerprint,
        key_type: Some(key_type_str.to_string()),
        key_bits,
        public_key,
    })
}

/// Run a deep diagnostic probe against an SSH server.
///
/// Steps:
///   1. DNS Resolution (multi-address)
///   2. TCP Connect
///   3. SSH Banner / Protocol Version
///   4. Key Exchange (handshake)
///   5. Host Key Verification
///   6. Authentication Methods Discovery
///   7. Authentication Test
#[tauri::command]
pub async fn diagnose_ssh_connection(
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    private_key_path: Option<String>,
    private_key_passphrase: Option<String>,
    connect_timeout_secs: Option<u64>,
) -> Result<DiagnosticReport, String> {
    let h = host.clone();
    tokio::task::spawn_blocking(move || {
        run_ssh_diagnostics(
            &h,
            port,
            &username,
            password.as_deref(),
            private_key_path.as_deref(),
            private_key_passphrase.as_deref(),
            connect_timeout_secs.unwrap_or(10),
        )
    })
    .await
    .map_err(|e| format!("SSH diagnostic task panicked: {e}"))
}
