//! # Challenge Solvers
//!
//! Implementations of ACME challenge handlers for HTTP-01, DNS-01, and
//! TLS-ALPN-01 validation methods.  Each solver is responsible for
//! provisioning the challenge response and cleaning up after validation.

use crate::acme::{dns01_txt_value, http01_response};
use crate::dns_providers::{dns01_record_name, DnsProviderManager};
use crate::types::*;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::{oneshot, Mutex};
use tokio::task::JoinHandle;

// ── Challenge Solver Trait ──────────────────────────────────────────

/// Result from a challenge solve operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChallengeSolveResult {
    /// Whether the challenge response was provisioned successfully.
    pub provisioned: bool,
    /// Human-readable details.
    pub message: String,
    /// When the response was provisioned.
    pub provisioned_at: Option<chrono::DateTime<Utc>>,
}

// ── HTTP-01 Solver ──────────────────────────────────────────────────

/// HTTP-01 challenge solver.
///
/// Three modes of operation:
/// 1. **Standalone** — Starts a minimal HTTP server on port 80
/// 2. **Webroot** — Writes challenge files into a directory served by an
///    external web server (nginx, Apache, etc.)
/// 3. **Gateway Proxy** — Registers the token/response so the gateway's
///    HTTP listener can serve it inline
pub struct Http01Solver {
    /// Active challenge tokens → key authorization responses.
    tokens: Arc<Mutex<HashMap<String, String>>>,
    /// HTTP challenge configuration.
    config: HttpChallengeConfig,
    /// Whether the standalone server is running.
    server_running: bool,
    /// Shutdown signal for the standalone server.
    shutdown_tx: Option<oneshot::Sender<()>>,
    /// Background task serving standalone HTTP-01 responses.
    server_task: Option<JoinHandle<()>>,
}

impl Http01Solver {
    pub fn new(config: HttpChallengeConfig) -> Self {
        Self {
            tokens: Arc::new(Mutex::new(HashMap::new())),
            config,
            server_running: false,
            shutdown_tx: None,
            server_task: None,
        }
    }

    /// Provision the HTTP-01 challenge response.
    ///
    /// This makes the key authorization available at:
    /// `http://<domain>/.well-known/acme-challenge/<token>`
    pub async fn provision(
        &mut self,
        token: &str,
        key_thumbprint: &str,
    ) -> Result<ChallengeSolveResult, String> {
        let response = http01_response(token, key_thumbprint);

        let message;
        if let Some(ref webroot) = self.config.webroot_path {
            let challenge_dir = format!("{}/.well-known/acme-challenge", webroot);
            std::fs::create_dir_all(&challenge_dir)
                .map_err(|e| format!("Failed to create challenge dir: {}", e))?;

            let challenge_file = format!("{}/{}", challenge_dir, token);
            std::fs::write(&challenge_file, &response)
                .map_err(|e| format!("Failed to write challenge file: {}", e))?;

            log::info!("[HTTP-01] Challenge file written to {}", challenge_file);
            message = format!(
                "HTTP-01 challenge file written for token {}",
                &token[..8.min(token.len())]
            );
        } else if self.config.proxy_from_gateway {
            message = format!(
                "HTTP-01 challenge registered for gateway proxy token {}",
                &token[..8.min(token.len())]
            );
        } else if self.config.standalone_server {
            if !self.server_running {
                return Err("HTTP-01 standalone challenge server is not running".to_string());
            }
            message = format!(
                "HTTP-01 challenge registered for standalone listener token {}",
                &token[..8.min(token.len())]
            );
        } else {
            return Err(
                "HTTP-01 challenge cannot be provisioned: configure webroot_path or gateway proxy"
                    .to_string(),
            );
        }

        self.tokens.lock().await.insert(token.to_string(), response);

        Ok(ChallengeSolveResult {
            provisioned: true,
            message,
            provisioned_at: Some(Utc::now()),
        })
    }

    /// Clean up after validation (remove the challenge response).
    pub async fn cleanup(&mut self, token: &str) -> Result<(), String> {
        self.tokens.lock().await.remove(token);

        // Remove webroot file if applicable
        if let Some(ref webroot) = self.config.webroot_path {
            let challenge_file = format!("{}/.well-known/acme-challenge/{}", webroot, token);
            let _ = std::fs::remove_file(&challenge_file);
        }

        log::info!(
            "[HTTP-01] Challenge cleaned up for token {}",
            &token[..8.min(token.len())]
        );
        Ok(())
    }

