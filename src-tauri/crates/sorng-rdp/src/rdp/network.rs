use std::net::TcpStream;
use std::sync::Arc;
use std::time::Duration;

use crate::ironrdp_blocking::Framed;
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::pki_types::{CertificateDer, ServerName};
use rustls::{DigitallySignedStruct, SignatureScheme};

use super::{RdpTlsConfig, RdpTlsStream};

// ---- Network client for CredSSP HTTP requests ----

pub struct BlockingNetworkClient {
    client: Arc<reqwest::blocking::Client>,
}

impl BlockingNetworkClient {
    /// Create from a pre-built (cached) client.  Falls back to building a
    /// new one with aggressive timeouts if no cached client is supplied.
    pub fn new(cached: Option<Arc<reqwest::blocking::Client>>) -> Self {
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

impl crate::ironrdp::connector::sspi::network_client::NetworkClient for BlockingNetworkClient {
    fn send(
        &self,
        request: &crate::ironrdp::connector::sspi::generator::NetworkRequest,
    ) -> crate::ironrdp::connector::sspi::Result<Vec<u8>> {
        use crate::ironrdp::connector::sspi::network_client::NetworkProtocol;
        use std::net::ToSocketAddrs;

        let url = request.url.to_string();
        let data = request.data.clone();

        let response_bytes = match request.protocol {
            NetworkProtocol::Http | NetworkProtocol::Https => {
                let resp = self.client.post(&url).body(data).send().map_err(|e| {
                    crate::ironrdp::connector::sspi::Error::new(
                        crate::ironrdp::connector::sspi::ErrorKind::InternalError,
                        format!("HTTP request failed: {e}"),
                    )
                })?;
                resp.bytes()
                    .map_err(|e| {
                        crate::ironrdp::connector::sspi::Error::new(
                            crate::ironrdp::connector::sspi::ErrorKind::InternalError,
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
                            crate::ironrdp::connector::sspi::Error::new(
                                crate::ironrdp::connector::sspi::ErrorKind::NoCredentials,
                                format!("KDC address resolution failed: {e}"),
                            )
                        })?
                        .next()
                        .ok_or_else(|| {
                            crate::ironrdp::connector::sspi::Error::new(
                                crate::ironrdp::connector::sspi::ErrorKind::NoCredentials,
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
                            crate::ironrdp::connector::sspi::Error::new(
                                crate::ironrdp::connector::sspi::ErrorKind::NoCredentials,
                                format!("KDC write failed: {e}"),
                            )
                        })?;
                        let mut buf = vec![0u8; 65536];
                        let n = stream.read(&mut buf).map_err(|e| {
                            crate::ironrdp::connector::sspi::Error::new(
                                crate::ironrdp::connector::sspi::ErrorKind::NoCredentials,
                                format!("KDC read failed: {e}"),
                            )
                        })?;
                        buf.truncate(n);
                        buf
                    }
                    Err(e) => {
                        log::debug!("KDC connection failed (expected): {e}");
                        return Err(crate::ironrdp::connector::sspi::Error::new(
                            crate::ironrdp::connector::sspi::ErrorKind::NoCredentials,
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

#[derive(Debug)]
struct NoCertificateVerification;

impl ServerCertVerifier for NoCertificateVerification {
    fn verify_server_cert(
        &self,
        _end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: rustls::pki_types::UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        Ok(HandshakeSignatureValid::assertion())
    }

    fn verify_tls13_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        Ok(HandshakeSignatureValid::assertion())
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        vec![
            SignatureScheme::ECDSA_NISTP256_SHA256,
            SignatureScheme::ECDSA_NISTP384_SHA384,
            SignatureScheme::ED25519,
            SignatureScheme::RSA_PSS_SHA256,
            SignatureScheme::RSA_PSS_SHA384,
            SignatureScheme::RSA_PSS_SHA512,
            SignatureScheme::RSA_PKCS1_SHA256,
            SignatureScheme::RSA_PKCS1_SHA384,
            SignatureScheme::RSA_PKCS1_SHA512,
        ]
    }
}

pub fn build_tls_config(
    accept_invalid_certs: bool,
) -> Result<RdpTlsConfig, Box<dyn std::error::Error + Send + Sync>> {
    let mut config = if accept_invalid_certs {
        rustls::ClientConfig::builder()
            .dangerous()
            .with_custom_certificate_verifier(Arc::new(NoCertificateVerification))
            .with_no_client_auth()
    } else {
        let mut roots = rustls::RootCertStore::empty();
        let cert_result = rustls_native_certs::load_native_certs();
        for cert in cert_result.certs {
            roots.add(cert)?;
        }

        rustls::ClientConfig::builder()
            .with_root_certificates(roots)
            .with_no_client_auth()
    };

    // Disable TLS session resumption.  RDP servers perform a non-standard
    // TLS upgrade mid-protocol; when rustls tries to resume a cached session
    // on the 2nd connection to the same host the server replies with a fatal
    // InternalError alert during BasicSettingsExchange.
    config.resumption = rustls::client::Resumption::disabled();

    Ok(Arc::new(config))
}

#[allow(clippy::type_complexity)]
pub fn tls_upgrade(
    stream: TcpStream,
    server_name: &str,
    leftover: ::bytes::BytesMut,
    cached_connector: Option<RdpTlsConfig>,
) -> Result<(Framed<RdpTlsStream>, Vec<u8>), Box<dyn std::error::Error + Send + Sync>> {
    // Re-use the cached TLS config when available -- building one from
    // scratch loads the system certificate store which is very slow on Windows.
    let tls_config = match cached_connector {
        Some(config) => config,
        None => build_tls_config(true)?,
    };

    let server_name = ServerName::try_from(server_name.to_owned())
        .map_err(|_| format!("Invalid TLS server name: {server_name}"))?;
    let mut client = rustls::ClientConnection::new(tls_config, server_name)
        .map_err(|e| format!("TLS client creation failed: {e}"))?;
    let mut tcp_stream = stream;
    client
        .complete_io(&mut tcp_stream)
        .map_err(|e| format!("TLS handshake failed: {e}"))?;
    let tls_stream = rustls::StreamOwned::new(client, tcp_stream);

    let server_public_key = extract_server_public_key(&tls_stream)?;
    let framed = Framed::new_with_leftover(tls_stream, leftover);
    Ok((framed, server_public_key))
}

pub fn extract_server_public_key(
    tls_stream: &RdpTlsStream,
) -> Result<Vec<u8>, Box<dyn std::error::Error + Send + Sync>> {
    use x509_cert::der::Decode;

    let der = tls_stream
        .conn
        .peer_certificates()
        .and_then(|certs| certs.first())
        .map(|cert| cert.as_ref().to_vec())
        .ok_or("Peer certificate is missing")?;

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
pub fn extract_cert_fingerprint(tls_stream: &RdpTlsStream) -> Option<String> {
    use sha2::{Digest, Sha256};

    let der = tls_stream
        .conn
        .peer_certificates()
        .and_then(|certs| certs.first())
        .map(|cert| cert.as_ref().to_vec())?;
    let hash = Sha256::digest(&der);
    let hex: Vec<String> = hash.iter().map(|b| format!("{b:02x}")).collect();
    Some(hex.join(":"))
}

/// Full certificate details extracted from the server's TLS certificate.
#[derive(Clone, serde::Serialize)]
pub struct RdpCertDetails {
    pub fingerprint: String,
    pub subject: String,
    pub issuer: String,
    pub valid_from: String,
    pub valid_to: String,
    pub serial: String,
    pub signature_algorithm: String,
    pub san: Vec<String>,
    pub pem: String,
}

/// Extract full certificate details from the server's TLS certificate.
pub fn extract_cert_details(tls_stream: &RdpTlsStream) -> Option<RdpCertDetails> {
    use base64::Engine;
    use sha2::{Digest, Sha256};
    use x509_cert::der::Decode;

    let der = tls_stream
        .conn
        .peer_certificates()
        .and_then(|certs| certs.first())
        .map(|cert| cert.as_ref().to_vec())?;

    // Fingerprint
    let hash = Sha256::digest(&der);
    let fingerprint: String = hash.iter().map(|b| format!("{b:02x}")).collect::<Vec<_>>().join(":");

    // PEM encode
    let b64 = base64::engine::general_purpose::STANDARD.encode(&der);
    let pem = format!(
        "-----BEGIN CERTIFICATE-----\n{}\n-----END CERTIFICATE-----",
        b64.as_bytes()
            .chunks(64)
            .map(|c| std::str::from_utf8(c).unwrap_or(""))
            .collect::<Vec<_>>()
            .join("\n")
    );

    // Parse X.509
    let cert = match x509_cert::Certificate::from_der(&der) {
        Ok(c) => c,
        Err(e) => {
            log::warn!("Failed to parse X.509 certificate for details: {e}");
            // Return minimal info with just the fingerprint and PEM
            return Some(RdpCertDetails {
                fingerprint,
                subject: String::new(),
                issuer: String::new(),
                valid_from: String::new(),
                valid_to: String::new(),
                serial: String::new(),
                signature_algorithm: String::new(),
                san: Vec::new(),
                pem,
            });
        }
    };

    let tbs = &cert.tbs_certificate;

    // Subject and Issuer as RFC 4514 strings
    let subject = tbs.subject.to_string();
    let issuer = tbs.issuer.to_string();

    // Validity — convert GeneralizedTime / UTCTime to ISO 8601
    let valid_from = format_x509_time(&tbs.validity.not_before);
    let valid_to = format_x509_time(&tbs.validity.not_after);

    // Serial number as colon-separated hex
    let serial = tbs
        .serial_number
        .as_bytes()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<Vec<_>>()
        .join(":");

    // Signature algorithm OID
    let signature_algorithm = cert.signature_algorithm.oid.to_string();

    // Subject Alternative Names
    let san = extract_san(tbs);

    Some(RdpCertDetails {
        fingerprint,
        subject,
        issuer,
        valid_from,
        valid_to,
        serial,
        signature_algorithm,
        san,
        pem,
    })
}

/// Format an X.509 Time value to an ISO 8601 string.
fn format_x509_time(time: &x509_cert::time::Time) -> String {
    // x509_cert::time::Time implements Display as an RFC 3339 timestamp
    // which is exactly the ISO 8601 format we need.
    time.to_string()
}

/// Extract Subject Alternative Name entries from the certificate.
fn extract_san(tbs: &x509_cert::TbsCertificate) -> Vec<String> {
    use x509_cert::der::Decode;
    use x509_cert::ext::pkix::name::GeneralName;
    use x509_cert::ext::pkix::SubjectAltName;

    let extensions = match &tbs.extensions {
        Some(exts) => exts,
        None => return Vec::new(),
    };

    // SAN OID: 2.5.29.17
    let san_oid = x509_cert::der::oid::db::rfc5280::ID_CE_SUBJECT_ALT_NAME;

    for ext in extensions.iter() {
        if ext.extn_id == san_oid {
            if let Ok(san) = SubjectAltName::from_der(ext.extn_value.as_bytes()) {
                return san
                    .0
                    .iter()
                    .filter_map(|name| match name {
                        GeneralName::DnsName(dns) => Some(format!("DNS:{dns}")),
                        GeneralName::Rfc822Name(email) => Some(format!("email:{email}")),
                        GeneralName::UniformResourceIdentifier(uri) => Some(format!("URI:{uri}")),
                        GeneralName::IpAddress(oct) => {
                            let raw = oct.as_bytes();
                            if raw.len() == 4 {
                                Some(format!("IP:{}.{}.{}.{}", raw[0], raw[1], raw[2], raw[3]))
                            } else if raw.len() == 16 {
                                let parts: Vec<String> = raw.chunks(2)
                                    .map(|c| format!("{:02x}{:02x}", c[0], c.get(1).copied().unwrap_or(0)))
                                    .collect();
                                Some(format!("IP:{}", parts.join(":")))
                            } else {
                                Some(format!("IP:<{} bytes>", raw.len()))
                            }
                        }
                        GeneralName::DirectoryName(dn) => Some(format!("dirName:{dn}")),
                        _ => Some("other".to_string()),
                    })
                    .collect();
            }
        }
    }

    Vec::new()
}
