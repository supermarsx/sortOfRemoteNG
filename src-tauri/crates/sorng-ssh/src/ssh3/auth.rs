//! SSH3 authentication — HTTP `Authorization` over HTTP/3.
//!
//! SSH3 performs auth in-band over the HTTP/3 layer: the client opens the SSH3
//! conversation with an HTTP/3 **extended-CONNECT** request to the server's
//! configured URL path, carrying an `Authorization` header. Unlike classic
//! SSH's binary auth packets, the credential is an HTTP auth mechanism over the
//! already-TLS-1.3-secured H3 stream. The server replies with an HTTP status
//! (2xx == authenticated, 401/403 == rejected).
//!
//! ## Auth matrix (all real as of t23-e6)
//! - **password** → HTTP Basic (`Basic base64(username:password)`), RFC 7617.
//! - **publickey** → a JWT signed by the user's private key, sent as
//!   `Bearer <jwt>` (RFC 6750 + RFC 7519). This is SSH3's pubkey method: the
//!   JWT claims (and notably the `jti` bound to the TLS-exporter conversation
//!   ID) match upstream `ssh3` byte-for-byte so a real server verifies it. See
//!   [`build_pubkey_jwt`].
//! - **bearer / OIDC / OAuth2** → a raw bearer token (acquired out of band by an
//!   OIDC/OAuth2 flow — Google/Microsoft/GitHub, etc.) sent verbatim as
//!   `Bearer <token>`. Decoupled from the OPKSSH dylib by design (we reuse the
//!   OIDC *concept* only). See [`build_bearer_auth_value`].
//! - **certificate** → SSH3 has no `Authorization`-header certificate scheme;
//!   client certificates are presented at the **TLS (mTLS) layer**, configured
//!   in [`super::transport`], not here. The [`Ssh3AuthMethod::Certificate`] arm
//!   therefore returns an honest "configure mTLS in transport" error rather than
//!   pretending to build a header.
//!
//! ## Secrets
//! Passwords, private keys, and bearer tokens are wrapped in
//! [`secrecy::SecretString`] / zeroized buffers and exposed only transiently.
//! NOTHING credential-bearing is ever logged — only the method label and, on
//! failure, the HTTP status. The signed JWT and the `Authorization` header value
//! are themselves sensitive and are never logged.
//!
//! ## PROTOCOL-FIDELITY: extended-CONNECT `:protocol` pseudo-header (t23-e7)
//! Upstream `ssh3` opens the conversation with an HTTP/3 **extended** CONNECT
//! that carries a `:protocol = ssh3` pseudo-header (the Go client sets
//! `req.Proto = "ssh3"`; quic-go's `request_writer` then emits `:protocol`).
//! This is **required** for real-server interop — see [`build_connect_request`]
//! and the detailed analysis there. Stock `h3` 0.0.8 cannot emit an arbitrary
//! `:protocol` token (its `ext::Protocol` is a closed enum), so t23-e7 carries a
//! minimal `[patch.crates-io]` fork of h3 (`vendor/h3-ssh3`) adding
//! `Protocol::from_static`. [`maybe_attach_ssh3_protocol`] now inserts the
//! `ssh3` protocol into the request extensions and h3 emits the extended
//! CONNECT. See `.orchestration/logs/t23-e7.md`.

use base64::Engine;
use http::Method;
use secrecy::{ExposeSecret, SecretString};

use super::transport::Ssh3SendRequest;
use super::{Ssh3AuthResult, Ssh3ConnectionConfig};

/// The SSH3 server URL path the conversation CONNECTs to.
///
/// Upstream `ssh3` has the server operator configure the URL path (there is no
/// universal default — the server's `URLPath` config option). `/ssh3-term` is
/// the value used in the project's examples/docs, so we use it as the default
/// when the config doesn't specify one.
pub const DEFAULT_SSH3_URL_PATH: &str = "/ssh3-term";

/// The SSH3 server URL path to use for `config` (upstream default for now).
fn ssh3_url_path(_config: &Ssh3ConnectionConfig) -> &'static str {
    DEFAULT_SSH3_URL_PATH
}

/// The auth method selected from a connection config.
///
/// One source of truth for "which method applies", shared by the dispatch in
/// [`build_authorization_header`] and the result labelling.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Ssh3AuthMethod {
    Password,
    PublicKey,
    Certificate,
    /// OIDC / OAuth2 / raw-JWT bearer token.
    BearerToken,
}

impl Ssh3AuthMethod {
    /// HTTP-auth scheme label reported back to the frontend in
    /// [`Ssh3AuthResult::method_used`].
    pub fn label(self) -> &'static str {
        match self {
            Ssh3AuthMethod::Password => "password",
            Ssh3AuthMethod::PublicKey => "publickey",
            Ssh3AuthMethod::Certificate => "certificate",
            Ssh3AuthMethod::BearerToken => "bearer",
        }
    }

    /// Parse an explicit `auth_method` override string (case-insensitive).
    ///
    /// Accepts the user-facing aliases (`oidc`/`oauth` map to bearer, `pubkey`
    /// to publickey, `cert` to certificate). Returns `None` for an unknown
    /// value so the caller can fall back to inference.
    fn from_override(s: &str) -> Option<Self> {
        match s.trim().to_ascii_lowercase().as_str() {
            "password" | "basic" => Some(Ssh3AuthMethod::Password),
            "publickey" | "pubkey" | "privkey" | "key" => Some(Ssh3AuthMethod::PublicKey),
            "certificate" | "cert" | "mtls" => Some(Ssh3AuthMethod::Certificate),
            "bearer" | "oidc" | "oauth" | "oauth2" | "jwt" | "token" => {
                Some(Ssh3AuthMethod::BearerToken)
            }
            _ => None,
        }
    }
}

