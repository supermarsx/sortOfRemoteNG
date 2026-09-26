//! Explicit, credential-free HTTP identification for the scanner.
//!
//! TCP connect uses timeout_secs (default 5s), followed by the legacy passive
//! banner read (at most 2s). Opting in adds min(timeout_secs, 5s) for the entire
//! HTTP exchange, including connect, TLS, headers and body. The retained body
//! is capped at 64 KiB; reaching that cap stops reading immediately. No DNS,
//! redirects, retries, decompression, credentials, cookie jar or proxy is used.
//! The cap applies to the inspected body, not HTTP/TLS framing or transport
//! read-ahead. Display strings are at most 256 Unicode characters.

use super::{NetworkService, PortCheckResult};
use std::net::{IpAddr, SocketAddr};
use std::time::Duration;
use tokio::io::AsyncReadExt;
use tokio::net::TcpStream;
use tokio::time::{timeout, timeout_at, Instant};

const MAX_BODY_BYTES: usize = 64 * 1024;
const MAX_TEXT_CHARS: usize = 256;

pub async fn check_port(
    host: String,
    port: u16,
    timeout_secs: Option<u64>,
    identify_http: Option<String>,
) -> Result<PortCheckResult, String> {
    // Validate all identification inputs before even the initial TCP connect.
    let target = match identify_http.as_deref() {
        None => None,
        Some(scheme @ ("http" | "https")) => {
            let ip: IpAddr = host.parse().map_err(|_| "identification_requires_ip")?;
            Some((scheme, SocketAddr::new(ip, port)))
        }
        Some(_) => return Err("invalid_identification_scheme".into()),
    };
    let duration = Duration::from_secs(timeout_secs.unwrap_or(5));
    let start = Instant::now();
    let mut result = PortCheckResult {
        port,
        open: false,
        service: NetworkService::get_common_ports()
            .iter()
            .find(|(p, _)| *p == port)
            .map(|(_, s)| s.clone()),
        time_ms: None,
        banner: None,
        http_server: None,
        http_title: None,
        http_status: None,
        identification_error: None,
    };
    let connected = timeout(duration, async {
        match target {
            Some((_, addr)) => TcpStream::connect(addr).await,
            None => TcpStream::connect(format!("{}:{}", host, port)).await,
        }
    })
    .await;
    if let Ok(Ok(mut stream)) = connected {
        result.open = true;
        result.time_ms = Some(start.elapsed().as_millis() as u64);
        let mut buf = [0u8; 128];
        if let Ok(Ok(n)) = timeout(Duration::from_secs(2), stream.read(&mut buf)).await {
            let cleaned: String = String::from_utf8_lossy(&buf[..n])
                .chars()
                .filter(|c| c.is_ascii_graphic() || *c == ' ')
                .take(64)
                .collect();
            result.banner = (!cleaned.is_empty()).then_some(cleaned);
        }
        drop(stream);
        if let Some((scheme, addr)) = target {
            identify(
                &mut result,
                scheme,
                addr,
                duration.min(Duration::from_secs(5)),
            )
            .await;
        }
    }
    Ok(result)
}

async fn identify(result: &mut PortCheckResult, scheme: &str, addr: SocketAddr, budget: Duration) {
    // An outer absolute deadline also covers header/body trickling; successful
    // chunks do not reset it. Keep metadata already received on later failure.
    let deadline = Instant::now() + budget;
    let mut body = Vec::new();
    let exchange = async {
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .http1_only()
            .no_gzip()
            .no_brotli()
            .no_deflate()
            .no_zstd()
            .connect_timeout(budget)
            .timeout(budget)
            .build()
            .map_err(|_| "client_error")?;
        // SocketAddr formats IPv6 with brackets and cannot contain URL userinfo.
        let mut response = client
            .get(format!("{scheme}://{addr}/"))
            .header(reqwest::header::ACCEPT_ENCODING, "identity")
            .header(reqwest::header::CONNECTION, "close")
            .send()
            .await
            .map_err(|e| request_error(&e, scheme))?;
        result.http_status = Some(response.status().as_u16());
        result.http_server = response
            .headers()
            .get(reqwest::header::SERVER)
            .and_then(|v| v.to_str().ok())
            .and_then(safe_text);
        // Do not turn 401/403 into errors or attempt any authentication.
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|e| request_error(&e, scheme))?
        {
            let remaining = MAX_BODY_BYTES - body.len();
            body.extend_from_slice(&chunk[..chunk.len().min(remaining)]);
            if body.len() == MAX_BODY_BYTES {
                return Err("response_too_large");
            }
        }
        Ok(())
    };
    let error = match timeout_at(deadline, exchange).await {
        Ok(Ok(())) => None,
        Ok(Err(error)) => Some(error),
        Err(_) => Some("timeout"),
    };
    result.http_title = extract_title(&body);
    result.identification_error = error.map(str::to_owned);
}

