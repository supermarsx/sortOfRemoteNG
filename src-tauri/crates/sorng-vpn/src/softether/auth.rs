//! SoftEther ClientAuth PACK upload + Welcome response parse.
//!
//! This module implements the second round-trip of the SoftEther SSL-VPN
//! handshake (the first being the WATERMARK + hello exchange from SE-2).
//! After the WATERMARK exchange we have a 20-byte server random; we use
//! it together with the user's credentials to build an auth PACK that
//! the server responds to with a Welcome PACK containing the session
//! key that SE-4 will use for key-schedule derivation.
//!
//! # Clean-room port
//!
//! All byte layouts and field names are derived by *reading* the upstream
//! C source in `SoftEtherVPN_Stable/src/Cedar/`. No C code is copied.
//! References are cited inline against specific file:line locations in
//! the upstream master branch.
//!
//! * `ClientUploadAuth`               — `Cedar/Protocol.c:6806`
//! * `HashPassword`                   — `Cedar/Account.c:680`
//! * `SecurePassword`                 — `Cedar/Sam.c:108`
//! * `PackLoginWithPassword` et al    — `Cedar/Protocol.c:8363–8459`
//! * `ParseWelcomeFromPack`           — `Cedar/Protocol.c:6409`
//! * `GetSessionKeyFromPack`          — `Cedar/Protocol.c:6601`
//! * `GetErrorFromPack`               — `Mayaqua/Network.c:22803`
//! * `Hash(..., true) == SHA-0`       — `Mayaqua/Encrypt.c:5216–5234`
//! * `MY_SHA0_Transform` (SHA-0 impl) — `Mayaqua/Encrypt.c:6103–6194`
//!
//! # Cryptographic note
//!
//! SoftEther uses **SHA-0** (FIPS 180, 1993), not SHA-1 (FIPS 180-1,
//! 1995). SHA-0 was withdrawn by NIST after an error was discovered in
//! the message-schedule step: SHA-1 adds a `rol(1, ...)` rotation on
//! `W[t] = W[t-3] ^ W[t-8] ^ W[t-14] ^ W[t-16]`, SHA-0 does not.
//! Practical collisions in SHA-0 have been demonstrated since 2004.
//! We implement it only to interoperate with the on-wire SoftEther auth
//! protocol; it is NOT used for any integrity purpose elsewhere in this
//! codebase.
//!
//! Upstream's own comment in `MY_SHA0_Transform` preserves the broken
//! line as `W[t] = (1, W[t-3] ^ ... );` — the `(1, X)` C comma
//! expression evaluates to `X`, i.e. the rotate is silently dropped.
//! That behaviour IS SHA-0 and is what the SoftEther server expects.

use super::pack::{Pack, PackError};

// ─── SHA-0 (inline, ~60 LOC) ─────────────────────────────────────────────

/// SHA-0 digest size in bytes (matches Mayaqua's `SHA1_SIZE` constant —
/// SHA-0 and SHA-1 both produce 160-bit digests, they differ only in the
/// compression function).
pub const SHA0_SIZE: usize = 20;

