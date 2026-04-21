//! Persistence layer for VPN/proxy services.
//!
//! Provides a trait for services to save/load their connection definitions
//! to/from encrypted storage via `sorng-storage`.

use async_trait::async_trait;

/// Trait for services that can persist their connection definitions.
///
/// Implementors define a storage key and serialization logic.
/// The persistence layer handles encryption and atomic writes via `sorng-storage`.
#[async_trait]
pub trait Persistable: Send {
    /// The storage key used for this service's data.
    fn storage_key(&self) -> &'static str;

    /// Serialize connection definitions to a JSON string.
    ///
    /// Should only include configuration data, NOT runtime state
    /// (process IDs, connected status, local IPs, etc.).
    fn serialize_definitions(&self) -> Result<String, String>;

    /// Deserialize and restore connection definitions from a JSON string.
    fn deserialize_definitions(&mut self, data: &str) -> Result<(), String>;
}

/// Save a service's definitions to storage.
///
/// Uses the `write_app_data` pattern (key-value on StorageData.app_data).
pub async fn save_service_data<S: Persistable>(
    service: &S,
    storage: &sorng_storage::storage::SecureStorageState,
) -> Result<(), String> {
    let key = service.storage_key();
    let data = service.serialize_definitions()?;
    let storage = storage.lock().await;
    storage
        .write_app_data(key, &data)
        .await
        .map_err(|e| format!("Failed to persist {}: {}", key, e))
}

/// Load a service's definitions from storage.
///
/// Returns Ok(true) if data was loaded, Ok(false) if no saved data exists.
pub async fn load_service_data<S: Persistable>(
    service: &mut S,
    storage: &sorng_storage::storage::SecureStorageState,
) -> Result<bool, String> {
    let key = service.storage_key();
    let storage = storage.lock().await;
    match storage.read_app_data(key).await {
        Ok(Some(data)) => {
            service.deserialize_definitions(&data)?;
            log::info!("Loaded persisted data for '{}'", key);
            Ok(true)
        }
        Ok(None) => {
            log::debug!("No persisted data found for '{}'", key);
            Ok(false)
        }
        Err(e) => {
            log::warn!("Failed to load persisted data for '{}': {}", key, e);
            Err(format!("Failed to load {}: {}", key, e))
        }
    }
}

/// Storage keys for each service type.
pub mod keys {
    pub const OPENVPN: &str = "vpn_openvpn";
    pub const WIREGUARD: &str = "vpn_wireguard";
    pub const TAILSCALE: &str = "vpn_tailscale";
    pub const ZEROTIER: &str = "vpn_zerotier";
    pub const PPTP: &str = "vpn_pptp";
    pub const L2TP: &str = "vpn_l2tp";
    pub const IKEV2: &str = "vpn_ikev2";
    pub const IPSEC: &str = "vpn_ipsec";
    pub const SSTP: &str = "vpn_sstp";
    pub const PROXY: &str = "proxy_connections";
    pub const UNIFIED_CHAINS: &str = "unified_chains";
    pub const LAYER_PROFILES: &str = "layer_profiles";
}