    /// Look up the response for a token (used by the HTTP server).
    pub async fn get_response(&self, token: &str) -> Option<String> {
        self.tokens.lock().await.get(token).cloned()
    }

    /// Start the standalone HTTP challenge server.
    pub async fn start_standalone_server(&mut self) -> Result<(), String> {
        if self.server_running {
            return Ok(());
        }

        let port = self.config.listen_port;
        let addr = self.config.listen_addr.clone();
        let bind_addr = format!("{}:{}", addr, port);

        log::info!("[HTTP-01] Starting standalone server on {}", bind_addr);
        let listener = TcpListener::bind(&bind_addr)
            .await
            .map_err(|e| format!("Failed to bind HTTP-01 standalone listener {bind_addr}: {e}"))?;
        let tokens = Arc::clone(&self.tokens);
        let (shutdown_tx, mut shutdown_rx) = oneshot::channel::<()>();
        let task = tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = &mut shutdown_rx => {
                        break;
                    }
                    accepted = listener.accept() => {
                        match accepted {
                            Ok((stream, _peer)) => {
                                let tokens = Arc::clone(&tokens);
                                tokio::spawn(async move {
                                    handle_http01_connection(stream, tokens).await;
                                });
                            }
                            Err(err) => {
                                log::warn!("[HTTP-01] Standalone listener accept failed: {}", err);
                                break;
                            }
                        }
                    }
                }
            }
        });

        self.shutdown_tx = Some(shutdown_tx);
        self.server_task = Some(task);
        self.server_running = true;
        Ok(())
    }

    /// Stop the standalone HTTP challenge server.
    pub async fn stop_standalone_server(&mut self) -> Result<(), String> {
        if !self.server_running {
            return Ok(());
        }
        log::info!("[HTTP-01] Stopping standalone server");
        if let Some(shutdown_tx) = self.shutdown_tx.take() {
            let _ = shutdown_tx.send(());
        }
        if let Some(task) = self.server_task.take() {
            let _ = task.await;
        }
        self.server_running = false;
        Ok(())
    }

    /// Check if the standalone server is running.
    pub fn is_server_running(&self) -> bool {
        self.server_running
    }

    /// Get all currently active challenge tokens.
    pub async fn active_tokens(&self) -> Vec<String> {
        self.tokens.lock().await.keys().cloned().collect()
    }
}

async fn handle_http01_connection(
    mut stream: tokio::net::TcpStream,
    tokens: Arc<Mutex<HashMap<String, String>>>,
) {
    let mut buffer = [0u8; 4096];
    let read = match stream.read(&mut buffer).await {
        Ok(0) | Err(_) => return,
        Ok(read) => read,
    };

    let request = String::from_utf8_lossy(&buffer[..read]);
    let request_line = request.lines().next().unwrap_or_default();
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or_default();
    let raw_path = parts.next().unwrap_or_default();
    let path = raw_path.split('?').next().unwrap_or(raw_path);

    let (status, body) = if method == "GET" {
        if let Some(token) = path.strip_prefix("/.well-known/acme-challenge/") {
            if !token.is_empty() && !token.contains('/') {
                match tokens.lock().await.get(token).cloned() {
                    Some(response) => ("200 OK", response),
                    None => ("404 Not Found", "challenge token not found".to_string()),
                }
            } else {
                ("404 Not Found", "challenge token not found".to_string())
            }
        } else {
            ("404 Not Found", "not found".to_string())
        }
    } else {
        ("405 Method Not Allowed", "method not allowed".to_string())
    };

    let response = format!(
        "HTTP/1.1 {}\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        status,
        body.len(),
        body
    );
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.shutdown().await;
}

// ── DNS-01 Solver ───────────────────────────────────────────────────

/// DNS-01 challenge solver.
///
/// Creates TXT records at `_acme-challenge.<domain>` via a DNS provider API.
/// Falls back to Manual mode where the user creates the record themselves.
pub struct Dns01Solver {
    /// DNS provider configuration.
    config: DnsProviderConfig,
    /// Active challenges: domain → (record_id, txt_value).
    active_records: HashMap<String, (Option<String>, String)>,
}

