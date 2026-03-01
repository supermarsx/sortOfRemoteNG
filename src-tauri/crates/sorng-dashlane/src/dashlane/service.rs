use std::sync::Arc;
use tokio::sync::Mutex;

use crate::dashlane::api_client::DashlaneApiClient;
use crate::dashlane::types::*;
use crate::dashlane::vault::{parse_vault_transactions, VaultData};
use crate::dashlane::{auth, items, notes, identities, secrets, devices, sharing, dark_web, password_health, password_gen, import_export};

pub type DashlaneServiceState = Arc<Mutex<DashlaneService>>;

pub struct DashlaneService {
    config: Option<DashlaneConfig>,
    session: Option<DashlaneSession>,
    client: Option<DashlaneApiClient>,
    vault_data: Option<VaultData>,
    vault_fetched_at: Option<std::time::Instant>,
    secure_notes: Vec<SecureNote>,
    identities_list: Vec<DashlaneIdentity>,
    secrets_list: Vec<DashlaneSecret>,
    sharing_groups: Vec<SharingGroup>,
    dark_web_alerts: Vec<DarkWebAlert>,
}

impl DashlaneService {
    pub fn new() -> Self {
        Self {
            config: None,
            session: None,
            client: None,
            vault_data: None,
            vault_fetched_at: None,
            secure_notes: Vec::new(),
            identities_list: Vec::new(),
            secrets_list: Vec::new(),
            sharing_groups: Vec::new(),
            dark_web_alerts: Vec::new(),
        }
    }

    pub fn configure(&mut self, config: DashlaneConfig) -> Result<(), DashlaneError> {
        if config.email.is_empty() {
            return Err(DashlaneError::InvalidConfig("Email is required".into()));
        }
        self.client = Some(DashlaneApiClient::new(&config)?);
        self.config = Some(config);
        Ok(())
    }

    pub async fn login(&mut self, master_password: &str) -> Result<(), DashlaneError> {
        let config = self.config.clone().ok_or(DashlaneError::NotConfigured)?;
        let client = self.client.as_mut().ok_or(DashlaneError::NotConfigured)?;
        let session = auth::login(client, &config, master_password, None).await?;
        self.session = Some(session);
        Ok(())
    }

    pub async fn login_with_token(
        &mut self,
        master_password: &str,
        token: &str,
    ) -> Result<(), DashlaneError> {
        let config = self.config.clone().ok_or(DashlaneError::NotConfigured)?;
        let client = self.client.as_mut().ok_or(DashlaneError::NotConfigured)?;

        // Complete device registration with token
        client.complete_device_registration(&config.email, token).await?;

        // Now authenticate
        let session = auth::login(client, &config, master_password, Some(token)).await?;
        self.session = Some(session);
        Ok(())
    }

    pub async fn logout(&mut self) -> Result<(), DashlaneError> {
        if let Some(ref mut client) = self.client {
            let _ = auth::logout(client).await;
        }
        self.session = None;
        self.vault_data = None;
        self.vault_fetched_at = None;
        self.secure_notes.clear();
        self.identities_list.clear();
        self.secrets_list.clear();
        Ok(())
    }

    pub fn is_authenticated(&self) -> bool {
        self.session.is_some()
    }

    async fn ensure_vault(&mut self) -> Result<(), DashlaneError> {
        let cache_ttl = std::time::Duration::from_secs(300); // 5 min
        let needs_refresh = match self.vault_fetched_at {
            Some(t) => t.elapsed() > cache_ttl,
            None => true,
        };

        if needs_refresh || self.vault_data.is_none() {
            let client = self.client.as_ref().ok_or(DashlaneError::NotConfigured)?;
            let response = client.get_latest_content().await?;
            let transactions = response.transactions.unwrap_or_default();

            let data = parse_vault_transactions(&transactions, &[])?;
            self.secure_notes = data.secure_notes.clone();
            self.vault_data = Some(data);
            self.vault_fetched_at = Some(std::time::Instant::now());
        }

        Ok(())
    }

    // --- Credentials ---

    pub async fn list_credentials(
        &mut self,
        filter: Option<CredentialFilter>,
    ) -> Result<Vec<DashlaneCredential>, DashlaneError> {
        self.ensure_vault().await?;
        let data = self.vault_data.as_ref().ok_or(DashlaneError::VaultLocked)?;
        match filter {
            Some(f) => Ok(items::filter_credentials(&data.credentials, &f)),
            None => Ok(data.credentials.clone()),
        }
    }

