use crate::google_passwords::api_client::GoogleApiClient;
use crate::google_passwords::auth;
use crate::google_passwords::import_export;
use crate::google_passwords::items;
use crate::google_passwords::password_gen;
use crate::google_passwords::security;
use crate::google_passwords::sync::SyncEngine;
use crate::google_passwords::types::*;
use std::sync::Arc;
use tokio::sync::Mutex;

pub type GooglePasswordsServiceState = Arc<Mutex<GooglePasswordsService>>;

pub struct GooglePasswordsService {
    config: Option<GooglePasswordsConfig>,
    client: Option<GoogleApiClient>,
    credentials: Vec<Credential>,
    sync_engine: SyncEngine,
    cached_at: Option<chrono::DateTime<chrono::Utc>>,
}

impl GooglePasswordsService {
    pub fn new() -> Self {
        Self {
            config: None,
            client: None,
            credentials: Vec::new(),
            sync_engine: SyncEngine::new(),
            cached_at: None,
        }
    }

    pub fn new_state() -> GooglePasswordsServiceState {
        Arc::new(Mutex::new(Self::new()))
    }

    // ─── Configuration ───────────────────────────────────────────

    pub fn configure(&mut self, config: GooglePasswordsConfig) -> Result<(), GooglePasswordsError> {
        if config.client_id.is_empty() {
            return Err(GooglePasswordsError::config_error("OAuth client ID is required"));
        }
        let client = GoogleApiClient::new(&config)?;
        self.config = Some(config);
        self.client = Some(client);
        Ok(())
    }

    pub fn is_configured(&self) -> bool {
        self.config.is_some()
    }

    pub fn is_authenticated(&self) -> bool {
        self.client.as_ref().map(|c| c.has_token()).unwrap_or(false)
    }

    // ─── OAuth ───────────────────────────────────────────────────

    pub fn get_auth_url(&self) -> Result<String, GooglePasswordsError> {
        let config = self
            .config
            .as_ref()
            .ok_or_else(|| GooglePasswordsError::config_error("Not configured"))?;
        let state = auth::generate_oauth_state();
        Ok(auth::get_authorization_url(config, &state)?)
    }

    pub async fn authenticate(&mut self, code: &str) -> Result<(), GooglePasswordsError> {
        let client = self
            .client
            .as_mut()
            .ok_or_else(|| GooglePasswordsError::config_error("Not configured"))?;
        auth::exchange_code(client, code).await?;
        Ok(())
    }

    pub async fn refresh_auth(&mut self) -> Result<(), GooglePasswordsError> {
        let client = self
            .client
            .as_mut()
            .ok_or_else(|| GooglePasswordsError::config_error("Not configured"))?;
        auth::refresh_token(client).await?;
        Ok(())
    }

    pub async fn logout(&mut self) -> Result<(), GooglePasswordsError> {
        if let Some(ref mut client) = self.client {
            auth::revoke(client).await?;
        }
        self.credentials.clear();
        self.cached_at = None;
        Ok(())
    }

    // ─── Credentials (local store + CSV-based) ───────────────────

    pub fn list_credentials(
        &self,
        filter: Option<CredentialFilter>,
    ) -> Vec<Credential> {
        if let Some(filter) = filter {
            items::filter_credentials(&self.credentials, &filter)
        } else {
            self.credentials.clone()
        }
    }

    pub fn get_credential(&self, id: &str) -> Result<Credential, GooglePasswordsError> {
        items::find_by_id(&self.credentials, id)
            .cloned()
            .ok_or_else(|| GooglePasswordsError::not_found("Credential", id))
    }

    pub fn search_credentials(&self, query: &str) -> Vec<Credential> {
        items::find_by_name(&self.credentials, query)
    }

    pub fn search_by_url(&self, url: &str) -> Vec<Credential> {
        items::find_by_url(&self.credentials, url)
    }

    pub fn create_credential(
        &mut self,
        request: CreateCredentialRequest,
    ) -> Result<Credential, GooglePasswordsError> {
        let cred = Credential {
            id: uuid::Uuid::new_v4().to_string(),
            name: request.name,
            url: request.url,
            username: request.username,
            password: request.password.clone(),
            notes: request.notes,
            folder: request.folder,
            created_at: Some(chrono::Utc::now().to_rfc3339()),
            modified_at: None,
            last_used_at: None,
            compromised: false,
            weak: items::assess_strength(&request.password) == PasswordStrength::VeryWeak
                || items::assess_strength(&request.password) == PasswordStrength::Weak,
            reused: false,
            password_strength: Some(items::assess_strength(&request.password)),
            android_app: None,
        };

        self.credentials.push(cred.clone());
        self.sync_engine.queue_add(cred.clone());
        Ok(cred)
    }

