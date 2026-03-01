use crate::lastpass::api_client::LastPassApiClient;
use crate::lastpass::crypto;
use crate::lastpass::types::{LastPassConfig, LastPassError, LastPassErrorKind, LastPassSession};

/// Parse the login XML response and extract session info or error details.
pub fn parse_login_response(xml: &str) -> Result<LoginResponseData, LastPassError> {
    // LastPass returns XML like:
    // <response><ok sessionid="..." token="..." uid="..." ... /></response>
    // or <response><error message="..." cause="..." ... /></response>

    if xml.contains("<ok ") {
        let session_id = extract_xml_attr(xml, "sessionid").unwrap_or_default();
        let token = extract_xml_attr(xml, "token").unwrap_or_default();
        let uid = extract_xml_attr(xml, "uid").unwrap_or_default();
        let private_key = extract_xml_attr(xml, "privatekeyenc");
        let iterations_str = extract_xml_attr(xml, "iterations");

        if session_id.is_empty() {
            return Err(LastPassError::auth_failed("No session ID in login response"));
        }

        Ok(LoginResponseData {
            session_id,
            token,
            uid,
            private_key,
            iterations: iterations_str.and_then(|s| s.parse().ok()),
        })
    } else if xml.contains("<error ") {
        let message = extract_xml_attr(xml, "message").unwrap_or_else(|| "Unknown error".into());
        let cause = extract_xml_attr(xml, "cause").unwrap_or_default();

        // Detect specific errors
        if cause.contains("googleauthrequired") || message.contains("Google Authenticator") {
            return Err(LastPassError::new(
                LastPassErrorKind::GoogleAuthRequired,
                "Google Authenticator code required",
            ));
        }
        if cause.contains("otprequired") || cause.contains("multifactorresponsefailed") {
            return Err(LastPassError::mfa_required("OTP"));
        }
        if cause.contains("yubikeyrequired") {
            return Err(LastPassError::new(
                LastPassErrorKind::YubikeyRequired,
                "YubiKey authentication required",
            ));
        }
        if cause.contains("duorequired") {
            return Err(LastPassError::new(
                LastPassErrorKind::DuoRequired,
                "Duo authentication required",
            ));
        }
        if cause.contains("outofbandrequired") {
            return Err(LastPassError::new(
                LastPassErrorKind::OutOfBandRequired,
                "Out-of-band authentication required",
            ));
        }
        if message.contains("locked") {
            return Err(LastPassError::account_locked());
        }

        Err(LastPassError::auth_failed(format!("{}: {}", message, cause)))
    } else {
        Err(LastPassError::parse_error(format!(
            "Unexpected login response: {}",
            &xml[..xml.len().min(200)]
        )))
    }
}

#[derive(Debug, Clone)]
pub struct LoginResponseData {
    pub session_id: String,
    pub token: String,
    pub uid: String,
    pub private_key: Option<String>,
    pub iterations: Option<u32>,
}

fn extract_xml_attr(xml: &str, attr: &str) -> Option<String> {
    let pattern = format!("{}=\"", attr);
    if let Some(start) = xml.find(&pattern) {
        let value_start = start + pattern.len();
        if let Some(end) = xml[value_start..].find('"') {
            return Some(xml[value_start..value_start + end].to_string());
        }
    }
    None
}

/// Authenticate with LastPass and return a session.
pub async fn login(
    client: &mut LastPassApiClient,
    config: &LastPassConfig,
    master_password: &str,
    otp: Option<&str>,
) -> Result<LastPassSession, LastPassError> {
    // Step 1: Get iteration count from server
    let iterations = client.get_iterations(&config.username).await.unwrap_or(config.iterations);

    // Step 2: Derive encryption key
    let key = crypto::derive_key(master_password, &config.username, iterations);

    // Step 3: Compute login hash
    let login_hash = crypto::compute_login_hash(&key, master_password, iterations);

    // Step 4: Send login request
    let response_xml = client
        .login(
            &config.username,
            &login_hash,
            iterations,
            otp,
            config.trusted_device_id.as_deref(),
        )
        .await?;

    // Step 5: Parse response
    let login_data = parse_login_response(&response_xml)?;

    // Step 6: Update client with session
    client.set_session(login_data.session_id.clone(), login_data.token.clone());

    Ok(LastPassSession {
        session_id: login_data.session_id,
        token: login_data.token,
        uid: login_data.uid,
        private_key: login_data.private_key,
        encryption_key: key,
        iterations,
        logged_in_at: chrono::Utc::now().to_rfc3339(),
    })
}

/// Logout and destroy the session.
pub async fn logout(client: &mut LastPassApiClient) -> Result<(), LastPassError> {
    client.logout().await?;
    client.clear_session();
    Ok(())
}

/// Validate that we have an active session.
pub fn validate_session(session: &Option<LastPassSession>) -> Result<&LastPassSession, LastPassError> {
    session.as_ref().ok_or_else(|| LastPassError::auth_failed("Not logged in to LastPass"))
}
