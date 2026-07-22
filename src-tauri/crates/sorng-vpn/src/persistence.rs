//! Persistence layer for VPN/proxy services.
//!
//! Provides a trait for services to save/load their connection definitions
//! to/from encrypted storage via `sorng-storage`.

use async_trait::async_trait;
use serde::de::DeserializeOwned;
use serde::Serialize;

/// Validate IDs before persisted profiles can reach provider code that derives
/// deterministic OS artifact names from the UUID prefix. The error is fixed
/// text so malformed persisted content is never reflected into logs or IPC.
pub(crate) fn validate_persisted_profile_id(id: &str, provider: &str) -> Result<(), String> {
    uuid::Uuid::parse_str(id)
        .map(|_| ())
        .map_err(|_| format!("{provider} profile has an invalid id"))
}

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

#[cfg(test)]
mod secret_update_tests {
    use super::{merge_secret_update, validate_persisted_profile_id};

    #[test]
    fn secret_updates_are_tri_state_and_reject_conflicts() {
        let stored = Some("stored-secret".to_string());

        let mut omitted = None;
        merge_secret_update(&stored, &mut omitted, false, "secret").unwrap();
        assert_eq!(omitted.as_deref(), Some("stored-secret"));

        let mut blank = Some("   ".to_string());
        merge_secret_update(&stored, &mut blank, false, "secret").unwrap();
        assert_eq!(blank.as_deref(), Some("stored-secret"));

        let mut replacement = Some("replacement".to_string());
        merge_secret_update(&stored, &mut replacement, false, "secret").unwrap();
        assert_eq!(replacement.as_deref(), Some("replacement"));

        let mut cleared = None;
        merge_secret_update(&stored, &mut cleared, true, "secret").unwrap();
        assert!(cleared.is_none());

        let mut conflict = Some("replacement".to_string());
        assert!(merge_secret_update(&stored, &mut conflict, true, "secret").is_err());
    }

    #[test]
    fn persisted_profile_ids_must_be_uuids_without_echoing_input() {
        let marker = "private-profile-marker";
        let error = validate_persisted_profile_id(marker, "Test").unwrap_err();
        assert_eq!(error, "Test profile has an invalid id");
        assert!(!error.contains(marker));
        validate_persisted_profile_id(&uuid::Uuid::new_v4().to_string(), "Test").unwrap();
    }
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

#[cfg(test)]
mod legacy_provider_tests {
    use super::Persistable;
    use crate::ikev2::{IKEv2Config, IKEv2Service, IKEv2Status};
    use crate::ipsec::{IPsecConfig, IPsecService, IPsecStatus};
    use crate::l2tp::{L2TPConfig, L2TPService, L2TPStatus};
    use crate::pptp::{PPTPConfig, PPTPService, PPTPStatus};
    use crate::routing::VpnRoutingMode;
    use crate::sstp::{SSTPConfig, SSTPService, SSTPStatus};
    use sorng_core::events::{DynEventEmitter, NoopEventEmitter};
    use sorng_encryption::{EncryptionState, MasterDek};
    use std::sync::Arc;

    const SECRET: &str = "LEGACY-VPN-SECRET-AT-REST-7f09";

    fn emitter() -> DynEventEmitter {
        Arc::new(NoopEventEmitter)
    }

    fn temp_root(label: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("sorng-vpn-{label}-{}", uuid::Uuid::new_v4()))
    }

    async fn encryption_state() -> Arc<EncryptionState> {
        let state = EncryptionState::new();
        state
            .install(MasterDek::from_bytes(&[0x51; 32]).expect("valid test DEK"))
            .await;
        Arc::new(state)
    }

    async fn storage_with_state(
        path: &std::path::Path,
        state: Arc<EncryptionState>,
    ) -> sorng_storage::storage::SecureStorageState {
        let storage = sorng_storage::storage::SecureStorage::new(path.to_string_lossy().into());
        storage.lock().await.set_encryption_state(state);
        storage
    }

    fn pptp_config() -> PPTPConfig {
        PPTPConfig {
            server: "pptp.example.com".to_string(),
            username: Some("alice".to_string()),
            password: Some(SECRET.to_string()),
            domain: None,
            require_mppe: None,
            mppe_stateful: None,
            refuse_eap: None,
            refuse_pap: None,
            refuse_chap: None,
            refuse_mschap: None,
            refuse_mschapv2: None,
            nobsdcomp: None,
            nodeflate: None,
            no_vj_comp: None,
            custom_options: vec![],
        }
    }