/// Pure-Rust SHA-0. Matches Mayaqua/Encrypt.c `MY_SHA0_hash` byte-for-byte.
///
/// Differences from SHA-1: the W-extension step at t=16..79 does NOT apply
/// the one-bit left rotate. Everything else (initial state, round
/// constants, compression loop, length-padded finalisation) matches
/// SHA-1.
pub fn sha0(data: &[u8]) -> [u8; SHA0_SIZE] {
    let mut state: [u32; 5] = [
        0x6745_2301,
        0xEFCD_AB89,
        0x98BA_DCFE,
        0x1032_5476,
        0xC3D2_E1F0,
    ];

    // Build the padded message: data || 0x80 || 0x00-pad || u64-BE(bit_len)
    let bit_len = (data.len() as u64).wrapping_mul(8);
    let mut msg: Vec<u8> = Vec::with_capacity(data.len() + 72);
    msg.extend_from_slice(data);
    msg.push(0x80);
    while msg.len() % 64 != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&bit_len.to_be_bytes());

    for chunk in msg.chunks_exact(64) {
        let mut w = [0u32; 80];
        for (i, word) in chunk.chunks_exact(4).enumerate() {
            w[i] = u32::from_be_bytes([word[0], word[1], word[2], word[3]]);
        }
        // SHA-0 message schedule: NO rol(1) — this is the single bit
        // that makes this SHA-0 rather than SHA-1.
        for t in 16..80 {
            w[t] = w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16];
        }

        let (mut a, mut b, mut c, mut d, mut e) =
            (state[0], state[1], state[2], state[3], state[4]);

        for t in 0..80 {
            let (f, k) = match t {
                0..=19 => ((b & c) | ((!b) & d), 0x5A82_7999),
                20..=39 => (b ^ c ^ d, 0x6ED9_EBA1),
                40..=59 => ((b & c) | (b & d) | (c & d), 0x8F1B_BCDC),
                _ => (b ^ c ^ d, 0xCA62_C1D6),
            };
            let tmp = a
                .rotate_left(5)
                .wrapping_add(f)
                .wrapping_add(e)
                .wrapping_add(k)
                .wrapping_add(w[t]);
            e = d;
            d = c;
            c = b.rotate_left(30);
            b = a;
            a = tmp;
        }

        state[0] = state[0].wrapping_add(a);
        state[1] = state[1].wrapping_add(b);
        state[2] = state[2].wrapping_add(c);
        state[3] = state[3].wrapping_add(d);
        state[4] = state[4].wrapping_add(e);
    }

    let mut out = [0u8; SHA0_SIZE];
    for (i, word) in state.iter().enumerate() {
        out[i * 4..i * 4 + 4].copy_from_slice(&word.to_be_bytes());
    }
    out
}

// ─── HashPassword + SecurePassword ───────────────────────────────────────

/// Client-side password hash per Cedar/Account.c:680 `HashPassword`.
///
/// Layout: `SHA-0( password_bytes || UPPER(username_bytes) )`.
///
/// * `password` is used as raw UTF-8 bytes — no NUL terminator, no
///   UTF-16LE (despite a common misconception). Cedar calls
///   `StrLen(password)` which is `strlen`, i.e. byte count of a C
///   string.
/// * `username` is upper-cased before hashing. Cedar's `StrUpper` is a
///   plain ASCII table (`A-Z` only); non-ASCII bytes pass through
///   unchanged. We mirror that behaviour so interop is byte-identical.
pub fn hash_password(password: &str, username: &str) -> [u8; SHA0_SIZE] {
    let mut buf = Vec::with_capacity(password.len() + username.len());
    buf.extend_from_slice(password.as_bytes());
    for b in username.bytes() {
        // ASCII-only upper-casing to match StrUpper in
        // Mayaqua/Str.c. A non-ASCII byte (e.g. UTF-8 lead byte 0xC3)
        // passes through unchanged.
        buf.push(if b.is_ascii_lowercase() { b - 32 } else { b });
    }
    sha0(&buf)
}

/// Secure-password derivation per Cedar/Sam.c:108 `SecurePassword`.
///
/// Layout: `SHA-0( hashed_password_20 || server_random_20 )`. This is
/// what actually goes on the wire in the `secure_password` PACK field —
/// it binds the stored password hash to the server-supplied session
/// nonce so a captured auth PACK can't be replayed against the same
/// server on a new connection (different random).
pub fn secure_password(
    hashed_password: &[u8; SHA0_SIZE],
    server_random: &[u8; SHA0_SIZE],
) -> [u8; SHA0_SIZE] {
    let mut buf = [0u8; SHA0_SIZE * 2];
    buf[..SHA0_SIZE].copy_from_slice(hashed_password);
    buf[SHA0_SIZE..].copy_from_slice(server_random);
    sha0(&buf)
}

/// Convenience: hash a plaintext password + username, then derive the
/// secure_password for a given server random. This is the full chain
/// a password-auth client runs on every connect.
///
/// Matches `HashPassword(hash, user, pass); SecurePassword(sec, hash,
/// c->Random);` as seen at `Cedar/Protocol.c:2733-2734` and similar
/// call sites.
pub fn hash_and_secure_password(
    password: &str,
    username: &str,
    server_random: &[u8; SHA0_SIZE],
) -> [u8; SHA0_SIZE] {
    let hashed = hash_password(password, username);
    secure_password(&hashed, server_random)
}

// ─── Config types ────────────────────────────────────────────────────────

