use std::net::TcpStream;
use std::sync::Arc;
use std::time::Duration;

use ironrdp_blocking::Framed;

// ---- Network client for CredSSP HTTP requests ----

pub(crate) struct BlockingNetworkClient {
    client: Arc<reqwest::blocking::Client>,
}

impl BlockingNetworkClient {
    /// Create from a pre-built (cached) client.  Falls back to building a
    /// new one with aggressive timeouts if no cached client is supplied.
    pub(crate) fn new(cached: Option<Arc<reqwest::blocking::Client>>) -> Self {
        let client = cached.unwrap_or_else(|| {
            Arc::new(
                reqwest::blocking::Client::builder()
                    .danger_accept_invalid_certs(true)
                    .connect_timeout(Duration::from_secs(3))
                    .timeout(Duration::from_secs(5))
                    .build()
                    .unwrap_or_else(|_| reqwest::blocking::Client::new()),
            )
        });
        Self { client }
    }
}

impl ironrdp::connector::sspi::network_client::NetworkClient for BlockingNetworkClient {
    fn send(
        &self,
        request: &ironrdp::connector::sspi::generator::NetworkRequest,
    ) -> ironrdp::connector::sspi::Result<Vec<u8>> {
        use ironrdp::connector::sspi::network_client::NetworkProtocol;
        use std::net::ToSocketAddrs;

        let url = request.url.to_string();
        let data = request.data.clone();

        let response_bytes = match request.protocol {
            NetworkProtocol::Http | NetworkProtocol::Https => {
                let resp = self
                    .client
                    .post(&url)
                    .body(data)
                    .send()
                    .map_err(|e| {
                        ironrdp::connector::sspi::Error::new(
                            ironrdp::connector::sspi::ErrorKind::InternalError,
                            format!("HTTP request failed: {e}"),
                        )
                    })?;
                resp.bytes()
                    .map_err(|e| {
                        ironrdp::connector::sspi::Error::new(
                            ironrdp::connector::sspi::ErrorKind::InternalError,
                            format!("Failed to read response body: {e}"),
                        )
                    })?
                    .to_vec()
            }
            // Handle raw TCP/UDP Kerberos KDC requests with a short-
            // timeout TCP attempt so the Negotiate layer sees a quick
            // failure and falls back to NTLM instead of blocking for
            // minutes on unresolvable DNS SRV lookups.
            NetworkProtocol::Tcp | NetworkProtocol::Udp => {
                log::debug!(
                    "Kerberos KDC network request ({:?}) to {url} -- attempting fast connect",
                    request.protocol,
                );
                // Try a quick TCP connect (1s).  If the KDC is unreachable
                // this will fail almost instantly.
                let addr_str = url
                    .trim_start_matches("tcp://")
                    .trim_start_matches("udp://");
                let sock = TcpStream::connect_timeout(
                    &addr_str
                        .to_socket_addrs()
                        .map_err(|e| {
                            ironrdp::connector::sspi::Error::new(
                                ironrdp::connector::sspi::ErrorKind::NoCredentials,
                                format!("KDC address resolution failed: {e}"),
                            )
                        })?
                        .next()
                        .ok_or_else(|| {
                            ironrdp::connector::sspi::Error::new(
                                ironrdp::connector::sspi::ErrorKind::NoCredentials,
                                "KDC address resolved to nothing".to_string(),
                            )
                        })?,
                    Duration::from_secs(1),
                );
                match sock {
                    Ok(mut stream) => {
                        use std::io::{Read, Write};
                        let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
                        let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
                        stream.write_all(&data).map_err(|e| {
                            ironrdp::connector::sspi::Error::new(
                                ironrdp::connector::sspi::ErrorKind::NoCredentials,
                                format!("KDC write failed: {e}"),
                            )
                        })?;
                        let mut buf = vec![0u8; 65536];
                        let n = stream.read(&mut buf).map_err(|e| {
                            ironrdp::connector::sspi::Error::new(
                                ironrdp::connector::sspi::ErrorKind::NoCredentials,
                                format!("KDC read failed: {e}"),
                            )
                        })?;
                        buf.truncate(n);
                        buf
                    }
                    Err(e) => {
                        log::debug!("KDC connection failed (expected): {e}");
                        return Err(ironrdp::connector::sspi::Error::new(
                            ironrdp::connector::sspi::ErrorKind::NoCredentials,
                            format!("KDC unreachable: {e}"),
                        ));
                    }
                }
            }
        };

        Ok(response_bytes)
    }
}

// ---- TLS upgrade helper ----

pub(crate) fn tls_upgrade(
    stream: TcpStream,
    server_name: &str,
    leftover: ::bytes::BytesMut,
    cached_connector: Option<Arc<native_tls::TlsConnector>>,
) -> Result<(Framed<native_tls::TlsStream<TcpStream>>, Vec<u8>), Box<dyn std::error::Error + Send + Sync>>
{
    // Re-use the cached TLS connector when available -- building one from
    // scratch loads the system certificate store which is very slow on Windows.
    let owned_connector;
    let tls_connector: &native_tls::TlsConnector = match &cached_connector {
        Some(arc) => arc.as_ref(),
        None => {
            owned_connector = native_tls::TlsConnector::builder()
                .danger_accept_invalid_certs(true)
                .use_sni(false)
                .build()
                .map_err(|e| format!("TLS connector build error: {e}"))?;
            &owned_connector
        }
    };

    let tls_stream = tls_connector
        .connect(server_name, stream)
        .map_err(|e| format!("TLS handshake failed: {e}"))?;

    let server_public_key = extract_server_public_key(&tls_stream)?;
    let framed = Framed::new_with_leftover(tls_stream, leftover);
    Ok((framed, server_public_key))
}

pub(crate) fn extract_server_public_key(
    tls_stream: &native_tls::TlsStream<TcpStream>,
) -> Result<Vec<u8>, Box<dyn std::error::Error + Send + Sync>> {
    use x509_cert::der::Decode;

    let peer_cert = tls_stream
        .peer_certificate()
        .map_err(|e| format!("Failed to get peer certificate: {e}"))?
        .ok_or("Peer certificate is missing")?;

    let der = peer_cert
        .to_der()
        .map_err(|e| format!("Failed to convert certificate to DER: {e}"))?;

    let cert = x509_cert::Certificate::from_der(&der)
        .map_err(|e| format!("Failed to parse X.509 certificate: {e}"))?;

    let spki_bytes = cert
        .tbs_certificate
        .subject_public_key_info
        .subject_public_key
        .as_bytes()
        .ok_or("No public key bytes in certificate")?
        .to_vec();

    Ok(spki_bytes)
}

/// Extract SHA-256 fingerprint of the server's TLS certificate
pub(crate) fn extract_cert_fingerprint(
    tls_stream: &native_tls::TlsStream<TcpStream>,
) -> Option<String> {
    use sha2::{Sha256, Digest};

    let peer_cert = tls_stream.peer_certificate().ok()??;
    let der = peer_cert.to_der().ok()?;
    let hash = Sha256::digest(&der);
    let hex: Vec<String> = hash.iter().map(|b| format!("{b:02x}")).collect();
    Some(hex.join(":"))
}
