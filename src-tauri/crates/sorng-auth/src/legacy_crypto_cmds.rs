use super::legacy_crypto::*;

/// Get the current legacy crypto policy.
#[tauri::command]
pub async fn get_legacy_crypto_policy(
    state: tauri::State<'_, LegacyCryptoPolicyState>,
) -> Result<LegacyCryptoPolicy, String> {
    Ok(state.lock().await.clone())
}

/// Update the legacy crypto policy.
#[tauri::command]
pub async fn set_legacy_crypto_policy(
    state: tauri::State<'_, LegacyCryptoPolicyState>,
    policy: LegacyCryptoPolicy,
) -> Result<(), String> {
    let mut current = state.lock().await;
    *current = policy;
    Ok(())
}

/// Get warnings for currently enabled legacy options.
#[tauri::command]
pub async fn get_legacy_crypto_warnings(
    state: tauri::State<'_, LegacyCryptoPolicyState>,
) -> Result<Vec<LegacyWarning>, String> {
    Ok(state.lock().await.active_legacy_warnings())
}

/// Get the SSH cipher list derived from the current policy.
#[tauri::command]
pub async fn get_legacy_ssh_ciphers(
    state: tauri::State<'_, LegacyCryptoPolicyState>,
) -> Result<Vec<String>, String> {
    Ok(state
        .lock()
        .await
        .ssh_ciphers()
        .into_iter()
        .map(String::from)
        .collect())
}

/// Get the SSH KEX list derived from the current policy.
#[tauri::command]
pub async fn get_legacy_ssh_kex(
    state: tauri::State<'_, LegacyCryptoPolicyState>,
) -> Result<Vec<String>, String> {
    Ok(state
        .lock()
        .await
        .ssh_kex()
        .into_iter()
        .map(String::from)
        .collect())
}

/// Get the SSH MAC list derived from the current policy.
#[tauri::command]
pub async fn get_legacy_ssh_macs(
    state: tauri::State<'_, LegacyCryptoPolicyState>,
) -> Result<Vec<String>, String> {
    Ok(state
        .lock()
        .await
        .ssh_macs()
        .into_iter()
        .map(String::from)
        .collect())
}

/// Get the SSH host-key algorithm list derived from the current policy.
#[tauri::command]
pub async fn get_legacy_ssh_host_key_algorithms(
    state: tauri::State<'_, LegacyCryptoPolicyState>,
) -> Result<Vec<String>, String> {
    Ok(state
        .lock()
        .await
        .ssh_host_key_algorithms()
        .into_iter()
        .map(String::from)
        .collect())
}

/// Check whether a specific key algorithm is currently allowed.
#[tauri::command]
pub async fn is_legacy_algorithm_allowed(
    state: tauri::State<'_, LegacyCryptoPolicyState>,
    algorithm: String,
) -> Result<bool, String> {
    let policy = state.lock().await;
    let allowed = match algorithm.to_lowercase().as_str() {
        "rsa1024" | "rsa-1024" => policy.legacy_mode_acknowledged && policy.allow_rsa_1024,
        "dsa" | "dss" | "ssh-dss" => policy.legacy_mode_acknowledged && policy.allow_dsa,
        "sha1" | "sha-1" => policy.legacy_mode_acknowledged && policy.allow_sha1_signatures,
        "3des" | "3des-cbc" => policy.legacy_mode_acknowledged && policy.allow_3des,
        "arcfour" | "rc4" => policy.legacy_mode_acknowledged && policy.allow_arcfour,
        "blowfish" | "blowfish-cbc" => policy.legacy_mode_acknowledged && policy.allow_blowfish,
        "cast128" | "cast128-cbc" => policy.legacy_mode_acknowledged && policy.allow_cast128,
        "cbc" => policy.legacy_mode_acknowledged && policy.allow_cbc_ciphers,
        "dh-group1-sha1" => policy.legacy_mode_acknowledged && policy.allow_dh_group1_sha1,
        "dh-group14-sha1" => policy.legacy_mode_acknowledged && policy.allow_dh_group14_sha1,
        "hmac-sha1" => policy.legacy_mode_acknowledged && policy.allow_hmac_sha1,
        "hmac-md5" => policy.legacy_mode_acknowledged && policy.allow_hmac_md5,
        "ssl3" | "ssl3.0" | "ssl30" | "sslv3" => {
            policy.legacy_mode_acknowledged && policy.allow_ssl_3_0
        }
        "tls1.0" | "tls10" => policy.legacy_mode_acknowledged && policy.allow_tls_1_0,
        "tls1.1" | "tls11" => policy.legacy_mode_acknowledged && policy.allow_tls_1_1,
        _ => false,
    };
    Ok(allowed)
}