    pub async fn get_credential(&mut self, id: &str) -> Result<DashlaneCredential, DashlaneError> {
        self.ensure_vault().await?;
        let data = self.vault_data.as_ref().ok_or(DashlaneError::VaultLocked)?;
        items::find_by_id(&data.credentials, id)
            .cloned()
            .ok_or_else(|| DashlaneError::NotFound(format!("Credential {}", id)))
    }

    pub async fn search_credentials(&mut self, query: &str) -> Result<Vec<DashlaneCredential>, DashlaneError> {
        let filter = CredentialFilter {
            query: Some(query.to_string()),
            ..Default::default()
        };
        self.list_credentials(Some(filter)).await
    }

    pub async fn search_by_url(&mut self, url: &str) -> Result<Vec<DashlaneCredential>, DashlaneError> {
        self.ensure_vault().await?;
        let data = self.vault_data.as_ref().ok_or(DashlaneError::VaultLocked)?;
        Ok(items::find_by_url(&data.credentials, url))
    }

    pub async fn create_credential(
        &mut self,
        req: CreateCredentialRequest,
    ) -> Result<DashlaneCredential, DashlaneError> {
        let cred = items::prepare_credential(&req);
        if let Some(ref mut data) = self.vault_data {
            data.credentials.push(cred.clone());
        }
        Ok(cred)
    }

    pub async fn update_credential(
        &mut self,
        id: &str,
        req: UpdateCredentialRequest,
    ) -> Result<DashlaneCredential, DashlaneError> {
        let data = self.vault_data.as_mut().ok_or(DashlaneError::VaultLocked)?;
        let cred = data
            .credentials
            .iter_mut()
            .find(|c| c.id == id)
            .ok_or_else(|| DashlaneError::NotFound(format!("Credential {}", id)))?;
        items::apply_update(cred, &req)?;
        Ok(cred.clone())
    }

    pub async fn delete_credential(&mut self, id: &str) -> Result<(), DashlaneError> {
        let data = self.vault_data.as_mut().ok_or(DashlaneError::VaultLocked)?;
        let len_before = data.credentials.len();
        data.credentials.retain(|c| c.id != id);
        if data.credentials.len() == len_before {
            return Err(DashlaneError::NotFound(format!("Credential {}", id)));
        }
        Ok(())
    }

    pub async fn find_duplicate_passwords(&mut self) -> Result<Vec<Vec<DashlaneCredential>>, DashlaneError> {
        self.ensure_vault().await?;
        let data = self.vault_data.as_ref().ok_or(DashlaneError::VaultLocked)?;
        Ok(items::find_duplicates(&data.credentials))
    }

    pub async fn get_categories(&mut self) -> Result<Vec<String>, DashlaneError> {
        self.ensure_vault().await?;
        let data = self.vault_data.as_ref().ok_or(DashlaneError::VaultLocked)?;
        Ok(items::get_categories(&data.credentials))
    }

    // --- Secure Notes ---

    pub async fn list_notes(&mut self) -> Result<Vec<SecureNote>, DashlaneError> {
        self.ensure_vault().await?;
        Ok(self.secure_notes.clone())
    }

    pub async fn get_note(&self, id: &str) -> Result<SecureNote, DashlaneError> {
        notes::find_note_by_id(&self.secure_notes, id)
            .cloned()
            .ok_or_else(|| DashlaneError::NotFound(format!("Note {}", id)))
    }

    pub async fn search_notes(&self, query: &str) -> Result<Vec<SecureNote>, DashlaneError> {
        Ok(notes::search_notes(&self.secure_notes, query))
    }

    pub async fn create_note(
        &mut self,
        title: String,
        content: String,
        category: Option<String>,
        secured: bool,
    ) -> Result<SecureNote, DashlaneError> {
        let note = notes::create_note(title, content, category, secured, None);
        self.secure_notes.push(note.clone());
        Ok(note)
    }

    pub async fn delete_note(&mut self, id: &str) -> Result<(), DashlaneError> {
        let len_before = self.secure_notes.len();
        self.secure_notes.retain(|n| n.id != id);
        if self.secure_notes.len() == len_before {
            return Err(DashlaneError::NotFound(format!("Note {}", id)));
        }
        Ok(())
    }

    // --- Identities ---

    pub async fn list_identities(&self) -> Result<Vec<DashlaneIdentity>, DashlaneError> {
        Ok(self.identities_list.clone())
    }

    pub async fn create_identity(
        &mut self,
        first_name: String,
        last_name: String,
        email: Option<String>,
        phone: Option<String>,
    ) -> Result<DashlaneIdentity, DashlaneError> {
        let identity = identities::create_identity(first_name, last_name, email, phone);
        self.identities_list.push(identity.clone());
        Ok(identity)
    }

    // --- Secrets ---

    pub async fn list_secrets(&self) -> Result<Vec<DashlaneSecret>, DashlaneError> {
        Ok(self.secrets_list.clone())
    }

