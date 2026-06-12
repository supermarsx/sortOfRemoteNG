//! SSH3 transport layer — QUIC (quinn) + HTTP/3 (h3) connection setup.
//!
//! This module owns everything that touches `quinn` / `rustls` / `h3` so that
//! a dependency bump only affects one file (plan §7, risk 2). It is built
//! natively on the workspace's existing quinn 0.11 / rustls 0.23 stack — the
//! same primitives `sorng-vpn`'s `proxy.rs::connect_quic_tunnel_static` uses
//! for real QUIC tunneling — rather than embedding the upstream Go `ssh3`
//! client.
//!
//! ## What e2 implemented (real, not stubbed)
//! [`Ssh3Transport::connect`] now performs a REAL dial:
//! 1. Build a client QUIC endpoint + rustls config (ALPN `h3`, verify on/off).
//! 2. DNS-resolve the host and `quinn::Endpoint::connect` it (TLS 1.3 over QUIC).
//! 3. Wrap the live `quinn::Connection` in an `h3_quinn::Connection` and build
//!    an HTTP/3 client with `h3::client::builder().enable_extended_connect(true)`.
//! 4. Spawn the h3 connection **driver** task (`driver.wait_idle()`) on a tokio
//!    task so reads/writes make progress without blocking the command thread.
//! 5. Hand the live [`h3::client::SendRequest`] back so [`super::auth`] can issue
//!    the authenticated SSH3 extended-CONNECT request.
//!
//! ## h3 0.0.8 API shape used (documented for e3/e4/e5/e6)
//! - `h3::client::builder().enable_extended_connect(true).build(conn).await`
//!   → `(Connection<C, Bytes>, SendRequest<O, Bytes>)`.
//! - The `Connection` is a **driver** — it must be polled (`wait_idle().await`)
//!   for the connection to make progress; we spawn it.
//! - `SendRequest::send_request(http::Request<()>).await` → `RequestStream`,
//!   then `RequestStream::recv_response().await` → `http::Response<()>`.
//!   (See [`super::auth`] for how the SSH3 CONNECT request maps onto this.)
//! - `SendRequest` is `Clone`, so e3/e4 can each open their own SSH3 stream
//!   (one request == one bidi stream) by cloning [`Ssh3Transport::send_request`].
//!
//! ## Seams for later executors
//! - `t23-e3`/`e4` open exec/shell streams by cloning [`Ssh3Transport::send_request`]
//!   and issuing further extended-CONNECT requests (or open raw bidi streams off
//!   [`Ssh3Transport::connection`] like `proxy.rs` does).
//! - `t23-e6` extends [`build_rustls_client_config`] for client-cert auth and
//!   the custom-CA path.

use std::net::{SocketAddr, ToSocketAddrs};
use std::sync::Arc;
use std::time::Duration;

use bytes::Bytes;

use super::Ssh3ConnectionConfig;

/// RFC 5705 TLS exporter label SSH3 uses to derive its conversation ID.
///
/// Must match upstream `ssh3` byte-for-byte (`EXPORTER-SSH3`), since the server
/// recomputes the same value from its TLS state to verify pubkey-JWT tokens are
/// bound to this connection. See [`Ssh3Transport::conversation_id`].
pub(crate) const EXPORTER_LABEL_SSH3: &[u8] = b"EXPORTER-SSH3";

/// Concrete h3 `SendRequest` type for our quinn-backed connection.
///
/// `h3_quinn::OpenStreams` is the `quic::OpenStreams` impl produced when the
/// h3 client is built over an `h3_quinn::Connection`. Exposed as a type alias so
/// e3/e4/e6 can name the handle without re-deriving the generic soup.
pub type Ssh3SendRequest = h3::client::SendRequest<h3_quinn::OpenStreams, Bytes>;

