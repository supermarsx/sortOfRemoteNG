//! Central Passbolt service coordinator.
//!
//! Provides the `PassboltService` that manages the API client,
//! PGP context, session state, and coordinates all domain operations.

use crate::passbolt::api_client::PassboltApiClient;
use crate::passbolt::auth::PassboltAuth;
use crate::passbolt::comments::PassboltComments;
use crate::passbolt::crypto::PgpContext;
use crate::passbolt::folders::PassboltFolders;
use crate::passbolt::healthcheck::{PassboltDirectorySync, PassboltHealthcheck};
use crate::passbolt::metadata::{
    PassboltMetadataKeys, PassboltMetadataRotation, PassboltMetadataSessionKeys,
    PassboltMetadataTypesSettings, PassboltMetadataUpgrade,
};
use crate::passbolt::resources::PassboltResources;
use crate::passbolt::secrets::PassboltSecrets;
use crate::passbolt::sharing::PassboltSharing;
use crate::passbolt::tags::PassboltTags;
use crate::passbolt::types::*;
use crate::passbolt::users_groups::{
    PassboltGpgKeys, PassboltGroups, PassboltRoles, PassboltUsers,
};
use log::info;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Tauri-managed state wrapper.
pub type PassboltServiceState = Arc<Mutex<PassboltService>>;

/// Central Passbolt integration service.
pub struct PassboltService {
    /// Configuration.
    config: PassboltConfig,
    /// API client.
    client: PassboltApiClient,
    /// OpenPGP context for encryption/decryption.
    pgp: PgpContext,
    /// Whether we're authenticated.
    authenticated: bool,
    /// Resource cache.
    cache: Option<ResourceCache>,
    /// Last sync timestamp.
    last_sync: Option<String>,
}

impl Default for PassboltService {
    fn default() -> Self {
        Self::new()
    }
}

impl PassboltService {
    /// Create a new service with default config.
    pub fn new() -> Self {
        Self::with_config(PassboltConfig::default())
    }

    /// Create a new service with the given config.
    pub fn with_config(config: PassboltConfig) -> Self {
        let client = PassboltApiClient::from_config(&config);
        let mut pgp = PgpContext::new();

        // Load the user's PGP key if configured.
        if let Some(ref key) = config.user_private_key {
            pgp.set_user_key(key, config.user_passphrase.as_deref().unwrap_or(""));
        }

        let cache = if config.cache_enabled {
            Some(ResourceCache {
                resources: Vec::new(),
                folders: Vec::new(),
                last_updated: None,
                ttl_seconds: config.cache_ttl_secs,
            })
        } else {
            None
        };

        Self {
            config,
            client,
            pgp,
            authenticated: false,
            cache,
            last_sync: None,
        }
    }

    /// Create the Tauri managed state.
    pub fn new_state() -> PassboltServiceState {
        Arc::new(Mutex::new(Self::new()))
    }

    /// Create the Tauri managed state with config.
    pub fn new_state_with_config(config: PassboltConfig) -> PassboltServiceState {
        Arc::new(Mutex::new(Self::with_config(config)))
    }

    // ── Configuration ───────────────────────────────────────────────

    /// Get the current config (redacted).
    pub fn config(&self) -> PassboltConfig {
        let mut c = self.config.clone();
        // Redact sensitive fields.
        if c.user_private_key.is_some() {
            c.user_private_key = Some("[REDACTED]".into());
        }
        if c.user_passphrase.is_some() {
            c.user_passphrase = Some("[REDACTED]".into());
        }
        c
    }

    /// Update the configuration.
    pub fn update_config(&mut self, config: PassboltConfig) {
        self.client = PassboltApiClient::from_config(&config);
        self.pgp = PgpContext::new();
        if let Some(ref key) = config.user_private_key {
            self.pgp
                .set_user_key(key, config.user_passphrase.as_deref().unwrap_or(""));
        }
        if config.cache_enabled && self.cache.is_none() {
            self.cache = Some(ResourceCache {
                resources: Vec::new(),
                folders: Vec::new(),
                last_updated: None,
                ttl_seconds: config.cache_ttl_secs,
            });
        }
        self.config = config;
        info!("Passbolt configuration updated");
    }

