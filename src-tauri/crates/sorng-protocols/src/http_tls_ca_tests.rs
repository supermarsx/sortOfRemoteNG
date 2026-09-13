//! Signed synthetic TLS fixtures only. No public host, user certificate or OS
//! trust-store mutation. The production root-loader is replaced only in Rust.
use super::*;
use rcgen::{BasicConstraints, Certificate, CertificateParams, IsCa};
use rustls::pki_types::{PrivateKeyDer, PrivatePkcs8KeyDer};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

struct Leaf {
    der: CertificateDer<'static>,
    key: Vec<u8>,
}

fn root() -> (Certificate, rustls::RootCertStore) {
    let mut params = CertificateParams::new(vec![]);
    params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
    let root = Certificate::from_params(params).unwrap();
    let mut roots = rustls::RootCertStore::empty();
    roots
        .add(CertificateDer::from(root.serialize_der().unwrap()))
        .unwrap();
    (root, roots)
}

fn leaf(root: &Certificate, names: &[&str], period: &str) -> Leaf {
    let mut params = CertificateParams::new(
        names
            .iter()
            .map(|name| name.to_string())
            .collect::<Vec<_>>(),
    );
    if period == "expired" {
        params.not_before = rcgen::date_time_ymd(2000, 1, 1);
        params.not_after = rcgen::date_time_ymd(2001, 1, 1);
    } else if period == "future" {
        params.not_before = rcgen::date_time_ymd(2098, 1, 1);
        params.not_after = rcgen::date_time_ymd(2099, 1, 1);
    }
    let leaf = Certificate::from_params(params).unwrap();
    Leaf {
        der: CertificateDer::from(leaf.serialize_der_with_signer(root).unwrap()),
        key: leaf.serialize_private_key_der(),
    }
}

fn fingerprint(leaf: &Leaf) -> String {
    hex::encode(Sha256::digest(leaf.der.as_ref()))
}

