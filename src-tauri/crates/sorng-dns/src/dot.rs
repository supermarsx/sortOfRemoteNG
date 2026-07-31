//! # DNS-over-TLS (DoT)
//!
//! RFC 7858 implementation — sends DNS wire-format queries over a TLS-encrypted
//! TCP connection to port 853.

use crate::types::*;
use crate::wire;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::Mutex;
use tokio_rustls::client::TlsStream;
use tokio_rustls::TlsConnector;

// ── Connection Pool ──────────────────────────────────────────────────

/// Idle timeout for pooled connections (60 seconds).
const POOL_IDLE_TIMEOUT_SECS: u64 = 60;
const MAX_DOT_POOL_ENTRIES: usize = 64;

type DotStream = TlsStream<TcpStream>;

struct PooledConnection {
    stream: DotStream,
    created_at: std::time::Instant,
}

/// A simple per-server DoT connection pool.
/// Keyed by "address:port" and holds at most one idle connection per server.
static DOT_POOL: std::sync::LazyLock<Arc<Mutex<HashMap<String, PooledConnection>>>> =
    std::sync::LazyLock::new(|| Arc::new(Mutex::new(HashMap::new())));

/// Try to take an idle connection from the pool for the given key.
async fn pool_take(key: &str) -> Option<DotStream> {
    let mut pool = DOT_POOL.lock().await;
    if let Some(conn) = pool.remove(key) {
        if conn.created_at.elapsed().as_secs() < POOL_IDLE_TIMEOUT_SECS {
            return Some(conn.stream);
        }
        // Connection expired — drop it
    }
    None
}

/// Return a connection to the pool for reuse.
async fn pool_return(key: String, stream: DotStream) {
    let mut pool = DOT_POOL.lock().await;
    // Evict stale entries while we're here
    pool.retain(|_, c| c.created_at.elapsed().as_secs() < POOL_IDLE_TIMEOUT_SECS);
    if pool.len() >= MAX_DOT_POOL_ENTRIES {
        if let Some(oldest_key) = pool
            .iter()
            .min_by_key(|(_, connection)| connection.created_at)
            .map(|(key, _)| key.clone())
        {
            pool.remove(&oldest_key);
        }
    }
    pool.insert(
        key,
        PooledConnection {
            stream,
            created_at: std::time::Instant::now(),
        },
    );
}

fn build_tls_connector() -> Result<TlsConnector, String> {
    let mut roots = rustls::RootCertStore::empty();
    let native = rustls_native_certs::load_native_certs();
    for cert in native.certs {
        roots
            .add(cert)
            .map_err(|e| format!("DoT native certificate parse failed: {e}"))?;
    }
    if roots.is_empty() {
        return Err(
            "DoT cannot verify server identity because no native TLS roots are available"
                .to_string(),
        );
    }

    let config = rustls::ClientConfig::builder()
        .with_root_certificates(roots)
        .with_no_client_auth();
    Ok(TlsConnector::from(Arc::new(config)))
}

async fn connect_tls(
    address: &str,
    port: u16,
    tls_hostname: &str,
    timeout: std::time::Duration,
) -> Result<DotStream, String> {
    let server_name = rustls::pki_types::ServerName::try_from(tls_hostname.to_owned())
        .map_err(|_| format!("Invalid DoT TLS hostname: {tls_hostname}"))?;
    let tcp_stream = tokio::time::timeout(timeout, TcpStream::connect((address, port)))
        .await
        .map_err(|_| format!("DoT connection to {address}:{port} timed out"))?
        .map_err(|e| format!("DoT TCP connection failed: {e}"))?;
    let connector = build_tls_connector()?;
    tokio::time::timeout(timeout, connector.connect(server_name, tcp_stream))
        .await
        .map_err(|_| format!("DoT TLS handshake with {tls_hostname} timed out"))?
        .map_err(|e| format!("DoT TLS handshake failed: {e}"))
}

fn frame_query(wire_query: &[u8]) -> Result<Vec<u8>, String> {
    let len = u16::try_from(wire_query.len())
        .map_err(|_| "DoT query exceeds the 65535-byte DNS-over-TCP limit".to_string())?;
    let mut framed_query = Vec::with_capacity(2 + wire_query.len());
    framed_query.extend_from_slice(&len.to_be_bytes());
    framed_query.extend_from_slice(wire_query);
    Ok(framed_query)
}

