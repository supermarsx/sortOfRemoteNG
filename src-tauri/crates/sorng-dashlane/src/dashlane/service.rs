use std::sync::Arc;
use tokio::sync::Mutex;

use crate::dashlane::api_client::DashlaneApiClient;
use crate::dashlane::types::*;
use crate::dashlane::vault::{parse_vault_transactions, VaultData};
use crate::dashlane::{auth, devices, items, password_gen, password_health};

pub type DashlaneServiceState = Arc<Mutex<DashlaneService>>;

const MAX_ID_BYTES: usize = 256;
const MAX_QUERY_BYTES: usize = 2_048;
const MAX_SECRET_BYTES: usize = 64 * 1024;
const MAX_RESULTS: usize = 1_000;
const MAX_CATEGORIES: usize = 256;

pub struct DashlaneService {
    config: Option<DashlaneConfig>,
    session: Option<DashlaneSession>,
    client: Option<DashlaneApiClient>,
    vault_data: Option<VaultData>,
    vault_fetched_at: Option<std::time::Instant>,
}

impl Default for DashlaneService {
    fn default() -> Self {
        Self::new()
    }
}

impl DashlaneService {
    pub fn new() -> Self {
        Self {
            config: None,
            session: None,
            client: None,
            vault_data: None,
            vault_fetched_at: None,
        }
    }

    pub fn configure(&mut self, config: DashlaneConfig) -> Result<(), DashlaneError> {
        validate_text("Email", &config.email, 320, false)?;
        if config.email.trim() != config.email
            || !config.email.contains('@')
            || config.email.chars().any(char::is_control)
        {
            return Err(DashlaneError::InvalidConfig("Invalid email address".into()));
        }
        validate_text("Device name", &config.device_name, 128, false)?;
        if config.cli_path.is_some() {
            return Err(DashlaneError::unsupported(
                "Dashlane CLI integration is not implemented",
            ));
        }

        let client = DashlaneApiClient::new(&config)?;
        self.session = None;
        self.vault_data = None;
        self.vault_fetched_at = None;
        self.client = Some(client);
        self.config = Some(config);
        Ok(())
    }

    pub async fn login(&mut self, master_password: &str) -> Result<(), DashlaneError> {
        validate_text("Master password", master_password, MAX_SECRET_BYTES, false)?;
        let config = self.config.as_ref().ok_or(DashlaneError::NotConfigured)?;
        let client = self.client.as_mut().ok_or(DashlaneError::NotConfigured)?;
        self.session = Some(auth::login(client, config, master_password, None).await?);
        Ok(())
    }

    pub async fn login_with_token(
        &mut self,
        master_password: &str,
        token: &str,
    ) -> Result<(), DashlaneError> {
        validate_text("Master password", master_password, MAX_SECRET_BYTES, false)?;
        validate_text("Verification token", token, 512, false)?;
        let config = self.config.as_ref().ok_or(DashlaneError::NotConfigured)?;
        let client = self.client.as_mut().ok_or(DashlaneError::NotConfigured)?;
        self.session = Some(auth::login(client, config, master_password, Some(token)).await?);
        Ok(())
    }

    pub async fn logout(&mut self) -> Result<(), DashlaneError> {
        if let Some(client) = self.client.as_mut() {
            auth::logout(client).await?;
        }
        self.session = None;
        self.vault_data = None;
        self.vault_fetched_at = None;
        Ok(())
    }

    pub fn is_authenticated(&self) -> bool {
        self.session.is_some()
            && self
                .client
                .as_ref()
                .is_some_and(|client| client.has_session())
    }

    fn require_session(&self) -> Result<&DashlaneSession, DashlaneError> {
        let session = auth::validate_session(&self.session)?;
        if !self
            .client
            .as_ref()
            .is_some_and(|client| client.has_session())
        {
            return Err(DashlaneError::auth_failed("Dashlane session is incomplete"));
        }
        Ok(session)
    }

