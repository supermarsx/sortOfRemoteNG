//! Certificate inspection over the same explicit route used by the web mediator.
//! No direct fallback is allowed when a proxy is configured.

use super::{
    build_tls_config, capture_peer_certificate_chain, tls_server_name, TlsCertificateInfo,
};
use base64::Engine;
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

trait CertificateSocket: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send> CertificateSocket for T {}
type Socket = Box<dyn CertificateSocket>;

const CERTIFICATE_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_CONNECT_HEADER_BYTES: usize = 16 * 1024;

fn parse_proxy(proxy_url: &str) -> Result<url::Url, String> {
    let url =
        url::Url::parse(proxy_url).map_err(|_| "Invalid certificate proxy URL".to_string())?;
    if proxy_url.trim() != proxy_url
        || !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || url.port() == Some(0)
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("Certificate proxy must be an HTTP(S) authority".into());
    }
    Ok(url)
}

fn authority(host: &str, port: u16) -> Result<String, String> {
    if port == 0
        || host.is_empty()
        || host
            .chars()
            .any(|c| c.is_whitespace() || "/\\@?#".contains(c))
    {
        return Err("Invalid certificate target authority".into());
    }
    // URL parsing normalizes DNS/IPv6 while refusing header delimiters.
    let host = host.trim_start_matches('[').trim_end_matches(']');
    let host = if host.contains(':') {
        format!("[{host}]")
    } else {
        host.to_string()
    };
    let parsed = url::Url::parse(&format!("https://{host}:{port}/"))
        .map_err(|_| "Invalid certificate target authority".to_string())?;
    if !parsed.username().is_empty() || parsed.password().is_some() || parsed.host_str().is_none() {
        return Err("Invalid certificate target authority".into());
    }
    Ok(format!(
        "{}:{port}",
        parsed.host_str().expect("validated host")
    ))
}

fn decode_user_info(value: &str) -> String {
    // form_urlencoded decodes percent escapes; literal '+' is not a space in
    // URL user-info, so protect it first. Values enter Base64, never raw headers.
    url::form_urlencoded::parse(
        format!("v={}", value.replace('+', "%2B").replace('&', "%26")).as_bytes(),
    )
    .next()
    .map(|(_, value)| value.into_owned())
    .unwrap_or_default()
}

async fn open_certificate_socket(
    host: &str,
    port: u16,
    proxy_url: Option<&str>,
) -> Result<Socket, String> {
    let target = authority(host, port)?;
    let Some(proxy_url) = proxy_url else {
        return tokio::net::TcpStream::connect(target)
            .await
            .map(|stream| Box::new(stream) as Socket)
            .map_err(|_| "Certificate TCP connection failed".to_string());
    };
    let proxy = parse_proxy(proxy_url)?;
    let proxy_host = proxy
        .host_str()
        .expect("validated proxy host")
        .trim_start_matches('[')
        .trim_end_matches(']');
    let proxy_port = proxy
        .port_or_known_default()
        .expect("HTTP(S) has a default port");
    let tcp = tokio::net::TcpStream::connect((proxy_host, proxy_port))
        .await
        .map_err(|_| "Certificate proxy TCP connection failed".to_string())?;
    let mut socket: Socket = if proxy.scheme() == "https" {
        // Inspecting the target certificate must NEVER disable verification of
        // a separate HTTPS proxy's own certificate.
        let connector = tokio_rustls::TlsConnector::from(build_tls_config(true)?);
        let stream = connector
            .connect(tls_server_name(proxy_host)?, tcp)
            .await
            .map_err(|_| "Certificate proxy TLS verification failed".to_string())?;
        Box::new(stream)
    } else {
        Box::new(tcp)
    };
    let mut request = format!("CONNECT {target} HTTP/1.1\r\nHost: {target}\r\n");
    if !proxy.username().is_empty() || proxy.password().is_some() {
        let credentials = format!(
            "{}:{}",
            decode_user_info(proxy.username()),
            decode_user_info(proxy.password().unwrap_or_default())
        );
        let encoded = base64::engine::general_purpose::STANDARD.encode(credentials);
        request.push_str(&format!("Proxy-Authorization: Basic {encoded}\r\n"));
    }
    request.push_str("\r\n");
    socket
        .write_all(request.as_bytes())
        .await
        .map_err(|_| "Certificate proxy CONNECT write failed".to_string())?;
    let mut header = Vec::with_capacity(512);
    while !header.ends_with(b"\r\n\r\n") {
        if header.len() == MAX_CONNECT_HEADER_BYTES {
            return Err("Certificate proxy CONNECT response headers exceed the limit".into());
        }
        let byte = socket
            .read_u8()
            .await
            .map_err(|_| "Certificate proxy CONNECT response ended early".to_string())?;
        header.push(byte);
    }
    let status_line = header
        .split(|byte| *byte == b'\n')
        .next()
        .unwrap_or_default();
    let status_line = std::str::from_utf8(status_line)
        .map_err(|_| "Invalid certificate proxy CONNECT response".to_string())?;
    let mut parts = status_line.split_whitespace();
    let version = parts.next().unwrap_or_default();
    let status = parts.next().and_then(|value| value.parse::<u16>().ok());
    if !matches!(version, "HTTP/1.0" | "HTTP/1.1") || !matches!(status, Some(200..=299)) {
        // Never echo an upstream response or proxy URL: either can contain secrets.
        return Err(match status {
            Some(407) => "Certificate proxy authentication was rejected (HTTP 407)".into(),
            Some(code) => format!("Certificate proxy CONNECT was rejected (HTTP {code})"),
            None => "Invalid certificate proxy CONNECT response".into(),
        });
    }
    Ok(socket)
}