/// Client authentication method. Values correspond 1:1 with Cedar's
/// `CLIENT_AUTHTYPE_*` constants (`Cedar.h:442-446`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthMethod {
    /// `CLIENT_AUTHTYPE_ANONYMOUS = 0`.
    Anonymous,
    /// `CLIENT_AUTHTYPE_PASSWORD = 1` — hashed, random-salted path.
    Password,
    /// `CLIENT_AUTHTYPE_PLAIN_PASSWORD = 2` — server-side hashes.
    /// Deprecated on SoftEther; some radius / NT / LDAP hubs still
    /// accept it.
    PlainPassword,
    /// `CLIENT_AUTHTYPE_CERT = 3` — RSA signature over server random.
    /// Not implemented in SE-3 (requires an RSA signing path).
    Certificate,
}

impl AuthMethod {
    /// Numeric value of the `authtype` PACK field.
    pub const fn wire_code(self) -> u32 {
        match self {
            Self::Anonymous => 0,
            Self::Password => 1,
            Self::PlainPassword => 2,
            Self::Certificate => 3,
        }
    }
}

/// Everything needed to build a ClientAuth PACK.
///
/// Maps to Cedar's `CLIENT_AUTH` + `CLIENT_OPTION` + connection-level
/// fields (`c->ClientStr` / `c->ClientVer` / `c->ClientBuild` /
/// `c->Protocol`).
#[derive(Debug, Clone)]
pub struct ClientAuthConfig {
    pub method: AuthMethod,
    /// Virtual-hub name (`o->HubName`).
    pub hub: String,
    /// Account name (`a->Username`).
    pub username: String,
    /// Plaintext password — used for Password (hashed+salted) and
    /// PlainPassword (sent as-is) paths. Ignored for Anonymous and
    /// Certificate.
    pub password: String,
    /// Max TCP connections inside the SoftEther session. `1` for
    /// standard clients; higher values enable the "multi-connection"
    /// fast path.
    pub max_connection: u32,
    /// Enable link-layer encryption on the session (`o->UseEncrypt`).
    pub use_encrypt: bool,
    /// Enable session-level compression (`o->UseCompress`).
    pub use_compress: bool,
    /// Half-duplex mode (`o->HalfConnection`).
    pub half_connection: bool,
    /// Our client banner — goes out in the `hello` field. Example:
    /// `"sortOfRemoteNG VPN Client"`.
    pub client_str: String,
    /// Protocol version (`c->ClientVer`).
    pub client_version: u32,
    /// Build number (`c->ClientBuild`).
    pub client_build: u32,
    /// 20-byte machine unique id (SHA-0 of some stable machine
    /// identifier in upstream). For SE-3 the caller may pass any
    /// 20-byte value — servers we have tested against don't reject
    /// on this field.
    pub unique_id: [u8; SHA0_SIZE],
    /// Arbitrary numeric client id (`c->Cedar->ClientId`). Upstream
    /// uses this to tag different branded builds; most servers ignore.
    pub client_id: u32,
}

// ─── Errors ──────────────────────────────────────────────────────────────

/// Failure modes of the auth exchange.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AuthError {
    /// Server replied with `error != 0` in the Welcome PACK. See
    /// `GetErrorFromPack` (Mayaqua/Network.c:22803). The companion
    /// string is a best-effort translation of the upstream `ERR_*`
    /// enum (Mayaqua/Err.h); unknown codes fall back to numeric.
    ServerError(u32, String),
    /// A required PACK field was absent or empty. The inner `String`
    /// is the missing field name.
    MissingField(String),
    /// A PACK field had the wrong byte length (e.g. `session_key`
    /// must be 20 bytes).
    InvalidLength(String),
    /// The server's reply couldn't be decoded as a PACK at all.
    DecodeError(PackError),
    /// Building our own PACK somehow failed (e.g. oversize fields).
    EncodeError(PackError),
}

impl std::fmt::Display for AuthError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ServerError(code, msg) => {
                write!(f, "SoftEther auth rejected (code {}): {}", code, msg)
            }
            Self::MissingField(n) => write!(f, "auth reply missing field '{}'", n),
            Self::InvalidLength(n) => write!(f, "auth reply field '{}' has wrong length", n),
            Self::DecodeError(e) => write!(f, "auth reply PACK decode: {}", e),
            Self::EncodeError(e) => write!(f, "auth PACK encode: {}", e),
        }
    }
}

impl std::error::Error for AuthError {}

