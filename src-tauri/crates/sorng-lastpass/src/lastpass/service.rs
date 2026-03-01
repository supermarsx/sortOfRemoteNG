use crate::lastpass::api_client::LastPassApiClient;
use crate::lastpass::auth;
use crate::lastpass::crypto;
use crate::lastpass::folders;
use crate::lastpass::items;
use crate::lastpass::import_export;
use crate::lastpass::notes;
use crate::lastpass::password_gen;
use crate::lastpass::security_challenge;
use crate::lastpass::vault_parser;
use crate::lastpass::types::*;
use std::sync::Arc;
use tokio::sync::Mutex;

pub type LastPassServiceState = Arc<Mutex<LastPassService>>;

pub struct LastPassService {
    config: Option<LastPassConfig>,
    client: Option<LastPassApiClient>,
    session: Option<LastPassSession>,
    cached_accounts: Option<CacheEntry<Vec<Account>>>,
    cached_vault_blob: Option<VaultBlob>,
}

impl LastPassService {
    pub fn new() -> Self {
        Self {
            config: None,
            client: None,
            session: None,
            cached_accounts: None,
            cached_vault_blob: None,
        }
    }

    pub fn new_state() -> LastPassServiceState {
        Arc::new(Mutex::new(Self::new()))
    }

    // ─── Configuration ───────────────────────────────────────────

    pub fn configure(&mut self, config: LastPassConfig) -> Result<(), LastPassError> {
        if config.username.is_empty() {
            return Err(LastPassError::config_error("Username (email) is required"));
        }
        self.config = Some(config);
        Ok(())
    }

    pub fn get_config(&self) -> Result<&LastPassConfig, LastPassError> {
        self.config
            .as_ref()
            .ok_or_else(|| LastPassError::config_error("LastPass is not configured"))
    }

    pub fn is_configured(&self) -> bool {
        self.config.is_some()
    }

    pub fn is_logged_in(&self) -> bool {
        self.session.is_some() && self.client.as_ref().map(|c| c.has_session()).unwrap_or(false)
    }

    // ─── Authentication ──────────────────────────────────────────

    pub async fn login(
        &mut self,
        master_password: &str,
        otp: Option<&str>,
    ) -> Result<(), LastPassError> {
        let config = self
            .config
            .as_ref()
            .ok_or_else(|| LastPassError::config_error("LastPass is not configured"))?
            .clone();

        let mut client = LastPassApiClient::new(&config)?;
        let session = auth::login(&mut client, &config, master_password, otp).await?;

        self.session = Some(session);
        self.client = Some(client);
        self.cached_accounts = None;
        self.cached_vault_blob = None;

        Ok(())
    }

    pub async fn logout(&mut self) -> Result<(), LastPassError> {
        if let Some(ref mut client) = self.client {
            auth::logout(client).await?;
        }
        self.session = None;
        self.client = None;
        self.cached_accounts = None;
        self.cached_vault_blob = None;
        Ok(())
    }

    // ─── Vault ───────────────────────────────────────────────────

    async fn ensure_vault(&mut self) -> Result<(), LastPassError> {
        if let Some(ref cache) = self.cached_accounts {
            if !cache.is_expired() {
                return Ok(());
            }
        }

        let client = self
            .client
            .as_ref()
            .ok_or_else(|| LastPassError::auth_failed("Not logged in"))?;
        let session = self
            .session
            .as_ref()
            .ok_or_else(|| LastPassError::auth_failed("No active session"))?;

        let blob_data = client.get_vault().await?;
        let blob = VaultBlob {
            data: blob_data,
            version: 1,
        };
        let accounts = vault_parser::parse_vault(&blob, &session.encryption_key)?;

        self.cached_vault_blob = Some(blob);
        self.cached_accounts = Some(CacheEntry::new(accounts, 300)); // 5 min cache

        Ok(())
    }

    fn get_cached_accounts(&self) -> Result<&Vec<Account>, LastPassError> {
        self.cached_accounts
            .as_ref()
            .map(|c| &c.data)
            .ok_or_else(|| LastPassError::auth_failed("Vault not loaded"))
    }

    pub fn invalidate_cache(&mut self) {
        self.cached_accounts = None;
        self.cached_vault_blob = None;
    }

    // ─── Accounts ────────────────────────────────────────────────

