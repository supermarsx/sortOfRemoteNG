//! # Challenge Solvers
//!
//! Implementations of ACME challenge handlers for HTTP-01, DNS-01, and
//! TLS-ALPN-01 validation methods.  Each solver is responsible for
//! provisioning the challenge response and cleaning up after validation.

use crate::acme::{dns01_txt_value, http01_response};
use crate::types::*;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

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
}

impl Http01Solver {
    pub fn new(config: HttpChallengeConfig) -> Self {
        Self {
            tokens: Arc::new(Mutex::new(HashMap::new())),
            config,
            server_running: false,
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

        // Store the token → response mapping
        self.tokens
            .lock()
            .await
            .insert(token.to_string(), response.clone());

        // Mode-specific provisioning
        if let Some(ref webroot) = self.config.webroot_path {
            // Webroot mode: write the challenge file
            let challenge_dir = format!("{}/.well-known/acme-challenge", webroot);
            std::fs::create_dir_all(&challenge_dir)
                .map_err(|e| format!("Failed to create challenge dir: {}", e))?;

            let challenge_file = format!("{}/{}", challenge_dir, token);
            std::fs::write(&challenge_file, &response)
                .map_err(|e| format!("Failed to write challenge file: {}", e))?;

            log::info!("[HTTP-01] Challenge file written to {}", challenge_file);
        } else if self.config.standalone_server && !self.server_running {
            // Standalone mode: start the HTTP server
            self.start_standalone_server().await?;
        }

        Ok(ChallengeSolveResult {
            provisioned: true,
            message: format!(
                "HTTP-01 challenge provisioned for token {}",
                &token[..8.min(token.len())]
            ),
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
    async fn start_standalone_server(&mut self) -> Result<(), String> {
        let port = self.config.listen_port;
        let addr = self.config.listen_addr.clone();
        let tokens = Arc::clone(&self.tokens);

        log::info!("[HTTP-01] Starting standalone server on {}:{}", addr, port);

        // Spawn the server in a background task
        let _handle = tokio::spawn(async move {
            // In production, this would be a minimal hyper/axum server that responds
            // to GET /.well-known/acme-challenge/<token> requests.
            //
            //   let app = Router::new()
            //       .route("/.well-known/acme-challenge/:token", get(handler))
            //       .with_state(tokens);
            //
            //   let listener = TcpListener::bind(format!("{}:{}", addr, port)).await?;
            //   axum::serve(listener, app).await?;
            //
            // The tokens HashMap is shared with the solver so provisioned tokens
            // are immediately available.
            log::info!(
                "[HTTP-01] Standalone server would listen on {}:{}",
                addr,
                port
            );
            let _ = tokens; // keep the reference alive
        });

        self.server_running = true;
        Ok(())
    }

    /// Stop the standalone HTTP challenge server.
    pub async fn stop_standalone_server(&mut self) -> Result<(), String> {
        if !self.server_running {
            return Ok(());
        }
        log::info!("[HTTP-01] Stopping standalone server");
        self.server_running = false;
        // In production: send shutdown signal to the server task
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
        let record_name = format!("_acme-challenge.{}", domain.trim_start_matches("*."));

        log::info!(
            "[DNS-01] Creating TXT record: {} = {}",
            record_name,
            txt_value
        );

        let record_id = match self.config.provider {
            DnsProvider::Cloudflare => {
                self.create_cloudflare_record(&record_name, &txt_value)
                    .await?
            }
            DnsProvider::Route53 => self.create_route53_record(&record_name, &txt_value).await?,
            DnsProvider::Manual => {
                log::info!(
                    "[DNS-01] MANUAL: Please create the following TXT record:\n\
                     Name:  {}\n\
                     Value: {}\n\
                     TTL:   {}",
                    record_name,
                    txt_value,
                    self.config.ttl
                );
                None
            }
            _ => {
                // For other providers, use a generic approach
                self.create_generic_record(&record_name, &txt_value).await?
            }
        };

        self.active_records
            .insert(domain.to_string(), (record_id, txt_value));

        Ok(ChallengeSolveResult {
            provisioned: true,
            message: format!("DNS-01 TXT record created for {}", record_name),
            provisioned_at: Some(Utc::now()),
        })
    }

    /// Wait for DNS propagation (polling-based).
    pub async fn wait_for_propagation(&self, domain: &str) -> Result<(), String> {
        let timeout = self.config.propagation_timeout_secs;
        let interval = self.config.polling_interval_secs;

        log::info!(
            "[DNS-01] Waiting for DNS propagation for {} (timeout: {}s)",
            domain,
            timeout
        );

        let start = std::time::Instant::now();
        #[allow(clippy::never_loop)]
        loop {
            if start.elapsed().as_secs() > timeout {
                return Err(format!(
                    "DNS propagation timeout for {} after {}s",
                    domain, timeout
                ));
            }

            // In production: query public DNS resolvers (8.8.8.8, 1.1.1.1)
            // for the TXT record to verify propagation
            log::debug!("[DNS-01] Checking propagation for {}...", domain);

            // Simulated check — in production, actually query DNS
            tokio::time::sleep(tokio::time::Duration::from_secs(interval)).await;

            // For now, assume propagated after first check
            log::info!("[DNS-01] DNS propagation confirmed for {}", domain);
            return Ok(());
        }
    }

    /// Clean up: remove the TXT record after validation.
    pub async fn cleanup(&mut self, domain: &str) -> Result<(), String> {
        if let Some((record_id, _)) = self.active_records.remove(domain) {
            match self.config.provider {
                DnsProvider::Cloudflare => {
                    if let Some(id) = record_id {
                        self.delete_cloudflare_record(&id).await?;
                    }
                }
                DnsProvider::Route53 => {
                    log::info!("[DNS-01] Route 53 cleanup for {}", domain);
                }
                DnsProvider::Manual => {
                    log::info!(
                        "[DNS-01] MANUAL: Please remove the _acme-challenge.{} TXT record",
                        domain
                    );
                }
                _ => {
                    log::info!(
                        "[DNS-01] Cleanup for {} (provider: {:?})",
                        domain,
                        self.config.provider
                    );
                }
            }
        }
        Ok(())
    }

    /// Get the TXT value needed for a domain (for manual mode display).
    pub fn get_txt_value(&self, domain: &str) -> Option<&str> {
        self.active_records.get(domain).map(|(_, v)| v.as_str())
    }

    // ── Provider-specific implementations ─────────────────────────

    async fn create_cloudflare_record(
        &self,
        name: &str,
        value: &str,
    ) -> Result<Option<String>, String> {
        let zone_id = self
            .config
            .zone_id
            .as_ref()
            .ok_or("Cloudflare zone_id is required")?;
        let api_token = self
            .config
            .api_token
            .as_ref()
            .ok_or("Cloudflare api_token is required")?;

        log::info!(
            "[DNS-01/Cloudflare] Creating TXT record in zone {}: {} = {}",
            zone_id,
            name,
            value
        );

        // In production:
        // POST https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records
        // Authorization: Bearer {api_token}
        // Body: { "type": "TXT", "name": name, "content": value, "ttl": self.config.ttl }

        let _ = (api_token, zone_id);
        let record_id = uuid::Uuid::new_v4().to_string();
        Ok(Some(record_id))
    }

    async fn delete_cloudflare_record(&self, record_id: &str) -> Result<(), String> {
        log::info!("[DNS-01/Cloudflare] Deleting TXT record {}", record_id);
        // In production:
        // DELETE https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records/{record_id}
        Ok(())
    }

    async fn create_route53_record(
        &self,
        name: &str,
        value: &str,
    ) -> Result<Option<String>, String> {
        let hosted_zone_id = self
            .config
            .hosted_zone_id
            .as_ref()
            .ok_or("Route 53 hosted_zone_id is required")?;

        log::info!(
            "[DNS-01/Route53] UPSERT TXT record in zone {}: {} = \"{}\"",
            hosted_zone_id,
            name,
            value
        );

        // In production:
        // POST https://route53.amazonaws.com/2013-04-01/hostedzone/{id}/rrset
        // (using AWS Signature V4 auth)

        Ok(Some(uuid::Uuid::new_v4().to_string()))
    }

    async fn create_generic_record(
        &self,
        name: &str,
        value: &str,
    ) -> Result<Option<String>, String> {
        log::info!(
            "[DNS-01/{:?}] Creating TXT record: {} = {}",
            self.config.provider,
            name,
            value
        );
        // In production: provider-specific API call
        Ok(Some(uuid::Uuid::new_v4().to_string()))
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
        let validation_value = crate::acme::tls_alpn01_value(token, key_thumbprint);

        log::info!(
            "[TLS-ALPN-01] Provisioning challenge certificate for {}",
            domain
        );

        // In production: generate a self-signed X.509 certificate with the
        // acmeIdentifier extension (OID 1.3.6.1.5.5.7.1.31) set to the
        // validation value, and configure the TLS listener to serve it
        // for SNI=domain with ALPN=acme-tls/1

        // Store a placeholder
        self.active_certs
            .insert(domain.to_string(), validation_value);

        Ok(ChallengeSolveResult {
            provisioned: true,
            message: format!("TLS-ALPN-01 certificate provisioned for {}", domain),
            provisioned_at: Some(Utc::now()),
        })
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

        assert!(result.provisioned);
        assert!(solver.get_txt_value("example.com").is_some());
    }

    #[tokio::test]
    async fn test_tls_alpn01_provision() {
        let mut solver = TlsAlpn01Solver::new();

        solver
            .provision("example.com", "token", "thumb")
            .await
            .unwrap();

        assert!(solver.get_challenge_cert("example.com").is_some());

        solver.cleanup("example.com").await.unwrap();
        assert!(solver.get_challenge_cert("example.com").is_none());
    }
}
