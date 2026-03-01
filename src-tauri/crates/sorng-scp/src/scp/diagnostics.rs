// ── Diagnostics – connection testing and bandwidth estimation ────────────────

use crate::scp::service::ScpService;
use crate::scp::types::*;
use ssh2::Session;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Instant;

impl ScpService {
    /// Run a comprehensive diagnostic on an SCP session.
    pub async fn diagnose(&mut self, session_id: &str) -> Result<ScpDiagnosticResult, String> {
        let handle = self
            .sessions
            .get(session_id)
            .ok_or_else(|| format!("Session '{}' not found", session_id))?;

        let info = &handle.info;
        let session = &handle.session;

        // Gather negotiated algorithms
        let negotiated_kex = session
            .methods(ssh2::MethodType::Kex)
            .map(|s| s.to_string());
        let negotiated_cipher = session
            .methods(ssh2::MethodType::CryptCs)
            .map(|s| s.to_string());
        let negotiated_mac = session
            .methods(ssh2::MethodType::MacCs)
            .map(|s| s.to_string());
        let negotiated_host_key = session
            .methods(ssh2::MethodType::HostKey)
            .map(|s| s.to_string());

        let mut warnings = Vec::new();

        // Check for weak algorithms
        if let Some(ref cipher) = negotiated_cipher {
            if cipher.contains("arcfour") || cipher.contains("des") || cipher.contains("3des") {
                warnings.push(format!("Weak cipher in use: {}", cipher));
            }
        }
        if let Some(ref mac) = negotiated_mac {
            if mac.contains("md5") || mac.contains("sha1") && !mac.contains("sha1-etm") {
                warnings.push(format!("Weak MAC in use: {}", mac));
            }
        }

        // Try bandwidth estimation
        let bandwidth = self.estimate_bandwidth(session_id).await.ok();

        Ok(ScpDiagnosticResult {
            session_id: session_id.to_string(),
            host: info.host.clone(),
            port: info.port,
            tcp_connect_ms: 0.0, // Already connected
            ssh_handshake_ms: 0.0,
            auth_ms: 0.0,
            total_connect_ms: 0.0,
            server_banner: info.server_banner.clone(),
            server_fingerprint: info.server_fingerprint.clone(),
            negotiated_kex,
            negotiated_cipher,
            negotiated_mac,
            negotiated_host_key,
            auth_methods: Vec::new(),
            compression_enabled: false,
            bandwidth_estimate: bandwidth,
            warnings,
        })
    }

    /// Run diagnostics by connecting freshly (gives TCP/handshake/auth timing).
    pub async fn diagnose_connection(
        &self,
        config: ScpConnectionConfig,
    ) -> Result<ScpDiagnosticResult, String> {
        let addr = format!("{}:{}", config.host, config.port);
        let mut warnings = Vec::new();

        // ── TCP connect timing ───────────────────────────────────────────────
        let tcp_start = Instant::now();
        let tcp = TcpStream::connect_timeout(
            &addr
                .parse()
                .map_err(|e| format!("Invalid address '{}': {}", addr, e))?,
            std::time::Duration::from_secs(config.timeout_secs),
        )
        .map_err(|e| format!("TCP connection to {} failed: {}", addr, e))?;
        let tcp_ms = tcp_start.elapsed().as_secs_f64() * 1000.0;

        tcp.set_nonblocking(false).ok();

        // ── SSH handshake timing ─────────────────────────────────────────────
        let handshake_start = Instant::now();
        let mut session =
            Session::new().map_err(|e| format!("Session creation failed: {}", e))?;

        if config.compress {
            session.set_compress(true);
        }

        session.set_tcp_stream(tcp.try_clone().map_err(|e| e.to_string())?);
        session
            .handshake()
            .map_err(|e| format!("Handshake failed: {}", e))?;
        let handshake_ms = handshake_start.elapsed().as_secs_f64() * 1000.0;

        let banner = session.banner().map(|b| b.to_string());
        let fingerprint = session
            .host_key_hash(ssh2::HashType::Sha256)
            .map(|bytes| {
                let encoded = base64::Engine::encode(
                    &base64::engine::general_purpose::STANDARD,
                    bytes,
                );
                format!("SHA256:{}", encoded)
            });

        // List available auth methods
        let auth_methods_str = session
            .auth_methods(&config.username)
            .unwrap_or("");
        let auth_methods: Vec<String> = auth_methods_str
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();

        // ── Authentication timing ────────────────────────────────────────────
        let auth_start = Instant::now();
        let _auth_method = self.authenticate(&mut session, &config);
        let auth_ms = auth_start.elapsed().as_secs_f64() * 1000.0;

        // Negotiated algorithms
        let negotiated_kex = session.methods(ssh2::MethodType::Kex).map(|s| s.to_string());
        let negotiated_cipher = session.methods(ssh2::MethodType::CryptCs).map(|s| s.to_string());
        let negotiated_mac = session.methods(ssh2::MethodType::MacCs).map(|s| s.to_string());
        let negotiated_host_key = session.methods(ssh2::MethodType::HostKey).map(|s| s.to_string());

        // Weak algorithm warnings
        if let Some(ref cipher) = negotiated_cipher {
            if cipher.contains("arcfour") || cipher.contains("des") {
                warnings.push(format!("Weak cipher: {}", cipher));
            }
        }

        let total_ms = tcp_ms + handshake_ms + auth_ms;

        // Clean up
        let _ = session.disconnect(None, "diagnostic complete", None);

        Ok(ScpDiagnosticResult {
            session_id: String::new(),
            host: config.host,
            port: config.port,
            tcp_connect_ms: tcp_ms,
            ssh_handshake_ms: handshake_ms,
            auth_ms,
            total_connect_ms: total_ms,
            server_banner: banner,
            server_fingerprint: fingerprint,
            negotiated_kex,
            negotiated_cipher,
            negotiated_mac,
            negotiated_host_key,
            auth_methods,
            compression_enabled: config.compress,
            bandwidth_estimate: None,
            warnings,
        })
    }