    pub async fn list_accounts(
        &mut self,
        params: Option<AccountListParams>,
    ) -> Result<Vec<Account>, LastPassError> {
        self.ensure_vault().await?;
        let accounts = self.get_cached_accounts()?;

        if let Some(params) = params {
            Ok(items::filter_accounts(accounts, &params))
        } else {
            Ok(accounts.clone())
        }
    }

    pub async fn get_account(&mut self, id: &str) -> Result<Account, LastPassError> {
        self.ensure_vault().await?;
        let accounts = self.get_cached_accounts()?;
        items::find_account_by_id(accounts, id)
            .cloned()
            .ok_or_else(|| LastPassError::not_found("Account", id))
    }

    pub async fn search_accounts(&mut self, query: &str) -> Result<Vec<Account>, LastPassError> {
        self.ensure_vault().await?;
        let accounts = self.get_cached_accounts()?;
        Ok(items::find_accounts_by_name(accounts, query))
    }

    pub async fn search_by_url(&mut self, url: &str) -> Result<Vec<Account>, LastPassError> {
        self.ensure_vault().await?;
        let accounts = self.get_cached_accounts()?;
        Ok(items::find_accounts_by_url(accounts, url))
    }

    pub async fn create_account(
        &mut self,
        request: CreateAccountRequest,
    ) -> Result<String, LastPassError> {
        let client = self
            .client
            .as_ref()
            .ok_or_else(|| LastPassError::auth_failed("Not logged in"))?;
        let session = self
            .session
            .as_ref()
            .ok_or_else(|| LastPassError::auth_failed("No active session"))?;

        let encrypted_name = crypto::encrypt_field(&request.name, &session.encryption_key)?;
        let encrypted_username =
            crypto::encrypt_field(&request.username, &session.encryption_key)?;
        let encrypted_password =
            crypto::encrypt_field(&request.password, &session.encryption_key)?;
        let notes = request.notes.as_deref().unwrap_or("");
        let encrypted_notes = crypto::encrypt_field(notes, &session.encryption_key)?;
        let group = request.group.as_deref().unwrap_or("");

        let response = client
            .add_account(
                &encrypted_name,
                &request.url,
                &encrypted_username,
                &encrypted_password,
                &encrypted_notes,
                group,
                &[],
            )
            .await?;

        self.invalidate_cache();
        Ok(response)
    }

    pub async fn update_account(
        &mut self,
        request: UpdateAccountRequest,
    ) -> Result<(), LastPassError> {
        self.ensure_vault().await?;

        let encryption_key = self
            .session
            .as_ref()
            .ok_or_else(|| LastPassError::auth_failed("No active session"))?
            .encryption_key
            .clone();

        let accounts = self.get_cached_accounts()?;
        let existing = items::find_account_by_id(accounts, &request.id)
            .ok_or_else(|| LastPassError::not_found("Account", &request.id))?;

        let updated = items::apply_update(existing, &request);

        let encrypted_name = crypto::encrypt_field(&updated.name, &encryption_key)?;
        let encrypted_username =
            crypto::encrypt_field(&updated.username, &encryption_key)?;
        let encrypted_password =
            crypto::encrypt_field(&updated.password, &encryption_key)?;
        let encrypted_notes = crypto::encrypt_field(&updated.notes, &encryption_key)?;

        let client = self
            .client
            .as_ref()
            .ok_or_else(|| LastPassError::auth_failed("Not logged in"))?;

        client
            .update_account(
                &updated.id,
                &encrypted_name,
                &updated.url,
                &encrypted_username,
                &encrypted_password,
                &encrypted_notes,
                &updated.group,
            )
            .await?;

        self.invalidate_cache();
        Ok(())
    }

    pub async fn delete_account(&mut self, id: &str) -> Result<(), LastPassError> {
        let client = self
            .client
            .as_ref()
            .ok_or_else(|| LastPassError::auth_failed("Not logged in"))?;

        client.delete_account(id).await?;
        self.invalidate_cache();
        Ok(())
    }

    pub async fn toggle_favorite(
        &mut self,
        id: &str,
        favorite: bool,
    ) -> Result<(), LastPassError> {
        let client = self
            .client
            .as_ref()
            .ok_or_else(|| LastPassError::auth_failed("Not logged in"))?;

        client.toggle_favorite(id, favorite).await?;
        self.invalidate_cache();
        Ok(())
    }

