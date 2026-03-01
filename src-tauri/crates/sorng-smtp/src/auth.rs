//! SMTP authentication mechanisms.
//!
//! Supports PLAIN, LOGIN, CRAM-MD5 and XOAUTH2.

use base64::Engine;
use log::debug;

use crate::client::SmtpClient;
use crate::types::*;

/// Authenticate with the SMTP server using the given credentials.
/// Automatically selects the best mechanism based on server capabilities
/// unless `creds.method` is explicitly set.
pub async fn authenticate(
    client: &mut SmtpClient,
    creds: &SmtpCredentials,
) -> SmtpResult<()> {
    let method = select_auth_method(client, creds)?;
    debug!("Authenticating with {}", method);

    match method {
        SmtpAuthMethod::Plain => auth_plain(client, creds).await,
        SmtpAuthMethod::Login => auth_login(client, creds).await,
        SmtpAuthMethod::CramMd5 => auth_cram_md5(client, creds).await,
        SmtpAuthMethod::XOAuth2 => auth_xoauth2(client, creds).await,
    }
}

/// Select the authentication mechanism to use.
fn select_auth_method(
    client: &SmtpClient,
    creds: &SmtpCredentials,
) -> SmtpResult<SmtpAuthMethod> {
    // If explicitly set, honour it
    if let Some(m) = creds.method {
        return Ok(m);
    }

    // If XOAUTH2 token is present, use it
    if creds.oauth2_token.is_some() {
        if let Some(caps) = client.capabilities() {
            if caps.supports_auth("XOAUTH2") {
                return Ok(SmtpAuthMethod::XOAuth2);
            }
        }
    }

    // Preference order: CRAM-MD5 > PLAIN > LOGIN
    if let Some(caps) = client.capabilities() {
        if caps.supports_auth("CRAM-MD5") {
            return Ok(SmtpAuthMethod::CramMd5);
        }
        if caps.supports_auth("PLAIN") {
            return Ok(SmtpAuthMethod::Plain);
        }
        if caps.supports_auth("LOGIN") {
            return Ok(SmtpAuthMethod::Login);
        }
    }

    // Default to PLAIN if no capabilities available
    Ok(SmtpAuthMethod::Plain)
}

// ── AUTH PLAIN ──────────────────────────────────────────────────────

/// AUTH PLAIN: sends `\0username\0password` base64-encoded in one shot.
async fn auth_plain(client: &mut SmtpClient, creds: &SmtpCredentials) -> SmtpResult<()> {
    let payload = format!("\0{}\0{}", creds.username, creds.password);
    let encoded = base64::engine::general_purpose::STANDARD.encode(payload.as_bytes());
    let reply = client.command(&format!("AUTH PLAIN {}", encoded)).await?;

    if reply.is_positive() {
        client.set_authenticated(true);
        Ok(())
    } else {
        Err(SmtpError::auth(format!(
            "AUTH PLAIN failed: {} {}",
            reply.code,
            reply.text()
        )))
    }
}

// ── AUTH LOGIN ──────────────────────────────────────────────────────

/// AUTH LOGIN: challenge-response with base64 username then password.
async fn auth_login(client: &mut SmtpClient, creds: &SmtpCredentials) -> SmtpResult<()> {
    let reply = client.command("AUTH LOGIN").await?;
    if !reply.is_intermediate() && !reply.is_positive() {
        return Err(SmtpError::auth(format!(
            "AUTH LOGIN rejected: {} {}",
            reply.code,
            reply.text()
        )));
    }

    // Server sends 334 VXNlcm5hbWU6 (base64 "Username:")
    let user_b64 = base64::engine::general_purpose::STANDARD.encode(creds.username.as_bytes());
    let reply = client.command(&user_b64).await?;
    if !reply.is_intermediate() && !reply.is_positive() {
        return Err(SmtpError::auth(format!(
            "AUTH LOGIN username rejected: {} {}",
            reply.code,
            reply.text()
        )));
    }

    // Server sends 334 UGFzc3dvcmQ6 (base64 "Password:")
    let pass_b64 = base64::engine::general_purpose::STANDARD.encode(creds.password.as_bytes());
    let reply = client.command(&pass_b64).await?;

    if reply.is_positive() {
        client.set_authenticated(true);
        Ok(())
    } else {
        Err(SmtpError::auth(format!(
            "AUTH LOGIN password rejected: {} {}",
            reply.code,
            reply.text()
        )))
    }
}

// ── AUTH CRAM-MD5 ───────────────────────────────────────────────────