/// Dev-only server-certificate verifier that accepts any certificate.
///
/// **WARNING**: vulnerable to MITM. Only used when the user explicitly opts
/// out of verification via `Ssh3ConnectionConfig::verify_server_cert == false`
/// (self-signed / dev `ssh3` servers, e.g. the docker golden-path). Mirrors
/// `sorng-vpn`'s `proxy.rs::SkipServerVerification`. Ties into the pending t6
/// TLS-skip posture decision — must be surfaced honestly in the UI.
#[derive(Debug)]
pub(crate) struct SkipServerVerification(Arc<rustls::crypto::CryptoProvider>);

impl SkipServerVerification {
    pub(crate) fn new() -> Arc<Self> {
        Arc::new(Self(Arc::new(rustls::crypto::ring::default_provider())))
    }
}

impl rustls::client::danger::ServerCertVerifier for SkipServerVerification {
    fn verify_server_cert(
        &self,
        _end_entity: &rustls::pki_types::CertificateDer<'_>,
        _intermediates: &[rustls::pki_types::CertificateDer<'_>],
        _server_name: &rustls::pki_types::ServerName<'_>,
        _ocsp: &[u8],
        _now: rustls::pki_types::UnixTime,
    ) -> Result<rustls::client::danger::ServerCertVerified, rustls::Error> {
        Ok(rustls::client::danger::ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &rustls::pki_types::CertificateDer<'_>,
        dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls12_signature(
            message,
            cert,
            dss,
            &self.0.signature_verification_algorithms,
        )
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &rustls::pki_types::CertificateDer<'_>,
        dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls13_signature(
            message,
            cert,
            dss,
            &self.0.signature_verification_algorithms,
        )
    }

    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        self.0.signature_verification_algorithms.supported_schemes()
    }
}

/// Load a client-certificate chain + private key for mTLS.
///
/// SSH3 presents client certificates at the **TLS (mTLS) layer**, not via an
/// HTTP `Authorization` header (see `auth.rs`). The server then verifies the
/// presented chain during the QUIC/TLS handshake.
///
/// Two layouts are supported:
/// - **Single PEM bundle** (`key_path == None`): `cert_path` is a PEM file
///   containing the client certificate chain (one or more `CERTIFICATE` blocks)
///   AND the matching private key (`PRIVATE KEY` / `RSA PRIVATE KEY` /
///   `EC PRIVATE KEY`). This is the original t23-e7 behaviour.
/// - **Separate key file** (`key_path == Some`): the certificate chain is read
///   from `cert_path` and the private key from `key_path` (t26-fuA). The cert
///   file need not contain a key.
///
/// ## Secrets
/// Any buffer that holds private-key bytes is **zeroized** before this function
/// returns; the parsed `PrivateKeyDer` is moved into the rustls config and never
/// logged. Only the cert count and key presence are logged.
fn load_client_auth_material(
    cert_path: &str,
    key_path: Option<&str>,
) -> Result<
    (
        Vec<rustls::pki_types::CertificateDer<'static>>,
        rustls::pki_types::PrivateKeyDer<'static>,
    ),
    String,
> {
    use zeroize::Zeroize;

    let mut cert_pem = std::fs::read(cert_path)
        .map_err(|e| format!("SSH3: could not read client certificate {cert_path}: {e}"))?;

    // Parse the certificate chain from the cert file.
    let certs: Vec<rustls::pki_types::CertificateDer<'static>> =
        rustls_pemfile::certs(&mut cert_pem.as_slice())
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("SSH3: failed to parse client certificate PEM: {e}"))?;
    if certs.is_empty() {
        // The cert file may also have held a key (bundle layout); wipe it.
        cert_pem.zeroize();
        return Err(format!(
            "SSH3: no CERTIFICATE block found in client certificate {cert_path}"
        ));
    }