    pub async fn move_account(
        &mut self,
        id: &str,
        new_group: &str,
    ) -> Result<(), LastPassError> {
        let client = self
            .client
            .as_ref()
            .ok_or_else(|| LastPassError::auth_failed("Not logged in"))?;

        client.move_account(id, new_group).await?;
        self.invalidate_cache();
        Ok(())
    }

    pub async fn get_favorites(&mut self) -> Result<Vec<Account>, LastPassError> {
        self.ensure_vault().await?;
        let accounts = self.get_cached_accounts()?;
        Ok(items::get_favorites(accounts))
    }

    pub async fn get_duplicates(&mut self) -> Result<Vec<Vec<Account>>, LastPassError> {
        self.ensure_vault().await?;
        let accounts = self.get_cached_accounts()?;
        Ok(items::find_duplicate_passwords(accounts))
    }

    // ─── Folders ─────────────────────────────────────────────────

    pub async fn list_folders(&mut self) -> Result<Vec<Folder>, LastPassError> {
        self.ensure_vault().await?;
        let accounts = self.get_cached_accounts()?;
        let session = self
            .session
            .as_ref()
            .ok_or_else(|| LastPassError::auth_failed("No active session"))?;

        let folder_entries = if let Some(ref blob) = self.cached_vault_blob {
            vault_parser::parse_folders(blob, &session.encryption_key)?
        } else {
            Vec::new()
        };

        Ok(folders::build_folder_list(&folder_entries, accounts))
    }

    pub async fn create_folder(
        &mut self,
        name: &str,
        shared: bool,
    ) -> Result<(), LastPassError> {
        let client = self
            .client
            .as_ref()
            .ok_or_else(|| LastPassError::auth_failed("Not logged in"))?;

        client.create_folder(name, shared).await?;
        self.invalidate_cache();
        Ok(())
    }

    // ─── Security ────────────────────────────────────────────────

    pub async fn run_security_challenge(&mut self) -> Result<SecurityScore, LastPassError> {
        self.ensure_vault().await?;
        let accounts = self.get_cached_accounts()?;
        Ok(security_challenge::analyze_security(accounts))
    }

    // ─── Import/Export ───────────────────────────────────────────

    pub async fn export_csv(&mut self) -> Result<ExportResult, LastPassError> {
        self.ensure_vault().await?;
        let accounts = self.get_cached_accounts()?;
        Ok(import_export::export_csv(accounts))
    }

    pub async fn export_json(&mut self) -> Result<ExportResult, LastPassError> {
        self.ensure_vault().await?;
        let accounts = self.get_cached_accounts()?;
        import_export::export_json(accounts)
    }

    pub fn import_csv(
        &self,
        csv_data: &str,
        format: ImportFormat,
    ) -> Result<(Vec<Account>, ImportResult), LastPassError> {
        match format {
            ImportFormat::LastPassCsv => import_export::import_lastpass_csv(csv_data),
            ImportFormat::ChromeCsv => import_export::import_chrome_csv(csv_data),
            _ => import_export::import_generic_csv(csv_data),
        }
    }

    // ─── Password Generation ─────────────────────────────────────

    pub fn generate_password(
        &self,
        config: Option<PasswordGenConfig>,
    ) -> Result<String, LastPassError> {
        let config = config.unwrap_or_default();
        password_gen::generate_password(&config)
    }

    pub fn generate_passphrase(
        &self,
        word_count: Option<u32>,
        separator: Option<&str>,
    ) -> String {
        password_gen::generate_passphrase(
            word_count.unwrap_or(4),
            separator.unwrap_or("-"),
        )
    }

    pub fn check_password_strength(&self, password: &str) -> (f64, &'static str) {
        let entropy = password_gen::calculate_entropy(password);
        let rating = password_gen::rate_strength(entropy);
        (entropy, rating)
    }

    // ─── Account Stats ──────────────────────────────────────────

    pub async fn get_stats(&mut self) -> Result<VaultStats, LastPassError> {
        self.ensure_vault().await?;
        let accounts = self.get_cached_accounts()?;
        let by_group = items::count_by_group(accounts);

        Ok(VaultStats {
            total_accounts: accounts.len() as u64,
            total_folders: by_group.len() as u64,
            favorites: accounts.iter().filter(|a| a.favorite).count() as u64,
            accounts_by_group: by_group,
        })
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct VaultStats {
    pub total_accounts: u64,
    pub total_folders: u64,
    pub favorites: u64,
    pub accounts_by_group: Vec<(String, usize)>,
}
