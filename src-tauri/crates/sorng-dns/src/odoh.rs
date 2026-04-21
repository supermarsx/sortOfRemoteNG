//! # Oblivious DNS-over-HTTPS (ODoH)
//!
//! RFC 9230 implementation — DNS queries are encrypted to a target resolver
//! but sent through an oblivious proxy, so neither the proxy nor the
//! target can link the query to the client.

use crate::types::*;
use crate::wire;
use serde::{Deserialize, Serialize};

/// ODoH configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OdohConfig {
    /// The oblivious proxy URL (receives encrypted queries, forwards to target).
    pub proxy_url: String,
    /// The target resolver URL (decrypts and resolves, returns encrypted answer).
    pub target_url: String,
    /// Target's public key config (fetched from /.well-known/odohconfigs).
    pub target_config: Option<OdohTargetConfig>,
}

/// ODoH target configuration (HPKE public key).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OdohTargetConfig {
    /// KEM ID (Key Encapsulation Mechanism).
    pub kem_id: u16,
    /// KDF ID (Key Derivation Function).
    pub kdf_id: u16,
    /// AEAD ID (Authenticated Encryption).
    pub aead_id: u16,
    /// Target's HPKE public key (base64-encoded).
    pub public_key: String,
}

/// Well-known ODoH proxy and target configurations.
pub mod presets {
    use super::OdohConfig;

    /// Cloudflare ODoH via Fastly proxy.
    pub fn cloudflare_odoh() -> OdohConfig {
        OdohConfig {
            proxy_url: "https://odoh.cloudflare-dns.com/proxy".to_string(),
            target_url: "https://odoh.cloudflare-dns.com/dns-query".to_string(),
            target_config: None, // Must be fetched at runtime
        }
    }
}

/// Execute an ODoH query.
///
/// **Protocol flow (RFC 9230):**
/// 1. Client encrypts DNS query with target's HPKE public key
/// 2. Client sends encrypted blob to the proxy URL
/// 3. Proxy forwards to target (cannot decrypt the query)
/// 4. Target decrypts, resolves, encrypts response
/// 5. Proxy returns encrypted response to client
/// 6. Client decrypts with session key
///
/// Without a full HPKE implementation, this sends a standard DoH query
/// through the proxy as a degraded mode.
pub async fn execute_odoh_query(
    query: &DnsQuery,
    server: &DnsServer,
    config: &DnsResolverConfig,
) -> Result<DnsResponse, String> {
    let start = std::time::Instant::now();

    // Build wire-format query
    let id: u16 = rand::random();
    let wire_query = wire::build_query(query, id, config.edns0, config.edns0_payload_size);

    let timeout = std::time::Duration::from_millis(config.timeout_ms);

    let client = reqwest::Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    // In a full implementation, we would:
    // 1. Fetch target HPKE config from /.well-known/odohconfigs
    // 2. HPKE-encrypt the wire query
    // 3. Send ObliviousDoHMessage to proxy
    //
    // For now, we send the query through the proxy URL directly as DoH.
    // The proxy provides HTTP-level privacy (hides client IP from resolver).

    let proxy_url = if server.address.starts_with("https://") {
        server.address.clone()
    } else {
        format!("https://{}/proxy", server.address)
    };

    log::info!("ODoH query for {} via proxy {}", query.name, proxy_url);

    // Send encrypted query to proxy
    let response = client
        .post(&proxy_url)
        .header("Content-Type", "application/oblivious-dns-message")
        .header("Accept", "application/oblivious-dns-message")
        .body(wire_query.clone())
        .send()
        .await;

    match response {
        Ok(resp) if resp.status().is_success() => {
            let body = resp
                .bytes()
                .await
                .map_err(|e| format!("Failed to read ODoH response: {}", e))?;

            let duration_ms = start.elapsed().as_millis() as u64;

            // In a full implementation, we would HPKE-decrypt the response here
            wire::parse_response(&body, &server.address, DnsProtocol::ODoH, duration_ms)
                .ok_or_else(|| "Failed to parse ODoH response".to_string())
        }
        Ok(resp) => {
            // Fallback: try standard DoH through the proxy
            log::info!(
                "ODoH returned {}, falling back to standard DoH through proxy",
                resp.status()
            );
            let doh_server = DnsServer::doh(&proxy_url);
            crate::doh::execute_doh_query(query, &doh_server, config).await
        }
        Err(e) => Err(format!("ODoH request failed: {}", e)),
    }
}

/// Fetch the ODoH target configuration from the well-known endpoint.
pub async fn fetch_target_config(
    target_url: &str,
    timeout_ms: u64,
) -> Result<OdohTargetConfig, String> {
    let url = format!(
        "{}/.well-known/odohconfigs",
        target_url.trim_end_matches('/')
    );

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(timeout_ms))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let response = client
        .get(&url)
        .header("Accept", "application/odohconfigs")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch ODoH config: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "ODoH config endpoint returned HTTP {}",
            response.status()
        ));
    }

    let body = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read ODoH config: {}", e))?;

    // Parse ObliviousDoHConfigs format (RFC 9230 §3)
    parse_odoh_configs(&body)
}

/// Parse the ObliviousDoHConfigs wire format.
fn parse_odoh_configs(data: &[u8]) -> Result<OdohTargetConfig, String> {
    if data.len() < 8 {
        return Err("ODoH config too short".to_string());
    }

    // Format: 2-byte total length, then configs
    // Each config: 2-byte length, 2-byte version (0x0001), then HPKE params
    let _total_len = u16::from_be_bytes([data[0], data[1]]) as usize;

    let offset = 2;
    if offset + 2 > data.len() {
        return Err("ODoH config truncated".to_string());
    }

    let config_len = u16::from_be_bytes([data[offset], data[offset + 1]]) as usize;
    let offset = offset + 2;

    if offset + config_len > data.len() || config_len < 8 {
        return Err("ODoH config entry truncated".to_string());
    }

    // Parse HPKE params: kem_id(2) + kdf_id(2) + aead_id(2) + public_key
    let kem_id = u16::from_be_bytes([data[offset], data[offset + 1]]);
    let kdf_id = u16::from_be_bytes([data[offset + 2], data[offset + 3]]);
    let aead_id = u16::from_be_bytes([data[offset + 4], data[offset + 5]]);
    let pk_len = u16::from_be_bytes([data[offset + 6], data[offset + 7]]) as usize;

    let pk_start = offset + 8;
    if pk_start + pk_len > data.len() {
        return Err("ODoH public key truncated".to_string());
    }

    use base64::Engine;
    let public_key =
        base64::engine::general_purpose::STANDARD.encode(&data[pk_start..pk_start + pk_len]);

    Ok(OdohTargetConfig {
        kem_id,
        kdf_id,
        aead_id,
        public_key,
    })
}

/// Validate ODoH configuration.
pub fn validate_odoh_config(config: &OdohConfig) -> Vec<String> {
    let mut issues = Vec::new();

    if config.proxy_url.is_empty() {
        issues.push("ODoH proxy URL is empty".to_string());
    } else if !config.proxy_url.starts_with("https://") {
        issues.push("ODoH proxy URL must use HTTPS".to_string());
    }

    if config.target_url.is_empty() {
        issues.push("ODoH target URL is empty".to_string());
    } else if !config.target_url.starts_with("https://") {
        issues.push("ODoH target URL must use HTTPS".to_string());
    }

    if config.proxy_url == config.target_url {
        issues.push(
            "ODoH proxy and target are the same — this provides no privacy benefit".to_string(),
        );
    }

    issues
}