/// Choose the auth method implied by the config (no network).
///
/// Honours an explicit [`Ssh3ConnectionConfig::auth_method`] override first; if
/// absent (or unrecognised), infers from which credential field is present in
/// this precedence: **pubkey > certificate > bearer > password**. Returns an
/// error when no credential is present at all.
pub fn select_method(config: &Ssh3ConnectionConfig) -> Result<Ssh3AuthMethod, String> {
    if let Some(forced) = config
        .auth_method
        .as_deref()
        .and_then(Ssh3AuthMethod::from_override)
    {
        return Ok(forced);
    }

    if config.private_key_path.is_some() {
        Ok(Ssh3AuthMethod::PublicKey)
    } else if config.client_cert_path.is_some() {
        Ok(Ssh3AuthMethod::Certificate)
    } else if config.bearer_token.is_some() {
        Ok(Ssh3AuthMethod::BearerToken)
    } else if config.password.is_some() {
        Ok(Ssh3AuthMethod::Password)
    } else {
        Err("No authentication method available".to_string())
    }
}

/// Build the HTTP `Authorization` header value for a password credential.
///
/// HTTP Basic: `Basic base64("username:password")`. The password is taken as a
/// [`SecretString`] and exposed only transiently here; the resulting header
/// string is itself sensitive and must NOT be logged.
pub fn build_basic_auth_value(username: &str, password: &SecretString) -> String {
    let raw = format!("{}:{}", username, password.expose_secret());
    let encoded = base64::engine::general_purpose::STANDARD.encode(raw.as_bytes());
    format!("Basic {encoded}")
}

/// Build the HTTP `Authorization` header value for a bearer (JWT/OIDC) token.
///
/// The caller passes the token as a [`SecretString`]; the value is exposed only
/// to assemble the header and the result is itself sensitive (never logged).
pub fn build_bearer_auth_value(token: &SecretString) -> String {
    format!("Bearer {}", token.expose_secret())
}

// ── pubkey-JWT auth (SSH3 "publickey" method) ──────────────────────────────

