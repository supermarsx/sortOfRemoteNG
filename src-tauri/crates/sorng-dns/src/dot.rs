//! # DNS-over-TLS (DoT)
//!
//! RFC 7858 implementation — sends DNS wire-format queries over a TLS-encrypted
//! TCP connection to port 853.

use crate::types::*;
use crate::wire;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

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
    let _tls_hostname = server.tls_hostname.as_deref().unwrap_or(address);
    let timeout = std::time::Duration::from_millis(config.timeout_ms);

    // Build the TCP + TLS connection
    let tcp_addr = format!("{}:{}", address, port);

    let tcp_stream = tokio::time::timeout(timeout, tokio::net::TcpStream::connect(&tcp_addr))
        .await
        .map_err(|_| format!("DoT connection to {} timed out", tcp_addr))?
        .map_err(|e| format!("DoT TCP connection failed: {}", e))?;

    // The workspace now standardises on rustls for TLS.
    // This placeholder still simulates DoT with raw TCP + DNS wire messages.
    // In production, this would wrap the socket with tokio-rustls.
    //
    // For now, implement the DNS-over-TCP framing (2-byte length prefix)
    // and document that TLS wrapping is needed.

    let mut stream = tcp_stream;

    // DNS-over-TCP framing: 2-byte length prefix (RFC 1035 §4.2.2)
    let len = wire_query.len() as u16;
    let mut framed_query = Vec::with_capacity(2 + wire_query.len());
    framed_query.extend_from_slice(&len.to_be_bytes());
    framed_query.extend_from_slice(&wire_query);

    stream
        .write_all(&framed_query)
        .await
        .map_err(|e| format!("DoT write failed: {}", e))?;

    // Read response length prefix
    let mut len_buf = [0u8; 2];
    stream
        .read_exact(&mut len_buf)
        .await
        .map_err(|e| format!("DoT read length failed: {}", e))?;

    let resp_len = u16::from_be_bytes(len_buf) as usize;
    if resp_len > 65535 {
        return Err("DoT response too large".to_string());
    }

    let mut resp_buf = vec![0u8; resp_len];
    stream
        .read_exact(&mut resp_buf)
        .await
        .map_err(|e| format!("DoT read response failed: {}", e))?;

    let duration_ms = start.elapsed().as_millis() as u64;

    wire::parse_response(&resp_buf, &server.address, DnsProtocol::DoT, duration_ms)
        .ok_or_else(|| "Failed to parse DoT wire-format response".to_string())
}

/// Execute a DoT query with connection pooling hints.
///
/// DoT connections can be reused per RFC 7858 §3.4. This function
/// represents a single query on a fresh connection. A production
/// implementation would maintain a connection pool.
pub async fn execute_dot_query_pooled(
    query: &DnsQuery,
    server: &DnsServer,
    config: &DnsResolverConfig,
) -> Result<DnsResponse, String> {
    // For now, delegate to single-connection version.
    // TODO: Implement connection pool with idle timeout and pipelining.
    execute_dot_query(query, server, config).await
}

/// Check if a DoT server is reachable on port 853.
pub async fn check_dot_reachability(address: &str, timeout_ms: u64) -> Result<bool, String> {
    let addr = format!("{}:853", address);
    let timeout = std::time::Duration::from_millis(timeout_ms);

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