    pub async fn create_secret(
        &mut self,
        title: String,
        content: String,
        category: Option<String>,
    ) -> Result<DashlaneSecret, DashlaneError> {
        let secret = secrets::create_secret(title, content, category);
        self.secrets_list.push(secret.clone());
        Ok(secret)
    }

    // --- Devices ---

    pub async fn list_devices(&mut self) -> Result<Vec<RegisteredDevice>, DashlaneError> {
        let client = self.client.as_ref().ok_or(DashlaneError::NotConfigured)?;
        let mut devs = devices::list_devices(client).await?;
        if let Some(ref session) = self.session {
            devices::identify_current_device(&mut devs, &session.device_access_key);
        }
        Ok(devs)
    }

    pub async fn deregister_device(&self, device_id: &str) -> Result<(), DashlaneError> {
        let client = self.client.as_ref().ok_or(DashlaneError::NotConfigured)?;
        devices::deregister_device(client, device_id).await
    }

    // --- Sharing ---

    pub async fn list_sharing_groups(&self) -> Result<Vec<SharingGroup>, DashlaneError> {
        Ok(self.sharing_groups.clone())
    }

    pub async fn create_sharing_group(
        &mut self,
        name: String,
        owner_id: String,
        owner_name: String,
    ) -> Result<SharingGroup, DashlaneError> {
        let group = sharing::create_sharing_group(name, owner_id, owner_name);
        self.sharing_groups.push(group.clone());
        Ok(group)
    }

    // --- Dark Web ---

    pub async fn get_dark_web_alerts(&self) -> Result<Vec<DarkWebAlert>, DashlaneError> {
        Ok(self.dark_web_alerts.clone())
    }

    pub async fn get_active_dark_web_alerts(&self) -> Result<Vec<DarkWebAlert>, DashlaneError> {
        Ok(dark_web::get_active_alerts(&self.dark_web_alerts))
    }

    pub async fn dismiss_dark_web_alert(&mut self, id: &str) -> Result<(), DashlaneError> {
        let alert = self
            .dark_web_alerts
            .iter_mut()
            .find(|a| a.id == id)
            .ok_or_else(|| DashlaneError::NotFound(format!("Alert {}", id)))?;
        dark_web::mark_resolved(alert);
        Ok(())
    }

    // --- Password Health ---

    pub async fn get_password_health(&mut self) -> Result<PasswordHealthScore, DashlaneError> {
        self.ensure_vault().await?;
        let data = self.vault_data.as_ref().ok_or(DashlaneError::VaultLocked)?;
        Ok(password_health::analyze_password_health(&data.credentials))
    }

    // --- Password Generation ---

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

    pub fn check_password_strength(&self, password: &str) -> (u32, String) {
        let score = password_health::assess_password_strength(password);
        let rating = password_gen::rate_strength(password);
        (score, rating)
    }

    // --- Import/Export ---

    pub async fn export_csv(&mut self) -> Result<ExportResult, DashlaneError> {
        self.ensure_vault().await?;
        let data = self.vault_data.as_ref().ok_or(DashlaneError::VaultLocked)?;
        import_export::export_csv(&data.credentials)
    }

    pub async fn export_json(&mut self) -> Result<ExportResult, DashlaneError> {
        self.ensure_vault().await?;
        let data = self.vault_data.as_ref().ok_or(DashlaneError::VaultLocked)?;
        import_export::export_json(&data.credentials)
    }

    pub fn import_csv(&mut self, csv_content: &str, source: ImportSource) -> Result<ImportResult, DashlaneError> {
        match source {
            ImportSource::DashlaneCsv => import_export::import_dashlane_csv(csv_content),
            ImportSource::LastPassCsv => import_export::import_lastpass_csv(csv_content),
            ImportSource::OnePasswordCsv => import_export::import_1password_csv(csv_content),
            ImportSource::ChromeCsv => import_export::import_chrome_csv(csv_content),
            _ => Err(DashlaneError::InvalidConfig(format!("Unsupported import source: {:?}", source))),
        }
    }

    // --- Stats ---

    pub async fn get_stats(&mut self) -> Result<VaultStats, DashlaneError> {
        self.ensure_vault().await?;
        let data = self.vault_data.as_ref().ok_or(DashlaneError::VaultLocked)?;

        Ok(VaultStats {
            total_credentials: data.credentials.len(),
            total_notes: self.secure_notes.len(),
            total_identities: data.identities_count as usize,
            total_credit_cards: data.credit_cards_count as usize,
            total_bank_accounts: data.bank_accounts_count as usize,
            categories: items::count_by_category(&data.credentials),
        })
    }
}