    // Choose where the private key comes from: a separate file, or the same
    // bundle as the cert chain.
    let key = if let Some(key_path) = key_path {
        // Separate key file: the cert PEM no longer needs to hold key material,
        // so wipe it now and read the key from its own (often more tightly
        // permissioned) file.
        cert_pem.zeroize();

        let mut key_pem = std::fs::read(key_path)
            .map_err(|e| format!("SSH3: could not read client private key {key_path}: {e}"))?;
        let key = rustls_pemfile::private_key(&mut key_pem.as_slice())
            .map_err(|e| {
                // The key never appears in the error; just the parse failure.
                format!("SSH3: failed to parse client private key from {key_path}: {e}")
            })?
            .ok_or_else(|| {
                format!("SSH3: no PRIVATE KEY block found in client key file {key_path}")
            });
        // Wipe the raw key PEM regardless of parse outcome.
        key_pem.zeroize();
        key?
    } else {
        // Single-bundle layout: parse the FIRST private key (PKCS#8 / PKCS#1 /
        // SEC1) from the SAME file as the cert chain.
        let key = rustls_pemfile::private_key(&mut cert_pem.as_slice())
            .map_err(|e| {
                format!("SSH3: failed to parse client private key from {cert_path}: {e}")
            })?
            .ok_or_else(|| {
                format!(
                    "SSH3: no PRIVATE KEY block found in client certificate bundle {cert_path} \
                     (mTLS needs the cert chain AND its private key in the same PEM file, \
                     or set client_key_path to a separate key file)"
                )
            });
        // Wipe the raw bundle PEM (it held the key material) now that it's parsed.
        cert_pem.zeroize();
        key?
    };

    log::debug!(
        "SSH3: loaded client cert chain ({} cert(s)) + private key for mTLS ({})",
        certs.len(),
        if key_path.is_some() {
            "separate key file"
        } else {
            "single PEM bundle"
        }
    );
    Ok((certs, key))
}

/// Build a rustls `ClientConfig` for the SSH3 QUIC connection.
///
/// - ALPN is set to `h3` (HTTP/3, what SSH3 runs over).
/// - When `config.verify_server_cert` is false, installs the dev
///   [`SkipServerVerification`] verifier (self-signed servers).
/// - Otherwise uses the platform native roots (plus an optional custom CA from
///   `config.ca_cert_path`).
/// - When `config.client_cert_path` is set, configures **mTLS client auth**:
///   the client cert chain + key are presented in the QUIC/TLS handshake
///   ([`load_client_auth_material`]). This is SSH3's certificate auth method.
///   When `config.client_key_path` is also set, the private key is loaded from
///   that separate file (t26-fuA); otherwise the cert+key are read as one PEM
///   bundle from `client_cert_path`.
///
/// t23-e7 wired the mTLS client-auth path (`with_client_auth_cert`); t26-fuA
/// added the optional separate `client_key_path`.
pub(crate) fn build_rustls_client_config(
    config: &Ssh3ConnectionConfig,
) -> Result<rustls::ClientConfig, String> {
    // Pin the `ring` crypto provider EXPLICITLY rather than relying on the
    // process-global default. The workspace mandates ring (using another
    // provider panics at handshake), and `ClientConfig::builder()` panics if no
    // process-level default is installed — which is exactly what happens when
    // this crate is unit-tested in isolation (no app bootstrap runs
    // `CryptoProvider::install_default`). `builder_with_provider` makes the
    // config self-contained and correct in both the app and tests.
    let provider = Arc::new(rustls::crypto::ring::default_provider());

    let builder = rustls::ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .map_err(|e| format!("SSH3: rustls protocol-version config error: {e}"))?;

    // Choose the server-cert verification posture (native roots vs. skip).
    let verified_builder = if config.verify_server_cert {
        let mut roots = rustls::RootCertStore::empty();
        let native = rustls_native_certs::load_native_certs();
        for cert in native.certs {
            // Ignore individual malformed certs; a fully empty store will
            // simply reject the handshake, which is the honest outcome.
            let _ = roots.add(cert);
        }
        // Optional custom CA: append it to the trust roots so a private CA can
        // be pinned without disabling verification entirely.
        if let Some(ca_path) = config.ca_cert_path.as_deref() {
            let ca_pem = std::fs::read(ca_path)
                .map_err(|e| format!("SSH3: could not read CA certificate {ca_path}: {e}"))?;
            let mut added = 0usize;
            for cert in rustls_pemfile::certs(&mut ca_pem.as_slice()) {
                let cert =
                    cert.map_err(|e| format!("SSH3: failed to parse CA certificate PEM: {e}"))?;
                roots
                    .add(cert)
                    .map_err(|e| format!("SSH3: failed to add custom CA: {e}"))?;
                added += 1;
            }
            log::debug!("SSH3: added {added} custom CA cert(s) from {ca_path}");
        }
        ClientAuthStage::Verified(builder.with_root_certificates(roots))
    } else {
        log::warn!(
            "SSH3: server certificate verification DISABLED for {} (dev/self-signed)",
            config.host
        );
        ClientAuthStage::SkipVerify(
            builder
                .dangerous()
                .with_custom_certificate_verifier(SkipServerVerification::new()),
        )
    };

    // Choose client-auth: present an mTLS client cert if configured, else none.
    let mut tls = if let Some(cert_path) = config.client_cert_path.as_deref() {
        let (chain, key) =
            load_client_auth_material(cert_path, config.client_key_path.as_deref())?;
        verified_builder
            .with_client_auth_cert(chain, key)
            .map_err(|e| format!("SSH3: failed to configure mTLS client certificate: {e}"))?
    } else {
        verified_builder.with_no_client_auth()
    };

    // SSH3 runs over HTTP/3, whose ALPN token is "h3".
    tls.alpn_protocols = vec![b"h3".to_vec()];
    Ok(tls)
}