    async fn ensure_vault(&mut self) -> Result<(), DashlaneError> {
        self.require_session()?;
        let needs_refresh = self.vault_fetched_at.map_or(true, |fetched| {
            fetched.elapsed() > std::time::Duration::from_secs(300)
        });

        if needs_refresh || self.vault_data.is_none() {
            let client = self.client.as_ref().ok_or(DashlaneError::NotConfigured)?;
            let response = client.get_latest_content().await?;
            let transactions = response.transactions.ok_or_else(|| {
                DashlaneError::parse_error("Dashlane response omitted transactions")
            })?;
            let key = &self
                .session
                .as_ref()
                .ok_or(DashlaneError::SessionExpired)?
                .encryption_key;
            let data = parse_vault_transactions(&transactions, key)?;
            self.vault_data = Some(data);
            self.vault_fetched_at = Some(std::time::Instant::now());
        }
        Ok(())
    }

    pub async fn list_credentials(
        &mut self,
        mut filter: Option<CredentialFilter>,
    ) -> Result<Vec<DashlaneCredential>, DashlaneError> {
        if let Some(value) = filter.as_mut() {
            validate_filter(value)?;
            value.limit = Some(value.limit.unwrap_or(MAX_RESULTS).min(MAX_RESULTS));
        }
        self.ensure_vault().await?;
        let data = self.vault_data.as_ref().ok_or(DashlaneError::VaultLocked)?;
        let mut result = match filter {
            Some(value) => items::filter_credentials(&data.credentials, &value),
            None => data.credentials.clone(),
        };
        result.truncate(MAX_RESULTS);
        Ok(result)
    }

    pub async fn get_credential(&mut self, id: &str) -> Result<DashlaneCredential, DashlaneError> {
        validate_id(id)?;
        self.ensure_vault().await?;
        items::find_by_id(
            &self
                .vault_data
                .as_ref()
                .ok_or(DashlaneError::VaultLocked)?
                .credentials,
            id,
        )
        .cloned()
        .ok_or_else(|| DashlaneError::NotFound("Credential not found".into()))
    }

    pub async fn search_credentials(
        &mut self,
        query: &str,
    ) -> Result<Vec<DashlaneCredential>, DashlaneError> {
        validate_text("Query", query, MAX_QUERY_BYTES, false)?;
        self.list_credentials(Some(CredentialFilter {
            query: Some(query.to_string()),
            limit: Some(MAX_RESULTS),
            ..Default::default()
        }))
        .await
    }

