//! Explicit, credential-free HTTP identification for the scanner.
//!
//! TCP connect uses timeout_secs (default 5s; active-mode cap 30s). Only passive
//! mode reads a banner (at most 2s). Opting in adds min(timeout_secs, 5s) for the entire
//! HTTP exchange, including DNS, connect, TLS, headers and up to five redirects.
//! Bodies across all responses share a 64 KiB cap; reaching it stops reading.
//! Redirects may change ports and use a hostname verified against the original
//! IP, but every connection is pinned to that IP. HTTPS cannot downgrade.
//! Only certificate validation failures allow one unverified HTTPS attempt per
//! hop, within the same budget, with a persistent warning. No other retries,
//! decompression, credentials, cookie jar or proxy is used.
//! The cap applies to the inspected body, not HTTP/TLS framing or transport
//! read-ahead. Display strings are at most 256 Unicode characters.

use super::{NetworkService, PortCheckResult};
use std::collections::HashSet;
use std::future::Future;
use std::net::{IpAddr, SocketAddr, ToSocketAddrs};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tokio::io::AsyncReadExt;
use tokio::net::TcpStream;
use tokio::time::{timeout, timeout_at, Instant};

const MAX_BODY_BYTES: usize = 64 * 1024;
const MAX_TEXT_CHARS: usize = 256;
const MAX_REDIRECTS: u8 = 5;
const MAX_URL_BYTES: usize = 4096;

pub async fn check_port(
    host: String,
    port: u16,
    timeout_secs: Option<u64>,
    identify_http: Option<String>,
    identify_protocol: Option<String>,
) -> Result<PortCheckResult, String> {
    // Validate all identification inputs before even the initial TCP connect.
    if identify_http.is_some() && identify_protocol.is_some() {
        return Err("conflicting_identification_modes".into());
    }
    if !matches!(identify_http.as_deref(), None | Some("http" | "https")) {
        return Err("invalid_identification_scheme".into());
    }
    let protocol = match identify_protocol.as_deref() {
        None => None,
        Some("postgres") => Some("postgresql"),
        Some(protocol @ ("smb" | "rdp" | "postgresql")) => Some(protocol),
        Some(_) => return Err("invalid_identification_protocol".into()),
    };
    let target = if identify_http.is_some() || protocol.is_some() {
        let ip: IpAddr = host.parse().map_err(|_| "identification_requires_ip")?;
        Some(SocketAddr::new(ip, port))
    } else {
        None
    };
    let seconds = timeout_secs.unwrap_or(5);
    let duration = Duration::from_secs(if target.is_some() {
        seconds.min(30)
    } else {
        seconds
    });
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
        http_final_origin: None,
        http_redirects: None,
        protocol_confirmed: None,
        protocol_evidence: None,
        protocol_version: None,
        identification_error: None,
    };
    let connected = timeout(duration, async {
        match target {
            Some(addr) => TcpStream::connect(addr).await,
            None => TcpStream::connect(format!("{}:{}", host, port)).await,
        }
    })
    .await;
    if let Ok(Ok(mut stream)) = connected {
        result.open = true;
        result.time_ms = Some(start.elapsed().as_millis() as u64);
        if target.is_none() {
            let mut buf = [0u8; 128];
            if let Ok(Ok(n)) = timeout(Duration::from_secs(2), stream.read(&mut buf)).await {
                let cleaned: String = String::from_utf8_lossy(&buf[..n])
                    .chars()
                    .filter(|c| c.is_ascii_graphic() || *c == ' ')
                    .take(64)
                    .collect();
                result.banner = (!cleaned.is_empty()).then_some(cleaned);
            }
        }
        drop(stream);
        if let Some(addr) = target {
            let budget = duration.min(Duration::from_secs(5));
            if let Some(scheme) = identify_http.as_deref() {
                identify(&mut result, scheme, addr, budget).await;
            } else if let Some(protocol) = protocol {
                crate::protocol_probe::identify(&mut result, protocol, addr, budget).await;
            }
        }
    }
    Ok(result)
}

async fn identify(result: &mut PortCheckResult, scheme: &str, addr: SocketAddr, budget: Duration) {
    identify_with_lookup(result, scheme, addr, budget, system_addresses).await;
}

// Forward lookup runs off the executor. The permit remains in the actual OS
// job if its caller times out, so uncancellable resolvers cannot accumulate
// without limit. Saturation fails closed instead of queueing more OS work.
async fn system_addresses(host: String) -> Result<Vec<IpAddr>, &'static str> {
    static DNS_JOBS: OnceLock<Arc<tokio::sync::Semaphore>> = OnceLock::new();
    let permit = DNS_JOBS
        .get_or_init(|| Arc::new(tokio::sync::Semaphore::new(8)))
        .clone()
        .try_acquire_owned()
        .map_err(|_| "redirect_dns_busy")?;
    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        (host.as_str(), 0)
            .to_socket_addrs()
            .map(|addresses| addresses.map(|address| address.ip()).collect())
            .map_err(|_| "redirect_dns_failed")
    })
    .await
    .map_err(|_| "redirect_dns_failed")?
}