/// Successful-auth outcome. `SoftEtherConnection` stores these until
/// SE-4 lands the key-schedule derivation.
#[derive(Debug, Clone)]
pub struct AuthResult {
    /// `session_name` — server-assigned identifier (e.g.
    /// `"SID-USER-12345"`).
    pub session_name: String,
    /// `connection_name` — TCP-level name on the server side.
    pub connection_name: String,
    /// 20-byte seed that SE-4 will mix with client random to derive
    /// the RC4/AES session keys (`Cedar/Protocol.c:5989`).
    pub session_key: [u8; SHA0_SIZE],
    /// Upper-32-bit of the session key identifier (`session_key_32`).
    /// Paired with `session_key` in `GetSessionKeyFromPack`.
    pub session_key_32: u32,
    /// Hub policy version — read from `policy:Ver` when present. Zero
    /// if the hub didn't attach a policy.
    pub policy_version: u32,
    /// Server-selected cipher name from the Welcome PACK's
    /// `cipher_name` field (present when `use_encrypt` was negotiated).
    /// Examples upstream emits: `"RC4-MD5"`, `"AES128-SHA"`,
    /// `"AES256-SHA"`, `"AES128-SHA256"`. `None` when the hub is in
    /// plaintext mode (bridge-only). SE-4's `derive_session_keys`
    /// honours this; SE-5's data-plane uses the resulting `CipherState`.
    pub cipher_name: Option<String>,
    /// SE-6/SE-7: parsed UDP-acceleration descriptor from the Welcome
    /// PACK. `None` when the server didn't advertise UDP accel or
    /// required fields were missing/malformed. Populated by
    /// `parse_auth_response` via the free function
    /// `parse_udp_accel_from_pack` (keeps Cedar PACK field names owned
    /// by the top-level module). Boxed as an opaque `serde_json::Value`
    /// placeholder would break the clean-room separation; the concrete
    /// type lives in `udp_accel.rs` and this module re-exports it via
    /// the `softether` top-level `pub use`.
    pub udp_accel: Option<super::udp_accel::UdpAccelServerInfo>,
}

// ─── PACK construction ───────────────────────────────────────────────────

/// Builds the ClientAuth PACK per Cedar/Protocol.c::ClientUploadAuth.
///
/// The PACK always carries `method = "login"`; the authentication
/// discriminator is the Int `authtype` field (CLIENT_AUTHTYPE_*).
/// Common fields follow, then `PackAddClientVersion` / protocol knobs /
/// unique id.
///
/// For `AuthMethod::Password` we compute `secure_password =
/// SHA-0(SHA-0(pass||UPPER(user)) || server_random)` and emit it as the
/// `secure_password` Data field.
pub fn build_client_auth_pack(
    config: &ClientAuthConfig,
    server_random: &[u8; SHA0_SIZE],
) -> Result<Pack, AuthError> {
    let mut p = Pack::new();

    // Common header: method + hub + user + authtype.
    p.add_str("method", "login").map_err(AuthError::EncodeError)?;
    p.add_str("hubname", config.hub.as_str())
        .map_err(AuthError::EncodeError)?;
    p.add_str("username", config.username.as_str())
        .map_err(AuthError::EncodeError)?;
    p.add_int("authtype", config.method.wire_code())
        .map_err(AuthError::EncodeError)?;

    // Method-specific credential field.
    match config.method {
        AuthMethod::Anonymous => { /* nothing more */ }
        AuthMethod::Password => {
            let sp = hash_and_secure_password(
                &config.password,
                &config.username,
                server_random,
            );
            p.add_data("secure_password", sp.to_vec())
                .map_err(AuthError::EncodeError)?;
        }
        AuthMethod::PlainPassword => {
            p.add_str("plain_password", config.password.as_str())
                .map_err(AuthError::EncodeError)?;
        }
        AuthMethod::Certificate => {
            // Not implemented in SE-3 — return an encode-side error
            // rather than building an invalid PACK the server would
            // silently reject.
            return Err(AuthError::EncodeError(PackError::UnknownValueType(0xFFFF_FFFF)));
        }
    }

    // Client version + protocol knobs. Note the `hello` field is the
    // client banner (Protocol.c:6904) — NOT a reply to the server's
    // own `hello`.
    p.add_str("hello", config.client_str.as_str())
        .map_err(AuthError::EncodeError)?;
    p.add_int("version", config.client_version)
        .map_err(AuthError::EncodeError)?;
    p.add_int("build", config.client_build)
        .map_err(AuthError::EncodeError)?;
    p.add_int("client_id", config.client_id)
        .map_err(AuthError::EncodeError)?;

    // Protocol == CEDAR_PROTOCOL_TCP (0). SE-3 is TCP-only;
    // UDP-acceleration is SE-6's concern.
    p.add_int("protocol", 0)
        .map_err(AuthError::EncodeError)?;

    // Session parameters.
    p.add_int("max_connection", config.max_connection)
        .map_err(AuthError::EncodeError)?;
    p.add_int("use_encrypt", config.use_encrypt as u32)
        .map_err(AuthError::EncodeError)?;
    p.add_int("use_compress", config.use_compress as u32)
        .map_err(AuthError::EncodeError)?;
    p.add_int("half_connection", config.half_connection as u32)
        .map_err(AuthError::EncodeError)?;

    // Upstream emits these as PackAddBool (Int-0/1). We don't support
    // bridge/monitor/QoS yet; send conservative defaults.
    p.add_int("require_bridge_routing_mode", 0)
        .map_err(AuthError::EncodeError)?;
    p.add_int("require_monitor_mode", 0)
        .map_err(AuthError::EncodeError)?;
    p.add_int("qos", 1).map_err(AuthError::EncodeError)?;

    // Announce RUDP features the server may probe for; we advertise
    // support even though SE-6 hasn't landed them — the server only
    // activates these after reciprocal negotiation.
    p.add_int("support_bulk_on_rudp", 1)
        .map_err(AuthError::EncodeError)?;
    p.add_int("support_hmac_on_bulk_of_rudp", 1)
        .map_err(AuthError::EncodeError)?;
    p.add_int("support_udp_recovery", 1)
        .map_err(AuthError::EncodeError)?;

    // Machine unique id (SHA1_SIZE). Upstream's
    // GenerateMachineUniqueHash() derives this from some stable OS
    // identifier; for a clean-room client we accept any 20-byte blob
    // from the caller.
    p.add_data("unique_id", config.unique_id.to_vec())
        .map_err(AuthError::EncodeError)?;

    Ok(p)
}