    fn l2tp_config() -> L2TPConfig {
        L2TPConfig {
            server: "l2tp.example.com".to_string(),
            username: Some("alice".to_string()),
            password: Some(SECRET.to_string()),
            psk: Some(SECRET.to_string()),
            ipsec_ike: None,
            ipsec_esp: None,
            ipsec_pfs: None,
            mru: None,
            mtu: None,
            lcp_echo_interval: None,
            lcp_echo_failure: None,
            require_chap: None,
            refuse_chap: None,
            require_mschap: None,
            refuse_mschap: None,
            require_mschapv2: None,
            refuse_mschapv2: None,
            require_eap: None,
            refuse_eap: None,
            require_pap: None,
            refuse_pap: None,
            ipsec_ikelifetime: None,
            ipsec_lifetime: None,
            ipsec_phase2alg: None,
            custom_options: vec![],
        }
    }

    fn ikev2_config() -> IKEv2Config {
        IKEv2Config {
            server: "ikev2.example.com".to_string(),
            username: Some("alice".to_string()),
            password: Some(SECRET.to_string()),
            certificate: None,
            private_key: Some(SECRET.to_string()),
            ca_certificate: None,
            eap_method: Some("mschapv2".to_string()),
            phase1_algorithms: None,
            phase2_algorithms: None,
            local_id: None,
            remote_id: None,
            fragmentation: None,
            mobike: None,
            routing_mode: VpnRoutingMode::Split,
            remote_subnets: vec!["10.20.0.0/16".to_string(), "2001:db8:42::/48".to_string()],
            custom_options: vec![],
        }
    }

    fn ipsec_config() -> IPsecConfig {
        IPsecConfig {
            server: "ipsec.example.com".to_string(),
            auth_method: Some("psk".to_string()),
            psk: Some(SECRET.to_string()),
            certificate: None,
            private_key: Some(SECRET.to_string()),
            ca_certificate: None,
            phase1_proposals: None,
            phase2_proposals: None,
            sa_lifetime: None,
            dpd_delay: None,
            dpd_timeout: None,
            tunnel_mode: Some(true),
            routing_mode: VpnRoutingMode::Split,
            remote_subnets: vec!["192.0.2.0/24".to_string()],
            custom_options: vec![],
        }
    }

    fn sstp_config() -> SSTPConfig {
        SSTPConfig {
            server: "sstp.example.com".to_string(),
            username: Some("alice".to_string()),
            password: Some(SECRET.to_string()),
            domain: None,
            certificate: None,
            ca_certificate: None,
            ignore_certificate: Some(false),
            proxy_host: None,
            proxy_port: None,
            custom_options: vec![],
        }
    }

    fn corrupt_profile_id(data: &str, id: &str) -> String {
        let mut value: serde_json::Value = serde_json::from_str(data).unwrap();
        value["connections"][0]["id"] = serde_json::Value::String(id.to_string());
        value.to_string()
    }

    fn duplicate_first_profile(data: &str) -> String {
        let mut value: serde_json::Value = serde_json::from_str(data).unwrap();
        let duplicate = value["connections"][0].clone();
        value["connections"].as_array_mut().unwrap().push(duplicate);
        value.to_string()
    }

    macro_rules! assert_corruption_preserves_profiles {
        ($state:expr) => {{
            let mut service = $state.lock().await;
            let before = service.serialize_definitions().unwrap();
            let marker = "PRIVATE-BAD-ID";
            let error = service
                .deserialize_definitions(&corrupt_profile_id(&before, marker))
                .unwrap_err();
            assert!(!error.contains(marker));
            assert_eq!(service.serialize_definitions().unwrap(), before);
            assert!(service
                .deserialize_definitions(&duplicate_first_profile(&before))
                .is_err());
            assert_eq!(service.serialize_definitions().unwrap(), before);
        }};
    }

