use std::sync::Arc;
use tokio::sync::Mutex;

use super::api_client::OnePasswordApiClient;
use super::types::*;
use super::vaults::{OnePasswordVaults, VaultStats};

pub type OnePasswordServiceState = Arc<Mutex<OnePasswordService>>;

/// Central service that manages 1Password Connect client configuration,
/// authentication state, and provides coordinated access to all
/// 1Password operations (vaults, items, files, TOTP, watchtower, etc.).
pub struct OnePasswordService {
    config: OnePasswordConfig,
    client: Option<OnePasswordApiClient>,
    authenticated: bool,
    cache: Option<VaultCache>,
}

struct VaultCache {
    vaults: CacheEntry<Vec<Vault>>,
}

impl OnePasswordService {
    // ── Constructors ────────────────────────────────────────────────

    pub fn new() -> Self {
        Self {
            config: OnePasswordConfig::default(),
            client: None,
            authenticated: false,
            cache: None,
        }
    }

    pub fn with_config(config: OnePasswordConfig) -> Self {
        Self {
            config,
            client: None,
            authenticated: false,
            cache: None,
        }
    }

    pub fn new_state() -> OnePasswordServiceState {
        Arc::new(Mutex::new(Self::new()))
    }

    pub fn new_state_with_config(config: OnePasswordConfig) -> OnePasswordServiceState {
        Arc::new(Mutex::new(Self::with_config(config)))
    }

    // ── Configuration ───────────────────────────────────────────────

    pub fn get_config(&self) -> &OnePasswordConfig {
        &self.config
    }

    pub fn set_config(&mut self, config: OnePasswordConfig) {
        self.config = config;
        self.client = None;
        self.authenticated = false;
        self.cache = None;
    }

    // ── Connection ──────────────────────────────────────────────────

    fn ensure_client(&mut self) -> Result<&OnePasswordApiClient, OnePasswordError> {
        if self.client.is_none() {
            let client = OnePasswordApiClient::from_config(&self.config)?;
            self.client = Some(client);
        }
        self.client.as_ref().ok_or_else(|| {
            OnePasswordError::connection_error("Failed to create HTTP client")
        })
    }

    fn get_client(&self) -> Result<&OnePasswordApiClient, OnePasswordError> {
        self.client.as_ref().ok_or_else(|| {
            OnePasswordError::connection_error("Not connected — call connect() first")
        })
    }

    /// Initialize the client and validate the token.
    pub async fn connect(&mut self) -> Result<bool, OnePasswordError> {
        self.ensure_client()?;
        let client = self.client.as_ref().unwrap();
        let valid = super::auth::OnePasswordAuth::validate_token(client).await?;
        self.authenticated = valid;
        Ok(valid)
    }

    /// Disconnect and clear state.
    pub fn disconnect(&mut self) {
        self.client = None;
        self.authenticated = false;
        self.cache = None;
    }

    pub fn is_authenticated(&self) -> bool {
        self.authenticated
    }

    // ── Vault operations ────────────────────────────────────────────

    pub async fn list_vaults(
        &mut self,
        params: &VaultListParams,
    ) -> Result<Vec<Vault>, OnePasswordError> {
        let client = self.ensure_client()?;
        let vaults = OnePasswordVaults::list(client, params).await?;

        // Update cache
        self.cache = Some(VaultCache {
            vaults: CacheEntry::new(vaults.clone(), 300),
        });

        Ok(vaults)
    }

    pub async fn get_vault(&mut self, vault_id: &str) -> Result<Vault, OnePasswordError> {
        let client = self.ensure_client()?;
        OnePasswordVaults::get(client, vault_id).await
    }

    pub async fn find_vault_by_name(
        &mut self,
        name: &str,
    ) -> Result<Option<Vault>, OnePasswordError> {
        let client = self.ensure_client()?;
        OnePasswordVaults::find_by_name(client, name).await
    }

    pub async fn get_vault_stats(
        &mut self,
        vault_id: &str,
    ) -> Result<VaultStats, OnePasswordError> {
        let client = self.ensure_client()?;
        OnePasswordVaults::get_stats(client, vault_id).await
    }

    // ── Item operations ─────────────────────────────────────────────

    pub async fn list_items(
        &mut self,
        vault_id: &str,
        params: &ItemListParams,
    ) -> Result<Vec<Item>, OnePasswordError> {
        let client = self.ensure_client()?;
        super::items::OnePasswordItems::list(client, vault_id, params).await
    }

    pub async fn get_item(
        &mut self,
        vault_id: &str,
        item_id: &str,
    ) -> Result<FullItem, OnePasswordError> {
        let client = self.ensure_client()?;
        super::items::OnePasswordItems::get(client, vault_id, item_id).await
    }

