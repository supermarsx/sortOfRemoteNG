use crate::lastpass::api_client::LastPassApiClient;
use crate::lastpass::auth;
use crate::lastpass::crypto;
use crate::lastpass::folders;
use crate::lastpass::import_export;
use crate::lastpass::items;
use crate::lastpass::password_gen;
use crate::lastpass::security_challenge;
use crate::lastpass::types::*;
use crate::lastpass::vault_parser;
use std::sync::Arc;
use tokio::sync::Mutex;

const MAX_RESULT_ACCOUNTS: usize = 50_000;
const MAX_ID_BYTES: usize = 256;
const MAX_NAME_BYTES: usize = 4096;
const MAX_URL_BYTES: usize = 16 * 1024;
const MAX_USERNAME_BYTES: usize = 16 * 1024;
const MAX_NOTES_BYTES: usize = 4 * 1024 * 1024;
const MAX_GROUP_BYTES: usize = 4096;

pub type LastPassServiceState = Arc<Mutex<LastPassService>>;

pub struct LastPassService {
    config: Option<LastPassConfig>,
    client: Option<LastPassApiClient>,
    session: Option<LastPassSession>,
    cached_accounts: Option<CacheEntry<Vec<Account>>>,
    cached_vault_blob: Option<VaultBlob>,
}

impl Default for LastPassService {
    fn default() -> Self {
        Self::new()
    }
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

    pub fn configure(&mut self, mut config: LastPassConfig) -> Result<(), LastPassError> {
        if self.is_logged_in() {
            return Err(LastPassError::config_error(
                "Log out before changing LastPass configuration",
            ));
        }
        config.username = config.username.trim().to_string();
        config.server_url = config.server_url.trim().to_string();
        if config.username.is_empty()
            || config.username.len() > 320
            || config.username.chars().any(|ch| ch.is_control())
        {
            return Err(LastPassError::config_error("Username (email) is required"));
        }
        if !config.verify_tls
            || !(5..=60).contains(&config.timeout_secs)
            || (config.iterations != 1 && !(10_000..=5_000_000).contains(&config.iterations))
            || config.trusted_device_id.as_ref().is_some_and(|id| {
                id.is_empty()
                    || id.len() > 256
                    || id.chars().any(|ch| ch.is_control() || ch.is_whitespace())
            })
        {
            return Err(LastPassError::config_error(
                "LastPass configuration is outside the supported safety limits",
            ));
        }
        let _ = LastPassApiClient::new(&config)?;
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
        self.session.is_some()
            && self
                .client
                .as_ref()
                .map(|c| c.has_session())
                .unwrap_or(false)
    }

    // ─── Authentication ──────────────────────────────────────────

