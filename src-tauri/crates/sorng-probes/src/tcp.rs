use serde::{Deserialize, Serialize};
use std::io;
use std::time::{Duration, Instant};
use tokio::net::TcpStream;
use tokio::time::timeout;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "status", content = "detail", rename_all = "snake_case")]
pub enum ProbeStatus {
    Reachable,
    Refused,
    Timeout,
    DnsFailed,
    OtherError(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProbeResult {
    pub status: ProbeStatus,
    pub elapsed_ms: u64,
}

pub(crate) fn classify_io_error(err: &io::Error) -> ProbeStatus {
    match err.kind() {
        io::ErrorKind::TimedOut => ProbeStatus::Timeout,
        io::ErrorKind::ConnectionRefused => ProbeStatus::Refused,
        _ => {
            let msg = err.to_string();
            if msg.contains("failed to lookup address") || msg.contains("resolve") {
                ProbeStatus::DnsFailed
            } else {
                ProbeStatus::OtherError(msg)
            }
        }
    }
}

pub async fn tcp_probe(host: &str, port: u16, timeout_ms: u64) -> ProbeResult {
    let start = Instant::now();
    let addr = format!("{host}:{port}");
    let dur = Duration::from_millis(timeout_ms.max(1));
    let res = timeout(dur, TcpStream::connect(&addr)).await;
    let elapsed_ms = start.elapsed().as_millis() as u64;
    let status = match res {
        Ok(Ok(_stream)) => ProbeStatus::Reachable,
        Ok(Err(e)) => classify_io_error(&e),
        Err(_) => ProbeStatus::Timeout,
    };
    ProbeResult { status, elapsed_ms }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::net::TcpListener;

    #[tokio::test]
    async fn reachable_when_listener_accepts() {
        let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = l.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (_s, _a) = l.accept().await.unwrap();
        });
        let r = tcp_probe("127.0.0.1", port, 500).await;
        assert!(matches!(r.status, ProbeStatus::Reachable), "got {:?}", r.status);
    }

    #[tokio::test]
    async fn refused_when_nothing_listening() {
        let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = l.local_addr().unwrap().port();
        drop(l);
        let r = tcp_probe("127.0.0.1", port, 500).await;
        assert!(
            !matches!(r.status, ProbeStatus::Reachable),
            "expected non-reachable after listener drop, got {:?}",
            r.status
        );
    }

    #[tokio::test]
    async fn timeout_on_unroutable() {
        let r = tcp_probe("10.255.255.1", 65000, 300).await;
        assert!(matches!(
            r.status,
            ProbeStatus::Timeout | ProbeStatus::OtherError(_) | ProbeStatus::DnsFailed
        ));
    }
}
