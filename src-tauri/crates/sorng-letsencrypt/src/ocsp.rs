//! # OCSP Stapling
//!
//! Fetches, caches, and serves OCSP responses for stapled TLS connections.
//! This reduces TLS handshake latency and improves privacy by avoiding
//! client-side OCSP lookups.

use crate::types::*;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// OCSP cache entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OcspCacheEntry {
    /// Certificate ID.
    pub certificate_id: String,
    /// OCSP response (DER, base64-encoded for JSON serialization).
    pub response_b64: String,
    /// When the response was fetched.
    pub fetched_at: chrono::DateTime<Utc>,
    /// When the response expires (next_update from the OCSP response).
    pub expires_at: Option<chrono::DateTime<Utc>>,
    /// OCSP certificate status.
    pub cert_status: OcspCertStatus,
    /// OCSP responder URL used.
    pub responder_url: String,
}

/// Manages OCSP stapling for all managed certificates.
pub struct OcspManager {
    /// Cache of OCSP responses by certificate ID.
    cache: HashMap<String, OcspCacheEntry>,
    /// How often to refresh responses (in seconds).
    #[allow(dead_code)]
    refresh_interval_secs: u64,
    /// Whether OCSP stapling is enabled.
    enabled: bool,
}

impl OcspManager {
    pub fn new(enabled: bool, refresh_interval_secs: u64) -> Self {
        Self {
            cache: HashMap::new(),
            refresh_interval_secs,
            enabled,
        }
    }

    /// Check if OCSP stapling is enabled.
    pub fn is_enabled(&self) -> bool {
        self.enabled
    }

    /// Fetch an OCSP response for a certificate.
    ///
    /// In production, this:
    /// 1. Extracts the OCSP responder URL from the certificate's AIA extension
    /// 2. Builds an OCSP request containing the cert serial and issuer hash
    /// 3. POSTs to the responder URL
    /// 4. Parses and validates the response
    /// 5. Caches the result
    pub async fn fetch_response(
        &mut self,
        cert_id: &str,
        responder_url: &str,
    ) -> Result<OcspStatus, String> {
        log::info!(
            "[OCSP] Fetching response for cert {} from {}",
            cert_id,
            responder_url
        );

        // In production: build OCSP request, POST to responder, parse DER response
        let entry = OcspCacheEntry {
            certificate_id: cert_id.to_string(),
            response_b64: "placeholder-ocsp-response".to_string(),
            fetched_at: Utc::now(),
            expires_at: Some(Utc::now() + chrono::Duration::hours(12)),
            cert_status: OcspCertStatus::Good,
            responder_url: responder_url.to_string(),
        };

        self.cache.insert(cert_id.to_string(), entry);

        Ok(OcspStatus {
            certificate_id: cert_id.to_string(),
            status: OcspCertStatus::Good,
            produced_at: Some(Utc::now()),
            this_update: Some(Utc::now()),
            next_update: Some(Utc::now() + chrono::Duration::hours(12)),
            responder_url: Some(responder_url.to_string()),
            is_fresh: true,
        })
    }

    /// Get the cached OCSP response for a certificate.
    pub fn get_cached(&self, cert_id: &str) -> Option<&OcspCacheEntry> {
        self.cache.get(cert_id)
    }

    /// Check if a cached response is still fresh.
    pub fn is_fresh(&self, cert_id: &str) -> bool {
        self.cache
            .get(cert_id)
            .map(|entry| {
                entry
                    .expires_at
                    .map(|exp| exp > Utc::now())
                    .unwrap_or(false)
            })
            .unwrap_or(false)
    }

    /// Get the OCSP status for a certificate.
    pub fn get_status(&self, cert_id: &str) -> Option<OcspStatus> {
        self.cache.get(cert_id).map(|entry| OcspStatus {
            certificate_id: entry.certificate_id.clone(),
            status: entry.cert_status,
            produced_at: Some(entry.fetched_at),
            this_update: Some(entry.fetched_at),
            next_update: entry.expires_at,
            responder_url: Some(entry.responder_url.clone()),
            is_fresh: entry
                .expires_at
                .map(|exp| exp > Utc::now())
                .unwrap_or(false),
        })
    }

    /// Remove a cached OCSP response.
    pub fn invalidate(&mut self, cert_id: &str) {
        self.cache.remove(cert_id);
    }

    /// Clear the entire cache.
    pub fn clear_cache(&mut self) {
        self.cache.clear();
    }

    /// List all certificates with stale OCSP responses.
    pub fn stale_entries(&self) -> Vec<String> {
        let now = Utc::now();
        self.cache
            .iter()
            .filter(|(_, entry)| entry.expires_at.map(|exp| exp <= now).unwrap_or(true))
            .map(|(id, _)| id.clone())
            .collect()
    }

    /// Get cache statistics.
    pub fn stats(&self) -> OcspCacheStats {
        let total = self.cache.len();
        let fresh = self
            .cache
            .values()
            .filter(|e| e.expires_at.map(|exp| exp > Utc::now()).unwrap_or(false))
            .count();

        OcspCacheStats {
            total_entries: total,
            fresh_entries: fresh,
            stale_entries: total - fresh,
        }
    }
}

/// OCSP cache statistics.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OcspCacheStats {
    pub total_entries: usize,
    pub fresh_entries: usize,
    pub stale_entries: usize,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_ocsp_fetch_and_cache() {
        let mut mgr = OcspManager::new(true, 3600);

        let status = mgr
            .fetch_response("cert1", "http://ocsp.test/")
            .await
            .unwrap();

        assert_eq!(status.status, OcspCertStatus::Good);
        assert!(mgr.is_fresh("cert1"));
        assert!(mgr.get_cached("cert1").is_some());
    }

    #[test]
    fn test_ocsp_cache_invalidation() {
        let mut mgr = OcspManager::new(true, 3600);
        mgr.cache.insert(
            "cert1".to_string(),
            OcspCacheEntry {
                certificate_id: "cert1".to_string(),
                response_b64: "test".to_string(),
                fetched_at: Utc::now(),
                expires_at: Some(Utc::now() + chrono::Duration::hours(1)),
                cert_status: OcspCertStatus::Good,
                responder_url: "http://test/".to_string(),
            },
        );

        assert!(mgr.get_cached("cert1").is_some());
        mgr.invalidate("cert1");
        assert!(mgr.get_cached("cert1").is_none());
    }

    #[test]
    fn test_ocsp_stats() {
        let mgr = OcspManager::new(true, 3600);
        let stats = mgr.stats();
        assert_eq!(stats.total_entries, 0);
    }
}