    /// Check if the service is authenticated.
    pub fn is_authenticated(&self) -> bool {
        self.authenticated
    }

    // ── Authentication ──────────────────────────────────────────────

    /// Get the server's PGP public key and set it in the PGP context.
    pub async fn fetch_server_key(&mut self) -> Result<String, PassboltError> {
        let server_key = PassboltAuth::get_server_key(&self.client).await?;
        self.pgp
            .set_server_key(&server_key.keydata, &server_key.fingerprint);
        info!("Server key loaded: fingerprint={}", server_key.fingerprint);
        Ok(server_key.fingerprint)
    }

    /// Verify the server's identity via GPGAuth.
    pub async fn verify_server(&self) -> Result<bool, PassboltError> {
        PassboltAuth::verify_server(&self.client, &self.pgp).await
    }

    /// Login via GPGAuth.
    pub async fn login_gpgauth(&mut self) -> Result<SessionState, PassboltError> {
        self.fetch_server_key().await?;
        let session = PassboltAuth::gpg_auth_login(&mut self.client, &self.pgp).await?;
        self.authenticated = true;
        Ok(session)
    }

    /// Login via JWT.
    pub async fn login_jwt(&mut self, user_id: &str) -> Result<SessionState, PassboltError> {
        self.fetch_server_key().await?;
        let session = PassboltAuth::jwt_login(&mut self.client, &self.pgp, user_id).await?;
        self.authenticated = true;
        Ok(session)
    }

    /// Refresh JWT token.
    pub async fn refresh_token(&mut self) -> Result<String, PassboltError> {
        PassboltAuth::jwt_refresh(&mut self.client).await
    }

    /// Logout.
    pub async fn logout(&mut self) -> Result<(), PassboltError> {
        match self.config.auth_method {
            AuthMethod::Jwt => PassboltAuth::jwt_logout(&mut self.client).await?,
            AuthMethod::GpgAuth => PassboltAuth::gpg_auth_logout(&mut self.client).await?,
        }
        self.authenticated = false;
        self.invalidate_cache();
        Ok(())
    }

    /// Check if session is still valid.
    pub async fn check_session(&self) -> Result<bool, PassboltError> {
        PassboltAuth::is_authenticated(&self.client).await
    }

    // ── MFA ─────────────────────────────────────────────────────────

    /// Verify TOTP MFA.
    pub async fn verify_mfa_totp(
        &mut self,
        code: &str,
        remember: bool,
    ) -> Result<(), PassboltError> {
        PassboltAuth::mfa_verify_totp(&mut self.client, code, remember).await
    }

    /// Verify Yubikey MFA.
    pub async fn verify_mfa_yubikey(
        &mut self,
        otp: &str,
        remember: bool,
    ) -> Result<(), PassboltError> {
        PassboltAuth::mfa_verify_yubikey(&mut self.client, otp, remember).await
    }

    /// Get MFA requirements.
    pub async fn get_mfa_requirements(&self) -> Result<serde_json::Value, PassboltError> {
        PassboltAuth::mfa_get_requirements(&self.client).await
    }

    // ── Resources ───────────────────────────────────────────────────

    /// List resources.
    pub async fn list_resources(
        &self,
        params: Option<&ResourceListParams>,
    ) -> Result<Vec<Resource>, PassboltError> {
        PassboltResources::list(&self.client, params).await
    }

    /// Get a resource by ID.
    pub async fn get_resource(&self, resource_id: &str) -> Result<Resource, PassboltError> {
        PassboltResources::get(&self.client, resource_id).await
    }

    /// Create a resource.
    pub async fn create_resource(
        &mut self,
        request: &CreateResourceRequest,
    ) -> Result<Resource, PassboltError> {
        let result = PassboltResources::create(&self.client, request).await?;
        self.invalidate_cache();
        Ok(result)
    }