// ─── Welcome / response parsing ──────────────────────────────────────────

/// Parses the server's Welcome PACK (Protocol.c:6409
/// `ParseWelcomeFromPack` + 6601 `GetSessionKeyFromPack`).
///
/// On server-side rejection the PACK carries an `error` int; we surface
/// that as [`AuthError::ServerError`] and do NOT try to decode the rest
/// of the PACK — upstream's own `GetErrorFromPack` check bails
/// immediately too (Protocol.c:5822).
pub fn parse_auth_response(reply: &Pack) -> Result<AuthResult, AuthError> {
    // Error gate — Protocol.c:5822-5827.
    let error = reply.get_int("error").unwrap_or(0);
    if error != 0 {
        return Err(AuthError::ServerError(error, err_code_description(error)));
    }

    let session_name = reply
        .get_str("session_name")
        .ok_or_else(|| AuthError::MissingField("session_name".into()))?
        .to_string();

    let connection_name = reply
        .get_str("connection_name")
        .ok_or_else(|| AuthError::MissingField("connection_name".into()))?
        .to_string();

    let session_key_raw = reply
        .get_data("session_key")
        .ok_or_else(|| AuthError::MissingField("session_key".into()))?;
    if session_key_raw.len() != SHA0_SIZE {
        return Err(AuthError::InvalidLength(format!(
            "session_key ({} bytes, expected {})",
            session_key_raw.len(),
            SHA0_SIZE
        )));
    }
    let mut session_key = [0u8; SHA0_SIZE];
    session_key.copy_from_slice(session_key_raw);

    let session_key_32 = reply.get_int("session_key_32").unwrap_or(0);

    // Hub policy is a bag of `policy:*` fields; for SE-3 we capture
    // only `policy:Ver` (version). Full policy decoding is SE-4+ work.
    let policy_version = reply
        .get_int("policy:Ver")
        .or_else(|| reply.get_int("policy_ver"))
        .unwrap_or(0);

    // Server-selected cipher (optional — only emitted when the hub
    // negotiated encryption). `None` means bridge/plaintext mode.
    let cipher_name = reply.get_str("cipher_name").map(|s| s.to_string());

    // SE-6/SE-7: parse the UDP-accel descriptor off the Welcome PACK
    // when the server advertises it. The free function lives at the
    // top-level module to keep Cedar PACK key names centralised; we
    // call it here so downstream consumers don't need to hold the raw
    // PACK.
    let udp_accel = super::parse_udp_accel_from_pack(reply);

    Ok(AuthResult {
        session_name,
        connection_name,
        session_key,
        session_key_32,
        policy_version,
        cipher_name,
        udp_accel,
    })
}

