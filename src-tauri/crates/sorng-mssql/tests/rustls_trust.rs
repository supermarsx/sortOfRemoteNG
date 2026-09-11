//! Synthetic loopback TDS prelogin + real TLS. No SQL Server, user certificates,
//! credential stores, Docker, or external network are touched.
use rcgen::{BasicConstraints, Certificate, CertificateParams, IsCa};
use rustls::{pki_types::PrivatePkcs8KeyDer, ServerConfig, ServerConnection};
use sorng_mssql::mssql::{service::MssqlService, types::*};
use std::{io::Read, sync::Arc, time::Duration};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

// Exercise the exact production root-building function, without changing OS
// stores, environment variables or process-global root caches.
#[path = "../../../vendor/tiberius-rustls/src/client/tls_stream/rustls_roots.rs"]
mod roots;

async fn read_tds(stream: &mut TcpStream) -> std::io::Result<Vec<u8>> {
    let mut header = [0; 8];
    stream.read_exact(&mut header).await?;
    if header[0] != 0x12 {
        return Err(std::io::Error::other("expected TDS prelogin"));
    }
    let length = u16::from_be_bytes([header[2], header[3]]) as usize;
    if length < 8 {
        return Err(std::io::Error::other("invalid TDS length"));
    }
    let mut body = vec![0; length - 8];
    stream.read_exact(&mut body).await?;
    Ok(body)
}

async fn write_tds(stream: &mut TcpStream, bytes: &[u8]) -> std::io::Result<()> {
    let length = u16::try_from(bytes.len() + 8).unwrap().to_be_bytes();
    stream
        .write_all(&[0x12, 1, length[0], length[1], 0, 0, 0, 0])
        .await?;
    stream.write_all(bytes).await?;
    stream.flush().await
}

async fn server(mut stream: TcpStream, config: Arc<ServerConfig>) -> std::io::Result<bool> {
    let prelogin = read_tds(&mut stream).await?;
    let mut encryption = None;
    for option in prelogin.chunks_exact(5) {
        if option[0] == 0xff {
            break;
        }
        if option[0] == 1 {
            let offset = u16::from_be_bytes([option[1], option[2]]) as usize;
            encryption = prelogin.get(offset).copied();
            break;
        }
    }
    assert_eq!(
        encryption,
        Some(3),
        "normal connections must require encryption"
    );
    // One ENCRYPTION option, its terminator, and ENCRYPT_ON. The production
    // Tiberius decoder consumes this actual prelogin response.
    write_tds(&mut stream, &[1, 0, 6, 0, 1, 0xff, 1]).await?;
    let mut tls = ServerConnection::new(config).unwrap();
    while tls.is_handshaking() {
        let bytes = match read_tds(&mut stream).await {
            Ok(bytes) => bytes,
            Err(_) => return Ok(false),
        };
        tls.read_tls(&mut bytes.as_slice())?;
        if tls.process_new_packets().is_err() {
            return Ok(false);
        }
        while tls.wants_write() {
            let mut output = Vec::new();
            tls.write_tls(&mut output)?;
            write_tds(&mut stream, &output).await?;
        }
    }
    // After TLS completes TDS wraps the application data inside raw TLS records.
    let mut header = [0; 5];
    if stream.read_exact(&mut header).await.is_err() {
        return Ok(false);
    }
    let length = u16::from_be_bytes([header[3], header[4]]) as usize;
    let mut record = header.to_vec();
    record.resize(5 + length, 0);
    stream.read_exact(&mut record[5..]).await?;
    tls.read_tls(&mut record.as_slice())?;
    if tls.process_new_packets().is_err() {
        return Ok(false);
    }
    let mut login = [0; 4096];
    let read = tls.reader().read(&mut login)?;
    Ok(read >= 8 && login[0] == 0x10) // LOGIN7, only released after TLS validation.
}

#[derive(Clone, Copy)]
enum Trust {
    Platform,
    Issuer,
    OtherIssuer,
    ExplicitBypass,
    InvalidCa,
}