// The HTTP connector can only use names already verified for this scan. Never
// resolve again inside the connector, including after a DNS rebinding change.
struct PinnedDns {
    original: IpAddr,
    verified: Arc<Mutex<HashSet<String>>>,
}

impl reqwest::dns::Resolve for PinnedDns {
    fn resolve(&self, name: reqwest::dns::Name) -> reqwest::dns::Resolving {
        let allowed = self
            .verified
            .lock()
            .is_ok_and(|names| names.contains(name.as_str()));
        let address = SocketAddr::new(self.original, 0);
        Box::pin(async move {
            if allowed {
                let addresses: reqwest::dns::Addrs = Box::new(std::iter::once(address));
                Ok(addresses)
            } else {
                Err(std::io::Error::other("Unverified discovery destination").into())
            }
        })
    }
}

fn url_ip(url: &reqwest::Url) -> Option<IpAddr> {
    url.host_str()?
        .trim_start_matches('[')
        .trim_end_matches(']')
        .parse()
        .ok()
}

fn redirect_url(
    current: &reqwest::Url,
    location: &str,
    original: IpAddr,
) -> Result<reqwest::Url, &'static str> {
    if location.len() > MAX_URL_BYTES || location.chars().any(|c| c.is_control() || c == '\\') {
        return Err("invalid_redirect");
    }
    // Reject even empty userinfo (which URL normalization can otherwise erase).
    let authority = location
        .strip_prefix("//")
        .or_else(|| location.split_once("://").map(|(_, rest)| rest));
    if authority.is_some_and(|rest| {
        rest.trim_start_matches('/')
            .split(['/', '?', '#'])
            .next()
            .unwrap_or("")
            .contains('@')
    }) {
        return Err("redirect_credentials");
    }
    let mut next = current.join(location).map_err(|_| "invalid_redirect")?;
    if !matches!(next.scheme(), "http" | "https") || next.host_str().is_none() {
        return Err("redirect_scheme");
    }
    if !next.username().is_empty() || next.password().is_some() {
        return Err("redirect_credentials");
    }
    if current.scheme() == "https" && next.scheme() == "http" {
        return Err("redirect_downgrade");
    }
    if url_ip(&next).is_some_and(|ip| ip != original) {
        return Err("redirect_out_of_scope");
    }
    next.set_fragment(None);
    if next.as_str().len() > MAX_URL_BYTES {
        return Err("invalid_redirect");
    }
    Ok(next)
}

fn display_origin(url: &reqwest::Url) -> String {
    url.origin().ascii_serialization()
}

const CERTIFICATE_WARNING: &str = "certificate_validation_bypassed";

fn discovery_client(
    addr: SocketAddr,
    verified_hosts: &Arc<Mutex<HashSet<String>>>,
    budget: Duration,
    accept_invalid_certificate: bool,
) -> Result<reqwest::Client, &'static str> {
    reqwest::Client::builder()
        .use_rustls_tls()
        .no_proxy()
        .dns_resolver(Arc::new(PinnedDns {
            original: addr.ip(),
            verified: Arc::clone(verified_hosts),
        }))
        .redirect(reqwest::redirect::Policy::none())
        .referer(false)
        .retry(reqwest::retry::never())
        .http1_only()
        .danger_accept_invalid_certs(accept_invalid_certificate)
        .danger_accept_invalid_hostnames(accept_invalid_certificate)
        .no_gzip()
        .no_brotli()
        .no_deflate()
        .no_zstd()
        .connect_timeout(budget)
        .timeout(budget)
        .build()
        .map_err(|_| "client_error")
}

async fn discovery_get(
    client: &reqwest::Client,
    url: &reqwest::Url,
    deadline: Instant,
) -> Result<reqwest::Response, &'static str> {
    let remaining = deadline
        .checked_duration_since(Instant::now())
        .filter(|time| !time.is_zero())
        .ok_or("timeout")?;
    client
        .get(url.clone())
        .timeout(remaining)
        .header(reqwest::header::ACCEPT_ENCODING, "identity")
        .header(reqwest::header::CONNECTION, "close")
        .send()
        .await
        .map_err(|error| request_error(&error, url.scheme()))
}