impl Dns01Solver {
    pub fn new(config: DnsProviderConfig) -> Self {
        Self {
            config,
            active_records: HashMap::new(),
        }
    }

    /// Provision the DNS-01 challenge response.
    ///
    /// Creates the TXT record `_acme-challenge.<domain>` with the computed value.
    pub async fn provision(
        &mut self,
        domain: &str,
        token: &str,
        key_thumbprint: &str,
    ) -> Result<ChallengeSolveResult, String> {
        let txt_value = dns01_txt_value(token, key_thumbprint);
        let record_name = dns01_record_name(domain);

        log::info!(
            "[DNS-01] Creating TXT record: {} = {}",
            record_name,
            txt_value
        );

        let manager = DnsProviderManager::new(self.config.clone());
        let operation = manager.create_txt_record(&record_name, &txt_value).await?;
        let record_id = operation.record_id;

        self.active_records
            .insert(domain.to_string(), (record_id, txt_value));

        Ok(ChallengeSolveResult {
            provisioned: operation.success,
            message: operation.message,
            provisioned_at: operation.success.then(Utc::now),
        })
    }

    /// Wait for DNS propagation (polling-based).
    pub async fn wait_for_propagation(&self, domain: &str) -> Result<(), String> {
        let timeout = self.config.propagation_timeout_secs;
        let interval = self.config.polling_interval_secs;
        let expected = self.get_txt_value(domain).unwrap_or("");
        let record_name = dns01_record_name(domain);
        log::info!(
            "[DNS-01] Waiting for DNS propagation for {} (timeout: {}s)",
            record_name,
            timeout
        );
        let start = std::time::Instant::now();
        loop {
            if start.elapsed().as_secs() > timeout {
                return Err(format!(
                    "DNS propagation timeout for {} after {}s",
                    record_name, timeout
                ));
            }
            // Try hickory-resolver if available, else fallback to nslookup
            let found = {
                #[cfg(feature = "dns-resolver")]
                {
                    use hickory_resolver::config::{ResolverConfig, ResolverOpts};
                    use hickory_resolver::name_server::TokioRuntimeProvider;
                    use hickory_resolver::proto::rr::rdata::TXT;
                    use hickory_resolver::Resolver;
                    let resolver = match Resolver::builder_with_config(
                        ResolverConfig::default(),
                        TokioRuntimeProvider::default(),
                    )
                    .with_options(ResolverOpts::default())
                    .build()
                    {
                        Ok(resolver) => resolver,
                        Err(_) => return false,
                    };
                    let response = resolver.txt_lookup(record_name.clone()).await;
                    if let Ok(txts) = response {
                        txts.iter()
                            .any(|r: &TXT| r.iter().any(|txt| &**txt == expected.as_bytes()))
                    } else {
                        false
                    }
                }
                #[cfg(not(feature = "dns-resolver"))]
                {
                    use std::process::Command;
                    let output = Command::new("nslookup")
                        .arg("-type=TXT")
                        .arg(&record_name)
                        .output();
                    if let Ok(out) = output {
                        let stdout = String::from_utf8_lossy(&out.stdout);
                        stdout.contains(expected)
                    } else {
                        false
                    }
                }
            };
            if found {
                log::info!("[DNS-01] DNS propagation confirmed for {}", record_name);
                return Ok(());
            }
            log::debug!(
                "[DNS-01] TXT record for {} not found yet, retrying...",
                record_name
            );
            tokio::time::sleep(tokio::time::Duration::from_secs(interval)).await;
        }
    }

    /// Clean up: remove the TXT record after validation.
    pub async fn cleanup(&mut self, domain: &str) -> Result<(), String> {
        if let Some((record_id, _)) = self.active_records.remove(domain) {
            if let Some(id) = record_id {
                let manager = DnsProviderManager::new(self.config.clone());
                manager.delete_txt_record(&id).await?;
            } else {
                log::info!(
                    "[DNS-01] No provider cleanup handle for {} (provider: {:?})",
                    domain,
                    self.config.provider
                );
            }
        }
        Ok(())
    }

    /// Get the TXT value needed for a domain (for manual mode display).
    pub fn get_txt_value(&self, domain: &str) -> Option<&str> {
        self.active_records.get(domain).map(|(_, v)| v.as_str())
    }
}

// ── TLS-ALPN-01 Solver ─────────────────────────────────────────────