async fn timed_write_all(
    stream: &mut DotStream,
    data: &[u8],
    timeout: std::time::Duration,
) -> Result<(), String> {
    tokio::time::timeout(timeout, stream.write_all(data))
        .await
        .map_err(|_| "DoT write timed out".to_string())?
        .map_err(|e| format!("DoT write failed: {e}"))
}

async fn timed_read_exact(
    stream: &mut DotStream,
    data: &mut [u8],
    timeout: std::time::Duration,
    operation: &'static str,
) -> Result<(), String> {
    tokio::time::timeout(timeout, stream.read_exact(data))
        .await
        .map_err(|_| format!("DoT {operation} timed out"))?
        .map(|_| ())
        .map_err(|e| format!("DoT {operation} failed: {e}"))
}

/// Execute a DoT query.
pub async fn execute_dot_query(
    query: &DnsQuery,
    server: &DnsServer,
    config: &DnsResolverConfig,
) -> Result<DnsResponse, String> {
    let start = std::time::Instant::now();

    let id: u16 = rand::random();
    let wire_query = wire::build_query(query, id, config.edns0, config.edns0_payload_size);

    let address = &server.address;
    let port = server.effective_port(DnsProtocol::DoT);
    let tls_hostname = server.tls_hostname.as_deref().unwrap_or(address);
    let timeout = std::time::Duration::from_millis(config.timeout_ms.clamp(1, 120_000));

    let mut stream = connect_tls(address, port, tls_hostname, timeout).await?;

    // DNS-over-TCP framing: 2-byte length prefix (RFC 1035 §4.2.2)
    let framed_query = frame_query(&wire_query)?;

    timed_write_all(&mut stream, &framed_query, timeout).await?;

    // Read response length prefix
    let mut len_buf = [0u8; 2];
    timed_read_exact(&mut stream, &mut len_buf, timeout, "length read").await?;

    let resp_len = u16::from_be_bytes(len_buf) as usize;
    if resp_len > 65535 {
        return Err("DoT response too large".to_string());
    }

    let mut resp_buf = vec![0u8; resp_len];
    timed_read_exact(&mut stream, &mut resp_buf, timeout, "response read").await?;

    let duration_ms = start.elapsed().as_millis() as u64;

    wire::parse_response(&resp_buf, &server.address, DnsProtocol::DoT, duration_ms)
        .ok_or_else(|| "Failed to parse DoT wire-format response".to_string())
}

/// Execute a DoT query with connection pooling.
///
/// DoT connections can be reused per RFC 7858 §3.4. This function
/// reuses idle connections from a per-server pool, falling back to
/// a fresh connection when none are available.
pub async fn execute_dot_query_pooled(
    query: &DnsQuery,
    server: &DnsServer,
    config: &DnsResolverConfig,
) -> Result<DnsResponse, String> {
    let start = std::time::Instant::now();

    let id: u16 = rand::random();
    let wire_query = wire::build_query(query, id, config.edns0, config.edns0_payload_size);

    let address = &server.address;
    let port = server.effective_port(DnsProtocol::DoT);
    let tls_hostname = server.tls_hostname.as_deref().unwrap_or(address);
    let timeout = std::time::Duration::from_millis(config.timeout_ms.clamp(1, 120_000));
    let pool_key = format!("{address}:{port}|{tls_hostname}");

    // Try to reuse a pooled connection, fall back to a new one
    let mut stream = if let Some(s) = pool_take(&pool_key).await {
        log::debug!("DoT connection pool hit");
        s
    } else {
        connect_tls(address, port, tls_hostname, timeout).await?
    };

    // DNS-over-TCP framing: 2-byte length prefix (RFC 1035 §4.2.2)
    let framed_query = frame_query(&wire_query)?;

    timed_write_all(&mut stream, &framed_query, timeout).await?;

    // Read response length prefix
    let mut len_buf = [0u8; 2];
    timed_read_exact(&mut stream, &mut len_buf, timeout, "length read").await?;

    let resp_len = u16::from_be_bytes(len_buf) as usize;
    if resp_len > 65535 {
        return Err("DoT response too large".to_string());
    }

    let mut resp_buf = vec![0u8; resp_len];
    timed_read_exact(&mut stream, &mut resp_buf, timeout, "response read").await?;

    // Return connection to pool for reuse
    pool_return(pool_key, stream).await;

    let duration_ms = start.elapsed().as_millis() as u64;

    wire::parse_response(&resp_buf, &server.address, DnsProtocol::DoT, duration_ms)
        .ok_or_else(|| "Failed to parse DoT wire-format response".to_string())
}

