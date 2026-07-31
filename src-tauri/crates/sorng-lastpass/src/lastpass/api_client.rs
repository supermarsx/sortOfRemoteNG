use crate::lastpass::types::{LastPassConfig, LastPassError, LastPassErrorKind};
use reqwest::{redirect::Policy, Client, Response, StatusCode};
use serde::de::DeserializeOwned;
use std::time::Duration;
use zeroize::Zeroize;

const MAX_CONTROL_RESPONSE_BYTES: usize = 256 * 1024;
const MAX_VAULT_RESPONSE_BYTES: usize = 96 * 1024 * 1024;
const MAX_VAULT_BYTES: usize = 64 * 1024 * 1024;
const MAX_EXPORT_RESPONSE_BYTES: usize = 64 * 1024 * 1024;
const MAX_SERVER_URL_BYTES: usize = 4096;
const MAX_ITEM_FIELD_BYTES: usize = 6 * 1024 * 1024;
const MAX_REQUEST_BODY_BYTES: usize = 16 * 1024 * 1024;
const MAX_EXTRA_FIELDS: usize = 64;

/// HTTP client for interacting with the LastPass web vault API.
pub struct LastPassApiClient {
    client: Client,
    base_url: String,
    session_id: Option<String>,
    token: Option<String>,
}

impl LastPassApiClient {
    pub fn new(config: &LastPassConfig) -> Result<Self, LastPassError> {
        if config.server_url.is_empty() || config.server_url.len() > MAX_SERVER_URL_BYTES {
            return Err(LastPassError::config_error(
                "LastPass server URL exceeds the supported safety limit",
            ));
        }
        if !config.verify_tls {
            return Err(LastPassError::config_error(
                "TLS certificate verification cannot be disabled for LastPass",
            ));
        }
        let mut base_url = url::Url::parse(&config.server_url)
            .map_err(|_| LastPassError::config_error("Invalid LastPass server URL"))?;
        if base_url.scheme() != "https"
            || base_url.host_str().is_none()
            || !base_url.username().is_empty()
            || base_url.password().is_some()
            || base_url.query().is_some()
            || base_url.fragment().is_some()
        {
            return Err(LastPassError::config_error(
                "LastPass server URL must be an HTTPS origin without credentials, query, or fragment",
            ));
        }
        let normalized_path = format!("{}/", base_url.path().trim_end_matches('/'));
        base_url.set_path(&normalized_path);

        let timeout = Duration::from_secs(config.timeout_secs.clamp(5, 60));
        let client = Client::builder()
            .timeout(timeout)
            .connect_timeout(Duration::from_secs(15).min(timeout))
            .redirect(Policy::none())
            .https_only(true)
            .user_agent("sortOfRemoteNG/1.0 (LastPass Integration)")
            .build()
            .map_err(|_| LastPassError::connection_error("Failed to build secure HTTP client"))?;

        Ok(Self {
            client,
            base_url: base_url.as_str().trim_end_matches('/').to_string(),
            session_id: None,
            token: None,
        })
    }

    pub fn set_session(&mut self, session_id: String, token: String) -> Result<(), LastPassError> {
        validate_protocol_token("session ID", &session_id, 4096)?;
        validate_protocol_token("CSRF token", &token, 4096)?;
        self.session_id = Some(session_id);
        self.token = Some(token);
        Ok(())
    }

    pub fn clear_session(&mut self) {
        self.session_id.zeroize();
        self.token.zeroize();
        self.session_id = None;
        self.token = None;
    }