async fn identify_with_lookup<F, Fut>(
    result: &mut PortCheckResult,
    scheme: &str,
    addr: SocketAddr,
    budget: Duration,
    mut lookup: F,
) where
    F: FnMut(String) -> Fut,
    Fut: Future<Output = Result<Vec<IpAddr>, &'static str>>,
{
    // An outer absolute deadline also covers header/body trickling; successful
    // chunks do not reset it. Keep metadata already received on later failure.
    let deadline = Instant::now() + budget;
    let mut body = Vec::new();
    let mut certificate_warning = false;
    let exchange = async {
        // SocketAddr formats IPv6 with brackets and cannot contain userinfo.
        let mut url =
            reqwest::Url::parse(&format!("{scheme}://{addr}/")).map_err(|_| "client_error")?;
        let mut visited = HashSet::new();
        let verified_hosts = Arc::new(Mutex::new(HashSet::new()));
        let mut received = 0;
        // Reuse one client/TLS configuration for the chain, instead of reading
        // native trust roots for each hop. Redirects are always handled here.
        let client = discovery_client(addr, &verified_hosts, budget, false)?;
        let mut unverified_client = None;
        for hops in 0..=MAX_REDIRECTS {
            if !visited.insert(url.as_str().to_owned()) {
                return Err("redirect_loop");
            }
            let host = url.host_str().ok_or("invalid_redirect")?;
            let domain = url_ip(&url).is_none();
            let verified = verified_hosts
                .lock()
                .map_err(|_| "client_error")?
                .contains(host);
            if domain && !verified {
                let addresses = lookup(host.to_owned()).await?;
                if !addresses.contains(&addr.ip()) {
                    return Err("redirect_out_of_scope");
                }
                verified_hosts
                    .lock()
                    .map_err(|_| "client_error")?
                    .insert(host.to_owned());
            }
            // The URL preserves Host/SNI/certificate validation. PinnedDns
            // provides only the original IP, even for multihomed DNS answers.
            // Start every hop with validation: a failure at one origin must not
            // disable validation for subsequent destinations in the chain.
            let mut response = match discovery_get(&client, &url, deadline).await {
                Err("certificate_validation_failed") => {
                    certificate_warning = true;
                    if unverified_client.is_none() {
                        unverified_client =
                            Some(discovery_client(addr, &verified_hosts, budget, true)?);
                    }
                    discovery_get(unverified_client.as_ref().unwrap(), &url, deadline).await?
                }
                response => response?,
            };
            body.clear();
            result.http_status = Some(response.status().as_u16());
            result.http_final_origin = Some(display_origin(&url));
            result.http_redirects = Some(hops);
            result.http_server = response
                .headers()
                .get(reqwest::header::SERVER)
                .and_then(|v| v.to_str().ok())
                .and_then(safe_text);
            // Do not turn 401/403 into errors or attempt any authentication.
            while let Some(chunk) = response
                .chunk()
                .await
                .map_err(|e| request_error(&e, url.scheme()))?
            {
                let count = chunk.len().min(MAX_BODY_BYTES - received);
                body.extend_from_slice(&chunk[..count]);
                received += count;
                if received == MAX_BODY_BYTES {
                    return Err("response_too_large");
                }
            }
            if !matches!(response.status().as_u16(), 301 | 302 | 303 | 307 | 308) {
                return Ok(());
            }
            let Some(location) = response.headers().get(reqwest::header::LOCATION) else {
                return Ok(());
            };
            let next = redirect_url(
                &url,
                location.to_str().map_err(|_| "invalid_redirect")?,
                addr.ip(),
            )?;
            if hops == MAX_REDIRECTS {
                return Err("redirect_limit");
            }
            url = next;
        }
        unreachable!("the last allowed hop returns redirect_limit")
    };
    let error = match timeout_at(deadline, exchange).await {
        Ok(Ok(())) => None,
        Ok(Err(error)) => Some(error),
        Err(_) => Some("timeout"),
    };
    result.http_title = extract_title(&body);
    // Reuse the persisted error/evidence contract. A later failure must not
    // overwrite the warning; successful identification must not erase it.
    result.identification_error = match (certificate_warning, error) {
        (true, Some(error)) => Some(format!("{CERTIFICATE_WARNING};{error}")),
        (true, None) => Some(CERTIFICATE_WARNING.into()),
        (false, error) => error.map(str::to_owned),
    };
}