    /// Update a resource.
    pub async fn update_resource(
        &mut self,
        resource_id: &str,
        request: &UpdateResourceRequest,
    ) -> Result<Resource, PassboltError> {
        let result = PassboltResources::update(&self.client, resource_id, request).await?;
        self.invalidate_cache();
        Ok(result)
    }

    /// Delete a resource.
    pub async fn delete_resource(&mut self, resource_id: &str) -> Result<(), PassboltError> {
        PassboltResources::delete(&self.client, resource_id).await?;
        self.invalidate_cache();
        Ok(())
    }

    /// Search resources by keyword.
    pub async fn search_resources(&self, keyword: &str) -> Result<Vec<Resource>, PassboltError> {
        PassboltResources::search(&self.client, keyword).await
    }

    /// List favorite resources.
    pub async fn list_favorite_resources(&self) -> Result<Vec<Resource>, PassboltError> {
        PassboltResources::list_favorites(&self.client).await
    }

    /// List resources in a specific folder.
    pub async fn list_resources_in_folder(
        &self,
        folder_id: &str,
    ) -> Result<Vec<Resource>, PassboltError> {
        PassboltResources::list_in_folder(&self.client, folder_id).await
    }

    /// List resource types.
    pub async fn list_resource_types(&self) -> Result<Vec<ResourceType>, PassboltError> {
        PassboltResources::list_types(&self.client).await
    }

    // ── Secrets ─────────────────────────────────────────────────────

    /// Get the encrypted secret for a resource.
    pub async fn get_secret(&self, resource_id: &str) -> Result<Secret, PassboltError> {
        PassboltSecrets::get(&self.client, resource_id).await
    }

    /// Get and decrypt the secret for a resource.
    pub async fn get_decrypted_secret(
        &self,
        resource_id: &str,
    ) -> Result<DecryptedSecret, PassboltError> {
        PassboltSecrets::get_decrypted(&self.client, &self.pgp, resource_id).await
    }

    /// Encrypt a secret for saving.
    pub fn encrypt_secret(&self, secret: &DecryptedSecret) -> Result<String, PassboltError> {
        PassboltSecrets::encrypt_for_server(&self.pgp, secret)
    }

    /// Build share secrets for multiple users.
    pub fn build_share_secrets(
        &self,
        secret: &DecryptedSecret,
        user_ids: &[String],
    ) -> Result<Vec<ShareSecret>, PassboltError> {
        PassboltSecrets::build_share_secrets(&self.pgp, secret, user_ids)
    }

    // ── Folders ─────────────────────────────────────────────────────

    /// List folders.
    pub async fn list_folders(
        &self,
        params: Option<&FolderListParams>,
    ) -> Result<Vec<Folder>, PassboltError> {
        PassboltFolders::list(&self.client, params).await
    }

    /// Get a folder by ID.
    pub async fn get_folder(&self, folder_id: &str) -> Result<Folder, PassboltError> {
        PassboltFolders::get(&self.client, folder_id).await
    }

    /// Create a folder.
    pub async fn create_folder(
        &mut self,
        request: &CreateFolderRequest,
    ) -> Result<Folder, PassboltError> {
        let result = PassboltFolders::create(&self.client, request).await?;
        self.invalidate_cache();
        Ok(result)
    }

    /// Update a folder.
    pub async fn update_folder(
        &mut self,
        folder_id: &str,
        request: &UpdateFolderRequest,
    ) -> Result<Folder, PassboltError> {
        PassboltFolders::update(&self.client, folder_id, request).await
    }

    /// Delete a folder.
    pub async fn delete_folder(
        &mut self,
        folder_id: &str,
        cascade: bool,
    ) -> Result<(), PassboltError> {
        PassboltFolders::delete(&self.client, folder_id, cascade).await?;
        self.invalidate_cache();
        Ok(())
    }

    /// Move a folder.
    pub async fn move_folder(
        &self,
        folder_id: &str,
        new_parent_id: Option<&str>,
    ) -> Result<(), PassboltError> {
        PassboltFolders::move_folder(&self.client, folder_id, new_parent_id).await
    }