    #[tokio::test]
    async fn all_legacy_profiles_restart_from_one_encrypted_store_and_remain_redacted() {
        let root = temp_root("encrypted-restart");
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("connections.json");
        let state = encryption_state().await;
        let storage = storage_with_state(&path, state.clone()).await;

        let pptp = PPTPService::new_persistent(emitter(), storage.clone());
        let l2tp = L2TPService::new_persistent(emitter(), storage.clone());
        let ikev2 = IKEv2Service::new_persistent(emitter(), storage.clone());
        let ipsec = IPsecService::new_persistent(emitter(), storage.clone());
        let sstp = SSTPService::new_persistent(emitter(), storage.clone());

        let pptp_id = pptp
            .lock()
            .await
            .create_connection("PPTP".to_string(), pptp_config())
            .await
            .unwrap();
        let l2tp_id = l2tp
            .lock()
            .await
            .create_connection("L2TP".to_string(), l2tp_config())
            .await
            .unwrap();
        let ikev2_id = ikev2
            .lock()
            .await
            .create_connection("IKEv2".to_string(), ikev2_config())
            .await
            .unwrap();
        let ipsec_id = ipsec
            .lock()
            .await
            .create_connection("IPsec".to_string(), ipsec_config())
            .await
            .unwrap();
        let sstp_id = sstp
            .lock()
            .await
            .create_connection("SSTP".to_string(), sstp_config())
            .await
            .unwrap();
        pptp.lock()
            .await
            .update_connection_from_ipc(
                &pptp_id,
                Some("PPTP renamed".to_string()),
                None,
                Default::default(),
            )
            .await
            .unwrap();
        drop((pptp, l2tp, ikev2, ipsec, sstp, storage));

        let bytes = std::fs::read(&path).unwrap();
        assert_eq!(
            &bytes[..sorng_encryption::envelope::MAGIC.len()],
            sorng_encryption::envelope::MAGIC
        );
        assert!(!bytes
            .windows(SECRET.len())
            .any(|window| window == SECRET.as_bytes()));

        let restarted_storage = storage_with_state(&path, state).await;
        let restarted_pptp = PPTPService::new_persistent(emitter(), restarted_storage.clone());
        let restarted_l2tp = L2TPService::new_persistent(emitter(), restarted_storage.clone());
        let restarted_ikev2 = IKEv2Service::new_persistent(emitter(), restarted_storage.clone());
        let restarted_ipsec = IPsecService::new_persistent(emitter(), restarted_storage.clone());
        let restarted_sstp = SSTPService::new_persistent(emitter(), restarted_storage);

        let pptp_view = restarted_pptp
            .lock()
            .await
            .get_connection(&pptp_id)
            .await
            .unwrap()
            .into_redacted_view();
        assert!(pptp_view.secret_presence.password);
        assert_eq!(pptp_view.connection.name, "PPTP renamed");
        assert!(pptp_view.connection.config.password.is_none());
        assert!(matches!(
            pptp_view.connection.status,
            PPTPStatus::Disconnected
        ));
        assert!(pptp_view.connection.connected_at.is_none());
        assert!(pptp_view.connection.ras_entry_name.is_none());

        let l2tp_view = restarted_l2tp
            .lock()
            .await
            .get_connection(&l2tp_id)
            .await
            .unwrap()
            .into_redacted_view();
        assert!(l2tp_view.secret_presence.password && l2tp_view.secret_presence.psk);
        assert!(l2tp_view.connection.config.password.is_none());
        assert!(l2tp_view.connection.config.psk.is_none());
        assert!(matches!(
            l2tp_view.connection.status,
            L2TPStatus::Disconnected
        ));

        let ikev2_view = restarted_ikev2
            .lock()
            .await
            .get_connection(&ikev2_id)
            .await
            .unwrap()
            .into_redacted_view();
        assert!(ikev2_view.secret_presence.password && ikev2_view.secret_presence.private_key);
        assert!(ikev2_view.connection.config.password.is_none());
        assert!(ikev2_view.connection.config.private_key.is_none());
        assert_eq!(
            ikev2_view.connection.config.routing_mode,
            VpnRoutingMode::Split
        );
        assert_eq!(
            ikev2_view.connection.config.remote_subnets,
            ["10.20.0.0/16", "2001:db8:42::/48"]
        );
        assert!(matches!(
            ikev2_view.connection.status,
            IKEv2Status::Disconnected
        ));

        let ipsec_view = restarted_ipsec
            .lock()
            .await
            .get_connection(&ipsec_id)
            .await
            .unwrap()
            .into_redacted_view();
        assert!(ipsec_view.secret_presence.psk && ipsec_view.secret_presence.private_key);
        assert!(ipsec_view.connection.config.psk.is_none());
        assert!(ipsec_view.connection.config.private_key.is_none());
        assert_eq!(
            ipsec_view.connection.config.routing_mode,
            VpnRoutingMode::Split
        );
        assert_eq!(
            ipsec_view.connection.config.remote_subnets,
            ["192.0.2.0/24"]
        );
        assert!(matches!(
            ipsec_view.connection.status,
            IPsecStatus::Disconnected
        ));

        let sstp_view = restarted_sstp
            .lock()
            .await
            .get_connection(&sstp_id)
            .await
            .unwrap()
            .into_redacted_view();
        assert!(sstp_view.secret_presence.password);
        assert!(sstp_view.connection.config.password.is_none());
        assert!(matches!(
            sstp_view.connection.status,
            SSTPStatus::Disconnected
        ));

        drop((
            restarted_pptp,
            restarted_l2tp,
            restarted_ikev2,
            restarted_ipsec,
            restarted_sstp,
        ));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn locked_restore_retries_after_unlock_without_overwriting_ciphertext() {
        let root = temp_root("locked-retry");
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("connections.json");
        let writer_state = encryption_state().await;
        let writer_storage = storage_with_state(&path, writer_state).await;
        let writer = PPTPService::new_persistent(emitter(), writer_storage);
        let id = writer
            .lock()
            .await
            .create_connection("PPTP".to_string(), pptp_config())
            .await
            .unwrap();
        drop(writer);
        let before = std::fs::read(&path).unwrap();

        let locked_state = Arc::new(EncryptionState::new());
        let locked_storage = storage_with_state(&path, locked_state.clone()).await;
        let restarted = PPTPService::new_persistent(emitter(), locked_storage);
        let error = restarted.lock().await.list_connections().await.unwrap_err();
        assert!(error.contains("locked"));
        assert!(restarted
            .lock()
            .await
            .create_connection("Blocked".to_string(), pptp_config())
            .await
            .is_err());
        assert_eq!(std::fs::read(&path).unwrap(), before);

        locked_state
            .install(MasterDek::from_bytes(&[0x51; 32]).unwrap())
            .await;
        let restored = restarted.lock().await.list_connections().await.unwrap();
        assert_eq!(restored.len(), 1);
        assert_eq!(restored[0].id, id);
        drop(restarted);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn malformed_and_duplicate_ids_never_replace_any_provider_map() {
        let pptp = PPTPService::new();
        pptp.lock()
            .await
            .create_connection("PPTP".to_string(), pptp_config())
            .await
            .unwrap();
        let l2tp = L2TPService::new();
        l2tp.lock()
            .await
            .create_connection("L2TP".to_string(), l2tp_config())
            .await
            .unwrap();
        let ikev2 = IKEv2Service::new();
        ikev2
            .lock()
            .await
            .create_connection("IKEv2".to_string(), ikev2_config())
            .await
            .unwrap();
        let ipsec = IPsecService::new();
        ipsec
            .lock()
            .await
            .create_connection("IPsec".to_string(), ipsec_config())
            .await
            .unwrap();
        let sstp = SSTPService::new();
        sstp.lock()
            .await
            .create_connection("SSTP".to_string(), sstp_config())
            .await
            .unwrap();

        assert_corruption_preserves_profiles!(pptp);
        assert_corruption_preserves_profiles!(l2tp);
        assert_corruption_preserves_profiles!(ikev2);
        assert_corruption_preserves_profiles!(ipsec);
        assert_corruption_preserves_profiles!(sstp);
    }

    macro_rules! assert_failed_save_rolls_back {
        ($state:expr, $config:expr) => {{
            let state = $state;
            let mut service = state.lock().await;
            assert!(service
                .create_connection("Unsaved".to_string(), $config)
                .await
                .is_err());
            assert!(service.list_connections().await.unwrap().is_empty());
        }};
    }

    #[tokio::test]
    async fn failed_storage_write_rolls_back_every_provider_mutation() {
        let root = temp_root("rollback");
        std::fs::create_dir_all(&root).unwrap();
        let blocker = root.join("not-a-directory");
        std::fs::write(&blocker, b"block").unwrap();
        let storage = sorng_storage::storage::SecureStorage::new(
            blocker.join("connections.json").to_string_lossy().into(),
        );

        assert_failed_save_rolls_back!(
            PPTPService::new_persistent(emitter(), storage.clone()),
            pptp_config()
        );
        assert_failed_save_rolls_back!(
            L2TPService::new_persistent(emitter(), storage.clone()),
            l2tp_config()
        );
        assert_failed_save_rolls_back!(
            IKEv2Service::new_persistent(emitter(), storage.clone()),
            ikev2_config()
        );
        assert_failed_save_rolls_back!(
            IPsecService::new_persistent(emitter(), storage.clone()),
            ipsec_config()
        );
        assert_failed_save_rolls_back!(
            SSTPService::new_persistent(emitter(), storage),
            sstp_config()
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}