fn certificate_validation_failed(error: &(dyn std::error::Error + 'static)) -> bool {
    // reqwest does not expose the rustls error type. Match only rustls's
    // InvalidCertificate display prefix in the source chain, never broad words
    // such as "certificate" or remote HTTP text. Unknown TLS errors fail closed.
    let mut source = Some(error);
    while let Some(error) = source {
        if error.to_string().starts_with("invalid peer certificate: ") {
            return true;
        }
        source = error.source();
    }
    false
}

fn request_error(error: &reqwest::Error, scheme: &str) -> &'static str {
    if error.is_timeout() {
        "timeout"
    } else if scheme == "https" && error.is_connect() {
        if certificate_validation_failed(error) {
            "certificate_validation_failed"
        } else {
            "tls_or_connection_failure"
        }
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

    // Uses the repository's Node/OpenSSL fixture tooling, with a unique
    // disposable certificate directory. No test changes the machine trust store.
    async fn self_signed_server() -> (
        tokio::process::Child,
        tokio::io::Lines<tokio::io::BufReader<tokio::process::ChildStdout>>,
        u16,
    ) {
        use tokio::io::AsyncBufReadExt;
        let script = r#"
import https from 'node:https';
import { mkdtempSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureMockPveCertificate } from './e2e/helpers/fixtures/mock-pve/server.mjs';
const dir = mkdtempSync(join(tmpdir(), 'sorng-probe-tls-'));
let tls;
try {
  tls = ensureMockPveCertificate({certDir: dir});
} finally {
  for (const name of ['server.crt', 'server.key']) {
    try { unlinkSync(join(dir, name)); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  rmdirSync(dir);
}
const server = https.createServer({cert: tls.certificate, key: tls.privateKey}, (req, res) => {
  console.log(JSON.stringify({url: req.url, headers: req.headers}));
  res.setHeader('Server', 'nginx');
  res.setHeader('Set-Cookie', 'session=must-not-forward');
  res.setHeader('Connection', 'close');
  if (req.url === '/slow') return; // Outer discovery deadline must end this response.
  if (req.url === '/start') {
    res.writeHead(302, {Location: '/final'});
    return res.end('<title>302 Found</title>');
  }
  if (req.url === '/loop') {
    res.writeHead(302, {Location: '/loop'});
    return res.end();
  }
  if (req.url.startsWith('/limit/')) {
    res.writeHead(302, {Location: '/limit/' + (Number(req.url.split('/').pop()) + 1)});
    return res.end();
  }
  if (req.url === '/body') return res.end('x'.repeat(65536) + '<title>Too late</title>');
  if (req.url === '/downgrade' || req.url === '/escape' || req.url === '/credentials') {
    const location = req.url === '/downgrade' ? 'http://127.0.0.1/' :
      req.url === '/escape' ? 'https://127.0.0.2/' : 'https://user:secret@127.0.0.1/';
    res.writeHead(302, {Location: location});
    return res.end();
  }
  res.end('<title>Proxmox Virtual Environment</title>');
});
server.listen(0, '127.0.0.1', () => console.log(server.address().port));
// A watchdog also bounds the fixture if its parent disappears.
setTimeout(() => process.exit(1), 30000).unref();
"#;
        let mut command = tokio::process::Command::new("node");
        command
            .args(["--input-type=module", "--eval", script])
            .current_dir(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.."))
            .stdout(std::process::Stdio::piped())
            .kill_on_drop(true);
        #[cfg(windows)]
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
        let mut child = command
            .spawn()
            .expect("Node is required for the TLS fixture");
        let mut lines = tokio::io::BufReader::new(child.stdout.take().unwrap()).lines();
        let port = timeout(Duration::from_secs(10), lines.next_line())
            .await
            .expect("TLS fixture startup deadline")
            .unwrap()
            .expect("Node/OpenSSL TLS fixture did not start")
            .parse()
            .unwrap();
        (child, lines, port)
    }

    #[tokio::test]
    async fn certificate_retry_follows_to_final_page_with_persisted_warning_and_no_secrets() {
        let (mut child, mut requests, port) = self_signed_server().await;
        let origin = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = origin.local_addr().unwrap();
        let server = tokio::spawn(async move {
            reply(
                &origin,
                301,
                Some(&format!("https://device.example.test:{port}/start")),
                "<title>301 Moved Permanently</title>",
            )
            .await;
        });
        let mut result = open_result(addr.port());
        identify_with_lookup(&mut result, "http", addr, Duration::from_secs(5), |_| {
            std::future::ready(Ok(vec![addr.ip()]))
        })
        .await;
        assert!(result.open);
        assert_eq!(result.port, addr.port());
        assert_eq!(result.http_status, Some(200));
        assert_eq!(result.http_redirects, Some(2));
        assert_eq!(
            result.http_title.as_deref(),
            Some("Proxmox Virtual Environment")
        );
        assert_eq!(result.http_server.as_deref(), Some("nginx"));
        assert_eq!(
            result.http_final_origin,
            Some(format!("https://device.example.test:{port}"))
        );
        assert_eq!(
            result.identification_error.as_deref(),
            Some(CERTIFICATE_WARNING)
        );
        let persisted = serde_json::to_value(&result).unwrap();
        assert_eq!(persisted["identification_error"], CERTIFICATE_WARNING);
        for path in ["/start", "/final"] {
            let line = timeout(Duration::from_secs(2), requests.next_line())
                .await
                .unwrap()
                .unwrap()
                .unwrap();
            let request: serde_json::Value = serde_json::from_str(&line).unwrap();
            assert_eq!(request["url"], path);
            assert_eq!(
                request["headers"]["host"],
                format!("device.example.test:{port}")
            );
            for header in [
                "authorization",
                "proxy-authorization",
                "cookie",
                "referer",
                "user-agent",
            ] {
                assert!(request["headers"].get(header).is_none(), "{header}");
            }
        }
        assert!(timeout(Duration::from_millis(100), requests.next_line())
            .await
            .is_err());
        server.await.unwrap();
        child.kill().await.unwrap();
    }

    #[tokio::test]
    async fn certificate_retry_retains_redirect_guards_and_shared_budgets() {
        let (mut child, mut requests, port) = self_signed_server().await;
        for (path, error, request_count) in [
            ("/loop", "redirect_loop", 1),
            ("/limit/0", "redirect_limit", 5),
            ("/body", "response_too_large", 1),
            ("/slow", "timeout", 1),
            ("/downgrade", "redirect_downgrade", 1),
            ("/escape", "redirect_out_of_scope", 1),
            ("/credentials", "redirect_credentials", 1),
        ] {
            let origin = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let addr = origin.local_addr().unwrap();
            let server = tokio::spawn(async move {
                reply(
                    &origin,
                    301,
                    Some(&format!("https://127.0.0.1:{port}{path}")),
                    "intermediate",
                )
                .await;
            });
            let mut result = open_result(addr.port());
            let budget = if path == "/slow" {
                Duration::from_millis(800)
            } else {
                Duration::from_secs(5)
            };
            let started = Instant::now();
            identify(&mut result, "http", addr, budget).await;
            assert_eq!(
                result.identification_error,
                Some(format!("{CERTIFICATE_WARNING};{error}")),
                "{path}"
            );
            assert!(result.open);
            assert!(started.elapsed() < budget + Duration::from_secs(1));
            assert_ne!(result.http_title.as_deref(), Some("Too late"));
            for _ in 0..request_count {
                assert!(timeout(Duration::from_secs(1), requests.next_line())
                    .await
                    .unwrap()
                    .unwrap()
                    .is_some());
            }
            assert!(timeout(Duration::from_millis(50), requests.next_line())
                .await
                .is_err());
            server.await.unwrap();
        }
        child.kill().await.unwrap();
    }

    #[test]
    fn certificate_classifier_rejects_generic_tls_and_connection_errors() {
        for text in [
            "TLS handshake failed",
            "certificate required",
            "connection refused",
            "received fatal alert: BadCertificate",
        ] {
            assert!(!certificate_validation_failed(&std::io::Error::other(text)));
        }
        assert!(certificate_validation_failed(&std::io::Error::other(
            "invalid peer certificate: UnknownIssuer"
        )));
    }

    #[test]
    fn optional_fields_preserve_legacy_json() {
        let value = serde_json::to_value(open_result(80)).unwrap();
        for key in [
            "http_server",
            "http_title",
            "http_status",
            "http_final_origin",
            "http_redirects",
            "protocol_confirmed",
            "protocol_evidence",
            "protocol_version",
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
                check_port("127.0.0.1".into(), port, None, Some(scheme.into()), None)
                    .await
                    .unwrap_err(),
                "invalid_identification_scheme"
            );
        }
        for protocol in ["", "ssh", "SMB", " postgres", "rdp://"] {
            assert_eq!(
                check_port("127.0.0.1".into(), port, None, None, Some(protocol.into()))
                    .await
                    .unwrap_err(),
                "invalid_identification_protocol"
            );
        }
        for protocol in ["smb", "rdp", "postgresql", "postgres"] {
            assert_eq!(
                check_port(
                    "127.0.0.1".into(),
                    port,
                    None,
                    Some("http".into()),
                    Some(protocol.into())
                )
                .await
                .unwrap_err(),
                "conflicting_identification_modes"
            );
            assert_eq!(
                check_port("localhost".into(), port, None, None, Some(protocol.into()))
                    .await
                    .unwrap_err(),
                "identification_requires_ip"
            );
        }
        for host in ["localhost", "user@127.0.0.1", "127.0.0.1/path", "[::1]"] {
            assert_eq!(
                check_port(host.into(), port, None, Some("http".into()), None)
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
    async fn active_http_does_not_wait_for_a_passive_banner() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            // Hold the initial connection open and silent. Active mode should
            // close it immediately, rather than waiting for the 2-second read.
            let (silent, _) = listener.accept().await.unwrap();
            let request = reply(&listener, 200, None, "<title>Prompt response</title>").await;
            assert!(request.starts_with("GET / HTTP/1.1"));
            drop(silent);
        });
        let result = timeout(
            Duration::from_millis(1500),
            check_port(
                "127.0.0.1".into(),
                addr.port(),
                Some(5),
                Some("http".into()),
                None,
            ),
        )
        .await
        .expect("active HTTP must skip the legacy passive wait")
        .unwrap();
        assert_eq!(result.http_title.as_deref(), Some("Prompt response"));
        assert!(result.banner.is_none());
        assert!(result.open);
        server.await.unwrap();
    }

    #[tokio::test]
    async fn active_protocol_delegates_without_waiting_for_a_passive_banner() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (silent, _) = listener.accept().await.unwrap();
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = [0u8; 19];
            stream.read_exact(&mut request).await.unwrap();
            assert_eq!(&request[..6], &[3, 0, 0, 19, 14, 0xe0]);
            // TPKT + X.224 confirm + RDP_NEG_RSP selecting TLS, no handshake.
            stream
                .write_all(&[3, 0, 0, 19, 14, 0xd0, 0, 0, 0, 0, 0, 2, 0, 8, 0, 1, 0, 0, 0])
                .await
                .unwrap();
            drop(silent);
        });
        let result = timeout(
            Duration::from_millis(1500),
            check_port(
                "127.0.0.1".into(),
                addr.port(),
                Some(5),
                None,
                Some("rdp".into()),
            ),
        )
        .await
        .expect("active protocol must skip the legacy passive wait")
        .unwrap();
        assert_eq!(result.protocol_confirmed.as_deref(), Some("rdp"));
        assert!(result.protocol_evidence.is_some());
        assert!(result.http_status.is_none());
        assert!(result.banner.is_none());
        assert!(result.open);
        assert_eq!(result.port, addr.port());
        server.await.unwrap();
    }

    #[tokio::test]
    async fn connector_never_resolves_unverified_names_or_returns_alternate_ips() {
        use reqwest::dns::Resolve;
        let names = Arc::new(Mutex::new(HashSet::new()));
        let resolver = PinnedDns {
            original: "127.0.0.1".parse().unwrap(),
            verified: names.clone(),
        };
        assert!(resolver
            .resolve("device.example.test".parse().unwrap())
            .await
            .is_err());
        names.lock().unwrap().insert("device.example.test".into());
        let addresses: Vec<_> = resolver
            .resolve("device.example.test".parse().unwrap())
            .await
            .unwrap()
            .collect();
        assert_eq!(addresses, ["127.0.0.1:0".parse::<SocketAddr>().unwrap()]);
        assert!(resolver
            .resolve("elsewhere.example.test".parse().unwrap())
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
        let result = check_port("127.0.0.1".into(), port, Some(1), None, None)
            .await
            .unwrap();
        assert!(result.open);
        assert_eq!(result.banner.as_deref(), Some("SSH-2.0-test"));
        assert!(result.http_status.is_none());
        server.await.unwrap();
    }

    #[tokio::test]
    async fn captures_success_and_denied_status_without_authentication_or_followup() {
        for status in [200, 401, 403] {
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
                None,
            )
            .await
            .unwrap();
            assert!(result.open);
            assert_eq!(result.http_status, Some(status));
            assert_eq!(result.http_server.as_deref(), Some("Appliance/1"));
            assert_eq!(result.http_title.as_deref(), Some("Device & Console"));
            assert_eq!(result.http_redirects, Some(0));
            assert!(result.identification_error.is_none());
            server.await.unwrap();
            assert!(timeout(Duration::from_millis(50), destination.accept())
                .await
                .is_err());
        }
    }

    async fn reply(
        listener: &TcpListener,
        status: u16,
        location: Option<&str>,
        body: &str,
    ) -> String {
        let (mut stream, _) = timeout(Duration::from_secs(3), listener.accept())
            .await
            .unwrap()
            .unwrap();
        let request = read_request(&mut stream).await;
        let location = location
            .map(|value| format!("Location: {value}\r\n"))
            .unwrap_or_default();
        let response = format!("HTTP/1.1 {status} Test\r\nServer: FinalDevice\r\n{location}Set-Cookie: auth=secret\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
        stream.write_all(response.as_bytes()).await.unwrap();
        request
    }

    #[test]
    fn redirect_policy_rejects_scope_escape_credentials_schemes_and_downgrades() {
        let ip = "127.0.0.1".parse().unwrap();
        let source = reqwest::Url::parse("http://127.0.0.1:8080/start").unwrap();
        for location in [
            "http://127.0.0.2/",
            "http://169.254.169.254/latest/meta-data/",
            "http://2852039166/",
            "http://[::1]/",
        ] {
            assert_eq!(
                redirect_url(&source, location, ip),
                Err("redirect_out_of_scope")
            );
        }
        for location in [
            "http://user:password@127.0.0.1/",
            "//user@127.0.0.1/",
            "http://@127.0.0.1/",
            "http://:secret@127.0.0.1/",
        ] {
            assert_eq!(
                redirect_url(&source, location, ip),
                Err("redirect_credentials")
            );
        }
        for location in [
            "file:///etc/passwd",
            "ftp://127.0.0.1/",
            "javascript:alert(1)",
            "data:text/html,test",
        ] {
            assert_eq!(redirect_url(&source, location, ip), Err("redirect_scheme"));
        }
        for location in [
            "/\r\nInjected: header",
            "http:\\evil.test",
            &"x".repeat(MAX_URL_BYTES + 1),
        ] {
            assert_eq!(redirect_url(&source, location, ip), Err("invalid_redirect"));
        }
        let secure = reqwest::Url::parse("https://127.0.0.1/").unwrap();
        assert_eq!(
            redirect_url(&secure, "http://127.0.0.1/", ip),
            Err("redirect_downgrade")
        );
        assert!(redirect_url(&source, "https://127.0.0.1/", ip).is_ok());
        let destination = redirect_url(&source, "../console?session=secret#fragment", ip).unwrap();
        assert_eq!(
            destination.as_str(),
            "http://127.0.0.1:8080/console?session=secret"
        );
        assert_eq!(display_origin(&destination), "http://127.0.0.1:8080");
    }

    #[tokio::test]
    async fn follows_five_relative_redirects_without_forwarding_cookies_or_credentials() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let locations = [
                "first".to_string(),
                "./second?session=secret#fragment".into(),
                "../third".into(),
                format!("//{addr}/fourth"),
                "/final?private=secret#fragment".into(),
            ];
            for (status, location) in [301, 302, 303, 307, 308].into_iter().zip(locations) {
                let request = reply(
                    &listener,
                    status,
                    Some(&location),
                    "<title>Intermediary</title>",
                )
                .await
                .to_ascii_lowercase();
                for forbidden in [
                    "authorization:",
                    "proxy-authorization:",
                    "cookie:",
                    "referer:",
                ] {
                    assert!(!request.contains(forbidden));
                }
            }
            let request = reply(&listener, 200, None, "<title>Actual service</title>").await;
            assert!(request.starts_with("GET /final?private=secret HTTP/1.1\r\n"));
            assert!(!request.to_ascii_lowercase().contains("cookie:"));
        });
        let mut result = open_result(addr.port());
        identify(&mut result, "http", addr, Duration::from_secs(5)).await;
        assert_eq!(result.http_status, Some(200));
        assert_eq!(result.http_title.as_deref(), Some("Actual service"));
        assert_eq!(result.http_final_origin, Some(format!("http://{addr}")));
        assert_eq!(result.http_redirects, Some(5));
        assert!(
            result.identification_error.is_none(),
            "{:?}",
            result.identification_error
        );
        server.await.unwrap();
    }

    #[tokio::test]
    async fn cross_port_hostname_redirect_is_pinned_after_one_verification() {
        let origin = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let destination = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let escape = TcpListener::bind("127.0.0.2:0").await.unwrap();
        let addr = origin.local_addr().unwrap();
        let port = destination.local_addr().unwrap().port();
        let server = tokio::spawn(async move {
            reply(
                &origin,
                302,
                Some(&format!("http://device.example.test:{port}/console")),
                "",
            )
            .await;
            let request = reply(&destination, 307, Some("/final?token=secret"), "").await;
            assert!(request
                .to_ascii_lowercase()
                .contains(&format!("host: device.example.test:{port}\r\n")));
            reply(
                &destination,
                200,
                None,
                "<title>Verified virtual host</title>",
            )
            .await;
        });
        let mut calls = 0;
        let mut result = open_result(addr.port());
        result.service = NetworkService::get_common_ports()
            .iter()
            .find(|(p, _)| *p == 80)
            .map(|(_, service)| service.clone());
        let original_service = serde_json::to_value(&result.service).unwrap();
        identify_with_lookup(&mut result, "http", addr, Duration::from_secs(5), |host| {
            assert_eq!(host, "device.example.test");
            calls += 1;
            assert_eq!(
                calls, 1,
                "never repeat DNS after verifying and pinning a host"
            );
            std::future::ready(Ok(vec!["127.0.0.2".parse().unwrap(), addr.ip()]))
        })
        .await;
        assert_eq!(calls, 1);
        assert_eq!(result.port, addr.port());
        assert_eq!(
            serde_json::to_value(&result.service).unwrap(),
            original_service
        );
        assert_eq!(result.http_redirects, Some(2));
        assert_eq!(result.http_title.as_deref(), Some("Verified virtual host"));
        assert_eq!(
            result.http_final_origin,
            Some(format!("http://device.example.test:{port}"))
        );
        assert!(
            result.identification_error.is_none(),
            "{:?}",
            result.identification_error
        );
        server.await.unwrap();
        assert!(timeout(Duration::from_millis(50), escape.accept())
            .await
            .is_err());
    }

    #[tokio::test]
    async fn rejected_hostname_and_literal_destinations_receive_no_connection() {
        for hostname in [false, true] {
            let origin = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let escape = TcpListener::bind("127.0.0.2:0").await.unwrap();
            let addr = origin.local_addr().unwrap();
            let escape_addr = escape.local_addr().unwrap();
            let server = tokio::spawn(async move {
                let host = if hostname {
                    "elsewhere.example.test"
                } else {
                    "127.0.0.2"
                };
                reply(
                    &origin,
                    302,
                    Some(&format!("http://{host}:{}/", escape_addr.port())),
                    "<title>Original</title>",
                )
                .await;
            });
            let mut result = open_result(addr.port());
            identify_with_lookup(&mut result, "http", addr, Duration::from_secs(2), |_| {
                assert!(hostname, "literal escapes must be rejected without DNS");
                std::future::ready(Ok(vec![escape_addr.ip()]))
            })
            .await;
            assert_eq!(
                result.identification_error.as_deref(),
                Some("redirect_out_of_scope")
            );
            assert_eq!(result.http_title.as_deref(), Some("Original"));
            assert_eq!(result.http_redirects, Some(0));
            server.await.unwrap();
            assert!(timeout(Duration::from_millis(50), escape.accept())
                .await
                .is_err());
        }
    }

    #[tokio::test]
    async fn loops_and_sixth_redirect_stop_without_extra_requests() {
        for looping in [true, false] {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let addr = listener.local_addr().unwrap();
            let server = tokio::spawn(async move {
                for hop in 0..if looping { 2 } else { 6 } {
                    let location = if looping && hop == 1 {
                        "/#same-request".into()
                    } else {
                        format!("/hop{}", hop + 1)
                    };
                    reply(&listener, 302, Some(&location), "").await;
                }
                assert!(timeout(Duration::from_millis(100), listener.accept())
                    .await
                    .is_err());
            });
            let mut result = open_result(addr.port());
            identify(&mut result, "http", addr, Duration::from_secs(5)).await;
            assert_eq!(
                result.identification_error.as_deref(),
                Some(if looping {
                    "redirect_loop"
                } else {
                    "redirect_limit"
                })
            );
            assert_eq!(result.http_redirects, Some(if looping { 1 } else { 5 }));
            server.await.unwrap();
        }
    }

    #[tokio::test]
    async fn redirect_bodies_share_one_byte_budget() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            reply(
                &listener,
                302,
                Some("/second"),
                &"x".repeat(MAX_BODY_BYTES / 2),
            )
            .await;
            let body = format!(
                "{}<title>Beyond shared budget</title>",
                "x".repeat(MAX_BODY_BYTES / 2)
            );
            reply(&listener, 302, Some("/never"), &body).await;
            assert!(timeout(Duration::from_millis(100), listener.accept())
                .await
                .is_err());
        });
        let mut result = open_result(addr.port());
        identify(&mut result, "http", addr, Duration::from_secs(3)).await;
        assert_eq!(
            result.identification_error.as_deref(),
            Some("response_too_large")
        );
        assert_eq!(result.http_redirects, Some(1));
        assert!(result.http_title.is_none());
        server.await.unwrap();
    }

    #[tokio::test]
    async fn redirect_chain_and_dns_share_original_deadline() {
        for slow_dns in [false, true] {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let addr = listener.local_addr().unwrap();
            let server = tokio::spawn(async move {
                if slow_dns {
                    reply(&listener, 302, Some("http://device.example.test/"), "").await;
                } else {
                    for hop in 0..5 {
                        tokio::time::sleep(Duration::from_millis(120)).await;
                        reply(
                            &listener,
                            if hop == 4 { 200 } else { 302 },
                            Some(&format!("/hop{hop}")),
                            "",
                        )
                        .await;
                    }
                }
            });
            let mut result = open_result(addr.port());
            let start = Instant::now();
            identify_with_lookup(
                &mut result,
                "http",
                addr,
                Duration::from_millis(300),
                |_| std::future::pending::<Result<Vec<IpAddr>, &'static str>>(),
            )
            .await;
            assert_eq!(result.identification_error.as_deref(), Some("timeout"));
            assert!(start.elapsed() < Duration::from_secs(2));
            assert!(result.http_redirects.unwrap_or(0) < 5);
            server.abort();
        }
    }

    #[tokio::test]
    async fn https_redirect_preserves_hostname_sni_and_never_retries_plaintext() {
        let origin = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let destination = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = origin.local_addr().unwrap();
        let port = destination.local_addr().unwrap().port();
        let server = tokio::spawn(async move {
            reply(
                &origin,
                302,
                Some(&format!("https://device.example.test:{port}/")),
                "<title>Original</title>",
            )
            .await;
            let (mut stream, _) = timeout(Duration::from_secs(3), destination.accept())
                .await
                .unwrap()
                .unwrap();
            let mut record = [0u8; 5];
            stream.read_exact(&mut record).await.unwrap();
            assert_eq!(record[0], 22);
            let mut hello = vec![0; u16::from_be_bytes([record[3], record[4]]) as usize];
            stream.read_exact(&mut hello).await.unwrap();
            assert!(hello
                .windows(b"device.example.test".len())
                .any(|bytes| bytes == b"device.example.test"));
            stream.write_all(b"HTTP/1.1 200 OK\r\n\r\n").await.unwrap();
            drop(stream);
            assert!(timeout(Duration::from_millis(100), destination.accept())
                .await
                .is_err());
        });
        let mut result = open_result(addr.port());
        identify_with_lookup(&mut result, "http", addr, Duration::from_secs(3), |_| {
            std::future::ready(Ok(vec![addr.ip()]))
        })
        .await;
        assert_eq!(
            result.identification_error.as_deref(),
            Some("tls_or_connection_failure")
        );
        assert_eq!(result.port, addr.port());
        assert_eq!(result.http_redirects, Some(0));
        assert_eq!(result.http_final_origin, Some(format!("http://{addr}")));
        assert_eq!(result.http_title.as_deref(), Some("Original"));
        server.await.unwrap();
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
            None,
        )
        .await
        .unwrap();
        assert!(result.open);
        assert_eq!(
            result.identification_error.as_deref(),
            Some("tls_or_connection_failure")
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