    pub async fn find_items_by_title(
        &mut self,
        vault_id: &str,
        title: &str,
    ) -> Result<Vec<Item>, OnePasswordError> {
        let client = self.ensure_client()?;
        super::items::OnePasswordItems::find_by_title(client, vault_id, title).await
    }

    pub async fn create_item(
        &mut self,
        vault_id: &str,
        request: &CreateItemRequest,
    ) -> Result<FullItem, OnePasswordError> {
        let client = self.ensure_client()?;
        super::items::OnePasswordItems::create(client, vault_id, request).await
    }

    pub async fn update_item(
        &mut self,
        vault_id: &str,
        item_id: &str,
        request: &UpdateItemRequest,
    ) -> Result<FullItem, OnePasswordError> {
        let client = self.ensure_client()?;
        super::items::OnePasswordItems::update(client, vault_id, item_id, request).await
    }

    pub async fn patch_item(
        &mut self,
        vault_id: &str,
        item_id: &str,
        ops: &[PatchOperation],
    ) -> Result<FullItem, OnePasswordError> {
        let client = self.ensure_client()?;
        super::items::OnePasswordItems::patch(client, vault_id, item_id, ops).await
    }

    pub async fn delete_item(
        &mut self,
        vault_id: &str,
        item_id: &str,
    ) -> Result<(), OnePasswordError> {
        let client = self.ensure_client()?;
        super::items::OnePasswordItems::delete(client, vault_id, item_id).await
    }

    pub async fn archive_item(
        &mut self,
        vault_id: &str,
        item_id: &str,
    ) -> Result<FullItem, OnePasswordError> {
        let client = self.ensure_client()?;
        super::items::OnePasswordItems::archive(client, vault_id, item_id).await
    }

    pub async fn restore_item(
        &mut self,
        vault_id: &str,
        item_id: &str,
    ) -> Result<FullItem, OnePasswordError> {
        let client = self.ensure_client()?;
        super::items::OnePasswordItems::restore(client, vault_id, item_id).await
    }

    pub async fn search_all_vaults(
        &mut self,
        query: &str,
    ) -> Result<Vec<(String, Item)>, OnePasswordError> {
        let client = self.ensure_client()?;
        super::items::OnePasswordItems::search_all_vaults(client, query).await
    }

    // ── Field operations ────────────────────────────────────────────

    pub async fn get_password(
        &mut self,
        vault_id: &str,
        item_id: &str,
    ) -> Result<Option<String>, OnePasswordError> {
        let client = self.ensure_client()?;
        super::fields::OnePasswordFields::get_password(client, vault_id, item_id).await
    }

    pub async fn get_username(
        &mut self,
        vault_id: &str,
        item_id: &str,
    ) -> Result<Option<String>, OnePasswordError> {
        let client = self.ensure_client()?;
        super::fields::OnePasswordFields::get_username(client, vault_id, item_id).await
    }

    pub async fn add_field(
        &mut self,
        vault_id: &str,
        item_id: &str,
        field: &Field,
    ) -> Result<FullItem, OnePasswordError> {
        let client = self.ensure_client()?;
        super::fields::OnePasswordFields::add_field(client, vault_id, item_id, field).await
    }

    pub async fn update_field_value(
        &mut self,
        vault_id: &str,
        item_id: &str,
        field_id: &str,
        value: &str,
    ) -> Result<FullItem, OnePasswordError> {
        let client = self.ensure_client()?;
        super::fields::OnePasswordFields::update_field_value(client, vault_id, item_id, field_id, value).await
    }

    pub async fn remove_field(
        &mut self,
        vault_id: &str,
        item_id: &str,
        field_id: &str,
    ) -> Result<FullItem, OnePasswordError> {
        let client = self.ensure_client()?;
        super::fields::OnePasswordFields::remove_field(client, vault_id, item_id, field_id).await
    }

    // ── File operations ─────────────────────────────────────────────

    pub async fn list_files(
        &mut self,
        vault_id: &str,
        item_id: &str,
    ) -> Result<Vec<FileAttachment>, OnePasswordError> {
        let client = self.ensure_client()?;
        super::files::OnePasswordFiles::list(client, vault_id, item_id, false).await
    }

    pub async fn download_file(
        &mut self,
        vault_id: &str,
        item_id: &str,
        file_id: &str,
    ) -> Result<Vec<u8>, OnePasswordError> {
        let client = self.ensure_client()?;
        super::files::OnePasswordFiles::download(client, vault_id, item_id, file_id).await
    }

    // ── TOTP operations ─────────────────────────────────────────────