/// AUTH CRAM-MD5: HMAC-MD5 challenge-response.
async fn auth_cram_md5(client: &mut SmtpClient, creds: &SmtpCredentials) -> SmtpResult<()> {
    let reply = client.command("AUTH CRAM-MD5").await?;
    if !reply.is_intermediate() {
        return Err(SmtpError::auth(format!(
            "AUTH CRAM-MD5 rejected: {} {}",
            reply.code,
            reply.text()
        )));
    }

    // Decode the challenge from the 334 reply
    let challenge_b64 = reply.lines.first().cloned().unwrap_or_default();
    let challenge = base64::engine::general_purpose::STANDARD
        .decode(challenge_b64.as_bytes())
        .map_err(|e| SmtpError::auth(format!("Invalid CRAM-MD5 challenge: {}", e)))?;

    // Compute HMAC-MD5(password, challenge)
    let digest = cram_md5_digest(&creds.password, &challenge);

    // Response = base64(username + " " + hex(digest))
    let response = format!("{} {}", creds.username, digest);
    let encoded = base64::engine::general_purpose::STANDARD.encode(response.as_bytes());
    let reply = client.command(&encoded).await?;

    if reply.is_positive() {
        client.set_authenticated(true);
        Ok(())
    } else {
        Err(SmtpError::auth(format!(
            "AUTH CRAM-MD5 failed: {} {}",
            reply.code,
            reply.text()
        )))
    }
}

/// Compute the CRAM-MD5 HMAC digest as a hex string.
fn cram_md5_digest(password: &str, challenge: &[u8]) -> String {
    use hmac::{Hmac, Mac};
    type HmacMd5 = Hmac<md5::Md5>;

    let mut mac = HmacMd5::new_from_slice(password.as_bytes())
        .expect("HMAC can take key of any size");
    mac.update(challenge);
    let result = mac.finalize();
    hex::encode(result.into_bytes())
}

// ── AUTH XOAUTH2 ────────────────────────────────────────────────────

/// AUTH XOAUTH2: Google/Microsoft OAuth2 bearer token.
async fn auth_xoauth2(client: &mut SmtpClient, creds: &SmtpCredentials) -> SmtpResult<()> {
    let token = creds
        .oauth2_token
        .as_ref()
        .ok_or_else(|| SmtpError::auth("XOAUTH2 requires oauth2_token"))?;

    // Format: "user=" + user + "\x01" + "auth=Bearer " + token + "\x01\x01"
    let sasl = format!("user={}\x01auth=Bearer {}\x01\x01", creds.username, token);
    let encoded = base64::engine::general_purpose::STANDARD.encode(sasl.as_bytes());
    let reply = client.command(&format!("AUTH XOAUTH2 {}", encoded)).await?;

    if reply.is_positive() {
        client.set_authenticated(true);
        Ok(())
    } else {
        Err(SmtpError::auth(format!(
            "AUTH XOAUTH2 failed: {} {}",
            reply.code,
            reply.text()
        )))
    }
}

// ── Public helpers for building auth payloads ───────────────────────

/// Build the AUTH PLAIN payload (useful for testing).
pub fn build_plain_payload(username: &str, password: &str) -> String {
    let payload = format!("\0{}\0{}", username, password);
    base64::engine::general_purpose::STANDARD.encode(payload.as_bytes())
}

/// Build the XOAUTH2 SASL string (useful for testing).
pub fn build_xoauth2_payload(username: &str, token: &str) -> String {
    let sasl = format!("user={}\x01auth=Bearer {}\x01\x01", username, token);
    base64::engine::general_purpose::STANDARD.encode(sasl.as_bytes())
}

// ─── Tests ──────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_payload_format() {
        let payload = build_plain_payload("user@example.com", "secret");
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(payload.as_bytes())
            .unwrap();
        let text = String::from_utf8(decoded).unwrap();
        assert_eq!(text, "\0user@example.com\0secret");
    }

    #[test]
    fn xoauth2_payload_format() {
        let payload = build_xoauth2_payload("user@example.com", "ya29.token");
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(payload.as_bytes())
            .unwrap();
        let text = String::from_utf8(decoded).unwrap();
        assert!(text.starts_with("user=user@example.com\x01"));
        assert!(text.contains("auth=Bearer ya29.token"));
        assert!(text.ends_with("\x01\x01"));
    }

    #[test]
    fn select_method_explicit() {
        let client = SmtpClient::new(SmtpConfig::default());
        let creds = SmtpCredentials {
            method: Some(SmtpAuthMethod::Login),
            ..Default::default()
        };
        assert_eq!(select_auth_method(&client, &creds).unwrap(), SmtpAuthMethod::Login);
    }

    #[test]
    fn select_method_defaults_to_plain() {
        let client = SmtpClient::new(SmtpConfig::default());
        let creds = SmtpCredentials::default();
        assert_eq!(
            select_auth_method(&client, &creds).unwrap(),
            SmtpAuthMethod::Plain
        );
    }

    #[test]
    fn plain_payload_no_null_in_user() {
        // Verify the null separators are exactly right
        let payload = build_plain_payload("admin", "pass");
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(payload.as_bytes())
            .unwrap();
        assert_eq!(decoded[0], 0);
        assert_eq!(decoded[6], 0);
    }
}
