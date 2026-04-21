//! Linux strongSwan helper for IPsec-based VPN protocols.
//! Provides shared functions for IKEv2, IPsec, and L2TP/IPsec connections.

/// Write an ipsec.conf connection block.
#[cfg(not(windows))]
pub async fn write_ipsec_conf(
    conn_name: &str,
    server: &str,
    local_id: Option<&str>,
    remote_id: Option<&str>,
    auth_method: &str, // "psk", "pubkey", "eap-mschapv2"
    phase1: Option<&str>,
    phase2: Option<&str>,
) -> Result<String, String> {
    let config_path = format!("/etc/ipsec.d/sorng_{}.conf", conn_name);
    let local_id_str = local_id.unwrap_or("%any");
    let remote_id_str = remote_id.unwrap_or(server);
    let ike_str = phase1.unwrap_or("aes256-sha256-modp2048");
    let esp_str = phase2.unwrap_or("aes256-sha256");

    let config = format!(
        r#"conn {conn_name}
    type=tunnel
    left=%defaultroute
    leftid={local_id}
    leftauth={auth_method}
    right={server}
    rightid={remote_id}
    rightauth={auth_method}
    ike={ike}
    esp={esp}
    keyexchange=ikev2
    auto=add
"#,
        conn_name = conn_name,
        local_id = local_id_str,
        auth_method = auth_method,
        server = server,
        remote_id = remote_id_str,
        ike = ike_str,
        esp = esp_str,
    );

    tokio::fs::write(&config_path, &config)
        .await
        .map_err(|e| format!("Failed to write ipsec config: {}", e))?;

    Ok(config_path)
}

/// Write an ipsec.secrets entry for PSK or EAP authentication.
#[cfg(not(windows))]
pub async fn write_ipsec_secrets(
    conn_name: &str,
    local_id: Option<&str>,
    remote_id: &str,
    secret_type: &str, // "PSK", "EAP", "RSA"
    secret_value: &str,
) -> Result<String, String> {
    let secrets_path = format!("/etc/ipsec.d/sorng_{}.secrets", conn_name);
    let local = local_id.unwrap_or("%any");

    let content = match secret_type {
        "PSK" => format!("{} {} : PSK \"{}\"\n", local, remote_id, secret_value),
        "EAP" => format!("{} : EAP \"{}\"\n", local, secret_value),
        "RSA" => format!(": RSA {}\n", secret_value),
        _ => return Err(format!("Unknown secret type: {}", secret_type)),
    };

    tokio::fs::write(&secrets_path, &content)
        .await
        .map_err(|e| format!("Failed to write ipsec secrets: {}", e))?;

    Ok(secrets_path)
}

/// Bring up an IPsec connection via `ipsec up`.
#[cfg(not(windows))]
pub async fn ipsec_up(conn_name: &str) -> Result<(), String> {
    // Reload secrets and configs first
    let ipsec_binary =
        platform::resolve_binary("ipsec").map_err(|e| format!("ipsec not found: {}", e))?;

    let _ = tokio::process::Command::new(&ipsec_binary)
        .args(["reload"])
        .output()
        .await;

    let _ = tokio::process::Command::new(&ipsec_binary)
        .args(["rereadsecrets"])
        .output()
        .await;

    let output = tokio::process::Command::new(&ipsec_binary)
        .args(["up", conn_name])
        .output()
        .await
        .map_err(|e| format!("ipsec up error: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ipsec up failed: {}", stderr));
    }
    Ok(())
}

/// Bring down an IPsec connection via `ipsec down`.
#[cfg(not(windows))]
pub async fn ipsec_down(conn_name: &str) -> Result<(), String> {
    let ipsec_binary =
        platform::resolve_binary("ipsec").map_err(|e| format!("ipsec not found: {}", e))?;

    let output = tokio::process::Command::new(ipsec_binary)
        .args(["down", conn_name])
        .output()
        .await
        .map_err(|e| format!("ipsec down error: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ipsec down failed: {}", stderr));
    }
    Ok(())
}

/// Remove IPsec config and secrets files for a connection.
#[cfg(not(windows))]
pub async fn cleanup_ipsec_files(conn_name: &str) -> Result<(), String> {
    let config_path = format!("/etc/ipsec.d/sorng_{}.conf", conn_name);
    let secrets_path = format!("/etc/ipsec.d/sorng_{}.secrets", conn_name);

    let _ = tokio::fs::remove_file(&config_path).await;
    let _ = tokio::fs::remove_file(&secrets_path).await;

    // Reload ipsec to pick up the removal
    if let Ok(ipsec_binary) = platform::resolve_binary("ipsec") {
        let _ = tokio::process::Command::new(ipsec_binary)
            .args(["reload"])
            .output()
            .await;
    }
    Ok(())
}

/// Check if an IPsec connection is active.
#[cfg(not(windows))]
pub async fn is_ipsec_active(conn_name: &str) -> Result<bool, String> {
    let ipsec_binary =
        platform::resolve_binary("ipsec").map_err(|e| format!("ipsec not found: {}", e))?;

    let output = tokio::process::Command::new(ipsec_binary)
        .args(["status", conn_name])
        .output()
        .await
        .map_err(|e| format!("ipsec status error: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(stdout.contains("ESTABLISHED") || stdout.contains("INSTALLED"))
}

// Windows stubs (strongSwan is Linux-only; Windows uses RAS API)
#[cfg(windows)]
pub async fn write_ipsec_conf(
    _: &str,
    _: &str,
    _: Option<&str>,
    _: Option<&str>,
    _: &str,
    _: Option<&str>,
    _: Option<&str>,
) -> Result<String, String> {
    Err("strongSwan is not available on Windows. Use the Windows RAS API.".to_string())
}
#[cfg(windows)]
pub async fn write_ipsec_secrets(
    _: &str,
    _: Option<&str>,
    _: &str,
    _: &str,
    _: &str,
) -> Result<String, String> {
    Err("strongSwan is not available on Windows.".to_string())
}
#[cfg(windows)]
pub async fn ipsec_up(_: &str) -> Result<(), String> {
    Err("strongSwan is not available on Windows.".to_string())
}
#[cfg(windows)]
pub async fn ipsec_down(_: &str) -> Result<(), String> {
    Err("strongSwan is not available on Windows.".to_string())
}
#[cfg(windows)]
pub async fn cleanup_ipsec_files(_: &str) -> Result<(), String> {
    Ok(())
}
#[cfg(windows)]
pub async fn is_ipsec_active(_: &str) -> Result<bool, String> {
    Ok(false)
}