async fn probe(trust: Trust, certificate_host: &str) -> bool {
    // Full app builds enable both providers. A preinstalled different provider
    // must not cause our explicitly configured TLS client/server to panic.
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let process_provider = rustls::crypto::CryptoProvider::get_default()
        .unwrap()
        .clone();
    let mut ca_params = CertificateParams::new(vec!["fixture CA".into()]);
    ca_params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
    let ca = Certificate::from_params(ca_params).unwrap();
    let certificate =
        Certificate::from_params(CertificateParams::new(vec![certificate_host.into()])).unwrap();
    let server_config =
        ServerConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
            .with_protocol_versions(&[&rustls::version::TLS12])
            .unwrap()
            .with_no_client_auth()
            .with_single_cert(
                vec![certificate.serialize_der_with_signer(&ca).unwrap().into()],
                PrivatePkcs8KeyDer::from(certificate.serialize_private_key_der()).into(),
            )
            .unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let server = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        server(stream, Arc::new(server_config))
            .await
            .unwrap_or(false)
    });
    let directory = tempfile::tempdir().unwrap();
    let mut config =
        MssqlConnectionConfig::sql_auth("127.0.0.1", port, "synthetic-user", "synthetic-password");
    config.connection_timeout_secs = Some(3);
    config.tls = match trust {
        Trust::Platform => None,
        Trust::ExplicitBypass => Some(TlsConfig {
            trust_server_certificate: true,
            ca_cert_path: None,
        }),
        Trust::Issuer | Trust::OtherIssuer | Trust::InvalidCa => {
            let path = directory.path().join("ca.pem");
            let contents = if matches!(trust, Trust::InvalidCa) {
                "not a PEM certificate".to_string()
            } else if matches!(trust, Trust::Issuer) {
                ca.serialize_pem().unwrap()
            } else {
                let mut params = CertificateParams::new(vec!["unrelated CA".into()]);
                params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
                Certificate::from_params(params)
                    .unwrap()
                    .serialize_pem()
                    .unwrap()
            };
            std::fs::write(&path, contents).unwrap();
            Some(TlsConfig {
                trust_server_certificate: false,
                ca_cert_path: Some(path.to_string_lossy().into_owned()),
            })
        }
    };
    let mut service = MssqlService::new();
    // The fixture deliberately closes before the SQL login result. Even a
    // successful TLS handshake must not insert an authenticated SQL session.
    let error = service.connect(config).await.unwrap_err();
    if matches!(
        trust,
        Trust::Platform | Trust::OtherIssuer | Trust::InvalidCa
    ) || matches!(trust, Trust::Issuer) && certificate_host != "127.0.0.1"
    {
        assert!(
            matches!(error.kind, MssqlErrorKind::TlsError),
            "expected typed TLS refusal: {error}"
        );
    }
    assert!(service.list_sessions().is_empty());
    assert!(Arc::ptr_eq(
        &process_provider,
        rustls::crypto::CryptoProvider::get_default().unwrap()
    ));
    tokio::time::timeout(Duration::from_secs(4), server)
        .await
        .unwrap()
        .unwrap()
}

#[tokio::test]
async fn platform_roots_do_not_implicitly_trust_fixture_certificate() {
    assert!(!probe(Trust::Platform, "127.0.0.1").await);
}

#[tokio::test]
async fn configured_ca_and_matching_hostname_allow_encrypted_login_packet() {
    assert!(probe(Trust::Issuer, "127.0.0.1").await);
}

#[tokio::test]
async fn configured_ca_does_not_disable_hostname_verification() {
    assert!(!probe(Trust::Issuer, "different.invalid").await);
}

#[tokio::test]
async fn unrelated_ca_does_not_allow_login_packet() {
    assert!(!probe(Trust::OtherIssuer, "127.0.0.1").await);
}

#[tokio::test]
async fn certificate_bypass_remains_an_explicit_existing_option() {
    assert!(probe(Trust::ExplicitBypass, "different.invalid").await);
}

#[tokio::test]
async fn malformed_configured_ca_fails_before_login_packet() {
    assert!(!probe(Trust::InvalidCa, "127.0.0.1").await);
}

#[test]
fn unavailable_or_unusable_os_roots_return_an_error_without_bypassing_tls() {
    for native in [vec![], vec![vec![1, 2, 3].into()]] {
        let error = roots::root_store(native, None).unwrap_err();
        assert_eq!(error.kind(), std::io::ErrorKind::NotFound);
        assert!(error.to_string().contains("verification was not disabled"));
    }
}

#[test]
fn configured_ca_is_additive_and_can_recover_an_unavailable_os_store() {
    let ca = rcgen::generate_simple_self_signed(vec!["fixture CA".into()]).unwrap();
    let other = rcgen::generate_simple_self_signed(vec!["other CA".into()]).unwrap();
    let ca = ca.serialize_der().unwrap();
    let native = other.serialize_der().unwrap();
    assert_eq!(
        roots::root_store(vec![], Some(ca.clone().into()))
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        roots::root_store(vec![native.into()], Some(ca.into()))
            .unwrap()
            .len(),
        2
    );
}

#[test]
fn malformed_explicit_ca_is_not_ignored_even_when_os_roots_are_usable() {
    let ca = rcgen::generate_simple_self_signed(vec!["fixture CA".into()]).unwrap();
    let error = roots::root_store(
        vec![ca.serialize_der().unwrap().into()],
        Some(vec![1, 2, 3].into()),
    )
    .unwrap_err();
    assert_eq!(error.kind(), std::io::ErrorKind::InvalidData);
}
