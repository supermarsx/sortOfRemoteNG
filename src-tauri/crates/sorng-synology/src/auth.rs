//! Authentication module — password login with one-shot OTP, and legacy SID reuse.

use crate::client::SynoClient;
use crate::error::{SynologyError, SynologyResult};
use crate::types::*;

/// Handles all authentication flows for Synology DSM.
pub struct AuthManager;

impl AuthManager {
    /// Full login flow:
    /// 1. Preserve legacy explicitly supplied SID reuse (not a PAT flow).
    /// 2. Otherwise, password-based login via `SYNO.API.Auth`.
    /// 3. If 2FA is required (error 403), retry with `otp_code`.
    /// 4. Never enroll a remembered device or retain a one-time code.
    pub async fn login(client: &mut SynoClient) -> SynologyResult<String> {
        // Backward-compatible explicit SID path; the new explorer does not use it.
        if let Some(token) = client.config.access_token.take() {
            client.sid = Some(token);
            client.config.password.clear();
            client.config.otp_code = None;
            log::info!("Validating an explicitly supplied legacy session token");
            // Verify token works by fetching DSM info
            match Self::fetch_dsm_info(client).await {
                Ok(info) => {
                    client.dsm_version = Some(info.version_string.clone());
                    client.model = Some(info.model.clone());
                    return Ok(format!(
                        "Connected to {} ({}) DSM {}",
                        info.model, client.config.host, info.version_string
                    ));
                }
                Err(_) => {
                    client.sid = None;
                    return Err(SynologyError::auth("The supplied session token is invalid"));
                }
            }
        }

        // Password-based login
        Self::login_password(client).await
    }

    async fn login_password(client: &mut SynoClient) -> SynologyResult<String> {
        let version = client.best_version("SYNO.API.Auth", 6).unwrap_or(3);

        let mut params: Vec<(&str, String)> = vec![
            ("account", client.config.username.clone()),
            ("passwd", std::mem::take(&mut client.config.password)),
            ("session", "SortOfRemoteNG".to_string()),
            ("format", "sid".to_string()),
        ];

        // Request SynoToken for DSM 7+
        if version >= 6 {
            params.push(("enable_syno_token", "yes".to_string()));
        }

        // Supply 2FA code if available
        if let Some(otp) = client.config.otp_code.take() {
            params.push(("otp_code", otp));
        }

        // Remembered-device enrollment and OTP bypass require a separate explicit
        // consent contract. This login does neither, even if DSM returns a did.
        client.device_token = None;
        client.config.device_token = None;

        // Build form params as &str pairs
        let form_pairs: Vec<(&str, &str)> = params.iter().map(|(k, v)| (*k, v.as_str())).collect();

        let result = client
            .api_post::<LoginResult>("SYNO.API.Auth", version, "login", &form_pairs)
            .await;
        drop(params);
        if let Ok(login) = result {
            client.sid = Some(login.sid);
            client.syno_token = login.synotoken;

            // Fetch NAS info
            match Self::fetch_dsm_info(client).await {
                Ok(info) => {
                    client.dsm_version = Some(info.version_string.clone());
                    client.model = Some(info.model.clone());
                    Ok(format!(
                        "Connected to {} ({}) DSM {}",
                        info.model, client.config.host, info.version_string
                    ))
                }
                Err(_) => Ok(format!(
                    "Connected to {} (DSM version unknown)",
                    client.config.host
                )),
            }
        } else {
            result.map(|_| String::new())
        }
    }

    /// The scoped explorer supports password + OTP, not PAT, device enrollment,
    /// Secure SignIn approval, or WebAuthn. Secrets leave config before awaiting.
    pub(crate) async fn login_file_station(client: &mut SynoClient) -> SynologyResult<()> {
        use serde_json::json;
        client.auth_session = "FileStation";
        let mut params = vec![
            ("account", json!(client.config.username)),
            ("passwd", json!(std::mem::take(&mut client.config.password))),
            ("session", json!(client.auth_session)),
            // DSM's documented cookie mode authorizes the next request before
            // CGI body parsing, including deployments that do not use a
            // POST-body SID for the outer authentication check. The per-client
            // native cookie jar is isolated and never shared with the browser.
            ("format", json!("cookie")),
        ];
        if client.best_version("SYNO.API.Auth", 6).unwrap_or(0) >= 6 {
            params.push(("enable_syno_token", json!("yes")));
        }
        if let Some(otp) = client.config.otp_code.take() {
            params.push(("otp_code", json!(otp)));
        }
        client.device_token = None;
        client.config.device_token = None;
        client.config.access_token = None;
        let response = client
            .file_call_typed("SYNO.API.Auth", 6, "login", &params)
            .await;
        drop(params);
        let login: LoginResult = response?;
        if login.sid.is_empty() || login.sid.len() > 4096 || login.sid.chars().any(char::is_control)
        {
            return Err(SynologyError::parse("NAS returned an invalid session"));
        }
        client.sid = Some(login.sid);
        client.syno_token = login.synotoken;
        Ok(())
    }

    /// Logout: invalidate the current session.
    pub async fn logout(client: &mut SynoClient) -> SynologyResult<()> {
        if client.sid.is_none() {
            return Ok(());
        }
        let version = client.best_version("SYNO.API.Auth", 7).unwrap_or(3);
        let _ = client
            .api_call_void(
                "SYNO.API.Auth",
                version,
                "logout",
                &[("session", client.auth_session)],
            )
            .await;
        client.sid = None;
        client.syno_token = None;
        Ok(())
    }

    /// Fetch DSM info to get model / version after login.
    async fn fetch_dsm_info(client: &SynoClient) -> SynologyResult<DsmInfo> {
        let version = client.best_version("SYNO.DSM.Info", 2).unwrap_or(1);
        // First try SYNO.DSM.Info (older DSM)
        if client.has_api("SYNO.DSM.Info") {
            return client
                .api_call("SYNO.DSM.Info", version, "getinfo", &[])
                .await;
        }
        // Fallback to SYNO.Core.System / SYNO.Core.System.Status
        Err(SynologyError::api_not_found("SYNO.DSM.Info not available"))
    }

    /// Check if the current session is still valid.
    pub async fn check_session(client: &SynoClient) -> SynologyResult<bool> {
        if client.sid.is_none() {
            return Ok(false);
        }
        // API.Info is public and cannot validate an authenticated session.
        match client
            .api_call::<serde_json::Value>(
                "SYNO.FileStation.Info",
                client.best_version("SYNO.FileStation.Info", 2).unwrap_or(1),
                "get",
                &[],
            )
            .await
        {
            Ok(_) => Ok(true),
            Err(e) => {
                if matches!(e.kind, crate::error::SynologyErrorKind::SessionExpired) {
                    Ok(false)
                } else {
                    Err(e)
                }
            }
        }
    }
}
