//! Persistence layer for VPN/proxy services.
//!
//! Provides a trait for services to save/load their connection definitions
//! to/from encrypted storage via `sorng-storage`.

use async_trait::async_trait;
use serde::de::DeserializeOwned;
use serde::Serialize;

/// Current on-disk schema for per-provider profile definitions.
pub const PROFILE_SCHEMA_VERSION: u32 = 1;

/// Result of attempting to restore a provider's profile definitions.
///
/// Locked storage is intentionally not an error: password/hybrid installs
/// start before the user has supplied the master password. Callers keep their
/// service in the "not loaded" state and retry after unlock.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RestoreOutcome {
    Loaded,
    Missing,
    Locked,
}

#[derive(Serialize)]
struct ProfileEnvelope<'a, T> {
    schema_version: u32,
    connections: &'a [T],
}

/// Serialize provider definitions in a versioned envelope.
pub fn serialize_profile_definitions<T: Serialize>(connections: &[T]) -> Result<String, String> {
    serde_json::to_string(&ProfileEnvelope {
        schema_version: PROFILE_SCHEMA_VERSION,
        connections,
    })
    .map_err(|e| format!("Failed to serialize VPN profile definitions: {e}"))
}

/// Deserialize the current envelope and the two shapes used by development
/// builds before persistence was fully wired (a raw array or an id-keyed map).
/// Unsupported future schemas fail closed so an older binary cannot overwrite
/// newer profile data.
pub fn deserialize_profile_definitions<T: DeserializeOwned>(data: &str) -> Result<Vec<T>, String> {
    let value: serde_json::Value = serde_json::from_str(data)
        .map_err(|e| format!("VPN profile data is not valid JSON: {e}"))?;

    match value {
        serde_json::Value::Array(items) => serde_json::from_value(serde_json::Value::Array(items))
            .map_err(|e| format!("Legacy VPN profile data is invalid: {e}")),
        serde_json::Value::Object(mut object) => {
            if let Some(connections) = object.remove("connections") {
                let version = object
                    .remove("schema_version")
                    .or_else(|| object.remove("version"))
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                if version > u64::from(PROFILE_SCHEMA_VERSION) {
                    return Err(format!(
                        "VPN profile schema {version} is newer than supported schema {}",
                        PROFILE_SCHEMA_VERSION
                    ));
                }
                serde_json::from_value(connections)
                    .map_err(|e| format!("VPN profile definitions are invalid: {e}"))
            } else {
                // Compatibility with the short-lived id-keyed HashMap shape.
                let values = object.into_values().collect::<Vec<_>>();
                serde_json::from_value(serde_json::Value::Array(values))
                    .map_err(|e| format!("Legacy VPN profile map is invalid: {e}"))
            }
        }
        _ => Err("VPN profile data must be an object or array".to_string()),
    }
}

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
) -> Result<RestoreOutcome, String> {
    let key = service.storage_key();
    let storage = storage.lock().await;
    match storage.read_app_data(key).await {
        Ok(Some(data)) => {
            service.deserialize_definitions(&data)?;
            log::info!("Loaded persisted data for '{}'", key);
            Ok(RestoreOutcome::Loaded)
        }
        Ok(None) => {
            log::debug!("No persisted data found for '{}'", key);
            Ok(RestoreOutcome::Missing)
        }
        Err(e) => {
            let lower = e.to_ascii_lowercase();
            if lower.contains("unlock")
                || lower.contains("encryption state is locked")
                || lower.contains("database is encrypted")
            {
                log::debug!("Persisted data for '{}' is locked; restore deferred", key);
                return Ok(RestoreOutcome::Locked);
            }
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde::{Deserialize, Serialize};

    #[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
    struct TestProfile {
        id: String,
        name: String,
    }

    fn profile() -> TestProfile {
        TestProfile {
            id: "stable-id".to_string(),
            name: "Office".to_string(),
        }
    }

    #[test]
    fn versioned_profile_envelope_round_trips() {
        let encoded = serialize_profile_definitions(&[profile()]).unwrap();
        let value: serde_json::Value = serde_json::from_str(&encoded).unwrap();
        assert_eq!(value["schema_version"], PROFILE_SCHEMA_VERSION);

        let decoded: Vec<TestProfile> = deserialize_profile_definitions(&encoded).unwrap();
        assert_eq!(decoded, vec![profile()]);
    }

    #[test]
    fn legacy_array_and_map_shapes_are_migrated() {
        let legacy_array = serde_json::to_string(&vec![profile()]).unwrap();
        let decoded: Vec<TestProfile> = deserialize_profile_definitions(&legacy_array).unwrap();
        assert_eq!(decoded, vec![profile()]);

        let legacy_map = serde_json::json!({ "stable-id": profile() }).to_string();
        let decoded: Vec<TestProfile> = deserialize_profile_definitions(&legacy_map).unwrap();
        assert_eq!(decoded, vec![profile()]);
    }

    #[test]
    fn future_schema_and_corruption_fail_closed() {
        let future = serde_json::json!({
            "schema_version": PROFILE_SCHEMA_VERSION + 1,
            "connections": [profile()]
        })
        .to_string();
        assert!(deserialize_profile_definitions::<TestProfile>(&future).is_err());
        assert!(deserialize_profile_definitions::<TestProfile>("not-json").is_err());
    }
}