fn request_error(error: &reqwest::Error, scheme: &str) -> &'static str {
    if error.is_timeout() {
        "timeout"
    } else if scheme == "https" && error.is_connect() {
        // Includes certificate rejection and TLS handshake failure. No insecure retry.
        "certificate_or_tls_failure"
    } else {
        "http_error"
    }
}

// Plain display text only: no markup delimiters, controls or invisible/bidi
// formatting. Consumers must still render these untrusted strings as text.
fn safe_text(text: &str) -> Option<String> {
    let cleaned: String = text
        .chars()
        .map(|c| if c.is_whitespace() { ' ' } else { c })
        .filter(|c| {
            !c.is_control()
                && !matches!(*c, '<' | '>' | '\u{200b}'..='\u{200f}' |
            '\u{202a}'..='\u{202e}' | '\u{2060}'..='\u{206f}' | '\u{feff}')
        })
        .collect();
    let cleaned: String = cleaned
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(MAX_TEXT_CHARS)
        .collect();
    (!cleaned.is_empty()).then_some(cleaned)
}

fn extract_title(body: &[u8]) -> Option<String> {
    let html = String::from_utf8_lossy(body);
    let lower = html.to_ascii_lowercase();
    let mut offset = 0;
    while let Some(index) = lower[offset..].find("<title") {
        let start = offset + index + 6;
        let next = *lower.as_bytes().get(start)?;
        if next != b'>' && !next.is_ascii_whitespace() {
            offset = start;
            continue;
        }
        let content = start + lower[start..].find('>')? + 1;
        let end = content + lower[content..].find("</title>")?;
        // A tiny text extractor, never a browser/parser that executes or fetches.
        return safe_text(&decode_entities(&html[content..end]));
    }
    None
}

