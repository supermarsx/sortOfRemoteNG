use crate::dashlane::types::{DashlaneConfig, DashlaneError};
use reqwest::{Client, Response, StatusCode};
use serde::de::DeserializeOwned;
use std::time::Duration;

/// HTTP client for Dashlane API interactions.
#[derive(Debug, Clone)]
pub struct DashlaneApiClient {
    client: Client,
    base_url: String,
    device_access_key: Option<String>,
    device_secret_key: Option<String>,
}

impl DashlaneApiClient {
    pub fn new(config: &DashlaneConfig) -> Result<Self, DashlaneError> {
        let client = Client::builder()
            .timeout(Duration::from_secs(config.timeout_secs))
            .user_agent("sortOfRemoteNG/1.0 (Dashlane Integration)")
            .build()
            .map_err(|e| DashlaneError::connection_error(format!("Failed to build HTTP client: {}", e)))?;

        Ok(Self {
            client,
            base_url: config.server_url.trim_end_matches('/').to_string(),
            device_access_key: None,
            device_secret_key: None,
        })
    }

    pub fn set_device_keys(&mut self, access_key: String, secret_key: String) {
        self.device_access_key = Some(access_key);
        self.device_secret_key = Some(secret_key);
    }

    pub fn clear_session(&mut self) {
        self.device_access_key = None;
        self.device_secret_key = None;
    }

    pub fn has_session(&self) -> bool {
        self.device_access_key.is_some()
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.base_url, path)
    }

    async fn handle_response(&self, response: Response) -> Result<String, DashlaneError> {
        let status = response.status();
        if status == StatusCode::UNAUTHORIZED {
            return Err(DashlaneError::session_expired());
        }
        if status == StatusCode::FORBIDDEN {
            return Err(DashlaneError::auth_failed("Access denied by Dashlane"));
        }
        if status == StatusCode::TOO_MANY_REQUESTS {
            return Err(DashlaneError::RateLimited);
        }
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(DashlaneError::server_error(format!(
                "HTTP {} — {}",
                status.as_u16(),
                body
            )).with_status(status.as_u16()));
        }
        response
            .text()
            .await
            .map_err(|e| DashlaneError::server_error(format!("Failed to read response: {}", e)))
    }

    async fn handle_json<T: DeserializeOwned>(&self, response: Response) -> Result<T, DashlaneError> {
        let text = self.handle_response(response).await?;
        serde_json::from_str(&text)
            .map_err(|e| DashlaneError::parse_error(format!("JSON parse error: {}", e)))
    }

    fn auth_headers(&self) -> Result<Vec<(String, String)>, DashlaneError> {
        let access_key = self
            .device_access_key
            .as_ref()
            .ok_or_else(|| DashlaneError::auth_failed("Not authenticated"))?;
        let secret_key = self
            .device_secret_key
            .as_ref()
            .ok_or_else(|| DashlaneError::auth_failed("No device secret key"))?;

        Ok(vec![
            ("X-Device-Access-Key".to_string(), access_key.clone()),
            ("X-Device-Secret-Key".to_string(), secret_key.clone()),
        ])
    }

    /// Register a new device with Dashlane.
    pub async fn register_device(
        &self,
        login: &str,
        device_name: &str,
    ) -> Result<DeviceRegistrationResponse, DashlaneError> {
        let body = serde_json::json!({
            "login": login,
            "deviceName": device_name,
            "appVersion": "1.0.0",
            "platform": "server_standalone",
            "osCountry": "US",
            "osLanguage": "en",
        });

        let response = self
            .client
            .post(self.url("/v1/authentication/RegisterDevice"))
            .json(&body)
            .send()
            .await?;

        self.handle_json(response).await
    }

    /// Complete authentication with email token.
    pub async fn complete_device_registration(
        &self,
        login: &str,
        token: &str,
    ) -> Result<DeviceRegistrationResponse, DashlaneError> {
        let body = serde_json::json!({
            "login": login,
            "token": token,
        });

        let response = self
            .client
            .post(self.url("/v1/authentication/CompleteDeviceRegistration"))
            .json(&body)
            .send()
            .await?;

        self.handle_json(response).await
    }

    /// Perform the authentication handshake.
    pub async fn perform_authentication(
        &self,
        login: &str,
        master_password_hash: &str,
    ) -> Result<AuthenticationResponse, DashlaneError> {
        let headers = self.auth_headers()?;

        let body = serde_json::json!({
            "login": login,
            "hashValue": master_password_hash,
        });

        let mut req = self
            .client
            .post(self.url("/v1/authentication/PerformSSOVerification"));
        for (k, v) in &headers {
            req = req.header(k, v);
        }

        let response = req.json(&body).send().await?;
        self.handle_json(response).await
    }

    /// Fetch the encrypted vault data.
    pub async fn get_latest_content(&self) -> Result<VaultContentResponse, DashlaneError> {
        let headers = self.auth_headers()?;

        let mut req = self
            .client
            .post(self.url("/v1/sync/GetLatestContent"));
        for (k, v) in &headers {
            req = req.header(k, v);
        }

        let body = serde_json::json!({
            "needsKeys": false,
            "timestamp": 0,
        });

        let response = req.json(&body).send().await?;
        self.handle_json(response).await
    }

    /// Upload vault changes.
    pub async fn upload_content(
        &self,
        transactions: &[serde_json::Value],
    ) -> Result<String, DashlaneError> {
        let headers = self.auth_headers()?;

        let body = serde_json::json!({
            "transactions": transactions,
        });

        let mut req = self
            .client
            .post(self.url("/v1/sync/UploadContent"));
        for (k, v) in &headers {
            req = req.header(k, v);
        }

        let response = req.json(&body).send().await?;
        self.handle_response(response).await
    }

    /// List registered devices.
    pub async fn list_devices(&self) -> Result<Vec<DeviceInfo>, DashlaneError> {
        let headers = self.auth_headers()?;

        let mut req = self
            .client
            .post(self.url("/v1/authentication/ListDevices"));
        for (k, v) in &headers {
            req = req.header(k, v);
        }

        let body = serde_json::json!({});
        let response = req.json(&body).send().await?;
        let result: DeviceListResponse = self.handle_json(response).await?;
        Ok(result.devices)
    }

    /// Deregister (remove) a device.
    pub async fn deregister_device(
        &self,
        device_access_key: &str,
    ) -> Result<(), DashlaneError> {
        let headers = self.auth_headers()?;

        let body = serde_json::json!({
            "deviceAccessKey": device_access_key,
        });

        let mut req = self
            .client
            .post(self.url("/v1/authentication/DeregisterDevice"));
        for (k, v) in &headers {
            req = req.header(k, v);
        }

        let response = req.json(&body).send().await?;
        self.handle_response(response).await?;
        Ok(())
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DeviceRegistrationResponse {
    pub device_access_key: Option<String>,
    pub device_secret_key: Option<String>,
    pub server_key: Option<String>,
    #[serde(default)]
    pub requires_verification: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AuthenticationResponse {
    pub server_key: Option<String>,
    #[serde(default)]
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct VaultContentResponse {
    pub transactions: Option<Vec<serde_json::Value>>,
    pub timestamp: Option<u64>,
    pub sharing2: Option<serde_json::Value>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DeviceInfo {
    pub device_access_key: String,
    pub device_name: String,
    pub platform: String,
    pub created_at: Option<String>,
    pub last_active: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct DeviceListResponse {
    devices: Vec<DeviceInfo>,
}