fn acceptor(leaf: &Leaf) -> tokio_rustls::TlsAcceptor {
    let config = rustls::ServerConfig::builder_with_provider(Arc::new(
        rustls::crypto::aws_lc_rs::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .unwrap()
    .with_no_client_auth()
    .with_single_cert(
        vec![leaf.der.clone()],
        PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(leaf.key.clone())),
    )
    .unwrap();
    tokio_rustls::TlsAcceptor::from(Arc::new(config))
}

async fn head(socket: &mut (impl AsyncRead + Unpin)) -> String {
    let mut data = Vec::new();
    while !data.ends_with(b"\r\n\r\n") {
        data.push(socket.read_u8().await.unwrap());
        assert!(data.len() < 16384);
    }
    String::from_utf8(data).unwrap()
}

#[test]
fn proofs_are_bound_to_authority_route_leaf_and_are_one_use() {
    let now = Instant::now();
    for changed in ["host", "port", "route", "fingerprint", "none"] {
        let mut proofs = Proofs::default();
        let id = proofs
            .issue(
                "device.test",
                443,
                Some("http://user:private@proxy.test:80"),
                "aa",
                now,
            )
            .unwrap();
        let result = proofs.consume(
            &id,
            if changed == "host" {
                "other.test"
            } else {
                "device.test"
            },
            if changed == "port" { 444 } else { 443 },
            if changed == "route" {
                None
            } else {
                Some("http://user:private@proxy.test:80")
            },
            if changed == "fingerprint" { "bb" } else { "aa" },
            now,
        );
        assert_eq!(result.is_ok(), changed == "none");
        assert!(proofs
            .consume(
                &id,
                "device.test",
                443,
                Some("http://user:private@proxy.test:80"),
                "aa",
                now
            )
            .is_err());
        if let Err(error) = result {
            assert!(!error.contains("private"));
        }
    }
}

#[test]
fn proofs_expire_and_capacity_is_bounded_without_promoting_evicted_evidence() {
    let now = Instant::now();
    let mut proofs = Proofs::default();
    let first = proofs.issue("device.test", 443, None, "aa", now).unwrap();
    for _ in 0..MAX_PROOFS {
        proofs.issue("device.test", 443, None, "aa", now).unwrap();
    }
    assert_eq!(proofs.0.len(), MAX_PROOFS);
    assert!(proofs
        .consume(&first, "device.test", 443, None, "aa", now)
        .is_err());
    let last = proofs.0.back().unwrap().id.clone();
    assert!(proofs
        .consume(&last, "device.test", 443, None, "aa", now + PROOF_LIFETIME)
        .is_err());
    assert!(proofs.0.is_empty());
}

#[tokio::test]
async fn inspection_verifies_chain_name_time_and_signature_on_configured_connect_without_target_http(
) {
    for scenario in [
        "valid",
        "unknown-root",
        "wrong-name",
        "ip-name",
        "expired",
        "future",
        "no-roots",
        "root-error",
    ] {
        let (ca, roots) = root();
        let target = leaf(&ca, &["device.test"], scenario);
        let expected_fp = fingerprint(&target);
        let acceptor = acceptor(&target);
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let task = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let request = head(&mut socket).await;
            assert!(request.starts_with("CONNECT "));
            assert!(!request.contains("Authorization: Basic"));
            socket
                .write_all(b"HTTP/1.1 200 Connection established\r\n\r\n")
                .await
                .unwrap();
            let mut tls = acceptor.accept(socket).await.unwrap();
            assert_eq!(
                tls.read(&mut [0; 1]).await.unwrap_or_default(),
                0,
                "inspection sent target HTTP bytes"
            );
        });
        let roots = match scenario {
            "unknown-root" => Ok(root().1),
            "no-roots" => Ok(rustls::RootCertStore::empty()),
            "root-error" => Err("synthetic unavailable roots".into()),
            _ => Ok(roots),
        };
        let host = match scenario {
            "wrong-name" => "other.test",
            "ip-name" => "127.0.0.1",
            _ => "device.test",
        };
        let proxy = format!("http://127.0.0.1:{port}");
        let info = super::super::proxy_transport::inspect_certificate_with_roots(
            host,
            443,
            Some(&proxy),
            roots,
        )
        .await
        .unwrap();
        assert_eq!(info.fingerprint, expected_fp);
        let expected = match scenario {
            "valid" => CaValidationStatus::Verified,
            "no-roots" | "root-error" => CaValidationStatus::Unavailable,
            _ => CaValidationStatus::Unverified,
        };
        assert_eq!(info.ca_validation.status, expected, "{scenario}");
        if let Some(proof) = info.ca_validation.proof_id {
            assert_eq!(scenario, "valid");
            consume_ca_inspection_proof(&proof, host, 443, Some(&proxy), &info.fingerprint)
                .unwrap();
            assert!(consume_ca_inspection_proof(
                &proof,
                host,
                443,
                Some(&proxy),
                &info.fingerprint
            )
            .is_err());
        } else {
            assert_ne!(scenario, "valid");
        }
        task.await.unwrap();
    }
}

#[test]
fn ca_verifier_requires_the_intermediate_and_rechecks_time_leaf_and_fixed_authority() {
    let (ca, roots) = root();
    let mut intermediate_params = CertificateParams::new(vec![]);
    intermediate_params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
    let intermediate = Certificate::from_params(intermediate_params).unwrap();
    let intermediate_der =
        CertificateDer::from(intermediate.serialize_der_with_signer(&ca).unwrap());
    let target = leaf(&intermediate, &["device.test"], "valid");
    let replacement = leaf(&intermediate, &["device.test"], "valid");
    let verifier = CaPinnedVerifier {
        ca: verifier(roots).unwrap(),
        pin: PinnedCertificateVerification::new(fingerprint(&target)),
        target: tls_server_name("device.test").unwrap(),
        https_proxy: None,
    };
    let name = tls_server_name("device.test").unwrap();
    let now = UnixTime::now();
    assert!(verifier
        .verify_server_cert(&target.der, &[], &name, &[], now)
        .is_err());
    assert!(verifier
        .verify_server_cert(
            &target.der,
            std::slice::from_ref(&intermediate_der),
            &name,
            &[],
            now
        )
        .is_ok());
    assert!(verifier
        .verify_server_cert(
            &replacement.der,
            std::slice::from_ref(&intermediate_der),
            &name,
            &[],
            now
        )
        .is_err());
    assert!(verifier
        .verify_server_cert(
            &target.der,
            &[intermediate_der],
            &tls_server_name("other.test").unwrap(),
            &[],
            now
        )
        .is_err());
    let expired = leaf(&ca, &["device.test"], "expired");
    let expired_verifier = CaPinnedVerifier {
        ca: verifier.ca.clone(),
        pin: PinnedCertificateVerification::new(fingerprint(&expired)),
        target: name.clone(),
        https_proxy: None,
    };
    assert!(expired_verifier
        .verify_server_cert(&expired.der, &[], &name, &[], now)
        .is_err());
    let valid_then_expired = leaf(&ca, &["device.test"], "expired");
    let timed = CaPinnedVerifier {
        ca: verifier.ca,
        pin: PinnedCertificateVerification::new(fingerprint(&valid_then_expired)),
        target: name.clone(),
        https_proxy: None,
    };
    assert!(timed
        .verify_server_cert(
            &valid_then_expired.der,
            &[],
            &name,
            &[],
            UnixTime::since_unix_epoch(Duration::from_secs(962409600))
        )
        .is_ok());
    assert!(timed
        .verify_server_cert(&valid_then_expired.der, &[], &name, &[], now)
        .is_err());
}

