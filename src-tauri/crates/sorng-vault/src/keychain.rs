//! Cross-platform keychain/credential-store abstraction.
//!
//! Dispatches to the platform-specific back-end and provides a clean
//! async API for rest of the application.

use crate::types::*;

// ── Platform dispatch helpers ───────────────────────────────────────

fn plat_store(service: &str, account: &str, secret: &[u8]) -> VaultResult<()> {
    #[cfg(target_os = "windows")]
    {
        sorng_vault_windows::store_secret(service, account, secret).map_err(VaultError::platform)
    }
    #[cfg(target_os = "macos")]
    {
        crate::platform::macos::store_secret(service, account, secret)
    }
    #[cfg(target_os = "linux")]
    {
        crate::platform::linux::store_secret(service, account, secret)
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        crate::platform::fallback::store_secret(service, account, secret)
    }
}

fn plat_read(service: &str, account: &str) -> VaultResult<Vec<u8>> {
    #[cfg(target_os = "windows")]
    {
        sorng_vault_windows::read_secret(service, account).map_err(VaultError::platform)
    }
    #[cfg(target_os = "macos")]
    {
        crate::platform::macos::read_secret(service, account)
    }
    #[cfg(target_os = "linux")]
    {
        crate::platform::linux::read_secret(service, account)
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        crate::platform::fallback::read_secret(service, account)
    }
}

fn plat_delete(service: &str, account: &str) -> VaultResult<()> {
    #[cfg(target_os = "windows")]
    {
        sorng_vault_windows::delete_secret(service, account).map_err(VaultError::platform)
    }
    #[cfg(target_os = "macos")]
    {
        crate::platform::macos::delete_secret(service, account)
    }
    #[cfg(target_os = "linux")]
    {
        crate::platform::linux::delete_secret(service, account)
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        crate::platform::fallback::delete_secret(service, account)
    }
}

fn plat_available() -> bool {
    #[cfg(target_os = "windows")]
    {
        sorng_vault_windows::is_available()
    }
    #[cfg(target_os = "macos")]
    {
        crate::platform::macos::is_available()
    }
    #[cfg(target_os = "linux")]
    {
        crate::platform::linux::is_available()
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        crate::platform::fallback::is_available()
    }
}

fn plat_backend_name() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        sorng_vault_windows::backend_name()
    }
    #[cfg(target_os = "macos")]
    {
        crate::platform::macos::backend_name()
    }
    #[cfg(target_os = "linux")]
    {
        crate::platform::linux::backend_name()
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        crate::platform::fallback::backend_name()
    }
}

/// Count vault entries for the given service name.
fn plat_count(service: &str) -> usize {
    #[cfg(target_os = "windows")]
    {
        sorng_vault_windows::count_entries(service).unwrap_or(0)
    }
    #[cfg(target_os = "macos")]
    {
        let _ = service;
        0 // macOS Keychain enumeration requires Security framework queries
    }
    #[cfg(target_os = "linux")]
    {
        let _ = service;
        0 // Linux Secret Service enumeration requires libsecret collection listing
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        let _ = service;
        0
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Public API
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Store a UTF-8 string secret in the OS vault.
pub async fn store(service: &str, account: &str, secret: &str) -> VaultResult<()> {
    let service = service.to_owned();
    let account = account.to_owned();
    let secret = secret.as_bytes().to_vec();
    tokio::task::spawn_blocking(move || plat_store(&service, &account, &secret))
        .await
        .map_err(|e| VaultError::internal(format!("spawn_blocking: {e}")))?
}

/// Store raw bytes in the OS vault.
pub async fn store_bytes(service: &str, account: &str, secret: &[u8]) -> VaultResult<()> {
    let service = service.to_owned();
    let account = account.to_owned();
    let secret = secret.to_vec();
    tokio::task::spawn_blocking(move || plat_store(&service, &account, &secret))
        .await
        .map_err(|e| VaultError::internal(format!("spawn_blocking: {e}")))?
}

/// Read a secret as UTF-8 string from the OS vault.
pub async fn read(service: &str, account: &str) -> VaultResult<String> {
    let bytes = read_bytes(service, account).await?;
    String::from_utf8(bytes)
        .map_err(|e| VaultError::serde(format!("Secret is not valid UTF-8: {e}")))
}

/// Read raw bytes from the OS vault.
pub async fn read_bytes(service: &str, account: &str) -> VaultResult<Vec<u8>> {
    let service = service.to_owned();
    let account = account.to_owned();
    tokio::task::spawn_blocking(move || plat_read(&service, &account))
        .await
        .map_err(|e| VaultError::internal(format!("spawn_blocking: {e}")))?
}

/// Delete a secret from the OS vault.
pub async fn delete(service: &str, account: &str) -> VaultResult<()> {
    let service = service.to_owned();
    let account = account.to_owned();
    tokio::task::spawn_blocking(move || plat_delete(&service, &account))
        .await
        .map_err(|e| VaultError::internal(format!("spawn_blocking: {e}")))?
}

/// Is the vault backend available on this platform?
pub fn is_available() -> bool {
    plat_available()
}

/// Human name of the current vault backend.
pub fn backend_name() -> &'static str {
    plat_backend_name()
}

/// Get overall vault status.
pub async fn status() -> VaultResult<VaultStatus> {
    let available = is_available();
    let backend = backend_name().to_string();
    let entry_count = tokio::task::spawn_blocking(|| plat_count(SERVICE_NAME))
        .await
        .map_err(|e| VaultError::internal(format!("spawn_blocking: {e}")))?;
    Ok(VaultStatus {
        available,
        backend,
        entry_count,
        biometric_enabled: sorng_biometrics::availability::is_available().await,
        message: if available {
            Some("Vault is ready".into())
        } else {
            Some("Vault backend is not available".into())
        },
    })
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Convenience: store/read the master DEK
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Generate a random 256-bit data-encryption key and store it in the vault.
pub async fn generate_and_store_dek() -> VaultResult<Vec<u8>> {
    let mut dek = [0u8; 32];
    rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut dek);
    store_bytes(SERVICE_NAME, MASTER_DEK_ACCOUNT, &dek).await?;
    Ok(dek.to_vec())
}

/// Read the master DEK from the vault.  Returns `Err(NotFound)` if
/// no DEK has been stored yet.
pub async fn read_dek() -> VaultResult<Vec<u8>> {
    read_bytes(SERVICE_NAME, MASTER_DEK_ACCOUNT).await
}

/// Read-or-create: returns the existing DEK, or generates a new one.
pub async fn ensure_dek() -> VaultResult<Vec<u8>> {
    match read_dek().await {
        Ok(dek) => Ok(dek),
        Err(_) => generate_and_store_dek().await,
    }
}
