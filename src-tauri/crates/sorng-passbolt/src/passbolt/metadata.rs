//! Metadata key management for Passbolt v5.
//!
//! Passbolt v5 introduces server-side encrypted metadata stored via
//! metadata keys with OpenPGP encryption.
//!
//! Endpoints:
//! - `GET  /metadata/keys.json`               — list metadata keys
//! - `POST /metadata/keys.json`               — create a metadata key
//! - `PUT  /metadata/keys/{id}.json`          — update a metadata key
//! - `DELETE /metadata/keys/{id}.json`        — delete a metadata key
//! - `GET  /metadata/keys/settings.json`      — get metadata key settings
//! - `POST /metadata/keys/settings.json`      — update metadata key settings
//!
//! - `POST /metadata/keys/privates.json`      — create a metadata private key
//! - `PUT  /metadata/keys/private/{id}.json`  — update a metadata private key
//!
//! - `GET  /metadata/types/settings.json`     — get metadata types settings
//! - `POST /metadata/types/settings.json`     — update metadata types settings
//!
//! - `GET  /metadata/session-keys.json`       — list metadata session keys
//! - `POST /metadata/session-keys.json`       — create metadata session keys
//! - `POST /metadata/session-key/{id}.json`   — update a metadata session key
//! - `DELETE /metadata/session-key/{id}.json` — delete a metadata session key
//!
//! - `GET  /metadata/rotate-key/resources.json` — list resources needing key rotation
//! - `POST /metadata/rotate-key/resources.json` — rotate keys for resources
//! - `GET  /metadata/rotate-key/folders.json`   — list folders needing key rotation
//! - `POST /metadata/rotate-key/folders.json`   — rotate keys for folders
//! - `GET  /metadata/rotate-key/tags.json`      — list tags needing key rotation
//! - `POST /metadata/rotate-key/tags.json`      — rotate keys for tags
//!
//! - `GET  /metadata/upgrade/resources.json`  — list resources needing metadata upgrade
//! - `POST /metadata/upgrade/resources.json`  — upgrade resource metadata
//! - `GET  /metadata/upgrade/folders.json`    — list folders needing metadata upgrade
//! - `POST /metadata/upgrade/folders.json`    — upgrade folder metadata
//! - `GET  /metadata/upgrade/tags.json`       — list tags needing metadata upgrade
//! - `POST /metadata/upgrade/tags.json`       — upgrade tag metadata

use crate::passbolt::api_client::PassboltApiClient;
use crate::passbolt::types::*;
use log::{debug, info};

// ── Metadata Keys ───────────────────────────────────────────────────

/// Metadata key API operations.
pub struct PassboltMetadataKeys;

impl PassboltMetadataKeys {
    /// List all metadata keys.
    pub async fn list(client: &PassboltApiClient) -> Result<Vec<MetadataKey>, PassboltError> {
        let resp: ApiResponse<Vec<MetadataKey>> = client.get("/metadata/keys.json").await?;
        info!("Listed {} metadata keys", resp.body.len());
        Ok(resp.body)
    }

    /// Create a new metadata key.
    pub async fn create(
        client: &PassboltApiClient,
        request: &CreateMetadataKeyRequest,
    ) -> Result<MetadataKey, PassboltError> {
        info!("Creating metadata key");
        let resp: ApiResponse<MetadataKey> = client.post("/metadata/keys.json", request).await?;
        info!("Created metadata key {}", resp.body.id);
        Ok(resp.body)
    }

    /// Update a metadata key.
    pub async fn update(
        client: &PassboltApiClient,
        key_id: &str,
        request: &UpdateMetadataKeyRequest,
    ) -> Result<MetadataKey, PassboltError> {
        info!("Updating metadata key {}", key_id);
        let resp: ApiResponse<MetadataKey> = client
            .put(&format!("/metadata/keys/{}.json", key_id), request)
            .await?;
        Ok(resp.body)
    }

    /// Delete a metadata key.
    pub async fn delete(client: &PassboltApiClient, key_id: &str) -> Result<(), PassboltError> {
        info!("Deleting metadata key {}", key_id);
        client
            .delete_void(&format!("/metadata/keys/{}.json", key_id))
            .await?;
        Ok(())
    }

    /// Get metadata key settings.
    pub async fn get_settings(
        client: &PassboltApiClient,
    ) -> Result<MetadataKeySettings, PassboltError> {
        let resp: ApiResponse<MetadataKeySettings> =
            client.get("/metadata/keys/settings.json").await?;
        Ok(resp.body)
    }