    pub fn has_session(&self) -> bool {
        self.session_id.is_some()
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.base_url, path)
    }

    async fn handle_response(&self, response: Response) -> Result<String, LastPassError> {
        self.handle_response_limited(response, MAX_CONTROL_RESPONSE_BYTES)
            .await
    }

    async fn handle_response_limited(
        &self,
        mut response: Response,
        max_bytes: usize,
    ) -> Result<String, LastPassError> {
        let status = response.status();
        if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
            return Err(LastPassError::session_expired());
        }
        if status == StatusCode::TOO_MANY_REQUESTS {
            return Err(LastPassError::new(
                LastPassErrorKind::RateLimited,
                "Rate limited by LastPass",
            ));
        }
        if !status.is_success() {
            return Err(LastPassError::server_error(format!(
                "LastPass returned HTTP {}",
                status.as_u16()
            ))
            .with_status(status.as_u16()));
        }
        if response
            .content_length()
            .is_some_and(|length| length > max_bytes as u64)
        {
            return Err(LastPassError::server_error(
                "LastPass response exceeded the configured safety limit",
            ));
        }

        let mut body = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| LastPassError::server_error("Failed to read LastPass response"))?
        {
            let new_len = body
                .len()
                .checked_add(chunk.len())
                .ok_or_else(|| LastPassError::server_error("LastPass response is too large"))?;
            if new_len > max_bytes {
                body.zeroize();
                return Err(LastPassError::server_error(
                    "LastPass response exceeded the configured safety limit",
                ));
            }
            body.extend_from_slice(&chunk);
        }

        String::from_utf8(body)
            .map_err(|_| LastPassError::parse_error("LastPass returned invalid UTF-8"))
    }

    async fn handle_mutation_response(&self, response: Response) -> Result<String, LastPassError> {
        let mut text = self.handle_response(response).await?;
        let result = parse_mutation_acknowledgement(&text);
        text.zeroize();
        result
    }

    #[allow(dead_code)]
    async fn handle_json_response<T: DeserializeOwned>(
        &self,
        response: Response,
    ) -> Result<T, LastPassError> {
        let text = self.handle_response(response).await?;
        serde_json::from_str(&text).map_err(|e| {
            let _ = e;
            LastPassError::parse_error("LastPass returned invalid JSON")
        })
    }

    /// Perform login request, returning the raw XML response.
    pub async fn login(
        &self,
        username: &str,
        login_hash: &str,
        iterations: u32,
        otp: Option<&str>,
        trusted_id: Option<&str>,
    ) -> Result<String, LastPassError> {
        validate_public_input("username", username, 320, false)?;
        if login_hash.len() != 64 || !login_hash.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(LastPassError::new(
                LastPassErrorKind::BadRequest,
                "Invalid LastPass login hash",
            ));
        }
        if iterations != 1 && !(10_000..=5_000_000).contains(&iterations) {
            return Err(LastPassError::new(
                LastPassErrorKind::BadRequest,
                "Unsafe LastPass iteration count",
            ));
        }
        if let Some(value) = otp {
            validate_public_input("MFA response", value, 128, false)?;
        }
        if let Some(value) = trusted_id {
            validate_public_input("trusted-device identifier", value, 256, false)?;
        }

        let mut params = vec![
            ("method", "mobile".to_string()),
            ("web", "1".to_string()),
            ("xml", "1".to_string()),
            ("username", username.to_string()),
            ("hash", login_hash.to_string()),
            ("iterations", iterations.to_string()),
            ("imei", "sortofremoteng".to_string()),
        ];

        if let Some(otp_val) = otp {
            params.push(("otp", otp_val.to_string()));
        }
        if let Some(tid) = trusted_id {
            params.push(("uuid", tid.to_string()));
            params.push(("trustlabel", "sortOfRemoteNG".to_string()));
        }

        let response_result = self
            .client
            .post(self.url("/login.php"))
            .form(&params)
            .send()
            .await;
        for (_, value) in &mut params {
            value.zeroize();
        }
        let response = response_result?;

        self.handle_response(response).await
    }

    /// Fetch the encrypted vault blob.
    pub async fn get_vault(&self) -> Result<Vec<u8>, LastPassError> {
        let session = self
            .session_id
            .as_ref()
            .ok_or_else(|| LastPassError::auth_failed("Not logged in"))?;

        let response = self
            .client
            .get(self.url("/getaccts.php"))
            .query(&[
                ("mobile", "1"),
                ("b64", "1"),
                ("hash", "0.0"),
                ("hasplugin", "3.0.23"),
                ("requestsrc", "cli"),
            ])
            .header("Cookie", format!("PHPSESSID={}", session))
            .send()
            .await?;

        let mut body = self
            .handle_response_limited(response, MAX_VAULT_RESPONSE_BYTES)
            .await?;
        use base64::Engine;
        let decoded_result = base64::engine::general_purpose::STANDARD.decode(body.trim());
        body.zeroize();
        let decoded = decoded_result
            .map_err(|_| LastPassError::vault_parse_error("Failed to decode vault blob"))?;
        if decoded.len() > MAX_VAULT_BYTES {
            return Err(LastPassError::vault_parse_error(
                "Vault exceeded the configured safety limit",
            ));
        }
        Ok(decoded)
    }

    /// Add a new site/account.
    #[allow(clippy::too_many_arguments)]
    pub async fn add_account(
        &self,
        name: &str,
        url: &str,
        username: &str,
        password: &str,
        notes: &str,
        group: &str,
        extra_fields: &[(&str, &str)],
    ) -> Result<String, LastPassError> {
        validate_public_input("name", name, MAX_ITEM_FIELD_BYTES, false)?;
        validate_public_input("URL", url, 16 * 1024, true)?;
        validate_public_input("username", username, MAX_ITEM_FIELD_BYTES, true)?;
        validate_public_input("password", password, MAX_ITEM_FIELD_BYTES, true)?;
        validate_public_input("notes", notes, MAX_ITEM_FIELD_BYTES, true)?;
        validate_public_input("folder", group, 4096, true)?;
        if extra_fields.len() > MAX_EXTRA_FIELDS {
            return Err(LastPassError::new(
                LastPassErrorKind::BadRequest,
                "Too many LastPass custom fields",
            ));
        }
        let mut request_bytes = [name, url, username, password, notes, group]
            .iter()
            .try_fold(0usize, |total, value| total.checked_add(value.len()))
            .ok_or_else(|| {
                LastPassError::new(LastPassErrorKind::BadRequest, "Request is too large")
            })?;
        for (key, value) in extra_fields {
            validate_public_input("custom-field name", key, 128, false)?;
            validate_public_input("custom-field value", value, MAX_ITEM_FIELD_BYTES, true)?;
            request_bytes = request_bytes
                .checked_add(key.len())
                .and_then(|total| total.checked_add(value.len()))
                .ok_or_else(|| {
                    LastPassError::new(LastPassErrorKind::BadRequest, "Request is too large")
                })?;
        }
        if request_bytes > MAX_REQUEST_BODY_BYTES {
            return Err(LastPassError::new(
                LastPassErrorKind::BadRequest,
                "LastPass request exceeds the configured safety limit",
            ));
        }
        let session = self
            .session_id
            .as_ref()
            .ok_or_else(|| LastPassError::auth_failed("Not logged in"))?;
        let token = self
            .token
            .as_ref()
            .ok_or_else(|| LastPassError::auth_failed("No CSRF token"))?;

        let mut params = vec![
            ("extjs", "1"),
            ("token", token.as_str()),
            ("method", "cli"),
            ("name", name),
            ("url", url),
            ("username", username),
            ("password", password),
            ("extra", notes),
            ("grouping", group),
        ];
        for (k, v) in extra_fields {
            params.push((k, v));
        }

        let response = self
            .client
            .post(self.url("/show_website.php"))
            .form(&params)
            .header("Cookie", format!("PHPSESSID={}", session))
            .send()
            .await?;

        self.handle_mutation_response(response).await
    }

    /// Update an existing site/account.
    #[allow(clippy::too_many_arguments)]
    pub async fn update_account(
        &self,
        aid: &str,
        name: &str,
        url: &str,
        username: &str,
        password: &str,
        notes: &str,
        group: &str,
    ) -> Result<String, LastPassError> {
        validate_item_identifier(aid)?;
        validate_public_input("name", name, MAX_ITEM_FIELD_BYTES, false)?;
        validate_public_input("URL", url, 16 * 1024, true)?;
        validate_public_input("username", username, MAX_ITEM_FIELD_BYTES, true)?;
        validate_public_input("password", password, MAX_ITEM_FIELD_BYTES, true)?;
        validate_public_input("notes", notes, MAX_ITEM_FIELD_BYTES, true)?;
        validate_public_input("folder", group, 4096, true)?;
        let request_bytes = [aid, name, url, username, password, notes, group]
            .iter()
            .try_fold(0usize, |total, value| total.checked_add(value.len()))
            .filter(|total| *total <= MAX_REQUEST_BODY_BYTES)
            .ok_or_else(|| {
                LastPassError::new(
                    LastPassErrorKind::BadRequest,
                    "LastPass request exceeds the configured safety limit",
                )
            })?;
        let _ = request_bytes;
        let session = self
            .session_id
            .as_ref()
            .ok_or_else(|| LastPassError::auth_failed("Not logged in"))?;
        let token = self
            .token
            .as_ref()
            .ok_or_else(|| LastPassError::auth_failed("No CSRF token"))?;

        let params = vec![
            ("extjs", "1"),
            ("token", token.as_str()),
            ("method", "cli"),
            ("aid", aid),
            ("name", name),
            ("url", url),
            ("username", username),
            ("password", password),
            ("extra", notes),
            ("grouping", group),
        ];

        let response = self
            .client
            .post(self.url("/show_website.php"))
            .form(&params)
            .header("Cookie", format!("PHPSESSID={}", session))
            .send()
            .await?;

        self.handle_mutation_response(response).await
    }

    /// Delete a site/account.
    pub async fn delete_account(&self, aid: &str) -> Result<String, LastPassError> {
        validate_item_identifier(aid)?;
        let session = self
            .session_id
            .as_ref()
            .ok_or_else(|| LastPassError::auth_failed("Not logged in"))?;
        let token = self
            .token
            .as_ref()
            .ok_or_else(|| LastPassError::auth_failed("No CSRF token"))?;

        let params = vec![
            ("extjs", "1"),
            ("token", token.as_str()),
            ("delete", "1"),
            ("aid", aid),
        ];

        let response = self
            .client
            .post(self.url("/show_website.php"))
            .form(&params)
            .header("Cookie", format!("PHPSESSID={}", session))
            .send()
            .await?;

        self.handle_mutation_response(response).await
    }

    /// Get iteration count for a given username.
    pub async fn get_iterations(&self, username: &str) -> Result<u32, LastPassError> {
        validate_public_input("username", username, 320, false)?;
        let response = self
            .client
            .post(self.url("/iterations.php"))
            .form(&[("email", username)])
            .send()
            .await?;

        let body = self.handle_response(response).await?;
        let iterations = body
            .trim()
            .parse::<u32>()
            .map_err(|_| LastPassError::parse_error("Failed to parse iteration count"))?;
        if iterations != 1 && !(10_000..=5_000_000).contains(&iterations) {
            return Err(LastPassError::parse_error(
                "LastPass returned an unsafe iteration count",
            ));
        }
        Ok(iterations)
    }

    /// Logout and invalidate the session.
    pub async fn logout(&self) -> Result<(), LastPassError> {
        if let Some(session) = &self.session_id {
            let response = self
                .client
                .post(self.url("/logout.php"))
                .form(&[("method", "cli"), ("noredirect", "1")])
                .header("Cookie", format!("PHPSESSID={}", session))
                .send()
                .await?;
            let _ = self.handle_response(response).await?;
        }
        Ok(())
    }

    /// Create a folder.
    pub async fn create_folder(&self, name: &str, shared: bool) -> Result<String, LastPassError> {
        validate_public_input("folder", name, 4096, false)?;
        let session = self
            .session_id
            .as_ref()
            .ok_or_else(|| LastPassError::auth_failed("Not logged in"))?;
        let token = self
            .token
            .as_ref()
            .ok_or_else(|| LastPassError::auth_failed("No CSRF token"))?;

        let share = if shared { "1" } else { "0" };
        let params = vec![
            ("token", token.as_str()),
            ("name", name),
            ("sharefolderid", share),
        ];

        let response = self
            .client
            .post(self.url("/show_website.php"))
            .form(&params)
            .header("Cookie", format!("PHPSESSID={}", session))
            .send()
            .await?;

        self.handle_mutation_response(response).await
    }

    /// Move an account to a different folder/group.
    pub async fn move_account(&self, aid: &str, new_group: &str) -> Result<String, LastPassError> {
        validate_item_identifier(aid)?;
        validate_public_input("folder", new_group, 4096, true)?;
        let session = self
            .session_id
            .as_ref()
            .ok_or_else(|| LastPassError::auth_failed("Not logged in"))?;
        let token = self
            .token
            .as_ref()
            .ok_or_else(|| LastPassError::auth_failed("No CSRF token"))?;

        let params = vec![
            ("token", token.as_str()),
            ("aid", aid),
            ("grouping", new_group),
            ("cmd", "mv"),
        ];

        let response = self
            .client
            .post(self.url("/show_website.php"))
            .form(&params)
            .header("Cookie", format!("PHPSESSID={}", session))
            .send()
            .await?;

        self.handle_mutation_response(response).await
    }

    /// Toggle favorite status.
    pub async fn toggle_favorite(&self, aid: &str, fav: bool) -> Result<String, LastPassError> {
        validate_item_identifier(aid)?;
        let session = self
            .session_id
            .as_ref()
            .ok_or_else(|| LastPassError::auth_failed("Not logged in"))?;
        let token = self
            .token
            .as_ref()
            .ok_or_else(|| LastPassError::auth_failed("No CSRF token"))?;

        let fav_str = if fav { "1" } else { "0" };
        let params = vec![("token", token.as_str()), ("aid", aid), ("fav", fav_str)];

        let response = self
            .client
            .post(self.url("/show_website.php"))
            .form(&params)
            .header("Cookie", format!("PHPSESSID={}", session))
            .send()
            .await?;

        self.handle_mutation_response(response).await
    }

    /// Export vault as CSV (requires re-authentication).
    pub async fn export_vault(&self) -> Result<String, LastPassError> {
        let session = self
            .session_id
            .as_ref()
            .ok_or_else(|| LastPassError::auth_failed("Not logged in"))?;
        let token = self
            .token
            .as_ref()
            .ok_or_else(|| LastPassError::auth_failed("No CSRF token"))?;

        let response = self
            .client
            .post(self.url("/getCSVPasswords.php"))
            .form(&[("token", token.as_str()), ("mobile", "1")])
            .header("Cookie", format!("PHPSESSID={}", session))
            .send()
            .await?;

        self.handle_response_limited(response, MAX_EXPORT_RESPONSE_BYTES)
            .await
    }
}