    /// Move a resource to a folder.
    pub async fn move_resource(
        &self,
        resource_id: &str,
        folder_id: Option<&str>,
    ) -> Result<(), PassboltError> {
        PassboltFolders::move_resource(&self.client, resource_id, folder_id).await
    }

    /// Get the folder tree.
    pub async fn get_folder_tree(&self) -> Result<Vec<Folder>, PassboltError> {
        PassboltFolders::get_tree(&self.client).await
    }

    // ── Users ───────────────────────────────────────────────────────

    /// List users.
    pub async fn list_users(
        &self,
        params: Option<&UserListParams>,
    ) -> Result<Vec<User>, PassboltError> {
        PassboltUsers::list(&self.client, params).await
    }

    /// Get a user by ID.
    pub async fn get_user(&self, user_id: &str) -> Result<User, PassboltError> {
        PassboltUsers::get(&self.client, user_id).await
    }

    /// Get the current user.
    pub async fn get_me(&self) -> Result<User, PassboltError> {
        PassboltUsers::get_me(&self.client).await
    }

    /// Create a user (admin).
    pub async fn create_user(&self, request: &CreateUserRequest) -> Result<User, PassboltError> {
        PassboltUsers::create(&self.client, request).await
    }

    /// Update a user.
    pub async fn update_user(
        &self,
        user_id: &str,
        request: &UpdateUserRequest,
    ) -> Result<User, PassboltError> {
        PassboltUsers::update(&self.client, user_id, request).await
    }

    /// Delete a user.
    pub async fn delete_user(&self, user_id: &str) -> Result<(), PassboltError> {
        PassboltUsers::delete(&self.client, user_id).await
    }

    /// Dry-run user deletion.
    pub async fn delete_user_dry_run(
        &self,
        user_id: &str,
    ) -> Result<serde_json::Value, PassboltError> {
        PassboltUsers::delete_dry_run(&self.client, user_id).await
    }

    /// Search users.
    pub async fn search_users(&self, keyword: &str) -> Result<Vec<User>, PassboltError> {
        PassboltUsers::search(&self.client, keyword).await
    }

    // ── Groups ──────────────────────────────────────────────────────

    /// List groups.
    pub async fn list_groups(
        &self,
        params: Option<&GroupListParams>,
    ) -> Result<Vec<Group>, PassboltError> {
        PassboltGroups::list(&self.client, params).await
    }

    /// Get a group by ID.
    pub async fn get_group(&self, group_id: &str) -> Result<Group, PassboltError> {
        PassboltGroups::get(&self.client, group_id).await
    }

    /// Create a group.
    pub async fn create_group(&self, request: &CreateGroupRequest) -> Result<Group, PassboltError> {
        PassboltGroups::create(&self.client, request).await
    }

    /// Update a group.
    pub async fn update_group(
        &self,
        group_id: &str,
        request: &UpdateGroupRequest,
    ) -> Result<Group, PassboltError> {
        PassboltGroups::update(&self.client, group_id, request).await
    }

    /// Delete a group.
    pub async fn delete_group(&self, group_id: &str) -> Result<(), PassboltError> {
        PassboltGroups::delete(&self.client, group_id).await
    }

    /// Dry-run group update.
    pub async fn update_group_dry_run(
        &self,
        group_id: &str,
        request: &UpdateGroupRequest,
    ) -> Result<GroupDryRunResult, PassboltError> {
        PassboltGroups::update_dry_run(&self.client, group_id, request).await
    }

    // ── Sharing & Permissions ───────────────────────────────────────

    /// List permissions for a resource.
    pub async fn list_resource_permissions(
        &self,
        resource_id: &str,
    ) -> Result<Vec<Permission>, PassboltError> {
        PassboltSharing::list_resource_permissions(&self.client, resource_id).await
    }

    /// Share a resource.
    pub async fn share_resource(
        &self,
        resource_id: &str,
        request: &ShareRequest,
    ) -> Result<(), PassboltError> {
        PassboltSharing::share_resource(&self.client, resource_id, request).await
    }

