use crate::tcp::{classify_io_error, ProbeStatus};
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::time::timeout;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RdpProbeResult {
    pub status: ProbeStatus,
    pub reachable: bool,
    pub nla_required: Option<bool>,
    pub negotiated_protocol: Option<u32>,
    pub elapsed_ms: u64,
}

/// Build an X.224 Class 0 CR TPDU carrying an RDP_NEG_REQ.
/// requestedProtocols = 0x00000003 (PROTOCOL_SSL | PROTOCOL_HYBRID).
fn build_cr_tpdu() -> Vec<u8> {
    let neg = [
        0x01u8, 0x00, 0x08, 0x00, // type, flags, length=8
        0x03, 0x00, 0x00, 0x00, // requestedProtocols = SSL | HYBRID
    ];
    let tpdu_fixed = [0xE0u8, 0x00, 0x00, 0x00, 0x00, 0x00];
    let li: u8 = (tpdu_fixed.len() + neg.len()) as u8;
    let tpdu_len = 1 + tpdu_fixed.len() + neg.len();
    let total_len = 4 + tpdu_len;
    let mut buf = Vec::with_capacity(total_len);
    buf.push(0x03);
    buf.push(0x00);
    buf.extend_from_slice(&(total_len as u16).to_be_bytes());
    buf.push(li);
    buf.extend_from_slice(&tpdu_fixed);
    buf.extend_from_slice(&neg);
    buf
}

pub async fn rdp_probe(host: &str, port: u16, timeout_ms: u64) -> RdpProbeResult {
    let start = Instant::now();
    let dur = Duration::from_millis(timeout_ms.max(1));
    let deadline = tokio::time::Instant::now() + dur;

    let connect = timeout(dur, TcpStream::connect(format!("{host}:{port}"))).await;
    let mut stream = match connect {
        Ok(Ok(s)) => s,
        Ok(Err(e)) => {
            return RdpProbeResult {
                status: classify_io_error(&e),
                reachable: false,
                nla_required: None,
                negotiated_protocol: None,
                elapsed_ms: start.elapsed().as_millis() as u64,
            };
        }
        Err(_) => {
            return RdpProbeResult {
                status: ProbeStatus::Timeout,
                reachable: false,
                nla_required: None,
                negotiated_protocol: None,
                elapsed_ms: start.elapsed().as_millis() as u64,
            };
        }
    };

    let cr = build_cr_tpdu();
    let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
    if remaining.is_zero()
        || tokio::time::timeout(remaining, stream.write_all(&cr))
            .await
            .is_err()
    {
        return RdpProbeResult {
            status: ProbeStatus::Reachable,
            reachable: true,
            nla_required: None,
            negotiated_protocol: None,
            elapsed_ms: start.elapsed().as_millis() as u64,
        };
    }

    let mut buf = [0u8; 64];
    let mut len = 0usize;
    while len < buf.len() {
        let now = tokio::time::Instant::now();
        if now >= deadline {
            break;
        }
        let remaining = deadline - now;
        match tokio::time::timeout(remaining, stream.read(&mut buf[len..])).await {
            Ok(Ok(0)) => break,
            Ok(Ok(n)) => {
                len += n;
                if len >= 19 {
                    break;
                }
            }
            Ok(Err(_)) | Err(_) => break,
        }
    }

    let (nla_required, negotiated_protocol) = if len >= 19 && buf[11] == 0x02 {
        let sel = u32::from_le_bytes([buf[15], buf[16], buf[17], buf[18]]);
        let nla = (sel & 0x00000002) != 0;
        (Some(nla), Some(sel))
    } else {
        (None, None)
    };

    RdpProbeResult {
        status: ProbeStatus::Reachable,
        reachable: true,
        nla_required,
        negotiated_protocol,
        elapsed_ms: start.elapsed().as_millis() as u64,
    }
}

#[allow(dead_code)]
fn _duration_touch(_: Duration) {}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    #[tokio::test]
    async fn detects_nla_from_neg_rsp() {
        let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = l.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (mut s, _) = l.accept().await.unwrap();
            let mut throwaway = [0u8; 256];
            let _ = s.read(&mut throwaway).await;
            let mut out = Vec::new();
            let tpdu_fixed = [0xD0u8, 0x00, 0x00, 0x00, 0x00, 0x00];
            let neg_rsp = [0x02u8, 0x00, 0x08, 0x00, 0x02, 0x00, 0x00, 0x00];
            let li = (tpdu_fixed.len() + neg_rsp.len()) as u8;
            let tpdu_len = 1 + tpdu_fixed.len() + neg_rsp.len();
            let total = 4 + tpdu_len;
            out.push(0x03);
            out.push(0x00);
            out.extend_from_slice(&(total as u16).to_be_bytes());
            out.push(li);
            out.extend_from_slice(&tpdu_fixed);
            out.extend_from_slice(&neg_rsp);
            s.write_all(&out).await.ok();
        });
        let r = rdp_probe("127.0.0.1", port, 2000).await;
        assert!(matches!(r.status, ProbeStatus::Reachable), "got {:?}", r.status);
        assert_eq!(r.nla_required, Some(true));
        assert_eq!(r.negotiated_protocol, Some(0x02));
    }
}
