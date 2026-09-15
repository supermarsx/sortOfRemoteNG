//! DSM 7 secure login handshake for native API sessions.
//!
//! DSM 7 gives a limited API session to clients that sign in from a remote
//! address (QuickConnect relay, WAN or DDNS URL) without the Noise
//! `ik_message` its own web UI sends. File Station and `SYNO.DSM.Info` keep
//! working in that session, but administrator Core APIs return 105, even for
//! an administrator.
//!
//! The handshake follows observed DSM behaviour (N4S4 `synology-api` PR #282
//! and PR #382, MIT; reimplemented, not copied):
//! 1. `SYNO.API.Auth.UIConfig` answers with an `_SSID` cookie holding the NAS's
//!    X25519 static key, base64url encoded.
//! 2. The `SYNO.API.Auth` v7 login carries initiator message 1 of
//!    `Noise_IK_25519_ChaChaPoly_BLAKE2b` with the payload
//!    `{"time":<unix seconds>}`, using a fresh static key pair per attempt.
//! 3. The login response's `ik_message` is message 2. The finished state
//!    signs every later non-File-Station request with `X-SYNO-HASH`.
//!
//! Nothing here fails a login. A NAS without these pieces gets the documented
//! v6 login (`legacy` / `legacy_unavailable`), and a missing or unreadable
//! reply leaves an unsigned session (`ik_incomplete`). Keys, Noise state and
//! the handshake hash stay inside the client, and `Debug` output redacts them.
use crate::{
    client::SynoClient,
    error::{SynologyError, SynologyResult},
    http_route::NativeHttpRoute,
};
use base64::{
    engine::general_purpose::{STANDARD_NO_PAD, URL_SAFE_NO_PAD},
    Engine,
};
use serde::{Deserialize, Serialize};
use std::{
    fmt,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};

pub(crate) const AUTH_API: &str = "SYNO.API.Auth";
pub(crate) const UI_CONFIG_API: &str = "SYNO.API.Auth.UIConfig";
pub(crate) const HASH_HEADER: &str = "X-SYNO-HASH";
pub(crate) const NOISE_PATTERN: &str = "Noise_IK_25519_ChaChaPoly_BLAKE2b";
const SERVER_KEY_COOKIE: &str = "_SSID";
const IK_AUTH_VERSION: u32 = 7;
const LEGACY_AUTH_VERSION: u32 = 6;
const UI_CONFIG_TIMEOUT: Duration = Duration::from_secs(4);
const UI_CONFIG_LIMIT: usize = 64 * 1024;
const MAX_SET_COOKIES: usize = 32;
const MAX_NOISE_MESSAGE: usize = 65_535;
const MAX_ENCODED_MESSAGE: usize = 90_000;
/// Session name of the compatibility singleton's password login.
pub(crate) const LEGACY_SESSION_NAME: &str = "SortOfRemoteNG";

/// Which DSM login session a native sign-in asks for.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionProfile {
    /// `session=FileStation`, the documented API session.
    #[default]
    FileStation,
    /// `session=webui`, DSM's desktop session. Requested only by an explicit
    /// user action ("Reconnect as DSM session"); it is a normal new login.
    DsmDesktop,
}

impl SessionProfile {
    pub fn session_name(self) -> &'static str {
        match self {
            Self::FileStation => "FileStation",
            Self::DsmDesktop => "webui",
        }
    }
}

/// Per-attempt sign-in choices. Every attempt, including each one-time-code
/// retry, is a new login with a new handshake.
#[derive(Clone, Debug, Default)]
pub struct LoginOptions {
    pub session_profile: SessionProfile,
    /// Test-only: sign in the way the client did before the handshake existed.
    #[cfg(test)]
    pub(crate) force_legacy: bool,
}

impl LoginOptions {
    #[must_use]
    pub fn with_session_profile(mut self, session_profile: SessionProfile) -> Self {
        self.session_profile = session_profile;
        self
    }

    fn skips_handshake(&self) -> bool {
        #[cfg(test)]
        {
            self.force_legacy
        }
        #[cfg(not(test))]
        {
            false
        }
    }
}

/// How the current session signed in.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LoginHandshake {
    /// DSM 7 secure login completed; requests are signed.
    Ik,
    /// `ik_message` was sent, but DSM's reply was missing or unreadable.
    IkIncomplete,
    /// DSM does not offer the handshake (DSM 6 or an older DSM 7).
    #[default]
    Legacy,
    /// DSM offers the handshake, but its server key could not be obtained.
    LegacyUnavailable,
}

/// Which kind of transport route carried the session. Never a host name.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionRoute {
    #[default]
    Direct,
    HttpProxy,
    QuickconnectRelay,
    QuickconnectDirect,
}

impl SessionRoute {
    pub(crate) fn for_transport(route: &NativeHttpRoute) -> Self {
        match route {
            NativeHttpRoute::Direct {} => Self::Direct,
            NativeHttpRoute::HttpProxy { .. } => Self::HttpProxy,
            #[cfg(test)]
            NativeHttpRoute::Fixture { .. } => Self::HttpProxy,
        }
    }
}