    pub async fn get_totp_code(
        &mut self,
        vault_id: &str,
        item_id: &str,
    ) -> Result<Option<TotpCode>, OnePasswordError> {
        let client = self.ensure_client()?;
        super::totp::OnePasswordTotp::get_code(client, vault_id, item_id).await
    }

    pub async fn add_totp(
        &mut self,
        vault_id: &str,
        item_id: &str,
        totp_uri: &str,
    ) -> Result<FullItem, OnePasswordError> {
        let client = self.ensure_client()?;
        super::totp::OnePasswordTotp::add_totp(client, vault_id, item_id, totp_uri).await
    }

    // ── Watchtower ──────────────────────────────────────────────────

    pub async fn watchtower_analyze_all(
        &mut self,
    ) -> Result<WatchtowerSummary, OnePasswordError> {
        let client = self.ensure_client()?;
        super::watchtower::OnePasswordWatchtower::analyze_all(client).await
    }

    pub async fn watchtower_analyze_vault(
        &mut self,
        vault_id: &str,
    ) -> Result<WatchtowerSummary, OnePasswordError> {
        let client = self.ensure_client()?;
        super::watchtower::OnePasswordWatchtower::analyze_vault(client, vault_id).await
    }

    // ── Health ──────────────────────────────────────────────────────

    pub async fn heartbeat(&mut self) -> Result<bool, OnePasswordError> {
        let client = self.ensure_client()?;
        super::health::OnePasswordHealth::heartbeat(client).await
    }

    pub async fn health(&mut self) -> Result<ServerHealth, OnePasswordError> {
        let client = self.ensure_client()?;
        super::health::OnePasswordHealth::get_health(client).await
    }

    pub async fn is_healthy(&mut self) -> Result<bool, OnePasswordError> {
        let client = self.ensure_client()?;
        super::health::OnePasswordHealth::is_healthy(client).await
    }

    // ── Activity ────────────────────────────────────────────────────

    pub async fn get_activity(
        &mut self,
        params: &ActivityListParams,
    ) -> Result<Vec<ApiRequest>, OnePasswordError> {
        let client = self.ensure_client()?;
        super::activity::OnePasswordActivity::list(client, params).await
    }

    // ── Favorites ───────────────────────────────────────────────────

    pub async fn list_favorites(
        &mut self,
    ) -> Result<Vec<FavoriteItem>, OnePasswordError> {
        let client = self.ensure_client()?;
        super::favorites::OnePasswordFavorites::list_all(client).await
    }

    pub async fn toggle_favorite(
        &mut self,
        vault_id: &str,
        item_id: &str,
        favorite: bool,
    ) -> Result<FullItem, OnePasswordError> {
        let client = self.ensure_client()?;
        super::items::OnePasswordItems::toggle_favorite(client, vault_id, item_id, favorite).await
    }

    // ── Import / Export ─────────────────────────────────────────────

    pub async fn export_vault_json(
        &mut self,
        vault_id: &str,
    ) -> Result<ExportResult, OnePasswordError> {
        let client = self.ensure_client()?;
        super::import_export::OnePasswordImportExport::export_vault_json(client, vault_id).await
    }

    pub async fn export_vault_csv(
        &mut self,
        vault_id: &str,
    ) -> Result<ExportResult, OnePasswordError> {
        let client = self.ensure_client()?;
        super::import_export::OnePasswordImportExport::export_vault_csv(client, vault_id).await
    }

    pub async fn import_json(
        &mut self,
        vault_id: &str,
        json_data: &str,
    ) -> Result<ImportResult, OnePasswordError> {
        let client = self.ensure_client()?;
        super::import_export::OnePasswordImportExport::import_json(client, vault_id, json_data).await
    }

    pub async fn import_csv(
        &mut self,
        vault_id: &str,
        csv_data: &str,
    ) -> Result<ImportResult, OnePasswordError> {
        let client = self.ensure_client()?;
        super::import_export::OnePasswordImportExport::import_csv(client, vault_id, csv_data).await
    }

    // ── Password Generation ─────────────────────────────────────────

    pub fn generate_password(
        &self,
        config: &PasswordGenConfig,
    ) -> String {
        super::password_gen::OnePasswordPasswordGen::generate(config)
    }

    pub fn generate_passphrase(
        &self,
        word_count: u32,
        separator: &str,
    ) -> String {
        super::password_gen::OnePasswordPasswordGen::generate_passphrase(word_count, separator)
    }

    // ── Cache ───────────────────────────────────────────────────────

    pub fn get_cached_vaults(&self) -> Option<&Vec<Vault>> {
        self.cache
            .as_ref()
            .filter(|c| !c.vaults.is_expired())
            .map(|c| &c.vaults.data)
    }

    pub fn invalidate_cache(&mut self) {
        self.cache = None;
    }
}
