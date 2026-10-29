//! Raw clients of the intercepting proxy, outside CEF.
//!
//! `timing` measures, per socket, proxy accept (TCP connect completed) to the
//! CEF-equivalent admission: CONNECT answered, TLS terminated with a leaf the
//! attempt CA minted, and `InterceptAuthority::admits_leaf` true for that exact
//! leaf. That is the proxy-side cost every CEF socket now pays; the CEF hook's
//! own decision time is measured separately in `lib.rs`.
//!
//! `denied` sends one GET to the self-signed origin and returns the response
//! head the proxy served (status and `x-sorng-upstream`).
use crate::Result;
use base64::Engine;
use sorng_protocols::private_forward_proxy::intercept::InterceptAuthority;
use std::{
    net::SocketAddr,
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
};

pub struct Credentials(String);

impl Credentials {
    pub fn new(user: &str, password: &str) -> Self {
        Self(base64::engine::general_purpose::STANDARD.encode(format!("{user}:{password}")))
    }
}

async fn read_head<S: tokio::io::AsyncRead + Unpin>(stream: &mut S) -> Result<String> {
    let mut head = Vec::new();
    let mut byte = [0u8; 1];
    while !head.ends_with(b"\r\n\r\n") {
        if head.len() > 16 * 1024 || stream.read(&mut byte).await? == 0 {
            return Err("truncated response head".into());
        }
        head.push(byte[0]);
    }
    Ok(String::from_utf8_lossy(&head).into_owned())
}

fn client_config(anchor: &[u8]) -> Result<Arc<rustls::ClientConfig>> {
    let mut roots = rustls::RootCertStore::empty();
    roots.add(rustls::pki_types::CertificateDer::from(anchor.to_vec()))?;
    let mut config = rustls::ClientConfig::builder()
        .with_root_certificates(roots)
        .with_no_client_auth();
    config.alpn_protocols = vec![b"h2".to_vec(), b"http/1.1".to_vec()];
    // CEF cannot resume either (patch 0001); every socket is a full handshake.
    config.resumption = rustls::client::Resumption::disabled();
    Ok(Arc::new(config))
}

async fn tunnel(
    proxy: SocketAddr,
    credentials: &Credentials,
    host: &str,
    anchor: &[u8],
) -> Result<(Instant, tokio_rustls::client::TlsStream<TcpStream>)> {
    let mut stream = TcpStream::connect(proxy).await?;
    stream.set_nodelay(true)?;
    let accepted = Instant::now();
    stream
        .write_all(
            format!(
                "CONNECT {host}:443 HTTP/1.1\r\nHost: {host}:443\r\nProxy-Authorization: Basic {}\r\n\r\n",
                credentials.0
            )
            .as_bytes(),
        )
        .await?;
    let head = read_head(&mut stream).await?;
    if !head.starts_with("HTTP/1.1 200") {
        return Err("proxy refused the CONNECT tunnel".into());
    }
    let name = rustls::pki_types::ServerName::try_from(host.to_owned())?;
    let tls = tokio_rustls::TlsConnector::from(client_config(anchor)?)
        .connect(name, stream)
        .await?;
    Ok((accepted, tls))
}

pub struct Timing {
    pub samples_us: Vec<u64>,
    pub admitted: usize,
    pub h2: usize,
    /// Distinct leaves the proxy presented (for the on-disk scan).
    pub leaves: Vec<Vec<u8>>,
}

/// `count` sockets after `warmup` unmeasured ones (leaf minting, caches).
pub async fn timing(
    proxy: SocketAddr,
    credentials: &Credentials,
    host: &str,
    authority: &InterceptAuthority,
    warmup: usize,
    count: usize,
) -> Result<Timing> {
    let mut result = Timing {
        samples_us: vec![],
        admitted: 0,
        h2: 0,
        leaves: vec![],
    };
    for index in 0..warmup + count {
        let (accepted, tls) = tokio::time::timeout(
            Duration::from_secs(10),
            tunnel(proxy, credentials, host, authority.anchor_der()),
        )
        .await??;
        let (_, connection) = tls.get_ref();
        let leaf = connection
            .peer_certificates()
            .and_then(|chain| chain.first())
            .map(|leaf| leaf.as_ref().to_vec())
            .unwrap_or_default();
        let admitted = authority.admits_leaf(host, 443, &leaf);
        let elapsed = accepted.elapsed();
        let h2 = connection.alpn_protocol() == Some(b"h2");
        drop(tls);
        if !leaf.is_empty() && !result.leaves.contains(&leaf) {
            result.leaves.push(leaf);
        }
        if index >= warmup {
            result.samples_us.push(elapsed.as_micros() as u64);
            result.admitted += usize::from(admitted);
            result.h2 += usize::from(h2);
        }
    }
    Ok(result)
}