/// Which second factor completed the login.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SecondFactor {
    #[default]
    None,
    Otp,
    TrustedDevice,
}

/// Closed identity facts of one native session, for access explanations and
/// diagnostics. It holds no host, URL, SID, token, key or code.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionIdentity {
    /// The username sent at sign-in.
    pub signed_in_as: String,
    pub session_name: &'static str,
    pub login_handshake: LoginHandshake,
    /// `SYNO.API.Auth` version used for the login.
    pub auth_version: u32,
    pub route: SessionRoute,
    pub second_factor: SecondFactor,
    /// The login went through a DSM application-portal port.
    pub portal_session: bool,
}

impl SessionIdentity {
    pub(crate) fn unauthenticated(route: SessionRoute) -> Self {
        Self {
            signed_in_as: String::new(),
            session_name: LEGACY_SESSION_NAME,
            login_handshake: LoginHandshake::Legacy,
            auth_version: 0,
            route,
            second_factor: SecondFactor::None,
            portal_session: false,
        }
    }
}

/// Signs requests of a session whose handshake finished.
pub(crate) struct RequestSigner {
    transport: snow::TransportState,
    hash_prefix: String,
}

pub(crate) type SharedSigner = Arc<tokio::sync::Mutex<RequestSigner>>;

impl fmt::Debug for RequestSigner {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("RequestSigner { .. }")
    }
}

impl RequestSigner {
    /// `X-SYNO-HASH`: the first 8 base64url characters of the handshake hash,
    /// the base64url tag of an empty message encrypted (empty associated data)
    /// at the current sending nonce, `.`, and base64url of that nonce written
    /// in decimal. Each call consumes one nonce, so the caller must send the
    /// requests in the order the headers were made.
    pub(crate) fn next_header(&mut self) -> Option<String> {
        let nonce = self.transport.sending_nonce();
        let mut tag = [0_u8; 16];
        let length = self.transport.write_message(&[], &mut tag).ok()?;
        Some(format!(
            "{}{}.{}",
            self.hash_prefix,
            URL_SAFE_NO_PAD.encode(&tag[..length]),
            URL_SAFE_NO_PAD.encode(nonce.to_string())
        ))
    }

    #[cfg(test)]
    pub(crate) fn corrupt_hash_prefix_for_test(&mut self) {
        let replacement = if self.hash_prefix.starts_with('A') {
            "B"
        } else {
            "A"
        };
        self.hash_prefix.replace_range(..1, replacement);
    }
}

/// The login a sign-in attempt will send.
pub(crate) enum LoginPlan {
    Legacy(LoginHandshake),
    Ik {
        ik_message: String,
        state: Box<snow::HandshakeState>,
    },
}

impl fmt::Debug for LoginPlan {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Legacy(handshake) => formatter.debug_tuple("Legacy").field(handshake).finish(),
            Self::Ik { .. } => formatter.write_str("Ik { .. }"),
        }
    }
}

impl LoginPlan {
    /// Highest `SYNO.API.Auth` version this login may use.
    pub(crate) fn max_auth_version(&self) -> u32 {
        match self {
            Self::Legacy(_) => LEGACY_AUTH_VERSION,
            Self::Ik { .. } => IK_AUTH_VERSION,
        }
    }

    pub(crate) fn ik_message(&self) -> Option<&str> {
        match self {
            Self::Legacy(_) => None,
            Self::Ik { ik_message, .. } => Some(ik_message),
        }
    }

    /// Completes the handshake from the login response's `ik_message`. A
    /// missing or unreadable reply keeps the session, unsigned.
    pub(crate) fn finish(self, reply: Option<&str>) -> (LoginHandshake, Option<SharedSigner>) {
        match self {
            Self::Legacy(handshake) => (handshake, None),
            Self::Ik { state, .. } => match reply.and_then(|reply| complete(*state, reply)) {
                Some(signer) => (
                    LoginHandshake::Ik,
                    Some(Arc::new(tokio::sync::Mutex::new(signer))),
                ),
                None => (LoginHandshake::IkIncomplete, None),
            },
        }
    }
}

/// Decides the login for this attempt and, in IK mode, fetches a fresh server
/// key on the client's own route and builds message 1. Only cancellation is an
/// error; every other problem selects the documented login instead.
pub(crate) async fn begin(
    client: &SynoClient,
    options: &LoginOptions,
    active: &AtomicBool,
) -> SynologyResult<LoginPlan> {
    if options.skips_handshake() {
        return Ok(LoginPlan::Legacy(LoginHandshake::Legacy));
    }
    let Some(url) = ui_config_url(client) else {
        return Ok(LoginPlan::Legacy(LoginHandshake::Legacy));
    };
    current(active)?;
    let key = tokio::select! {
        biased;
        () = until_cancelled(active) => None,
        key = tokio::time::timeout(UI_CONFIG_TIMEOUT, server_static_key(client, &url)) => key.ok().flatten(),
    };
    current(active)?;
    let Some(key) = key else {
        log::info!("DSM secure login handshake unavailable: no usable server key");
        return Ok(LoginPlan::Legacy(LoginHandshake::LegacyUnavailable));
    };
    match first_message(&key, unix_seconds()) {
        Ok((ik_message, state)) => Ok(LoginPlan::Ik {
            ik_message,
            state: Box::new(state),
        }),
        Err(_) => Ok(LoginPlan::Legacy(LoginHandshake::LegacyUnavailable)),
    }
}