impl Drop for LastPassApiClient {
    fn drop(&mut self) {
        self.session_id.zeroize();
        self.token.zeroize();
    }
}

fn validate_protocol_token(label: &str, value: &str, max_len: usize) -> Result<(), LastPassError> {
    if value.is_empty()
        || value.len() > max_len
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_.=+/".contains(&byte))
    {
        return Err(LastPassError::parse_error(format!(
            "LastPass returned an invalid {}",
            label
        )));
    }
    Ok(())
}

fn validate_public_input(
    label: &str,
    value: &str,
    max_len: usize,
    allow_empty: bool,
) -> Result<(), LastPassError> {
    if (!allow_empty && value.is_empty())
        || value.len() > max_len
        || value.chars().any(|ch| ch.is_control())
    {
        return Err(LastPassError::new(
            LastPassErrorKind::BadRequest,
            format!("{} is outside the supported safety limits", label),
        ));
    }
    Ok(())
}

fn validate_item_identifier(value: &str) -> Result<(), LastPassError> {
    if !is_safe_identifier(value) {
        return Err(LastPassError::new(
            LastPassErrorKind::BadRequest,
            "Invalid LastPass item identifier",
        ));
    }
    Ok(())
}

fn is_safe_identifier(value: &str) -> bool {
    value.len() >= 8
        && value.len() <= 256
        && value.bytes().any(|byte| byte.is_ascii_digit())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_.".contains(&byte))
}