pub struct Fetched {
    pub status: u16,
    pub upstream_tag: Option<String>,
    pub cache_control: Option<String>,
    pub leaf: Vec<u8>,
}

/// One HTTP/1.1 GET of `/` through an intercepted tunnel to `host`.
pub async fn denied(
    proxy: SocketAddr,
    credentials: &Credentials,
    host: &str,
    anchor: &[u8],
) -> Result<Fetched> {
    get(proxy, credentials, host, anchor, "/", "").await
}

/// One HTTP/1.1 GET through an intercepted tunnel; `extra` is raw header
/// lines (each ending in CRLF). Only the response head is read.
pub async fn get(
    proxy: SocketAddr,
    credentials: &Credentials,
    host: &str,
    anchor: &[u8],
    path: &str,
    extra: &str,
) -> Result<Fetched> {
    let mut config = (*client_config(anchor)?).clone();
    config.alpn_protocols = vec![b"http/1.1".to_vec()];
    let mut stream = TcpStream::connect(proxy).await?;
    stream
        .write_all(
            format!(
                "CONNECT {host}:443 HTTP/1.1\r\nHost: {host}:443\r\nProxy-Authorization: Basic {}\r\n\r\n",
                credentials.0
            )
            .as_bytes(),
        )
        .await?;
    if !read_head(&mut stream).await?.starts_with("HTTP/1.1 200") {
        return Err("proxy refused the CONNECT tunnel".into());
    }
    let name = rustls::pki_types::ServerName::try_from(host.to_owned())?;
    let mut tls = tokio_rustls::TlsConnector::from(Arc::new(config))
        .connect(name, stream)
        .await?;
    let leaf = tls
        .get_ref()
        .1
        .peer_certificates()
        .and_then(|chain| chain.first())
        .map(|leaf| leaf.as_ref().to_vec())
        .unwrap_or_default();
    tls.write_all(
        format!("GET {path} HTTP/1.1\r\nHost: {host}\r\n{extra}Connection: close\r\n\r\n")
            .as_bytes(),
    )
    .await?;
    let head = tokio::time::timeout(Duration::from_secs(30), read_head(&mut tls)).await??;
    // Drain the body so the proxy completes (and stores) the exchange.
    let mut sink = Vec::new();
    let _ = tokio::time::timeout(Duration::from_secs(10), tls.read_to_end(&mut sink)).await;
    let mut lines = head.lines();
    let status = lines
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|code| code.parse().ok())
        .unwrap_or(0);
    let mut upstream_tag = None;
    let mut cache_control = None;
    for line in lines {
        if let Some((name, value)) = line.split_once(':') {
            if name.eq_ignore_ascii_case("x-sorng-upstream") {
                upstream_tag = Some(value.trim().to_owned());
            } else if name.eq_ignore_ascii_case("cache-control") {
                cache_control = Some(value.trim().to_owned());
            }
        }
    }
    Ok(Fetched {
        status,
        upstream_tag,
        cache_control,
        leaf,
    })
}

/// Baseline for reading `timing`: the same client completing TLS directly
/// with the loopback upstream (no proxy). Interpretation only, never a gate.
pub async fn direct_baseline(
    upstream: SocketAddr,
    root: &[u8],
    host: &str,
    count: usize,
) -> Result<Vec<u64>> {
    let config = client_config(root)?;
    let mut samples = vec![];
    for _ in 0..count {
        let stream = TcpStream::connect(upstream).await?;
        stream.set_nodelay(true)?;
        let started = Instant::now();
        let name = rustls::pki_types::ServerName::try_from(host.to_owned())?;
        let tls = tokio::time::timeout(
            Duration::from_secs(10),
            tokio_rustls::TlsConnector::from(config.clone()).connect(name, stream),
        )
        .await??;
        samples.push(started.elapsed().as_micros() as u64);
        drop(tls);
    }
    Ok(samples)
}

/// Nearest-rank p95 in microseconds; `None` for no samples.
pub fn p95(samples: &[u64]) -> Option<u64> {
    if samples.is_empty() {
        return None;
    }
    let mut sorted = samples.to_vec();
    sorted.sort_unstable();
    let rank = (sorted.len() * 95).div_ceil(100).max(1);
    Some(sorted[rank - 1])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn p95_is_nearest_rank() {
        assert_eq!(p95(&[]), None);
        assert_eq!(p95(&[7]), Some(7));
        let samples: Vec<u64> = (1..=100).collect();
        assert_eq!(p95(&samples), Some(95));
        let samples: Vec<u64> = (1..=40).rev().collect();
        assert_eq!(p95(&samples), Some(38));
    }
}