    /// Update metadata key settings.
    pub async fn update_settings(
        client: &PassboltApiClient,
        request: &UpdateMetadataKeySettingsRequest,
    ) -> Result<MetadataKeySettings, PassboltError> {
        info!("Updating metadata key settings");
        let resp: ApiResponse<MetadataKeySettings> =
            client.post("/metadata/keys/settings.json", request).await?;
        Ok(resp.body)
    }
}

// ── Metadata Private Keys ───────────────────────────────────────────

/// Metadata private key API operations.
pub struct PassboltMetadataPrivateKeys;

impl PassboltMetadataPrivateKeys {
    /// Create a metadata private key.
    pub async fn create(
        client: &PassboltApiClient,
        request: &MetadataPrivateKeyEntry,
    ) -> Result<MetadataPrivateKey, PassboltError> {
        info!("Creating metadata private key");
        let resp: ApiResponse<MetadataPrivateKey> =
            client.post("/metadata/keys/privates.json", request).await?;
        Ok(resp.body)
    }

    /// Update a metadata private key.
    pub async fn update(
        client: &PassboltApiClient,
        private_key_id: &str,
        request: &MetadataPrivateKeyEntry,
    ) -> Result<MetadataPrivateKey, PassboltError> {
        info!("Updating metadata private key {}", private_key_id);
        let resp: ApiResponse<MetadataPrivateKey> = client
            .put(
                &format!("/metadata/keys/private/{}.json", private_key_id),
                request,
            )
            .await?;
        Ok(resp.body)
    }
}

// ── Metadata Types Settings ─────────────────────────────────────────

/// Metadata types settings API operations.
pub struct PassboltMetadataTypesSettings;

impl PassboltMetadataTypesSettings {
    /// Get metadata types settings.
    pub async fn get(client: &PassboltApiClient) -> Result<MetadataTypesSettings, PassboltError> {
        let resp: ApiResponse<MetadataTypesSettings> =
            client.get("/metadata/types/settings.json").await?;
        Ok(resp.body)
    }

    /// Update metadata types settings.
    pub async fn update(
        client: &PassboltApiClient,
        settings: &MetadataTypesSettings,
    ) -> Result<MetadataTypesSettings, PassboltError> {
        info!("Updating metadata types settings");
        let resp: ApiResponse<MetadataTypesSettings> = client
            .post("/metadata/types/settings.json", settings)
            .await?;
        Ok(resp.body)
    }
}

// ── Metadata Session Keys ───────────────────────────────────────────

/// Metadata session key API operations.
pub struct PassboltMetadataSessionKeys;

impl PassboltMetadataSessionKeys {
    /// List metadata session keys.
    pub async fn list(
        client: &PassboltApiClient,
    ) -> Result<Vec<MetadataSessionKey>, PassboltError> {
        let resp: ApiResponse<Vec<MetadataSessionKey>> =
            client.get("/metadata/session-keys.json").await?;
        info!("Listed {} metadata session keys", resp.body.len());
        Ok(resp.body)
    }

    /// Create metadata session keys.
    pub async fn create(
        client: &PassboltApiClient,
        request: &[CreateSessionKeyRequest],
    ) -> Result<Vec<MetadataSessionKey>, PassboltError> {
        info!("Creating {} metadata session keys", request.len());
        let resp: ApiResponse<Vec<MetadataSessionKey>> =
            client.post("/metadata/session-keys.json", &request).await?;
        Ok(resp.body)
    }

    /// Update a metadata session key.
    pub async fn update(
        client: &PassboltApiClient,
        session_key_id: &str,
        request: &UpdateSessionKeyRequest,
    ) -> Result<MetadataSessionKey, PassboltError> {
        info!("Updating metadata session key {}", session_key_id);
        let resp: ApiResponse<MetadataSessionKey> = client
            .post(
                &format!("/metadata/session-key/{}.json", session_key_id),
                request,
            )
            .await?;
        Ok(resp.body)
    }

    /// Delete a metadata session key.
    pub async fn delete(
        client: &PassboltApiClient,
        session_key_id: &str,
    ) -> Result<(), PassboltError> {
        info!("Deleting metadata session key {}", session_key_id);
        client
            .delete_void(&format!("/metadata/session-key/{}.json", session_key_id))
            .await?;
        Ok(())
    }
}

// ── Metadata Key Rotation ───────────────────────────────────────────