/// Build the SSH3 public-key auth header: a JWT signed by the user's private
/// key, returned as `Bearer <jwt>`.
///
/// This reproduces upstream `ssh3`'s `BuildJWTBearerToken` exactly so a real
/// server accepts it (`client_auth.go`):
///
/// ```text
/// claims = {
///   iss:       <username>,
///   iat:       now,
///   exp:       now + 10s,
///   sub:       "ssh3",
///   aud:       "unused",
///   client_id: "ssh3-<username>",
///   jti:       base64( conversation_id ),   // TLS-exporter-bound, anti-replay
/// }
/// ```
///
/// The signing algorithm is chosen from the key type, matching upstream:
/// **RSA → RS256** (RSASSA-PKCS1-v1.5 + SHA-256), **Ed25519 → EdDSA**. Encrypted
/// key files are decrypted with `passphrase` (the SSH3 `private_key_passphrase`
/// config field) before signing.
///
/// The private key material is held only for the duration of signing; the key
/// bytes read from disk are not logged.
pub fn build_pubkey_jwt(
    private_key_path: &str,
    passphrase: Option<&SecretString>,
    username: &str,
    conversation_id: &[u8; 32],
) -> Result<String, String> {
    use jsonwebtoken::{Algorithm, EncodingKey, Header};
    use ssh_key::private::{KeypairData, PrivateKey};

    let key_bytes = std::fs::read(private_key_path)
        .map_err(|e| format!("SSH3: could not read private key {private_key_path}: {e}"))?;

    // Parse the OpenSSH private key. If it is encrypted, decrypt with the
    // supplied passphrase (mirrors upstream's passphrase handling).
    let mut key = PrivateKey::from_openssh(&key_bytes)
        .map_err(|e| format!("SSH3: could not parse private key {private_key_path}: {e}"))?;
    if key.is_encrypted() {
        let pass = passphrase.ok_or_else(|| {
            "SSH3: private key is encrypted but no passphrase was provided".to_string()
        })?;
        key = key
            .decrypt(pass.expose_secret().as_bytes())
            .map_err(|_| "SSH3: failed to decrypt private key (wrong passphrase?)".to_string())?;
    }

    // Derive the JWT signing key + algorithm from the SSH key type, matching
    // upstream `util.JWTSigningMethodFromCryptoPubkey`.
    let (encoding_key, alg) = match key.key_data() {
        KeypairData::Rsa(rsa_keypair) => {
            // Reconstruct `rsa::RsaPrivateKey` from the SSH key components and
            // encode it as PKCS#8 PEM for jsonwebtoken.
            //
            // NOTE: we do NOT use ssh-key 0.6.7's `TryFrom<&RsaKeypair> for
            // rsa::RsaPrivateKey` — it has a bug (it passes the prime `p` twice
            // instead of `p` and `q`, yielding an invalid key that fails
            // `RsaPrivateKey::from_components`'s validation). We assemble the
            // components ourselves with the correct primes.
            use rsa::pkcs8::EncodePrivateKey;
            use rsa::BigUint;
            let n = BigUint::try_from(&rsa_keypair.public.n)
                .map_err(|e| format!("SSH3: invalid RSA modulus: {e}"))?;
            let e = BigUint::try_from(&rsa_keypair.public.e)
                .map_err(|e| format!("SSH3: invalid RSA exponent: {e}"))?;
            let d = BigUint::try_from(&rsa_keypair.private.d)
                .map_err(|e| format!("SSH3: invalid RSA private exponent: {e}"))?;
            let p = BigUint::try_from(&rsa_keypair.private.p)
                .map_err(|e| format!("SSH3: invalid RSA prime p: {e}"))?;
            let q = BigUint::try_from(&rsa_keypair.private.q)
                .map_err(|e| format!("SSH3: invalid RSA prime q: {e}"))?;
            let rsa_priv = rsa::RsaPrivateKey::from_components(n, e, d, vec![p, q])
                .map_err(|e| format!("SSH3: invalid RSA private key: {e}"))?;
            let pem = rsa_priv
                .to_pkcs8_pem(rsa::pkcs8::LineEnding::LF)
                .map_err(|e| format!("SSH3: could not encode RSA key as PKCS#8: {e}"))?;
            let ek = EncodingKey::from_rsa_pem(pem.as_bytes())
                .map_err(|e| format!("SSH3: jsonwebtoken rejected the RSA key: {e}"))?;
            (ek, Algorithm::RS256)
        }
        KeypairData::Ed25519(ed_keypair) => {
            // Build a PKCS#8 v1 DER for the 32-byte Ed25519 seed (fixed prefix
            // per RFC 8410) and hand it to jsonwebtoken's EdDSA path.
            let seed = ed_keypair.private.to_bytes();
            let der = ed25519_seed_to_pkcs8_der(&seed);
            let ek = EncodingKey::from_ed_der(&der);
            (ek, Algorithm::EdDSA)
        }
        other => {
            return Err(format!(
                "SSH3: unsupported key type for pubkey auth: {:?} (only RSA and Ed25519 are \
                 defined by the SSH3 JWT auth method)",
                other.algorithm()
            ));
        }
    };

    let now = chrono::Utc::now().timestamp();
    let convid_b64 = base64::engine::general_purpose::STANDARD.encode(conversation_id);

    // Claims must match upstream exactly (order is irrelevant for JSON).
    let claims = serde_json::json!({
        "iss": username,
        "iat": now,
        "exp": now + 10, // upstream uses a 10s window to limit replay
        "sub": "ssh3",
        "aud": "unused",
        "client_id": format!("ssh3-{username}"),
        "jti": convid_b64,
    });

    let token = jsonwebtoken::encode(&Header::new(alg), &claims, &encoding_key)
        .map_err(|e| format!("SSH3: could not sign pubkey JWT: {e}"))?;
    Ok(format!("Bearer {token}"))
}

/// Wrap a raw 32-byte Ed25519 seed in a PKCS#8 v1 DER document (RFC 8410).
///
/// The structure is fixed apart from the 32 seed bytes, so we can emit it with a
/// constant 16-byte prefix:
/// `SEQUENCE { INTEGER 0, SEQUENCE { OID 1.3.101.112 }, OCTET STRING { OCTET STRING(32) seed } }`.
fn ed25519_seed_to_pkcs8_der(seed: &[u8; 32]) -> Vec<u8> {
    // 0x30 0x2e                      SEQUENCE (46 bytes)
    //   0x02 0x01 0x00               INTEGER 0 (version)
    //   0x30 0x05 0x06 0x03 2b 65 70 SEQUENCE { OID 1.3.101.112 (Ed25519) }
    //   0x04 0x22                    OCTET STRING (34 bytes)
    //     0x04 0x20 <32 seed bytes>  OCTET STRING (32 bytes)
    const PREFIX: [u8; 16] = [
        0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04,
        0x20,
    ];
    let mut der = Vec::with_capacity(PREFIX.len() + seed.len());
    der.extend_from_slice(&PREFIX);
    der.extend_from_slice(seed);
    der
}

