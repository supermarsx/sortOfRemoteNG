use super::Result;
use base64::Engine;
use sha2::Digest;
use std::{
    io::Write,
    net::SocketAddr,
    path::Path,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};

#[derive(Default)]
pub struct Observations {
    pub requests: usize,
    pub dials: Vec<String>,
    pub events: Vec<String>,
    pub features: Vec<String>,
    pub grants: Vec<String>,
    pub completed: Vec<String>,
    pub lifecycle: Vec<serde_json::Value>,
    proofs: Vec<serde_json::Value>,
    sni: Vec<String>,
    leaked_proxy_auth: bool,
    pub attempts: Vec<serde_json::Value>,
    pub network_policy_readback: Option<serde_json::Value>,
    trace: Vec<serde_json::Value>,
    trace_started: Option<Instant>,
    trace_dropped: usize,
    trace_journal: Option<std::fs::File>,
    trace_write_failed: bool,
    pub tls_accepted: usize,
    pub tls_completed: usize,
    pub tls_failed: usize,
}
impl Observations {
    fn with_journal(output: &Path) -> std::io::Result<Self> {
        Ok(Self {
            trace_journal: Some(
                std::fs::OpenOptions::new()
                    .create_new(true)
                    .append(true)
                    .open(output.join("native-trace.jsonl"))?,
            ),
            ..Self::default()
        })
    }
    // Only fixed event labels, booleans, counts and fixture-owned enum values.
    // Never pass header text, credentials, native error strings or full URLs.
    pub fn record(&mut self, phase: &'static str, detail: serde_json::Value) {
        if self.trace.len() == 256 {
            self.trace_dropped += 1;
            return;
        }
        let elapsed = self
            .trace_started
            .get_or_insert_with(Instant::now)
            .elapsed()
            .as_millis();
        let entry = serde_json::json!({"elapsedMs":elapsed,"phase":phase,"detail":detail});
        // Append-only, capped, and synchronized before returning to native code.
        // A crash may truncate the final line; previous complete lines survive.
        // This is diagnostic evidence only, never a substitute for the report.
        if let Some(journal) = &mut self.trace_journal {
            let result = (|| -> super::Result<()> {
                let mut bytes = serde_json::to_vec(&entry)?;
                bytes.push(b'\n');
                journal.write_all(&bytes)?;
                journal.sync_data()?;
                Ok(())
            })();
            self.trace_write_failed |= result.is_err();
        }
        self.trace.push(entry);
    }
}