fn parse_mutation_acknowledgement(text: &str) -> Result<String, LastPassError> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err(LastPassError::server_error(
            "LastPass mutation returned no acknowledgement",
        ));
    }

    let lower = trimmed.to_ascii_lowercase();
    if matches!(
        lower.as_str(),
        "0" | "error" | "false" | "failed" | "failure"
    ) || lower.starts_with("error:")
        || lower.starts_with("failed:")
        || lower.contains("<error")
    {
        return Err(LastPassError::server_error(
            "LastPass rejected the requested mutation",
        ));
    }

    if matches!(lower.as_str(), "1" | "ok" | "success" | "true") {
        return Ok(lower);
    }

    if let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) {
        if value.get("success").and_then(serde_json::Value::as_bool) == Some(true) {
            if let Some(id) = value.get("id").and_then(serde_json::Value::as_str) {
                if !is_safe_identifier(id) {
                    return Err(LastPassError::server_error(
                        "LastPass returned an invalid mutation identifier",
                    ));
                }
                return Ok(id.to_string());
            }
            return Ok("ok".to_string());
        }
        return Err(LastPassError::server_error(
            "LastPass rejected the requested mutation",
        ));
    }

    let positive_xml = (lower == "<ok/>" || lower == "<ok />")
        || (lower.starts_with("<response")
            && lower.ends_with("</response>")
            && (lower.contains("<ok ") || lower.contains("<ok/>") || lower.contains("<ok />")));
    if positive_xml {
        return Ok("ok".to_string());
    }

    if is_safe_identifier(trimmed) {
        return Ok(trimmed.to_string());
    }

    Err(LastPassError::server_error(
        "LastPass returned an unrecognized mutation acknowledgement",
    ))
}