/// Intermediate rustls builder state after the server-verification choice but
/// before the client-auth choice.
///
/// rustls's typestate builder makes the verified vs. skip-verify branches
/// produce different concrete types that nonetheless share the same
/// `with_client_auth_cert` / `with_no_client_auth` terminal methods. This enum
/// unifies them so the client-auth (mTLS) decision is written once rather than
/// duplicated across both verification branches.
enum ClientAuthStage {
    Verified(rustls::ConfigBuilder<rustls::ClientConfig, rustls::client::WantsClientCert>),
    SkipVerify(rustls::ConfigBuilder<rustls::ClientConfig, rustls::client::WantsClientCert>),
}

impl ClientAuthStage {
    fn with_client_auth_cert(
        self,
        chain: Vec<rustls::pki_types::CertificateDer<'static>>,
        key: rustls::pki_types::PrivateKeyDer<'static>,
    ) -> Result<rustls::ClientConfig, rustls::Error> {
        match self {
            ClientAuthStage::Verified(b) => b.with_client_auth_cert(chain, key),
            ClientAuthStage::SkipVerify(b) => b.with_client_auth_cert(chain, key),
        }
    }

    fn with_no_client_auth(self) -> rustls::ClientConfig {
        match self {
            ClientAuthStage::Verified(b) => b.with_no_client_auth(),
            ClientAuthStage::SkipVerify(b) => b.with_no_client_auth(),
        }
    }
}

/// Build a client-side QUIC endpoint configured for an SSH3 connection.
///
/// Real, testable e1 building block (mirrors proxy.rs). e2 calls
/// [`Ssh3Transport::connect`] which uses this plus the rustls config above to
/// dial the server and run the H3 handshake.
pub(crate) fn build_quic_endpoint(
    config: &Ssh3ConnectionConfig,
) -> Result<quinn::Endpoint, String> {
    let tls = build_rustls_client_config(config)?;
    let quic_crypto = quinn::crypto::rustls::QuicClientConfig::try_from(tls)
        .map_err(|e| format!("SSH3: QUIC crypto config error: {e}"))?;
    let client_config = quinn::ClientConfig::new(Arc::new(quic_crypto));

    let mut endpoint = quinn::Endpoint::client("0.0.0.0:0".parse().unwrap())
        .map_err(|e| format!("SSH3: failed to create QUIC endpoint: {e}"))?;
    endpoint.set_default_client_config(client_config);
    Ok(endpoint)
}