    pub fn update_credential(
        &mut self,
        request: UpdateCredentialRequest,
    ) -> Result<Credential, GooglePasswordsError> {
        let idx = self
            .credentials
            .iter()
            .position(|c| c.id == request.id)
            .ok_or_else(|| GooglePasswordsError::not_found("Credential", &request.id))?;

        let cred = &mut self.credentials[idx];
        if let Some(name) = request.name {
            cred.name = name;
        }
        if let Some(url) = request.url {
            cred.url = url;
        }
        if let Some(username) = request.username {
            cred.username = username;
        }
        if let Some(password) = request.password {
            cred.password_strength = Some(items::assess_strength(&password));
            cred.weak = matches!(
                cred.password_strength,
                Some(PasswordStrength::VeryWeak) | Some(PasswordStrength::Weak)
            );
            cred.password = password;
        }
        if let Some(notes) = request.notes {
            cred.notes = Some(notes);
        }
        if let Some(folder) = request.folder {
            cred.folder = Some(folder);
        }
        cred.modified_at = Some(chrono::Utc::now().to_rfc3339());

        let updated = cred.clone();
        self.sync_engine.queue_update(updated.clone());
        Ok(updated)
    }

    pub fn delete_credential(&mut self, id: &str) -> Result<(), GooglePasswordsError> {
        let idx = self
            .credentials
            .iter()
            .position(|c| c.id == id)
            .ok_or_else(|| GooglePasswordsError::not_found("Credential", id))?;

        self.credentials.remove(idx);
        self.sync_engine.queue_delete(id.to_string());
        Ok(())
    }

    // ─── Security ────────────────────────────────────────────────

    pub fn run_checkup(&mut self) -> PasswordCheckupResult {
        items::run_security_analysis(&mut self.credentials);
        security::run_checkup(&self.credentials)
    }

    pub fn get_insecure_urls(&self) -> Vec<Credential> {
        security::find_insecure_urls(&self.credentials)
    }

    // ─── Import/Export ───────────────────────────────────────────

    pub fn import_csv(
        &mut self,
        csv_data: &str,
        source: ImportSource,
    ) -> Result<ImportResult, GooglePasswordsError> {
        let (mut new_creds, result) = import_export::import_credentials(csv_data, &source)?;
        items::run_security_analysis(&mut new_creds);
        self.credentials.extend(new_creds);
        Ok(result)
    }

    pub fn export_csv(&self) -> ExportResult {
        import_export::export_google_csv(&self.credentials)
    }

    pub fn export_json(&self) -> Result<ExportResult, GooglePasswordsError> {
        import_export::export_json(&self.credentials)
    }

    // ─── Password Generation ─────────────────────────────────────

    pub fn generate_password(
        &self,
        config: Option<PasswordGenConfig>,
    ) -> Result<String, GooglePasswordsError> {
        password_gen::generate_password(&config.unwrap_or_default())
    }

    pub fn check_password_strength(&self, password: &str) -> (f64, &'static str) {
        let entropy = password_gen::calculate_entropy(password);
        (entropy, password_gen::rate_strength(entropy))
    }

    // ─── Stats ───────────────────────────────────────────────────

    pub fn get_stats(&self) -> VaultStats {
        let folders = items::get_folders(&self.credentials);
        let total_length: usize = self
            .credentials
            .iter()
            .filter(|c| !c.password.is_empty())
            .map(|c| c.password.len())
            .sum();
        let non_empty = self
            .credentials
            .iter()
            .filter(|c| !c.password.is_empty())
            .count();

        VaultStats {
            total_credentials: self.credentials.len() as u64,
            total_folders: folders.len() as u64,
            compromised_count: self.credentials.iter().filter(|c| c.compromised).count() as u64,
            weak_count: self.credentials.iter().filter(|c| c.weak).count() as u64,
            reused_count: self.credentials.iter().filter(|c| c.reused).count() as u64,
            average_password_length: if non_empty > 0 {
                total_length as f64 / non_empty as f64
            } else {
                0.0
            },
            oldest_password_days: 0,
        }
    }

    // ─── Sync ────────────────────────────────────────────────────

    pub fn get_sync_info(&self) -> SyncInfo {
        self.sync_engine.get_info()
    }
}