/// Metadata key rotation API operations.
pub struct PassboltMetadataRotation;

impl PassboltMetadataRotation {
    /// List resources needing key rotation.
    pub async fn list_resources(
        client: &PassboltApiClient,
    ) -> Result<Vec<MetadataRotateEntry>, PassboltError> {
        debug!("Listing resources needing metadata key rotation");
        let resp: ApiResponse<Vec<MetadataRotateEntry>> =
            client.get("/metadata/rotate-key/resources.json").await?;
        Ok(resp.body)
    }

    /// Rotate metadata keys for resources.
    pub async fn rotate_resources(
        client: &PassboltApiClient,
        entries: &[MetadataRotateEntry],
    ) -> Result<(), PassboltError> {
        info!("Rotating metadata keys for {} resources", entries.len());
        let _: ApiResponse<serde_json::Value> = client
            .post("/metadata/rotate-key/resources.json", &entries)
            .await?;
        Ok(())
    }

    /// List folders needing key rotation.
    pub async fn list_folders(
        client: &PassboltApiClient,
    ) -> Result<Vec<MetadataRotateEntry>, PassboltError> {
        debug!("Listing folders needing metadata key rotation");
        let resp: ApiResponse<Vec<MetadataRotateEntry>> =
            client.get("/metadata/rotate-key/folders.json").await?;
        Ok(resp.body)
    }

    /// Rotate metadata keys for folders.
    pub async fn rotate_folders(
        client: &PassboltApiClient,
        entries: &[MetadataRotateEntry],
    ) -> Result<(), PassboltError> {
        info!("Rotating metadata keys for {} folders", entries.len());
        let _: ApiResponse<serde_json::Value> = client
            .post("/metadata/rotate-key/folders.json", &entries)
            .await?;
        Ok(())
    }

    /// List tags needing key rotation.
    pub async fn list_tags(
        client: &PassboltApiClient,
    ) -> Result<Vec<MetadataRotateTagEntry>, PassboltError> {
        debug!("Listing tags needing metadata key rotation");
        let resp: ApiResponse<Vec<MetadataRotateTagEntry>> =
            client.get("/metadata/rotate-key/tags.json").await?;
        Ok(resp.body)
    }

    /// Rotate metadata keys for tags.
    pub async fn rotate_tags(
        client: &PassboltApiClient,
        entries: &[MetadataRotateTagEntry],
    ) -> Result<(), PassboltError> {
        info!("Rotating metadata keys for {} tags", entries.len());
        let _: ApiResponse<serde_json::Value> = client
            .post("/metadata/rotate-key/tags.json", &entries)
            .await?;
        Ok(())
    }
}

// ── Metadata Upgrade ────────────────────────────────────────────────

/// Metadata upgrade (v4→v5) API operations.
pub struct PassboltMetadataUpgrade;

impl PassboltMetadataUpgrade {
    /// List resources needing metadata upgrade.
    pub async fn list_resources(
        client: &PassboltApiClient,
    ) -> Result<Vec<MetadataUpgradeEntry>, PassboltError> {
        debug!("Listing resources needing metadata upgrade");
        let resp: ApiResponse<Vec<MetadataUpgradeEntry>> =
            client.get("/metadata/upgrade/resources.json").await?;
        Ok(resp.body)
    }

    /// Upgrade resource metadata.
    pub async fn upgrade_resources(
        client: &PassboltApiClient,
        entries: &[MetadataUpgradeEntry],
    ) -> Result<(), PassboltError> {
        info!("Upgrading metadata for {} resources", entries.len());
        let _: ApiResponse<serde_json::Value> = client
            .post("/metadata/upgrade/resources.json", &entries)
            .await?;
        Ok(())
    }

    /// List folders needing metadata upgrade.
    pub async fn list_folders(
        client: &PassboltApiClient,
    ) -> Result<Vec<MetadataUpgradeEntry>, PassboltError> {
        debug!("Listing folders needing metadata upgrade");
        let resp: ApiResponse<Vec<MetadataUpgradeEntry>> =
            client.get("/metadata/upgrade/folders.json").await?;
        Ok(resp.body)
    }

    /// Upgrade folder metadata.
    pub async fn upgrade_folders(
        client: &PassboltApiClient,
        entries: &[MetadataUpgradeEntry],
    ) -> Result<(), PassboltError> {
        info!("Upgrading metadata for {} folders", entries.len());
        let _: ApiResponse<serde_json::Value> = client
            .post("/metadata/upgrade/folders.json", &entries)
            .await?;
        Ok(())
    }