#[derive(Debug)]
struct WrongSigningKey(Arc<rustls::sign::CertifiedKey>);
impl rustls::server::ResolvesServerCert for WrongSigningKey {
    fn resolve(
        &self,
        _: rustls::server::ClientHello<'_>,
    ) -> Option<Arc<rustls::sign::CertifiedKey>> {
        Some(self.0.clone())
    }
}

#[tokio::test]
async fn capture_rejects_an_invalid_tls_handshake_signature_even_when_chain_is_trusted() {
    let (ca, roots) = root();
    let target = leaf(&ca, &["device.test"], "valid");
    let wrong = leaf(&ca, &["device.test"], "valid");
    let wrong_key = rustls::crypto::aws_lc_rs::sign::any_supported_type(&PrivateKeyDer::Pkcs8(
        PrivatePkcs8KeyDer::from(wrong.key),
    ))
    .unwrap();
    let key = Arc::new(rustls::sign::CertifiedKey::new(vec![target.der], wrong_key));
    let server = rustls::ServerConfig::builder_with_provider(Arc::new(
        rustls::crypto::aws_lc_rs::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .unwrap()
    .with_no_client_auth()
    .with_cert_resolver(Arc::new(WrongSigningKey(key)));
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let task = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        head(&mut socket).await;
        socket.write_all(b"HTTP/1.1 200 OK\r\n\r\n").await.unwrap();
        assert!(tokio_rustls::TlsAcceptor::from(Arc::new(server))
            .accept(socket)
            .await
            .is_err());
    });
    assert!(
        super::super::proxy_transport::inspect_certificate_with_roots(
            "device.test",
            443,
            Some(&format!("http://127.0.0.1:{port}")),
            Ok(roots)
        )
        .await
        .is_err()
    );
    task.await.unwrap();
}

#[tokio::test]
async fn distinct_https_proxy_and_target_are_verified_for_http_and_websocket_upgrades() {
    for websocket in [false, true] {
        let (ca, roots) = root();
        let proxy_cert = leaf(&ca, &["127.0.0.1"], "valid");
        let target = leaf(&ca, &["device.test"], "valid");
        let pin = fingerprint(&target);
        let outer = acceptor(&proxy_cert);
        let inner = acceptor(&target);
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let task = tokio::spawn(async move {
            let (tcp, _) = listener.accept().await.unwrap();
            let mut proxy_tls = outer.accept(tcp).await.unwrap();
            let connect = head(&mut proxy_tls).await;
            assert!(connect.starts_with("CONNECT device.test:443 "));
            assert!(connect
                .to_ascii_lowercase()
                .contains("proxy-authorization: basic "));
            assert!(!connect.contains("fixture-password"));
            proxy_tls
                .write_all(b"HTTP/1.1 200 Connection established\r\n\r\n")
                .await
                .unwrap();
            let mut target_tls = inner.accept(proxy_tls).await.unwrap();
            let request = head(&mut target_tls).await;
            assert!(request.starts_with("GET /fixture "));
            assert!(request
                .to_ascii_lowercase()
                .contains("authorization: basic "));
            assert!(!request.to_ascii_lowercase().contains("proxy-authorization"));
            if websocket {
                assert!(request.to_ascii_lowercase().contains("upgrade: websocket"));
                target_tls.write_all(b"HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n\r\n").await.unwrap();
            } else {
                target_tls
                    .write_all(
                        b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nOK",
                    )
                    .await
                    .unwrap();
            }
        });
        let proxy_url = format!("https://proxy-user:proxy-secret@127.0.0.1:{port}");
        let tls = ca_pinned_config(pin, "1.2", "device.test", Some(&proxy_url), roots).unwrap();
        let client = reqwest::Client::builder()
            .no_proxy()
            .use_preconfigured_tls(tls)
            .proxy(reqwest::Proxy::all(&proxy_url).unwrap())
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap();
        let mut request = client
            .get("https://device.test/fixture")
            .basic_auth("fixture-user", Some("fixture-password"));
        if websocket {
            request = request
                .header("Connection", "Upgrade")
                .header("Upgrade", "websocket")
                .header("Sec-WebSocket-Version", "13")
                .header("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==");
        }
        let response = request.send().await.unwrap();
        assert_eq!(
            response.status().as_u16(),
            if websocket { 101 } else { 200 }
        );
        task.await.unwrap();
    }
}

