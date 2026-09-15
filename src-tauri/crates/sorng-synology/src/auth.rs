//! Authentication module — password login with one-shot OTP, DSM 7's secure
//! login handshake, and legacy SID reuse.

use crate::client::SynoClient;
use crate::error::{SynologyError, SynologyResult};
use crate::login_handshake::{
    self, LoginOptions, LoginPlan, SecondFactor, SessionIdentity, AUTH_API, LEGACY_SESSION_NAME,
};
use crate::types::*;
use std::sync::atomic::AtomicBool;

/// Handles all authentication flows for Synology DSM.
pub struct AuthManager;

/// Non-secret facts of one login attempt, recorded once DSM accepts it.
struct Attempt {
    username: String,
    session_name: &'static str,
    auth_version: u32,
    otp_sent: bool,
}

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
        let username = client.config.username.clone();
        let password = std::mem::take(&mut client.config.password);
        let otp = client.config.otp_code.take();
        // Remembered-device enrollment and OTP bypass require a separate explicit
        // consent contract. This login does neither, even if DSM returns a did.
        client.device_token = None;
        client.config.device_token = None;
        client.identity.session_name = LEGACY_SESSION_NAME;

        let plan = login_handshake::begin(client, &LoginOptions::default(), &AtomicBool::new(true))
            .await?;
        let version = client
            .best_version(AUTH_API, plan.max_auth_version())
            .unwrap_or(3);

        let mut params: Vec<(&str, String)> = vec![
            ("account", username.clone()),
            ("passwd", password),
            ("session", LEGACY_SESSION_NAME.to_string()),
            ("format", "sid".to_string()),
        ];

        // Request SynoToken for DSM 7+
        if version >= 6 {
            params.push(("enable_syno_token", "yes".to_string()));
        }

        // Supply 2FA code if available
        let otp_sent = otp.is_some();
        if let Some(otp) = otp {
            params.push(("otp_code", otp));
        }
        if let Some(ik_message) = plan.ik_message() {
            params.push(("ik_message", ik_message.to_string()));
        }

        // Build form params as &str pairs
        let form_pairs: Vec<(&str, &str)> = params.iter().map(|(k, v)| (*k, v.as_str())).collect();

        let result = client
            .api_post::<LoginResult>(AUTH_API, version, "login", &form_pairs)
            .await;
        drop(form_pairs);
        drop(params);
        let login = result?;
        Self::establish(
            client,
            plan,
            login,
            Attempt {
                username,
                session_name: LEGACY_SESSION_NAME,
                auth_version: version,
                otp_sent,
            },
        );

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
    }

    /// The scoped explorer supports password + OTP, not PAT, device enrollment,
    /// Secure SignIn approval, or WebAuthn. Secrets leave config before awaiting.
    ///
    /// Every call is a complete new login: it fetches a fresh DSM server key and
    /// a new ephemeral key pair, so a one-time-code retry never replays an
    /// earlier handshake message, and no credential is re-sent automatically.
    pub(crate) async fn login_file_station(
        client: &mut SynoClient,
        options: &LoginOptions,
        active: &AtomicBool,
    ) -> SynologyResult<()> {
        use serde_json::json;
        let session_name = options.session_profile.session_name();
        client.identity.session_name = session_name;
        let username = client.config.username.clone();
        let password = std::mem::take(&mut client.config.password);
        let otp = client.config.otp_code.take();
        client.device_token = None;
        client.config.device_token = None;
        client.config.access_token = None;
        let plan = login_handshake::begin(client, options, active).await?;
        let maximum = plan.max_auth_version();
        let auth_version = client.best_version(AUTH_API, maximum).unwrap_or(0);
        let mut params = vec![
            ("account", json!(username)),
            ("passwd", json!(password)),
            ("session", json!(session_name)),
            // DSM's documented cookie mode authorizes the next request before
            // CGI body parsing, including deployments that do not use a
            // POST-body SID for the outer authentication check. The per-client
            // native cookie jar is isolated and never shared with the browser.
            ("format", json!("cookie")),
        ];
        if auth_version >= 6 {
            params.push(("enable_syno_token", json!("yes")));
        }
        let otp_sent = otp.is_some();
        if let Some(otp) = otp {
            params.push(("otp_code", json!(otp)));
        }
        if let Some(ik_message) = plan.ik_message() {
            params.push(("ik_message", json!(ik_message)));
        }
        let response = client
            .file_call_typed(AUTH_API, maximum, "login", &params)
            .await;
        drop(params);
        let login: LoginResult = response?;
        if login.sid.is_empty() || login.sid.len() > 4096 || login.sid.chars().any(char::is_control)
        {
            return Err(SynologyError::parse("NAS returned an invalid session"));
        }
        Self::establish(
            client,
            plan,
            login,
            Attempt {
                username,
                session_name,
                auth_version,
                otp_sent,
            },
        );
        Ok(())
    }

    /// Publishes an accepted login on the client: SID, token, the finished (or
    /// fallen-back) handshake and closed identity facts. It never fails.
    fn establish(client: &mut SynoClient, plan: LoginPlan, login: LoginResult, attempt: Attempt) {
        let (login_handshake, signer) = plan.finish(login.ik_message.as_deref());
        client.request_signer = signer;
        client.identity = SessionIdentity {
            signed_in_as: attempt.username,
            session_name: attempt.session_name,
            login_handshake,
            auth_version: attempt.auth_version,
            route: client.identity.route,
            second_factor: if attempt.otp_sent {
                SecondFactor::Otp
            } else {
                SecondFactor::None
            },
            portal_session: login.is_portal_port,
        };
        client.sid = Some(login.sid);
        client.syno_token = login.synotoken;
        log::info!(
            "DSM login established (handshake {:?}, auth v{})",
            client.identity.login_handshake,
            client.identity.auth_version
        );
    }

    /// Logout: invalidate the current session.
    pub async fn logout(client: &mut SynoClient) -> SynologyResult<()> {
        if client.sid.is_none() {
            return Ok(());
        }
        let version = client.best_version(AUTH_API, 7).unwrap_or(3);
        let _ = client
            .api_call_void(
                AUTH_API,
                version,
                "logout",
                &[("session", client.identity.session_name)],
            )
            .await;
        client.sid = None;
        client.syno_token = None;
        client.request_signer = None;
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