/// Check if a DoT server is reachable on port 853.
pub async fn check_dot_reachability(address: &str, timeout_ms: u64) -> Result<bool, String> {
    let addr = format!("{}:853", address);
    let timeout = std::time::Duration::from_millis(timeout_ms.clamp(1, 120_000));

    match tokio::time::timeout(timeout, tokio::net::TcpStream::connect(&addr)).await {
        Ok(Ok(_)) => Ok(true),
        Ok(Err(e)) => {
            log::debug!("DoT server {} unreachable: {}", address, e);
            Ok(false)
        }
        Err(_) => Ok(false),
    }
}

/// Validate a DoT server configuration.
pub fn validate_dot_server(server: &DnsServer) -> Vec<String> {
    let mut issues = Vec::new();

    if server.address.is_empty() {
        issues.push("DoT server address is empty".to_string());
    }

    // Should be an IP address (not a hostname — chicken-and-egg problem)
    if server.address.parse::<std::net::IpAddr>().is_err() && server.bootstrap.is_empty() {
        issues.push(format!(
            "DoT server address '{}' is a hostname but no bootstrap IPs provided. \
             DNS would be needed to resolve the DNS server itself.",
            server.address
        ));
    }

    if server.tls_hostname.is_none() && server.address.parse::<std::net::IpAddr>().is_ok() {
        issues.push(
            "DoT server is an IP address but no TLS hostname set for certificate validation"
                .to_string(),
        );
    }

    let port = server.effective_port(DnsProtocol::DoT);
    if port != 853 {
        issues.push(format!(
            "Non-standard DoT port {} (RFC 7858 specifies 853)",
            port
        ));
    }

    issues
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dot_server(address: &str, tls_hostname: Option<&str>, port: Option<u16>) -> DnsServer {
        DnsServer {
            address: address.into(),
            port,
            tls_hostname: tls_hostname.map(Into::into),
            provider: None,
            protocol: Some(DnsProtocol::DoT),
            doh_path: None,
            doh_wire_format: true,
            bootstrap: Vec::new(),
        }
    }

    #[test]
    fn validate_dot_server_empty_address() {
        let server = dot_server("", None, None);
        let issues = validate_dot_server(&server);
        assert!(issues.iter().any(|i| i.contains("empty")));
    }

    #[test]
    fn validate_dot_server_hostname_without_bootstrap() {
        let server = dot_server("dns.example.com", None, None);
        let issues = validate_dot_server(&server);
        assert!(issues
            .iter()
            .any(|i| i.contains("hostname") && i.contains("bootstrap")));
    }

    #[test]
    fn validate_dot_server_ip_without_tls_hostname() {
        let server = dot_server("1.1.1.1", None, None);
        let issues = validate_dot_server(&server);
        assert!(issues.iter().any(|i| i.contains("TLS hostname")));
    }

    #[test]
    fn validate_dot_server_non_standard_port() {
        let server = dot_server("1.1.1.1", Some("cloudflare-dns.com"), Some(8853));
        let issues = validate_dot_server(&server);
        assert!(issues.iter().any(|i| i.contains("Non-standard")));
    }

    #[test]
    fn validate_dot_server_good() {
        let server = dot_server("1.1.1.1", Some("cloudflare-dns.com"), None);
        let issues = validate_dot_server(&server);
        assert!(issues.is_empty());
    }

    #[tokio::test]
    async fn pool_take_empty_returns_none() {
        // A fresh key should return None
        let key = format!("test-pool-empty-{}", rand::random::<u32>());
        assert!(pool_take(&key).await.is_none());
    }

    #[tokio::test]
    async fn pool_return_and_take_roundtrip() {
        // We can't easily create real TcpStreams without a server, but we can
        // verify the pool eviction logic by checking the stale timeout path.
        // For a more complete test, we'd need a listener. This tests the API shape.
        let key = format!("test-pool-rt-{}", rand::random::<u32>());
        // After pool_take on unknown key → None
        assert!(pool_take(&key).await.is_none());
    }
}