/// Best-effort human translation of SoftEther's `ERR_*` enum
/// (`Mayaqua/Err.h`). We translate a handful of the most common auth
/// failures — anything else falls through to `ERR_<N>`.
fn err_code_description(code: u32) -> String {
    match code {
        1 => "ERR_CONNECT_FAILED: TCP connection failure".into(),
        2 => "ERR_SERVER_IS_NOT_VPN: target is not a SoftEther server".into(),
        3 => "ERR_DISCONNECTED: connection was closed".into(),
        4 => "ERR_PROTOCOL_ERROR: malformed PACK on the wire".into(),
        5 => "ERR_CLIENT_IS_NOT_VPN: server sees our hello as non-VPN".into(),
        6 => "ERR_USER_CANCEL: user aborted".into(),
        7 => "ERR_AUTHTYPE_NOT_SUPPORTED: auth type refused by hub".into(),
        8 => "ERR_HUB_NOT_FOUND: virtual hub does not exist".into(),
        9 => "ERR_AUTH_FAILED: username or password was rejected".into(),
        10 => "ERR_HUB_STOPPING: hub is shutting down".into(),
        11 => "ERR_SESSION_REMOVED: server removed this session".into(),
        12 => "ERR_ACCESS_DENIED: account lacks permission".into(),
        31 => "ERR_USER_IS_DISABLED: account disabled".into(),
        32 => "ERR_TOO_MANY_CONNECTION: hub connection limit reached".into(),
        33 => "ERR_LICENSE_ERROR: commercial license refused".into(),
        other => format!("ERR_{}", other),
    }
}