/// Resolve `host:port` to a single `SocketAddr`.
///
/// Mirrors `proxy.rs`: try a direct `SocketAddr` parse first (IP literal), then
/// fall back to a blocking DNS lookup (acceptable — happens once at setup, on a
/// tokio task spawned off the command thread).
pub(crate) fn resolve_server_addr(host: &str, port: u16) -> Result<SocketAddr, String> {
    let hostport = format!("{host}:{port}");
    if let Ok(addr) = hostport.parse::<SocketAddr>() {
        return Ok(addr);
    }
    hostport
        .to_socket_addrs()
        .map_err(|e| format!("SSH3: DNS resolution failed for {hostport}: {e}"))?
        .next()
        .ok_or_else(|| format!("SSH3: no addresses found for {hostport}"))
}

/// Live SSH3 transport handle stored on a connected session.
///
/// Holds the live `quinn::Connection`, the QUIC endpoint (kept alive for the
/// duration of the connection), the h3 `SendRequest` handle used to open SSH3
/// streams, and the join handle of the spawned h3 connection driver.
///
/// Kept out of `Ssh3Session`'s serde surface deliberately — it is a runtime
/// handle, not wire state.
///
/// e3/e4/e5 open SSH3 streams by cloning [`Ssh3Transport::send_request`] (each
/// `send_request` call is a fresh HTTP/3 request == a fresh bidi stream) or by
/// opening raw bidi streams off [`Ssh3Transport::connection`] (the `proxy.rs`
/// `connection.open_bi()` pattern) for port-forwarding.
pub struct Ssh3Transport {
    /// The live QUIC connection. Raw streams for forwarding open off this.
    pub connection: quinn::Connection,
    /// The QUIC endpoint kept alive for the duration of the connection.
    pub endpoint: quinn::Endpoint,
    /// h3 client request sender — clone this to open SSH3 request streams.
    pub send_request: Ssh3SendRequest,
    /// Join handle of the spawned h3 connection driver task. Aborted on close.
    driver: tokio::task::JoinHandle<()>,
}

impl Ssh3Transport {
    /// Dial the SSH3 server: QUIC connect + HTTP/3 handshake.
    ///
    /// Performs the REAL dial (e2). Auth (the SSH3 extended-CONNECT request
    /// carrying the `Authorization` header) is issued separately by
    /// [`super::auth::authenticate`] using the returned [`Self::send_request`]
    /// handle, so a caller can connect, then authenticate, then keep the
    /// transport for exec/shell/forward.
    pub async fn connect(config: &Ssh3ConnectionConfig) -> Result<Self, String> {
        if config.host.trim().is_empty() {
            return Err("SSH3: host is empty".to_string());
        }

        let endpoint = build_quic_endpoint(config)?;
        let server_addr = resolve_server_addr(&config.host, config.port)?;

        let connect_timeout = Duration::from_secs(config.connect_timeout.unwrap_or(30));

        // QUIC dial (TLS 1.3 handshake over QUIC). `connect` uses the host as
        // the TLS server name (SNI). Bounded by the configured connect timeout.
        let connecting = endpoint
            .connect(server_addr, &config.host)
            .map_err(|e| format!("SSH3: QUIC connect error: {e}"))?;

        let quic_connection = tokio::time::timeout(connect_timeout, connecting)
            .await
            .map_err(|_| {
                format!(
                    "SSH3: QUIC connection to {}:{} timed out after {}s",
                    config.host,
                    config.port,
                    connect_timeout.as_secs()
                )
            })?
            .map_err(|e| format!("SSH3: QUIC connection failed: {e}"))?;

        log::info!(
            "SSH3: QUIC connection established to {}:{}",
            config.host,
            config.port
        );

        // Build the HTTP/3 client over the live QUIC connection. SSH3 uses the
        // HTTP/3 extended-CONNECT protocol for its sessions, so we must enable
        // it on the client settings.
        let h3_conn = h3_quinn::Connection::new(quic_connection.clone());
        let (mut driver, send_request) = h3::client::builder()
            .enable_extended_connect(true)
            .build::<_, _, Bytes>(h3_conn)
            .await
            .map_err(|e| format!("SSH3: HTTP/3 handshake failed: {e}"))?;

        // The h3 `Connection` is a driver: it must be polled for the connection
        // to make progress (process control frames, settings, etc.). Spawn it on
        // a tokio task so it never blocks the Tauri command thread. When the
        // peer closes (or we drop the transport), `wait_idle` resolves and the
        // task ends.
        let driver = tokio::spawn(async move {
            let err = driver.wait_idle().await;
            log::debug!("SSH3: h3 connection driver ended: {err}");
        });

        Ok(Self {
            connection: quic_connection,
            endpoint,
            send_request,
            driver,
        })
    }