/// Fetch the leaf and chain without sending an HTTP request to the target.
pub async fn fetch_tls_certificate_info(
    host: &str,
    port: u16,
    proxy_url: Option<&str>,
) -> Result<TlsCertificateInfo, String> {
    inspect_with_timeout(host, port, proxy_url, CERTIFICATE_TIMEOUT).await
}

async fn inspect_with_timeout(
    host: &str,
    port: u16,
    proxy_url: Option<&str>,
    timeout: Duration,
) -> Result<TlsCertificateInfo, String> {
    tokio::time::timeout(timeout, inspect_certificate(host, port, proxy_url))
        .await
        .map_err(|_| "Certificate inspection timed out after 15 seconds".to_string())?
}

async fn inspect_certificate(
    host: &str,
    port: u16,
    proxy_url: Option<&str>,
) -> Result<TlsCertificateInfo, String> {
    let socket = open_certificate_socket(host, port, proxy_url).await?;
    let connector = tokio_rustls::TlsConnector::from(build_tls_config(false)?);
    let host = host.trim_start_matches('[').trim_end_matches(']');
    let tls = connector
        .connect(tls_server_name(host)?, socket)
        .await
        .map_err(|_| "Target certificate TLS handshake failed".to_string())?;
    capture_peer_certificate_chain(tls.get_ref().1.peer_certificates().unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::super::tls_test_fixture::{test_acceptor, TEST_CERT};
    use super::*;
    use sha2::{Digest, Sha256};
    use tokio::net::TcpListener;

    async fn read_request<S: AsyncRead + Unpin>(socket: &mut S) -> String {
        let mut bytes = Vec::new();
        while !bytes.ends_with(b"\r\n\r\n") {
            bytes.push(socket.read_u8().await.unwrap());
            assert!(bytes.len() < MAX_CONNECT_HEADER_BYTES);
        }
        String::from_utf8(bytes).unwrap()
    }

    #[test]
    fn rejects_header_injection_and_non_authority_proxy_routes() {
        for host in ["host\r\nX-Injected: yes", "user@host", "host/path", ""] {
            assert!(authority(host, 443).is_err());
        }
        assert_eq!(
            authority("2001:db8::1", 8443).unwrap(),
            "[2001:db8::1]:8443"
        );
        for proxy in [
            "socks5://localhost:1",
            "http://localhost/path",
            "http://localhost:0",
            " http://localhost:1",
            "http://localhost/?x=1",
        ] {
            assert!(parse_proxy(proxy).is_err());
        }
        assert_eq!(decode_user_info("a+b%3Ac%0D%0A"), "a+b:c\r\n");
        assert_eq!(decode_user_info("a&b+c%26d%2Be"), "a&b+c&d+e");
    }

    #[tokio::test]
    async fn authenticates_connect_and_inspects_target_without_local_target_dns() {
        let acceptor = test_acceptor();
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let proxy = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let request = read_request(&mut socket).await;
            assert_eq!(request,
                "CONNECT private.invalid:8443 HTTP/1.1\r\nHost: private.invalid:8443\r\nProxy-Authorization: Basic dXNlcituYW1lOnNlY3JldDoNCg==\r\n\r\n");
            socket
                .write_all(b"HTTP/1.1 200 Connection established\r\n\r\n")
                .await
                .unwrap();
            let mut tls = acceptor.accept(socket).await.unwrap();
            let _ = tls.read_u8().await; // Inspection sends no HTTP application request.
        });
        let info = fetch_tls_certificate_info(
            "private.invalid",
            8443,
            Some(&format!(
                "http://user+name:secret%3A%0D%0A@127.0.0.1:{port}"
            )),
        )
        .await
        .unwrap();
        let der = base64::engine::general_purpose::STANDARD
            .decode(TEST_CERT)
            .unwrap();
        assert_eq!(info.fingerprint, hex::encode(Sha256::digest(&der)));
        assert_eq!(info.chain.len(), 1);
        assert_eq!(info.chain[0].fingerprint, info.fingerprint);
        let wire = serde_json::to_value(&info).unwrap();
        assert_eq!(wire["chain"][0]["fingerprint"], wire["fingerprint"]);
        // Identical rich parsing in lean/default and the compatibility feature.
        assert!(wire["chain"][0]["subject"]
            .as_str()
            .unwrap()
            .contains("localhost"));
        assert!(!wire["chain"][0]["valid_from"].as_str().unwrap().is_empty());
        assert_eq!(wire["details"]["public_key"]["bits"], 2048);
        assert_eq!(wire["details"]["signature_parameters_der_base64"], "BQA=");
        assert_eq!(wire["capture"]["source"], "peer-presented");
        assert_eq!(wire["chain"][0]["details"]["der_base64"], TEST_CERT);
        assert!(info.warnings.is_empty(), "{:?}", info.warnings);
        proxy.await.unwrap();
    }

    #[tokio::test]
    async fn direct_ip_inspection_returns_real_fingerprint_without_sending_credentials() {
        let acceptor = test_acceptor();
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let peer = tokio::spawn(async move {
            let (socket, _) = listener.accept().await.unwrap();
            let mut tls = acceptor.accept(socket).await.unwrap();
            // Inspection is TLS-only: no HTTP request or stored credentials.
            assert_eq!(tls.read(&mut [0; 1]).await.unwrap_or_default(), 0);
        });
        let info = fetch_tls_certificate_info("127.0.0.1", port, None)
            .await
            .unwrap();
        let der = base64::engine::general_purpose::STANDARD
            .decode(TEST_CERT)
            .unwrap();
        assert_eq!(info.fingerprint, hex::encode(Sha256::digest(&der)));
        assert_eq!(info.chain[0].fingerprint, info.fingerprint);
        assert_eq!(info.subject_cn.as_deref(), Some("localhost"));
        assert_eq!(info.san, ["DNS:localhost", "IP:127.0.0.1"]);
        assert_eq!(info.capture.certificate_count, 1);
        assert!(info.pem.unwrap().starts_with("-----BEGIN CERTIFICATE-----"));
        peer.await.unwrap();
    }

    #[tokio::test]
    async fn failed_authentication_has_no_direct_fallback_or_secret_echo() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let proxy = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let _ = read_request(&mut socket).await;
            socket
                .write_all(b"HTTP/1.1 407 secret-password\r\nX-Secret: sensitive\r\n\r\n")
                .await
                .unwrap();
        });
        let error = fetch_tls_certificate_info(
            "private.invalid",
            443,
            Some(&format!("http://user:secret-password@127.0.0.1:{port}")),
        )
        .await
        .unwrap_err();
        assert!(error.contains("407"));
        assert!(!error.contains("secret-password"));
        assert!(!error.contains("sensitive"));
        assert!(!error.contains("private.invalid"));
        proxy.await.unwrap();
    }

    #[tokio::test]
    async fn bounds_connect_response_headers() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let proxy = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let _ = read_request(&mut socket).await;
            let _ = socket
                .write_all(&vec![b'x'; MAX_CONNECT_HEADER_BYTES + 1])
                .await;
        });
        let error = open_certificate_socket(
            "private.invalid",
            443,
            Some(&format!("http://127.0.0.1:{port}")),
        )
        .await
        .err()
        .unwrap();
        assert!(error.contains("exceed the limit"));
        proxy.await.unwrap();
    }

    #[tokio::test]
    async fn cancellation_drops_an_unresponsive_proxy_socket() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let (seen_tx, seen_rx) = tokio::sync::oneshot::channel();
        let proxy = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let _ = read_request(&mut socket).await;
            seen_tx.send(()).unwrap();
            assert_eq!(socket.read(&mut [0]).await.unwrap(), 0);
        });
        let task = tokio::spawn(async move {
            fetch_tls_certificate_info(
                "private.invalid",
                443,
                Some(&format!("http://127.0.0.1:{port}")),
            )
            .await
        });
        seen_rx.await.unwrap();
        task.abort();
        assert!(task.await.unwrap_err().is_cancelled());
        tokio::time::timeout(Duration::from_secs(2), proxy)
            .await
            .unwrap()
            .unwrap();
    }

    #[tokio::test]
    async fn inspection_deadline_bounds_an_unresponsive_proxy() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let proxy = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let _ = read_request(&mut socket).await;
            assert_eq!(socket.read(&mut [0]).await.unwrap(), 0);
        });
        let error = inspect_with_timeout(
            "private.invalid",
            443,
            Some(&format!("http://127.0.0.1:{port}")),
            Duration::from_millis(100),
        )
        .await
        .unwrap_err();
        assert!(error.contains("timed out"));
        assert_eq!(CERTIFICATE_TIMEOUT, Duration::from_secs(15));
        proxy.await.unwrap();
    }

    #[tokio::test]
    async fn https_proxy_certificate_is_not_exempted_by_target_inspection() {
        let acceptor = test_acceptor();
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let proxy = tokio::spawn(async move {
            let (socket, _) = listener.accept().await.unwrap();
            assert!(acceptor.accept(socket).await.is_err());
        });
        let error = fetch_tls_certificate_info(
            "private.invalid",
            443,
            Some(&format!("https://127.0.0.1:{port}")),
        )
        .await
        .unwrap_err();
        assert!(error.contains("proxy TLS verification failed"));
        proxy.await.unwrap();
    }
}