/// Build the `Authorization` header value for the selected method + config.
///
/// Returns the full header value (e.g. `"Basic …"` / `"Bearer …"`). The
/// `conversation_id` (TLS exporter) is required for the pubkey method's JWT and
/// is ignored by the others.
pub fn build_authorization_header(
    method: Ssh3AuthMethod,
    config: &Ssh3ConnectionConfig,
    conversation_id: &[u8; 32],
) -> Result<String, String> {
    match method {
        Ssh3AuthMethod::Password => {
            let password = config
                .password
                .as_ref()
                .ok_or("SSH3: password method selected but no password set")?;
            let secret = SecretString::new(password.clone());
            Ok(build_basic_auth_value(&config.username, &secret))
        }
        Ssh3AuthMethod::BearerToken => {
            let token = config
                .bearer_token
                .as_ref()
                .ok_or("SSH3: bearer/OIDC method selected but no bearer_token set")?;
            let secret = SecretString::new(token.clone());
            Ok(build_bearer_auth_value(&secret))
        }
        Ssh3AuthMethod::PublicKey => {
            let key_path = config
                .private_key_path
                .as_ref()
                .ok_or("SSH3: publickey method selected but no private_key_path set")?;
            let passphrase = config
                .private_key_passphrase
                .as_ref()
                .map(|p| SecretString::new(p.clone()));
            build_pubkey_jwt(
                key_path,
                passphrase.as_ref(),
                &config.username,
                conversation_id,
            )
        }
        Ssh3AuthMethod::Certificate => {
            // mTLS: the client certificate is presented at the TLS layer during
            // the QUIC handshake (see `transport::build_rustls_client_config` →
            // `with_client_auth_cert`), NOT via an `Authorization` header. By the
            // time we reach the conversation request the cert has already been
            // verified by the server's TLS stack, so the request carries NO
            // credential header. We require `client_cert_path` to be set (else
            // there is nothing to present) and return an empty header value; the
            // CONNECT request builder omits the `Authorization` header when the
            // value is empty.
            if config.client_cert_path.is_none() {
                return Err("SSH3: certificate auth selected but no client_cert_path set \
                    (mTLS needs the client cert + key PEM bundle)"
                    .to_string());
            }
            Ok(String::new())
        }
    }
}

/// Build the SSH3 CONNECT `http::Request` for the conversation.
///
/// SSH3 carries the username in a `?user=<username>` query parameter on the URL
/// (the server reads `r.URL.Query().Get("user")`) and the credential in the
/// `Authorization` header. The `:authority` is the configured host(:port).
///
/// ## PROTOCOL-FIDELITY (extended-CONNECT `:protocol = ssh3`)
/// Upstream `ssh3` opens this as an HTTP/3 **extended** CONNECT carrying a
/// `:protocol = ssh3` pseudo-header. On the Go stack the client sets
/// `req.Proto = "ssh3"` and `quic-go`'s `request_writer` emits `:protocol`. This
/// is **REQUIRED** for real-server interop, NOT cosmetic — verified against
/// `quic-go` v0.40.1 `http3/headers.go::requestFromHeaders`:
///
/// - For a **plain** CONNECT (`:protocol` absent) the server REQUIRES an *empty*
///   `:path` and rejects any request whose `:path` is non-empty
///   (`":path must be empty and :authority must not be empty"`).
/// - The SSH3 server routes on the **URL path** (`mux.HandleFunc(urlPath, …)`,
///   e.g. `/ssh3-term`) and reads `?user=` from the query. A plain CONNECT with
///   an empty path can therefore NEVER reach the SSH3 handler.
/// - Only an **extended** CONNECT (`:protocol` present) is allowed to carry a
///   non-empty `:scheme`/`:path`/`:authority`, which is exactly what SSH3 needs.
///
/// **Resolved (t23-e7):** stock `h3` 0.0.8 models `:protocol` as a CLOSED
/// `ext::Protocol` enum with no constructor for an arbitrary token. t23-e7
/// carries a minimal `[patch.crates-io]` fork (`vendor/h3-ssh3`) that adds
/// `Protocol::from_static(&'static str)`; [`maybe_attach_ssh3_protocol`] inserts
/// the `ssh3` protocol into the request extensions and h3 emits the extended
/// CONNECT (h3 reads the protocol from `request.extensions().get::<Protocol>()`).
/// So this is now a real extended CONNECT, not a plain one.
fn build_connect_request(
    config: &Ssh3ConnectionConfig,
    authorization: &str,
) -> Result<http::Request<()>, String> {
    let path = ssh3_url_path(config);
    // Authority for the :authority pseudo-header. Standard HTTPS port (443) is
    // omitted per URL conventions; otherwise include it.
    let authority = if config.port == 443 {
        config.host.clone()
    } else {
        format!("{}:{}", config.host, config.port)
    };
    // SSH3 reads the username from the `?user=` query param (client.go::Dial).
    let user = url_encode_query_component(&config.username);
    let uri = format!("https://{authority}{path}?user={user}");

    let mut builder = http::Request::builder()
        .method(Method::CONNECT)
        .uri(&uri)
        .header(http::header::HOST, &authority)
        .header("user-agent", "sortOfRemoteNG-ssh3");

    // mTLS (certificate auth) carries no `Authorization` header — the credential
    // is the client cert presented at the TLS layer. Only attach the header when
    // there is a credential value (password / bearer / pubkey-JWT).
    if !authorization.is_empty() {
        builder = builder.header(http::header::AUTHORIZATION, authorization);
    }

    let mut request = builder
        .body(())
        .map_err(|e| format!("SSH3: failed to build CONNECT request: {e}"))?;

    // PROTOCOL-FIDELITY: attach `:protocol = ssh3` when the h3 stack can emit
    // it. Today this is a no-op (documented blocker above); it is isolated in
    // one helper so enabling it is a single edit once h3 exposes the token.
    maybe_attach_ssh3_protocol(&mut request);

    Ok(request)
}

/// The SSH3 extended-CONNECT `:protocol` token. Must match upstream `ssh3`
/// byte-for-byte (the Go client sets `req.Proto = "ssh3"`).
pub(crate) const SSH3_PROTOCOL_TOKEN: &str = "ssh3";