    pub async fn search_by_url(
        &mut self,
        value: &str,
    ) -> Result<Vec<DashlaneCredential>, DashlaneError> {
        validate_text("URL", value, MAX_QUERY_BYTES, false)?;
        let parsed =
            url::Url::parse(value).map_err(|_| DashlaneError::BadRequest("Invalid URL".into()))?;
        if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
            return Err(DashlaneError::BadRequest("Invalid URL".into()));
        }
        self.ensure_vault().await?;
        let mut result = items::find_by_url(
            &self
                .vault_data
                .as_ref()
                .ok_or(DashlaneError::VaultLocked)?
                .credentials,
            value,
        );
        result.truncate(MAX_RESULTS);
        Ok(result)
    }

    pub async fn create_credential(
        &mut self,
        _req: &CreateCredentialRequest,
    ) -> Result<DashlaneCredential, DashlaneError> {
        Err(remote_mutation_unavailable())
    }

    pub async fn update_credential(
        &mut self,
        _id: &str,
        _req: &UpdateCredentialRequest,
    ) -> Result<DashlaneCredential, DashlaneError> {
        Err(remote_mutation_unavailable())
    }

    pub async fn delete_credential(&mut self, _id: &str) -> Result<(), DashlaneError> {
        Err(remote_mutation_unavailable())
    }

    pub async fn find_duplicate_passwords(
        &mut self,
    ) -> Result<Vec<Vec<DashlaneCredential>>, DashlaneError> {
        self.ensure_vault().await?;
        let mut groups = items::find_duplicates(
            &self
                .vault_data
                .as_ref()
                .ok_or(DashlaneError::VaultLocked)?
                .credentials,
        );
        groups.truncate(MAX_RESULTS);
        for group in &mut groups {
            group.truncate(MAX_RESULTS);
        }
        Ok(groups)
    }

    pub async fn get_categories(&mut self) -> Result<Vec<String>, DashlaneError> {
        self.ensure_vault().await?;
        let mut categories = items::get_categories(
            &self
                .vault_data
                .as_ref()
                .ok_or(DashlaneError::VaultLocked)?
                .credentials,
        );
        categories.truncate(MAX_CATEGORIES);
        Ok(categories)
    }

    pub async fn list_notes(&mut self) -> Result<Vec<SecureNote>, DashlaneError> {
        Err(remote_read_unavailable("secure notes"))
    }

    pub async fn get_note(&self, _id: &str) -> Result<SecureNote, DashlaneError> {
        Err(remote_read_unavailable("secure notes"))
    }

    pub async fn search_notes(&self, _query: &str) -> Result<Vec<SecureNote>, DashlaneError> {
        Err(remote_read_unavailable("secure notes"))
    }

    pub async fn create_note(
        &mut self,
        _title: String,
        _content: &str,
        _category: Option<String>,
        _secured: bool,
    ) -> Result<SecureNote, DashlaneError> {
        Err(remote_mutation_unavailable())
    }

    pub async fn delete_note(&mut self, _id: &str) -> Result<(), DashlaneError> {
        Err(remote_mutation_unavailable())
    }

    pub async fn list_identities(&self) -> Result<Vec<DashlaneIdentity>, DashlaneError> {
        Err(remote_read_unavailable("identities"))
    }

    pub async fn create_identity(
        &mut self,
        _first_name: String,
        _last_name: String,
        _email: Option<String>,
        _phone: Option<String>,
    ) -> Result<DashlaneIdentity, DashlaneError> {
        Err(remote_mutation_unavailable())
    }

    pub async fn list_secrets(&self) -> Result<Vec<DashlaneSecret>, DashlaneError> {
        Err(remote_read_unavailable("secrets"))
    }

    pub async fn create_secret(
        &mut self,
        _title: String,
        _content: &str,
        _category: Option<String>,
    ) -> Result<DashlaneSecret, DashlaneError> {
        Err(remote_mutation_unavailable())
    }

    pub async fn list_devices(&mut self) -> Result<Vec<RegisteredDevice>, DashlaneError> {
        let session = self.require_session()?;
        let current_device_id = devices::device_id_for_access_key(&session.device_access_key);
        let client = self.client.as_ref().ok_or(DashlaneError::NotConfigured)?;
        let mut result = devices::list_devices(client).await?;
        devices::identify_current_device_by_id(&mut result, &current_device_id);
        result.truncate(512);
        Ok(result)
    }

    pub async fn deregister_device(&self, _device_id: &str) -> Result<(), DashlaneError> {
        Err(remote_mutation_unavailable())
    }

    pub async fn list_sharing_groups(&self) -> Result<Vec<SharingGroup>, DashlaneError> {
        Err(remote_read_unavailable("sharing groups"))
    }

    pub async fn create_sharing_group(
        &mut self,
        _name: String,
        _owner_id: String,
        _owner_name: String,
    ) -> Result<SharingGroup, DashlaneError> {
        Err(remote_mutation_unavailable())
    }

    pub async fn get_dark_web_alerts(&self) -> Result<Vec<DarkWebAlert>, DashlaneError> {
        Err(remote_read_unavailable("dark web alerts"))
    }

    pub async fn get_active_dark_web_alerts(&self) -> Result<Vec<DarkWebAlert>, DashlaneError> {
        Err(remote_read_unavailable("dark web alerts"))
    }

    pub async fn dismiss_dark_web_alert(&mut self, _id: &str) -> Result<(), DashlaneError> {
        Err(remote_mutation_unavailable())
    }

    pub async fn get_password_health(&mut self) -> Result<PasswordHealthScore, DashlaneError> {
        self.ensure_vault().await?;
        Ok(password_health::analyze_password_health(
            &self
                .vault_data
                .as_ref()
                .ok_or(DashlaneError::VaultLocked)?
                .credentials,
        ))
    }

    pub fn generate_password(&self, config: PasswordGenConfig) -> Result<String, DashlaneError> {
        password_gen::generate_password(&config)
    }

    pub fn generate_passphrase(
        &self,
        word_count: usize,
        separator: &str,
        capitalize: bool,
    ) -> Result<String, DashlaneError> {
        password_gen::generate_passphrase(word_count, separator, capitalize)
    }

    pub fn check_password_strength(&self, password: &str) -> Result<(u32, String), DashlaneError> {
        validate_text("Password", password, MAX_SECRET_BYTES, true)?;
        Ok((
            password_health::assess_password_strength(password),
            password_gen::rate_strength(password),
        ))
    }

    pub async fn export_csv(&mut self) -> Result<ExportResult, DashlaneError> {
        Err(DashlaneError::unsupported(
            "Secret-bearing in-memory export is disabled",
        ))
    }

    pub async fn export_json(&mut self) -> Result<ExportResult, DashlaneError> {
        Err(DashlaneError::unsupported(
            "Secret-bearing in-memory export is disabled",
        ))
    }

    pub fn import_csv(
        &mut self,
        _csv_content: &str,
        _source: ImportSource,
    ) -> Result<ImportResult, DashlaneError> {
        Err(DashlaneError::unsupported(
            "Dashlane import persistence is not implemented",
        ))
    }

    pub async fn get_stats(&mut self) -> Result<VaultStats, DashlaneError> {
        self.ensure_vault().await?;
        let data = self.vault_data.as_ref().ok_or(DashlaneError::VaultLocked)?;
        let mut categories = items::count_by_category(&data.credentials);
        categories.truncate(MAX_CATEGORIES);
        Ok(VaultStats {
            total_credentials: data.credentials.len(),
            total_notes: data.secure_notes.len(),
            total_identities: data.identities_count as usize,
            total_credit_cards: data.credit_cards_count as usize,
            total_bank_accounts: data.bank_accounts_count as usize,
            categories,
        })
    }
}