/// TLS-ALPN-01 challenge solver.
///
/// Provisions a self-signed certificate with the `acme-tls/1` ALPN protocol
/// identifier and the `acmeIdentifier` extension containing the SHA-256 digest
/// of the key authorization.
pub struct TlsAlpn01Solver {
    /// Active challenges: domain → validation certificate (DER).
    active_certs: HashMap<String, Vec<u8>>,
}

impl Default for TlsAlpn01Solver {
    fn default() -> Self {
        Self::new()
    }
}

impl TlsAlpn01Solver {
    pub fn new() -> Self {
        Self {
            active_certs: HashMap::new(),
        }
    }

    /// Provision the TLS-ALPN-01 challenge.
    ///
    /// Generates a self-signed certificate for the domain with:
    /// - SAN: the domain
    /// - ALPN: `acme-tls/1`  
    /// - acmeIdentifier extension: SHA-256(key_auth)
    pub async fn provision(
        &mut self,
        domain: &str,
        token: &str,
        key_thumbprint: &str,
    ) -> Result<ChallengeSolveResult, String> {
        let _ = (token, key_thumbprint);

        log::info!(
            "[TLS-ALPN-01] Provisioning challenge certificate for {}",
            domain
        );

        Err(
            "TLS-ALPN-01 provisioning is unsupported: self-signed ACME validation certificate generation and TLS listener integration are not implemented"
                .to_string(),
        )
    }

    /// Clean up the challenge certificate.
    pub async fn cleanup(&mut self, domain: &str) -> Result<(), String> {
        self.active_certs.remove(domain);
        log::info!("[TLS-ALPN-01] Cleaned up challenge for {}", domain);
        Ok(())
    }

    /// Get the active challenge certificate for a domain (for the TLS acceptor).
    pub fn get_challenge_cert(&self, domain: &str) -> Option<&Vec<u8>> {
        self.active_certs.get(domain)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_http01_provision_and_lookup() {
        let config = HttpChallengeConfig {
            standalone_server: false,
            listen_port: 8080,
            listen_addr: "127.0.0.1".to_string(),
            webroot_path: None,
            proxy_from_gateway: true,
        };
        let mut solver = Http01Solver::new(config);

        solver
            .provision("test-token-123", "test-thumbprint")
            .await
            .unwrap();

        let resp = solver.get_response("test-token-123").await;
        assert_eq!(resp, Some("test-token-123.test-thumbprint".to_string()));

        solver.cleanup("test-token-123").await.unwrap();
        let resp = solver.get_response("test-token-123").await;
        assert!(resp.is_none());
    }

    #[tokio::test]
    async fn test_http01_standalone_server_starts_and_provisions() {
        let config = HttpChallengeConfig {
            standalone_server: true,
            listen_port: 0,
            listen_addr: "127.0.0.1".to_string(),
            webroot_path: None,
            proxy_from_gateway: false,
        };
        let mut solver = Http01Solver::new(config);

        solver.start_standalone_server().await.unwrap();
        assert!(solver.is_server_running());

        let result = solver
            .provision("standalone-token", "test-thumbprint")
            .await
            .unwrap();
        assert!(result.provisioned);
        assert_eq!(
            solver.get_response("standalone-token").await.as_deref(),
            Some("standalone-token.test-thumbprint")
        );

        solver.stop_standalone_server().await.unwrap();
        assert!(!solver.is_server_running());
    }

    #[tokio::test]
    async fn test_dns01_manual_provision() {
        let config = DnsProviderConfig {
            provider: DnsProvider::Manual,
            ..Default::default()
        };
        let mut solver = Dns01Solver::new(config);

        let result = solver
            .provision("example.com", "test-token", "test-thumb")
            .await
            .unwrap();

        assert!(!result.provisioned);
        assert!(result.message.contains("Manual DNS-01"));
        assert!(solver.get_txt_value("example.com").is_some());
    }

    #[tokio::test]
    async fn test_tls_alpn01_provision_reports_unsupported() {
        let mut solver = TlsAlpn01Solver::new();

        let err = solver
            .provision("example.com", "token", "thumb")
            .await
            .unwrap_err();

        assert!(err.contains("unsupported"));
        assert!(solver.get_challenge_cert("example.com").is_none());

        solver.cleanup("example.com").await.unwrap();
        assert!(solver.get_challenge_cert("example.com").is_none());
    }
}