/// Attach the SSH3 extended-CONNECT `:protocol = ssh3` pseudo-header to a
/// request.
///
/// See [`build_connect_request`]'s PROTOCOL-FIDELITY note. h3 reads the
/// extended-CONNECT protocol from `request.extensions().get::<Protocol>()` and
/// emits `:protocol = <protocol.as_str()>` for a CONNECT request
/// (`proto/headers.rs`). We insert a `Protocol` carrying the `"ssh3"` token via
/// the workspace's patched h3 (`Protocol::from_static`, the
/// SSH3-extended-CONNECT-enablement patch in `vendor/h3-ssh3`), turning the
/// plain CONNECT into the **extended** CONNECT real `ssh3` servers require to
/// route the conversation (a plain CONNECT must carry an empty `:path` and so
/// can never reach the server's path-routed handler).
///
/// t23-e7: the patched h3 now exposes the constructor, so this is no longer a
/// no-op — `:protocol = ssh3` actually rides the request.
///
/// `pub(crate)` so the exec/shell request builders in [`super::session`] attach
/// the same extended-CONNECT protocol (connect / exec / shell all need it).
pub(crate) fn maybe_attach_ssh3_protocol(request: &mut http::Request<()>) {
    request
        .extensions_mut()
        .insert(h3::ext::Protocol::from_static(SSH3_PROTOCOL_TOKEN));
}