#[tokio::test]
async fn ca_bound_transport_refuses_changed_leaf_bad_ca_or_wrong_proxy_name_before_target_credentials(
) {
    for failure in [
        "changed-leaf",
        "wrong-target-name",
        "wrong-proxy-name",
        "unknown-root",
    ] {
        let (ca, roots) = root();
        let proxy_cert = leaf(
            &ca,
            &[if failure == "wrong-proxy-name" {
                "other.test"
            } else {
                "127.0.0.1"
            }],
            "valid",
        );
        let inspected = leaf(&ca, &["device.test"], "valid");
        let inspected_pin = fingerprint(&inspected);
        let other_ca = root().0;
        let target = match failure {
            "changed-leaf" => leaf(&ca, &["device.test"], "valid"),
            "wrong-target-name" => leaf(&ca, &["other.test"], "valid"),
            "unknown-root" => leaf(&other_ca, &["device.test"], "valid"),
            _ => inspected,
        };
        let pin = if failure == "changed-leaf" {
            inspected_pin
        } else {
            fingerprint(&target)
        };
        let outer = acceptor(&proxy_cert);
        let inner = acceptor(&target);
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let task = tokio::spawn(async move {
            let (tcp, _) = listener.accept().await.unwrap();
            let proxy_tls = outer.accept(tcp).await;
            if failure == "wrong-proxy-name" {
                assert!(proxy_tls.is_err());
                return;
            }
            let mut proxy_tls = proxy_tls.unwrap();
            head(&mut proxy_tls).await;
            proxy_tls
                .write_all(b"HTTP/1.1 200 OK\r\n\r\n")
                .await
                .unwrap();
            assert!(
                inner.accept(proxy_tls).await.is_err(),
                "target handshake must fail before any target HTTP credential"
            );
        });
        let proxy_url = format!("https://127.0.0.1:{port}");
        let tls = ca_pinned_config(pin, "1.2", "device.test", Some(&proxy_url), roots).unwrap();
        let client = reqwest::Client::builder()
            .no_proxy()
            .use_preconfigured_tls(tls)
            .proxy(reqwest::Proxy::all(&proxy_url).unwrap())
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap();
        assert!(
            client
                .get("https://device.test/fixture")
                .basic_auth("fixture-user", Some("fixture-password"))
                .send()
                .await
                .is_err(),
            "{failure}"
        );
        task.await.unwrap();
    }
}

#[test]
fn unrelated_route_authority_and_same_name_proxy_cannot_escape_target_pin() {
    let (ca, roots) = root();
    let target = leaf(&ca, &["device.test", "other.test"], "valid");
    let verifier = CaPinnedVerifier {
        ca: verifier(roots).unwrap(),
        pin: PinnedCertificateVerification::new(fingerprint(&target)),
        target: tls_server_name("device.test").unwrap(),
        https_proxy: Some(tls_server_name("device.test").unwrap()),
    };
    let other = leaf(&ca, &["device.test"], "valid");
    assert!(verifier
        .verify_server_cert(
            &other.der,
            &[],
            &tls_server_name("device.test").unwrap(),
            &[],
            UnixTime::now()
        )
        .is_err());
    assert!(verifier
        .verify_server_cert(
            &target.der,
            &[],
            &tls_server_name("other.test").unwrap(),
            &[],
            UnixTime::now()
        )
        .is_err());
    assert!(ca_pinned_config(
        fingerprint(&target),
        "1.2",
        "device.test",
        None,
        rustls::RootCertStore::empty()
    )
    .is_err());
}
