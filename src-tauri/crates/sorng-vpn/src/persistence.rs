//! Persistence layer for VPN/proxy services.
//!
//! Provides a trait for services to save/load their connection definitions
//! to/from encrypted storage via `sorng-storage`.

use async_trait::async_trait;
use serde::de::DeserializeOwned;
use serde::Serialize;

/// Merge one secret-bearing field from an IPC update without treating an
/// omitted or blank editor value as deletion. A non-blank submitted value is
/// an explicit replacement; deletion requires its separate clear flag.
pub(crate) fn merge_secret_update(
    stored: &Option<String>,
    submitted: &mut Option<String>,
    clear: bool,
    field_label: &str,
) -> Result<(), String> {
    let replacement = submitted.take().filter(|value| !value.trim().is_empty());
    if clear && replacement.is_some() {
        return Err(format!(
            "Cannot replace and clear {field_label} in the same update"
        ));
    }
    *submitted = if clear {
        None
    } else {
        replacement.or_else(|| stored.clone())
    };
    Ok(())
}

/// Current on-disk schema for per-provider profile definitions.
pub const PROFILE_SCHEMA_VERSION: u32 = 1;

const PROFILE_SERIALIZATION_FAILED: &str = "VPN profile save failed: profile serialization failed";
const PROFILE_STORAGE_WRITE_FAILED: &str = "VPN profile save failed: storage write failed";
const PROFILE_RESTORE_CORRUPT: &str =
    "VPN profile restore failed: stored data is corrupt or incompatible";
const PROFILE_RESTORE_FUTURE_SCHEMA: &str =
    "VPN profile restore failed: stored data uses a newer schema";
const PROFILE_RESTORE_UNREADABLE: &str = "VPN profile restore failed: storage is unreadable";

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

/// Secret-safe classification for restore failures that may be logged or
/// displayed. Raw storage and serde errors are deliberately discarded at the
/// persistence boundary because they can contain paths or profile content.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RestoreFailureClass {
    Corrupt,
    FutureSchema,
    Unreadable,
}

impl RestoreFailureClass {
    pub fn as_log_label(self) -> &'static str {
        match self {
            Self::Corrupt => "corrupt",
            Self::FutureSchema => "future-schema",
            Self::Unreadable => "unreadable",
        }
    }

    fn safe_message(self) -> &'static str {
        match self {
            Self::Corrupt => PROFILE_RESTORE_CORRUPT,
            Self::FutureSchema => PROFILE_RESTORE_FUTURE_SCHEMA,
            Self::Unreadable => PROFILE_RESTORE_UNREADABLE,
        }
    }
}