    pub async fn login(
        &mut self,
        master_password: &str,
        otp: Option<&str>,
    ) -> Result<(), LastPassError> {
        if self.is_logged_in() {
            return Err(LastPassError::auth_failed("Already logged in to LastPass"));
        }
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
            validate_optional_text("folder", params.folder.as_deref(), MAX_GROUP_BYTES)?;
            validate_optional_text("search", params.search.as_deref(), 1024)?;
            enforce_result_limit(items::filter_accounts(accounts, &params))
        } else {
            enforce_result_limit(accounts.clone())
        }
    }

    pub async fn get_account(&mut self, id: &str) -> Result<Account, LastPassError> {
        validate_identifier(id)?;
        self.ensure_vault().await?;
        let accounts = self.get_cached_accounts()?;
        items::find_account_by_id(accounts, id)
            .cloned()
            .ok_or_else(|| LastPassError::not_found("Account", id))
    }

    pub async fn search_accounts(&mut self, query: &str) -> Result<Vec<Account>, LastPassError> {
        validate_text("search query", query, 1024, false, false)?;
        self.ensure_vault().await?;
        let accounts = self.get_cached_accounts()?;
        enforce_result_limit(items::find_accounts_by_name(accounts, query))
    }

    pub async fn search_by_url(&mut self, url: &str) -> Result<Vec<Account>, LastPassError> {
        validate_text("URL search", url, MAX_URL_BYTES, false, false)?;
        self.ensure_vault().await?;
        let accounts = self.get_cached_accounts()?;
        enforce_result_limit(items::find_accounts_by_url(accounts, url))
    }

    pub async fn create_account(
        &mut self,
        request: CreateAccountRequest,
    ) -> Result<String, LastPassError> {
        validate_create_request(&request)?;
        let client = self
            .client
            .as_ref()
            .ok_or_else(|| LastPassError::auth_failed("Not logged in"))?;
        let session = self
            .session
            .as_ref()
            .ok_or_else(|| LastPassError::auth_failed("No active session"))?;

        let encrypted_name = crypto::encrypt_field(&request.name, &session.encryption_key)?;
        let encrypted_username = crypto::encrypt_field(&request.username, &session.encryption_key)?;
        let encrypted_password = crypto::encrypt_field(&request.password, &session.encryption_key)?;
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
        validate_update_request(&request)?;
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
        let encrypted_username = crypto::encrypt_field(&updated.username, &encryption_key)?;
        let encrypted_password = crypto::encrypt_field(&updated.password, &encryption_key)?;
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
        validate_identifier(id)?;
        let client = self
            .client
            .as_ref()
            .ok_or_else(|| LastPassError::auth_failed("Not logged in"))?;

        client.delete_account(id).await?;
        self.invalidate_cache();
        Ok(())
    }

    pub async fn toggle_favorite(&mut self, id: &str, favorite: bool) -> Result<(), LastPassError> {
        validate_identifier(id)?;
        let client = self
            .client
            .as_ref()
            .ok_or_else(|| LastPassError::auth_failed("Not logged in"))?;

        client.toggle_favorite(id, favorite).await?;
        self.invalidate_cache();
        Ok(())
    }

    pub async fn move_account(&mut self, id: &str, new_group: &str) -> Result<(), LastPassError> {
        validate_identifier(id)?;
        validate_text("folder", new_group, MAX_GROUP_BYTES, false, true)?;
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
        enforce_result_limit(items::get_favorites(accounts))
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

    pub async fn create_folder(&mut self, name: &str, shared: bool) -> Result<(), LastPassError> {
        let _ = (name, shared);
        Err(LastPassError::new(
            LastPassErrorKind::BadRequest,
            "Empty-folder creation is not supported by the verified LastPass API flow",
        ))
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
        import_export::export_csv(accounts)
    }

    pub async fn export_json(&mut self) -> Result<ExportResult, LastPassError> {
        self.ensure_vault().await?;
        let accounts = self.get_cached_accounts()?;
        import_export::export_json(accounts)
    }

    pub async fn import_csv(
        &mut self,
        csv_data: &str,
        format: ImportFormat,
    ) -> Result<ImportResult, LastPassError> {
        let (accounts, mut result) = match format {
            ImportFormat::LastPassCsv => import_export::import_lastpass_csv(csv_data),
            ImportFormat::ChromeCsv => import_export::import_chrome_csv(csv_data),
            ImportFormat::GenericCsv => import_export::import_generic_csv(csv_data),
            _ => Err(LastPassError::new(
                LastPassErrorKind::BadRequest,
                "Selected LastPass import format is not implemented",
            )),
        }?;
        result.imported = 0;
        result.skipped = 0;
        result.errors.clear();

        for (index, mut account) in accounts.into_iter().enumerate() {
            if account.favorite
                || account.totp_secret.is_some()
                || !account.custom_fields.is_empty()
            {
                result.skipped = result.skipped.saturating_add(1);
                if result.errors.len() < 100 {
                    result.errors.push(format!(
                        "Record {} uses fields that cannot be safely persisted",
                        index + 1
                    ));
                }
                continue;
            }
            let request = CreateAccountRequest {
                name: std::mem::take(&mut account.name),
                url: std::mem::take(&mut account.url),
                username: std::mem::take(&mut account.username),
                password: std::mem::take(&mut account.password),
                notes: Some(std::mem::take(&mut account.notes)),
                group: Some(std::mem::take(&mut account.group)),
                favorite: None,
                auto_login: None,
                totp_secret: None,
                custom_fields: None,
            };
            match self.create_account(request).await {
                Ok(_) => result.imported = result.imported.saturating_add(1),
                Err(_) => {
                    result.skipped = result.skipped.saturating_add(1);
                    if result.errors.len() < 100 {
                        result
                            .errors
                            .push(format!("Record {} was rejected by LastPass", index + 1));
                    }
                }
            }
        }
        Ok(result)
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
    ) -> Result<String, LastPassError> {
        password_gen::generate_passphrase(word_count.unwrap_or(4), separator.unwrap_or("-"))
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

fn validate_text(
    label: &str,
    value: &str,
    max_bytes: usize,
    allow_empty: bool,
    allow_newlines: bool,
) -> Result<(), LastPassError> {
    if (!allow_empty && value.trim().is_empty())
        || value.len() > max_bytes
        || value.chars().any(|ch| {
            ch == '\0' || (ch.is_control() && !(allow_newlines && matches!(ch, '\n' | '\r' | '\t')))
        })
    {
        return Err(LastPassError::new(
            LastPassErrorKind::BadRequest,
            format!("{} is outside the supported safety limits", label),
        ));
    }
    Ok(())
}

fn validate_optional_text(
    label: &str,
    value: Option<&str>,
    max_bytes: usize,
) -> Result<(), LastPassError> {
    if let Some(value) = value {
        validate_text(label, value, max_bytes, true, false)?;
    }
    Ok(())
}

fn validate_identifier(id: &str) -> Result<(), LastPassError> {
    if id.is_empty()
        || id.len() > MAX_ID_BYTES
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_.".contains(&byte))
    {
        return Err(LastPassError::new(
            LastPassErrorKind::BadRequest,
            "Invalid LastPass item identifier",
        ));
    }
    Ok(())
}

fn validate_create_request(request: &CreateAccountRequest) -> Result<(), LastPassError> {
    validate_text("name", &request.name, MAX_NAME_BYTES, false, false)?;
    validate_text("URL", &request.url, MAX_URL_BYTES, true, false)?;
    validate_text(
        "username",
        &request.username,
        MAX_USERNAME_BYTES,
        true,
        false,
    )?;
    validate_text("password", &request.password, MAX_NOTES_BYTES, true, false)?;
    validate_optional_text("notes", request.notes.as_deref(), MAX_NOTES_BYTES)?;
    validate_optional_text("folder", request.group.as_deref(), MAX_GROUP_BYTES)?;
    if request.favorite.unwrap_or(false)
        || request.auto_login.unwrap_or(false)
        || request.totp_secret.is_some()
        || request
            .custom_fields
            .as_ref()
            .is_some_and(|fields| !fields.is_empty())
    {
        return Err(LastPassError::new(
            LastPassErrorKind::BadRequest,
            "Favorite, auto-login, TOTP, and custom fields are not supported by the verified create flow",
        ));
    }
    Ok(())
}

fn validate_update_request(request: &UpdateAccountRequest) -> Result<(), LastPassError> {
    validate_identifier(&request.id)?;
    validate_optional_text("name", request.name.as_deref(), MAX_NAME_BYTES)?;
    validate_optional_text("URL", request.url.as_deref(), MAX_URL_BYTES)?;
    validate_optional_text("username", request.username.as_deref(), MAX_USERNAME_BYTES)?;
    validate_optional_text("password", request.password.as_deref(), MAX_NOTES_BYTES)?;
    validate_optional_text("notes", request.notes.as_deref(), MAX_NOTES_BYTES)?;
    validate_optional_text("folder", request.group.as_deref(), MAX_GROUP_BYTES)?;
    if request.favorite.is_some()
        || request.auto_login.is_some()
        || request.totp_secret.is_some()
        || request.custom_fields.is_some()
    {
        return Err(LastPassError::new(
            LastPassErrorKind::BadRequest,
            "Favorite, auto-login, TOTP, and custom fields require dedicated verified update flows",
        ));
    }
    Ok(())
}

fn enforce_result_limit(accounts: Vec<Account>) -> Result<Vec<Account>, LastPassError> {
    if accounts.len() > MAX_RESULT_ACCOUNTS {
        return Err(LastPassError::new(
            LastPassErrorKind::BadRequest,
            "Account result exceeds the configured safety limit",
        ));
    }
    Ok(accounts)
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct VaultStats {
    pub total_accounts: u64,
    pub total_folders: u64,
    pub favorites: u64,
    pub accounts_by_group: Vec<(String, usize)>,
}