    /// Share a folder.
    pub async fn share_folder(
        &self,
        folder_id: &str,
        request: &ShareRequest,
    ) -> Result<(), PassboltError> {
        PassboltSharing::share_folder(&self.client, folder_id, request).await
    }

    /// Simulate sharing a resource.
    pub async fn simulate_share_resource(
        &self,
        resource_id: &str,
        request: &ShareRequest,
    ) -> Result<ShareSimulateResult, PassboltError> {
        PassboltSharing::simulate_share_resource(&self.client, resource_id, request).await
    }

    /// Search AROs (users/groups for sharing).
    pub async fn search_aros(&self, keyword: &str) -> Result<Vec<Aro>, PassboltError> {
        PassboltSharing::search_aros(&self.client, keyword).await
    }

    /// Add a resource to favorites.
    pub async fn add_favorite(&self, resource_id: &str) -> Result<Favorite, PassboltError> {
        PassboltSharing::add_favorite(&self.client, resource_id).await
    }

    /// Remove a favorite.
    pub async fn remove_favorite(&self, favorite_id: &str) -> Result<(), PassboltError> {
        PassboltSharing::remove_favorite(&self.client, favorite_id).await
    }

    // ── Comments ────────────────────────────────────────────────────

    /// List comments for a resource.
    pub async fn list_comments(&self, resource_id: &str) -> Result<Vec<Comment>, PassboltError> {
        PassboltComments::list(&self.client, resource_id).await
    }

    /// Add a comment to a resource.
    pub async fn add_comment(
        &self,
        resource_id: &str,
        content: &str,
        parent_id: Option<&str>,
    ) -> Result<Comment, PassboltError> {
        PassboltComments::create(&self.client, resource_id, content, parent_id).await
    }

    /// Update a comment.
    pub async fn update_comment(
        &self,
        comment_id: &str,
        content: &str,
    ) -> Result<Comment, PassboltError> {
        PassboltComments::update(&self.client, comment_id, content).await
    }

    /// Delete a comment.
    pub async fn delete_comment(&self, comment_id: &str) -> Result<(), PassboltError> {
        PassboltComments::delete(&self.client, comment_id).await
    }

    // ── Tags ────────────────────────────────────────────────────────

    /// List all tags.
    pub async fn list_tags(&self) -> Result<Vec<Tag>, PassboltError> {
        PassboltTags::list(&self.client).await
    }

    /// Update a tag.
    pub async fn update_tag(
        &self,
        tag_id: &str,
        request: &UpdateTagRequest,
    ) -> Result<Tag, PassboltError> {
        PassboltTags::update(&self.client, tag_id, request).await
    }

    /// Delete a tag.
    pub async fn delete_tag(&self, tag_id: &str) -> Result<(), PassboltError> {
        PassboltTags::delete(&self.client, tag_id).await
    }

    /// Add tags to a resource.
    pub async fn add_tags_to_resource(
        &self,
        resource_id: &str,
        tags: &[TagEntry],
    ) -> Result<Vec<Tag>, PassboltError> {
        PassboltTags::add_to_resource(&self.client, resource_id, tags).await
    }

    // ── GPG Keys ────────────────────────────────────────────────────

    /// List all GPG keys.
    pub async fn list_gpg_keys(&self) -> Result<Vec<GpgKey>, PassboltError> {
        PassboltGpgKeys::list(&self.client).await
    }

    /// Get a GPG key.
    pub async fn get_gpg_key(&self, key_id: &str) -> Result<GpgKey, PassboltError> {
        PassboltGpgKeys::get(&self.client, key_id).await
    }

    /// Load a recipient's GPG key for sharing.
    pub async fn load_recipient_key(&mut self, user_id: &str) -> Result<(), PassboltError> {
        let user = PassboltUsers::get(&self.client, user_id).await?;
        if let Some(gpg_key) = &user.gpgkey {
            if let Some(ref armored) = gpg_key.armored_key {
                let fp = gpg_key.fingerprint.clone().unwrap_or_default();
                self.pgp.add_recipient_key(user_id, armored, &fp);
                info!("Loaded GPG key for user {} (fp: {})", user_id, fp);
                return Ok(());
            }
        }
        Err(PassboltError::not_found(format!(
            "No GPG key found for user {}",
            user_id
        )))
    }

