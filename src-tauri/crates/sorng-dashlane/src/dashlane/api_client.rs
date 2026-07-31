use crate::dashlane::types::{DashlaneConfig, DashlaneError};
use reqwest::header::{HeaderMap, HeaderValue};
use reqwest::{Client, Response, StatusCode};
use serde::de::DeserializeOwned;
use std::fmt;
use std::time::Duration;
use url::Url;
use zeroize::Zeroize;

const MAX_RESPONSE_BYTES: usize = 16 * 1024 * 1024;
const MAX_UPLOAD_BYTES: usize = 8 * 1024 * 1024;
const MAX_TRANSACTIONS: usize = 10_000;
const MAX_DEVICES: usize = 512;
const MAX_KEY_BYTES: usize = 1_024;

/// HTTP client for explicitly provisioned Dashlane device sessions.
///
/// Interactive authentication is intentionally not implemented: Dashlane does
/// not expose a stable public password-login API for third-party clients.
pub struct DashlaneApiClient {
    client: Client,
    base_url: Url,
    device_access_key: Option<String>,
    device_secret_key: Option<String>,
}

impl fmt::Debug for DashlaneApiClient {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("DashlaneApiClient")
            .field("base_url", &self.base_url)
            .field("authenticated", &self.has_session())
            .finish()
    }
}

impl Drop for DashlaneApiClient {
    fn drop(&mut self) {
        self.clear_session();
    }
}

impl DashlaneApiClient {
    pub fn new(config: &DashlaneConfig) -> Result<Self, DashlaneError> {
        if !(5..=120).contains(&config.timeout_secs) {
            return Err(DashlaneError::InvalidConfig(
                "Request timeout must be between 5 and 120 seconds".into(),
            ));
        }

        let base_url = Url::parse(&config.server_url)
            .map_err(|_| DashlaneError::InvalidConfig("Invalid Dashlane API URL".into()))?;
        if base_url.scheme() != "https"
            || base_url.host_str() != Some("api.dashlane.com")
            || base_url.port_or_known_default() != Some(443)
            || !base_url.username().is_empty()
            || base_url.password().is_some()
            || base_url.query().is_some()
            || base_url.fragment().is_some()
            || base_url.path() != "/"
        {
            return Err(DashlaneError::InvalidConfig(
                "Dashlane API URL must be exactly https://api.dashlane.com".into(),
            ));
        }

        let timeout = Duration::from_secs(config.timeout_secs);
        let client = Client::builder()
            .timeout(timeout)
            .connect_timeout(Duration::from_secs(config.timeout_secs.min(10)))
            .redirect(reqwest::redirect::Policy::none())
            .https_only(true)
            .user_agent("sortOfRemoteNG/1.0 (Dashlane Integration)")
            .build()
            .map_err(|_| DashlaneError::connection_error("Failed to build HTTP client"))?;

        Ok(Self {
            client,
            base_url,
            device_access_key: None,
            device_secret_key: None,
        })
    }

    /// Provision keys obtained through a supported external Dashlane workflow.
    /// Values are never logged and are sent only as sensitive HTTPS headers.
    pub fn set_device_keys(
        &mut self,
        mut access_key: String,
        mut secret_key: String,
    ) -> Result<(), DashlaneError> {
        if !valid_key(&access_key) || !valid_key(&secret_key) {
            access_key.zeroize();
            secret_key.zeroize();
            return Err(DashlaneError::InvalidCredentials);
        }
        self.clear_session();
        self.device_access_key = Some(access_key);
        self.device_secret_key = Some(secret_key);
        Ok(())
    }

    pub fn clear_session(&mut self) {
        if let Some(mut key) = self.device_access_key.take() {
            key.zeroize();
        }
        if let Some(mut key) = self.device_secret_key.take() {
            key.zeroize();
        }
    }

    pub fn has_session(&self) -> bool {
        self.device_access_key.is_some() && self.device_secret_key.is_some()
    }

    fn url(&self, path: &str) -> Result<Url, DashlaneError> {
        self.base_url
            .join(path.trim_start_matches('/'))
            .map_err(|_| DashlaneError::InvalidConfig("Invalid Dashlane API path".into()))
    }

    async fn read_success(
        &self,
        mut response: Response,
        limit: usize,
    ) -> Result<Vec<u8>, DashlaneError> {
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
            return Err(DashlaneError::server_error(format!(
                "Dashlane returned HTTP {}",
                status.as_u16()
            ))
            .with_status(status.as_u16()));
        }
        if response
            .content_length()
            .is_some_and(|length| length > limit as u64)
        {
            return Err(DashlaneError::server_error(
                "Dashlane response exceeded the allowed size",
            ));
        }