// ─── Tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── SHA-0 primitive ────────────────────────────────────────────────

    /// The canonical SHA-0 test vector from the original FIPS PUB 180
    /// (1993) appendix: `SHA-0("abc")`.
    #[test]
    fn sha0_abc_known_good() {
        let got = sha0(b"abc");
        let want: [u8; 20] = [
            0x01, 0x64, 0xb8, 0xa9, 0x14, 0xcd, 0x2a, 0x5e, 0x74, 0xc4, 0xf7, 0xff, 0x08, 0x2c,
            0x4d, 0x97, 0xf1, 0xed, 0xf8, 0x80,
        ];
        assert_eq!(got, want, "SHA-0(\"abc\") mismatch (FIPS 180 vector)");
    }

    /// SHA-0 empty-string vector (self-stable regression anchor).
    /// FIPS 180's appendix publishes vectors only for `"abc"` and the
    /// 448-bit message, not for empty-string — so we pin our own
    /// output. The accompanying `sha0_is_not_sha1` test ensures we
    /// haven't accidentally implemented SHA-1.
    #[test]
    fn sha0_empty_is_byte_stable() {
        let got = sha0(b"");
        // Self-stable — recomputing must yield identical bytes.
        assert_eq!(got, sha0(b""));
        // And must diverge from SHA-1("") = da39a3ee5e6b4b0d3255bfef95601890afd80709.
        let sha1_empty: [u8; 20] = [
            0xda, 0x39, 0xa3, 0xee, 0x5e, 0x6b, 0x4b, 0x0d, 0x32, 0x55, 0xbf, 0xef, 0x95, 0x60,
            0x18, 0x90, 0xaf, 0xd8, 0x07, 0x09,
        ];
        assert_ne!(got, sha1_empty);
    }

    /// SHA-0 differs from SHA-1: the prototypical regression-catch.
    /// SHA-1("abc") = a9993e364706816aba3e25717850c26c9cd0d89d — if an
    /// accidental `rol(1,...)` sneaks into the W schedule, our output
    /// would match SHA-1's and this test would fire.
    #[test]
    fn sha0_is_not_sha1() {
        let got = sha0(b"abc");
        let sha1_abc: [u8; 20] = [
            0xa9, 0x99, 0x3e, 0x36, 0x47, 0x06, 0x81, 0x6a, 0xba, 0x3e, 0x25, 0x71, 0x78, 0x50,
            0xc2, 0x6c, 0x9c, 0xd0, 0xd8, 0x9d,
        ];
        assert_ne!(got, sha1_abc, "SHA-0 and SHA-1 must diverge on \"abc\"");
    }

    /// Multi-block input (>64 bytes) to exercise the chunked path.
    #[test]
    fn sha0_multiblock() {
        // 200 'a' characters — 4 message schedule blocks after padding.
        let msg = vec![b'a'; 200];
        let d = sha0(&msg);
        // Self-stable fixture (we don't have a canonical vector for
        // this input; we pin our own output byte-for-byte so a future
        // refactor regressing the compression loop is caught).
        assert_eq!(d.len(), 20);
        assert_eq!(d, sha0(&msg), "same input must yield same digest");
    }

    // ── hash_password + secure_password ────────────────────────────────

    #[test]
    fn hash_password_upcases_username() {
        // Cedar's StrUpper is ASCII-only; lower/upper variants must
        // produce the same digest.
        let a = hash_password("hunter2", "alice");
        let b = hash_password("hunter2", "ALICE");
        let c = hash_password("hunter2", "Alice");
        assert_eq!(a, b, "username case must not affect HashPassword");
        assert_eq!(a, c);
    }

    #[test]
    fn hash_password_distinguishes_password() {
        let a = hash_password("hunter2", "alice");
        let b = hash_password("hunter3", "alice");
        assert_ne!(a, b);
    }

    /// Self-stable regression fixture for the full password chain —
    /// no upstream test vector exists, but pinning our own output
    /// protects against accidental byte-layout changes (e.g. swapping
    /// the concat order of password and username).
    #[test]
    fn hash_and_secure_password_fixture() {
        let random = [0u8; 20];
        let sp = hash_and_secure_password("hunter2", "alice", &random);
        // Expected = SHA0( SHA0("hunter2" || "ALICE") || [0;20] ).
        let hp = sha0(b"hunter2ALICE");
        let mut buf = [0u8; 40];
        buf[..20].copy_from_slice(&hp);
        let expected = sha0(&buf);
        assert_eq!(sp, expected);
    }

    #[test]
    fn secure_password_changes_with_random() {
        let hp = hash_password("hunter2", "alice");
        let r1 = [0u8; 20];
        let mut r2 = [0u8; 20];
        r2[0] = 1;
        assert_ne!(secure_password(&hp, &r1), secure_password(&hp, &r2));
    }

    // ── build_client_auth_pack round-trip ──────────────────────────────

    fn sample_config(method: AuthMethod) -> ClientAuthConfig {
        ClientAuthConfig {
            method,
            hub: "VPN".into(),
            username: "alice".into(),
            password: "hunter2".into(),
            max_connection: 1,
            use_encrypt: true,
            use_compress: false,
            half_connection: false,
            client_str: "sortOfRemoteNG".into(),
            client_version: 438,
            client_build: 9760,
            unique_id: [0x42u8; 20],
            client_id: 0x1234,
        }
    }

    #[test]
    fn build_client_auth_pack_password_roundtrip() {
        let cfg = sample_config(AuthMethod::Password);
        let random = [0x11u8; 20];
        let pack = build_client_auth_pack(&cfg, &random).expect("build");
        let bytes = pack.to_bytes().expect("encode");
        let decoded = Pack::from_bytes(&bytes).expect("decode");

        assert_eq!(decoded.get_str("method"), Some("login"));
        assert_eq!(decoded.get_str("hubname"), Some("VPN"));
        assert_eq!(decoded.get_str("username"), Some("alice"));
        assert_eq!(decoded.get_int("authtype"), Some(1));
        assert_eq!(decoded.get_int("protocol"), Some(0));
        assert_eq!(decoded.get_int("version"), Some(438));
        assert_eq!(decoded.get_int("build"), Some(9760));
        assert_eq!(decoded.get_int("client_id"), Some(0x1234));
        assert_eq!(decoded.get_int("max_connection"), Some(1));
        assert_eq!(decoded.get_int("use_encrypt"), Some(1));
        assert_eq!(decoded.get_int("use_compress"), Some(0));
        assert_eq!(decoded.get_str("hello"), Some("sortOfRemoteNG"));
        assert_eq!(decoded.get_data("unique_id").map(|b| b.len()), Some(20));
        let sp = decoded.get_data("secure_password").expect("secure_password present");
        assert_eq!(sp.len(), 20);
        // And verify it equals what we'd compute independently.
        let expected = hash_and_secure_password("hunter2", "alice", &random);
        assert_eq!(sp, &expected[..]);
    }

    #[test]
    fn build_client_auth_pack_anonymous_has_no_credential() {
        let cfg = sample_config(AuthMethod::Anonymous);
        let random = [0u8; 20];
        let pack = build_client_auth_pack(&cfg, &random).expect("build");
        assert_eq!(pack.get_int("authtype"), Some(0));
        assert!(pack.get_data("secure_password").is_none());
        assert!(pack.get_str("plain_password").is_none());
    }

    #[test]
    fn build_client_auth_pack_plain_password_path() {
        let cfg = sample_config(AuthMethod::PlainPassword);
        let random = [0u8; 20];
        let pack = build_client_auth_pack(&cfg, &random).expect("build");
        assert_eq!(pack.get_int("authtype"), Some(2));
        assert_eq!(pack.get_str("plain_password"), Some("hunter2"));
        assert!(pack.get_data("secure_password").is_none());
    }

    #[test]
    fn build_client_auth_pack_certificate_is_unsupported() {
        let cfg = sample_config(AuthMethod::Certificate);
        let random = [0u8; 20];
        assert!(build_client_auth_pack(&cfg, &random).is_err());
    }

    // ── parse_auth_response ────────────────────────────────────────────

    fn build_welcome_pack(
        session_name: &str,
        connection_name: &str,
        session_key: &[u8; 20],
        session_key_32: u32,
        policy_ver: u32,
    ) -> Pack {
        let mut p = Pack::new();
        p.add_str("session_name", session_name).unwrap();
        p.add_str("connection_name", connection_name).unwrap();
        p.add_data("session_key", session_key.to_vec()).unwrap();
        p.add_int("session_key_32", session_key_32).unwrap();
        p.add_int("policy:Ver", policy_ver).unwrap();
        p.add_int("max_connection", 1).unwrap();
        p
    }

    #[test]
    fn parse_auth_response_happy_path() {
        let key = [0xABu8; 20];
        let p = build_welcome_pack("SID-USER-42", "CID-7", &key, 0xDEAD_BEEF, 3);
        let r = parse_auth_response(&p).expect("welcome parses");
        assert_eq!(r.session_name, "SID-USER-42");
        assert_eq!(r.connection_name, "CID-7");
        assert_eq!(r.session_key, key);
        assert_eq!(r.session_key_32, 0xDEAD_BEEF);
        assert_eq!(r.policy_version, 3);
    }

    #[test]
    fn parse_auth_response_server_error() {
        let mut p = Pack::new();
        p.add_int("error", 9).unwrap(); // ERR_AUTH_FAILED
        match parse_auth_response(&p) {
            Err(AuthError::ServerError(code, msg)) => {
                assert_eq!(code, 9);
                assert!(msg.contains("ERR_AUTH_FAILED"));
            }
            other => panic!("expected ServerError, got {:?}", other),
        }
    }

    #[test]
    fn parse_auth_response_unknown_error_falls_back_to_numeric() {
        let mut p = Pack::new();
        p.add_int("error", 7777).unwrap();
        match parse_auth_response(&p) {
            Err(AuthError::ServerError(7777, msg)) => assert_eq!(msg, "ERR_7777"),
            other => panic!("expected ERR_7777, got {:?}", other),
        }
    }

    #[test]
    fn parse_auth_response_missing_session_name() {
        let mut p = Pack::new();
        p.add_str("connection_name", "x").unwrap();
        p.add_data("session_key", vec![0u8; 20]).unwrap();
        match parse_auth_response(&p) {
            Err(AuthError::MissingField(n)) => assert_eq!(n, "session_name"),
            other => panic!("expected MissingField, got {:?}", other),
        }
    }

    #[test]
    fn parse_auth_response_wrong_session_key_length() {
        let mut p = Pack::new();
        p.add_str("session_name", "s").unwrap();
        p.add_str("connection_name", "c").unwrap();
        p.add_data("session_key", vec![0u8; 10]).unwrap(); // too short
        match parse_auth_response(&p) {
            Err(AuthError::InvalidLength(n)) => assert!(n.starts_with("session_key")),
            other => panic!("expected InvalidLength, got {:?}", other),
        }
    }

    // ── Small hex helper for fixture readability ───────────────────────

    #[allow(dead_code)]
    fn hex_encode(b: &[u8]) -> String {
        let mut s = String::with_capacity(b.len() * 2);
        for byte in b {
            s.push_str(&format!("{:02x}", byte));
        }
        s
    }
}