    /// Estimate bandwidth by transferring a small test payload via exec.
    async fn estimate_bandwidth(
        &self,
        session_id: &str,
    ) -> Result<ScpBandwidthEstimate, String> {
        let session = self.get_session(session_id)?;
        let test_size: u64 = 65536; // 64 KiB for quick test

        // Generate random test data
        let test_data: Vec<u8> = (0..test_size).map(|i| (i % 256) as u8).collect();

        // ── Latency measurement ──────────────────────────────────────────────
        let lat_start = Instant::now();
        let mut channel = session
            .channel_session()
            .map_err(|e| format!("Channel error: {}", e))?;
        channel.exec("echo ok").map_err(|e| format!("Exec error: {}", e))?;
        let mut out = String::new();
        channel.read_to_string(&mut out).ok();
        channel.wait_close().ok();
        let latency_ms = lat_start.elapsed().as_secs_f64() * 1000.0;

        // ── Upload bandwidth ─────────────────────────────────────────────────
        // Write to /dev/null via cat
        let up_start = Instant::now();
        let mut channel = session
            .channel_session()
            .map_err(|e| format!("Channel error: {}", e))?;
        channel
            .exec("cat > /dev/null")
            .map_err(|e| format!("Exec error: {}", e))?;
        channel.write_all(&test_data).map_err(|e| format!("Write error: {}", e))?;
        channel.send_eof().ok();
        channel.wait_eof().ok();
        channel.close().ok();
        channel.wait_close().ok();
        let upload_ms = up_start.elapsed().as_secs_f64() * 1000.0;
        let upload_bps = if upload_ms > 0.0 {
            test_size as f64 / (upload_ms / 1000.0)
        } else {
            0.0
        };

        // ── Download bandwidth ───────────────────────────────────────────────
        // Read from /dev/urandom
        let down_start = Instant::now();
        let mut channel = session
            .channel_session()
            .map_err(|e| format!("Channel error: {}", e))?;
        channel
            .exec(&format!("head -c {} /dev/urandom", test_size))
            .map_err(|e| format!("Exec error: {}", e))?;
        let mut buf = vec![0u8; test_size as usize];
        let mut total_read = 0usize;
        loop {
            let n = channel.read(&mut buf[total_read..]).unwrap_or(0);
            if n == 0 {
                break;
            }
            total_read += n;
            if total_read >= test_size as usize {
                break;
            }
        }
        channel.wait_close().ok();
        let download_ms = down_start.elapsed().as_secs_f64() * 1000.0;
        let download_bps = if download_ms > 0.0 {
            total_read as f64 / (download_ms / 1000.0)
        } else {
            0.0
        };

        Ok(ScpBandwidthEstimate {
            upload_bytes_per_sec: upload_bps,
            download_bytes_per_sec: download_bps,
            test_size_bytes: test_size,
            upload_duration_ms: upload_ms,
            download_duration_ms: download_ms,
            latency_ms,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_diagnostic_result_serialization() {
        let result = ScpDiagnosticResult {
            session_id: "test-id".to_string(),
            host: "example.com".to_string(),
            port: 22,
            tcp_connect_ms: 15.5,
            ssh_handshake_ms: 42.3,
            auth_ms: 8.1,
            total_connect_ms: 65.9,
            server_banner: Some("SSH-2.0-OpenSSH_8.9".to_string()),
            server_fingerprint: Some("SHA256:abc123".to_string()),
            negotiated_kex: Some("curve25519-sha256".to_string()),
            negotiated_cipher: Some("aes256-gcm@openssh.com".to_string()),
            negotiated_mac: Some("hmac-sha2-256-etm@openssh.com".to_string()),
            negotiated_host_key: Some("ssh-ed25519".to_string()),
            auth_methods: vec!["publickey".to_string(), "password".to_string()],
            compression_enabled: false,
            bandwidth_estimate: None,
            warnings: Vec::new(),
        };

        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("tcpConnectMs"));
        assert!(json.contains("sshHandshakeMs"));
        assert!(json.contains("negotiatedKex"));
    }

    #[test]
    fn test_bandwidth_estimate_serialization() {
        let est = ScpBandwidthEstimate {
            upload_bytes_per_sec: 10_000_000.0,
            download_bytes_per_sec: 15_000_000.0,
            test_size_bytes: 65536,
            upload_duration_ms: 6.5,
            download_duration_ms: 4.3,
            latency_ms: 1.2,
        };

        let json = serde_json::to_string(&est).unwrap();
        let parsed: ScpBandwidthEstimate = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.test_size_bytes, 65536);
        assert!(parsed.upload_bytes_per_sec > 0.0);
    }
}
