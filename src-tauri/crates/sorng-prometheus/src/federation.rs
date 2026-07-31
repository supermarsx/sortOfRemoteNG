// ── sorng-prometheus/src/federation.rs ───────────────────────────────────────
//! Federation endpoint – scrape metrics from another Prometheus in text format.

use crate::client::{read_response_text_limited, PrometheusClient, MAX_RESPONSE_BYTES};
use crate::error::{PrometheusError, PrometheusResult};
use crate::types::*;
use log::debug;

pub struct FederationManager;

impl FederationManager {
    /// Fetch federated metrics matching the given selectors.
    /// Endpoint: GET /federate?match[]={sel}
    pub async fn get(
        client: &PrometheusClient,
        match_selectors: &[&str],
    ) -> PrometheusResult<FederationResult> {
        let url = client.federate_url();
        debug!("PROMETHEUS FEDERATE {url}");

        let mut req = reqwest::Client::new().get(&url);
        for m in match_selectors {
            req = req.query(&[("match[]", m)]);
        }

        let resp = req
            .send()
            .await
            .map_err(|e| PrometheusError::http(format!("federate: {e}")))?;
        let status = resp.status();
        if !status.is_success() {
            return Err(PrometheusError::api(format!(
                "federate HTTP {}",
                status.as_u16()
            )));
        }
        let metrics =
            read_response_text_limited(resp, MAX_RESPONSE_BYTES, "Prometheus federation").await?;
        Ok(FederationResult { metrics })
    }
}
