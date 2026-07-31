use crate::lastpass::api_client::LastPassApiClient;
use crate::lastpass::crypto;
use crate::lastpass::types::{LastPassConfig, LastPassError, LastPassErrorKind, LastPassSession};
use zeroize::Zeroize;

const MAX_LOGIN_RESPONSE_BYTES: usize = 256 * 1024;
const MAX_MASTER_PASSWORD_BYTES: usize = 4096;

/// Parse the login XML response and extract session info or error details.
pub fn parse_login_response(xml: &str) -> Result<LoginResponseData, LastPassError> {
    if xml.len() > MAX_LOGIN_RESPONSE_BYTES {
        return Err(LastPassError::parse_error(
            "LastPass login response exceeded the safety limit",
        ));
    }
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
            return Err(LastPassError::auth_failed(
                "No session ID in login response",
            ));
        }

        Ok(LoginResponseData {
            session_id,
            token,
            uid,
            private_key,
            iterations: iterations_str.and_then(|s| s.parse().ok()),
        })
    } else if xml.contains("<error ") {
        let message = extract_xml_attr(xml, "message").unwrap_or_default();
        let cause = extract_xml_attr(xml, "cause").unwrap_or_default();
        let message_lower = message.to_ascii_lowercase();
        let cause_lower = cause.to_ascii_lowercase();

        // Detect specific errors
        if cause_lower.contains("googleauthrequired")
            || message_lower.contains("google authenticator")
        {
            return Err(LastPassError::new(
                LastPassErrorKind::GoogleAuthRequired,
                "Google Authenticator code required",
            ));
        }
        if cause_lower.contains("otprequired") || cause_lower.contains("multifactorresponsefailed")
        {
            return Err(LastPassError::mfa_required("OTP"));
        }
        if cause_lower.contains("yubikeyrequired") {
            return Err(LastPassError::new(
                LastPassErrorKind::YubikeyRequired,
                "YubiKey authentication required",
            ));
        }
        if cause_lower.contains("duorequired") {
            return Err(LastPassError::new(
                LastPassErrorKind::DuoRequired,
                "Duo authentication required",
            ));
        }
        if cause_lower.contains("outofbandrequired") {
            return Err(LastPassError::new(
                LastPassErrorKind::OutOfBandRequired,
                "Out-of-band authentication required",
            ));
        }
        if message_lower.contains("locked") {
            return Err(LastPassError::account_locked());
        }

        Err(LastPassError::auth_failed(
            "LastPass rejected the authentication request",
        ))
    } else {
        Err(LastPassError::parse_error(
            "LastPass returned an unexpected login response",
        ))
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
            if end <= 8192 {
                return Some(xml[value_start..value_start + end].to_string());
            }
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
    if master_password.is_empty() || master_password.len() > MAX_MASTER_PASSWORD_BYTES {
        return Err(LastPassError::auth_failed(
            "Master password length is outside the supported safety limits",
        ));
    }
    if otp.is_some_and(|value| {
        value.is_empty()
            || value.len() > 128
            || value
                .chars()
                .any(|ch| ch.is_control() || ch.is_whitespace())
    }) {
        return Err(LastPassError::auth_failed("Invalid MFA response format"));
    }

    // Step 1: Get iteration count from server
    let iterations = client.get_iterations(&config.username).await?;

    // Step 2: Derive encryption key
    let mut key = crypto::derive_key(master_password, &config.username, iterations)?;

    // Step 3: Compute login hash
    let mut login_hash = crypto::compute_login_hash(&key, master_password, iterations)?;

    // Step 4: Send login request
    let response_result = client
        .login(
            &config.username,
            &login_hash,
            iterations,
            otp,
            config.trusted_device_id.as_deref(),
        )
        .await;
    login_hash.zeroize();
    let mut response_xml = match response_result {
        Ok(response) => response,
        Err(error) => {
            key.zeroize();
            return Err(error);
        }
    };

    // Step 5: Parse response
    let login_result = parse_login_response(&response_xml);
    response_xml.zeroize();
    let login_data = match login_result {
        Ok(data) => data,
        Err(error) => {
            key.zeroize();
            return Err(error);
        }
    };

    // Step 6: Update client with session
    if let Err(error) = client.set_session(login_data.session_id.clone(), login_data.token.clone())
    {
        key.zeroize();
        return Err(error);
    }

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
pub fn validate_session(
    session: &Option<LastPassSession>,
) -> Result<&LastPassSession, LastPassError> {
    session
        .as_ref()
        .ok_or_else(|| LastPassError::auth_failed("Not logged in to LastPass"))
}