    // ── Roles ───────────────────────────────────────────────────────

    /// List all roles.
    pub async fn list_roles(&self) -> Result<Vec<Role>, PassboltError> {
        PassboltRoles::list(&self.client).await
    }

    // ── Metadata ────────────────────────────────────────────────────

    /// List metadata keys.
    pub async fn list_metadata_keys(&self) -> Result<Vec<MetadataKey>, PassboltError> {
        PassboltMetadataKeys::list(&self.client).await
    }

    /// Create a metadata key.
    pub async fn create_metadata_key(
        &self,
        request: &CreateMetadataKeyRequest,
    ) -> Result<MetadataKey, PassboltError> {
        PassboltMetadataKeys::create(&self.client, request).await
    }

    /// Get metadata types settings.
    pub async fn get_metadata_types_settings(
        &self,
    ) -> Result<MetadataTypesSettings, PassboltError> {
        PassboltMetadataTypesSettings::get(&self.client).await
    }

    /// List metadata session keys.
    pub async fn list_metadata_session_keys(
        &self,
    ) -> Result<Vec<MetadataSessionKey>, PassboltError> {
        PassboltMetadataSessionKeys::list(&self.client).await
    }

    /// List resources needing metadata key rotation.
    pub async fn list_resources_needing_rotation(
        &self,
    ) -> Result<Vec<MetadataRotateEntry>, PassboltError> {
        PassboltMetadataRotation::list_resources(&self.client).await
    }

    /// Rotate metadata keys for resources.
    pub async fn rotate_resource_metadata(
        &self,
        entries: &[MetadataRotateEntry],
    ) -> Result<(), PassboltError> {
        PassboltMetadataRotation::rotate_resources(&self.client, entries).await
    }

    /// List resources needing metadata upgrade.
    pub async fn list_resources_needing_upgrade(
        &self,
    ) -> Result<Vec<MetadataUpgradeEntry>, PassboltError> {
        PassboltMetadataUpgrade::list_resources(&self.client).await
    }

    /// Upgrade resource metadata.
    pub async fn upgrade_resource_metadata(
        &self,
        entries: &[MetadataUpgradeEntry],
    ) -> Result<(), PassboltError> {
        PassboltMetadataUpgrade::upgrade_resources(&self.client, entries).await
    }

    // ── Health & Settings ───────────────────────────────────────────

    /// Run full health check.
    pub async fn healthcheck(&self) -> Result<HealthcheckInfo, PassboltError> {
        PassboltHealthcheck::full(&self.client).await
    }

    /// Quick server status.
    pub async fn server_status(&self) -> Result<serde_json::Value, PassboltError> {
        PassboltHealthcheck::status(&self.client).await
    }

    /// Check server reachability.
    pub async fn is_server_reachable(&self) -> Result<bool, PassboltError> {
        PassboltHealthcheck::is_reachable(&self.client).await
    }

    /// Get server settings.
    pub async fn server_settings(&self) -> Result<ServerSettings, PassboltError> {
        PassboltHealthcheck::settings(&self.client).await
    }

    // ── Directory Sync ──────────────────────────────────────────────

    /// Dry-run directory sync.
    pub async fn directory_sync_dry_run(&self) -> Result<DirectorySyncResult, PassboltError> {
        PassboltDirectorySync::dry_run(&self.client).await
    }

    /// Execute directory sync.
    pub async fn directory_sync(&self) -> Result<DirectorySyncResult, PassboltError> {
        PassboltDirectorySync::synchronize(&self.client).await
    }

    // ── Cache ───────────────────────────────────────────────────────

    /// Invalidate the resource cache.
    pub fn invalidate_cache(&mut self) {
        if let Some(ref mut cache) = self.cache {
            cache.resources.clear();
            cache.folders.clear();
            cache.last_updated = None;
        }
    }