fn current(active: &AtomicBool) -> SynologyResult<()> {
    if active.load(Ordering::Acquire) {
        Ok(())
    } else {
        Err(SynologyError::session_expired(
            "Synology connection attempt was cancelled",
        ))
    }
}

async fn until_cancelled(active: &AtomicBool) {
    while active.load(Ordering::Acquire) {
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
}

fn unix_seconds() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_secs())
}

/// IK mode needs `SYNO.API.Auth` v7 and a discovered `SYNO.API.Auth.UIConfig`
/// with a safe endpoint path.
fn ui_config_url(client: &SynoClient) -> Option<String> {
    client
        .resolve_url(AUTH_API, IK_AUTH_VERSION, "login")
        .ok()?;
    client.resolve_url(UI_CONFIG_API, 1, "get").ok()?;
    let path = &client.api_info.get(UI_CONFIG_API)?.path;
    Some(format!("{}/webapi/{path}/{UI_CONFIG_API}", client.base_url))
}

/// Reads `_SSID` from this response's `Set-Cookie`, never from the cookie jar,
/// so a key from an earlier attempt or another origin cannot be reused.
async fn server_static_key(client: &SynoClient, url: &str) -> Option<[u8; 32]> {
    let mut response = client
        .http_client()
        .post(url)
        .form(&[("api", UI_CONFIG_API), ("method", "get"), ("version", "1")])
        .send()
        .await
        .ok()?;
    if !response.status().is_success()
        || response
            .content_length()
            .is_some_and(|length| length > UI_CONFIG_LIMIT as u64)
    {
        return None;
    }
    let key = cookie_server_key(response.headers());
    let mut read = 0_usize;
    while let Some(chunk) = response.chunk().await.ok()? {
        read = read.saturating_add(chunk.len());
        if read > UI_CONFIG_LIMIT {
            return None;
        }
    }
    key
}

fn cookie_server_key(headers: &reqwest::header::HeaderMap) -> Option<[u8; 32]> {
    let cookies = headers.get_all(reqwest::header::SET_COOKIE);
    if cookies.iter().count() > MAX_SET_COOKIES {
        return None;
    }
    let value = cookies
        .iter()
        .filter_map(|cookie| cookie.to_str().ok())
        .find_map(|cookie| {
            let (name, value) = cookie.split(';').next()?.split_once('=')?;
            (name.trim() == SERVER_KEY_COOKIE).then(|| value.trim().trim_matches('"'))
        })?;
    if value.len() > 128 {
        return None;
    }
    let key = <[u8; 32]>::try_from(decode_b64url(value)?).ok()?;
    key.iter().any(|byte| *byte != 0).then_some(key)
}

/// Accepts base64url or standard base64, with or without padding.
pub(crate) fn decode_b64url(text: &str) -> Option<Vec<u8>> {
    if text.is_empty() || text.len() > MAX_ENCODED_MESSAGE {
        return None;
    }
    let normalized: String = text
        .trim_end_matches('=')
        .chars()
        .map(|character| match character {
            '-' => '+',
            '_' => '/',
            other => other,
        })
        .collect();
    STANDARD_NO_PAD.decode(normalized).ok()
}

/// Message 1 with a new random static key pair that is never stored.
pub(crate) fn first_message(
    server_key: &[u8; 32],
    unix_seconds: u64,
) -> Result<(String, snow::HandshakeState), snow::Error> {
    let params: snow::params::NoiseParams = NOISE_PATTERN.parse()?;
    let mut static_key = snow::Builder::new(params.clone()).generate_keypair()?;
    let built = snow::Builder::new(params)
        .local_private_key(&static_key.private)
        .and_then(|builder| builder.remote_public_key(server_key))
        .and_then(snow::Builder::build_initiator);
    static_key.private.fill(0);
    let mut state = built?;
    let payload = format!("{{\"time\":{unix_seconds}}}");
    let mut message = [0_u8; 256];
    let length = state.write_message(payload.as_bytes(), &mut message)?;
    Ok((URL_SAFE_NO_PAD.encode(&message[..length]), state))
}

fn complete(mut state: snow::HandshakeState, reply: &str) -> Option<RequestSigner> {
    let message = decode_b64url(reply).filter(|message| message.len() <= MAX_NOISE_MESSAGE)?;
    let mut payload = vec![0_u8; message.len()];
    state.read_message(&message, &mut payload).ok()?;
    if !state.is_handshake_finished() {
        return None;
    }
    let hash_prefix = URL_SAFE_NO_PAD
        .encode(state.get_handshake_hash())
        .get(..8)?
        .to_owned();
    let transport = state.into_transport_mode().ok()?;
    Some(RequestSigner {
        transport,
        hash_prefix,
    })
}