        let mut body =
            Vec::with_capacity(response.content_length().unwrap_or(0).min(limit as u64) as usize);
        while let Some(chunk) = response.chunk().await.map_err(DashlaneError::from)? {
            let next_len = body
                .len()
                .checked_add(chunk.len())
                .ok_or_else(|| DashlaneError::server_error("Dashlane response was too large"))?;
            if next_len > limit {
                return Err(DashlaneError::server_error(
                    "Dashlane response exceeded the allowed size",
                ));
            }
            body.extend_from_slice(&chunk);
        }
        Ok(body)
    }

    async fn handle_json<T: DeserializeOwned>(
        &self,
        response: Response,
    ) -> Result<T, DashlaneError> {
        let body = self.read_success(response, MAX_RESPONSE_BYTES).await?;
        serde_json::from_slice(&body)
            .map_err(|_| DashlaneError::parse_error("Invalid JSON in Dashlane response"))
    }

    fn auth_headers(&self) -> Result<HeaderMap, DashlaneError> {
        let access_key = self
            .device_access_key
            .as_deref()
            .ok_or_else(|| DashlaneError::auth_failed("Not authenticated"))?;
        let secret_key = self
            .device_secret_key
            .as_deref()
            .ok_or_else(|| DashlaneError::auth_failed("Not authenticated"))?;

        let mut access =
            HeaderValue::from_str(access_key).map_err(|_| DashlaneError::InvalidCredentials)?;
        let mut secret =
            HeaderValue::from_str(secret_key).map_err(|_| DashlaneError::InvalidCredentials)?;
        access.set_sensitive(true);
        secret.set_sensitive(true);

        let mut headers = HeaderMap::new();
        headers.insert("x-device-access-key", access);
        headers.insert("x-device-secret-key", secret);
        Ok(headers)
    }

    pub(crate) async fn get_latest_content(&self) -> Result<VaultContentResponse, DashlaneError> {
        let response = self
            .client
            .post(self.url("/v1/sync/GetLatestContent")?)
            .headers(self.auth_headers()?)
            .json(&serde_json::json!({ "needsKeys": false, "timestamp": 0 }))
            .send()
            .await?;
        let result: VaultContentResponse = self.handle_json(response).await?;
        if result
            .transactions
            .as_ref()
            .is_some_and(|items| items.len() > MAX_TRANSACTIONS)
        {
            return Err(DashlaneError::server_error(
                "Dashlane returned too many vault transactions",
            ));
        }
        Ok(result)
    }

    pub async fn upload_content(
        &self,
        transactions: &[serde_json::Value],
    ) -> Result<String, DashlaneError> {
        if transactions.len() > MAX_TRANSACTIONS {
            return Err(DashlaneError::BadRequest(
                "Too many vault transactions".into(),
            ));
        }
        let body = serde_json::to_vec(&serde_json::json!({ "transactions": transactions }))
            .map_err(|_| DashlaneError::BadRequest("Invalid vault transactions".into()))?;
        if body.len() > MAX_UPLOAD_BYTES {
            return Err(DashlaneError::BadRequest(
                "Vault upload exceeds the allowed size".into(),
            ));
        }
        let response = self
            .client
            .post(self.url("/v1/sync/UploadContent")?)
            .headers(self.auth_headers()?)
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(body)
            .send()
            .await?;
        self.read_success(response, 64 * 1024).await?;
        Ok("accepted".into())
    }

    pub(crate) async fn list_devices(&self) -> Result<Vec<DeviceInfo>, DashlaneError> {
        let response = self
            .client
            .post(self.url("/v1/authentication/ListDevices")?)
            .headers(self.auth_headers()?)
            .json(&serde_json::json!({}))
            .send()
            .await?;
        let result: DeviceListResponse = self.handle_json(response).await?;
        if result.devices.len() > MAX_DEVICES
            || result.devices.iter().any(|device| {
                !valid_key(&device.device_access_key)
                    || device.device_name.len() > 256
                    || device.platform.len() > 128
            })
        {
            return Err(DashlaneError::server_error(
                "Dashlane returned an invalid device list",
            ));
        }
        Ok(result.devices)
    }

    pub async fn deregister_device(&self, device_access_key: &str) -> Result<(), DashlaneError> {
        if !valid_key(device_access_key) {
            return Err(DashlaneError::BadRequest(
                "Invalid device identifier".into(),
            ));
        }
        let response = self
            .client
            .post(self.url("/v1/authentication/DeregisterDevice")?)
            .headers(self.auth_headers()?)
            .json(&serde_json::json!({ "deviceAccessKey": device_access_key }))
            .send()
            .await?;
        self.read_success(response, 64 * 1024).await?;
        Ok(())
    }
}

fn valid_key(value: &str) -> bool {
    (8..=MAX_KEY_BYTES).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_graphic() && !byte.is_ascii_whitespace())
}

#[derive(serde::Deserialize)]
pub(crate) struct VaultContentResponse {
    pub transactions: Option<Vec<serde_json::Value>>,
}

#[derive(serde::Deserialize)]
pub(crate) struct DeviceInfo {
    pub device_access_key: String,
    pub device_name: String,
    pub platform: String,
    pub created_at: Option<String>,
    pub last_active: Option<String>,
}

impl Drop for DeviceInfo {
    fn drop(&mut self) {
        self.device_access_key.zeroize();
    }
}

#[derive(serde::Deserialize)]
struct DeviceListResponse {
    devices: Vec<DeviceInfo>,
}
