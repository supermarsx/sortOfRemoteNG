use crate::client::PfsenseClient;
use crate::error::PfsenseResult;
use crate::types::*;

pub struct DiagnosticsManager;

impl DiagnosticsManager {
    pub async fn get_arp_table(client: &PfsenseClient) -> PfsenseResult<Vec<ArpEntry>> {
        let resp: ApiListResponse<ArpEntry> = client.api_get("diagnostics/arp").await?;
        Ok(resp.data)
    }

    pub async fn flush_arp_table(client: &PfsenseClient) -> PfsenseResult<serde_json::Value> {
        client
            .api_post("diagnostics/arp/flush", &serde_json::json!({}))
            .await
    }

    pub async fn get_ndp_table(client: &PfsenseClient) -> PfsenseResult<Vec<NdpEntry>> {
        let resp: ApiListResponse<NdpEntry> = client.api_get("diagnostics/ndp").await?;
        Ok(resp.data)
    }

    pub async fn dns_lookup(
        client: &PfsenseClient,
        host: &str,
        record_type: Option<&str>,
        server: Option<&str>,
    ) -> PfsenseResult<DnsLookupResult> {
        let mut endpoint = format!("diagnostics/dns_lookup/{host}");
        let mut sep = '?';
        if let Some(rtype) = record_type {
            endpoint.push_str(&format!("{sep}type={rtype}"));
            sep = '&';
        }
        if let Some(srv) = server {
            endpoint.push_str(&format!("{sep}server={srv}"));
        }
        let resp: ApiResponse<DnsLookupResult> = client.api_get(&endpoint).await?;
        Ok(resp.data)
    }

    pub async fn ping(
        client: &PfsenseClient,
        host: &str,
        count: Option<u32>,
        source: Option<&str>,
    ) -> PfsenseResult<PingResult> {
        let mut body = serde_json::json!({"host": host});
        if let Some(c) = count {
            body["count"] = serde_json::json!(c);
        }
        if let Some(src) = source {
            body["source"] = serde_json::json!(src);
        }
        let resp: ApiResponse<PingResult> = client.api_post("diagnostics/ping", &body).await?;
        Ok(resp.data)
    }

    pub async fn traceroute(
        client: &PfsenseClient,
        host: &str,
        max_hops: Option<u32>,
        source: Option<&str>,
    ) -> PfsenseResult<TraceResult> {
        let mut body = serde_json::json!({"host": host});
        if let Some(hops) = max_hops {
            body["max_hops"] = serde_json::json!(hops);
        }
        if let Some(src) = source {
            body["source"] = serde_json::json!(src);
        }
        let resp: ApiResponse<TraceResult> =
            client.api_post("diagnostics/traceroute", &body).await?;
        Ok(resp.data)
    }

    pub async fn get_interface_stats(client: &PfsenseClient, name: &str) -> PfsenseResult<IfStats> {
        let resp: ApiResponse<IfStats> =
            client.api_get(&format!("status/interface/{name}")).await?;
        Ok(resp.data)
    }

    pub async fn list_interface_stats(client: &PfsenseClient) -> PfsenseResult<Vec<IfStats>> {
        let resp: ApiListResponse<IfStats> = client.api_get("status/interface").await?;
        Ok(resp.data)
    }

    pub async fn get_pfinfo(client: &PfsenseClient) -> PfsenseResult<serde_json::Value> {
        client.api_get_raw("diagnostics/pfinfo").await
    }

    pub async fn get_system_log(
        client: &PfsenseClient,
        log_name: &str,
        count: Option<u32>,
    ) -> PfsenseResult<Vec<String>> {
        let mut endpoint = format!("diagnostics/system_log/{log_name}");
        if let Some(c) = count {
            endpoint.push_str(&format!("?count={c}"));
        }
        let resp: ApiResponse<Vec<String>> = client.api_get(&endpoint).await?;
        Ok(resp.data)
    }
}