    /// Refresh the cache from the server.
    pub async fn refresh_cache(&mut self) -> Result<(), PassboltError> {
        let resources = PassboltResources::list(&self.client, None).await?;
        let folders = PassboltFolders::list(&self.client, None).await?;

        if let Some(ref mut cache) = self.cache {
            cache.resources = resources;
            cache.folders = folders;
            cache.last_updated = Some(chrono::Utc::now().to_rfc3339());
        }

        self.last_sync = Some(chrono::Utc::now().to_rfc3339());
        info!("Cache refreshed");
        Ok(())
    }

    /// Get cached resources (returns cache or fetches fresh).
    pub async fn get_cached_resources(&mut self) -> Result<Vec<Resource>, PassboltError> {
        if let Some(ref cache) = self.cache {
            if !cache.resources.is_empty() && cache.last_updated.is_some() {
                return Ok(cache.resources.clone());
            }
        }
        self.refresh_cache().await?;
        Ok(self
            .cache
            .as_ref()
            .map(|c| c.resources.clone())
            .unwrap_or_default())
    }

    /// Get cached folders.
    pub async fn get_cached_folders(&mut self) -> Result<Vec<Folder>, PassboltError> {
        if let Some(ref cache) = self.cache {
            if !cache.folders.is_empty() && cache.last_updated.is_some() {
                return Ok(cache.folders.clone());
            }
        }
        self.refresh_cache().await?;
        Ok(self
            .cache
            .as_ref()
            .map(|c| c.folders.clone())
            .unwrap_or_default())
    }

    /// Get the last sync timestamp.
    pub fn last_sync(&self) -> Option<&str> {
        self.last_sync.as_deref()
    }

    // ── Encryption helpers ──────────────────────────────────────────

    /// Encrypt metadata using the PGP context.
    pub fn encrypt_metadata(&self, metadata: &str) -> Result<String, PassboltError> {
        self.pgp.encrypt_metadata(metadata)
    }

    /// Decrypt metadata using the PGP context.
    pub fn decrypt_metadata(&self, encrypted: &str) -> Result<String, PassboltError> {
        self.pgp.decrypt_metadata(encrypted)
    }
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_service() {
        let svc = PassboltService::new();
        assert!(!svc.is_authenticated());
        assert!(svc.last_sync().is_none());
    }

    #[test]
    fn test_new_service_with_config() {
        let config = PassboltConfig {
            server_url: "https://passbolt.example.com".into(),
            cache_enabled: true,
            cache_ttl_secs: 300,
            ..Default::default()
        };
        let svc = PassboltService::with_config(config);
        assert!(!svc.is_authenticated());
        assert!(svc.cache.is_some());
    }

    #[test]
    fn test_new_state() {
        let _state = PassboltService::new_state();
    }

    #[test]
    fn test_config_redacted() {
        let config = PassboltConfig {
            server_url: "https://passbolt.example.com".into(),
            user_private_key: Some("-----BEGIN PGP-----".into()),
            user_passphrase: Some("secret".into()),
            ..Default::default()
        };
        let svc = PassboltService::with_config(config);
        let redacted = svc.config();
        assert_eq!(redacted.user_private_key, Some("[REDACTED]".into()));
        assert_eq!(redacted.user_passphrase, Some("[REDACTED]".into()));
    }

    #[test]
    fn test_invalidate_cache() {
        let config = PassboltConfig {
            cache_enabled: true,
            ..Default::default()
        };
        let mut svc = PassboltService::with_config(config);
        // Manually populate cache
        if let Some(ref mut cache) = svc.cache {
            cache.resources.push(Resource {
                id: "test".into(),
                ..Default::default()
            });
            cache.last_updated = Some("now".into());
        }
        svc.invalidate_cache();
        assert!(svc.cache.as_ref().unwrap().resources.is_empty());
        assert!(svc.cache.as_ref().unwrap().last_updated.is_none());
    }

    #[test]
    fn test_update_config() {
        let mut svc = PassboltService::new();
        let new_config = PassboltConfig {
            server_url: "https://new.example.com".into(),
            cache_enabled: true,
            ..Default::default()
        };
        svc.update_config(new_config);
        assert!(svc.cache.is_some());
    }
}