fn validate_text(
    label: &str,
    value: &str,
    max_bytes: usize,
    allow_empty: bool,
) -> Result<(), DashlaneError> {
    if (!allow_empty && value.is_empty())
        || value.len() > max_bytes
        || value.chars().any(char::is_control)
    {
        return Err(DashlaneError::BadRequest(format!("Invalid {}", label)));
    }
    Ok(())
}

fn validate_id(value: &str) -> Result<(), DashlaneError> {
    validate_text("identifier", value, MAX_ID_BYTES, false)?;
    if !value
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
    {
        return Err(DashlaneError::BadRequest("Invalid identifier".into()));
    }
    Ok(())
}

fn validate_filter(filter: &CredentialFilter) -> Result<(), DashlaneError> {
    if let Some(query) = filter.query.as_deref() {
        validate_text("query", query, MAX_QUERY_BYTES, true)?;
    }
    if let Some(category) = filter.category.as_deref() {
        validate_text("category", category, 128, false)?;
    }
    if filter.limit.is_some_and(|limit| limit > MAX_RESULTS) {
        return Err(DashlaneError::BadRequest(
            "Result limit is too large".into(),
        ));
    }
    if let Some(sort) = filter.sort_by.as_deref() {
        if !matches!(sort, "title" | "url" | "modified" | "last_used") {
            return Err(DashlaneError::BadRequest("Invalid sort field".into()));
        }
    }
    Ok(())
}

fn remote_mutation_unavailable() -> DashlaneError {
    DashlaneError::unsupported(
        "Dashlane mutation is unavailable until authenticated encrypted sync is implemented",
    )
}

fn remote_read_unavailable(resource: &str) -> DashlaneError {
    DashlaneError::unsupported(format!(
        "Dashlane {} are unavailable until authenticated vault decryption is implemented",
        resource
    ))
}