    /// List tags needing metadata upgrade.
    pub async fn list_tags(
        client: &PassboltApiClient,
    ) -> Result<Vec<MetadataUpgradeTagEntry>, PassboltError> {
        debug!("Listing tags needing metadata upgrade");
        let resp: ApiResponse<Vec<MetadataUpgradeTagEntry>> =
            client.get("/metadata/upgrade/tags.json").await?;
        Ok(resp.body)
    }

    /// Upgrade tag metadata.
    pub async fn upgrade_tags(
        client: &PassboltApiClient,
        entries: &[MetadataUpgradeTagEntry],
    ) -> Result<(), PassboltError> {
        info!("Upgrading metadata for {} tags", entries.len());
        let _: ApiResponse<serde_json::Value> =
            client.post("/metadata/upgrade/tags.json", &entries).await?;
        Ok(())
    }
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_metadata_key_request_serialize() {
        let req = CreateMetadataKeyRequest {
            armored_key: "-----BEGIN PGP PUBLIC KEY-----".into(),
            fingerprint: "AABB".into(),
            metadata_private_keys: vec![],
        };
        let json = serde_json::to_value(&req).unwrap();
        assert!(json["armored_key"].as_str().unwrap().contains("PGP"));
    }

    #[test]
    fn test_metadata_key_settings_deserialize() {
        let json = r#"{
            "allow_usage_of_personal_keys": true,
            "zero_knowledge_key_share": false
        }"#;
        let s: MetadataKeySettings = serde_json::from_str(json).unwrap();
        assert!(s.allow_usage_of_personal_keys);
        assert!(!s.zero_knowledge_key_share);
    }

    #[test]
    fn test_metadata_private_key_entry_serialize() {
        let entry = MetadataPrivateKeyEntry {
            metadata_key_id: "mk-uuid".into(),
            user_id: "user-uuid".into(),
            data: "encrypted-private-key".into(),
        };
        let json = serde_json::to_value(&entry).unwrap();
        assert_eq!(json["metadata_key_id"], "mk-uuid");
    }

    #[test]
    fn test_create_session_key_request() {
        let req = CreateSessionKeyRequest {
            data: "encrypted-session-key".into(),
        };
        let json = serde_json::to_value(&req).unwrap();
        assert_eq!(json["data"], "encrypted-session-key");
    }

    #[test]
    fn test_metadata_rotate_entry_serialize() {
        let entry = MetadataRotateEntry {
            id: "res-uuid".into(),
            metadata: "new-encrypted-metadata".into(),
            metadata_key_id: "new-key-uuid".into(),
            metadata_key_type: "shared_key".into(),
            modified: "2024-01-01T00:00:00Z".into(),
            modified_by: "user-uuid".into(),
        };
        let json = serde_json::to_value(&entry).unwrap();
        assert_eq!(json["metadata_key_id"], "new-key-uuid");
    }

    #[test]
    fn test_metadata_upgrade_entry_serialize() {
        let entry = MetadataUpgradeEntry {
            id: "res-uuid".into(),
            metadata: "encrypted-v5-metadata".into(),
            metadata_key_id: "mk-uuid".into(),
            metadata_key_type: "shared_key".into(),
            modified: "2024-01-01T00:00:00Z".into(),
            modified_by: "user-uuid".into(),
        };
        let json = serde_json::to_value(&entry).unwrap();
        assert_eq!(json["metadata_key_type"], "shared_key");
    }

    #[test]
    fn test_metadata_types_settings_deserialize() {
        let json = r#"{
            "default_resource_types": "v5",
            "default_folder_type": "v5",
            "default_tag_type": "v5",
            "default_comment_type": "v4",
            "allow_creation_of_v5_resources": true,
            "allow_creation_of_v5_folders": true,
            "allow_creation_of_v5_tags": true,
            "allow_creation_of_v5_comments": false,
            "allow_creation_of_v4_resources": true,
            "allow_creation_of_v4_folders": true,
            "allow_creation_of_v4_tags": true,
            "allow_creation_of_v4_comments": true,
            "allow_v5_v4_downgrade": false,
            "allow_v4_v5_upgrade": true
        }"#;
        let s: MetadataTypesSettings = serde_json::from_str(json).unwrap();
        assert!(s.allow_creation_of_v5_resources);
        assert!(!s.allow_v5_v4_downgrade);
    }
}