    /// Clone the h3 request sender to open a new SSH3 request stream.
    ///
    /// Each SSH3 conversation (auth, exec, shell) is a separate HTTP/3 request
    /// (== a separate QUIC bidi stream). e3/e4 call this to open theirs.
    pub fn request_sender(&self) -> Ssh3SendRequest {
        self.send_request.clone()
    }

    /// Derive the SSH3 **conversation ID** from this connection's TLS exporter.
    ///
    /// Upstream `ssh3` binds every conversation to the TLS session via RFC 5705
    /// keying-material export with the label `EXPORTER-SSH3` and an empty
    /// context, producing 32 bytes (`conversation.go::GenerateConversationID`:
    /// `tls.ExportKeyingMaterial("EXPORTER-SSH3", nil, 32)`). The pubkey-JWT
    /// auth method embeds `base64(convID)` as the JWT `jti` claim, and the
    /// server independently recomputes the same value from *its* side of the
    /// TLS session to verify the token is bound to *this* connection (anti-
    /// replay). quinn exposes the exporter as
    /// [`quinn::Connection::export_keying_material`], so we reproduce the exact
    /// derivation here.
    ///
    /// This is the minimal additive transport seam t23-e6 needs: pubkey auth is
    /// impossible without the live connection's exporter, and the exporter is
    /// owned by the QUIC layer (this module), not `auth`.
    pub fn conversation_id(&self) -> Result<[u8; 32], String> {
        let mut convid = [0u8; 32];
        self.connection
            .export_keying_material(&mut convid, EXPORTER_LABEL_SSH3, b"")
            .map_err(|e| format!("SSH3: could not derive conversation ID (TLS exporter): {e:?}"))?;
        Ok(convid)
    }

    /// Gracefully close the QUIC connection and drain the endpoint.
    pub async fn close(&self) {
        self.driver.abort();
        self.connection.close(0u32.into(), b"ssh3 disconnect");
        self.endpoint.wait_idle().await;
    }
}

