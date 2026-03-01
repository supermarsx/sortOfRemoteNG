use crate::lastpass::types::{LastPassConfig, LastPassError, LastPassErrorKind};
use reqwest::{Client, Response, StatusCode};
use serde::de::DeserializeOwned;
use std::time::Duration;

/// HTTP client for interacting with the LastPass web vault API.
#[derive(Debug, Clone)]
pub struct LastPassApiClient {
    client: Client,
    base_url: String,
    session_id: Option<String>,
    token: Option<String>,
}

impl LastPassApiClient {
    pub fn new(config: &LastPassConfig) -> Result<Self, LastPassError> {
        let client = Client::builder()
            .timeout(Duration::from_secs(config.timeout_secs))
            .danger_accept_invalid_certs(!config.verify_tls)
            .cookie_store(true)
            .user_agent("sortOfRemoteNG/1.0 (LastPass Integration)")
            .build()
            .map_err(|e| LastPassError::connection_error(format!("Failed to build HTTP client: {}", e)))?;

        Ok(Self {
            client,
            base_url: config.server_url.trim_end_matches('/').to_string(),
            session_id: None,
            token: None,
        })
    }

    pub fn set_session(&mut self, session_id: String, token: String) {
        self.session_id = Some(session_id);
        self.token = Some(token);
    }

    pub fn clear_session(&mut self) {
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
            let body = response.text().await.unwrap_or_default();
            return Err(LastPassError::server_error(format!(
                "HTTP {} — {}",
                status.as_u16(),
                body
            )).with_status(status.as_u16()));
        }
        response
            .text()
            .await
            .map_err(|e| LastPassError::server_error(format!("Failed to read response body: {}", e)))
    }

    async fn handle_json_response<T: DeserializeOwned>(
        &self,
        response: Response,
    ) -> Result<T, LastPassError> {
        let text = self.handle_response(response).await?;
        serde_json::from_str(&text)
            .map_err(|e| LastPassError::parse_error(format!("JSON parse error: {} — body: {}", e, &text[..text.len().min(200)])))
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

        let response = self
            .client
            .post(self.url("/login.php"))
            .form(&params)
            .send()
            .await?;

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

        let body = self.handle_response(response).await?;
        use base64::Engine;
        base64::engine::general_purpose::STANDARD.decode(body.trim())
            .map_err(|e| LastPassError::vault_parse_error(format!("Failed to decode vault blob: {}", e)))
    }

    /// Add a new site/account.
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

        self.handle_response(response).await
    }

    /// Update an existing site/account.
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

        self.handle_response(response).await
    }

    /// Delete a site/account.
    pub async fn delete_account(&self, aid: &str) -> Result<String, LastPassError> {
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

        self.handle_response(response).await
    }

    /// Get iteration count for a given username.
    pub async fn get_iterations(&self, username: &str) -> Result<u32, LastPassError> {
        let response = self
            .client
            .post(self.url("/iterations.php"))
            .form(&[("email", username)])
            .send()
            .await?;

        let body = self.handle_response(response).await?;
        body.trim()
            .parse::<u32>()
            .map_err(|_| LastPassError::parse_error("Failed to parse iteration count"))
    }

    /// Logout and invalidate the session.
    pub async fn logout(&self) -> Result<(), LastPassError> {
        if let Some(session) = &self.session_id {
            let _ = self
                .client
                .post(self.url("/logout.php"))
                .form(&[("method", "cli"), ("noredirect", "1")])
                .header("Cookie", format!("PHPSESSID={}", session))
                .send()
                .await;
        }
        Ok(())
    }

    /// Create a folder.
    pub async fn create_folder(&self, name: &str, shared: bool) -> Result<String, LastPassError> {
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

        self.handle_response(response).await
    }

    /// Move an account to a different folder/group.
    pub async fn move_account(
        &self,
        aid: &str,
        new_group: &str,
    ) -> Result<String, LastPassError> {
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

        self.handle_response(response).await
    }

    /// Toggle favorite status.
    pub async fn toggle_favorite(&self, aid: &str, fav: bool) -> Result<String, LastPassError> {
        let session = self
            .session_id
            .as_ref()
            .ok_or_else(|| LastPassError::auth_failed("Not logged in"))?;
        let token = self
            .token
            .as_ref()
            .ok_or_else(|| LastPassError::auth_failed("No CSRF token"))?;

        let fav_str = if fav { "1" } else { "0" };
        let params = vec![
            ("token", token.as_str()),
            ("aid", aid),
            ("fav", fav_str),
        ];

        let response = self
            .client
            .post(self.url("/show_website.php"))
            .form(&params)
            .header("Cookie", format!("PHPSESSID={}", session))
            .send()
            .await?;

        self.handle_response(response).await
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

        self.handle_response(response).await
    }
}