/// Minimal percent-encoding for a URL query component (RFC 3986 unreserved set
/// passes through; everything else is `%XX`-escaped). Used for the `?user=`
/// parameter so usernames with spaces/specials don't corrupt the URI.
fn url_encode_query_component(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for &b in s.as_bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// Perform SSH3 authentication over the live H3 connection.
///
/// Issues the SSH3 CONNECT request carrying the `Authorization` header for the
/// selected method, awaits the response, and maps the HTTP status: `2xx` →
/// authenticated, `401/403` → auth failure, anything else → transport error.
///
/// `conversation_id` is the TLS-exporter-derived SSH3 conversation ID (from
/// [`super::transport::Ssh3Transport::conversation_id`]); the pubkey method
/// binds its JWT to it. `send_request` is a clone of the transport's h3 request
/// sender; this opens a dedicated request stream for the SSH3 conversation.
pub async fn authenticate(
    config: &Ssh3ConnectionConfig,
    send_request: &mut Ssh3SendRequest,
    conversation_id: &[u8; 32],
) -> Result<Ssh3AuthResult, String> {
    let method = select_method(config)?;
    log::debug!("SSH3: auth method selected: {}", method.label());

    let authorization = build_authorization_header(method, config, conversation_id)?;
    let request = build_connect_request(config, &authorization)?;

    // Open the SSH3 request stream (one HTTP/3 request == one QUIC bidi stream).
    let mut stream = send_request
        .send_request(request)
        .await
        .map_err(|e| format!("SSH3: failed to send auth request: {e}"))?;

    // We've sent headers; finish the request side so the server processes auth.
    // (The session body, if any, is driven later by e3/e4 over a fresh stream.)
    stream
        .finish()
        .await
        .map_err(|e| format!("SSH3: failed to finish auth request: {e}"))?;

    let response = stream
        .recv_response()
        .await
        .map_err(|e| format!("SSH3: failed to receive auth response: {e}"))?;

    let status = response.status();
    map_auth_status(method, status)
}

/// Map an HTTP response status to an [`Ssh3AuthResult`].
///
/// Pure + unit-testable. `2xx` is success; `401`/`403` are auth rejections;
/// everything else is surfaced as a transport-level error.
pub fn map_auth_status(
    method: Ssh3AuthMethod,
    status: http::StatusCode,
) -> Result<Ssh3AuthResult, String> {
    if status.is_success() {
        log::info!(
            "SSH3: authenticated via {} (HTTP {})",
            method.label(),
            status.as_u16()
        );
        Ok(Ssh3AuthResult {
            success: true,
            method_used: method.label().to_string(),
            message: Some(format!("Authenticated (HTTP {})", status.as_u16())),
        })
    } else if status == http::StatusCode::UNAUTHORIZED || status == http::StatusCode::FORBIDDEN {
        // Auth rejected by the server. Do not log credentials — only the status.
        Err(format!(
            "SSH3: authentication failed ({}): HTTP {}",
            method.label(),
            status.as_u16()
        ))
    } else {
        Err(format!(
            "SSH3: unexpected response to auth request: HTTP {}",
            status.as_u16()
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ZERO_CONVID: [u8; 32] = [0u8; 32];

    // ── method selection ───────────────────────────────────────────────────

    #[test]
    fn select_method_prefers_pubkey() {
        let mut c = Ssh3ConnectionConfig::default();
        c.private_key_path = Some("/k".into());
        c.password = Some("p".into());
        assert_eq!(select_method(&c).unwrap(), Ssh3AuthMethod::PublicKey);
    }

    #[test]
    fn select_method_falls_back_to_password() {
        let mut c = Ssh3ConnectionConfig::default();
        c.password = Some("p".into());
        assert_eq!(select_method(&c).unwrap(), Ssh3AuthMethod::Password);
    }

    #[test]
    fn select_method_picks_bearer_when_token_present() {
        let mut c = Ssh3ConnectionConfig::default();
        c.bearer_token = Some("tok".into());
        assert_eq!(select_method(&c).unwrap(), Ssh3AuthMethod::BearerToken);
    }

    #[test]
    fn select_method_bearer_beats_password() {
        let mut c = Ssh3ConnectionConfig::default();
        c.bearer_token = Some("tok".into());
        c.password = Some("p".into());
        assert_eq!(select_method(&c).unwrap(), Ssh3AuthMethod::BearerToken);
    }

    #[test]
    fn select_method_honours_explicit_override() {
        let mut c = Ssh3ConnectionConfig::default();
        // Both a key and a password are present, but the override forces password.
        c.private_key_path = Some("/k".into());
        c.password = Some("p".into());
        c.auth_method = Some("password".into());
        assert_eq!(select_method(&c).unwrap(), Ssh3AuthMethod::Password);
    }

    #[test]
    fn select_method_override_oidc_alias_maps_to_bearer() {
        let mut c = Ssh3ConnectionConfig::default();
        c.bearer_token = Some("tok".into());
        c.auth_method = Some("OIDC".into());
        assert_eq!(select_method(&c).unwrap(), Ssh3AuthMethod::BearerToken);
    }

    #[test]
    fn select_method_unknown_override_falls_back_to_inference() {
        let mut c = Ssh3ConnectionConfig::default();
        c.password = Some("p".into());
        c.auth_method = Some("not-a-method".into());
        assert_eq!(select_method(&c).unwrap(), Ssh3AuthMethod::Password);
    }

    #[test]
    fn select_method_errors_with_no_credential() {
        let c = Ssh3ConnectionConfig::default();
        assert!(select_method(&c).is_err());
    }

    // ── header construction ────────────────────────────────────────────────

    #[test]
    fn basic_auth_value_is_correct_base64() {
        let secret = SecretString::new("pass".to_string());
        let v = build_basic_auth_value("user", &secret);
        // base64("user:pass") == "dXNlcjpwYXNz"
        assert_eq!(v, "Basic dXNlcjpwYXNz");
    }

    #[test]
    fn bearer_auth_value_format() {
        let secret = SecretString::new("abc.def.ghi".to_string());
        assert_eq!(build_bearer_auth_value(&secret), "Bearer abc.def.ghi");
    }

    #[test]
    fn build_authorization_header_password() {
        let mut c = Ssh3ConnectionConfig::default();
        c.username = "user".into();
        c.password = Some("pass".into());
        let h = build_authorization_header(Ssh3AuthMethod::Password, &c, &ZERO_CONVID).unwrap();
        assert_eq!(h, "Basic dXNlcjpwYXNz");
    }

    #[test]
    fn build_authorization_header_password_missing_errors() {
        let c = Ssh3ConnectionConfig::default();
        assert!(build_authorization_header(Ssh3AuthMethod::Password, &c, &ZERO_CONVID).is_err());
    }

    #[test]
    fn build_authorization_header_bearer() {
        let mut c = Ssh3ConnectionConfig::default();
        c.bearer_token = Some("my.jwt.token".into());
        let h = build_authorization_header(Ssh3AuthMethod::BearerToken, &c, &ZERO_CONVID).unwrap();
        assert_eq!(h, "Bearer my.jwt.token");
    }

    #[test]
    fn build_authorization_header_bearer_missing_errors() {
        let c = Ssh3ConnectionConfig::default();
        let err =
            build_authorization_header(Ssh3AuthMethod::BearerToken, &c, &ZERO_CONVID).unwrap_err();
        assert!(err.contains("no bearer_token set"), "got: {err}");
    }

    #[test]
    fn build_authorization_header_pubkey_missing_key_errors() {
        let c = Ssh3ConnectionConfig::default();
        let err =
            build_authorization_header(Ssh3AuthMethod::PublicKey, &c, &ZERO_CONVID).unwrap_err();
        assert!(err.contains("no private_key_path set"), "got: {err}");
    }

    #[test]
    fn build_authorization_header_certificate_without_cert_errors() {
        // Cert auth selected but no client_cert_path → nothing to present.
        let c = Ssh3ConnectionConfig::default();
        let err =
            build_authorization_header(Ssh3AuthMethod::Certificate, &c, &ZERO_CONVID).unwrap_err();
        assert!(err.contains("client_cert_path"), "got: {err}");
    }

    #[test]
    fn build_authorization_header_certificate_yields_no_header_value() {
        // t23-e7: with a client cert configured, cert auth produces NO
        // Authorization header — the credential rides the TLS (mTLS) layer.
        let mut c = Ssh3ConnectionConfig::default();
        c.client_cert_path = Some("/path/to/client.pem".into());
        let v = build_authorization_header(Ssh3AuthMethod::Certificate, &c, &ZERO_CONVID).unwrap();
        assert!(v.is_empty(), "cert auth must not build an Authorization header");
    }

    #[test]
    fn connect_request_omits_authorization_for_mtls() {
        // An empty authorization (mTLS) must NOT add an Authorization header.
        let mut c = Ssh3ConnectionConfig::default();
        c.host = "example.com".into();
        c.port = 443;
        let req = build_connect_request(&c, "").expect("request builds");
        assert!(req.headers().get(http::header::AUTHORIZATION).is_none());
        // …but it still carries the extended-CONNECT protocol so the server routes it.
        assert_eq!(
            req.extensions().get::<h3::ext::Protocol>().map(|p| p.as_str()),
            Some("ssh3")
        );
    }

    // ── pubkey JWT (real signing, no server) ───────────────────────────────

    /// Generate a temp Ed25519 OpenSSH key file and return its path + tempdir.
    fn write_temp_ed25519_key() -> (tempfile::TempDir, std::path::PathBuf) {
        use ssh_key::private::PrivateKey;
        use ssh_key::rand_core::OsRng;
        let key = PrivateKey::random(&mut OsRng, ssh_key::Algorithm::Ed25519).unwrap();
        let pem = key.to_openssh(ssh_key::LineEnding::LF).unwrap();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("id_ed25519");
        std::fs::write(&path, pem.as_bytes()).unwrap();
        (dir, path)
    }

    fn write_temp_rsa_key() -> (tempfile::TempDir, std::path::PathBuf) {
        use ssh_key::private::{PrivateKey, RsaKeypair};
        use ssh_key::rand_core::OsRng;
        // 2048-bit RSA so the test stays reasonably fast but is a real key.
        let keypair = RsaKeypair::random(&mut OsRng, 2048).unwrap();
        let key = PrivateKey::from(keypair);
        let pem = key.to_openssh(ssh_key::LineEnding::LF).unwrap();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("id_rsa");
        std::fs::write(&path, pem.as_bytes()).unwrap();
        (dir, path)
    }

    /// Split a `Bearer <jwt>` value and base64url-decode the JWT payload to JSON.
    fn decode_jwt_claims(header_value: &str) -> serde_json::Value {
        let token = header_value.strip_prefix("Bearer ").expect("Bearer prefix");
        let parts: Vec<&str> = token.split('.').collect();
        assert_eq!(parts.len(), 3, "JWT must have 3 parts");
        let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .decode(parts[1])
            .expect("payload base64url");
        serde_json::from_slice(&payload).expect("payload JSON")
    }

    fn decode_jwt_header(header_value: &str) -> serde_json::Value {
        let token = header_value.strip_prefix("Bearer ").expect("Bearer prefix");
        let parts: Vec<&str> = token.split('.').collect();
        let head = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .decode(parts[0])
            .expect("header base64url");
        serde_json::from_slice(&head).expect("header JSON")
    }

    #[test]
    fn pubkey_jwt_ed25519_has_upstream_claims_and_alg() {
        let (_dir, path) = write_temp_ed25519_key();
        let convid = [7u8; 32];
        let header =
            build_pubkey_jwt(path.to_str().unwrap(), None, "alice", &convid).expect("jwt builds");

        let head = decode_jwt_header(&header);
        assert_eq!(head["alg"], "EdDSA");

        let claims = decode_jwt_claims(&header);
        // Exact match to upstream ssh3 BuildJWTBearerToken.
        assert_eq!(claims["iss"], "alice");
        assert_eq!(claims["sub"], "ssh3");
        assert_eq!(claims["aud"], "unused");
        assert_eq!(claims["client_id"], "ssh3-alice");
        let expected_jti = base64::engine::general_purpose::STANDARD.encode(convid);
        assert_eq!(claims["jti"], expected_jti);
        // exp == iat + 10 (the 10s replay window).
        let iat = claims["iat"].as_i64().unwrap();
        let exp = claims["exp"].as_i64().unwrap();
        assert_eq!(exp - iat, 10);
    }

    #[test]
    fn pubkey_jwt_rsa_uses_rs256() {
        let (_dir, path) = write_temp_rsa_key();
        let convid = [0u8; 32];
        let header =
            build_pubkey_jwt(path.to_str().unwrap(), None, "bob", &convid).expect("jwt builds");
        let head = decode_jwt_header(&header);
        assert_eq!(head["alg"], "RS256");
        let claims = decode_jwt_claims(&header);
        assert_eq!(claims["client_id"], "ssh3-bob");
    }

    #[test]
    fn pubkey_jwt_jti_is_bound_to_conversation_id() {
        // Two different conversation IDs must produce different jti claims —
        // proving the token is bound to the TLS session (anti-replay).
        let (_dir, path) = write_temp_ed25519_key();
        let p = path.to_str().unwrap();
        let h1 = build_pubkey_jwt(p, None, "u", &[1u8; 32]).unwrap();
        let h2 = build_pubkey_jwt(p, None, "u", &[2u8; 32]).unwrap();
        let j1 = decode_jwt_claims(&h1)["jti"].clone();
        let j2 = decode_jwt_claims(&h2)["jti"].clone();
        assert_ne!(j1, j2);
    }

    #[test]
    fn pubkey_jwt_signature_verifies_with_public_key() {
        // Sign with the private key, then verify the JWT signature against the
        // matching public key — proves we emitted a real, verifiable signature
        // (what a real ssh3 server would check), not a malformed token.
        use ssh_key::private::PrivateKey;
        let (_dir, path) = write_temp_ed25519_key();
        let key_bytes = std::fs::read(&path).unwrap();
        let key = PrivateKey::from_openssh(&key_bytes).unwrap();
        let header = build_pubkey_jwt(path.to_str().unwrap(), None, "u", &[3u8; 32]).unwrap();
        let token = header.strip_prefix("Bearer ").unwrap();

        // Build a jsonwebtoken DecodingKey from the Ed25519 public key (raw 32B).
        let ed_pub = match key.key_data() {
            ssh_key::private::KeypairData::Ed25519(kp) => kp.public.0,
            _ => panic!("expected ed25519"),
        };
        let dk = jsonwebtoken::DecodingKey::from_ed_der(&ed_pub);
        let mut validation = jsonwebtoken::Validation::new(jsonwebtoken::Algorithm::EdDSA);
        // We only care that the signature + exp validate; aud is the literal
        // "unused" upstream uses, so disable aud checking.
        validation.validate_aud = false;
        let decoded =
            jsonwebtoken::decode::<serde_json::Value>(token, &dk, &validation).expect("verifies");
        assert_eq!(decoded.claims["sub"], "ssh3");
    }

    #[test]
    fn pubkey_jwt_missing_file_errors() {
        let err = build_pubkey_jwt("/no/such/key", None, "u", &ZERO_CONVID).unwrap_err();
        assert!(err.contains("could not read private key"), "got: {err}");
    }

    #[test]
    fn ed25519_pkcs8_der_has_correct_shape() {
        let seed = [9u8; 32];
        let der = ed25519_seed_to_pkcs8_der(&seed);
        assert_eq!(der.len(), 48); // 16-byte prefix + 32-byte seed
        assert_eq!(&der[..2], &[0x30, 0x2e]); // SEQUENCE, len 46
        assert_eq!(&der[16..], &seed); // seed appended verbatim
    }

    // ── CONNECT request construction ───────────────────────────────────────

    #[test]
    fn connect_request_targets_url_path_and_authority() {
        let mut c = Ssh3ConnectionConfig::default();
        c.host = "example.com".into();
        c.port = 443;
        c.username = "alice".into();
        let req = build_connect_request(&c, "Basic xxx").expect("request builds");
        assert_eq!(req.method(), Method::CONNECT);
        assert_eq!(req.uri().path(), DEFAULT_SSH3_URL_PATH);
        assert_eq!(req.uri().host(), Some("example.com"));
        // Username rides the ?user= query param (server reads it from there).
        assert_eq!(req.uri().query(), Some("user=alice"));
        assert!(req.headers().get(http::header::AUTHORIZATION).is_some());
    }

    #[test]
    fn connect_request_includes_nonstandard_port_in_authority() {
        let mut c = Ssh3ConnectionConfig::default();
        c.host = "example.com".into();
        c.port = 8443;
        let req = build_connect_request(&c, "Basic xxx").expect("request builds");
        assert_eq!(
            req.uri().authority().map(|a| a.as_str()),
            Some("example.com:8443")
        );
    }

    #[test]
    fn connect_request_percent_encodes_username() {
        let mut c = Ssh3ConnectionConfig::default();
        c.host = "h".into();
        c.port = 443;
        c.username = "a b@c".into();
        let req = build_connect_request(&c, "Basic xxx").expect("request builds");
        assert_eq!(req.uri().query(), Some("user=a%20b%40c"));
    }

    #[test]
    fn connect_request_attaches_ssh3_extended_connect_protocol() {
        // t23-e7: the request must carry the `:protocol = ssh3` extended-CONNECT
        // pseudo-header (via the patched h3 `Protocol` in the request
        // extensions). This is what makes a real `ssh3` server route the
        // conversation — a plain CONNECT can never reach the path-routed handler.
        let mut c = Ssh3ConnectionConfig::default();
        c.host = "example.com".into();
        c.port = 443;
        let req = build_connect_request(&c, "Basic xxx").expect("request builds");
        let proto = req
            .extensions()
            .get::<h3::ext::Protocol>()
            .expect(":protocol extension must be attached");
        assert_eq!(proto.as_str(), "ssh3");
        assert_eq!(proto.as_str(), SSH3_PROTOCOL_TOKEN);
    }

    #[test]
    fn maybe_attach_ssh3_protocol_inserts_token() {
        // Direct test of the seam in isolation.
        let mut req = http::Request::builder()
            .method(Method::CONNECT)
            .uri("https://h/ssh3-term")
            .body(())
            .unwrap();
        assert!(req.extensions().get::<h3::ext::Protocol>().is_none());
        maybe_attach_ssh3_protocol(&mut req);
        assert_eq!(
            req.extensions()
                .get::<h3::ext::Protocol>()
                .map(|p| p.as_str()),
            Some("ssh3")
        );
    }

    // ── status mapping ─────────────────────────────────────────────────────

    #[test]
    fn map_status_success() {
        let r = map_auth_status(Ssh3AuthMethod::Password, http::StatusCode::OK).unwrap();
        assert!(r.success);
        assert_eq!(r.method_used, "password");
    }

    #[test]
    fn map_status_pubkey_label() {
        let r = map_auth_status(Ssh3AuthMethod::PublicKey, http::StatusCode::OK).unwrap();
        assert_eq!(r.method_used, "publickey");
    }

    #[test]
    fn map_status_401_is_auth_failure() {
        let err = map_auth_status(Ssh3AuthMethod::PublicKey, http::StatusCode::UNAUTHORIZED)
            .unwrap_err();
        assert!(err.contains("authentication failed"));
        assert!(err.contains("publickey"));
        assert!(err.contains("401"));
    }

    #[test]
    fn map_status_500_is_transport_error() {
        let err = map_auth_status(
            Ssh3AuthMethod::Password,
            http::StatusCode::INTERNAL_SERVER_ERROR,
        )
        .unwrap_err();
        assert!(err.contains("unexpected response"));
    }
}
