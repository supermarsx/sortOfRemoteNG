use crate::tcp::{classify_io_error, ProbeStatus};
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};
use tokio::io::AsyncReadExt;
use tokio::net::TcpStream;
use tokio::time::timeout;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshProbeResult {
    pub status: ProbeStatus,
    pub banner: Option<String>,
    pub elapsed_ms: u64,
}

pub async fn ssh_probe(host: &str, port: u16, timeout_ms: u64) -> SshProbeResult {
    let start = Instant::now();
    let dur = Duration::from_millis(timeout_ms.max(1));
    let deadline = tokio::time::Instant::now() + dur;

    let connect = timeout(dur, TcpStream::connect(format!("{host}:{port}"))).await;
    let mut stream = match connect {
        Ok(Ok(s)) => s,
        Ok(Err(e)) => {
            return SshProbeResult {
                status: classify_io_error(&e),
                banner: None,
                elapsed_ms: start.elapsed().as_millis() as u64,
            };
        }
        Err(_) => {
            return SshProbeResult {
                status: ProbeStatus::Timeout,
                banner: None,
                elapsed_ms: start.elapsed().as_millis() as u64,
            };
        }
    };

    let mut buf = [0u8; 255];
    let mut len = 0usize;
    loop {
        if len >= buf.len() {
            break;
        }
        let now = tokio::time::Instant::now();
        if now >= deadline {
            break;
        }
        let remaining = deadline - now;
        match tokio::time::timeout(remaining, stream.read(&mut buf[len..])).await {
            Ok(Ok(0)) => break,
            Ok(Ok(n)) => {
                len += n;
                if buf[..len].contains(&b'\n') {
                    break;
                }
            }
            Ok(Err(_)) | Err(_) => break,
        }
    }
    let raw = String::from_utf8_lossy(&buf[..len])
        .trim_end_matches(['\r', '\n'])
        .to_string();
    let banner = if raw.starts_with("SSH-") { Some(raw) } else { None };
    SshProbeResult {
        status: ProbeStatus::Reachable,
        banner,
        elapsed_ms: start.elapsed().as_millis() as u64,
    }
}

// Silence unused-import warning for Duration under some feature gates.
#[allow(dead_code)]
fn _duration_touch(_: Duration) {}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::AsyncWriteExt;
    use tokio::net::TcpListener;

    #[tokio::test]
    async fn captures_ssh_banner() {
        let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = l.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (mut s, _) = l.accept().await.unwrap();
            s.write_all(b"SSH-2.0-OpenSSH_9.0\r\n").await.ok();
        });
        let r = ssh_probe("127.0.0.1", port, 1000).await;
        assert!(matches!(r.status, ProbeStatus::Reachable));
        assert_eq!(r.banner.as_deref(), Some("SSH-2.0-OpenSSH_9.0"));
    }
}