impl Drop for Ssh3Transport {
    fn drop(&mut self) {
        // Ensure the driver task doesn't linger if the transport is dropped
        // without an explicit `close()` (e.g. session removed on error).
        self.driver.abort();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rustls_config_sets_h3_alpn_with_verify() {
        let mut config = Ssh3ConnectionConfig::default();
        config.verify_server_cert = true;
        let tls = build_rustls_client_config(&config).expect("config builds");
        assert_eq!(tls.alpn_protocols, vec![b"h3".to_vec()]);
    }

    #[test]
    fn rustls_config_skip_verify_builds() {
        let mut config = Ssh3ConnectionConfig::default();
        config.verify_server_cert = false;
        let tls = build_rustls_client_config(&config).expect("skip-verify config builds");
        assert_eq!(tls.alpn_protocols, vec![b"h3".to_vec()]);
    }

    #[tokio::test]
    async fn quic_endpoint_builds() {
        let config = Ssh3ConnectionConfig::default();
        // Building the endpoint binds a local UDP socket and registers with the
        // quinn runtime; this proves the quinn + rustls wiring resolves at
        // runtime, not just at compile time. `quinn::Endpoint::client` needs a
        // tokio runtime present, hence `#[tokio::test]`.
        let endpoint = build_quic_endpoint(&config);
        assert!(endpoint.is_ok(), "endpoint build failed: {:?}", endpoint.err());
    }

    /// Write a self-signed client cert + key PEM bundle to a temp file and
    /// return its path (plus the tempdir guard).
    fn write_client_cert_bundle() -> (tempfile::TempDir, std::path::PathBuf) {
        let cert = rcgen::generate_simple_self_signed(vec!["ssh3-client".to_string()])
            .expect("self-signed cert");
        let mut pem = cert.serialize_pem().expect("cert pem");
        pem.push('\n');
        pem.push_str(&cert.serialize_private_key_pem());
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("client.pem");
        std::fs::write(&path, pem.as_bytes()).unwrap();
        (dir, path)
    }

    /// Write a self-signed client cert and its private key to SEPARATE temp PEM
    /// files. Returns the tempdir guard plus the (cert_path, key_path) pair.
    fn write_client_cert_and_key_files() -> (tempfile::TempDir, std::path::PathBuf, std::path::PathBuf)
    {
        let cert = rcgen::generate_simple_self_signed(vec!["ssh3-client".to_string()])
            .expect("self-signed cert");
        let dir = tempfile::tempdir().unwrap();
        let cert_path = dir.path().join("client-cert.pem");
        let key_path = dir.path().join("client-key.pem");
        // Cert file: ONLY the certificate (no key) — the separate-key layout.
        std::fs::write(&cert_path, cert.serialize_pem().expect("cert pem").as_bytes()).unwrap();
        std::fs::write(&key_path, cert.serialize_private_key_pem().as_bytes()).unwrap();
        (dir, cert_path, key_path)
    }

    #[test]
    fn mtls_config_builds_from_separate_cert_and_key_files() {
        // t26-fuA: when client_key_path points at a SEPARATE key file (and the
        // cert file holds only the certificate chain), the rustls config still
        // builds with mTLS client auth presented.
        let (_dir, cert_path, key_path) = write_client_cert_and_key_files();
        let mut config = Ssh3ConnectionConfig::default();
        config.verify_server_cert = false; // independent of mTLS
        config.client_cert_path = Some(cert_path.to_string_lossy().into_owned());
        config.client_key_path = Some(key_path.to_string_lossy().into_owned());
        let tls = build_rustls_client_config(&config)
            .expect("mTLS client config builds from separate cert + key files");
        assert_eq!(tls.alpn_protocols, vec![b"h3".to_vec()]);
        // The config now carries a client-auth resolver (mTLS active).
        assert!(
            tls.client_auth_cert_resolver.has_certs(),
            "mTLS config from separate files must carry a client certificate"
        );
    }

    #[test]
    fn mtls_separate_key_errors_on_missing_key_file() {
        // When client_key_path is set but the key file is missing, fail cleanly
        // (and the error references the key path, not the cert).
        let (_dir, cert_path, _key_path) = write_client_cert_and_key_files();
        let mut config = Ssh3ConnectionConfig::default();
        config.client_cert_path = Some(cert_path.to_string_lossy().into_owned());
        config.client_key_path = Some("/no/such/client-key.pem".to_string());
        let err = build_rustls_client_config(&config).unwrap_err();
        assert!(
            err.contains("could not read client private key"),
            "got: {err}"
        );
    }

    #[test]
    fn mtls_config_builds_from_client_cert_bundle() {
        // t23-e7: when client_cert_path points at a PEM bundle with the cert
        // chain + key, the rustls config builds with mTLS client auth presented.
        let (_dir, path) = write_client_cert_bundle();
        let mut config = Ssh3ConnectionConfig::default();
        config.verify_server_cert = false; // independent of mTLS
        config.client_cert_path = Some(path.to_string_lossy().into_owned());
        let tls = build_rustls_client_config(&config)
            .expect("mTLS client config builds from cert+key bundle");
        assert_eq!(tls.alpn_protocols, vec![b"h3".to_vec()]);
        // The config now carries a client-auth resolver (mTLS active).
        assert!(
            tls.client_auth_cert_resolver.has_certs(),
            "mTLS config must carry a client certificate"
        );
    }

    #[test]
    fn mtls_config_builds_with_server_verification_on() {
        // mTLS must compose with normal server verification (the common case).
        let (_dir, path) = write_client_cert_bundle();
        let mut config = Ssh3ConnectionConfig::default();
        config.verify_server_cert = true;
        config.client_cert_path = Some(path.to_string_lossy().into_owned());
        let tls = build_rustls_client_config(&config).expect("mTLS + verify builds");
        assert!(tls.client_auth_cert_resolver.has_certs());
    }

    #[test]
    fn mtls_config_errors_on_missing_cert_file() {
        let mut config = Ssh3ConnectionConfig::default();
        config.client_cert_path = Some("/no/such/client.pem".to_string());
        let err = build_rustls_client_config(&config).unwrap_err();
        assert!(err.contains("could not read client certificate"), "got: {err}");
    }

    #[test]
    fn mtls_config_errors_on_bundle_without_key() {
        // A bundle with only a CERTIFICATE block (no private key) must fail
        // cleanly rather than silently configure a keyless mTLS.
        let cert = rcgen::generate_simple_self_signed(vec!["c".to_string()]).unwrap();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("cert-only.pem");
        std::fs::write(&path, cert.serialize_pem().unwrap().as_bytes()).unwrap();
        let mut config = Ssh3ConnectionConfig::default();
        config.client_cert_path = Some(path.to_string_lossy().into_owned());
        let err = build_rustls_client_config(&config).unwrap_err();
        assert!(err.contains("no PRIVATE KEY"), "got: {err}");
    }

    #[test]
    fn no_client_cert_means_no_client_auth() {
        // Without client_cert_path the config has no client-auth certs.
        let config = Ssh3ConnectionConfig::default();
        let tls = build_rustls_client_config(&config).expect("config builds");
        assert!(!tls.client_auth_cert_resolver.has_certs());
    }

    #[test]
    fn resolve_addr_parses_ip_literal() {
        let addr = resolve_server_addr("127.0.0.1", 443).expect("ip literal resolves");
        assert_eq!(addr.port(), 443);
        assert!(addr.ip().is_loopback());
    }

    #[test]
    fn resolve_addr_errors_on_garbage_host() {
        // A syntactically invalid host should fail DNS resolution, not panic.
        let r = resolve_server_addr("definitely not a host::::", 443);
        assert!(r.is_err());
    }

    #[tokio::test]
    async fn connect_rejects_empty_host() {
        let config = Ssh3ConnectionConfig::default(); // host == ""
        // `Ssh3Transport` isn't `Debug` (holds quinn handles), so match rather
        // than `unwrap_err`.
        match Ssh3Transport::connect(&config).await {
            Ok(_) => panic!("expected empty host to fail"),
            Err(err) => assert!(err.contains("host is empty"), "got: {err}"),
        }
    }

    #[tokio::test]
    async fn connect_fails_fast_against_dead_port() {
        // Real dial against a closed local UDP port. Proves the connect path is
        // wired end-to-end (endpoint -> resolve -> quinn connect) and surfaces a
        // real error/timeout rather than fabricating success. Use a short
        // timeout so the test stays fast.
        let mut config = Ssh3ConnectionConfig::default();
        config.host = "127.0.0.1".to_string();
        config.port = 1; // nothing listening
        config.verify_server_cert = false;
        config.connect_timeout = Some(2);
        assert!(
            Ssh3Transport::connect(&config).await.is_err(),
            "expected dial to a dead port to fail"
        );
    }
}