fn decode_entities(text: &str) -> String {
    let mut output = String::new();
    let mut rest = text;
    while let Some(index) = rest.find('&') {
        output.push_str(&rest[..index]);
        rest = &rest[index..];
        // Bound each entity search, including input consisting only of '&'.
        if let Some(end) = rest.as_bytes().iter().take(13).position(|b| *b == b';') {
            let entity = &rest[1..end];
            let decoded = match entity {
                "amp" => Some('&'),
                "lt" => Some('<'),
                "gt" => Some('>'),
                "quot" => Some('"'),
                "apos" | "#39" => Some('\''),
                "nbsp" => Some(' '),
                _ => entity
                    .strip_prefix("#x")
                    .or_else(|| entity.strip_prefix("#X"))
                    .and_then(|n| u32::from_str_radix(n, 16).ok())
                    .or_else(|| entity.strip_prefix('#').and_then(|n| n.parse().ok()))
                    .and_then(char::from_u32),
            };
            if let Some(c) = decoded {
                output.push(c);
                rest = &rest[end + 1..];
                continue;
            }
        }
        output.push('&');
        rest = &rest[1..];
    }
    output.push_str(rest);
    output
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::AsyncWriteExt;
    use tokio::net::TcpListener;

    fn open_result(port: u16) -> PortCheckResult {
        serde_json::from_value(serde_json::json!({
            "port": port, "open": true, "service": null,
            "time_ms": 0, "banner": null
        }))
        .unwrap()
    }

    async fn read_request(stream: &mut TcpStream) -> String {
        let mut request = Vec::new();
        timeout(Duration::from_secs(3), async {
            while !request.ends_with(b"\r\n\r\n") && request.len() < 4096 {
                request.push(stream.read_u8().await.unwrap());
            }
        })
        .await
        .unwrap();
        String::from_utf8(request).unwrap()
    }

    #[test]
    fn optional_fields_preserve_legacy_json() {
        let value = serde_json::to_value(open_result(80)).unwrap();
        for key in [
            "http_server",
            "http_title",
            "http_status",
            "identification_error",
        ] {
            assert!(value.get(key).is_none());
        }
    }

    #[test]
    fn title_and_server_are_bounded_plain_text() {
        assert_eq!(
            extract_title(
                b"<TITLE class='x'> NAS\n &amp; &#x41; &#66; &lt;x&gt;&#x202e;\x1b </TITLE>"
            ),
            Some("NAS & A B x".into())
        );
        assert_eq!(
            extract_title(b"<titleish>wrong</title><title>right</title>"),
            Some("right".into())
        );
        assert_eq!(extract_title(b"<title>unfinished"), None);
        assert_eq!(safe_text("\r\n\0\u{202e}"), None);
        assert_eq!(
            safe_text(&"é".repeat(1024)).unwrap().chars().count(),
            MAX_TEXT_CHARS
        );
        assert_eq!(
            safe_text("server\t v1\u{200b}<test>"),
            Some("server v1test".into())
        );
        assert_eq!(
            decode_entities(&"&".repeat(MAX_BODY_BYTES)),
            "&".repeat(MAX_BODY_BYTES)
        );
    }

    #[tokio::test]
    async fn invalid_scheme_and_non_ip_rejected_before_connect() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        for scheme in ["", "HTTP", "ftp", "https://", " http"] {
            assert_eq!(
                check_port("127.0.0.1".into(), port, None, Some(scheme.into()))
                    .await
                    .unwrap_err(),
                "invalid_identification_scheme"
            );
        }
        for host in ["localhost", "user@127.0.0.1", "127.0.0.1/path", "[::1]"] {
            assert_eq!(
                check_port(host.into(), port, None, Some("http".into()))
                    .await
                    .unwrap_err(),
                "identification_requires_ip"
            );
        }
        assert!(timeout(Duration::from_millis(50), listener.accept())
            .await
            .is_err());
    }

    #[tokio::test]
    async fn omitted_scheme_preserves_passive_banner_and_sends_nothing() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            stream.write_all(b"SSH-2.0-test\r\n").await.unwrap();
            assert_eq!(
                timeout(Duration::from_secs(2), stream.read_u8())
                    .await
                    .unwrap()
                    .unwrap_err()
                    .kind(),
                std::io::ErrorKind::UnexpectedEof
            );
            assert!(timeout(Duration::from_millis(50), listener.accept())
                .await
                .is_err());
        });
        let result = check_port("127.0.0.1".into(), port, Some(1), None)
            .await
            .unwrap();
        assert!(result.open);
        assert_eq!(result.banner.as_deref(), Some("SSH-2.0-test"));
        assert!(result.http_status.is_none());
        server.await.unwrap();
    }

    #[tokio::test]
    async fn captures_denied_status_and_redirect_without_credentials_or_followup() {
        for status in [200, 401, 403, 302] {
            let destination = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let addr = listener.local_addr().unwrap();
            let location = destination.local_addr().unwrap();
            let server = tokio::spawn(async move {
                let (mut stream, _) = listener.accept().await.unwrap();
                // Complete the passive phase without waiting two seconds.
                stream.shutdown().await.unwrap();
                let (mut stream, _) = listener.accept().await.unwrap();
                let request = read_request(&mut stream).await.to_ascii_lowercase();
                assert!(request.starts_with("get / http/1.1\r\n"));
                assert!(request.contains(&format!("host: {addr}\r\n")));
                for header in ["authorization:", "proxy-authorization:", "cookie:"] {
                    assert!(!request.contains(header));
                }
                let body = "<title>Device &amp; Console</title>";
                let response = format!("HTTP/1.1 {status} Test\r\nServer: Appliance/1\r\nLocation: http://{location}/login\r\nSet-Cookie: session=secret\r\nWWW-Authenticate: Basic realm=private\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
                stream.write_all(response.as_bytes()).await.unwrap();
                assert!(timeout(Duration::from_millis(100), listener.accept())
                    .await
                    .is_err());
            });
            let result = check_port(
                "127.0.0.1".into(),
                addr.port(),
                Some(2),
                Some("http".into()),
            )
            .await
            .unwrap();
            assert!(result.open);
            assert_eq!(result.http_status, Some(status));
            assert_eq!(result.http_server.as_deref(), Some("Appliance/1"));
            assert_eq!(result.http_title.as_deref(), Some("Device & Console"));
            assert!(result.identification_error.is_none());
            server.await.unwrap();
            assert!(timeout(Duration::from_millis(50), destination.accept())
                .await
                .is_err());
        }
    }

    #[tokio::test]
    async fn stops_at_body_limit_without_waiting_for_eof() {
        for chunked in [false, true] {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let addr = listener.local_addr().unwrap();
            let server = tokio::spawn(async move {
                let (mut stream, _) = listener.accept().await.unwrap();
                read_request(&mut stream).await;
                let framing = if chunked {
                    "Transfer-Encoding: chunked\r\n".into()
                } else {
                    format!("Content-Length: {}\r\n", MAX_BODY_BYTES * 2)
                };
                stream
                    .write_all(format!("HTTP/1.1 200 OK\r\n{framing}\r\n").as_bytes())
                    .await
                    .unwrap();
                if chunked {
                    stream
                        .write_all(format!("{:x}\r\n", MAX_BODY_BYTES * 2).as_bytes())
                        .await
                        .unwrap();
                }
                stream.write_all(&vec![b'x'; MAX_BODY_BYTES]).await.unwrap();
                // A title past the limit must not be returned.
                let _ = stream.write_all(b"<title>outside budget</title>").await;
                tokio::time::sleep(Duration::from_secs(3)).await;
            });
            let mut result = open_result(addr.port());
            identify(&mut result, "http", addr, Duration::from_secs(2)).await;
            assert_eq!(
                result.identification_error.as_deref(),
                Some("response_too_large")
            );
            assert_eq!(result.http_status, Some(200));
            assert!(result.http_title.is_none());
            server.abort();
        }
    }

    #[tokio::test]
    async fn deadline_bounds_silent_headers_and_trickling_body() {
        for trickle in [false, true] {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let addr = listener.local_addr().unwrap();
            let server = tokio::spawn(async move {
                let (mut stream, _) = listener.accept().await.unwrap();
                read_request(&mut stream).await;
                if trickle {
                    stream.write_all(b"HTTP/1.1 403 Forbidden\r\nServer: Console\r\nContent-Length: 10000\r\n\r\n<title>Access denied</title>").await.unwrap();
                    loop {
                        tokio::time::sleep(Duration::from_millis(20)).await;
                        if stream.write_all(b" ").await.is_err() {
                            break;
                        }
                    }
                } else {
                    tokio::time::sleep(Duration::from_secs(3)).await;
                }
            });
            let mut result = open_result(addr.port());
            let start = Instant::now();
            identify(&mut result, "http", addr, Duration::from_millis(300)).await;
            assert!(start.elapsed() < Duration::from_secs(2));
            assert_eq!(result.identification_error.as_deref(), Some("timeout"));
            assert!(result.open);
            if trickle {
                assert_eq!(result.http_status, Some(403));
                assert_eq!(result.http_title.as_deref(), Some("Access denied"));
                assert_eq!(result.http_server.as_deref(), Some("Console"));
            }
            server.abort();
        }
    }

    #[tokio::test]
    async fn tls_failure_keeps_tcp_port_open_without_plaintext_retry() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            stream.shutdown().await.unwrap();
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut hello = [0u8; 1024];
            let n = timeout(Duration::from_secs(2), stream.read(&mut hello))
                .await
                .unwrap()
                .unwrap();
            assert!(n > 0);
            assert_eq!(hello[0], 22); // TLS handshake, never an HTTP GET.
            stream.write_all(b"HTTP/1.1 200 OK\r\n\r\n").await.unwrap();
            drop(stream);
            assert!(timeout(Duration::from_millis(100), listener.accept())
                .await
                .is_err());
        });
        let result = check_port(
            "127.0.0.1".into(),
            addr.port(),
            Some(2),
            Some("https".into()),
        )
        .await
        .unwrap();
        assert!(result.open);
        assert_eq!(
            result.identification_error.as_deref(),
            Some("certificate_or_tls_failure")
        );
        assert!(result.http_status.is_none());
        server.await.unwrap();
    }

    #[tokio::test]
    async fn ipv6_literal_stays_on_requested_socket() {
        let listener = TcpListener::bind("[::1]:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let request = read_request(&mut stream).await.to_ascii_lowercase();
            assert!(request.contains(&format!("host: {addr}\r\n")));
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n")
                .await
                .unwrap();
        });
        let mut result = open_result(addr.port());
        identify(&mut result, "http", addr, Duration::from_secs(2)).await;
        assert_eq!(result.http_status, Some(200));
        assert!(result.identification_error.is_none());
        server.await.unwrap();
    }

    #[tokio::test]
    async fn ignores_environment_proxies() {
        const CHILD_ENV: &str = "SORNG_SERVICE_PROBE_PROXY_TEST_CHILD";
        if std::env::var_os(CHILD_ENV).is_some() {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let addr = listener.local_addr().unwrap();
            let server = tokio::spawn(async move {
                let (mut stream, _) = listener.accept().await.unwrap();
                read_request(&mut stream).await;
                stream
                    .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n")
                    .await
                    .unwrap();
            });
            let mut result = open_result(addr.port());
            identify(&mut result, "http", addr, Duration::from_secs(2)).await;
            assert_eq!(result.http_status, Some(200));
            assert!(result.identification_error.is_none());
            server.await.unwrap();
            return;
        }
        // Set proxy variables only in a child: no global environment races
        // with this crate's other parallel tests or the shared workspace.
        let proxy = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let proxy_url = format!("http://{}", proxy.local_addr().unwrap());
        let mut command = tokio::process::Command::new(std::env::current_exe().unwrap());
        command
            .args([
                "--exact",
                "network::service_probe::tests::ignores_environment_proxies",
            ])
            .env(CHILD_ENV, "1")
            .kill_on_drop(true);
        for name in [
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "ALL_PROXY",
            "http_proxy",
            "https_proxy",
            "all_proxy",
        ] {
            command.env(name, &proxy_url);
        }
        command.env_remove("NO_PROXY").env_remove("no_proxy");
        let output = timeout(Duration::from_secs(10), command.output())
            .await
            .unwrap()
            .unwrap();
        assert!(
            output.status.success(),
            "{}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(timeout(Duration::from_millis(50), proxy.accept())
            .await
            .is_err());
    }
}