/// Classify an already-sanitized provider restore error for fixed-field logs.
/// Provider wrappers may add their own safe context, so markers are matched
/// within the message. Unknown failures remain fail-closed as corrupt data.
pub fn classify_restore_failure(error: &str) -> RestoreFailureClass {
    if error.contains(PROFILE_RESTORE_FUTURE_SCHEMA) {
        RestoreFailureClass::FutureSchema
    } else if error.contains(PROFILE_RESTORE_UNREADABLE) {
        RestoreFailureClass::Unreadable
    } else {
        RestoreFailureClass::Corrupt
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum StorageReadFailureClass {
    Locked,
    Unreadable,
}

fn classify_storage_read_failure(error: &str) -> StorageReadFailureClass {
    let lower = error.to_ascii_lowercase();
    if lower.contains("encryption state is locked") || lower.contains("database is encrypted") {
        StorageReadFailureClass::Locked
    } else {
        StorageReadFailureClass::Unreadable
    }
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
    .map_err(|_| PROFILE_SERIALIZATION_FAILED.to_string())
}

/// Deserialize the current envelope and the two shapes used by development
/// builds before persistence was fully wired (a raw array or an id-keyed map).
/// Unsupported future schemas fail closed so an older binary cannot overwrite
/// newer profile data.
pub fn deserialize_profile_definitions<T: DeserializeOwned>(data: &str) -> Result<Vec<T>, String> {
    let value: serde_json::Value =
        serde_json::from_str(data).map_err(|_| PROFILE_RESTORE_CORRUPT.to_string())?;

    match value {
        serde_json::Value::Array(items) => serde_json::from_value(serde_json::Value::Array(items))
            .map_err(|_| PROFILE_RESTORE_CORRUPT.to_string()),
        serde_json::Value::Object(mut object) => {
            if let Some(connections) = object.remove("connections") {
                let version = object
                    .remove("schema_version")
                    .or_else(|| object.remove("version"))
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                if version > u64::from(PROFILE_SCHEMA_VERSION) {
                    return Err(PROFILE_RESTORE_FUTURE_SCHEMA.to_string());
                }
                serde_json::from_value(connections).map_err(|_| PROFILE_RESTORE_CORRUPT.to_string())
            } else {
                // Compatibility with the short-lived id-keyed HashMap shape.
                let values = object.into_values().collect::<Vec<_>>();
                serde_json::from_value(serde_json::Value::Array(values))
                    .map_err(|_| PROFILE_RESTORE_CORRUPT.to_string())
            }
        }
        _ => Err(PROFILE_RESTORE_CORRUPT.to_string()),
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
    let data = service
        .serialize_definitions()
        .map_err(|_| PROFILE_SERIALIZATION_FAILED.to_string())?;
    let storage = storage.lock().await;
    storage
        .write_app_data(key, &data)
        .await
        .map_err(|_| PROFILE_STORAGE_WRITE_FAILED.to_string())
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
            if let Err(error) = service.deserialize_definitions(&data) {
                let class = classify_restore_failure(&error);
                log::warn!(
                    "Persisted VPN profile data failed validation; classification={}",
                    class.as_log_label()
                );
                return Err(class.safe_message().to_string());
            }
            log::info!("Loaded persisted data for '{}'", key);
            Ok(RestoreOutcome::Loaded)
        }
        Ok(None) => {
            log::debug!("No persisted data found for '{}'", key);
            Ok(RestoreOutcome::Missing)
        }
        Err(error) => match classify_storage_read_failure(&error) {
            StorageReadFailureClass::Locked => {
                log::debug!("Persisted VPN profile data is locked; restore deferred");
                Ok(RestoreOutcome::Locked)
            }
            StorageReadFailureClass::Unreadable => {
                log::warn!("Persisted VPN profile storage is unreadable");
                Err(PROFILE_RESTORE_UNREADABLE.to_string())
            }
        },
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

    struct TestService {
        loaded: bool,
    }

    #[async_trait::async_trait]
    impl Persistable for TestService {
        fn storage_key(&self) -> &'static str {
            "vpn_test_profiles"
        }

        fn serialize_definitions(&self) -> Result<String, String> {
            serialize_profile_definitions(&[profile()])
        }

        fn deserialize_definitions(&mut self, data: &str) -> Result<(), String> {
            let _: Vec<TestProfile> = deserialize_profile_definitions(data)?;
            self.loaded = true;
            Ok(())
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
        let secret = "TOP-SECRET-PROFILE-MARKER-9f6f";
        let future = serde_json::json!({
            "schema_version": PROFILE_SCHEMA_VERSION + 1,
            "connections": [{ "id": secret, "name": "Future" }]
        })
        .to_string();
        let future_error = deserialize_profile_definitions::<TestProfile>(&future).unwrap_err();
        assert_eq!(
            classify_restore_failure(&future_error),
            RestoreFailureClass::FutureSchema
        );
        assert!(!future_error.contains(secret));

        let malformed = format!("{{\"profile\":\"{secret}\"");
        let corrupt_error = deserialize_profile_definitions::<TestProfile>(&malformed).unwrap_err();
        assert_eq!(
            classify_restore_failure(&corrupt_error),
            RestoreFailureClass::Corrupt
        );
        assert!(!corrupt_error.contains(secret));
    }

    #[test]
    fn raw_storage_failures_are_reduced_to_secret_safe_categories() {
        let secret = "TOP-SECRET-STORAGE-PATH-4d3a";
        let unreadable = format!("permission denied reading C:/private/{secret}/storage.json");
        let unreadable_class = classify_storage_read_failure(&unreadable);
        assert_eq!(unreadable_class, StorageReadFailureClass::Unreadable);

        let safe = RestoreFailureClass::Unreadable.safe_message();
        let log_label = RestoreFailureClass::Unreadable.as_log_label();
        assert!(!safe.contains(secret));
        assert!(!log_label.contains(secret));

        let locked = format!("encryption state is locked near {secret}");
        assert_eq!(
            classify_storage_read_failure(&locked),
            StorageReadFailureClass::Locked
        );
        assert!(!format!("{:?}", StorageReadFailureClass::Locked).contains(secret));
    }

    #[tokio::test]
    async fn load_boundary_does_not_return_malformed_profile_content() {
        let secret = "TOP-SECRET-RESTORE-PAYLOAD-b17e";
        let root = std::env::temp_dir().join(format!(
            "sorng-vpn-persistence-test-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let storage = sorng_storage::storage::SecureStorage::new(
            root.join("storage.json").to_string_lossy().to_string(),
        );
        let malformed = format!("{{\"profile\":\"{secret}\"");
        storage
            .lock()
            .await
            .write_app_data("vpn_test_profiles", &malformed)
            .await
            .unwrap();

        let mut service = TestService { loaded: false };
        let error = load_service_data(&mut service, &storage).await.unwrap_err();
        assert_eq!(
            classify_restore_failure(&error),
            RestoreFailureClass::Corrupt
        );
        assert!(!error.contains(secret));
        assert!(!service.loaded);
        drop(storage);
        std::fs::remove_dir_all(root).unwrap();
    }
}