#[cfg(test)]
mod tests {
    use super::Observations;
    #[test]
    fn native_trace_is_bounded_and_counts_drops() {
        let mut state = Observations::default();
        for _ in 0..300 {
            state.record("fixture-test", serde_json::json!({"ok":true}));
        }
        assert_eq!(state.trace.len(), 256);
        assert_eq!(state.trace_dropped, 44);
        assert!(state
            .trace
            .iter()
            .all(|entry| entry["phase"] == "fixture-test" && entry["elapsedMs"].is_u64()));
    }
    #[test]
    fn trace_checkpoint_is_readable_before_drop_and_never_overwrites() {
        let output = std::env::temp_dir().join(format!(
            "sorng-cef-trace-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&output).unwrap();
        let mut state = Observations::with_journal(&output).unwrap();
        for _ in 0..300 {
            state.record("native-navigation", serde_json::json!({"allowed":true}));
        }
        let path = output.join("native-trace.jsonl");
        let text = std::fs::read_to_string(&path).unwrap();
        assert_eq!(text.lines().count(), 256);
        assert!(text.lines().all(
            |line| serde_json::from_str::<serde_json::Value>(line).unwrap()["detail"]["allowed"]
                == true
        ));
        assert!(!state.trace_write_failed);
        assert!(Observations::with_journal(&output).is_err());
        drop(state);
        std::fs::remove_file(path).unwrap();
        std::fs::remove_dir(output).unwrap();
    }
}
pub struct Fixture {
    pub pin: String,
    pub address: SocketAddr,
    pub deny_proxy: SocketAddr,
    pub observations: Arc<Mutex<Observations>>,
    task: tokio::task::JoinHandle<()>,
    deny_task: tokio::task::JoinHandle<()>,
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.task.abort();
        self.deny_task.abort();
    }
}
impl Fixture {
    pub async fn start(output: &Path) -> Result<Self> {
        let observations = Arc::new(Mutex::new(Observations::with_journal(output)?));
        observations
            .lock()
            .unwrap()
            .record("fixture-start", serde_json::json!({}));
        // Extra test containment for Chromium's global/background profile. It
        // must not be mistaken for production per-context routing acceptance.
        let deny_listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).await?;
        let deny_proxy = deny_listener.local_addr()?;
        let deny_task = tokio::spawn(async move {
            while let Ok((mut stream, _)) = deny_listener.accept().await {
                tokio::spawn(async move {
                    let _ = tokio::time::timeout(Duration::from_secs(1), async move {
                        let mut bytes = [0; 4096]; let _ = stream.read(&mut bytes).await;
                        let _ = stream.write_all(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await;
                    }).await;
                });
            }
        });
        let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
        let certificate = rcgen::generate_simple_self_signed(vec![
            "fixture.test".into(),
            "frame.test".into(),
            "accounts.google.com".into(),
        ])?;
        let pin = base64::engine::general_purpose::STANDARD.encode(sha2::Sha256::digest(
            certificate.get_key_pair().public_key_der(),
        ));
        // Public certificate only. The private key never leaves process memory.
        std::fs::write(
            output.join("fixture-cert.pem"),
            certificate.serialize_pem()?,
        )?;
        let config = rustls::ServerConfig::builder()
            .with_no_client_auth()
            .with_single_cert(
                vec![rustls::pki_types::CertificateDer::from(
                    certificate.serialize_der()?,
                )],
                rustls::pki_types::PrivatePkcs8KeyDer::from(
                    certificate.serialize_private_key_der(),
                )
                .into(),
            )?;
        let acceptor = tokio_rustls::TlsAcceptor::from(Arc::new(config));
        let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).await?;
        let address = listener.local_addr()?;
        let state = observations.clone();
        let task = tokio::spawn(async move {
            while let Ok((stream, _)) = listener.accept().await {
                state.lock().unwrap().tls_accepted += 1;
                let acceptor = acceptor.clone();
                let state = state.clone();
                tokio::spawn(async move {
                    let final_state = state.clone();
                    let result = tokio::time::timeout(Duration::from_secs(5), async move {
                        let mut tls = match acceptor.accept(stream).await {
                            Ok(tls) => { state.lock().unwrap().tls_completed += 1; tls }
                            Err(error) => { state.lock().unwrap().tls_failed += 1; return Err(error); }
                        };
                        let sni = tls.get_ref().1.server_name().unwrap_or("").to_string();
                        let mut request = Vec::new(); let mut block = [0u8; 4096];
                        let (header_end, length) = loop {
                            let n = tls.read(&mut block).await?;
                            if n == 0 || request.len() + n > 32768 { return Err(std::io::Error::other("bounded request")); }
                            request.extend_from_slice(&block[..n]);
                            if let Some(end) = request.windows(4).position(|b| b == b"\r\n\r\n") {
                                let header = String::from_utf8_lossy(&request[..end]);
                                let length = header.lines().find_map(|l| l.to_lowercase().strip_prefix("content-length:").and_then(|v| v.trim().parse::<usize>().ok())).unwrap_or(0);
                                if length > 16384 { return Err(std::io::Error::other("bounded body")); }
                                break (end + 4, length);
                            }
                        };
                        while request.len() < header_end + length {
                            let n = tls.read(&mut block).await?; if n == 0 { return Err(std::io::Error::other("short body")); }
                            request.extend_from_slice(&block[..n]);
                        }
                        let header = String::from_utf8_lossy(&request[..header_end]);
                        let path = header.lines().next().and_then(|l| l.split_whitespace().nth(1)).unwrap_or("/");
                        let cookie = header.lines().find_map(|l| l.strip_prefix("Cookie: ").or_else(|| l.strip_prefix("cookie: "))).unwrap_or("");
                        let (body, extra) = {
                        let mut state = state.lock().unwrap();
                        state.requests += 1; state.sni.push(sni.clone());
                        state.record("http-request", serde_json::json!({"fixturePath":match path {
                            "/"=>"generic", "/frame"=>"frame", "/isolation"=>"isolation", "/proof"=>"proof", "/pulse"=>"pulse",
                            "/v3/signin/identifier"=>"google-identifier", _=>"other"
                        }}));
                        state.leaked_proxy_auth |= header.to_lowercase().contains("proxy-authorization:");
                        let mut extra = String::new();
                        let body = match path {
                            "/proof" => {
                                if let Ok(mut proof) = serde_json::from_slice::<serde_json::Value>(&request[header_end..header_end+length]) {
                                    proof["serverSni"] = sni.into();
                                    proof["nativeCookieSent"] = cookie.contains("native_fixture=one").into();
                                    if let Some(name) = proof["completed"].as_str() { state.completed.push(name.to_owned()); }
                                    state.proofs.push(proof);
                                }
                                "{}".to_string()
                            }
                            "/frame" => include_str!("../fixtures/frame.html").to_string(),
                            "/isolation" => include_str!("../fixtures/isolation.html").to_string(),
                            "/v3/signin/identifier" => include_str!("../fixtures/google.html").to_string(),
                            "/" => {
                                extra.push_str("Set-Cookie: native_fixture=one; Secure; HttpOnly; SameSite=Strict; Path=/\r\n");
                                include_str!("../fixtures/generic.html").to_string()
                            }
                            _ => "".to_string(),
                        };
                        (body, extra)
                        };
                        let response = format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nContent-Length: {}\r\nConnection: close\r\n{extra}\r\n{body}", body.len());
                        tls.write_all(response.as_bytes()).await?;
                        tls.shutdown().await?;
                        Ok::<(), std::io::Error>(())
                    }).await;
                    let outcome = match result {
                        Ok(Ok(())) => "completed",
                        Ok(Err(_)) => "io-or-tls-failure",
                        Err(_) => "deadline",
                    };
                    final_state
                        .lock()
                        .unwrap()
                        .record("fixture-connection", serde_json::json!({"outcome":outcome}));
                });
            }
        });
        Ok(Self {
            pin,
            address,
            deny_proxy,
            observations,
            task,
            deny_task,
        })
    }
    pub fn write_report(&self, output: &Path, failures: &[String]) -> Result<()> {
        self.write_snapshot(output, "native-report.json", failures)
    }
    pub fn write_progress(&self, output: &Path, failures: &[String]) -> Result<()> {
        self.write_snapshot(output, "native-progress.json", failures)
    }
    fn write_snapshot(&self, output: &Path, file: &str, failures: &[String]) -> Result<()> {
        let state = self.observations.lock().unwrap();
        std::fs::write(
            output.join(file),
            serde_json::to_vec_pretty(&serde_json::json!({
                "schema":1,"engine":"cef","bindingPin":"154.3.0","platform":std::env::consts::OS,
                "productionReady":false,"fixtureAddress":self.address.to_string(),"requests":state.requests,
                "networkPolicy":state.network_policy_readback,
                "extraTestContainment":{"initialFixtureRejectingProxy":self.deny_proxy.to_string(),"effectivePolicy":"production installs and verifies after fixture guard","dnsMapping":"production NATIVE_HOST_RESOLVER_RULES","productionContainmentProven":false},
                "routeDials":state.dials,"features":state.features,"grants":state.grants,"events":state.events,
                "attempts":state.attempts,"trace":state.trace,"traceDropped":state.trace_dropped,
                "traceWriteFailed":state.trace_write_failed,
                "tls":{"accepted":state.tls_accepted,"completed":state.tls_completed,"failed":state.tls_failed},
                "proofs":state.proofs,"lifecycle":state.lifecycle,"sni":state.sni,
                "proxyAuthorizationLeaked":state.leaked_proxy_auth,"failures":failures,
                "darkPaint":{"domStyleObserved":state.proofs.iter().any(|p| p.get("domBackground").is_some()),"nativePixelsCaptured":false,"firstPaint":"not-run"},
                "missingEvidence":["renderer-sandbox-token","native-first-paint","dns-and-socket-tripwires"]
            }))?,
        )?;
        Ok(())
    }
}
