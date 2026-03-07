// ── cPanel DNS zone management (WHM API) ────────────────────────────────────

use crate::client::CpanelClient;
use crate::error::{CpanelError, CpanelResult};
use crate::types::*;

pub struct DnsManager;

impl DnsManager {
    /// List DNS zones on the server.
    pub async fn list_zones(client: &CpanelClient) -> CpanelResult<Vec<String>> {
        let raw: serde_json::Value = client.whm_api_raw("listzones", &[]).await?;
        let zones = raw
            .get("zone")
            .and_then(|z| z.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.get("domain").and_then(|d| d.as_str()).map(String::from))
                    .collect()
            })
            .unwrap_or_default();
        Ok(zones)
    }

    /// Get the full DNS zone for a domain.
    pub async fn get_zone(client: &CpanelClient, domain: &str) -> CpanelResult<DnsZone> {
        let raw: serde_json::Value = client
            .whm_api_raw("dumpzone", &[("domain", domain)])
            .await?;
        let zone_data = raw
            .get("result")
            .and_then(|r| r.as_array())
            .and_then(|a| a.first())
            .cloned()
            .ok_or_else(|| CpanelError::dns_zone_not_found(domain))?;

        let records_raw = zone_data
            .get("record")
            .cloned()
            .unwrap_or(serde_json::Value::Array(vec![]));
        let records: Vec<DnsRecord> =
            serde_json::from_value(records_raw).map_err(|e| CpanelError::parse(e.to_string()))?;

        Ok(DnsZone {
            domain: domain.to_string(),
            records,
            serial: zone_data.get("serial").and_then(|s| s.as_str()).map(String::from),
            ttl: zone_data.get("ttl").and_then(|t| t.as_u64()).map(|t| t as u32),
            refresh: None,
            retry: None,
            expire: None,
            minimum: None,
        })
    }

    /// Add a DNS zone record.
    pub async fn add_record(client: &CpanelClient, req: &AddDnsRecordRequest) -> CpanelResult<String> {
        let mut params: Vec<(&str, &str)> = vec![
            ("domain", &req.domain),
            ("name", &req.name),
            ("type", &req.record_type),
        ];
        let addr_str;
        if let Some(ref a) = req.address {
            addr_str = a.clone();
            params.push(("address", &addr_str));
        }
        let cname_str;
        if let Some(ref c) = req.cname {
            cname_str = c.clone();
            params.push(("cname", &cname_str));
        }
        let exchange_str;
        if let Some(ref e) = req.exchange {
            exchange_str = e.clone();
            params.push(("exchange", &exchange_str));
        }
        let pref_str;
        if let Some(p) = req.preference {
            pref_str = p.to_string();
            params.push(("preference", &pref_str));
        }
        let txt_str;
        if let Some(ref t) = req.txtdata {
            txt_str = t.clone();
            params.push(("txtdata", &txt_str));
        }
        let ttl_str;
        if let Some(ttl) = req.ttl {
            ttl_str = ttl.to_string();
            params.push(("ttl", &ttl_str));
        }
        let priority_str;
        if let Some(p) = req.priority {
            priority_str = p.to_string();
            params.push(("priority", &priority_str));
        }
        let weight_str;
        if let Some(w) = req.weight {
            weight_str = w.to_string();
            params.push(("weight", &weight_str));
        }
        let port_str;
        if let Some(p) = req.port {
            port_str = p.to_string();
            params.push(("port", &port_str));
        }
        let target_str;
        if let Some(ref t) = req.target {
            target_str = t.clone();
            params.push(("target", &target_str));
        }

        let raw: serde_json::Value = client.whm_api_raw("addzonerecord", &params).await?;
        check_whm(&raw)?;
        Ok(format!("DNS record added to {}", req.domain))
    }

    /// Edit a DNS zone record by line number.
    pub async fn edit_record(client: &CpanelClient, req: &EditDnsRecordRequest) -> CpanelResult<String> {
        let line_str = req.line.to_string();
        let mut params: Vec<(&str, &str)> = vec![
            ("domain", &req.domain),
            ("Line", &line_str),
        ];
        let name_str;
        if let Some(ref n) = req.name {
            name_str = n.clone();
            params.push(("name", &name_str));
        }
        let type_str;
        if let Some(ref t) = req.record_type {
            type_str = t.clone();
            params.push(("type", &type_str));
        }
        let addr_str;
        if let Some(ref a) = req.address {
            addr_str = a.clone();
            params.push(("address", &addr_str));
        }
        let txt_str;
        if let Some(ref t) = req.txtdata {
            txt_str = t.clone();
            params.push(("txtdata", &txt_str));
        }
        let ttl_str;
        if let Some(ttl) = req.ttl {
            ttl_str = ttl.to_string();
            params.push(("ttl", &ttl_str));
        }

        let raw: serde_json::Value = client.whm_api_raw("editzonerecord", &params).await?;
        check_whm(&raw)?;
        Ok(format!("DNS record {} edited in {}", req.line, req.domain))
    }

    /// Remove a DNS zone record by line number.
    pub async fn remove_record(client: &CpanelClient, domain: &str, line: u32) -> CpanelResult<String> {
        let line_str = line.to_string();
        let raw: serde_json::Value = client
            .whm_api_raw("removezonerecord", &[("domain", domain), ("Line", &line_str)])
            .await?;
        check_whm(&raw)?;
        Ok(format!("DNS record {line} removed from {domain}"))
    }

    /// Reset a DNS zone to defaults.
    pub async fn reset_zone(client: &CpanelClient, domain: &str, user: &str) -> CpanelResult<String> {
        let raw: serde_json::Value = client
            .whm_api_raw("resetzone", &[("domain", domain), ("user", user)])
            .await?;
        check_whm(&raw)?;
        Ok(format!("DNS zone {domain} reset to defaults"))
    }

    /// Look up the nameserver configuration for a domain.
    pub async fn get_nameserver_config(client: &CpanelClient) -> CpanelResult<serde_json::Value> {
        client.whm_api_raw("getresolvers", &[]).await
    }
}

fn check_whm(raw: &serde_json::Value) -> CpanelResult<()> {
    let status = raw
        .get("result")
        .or_else(|| raw.get("metadata"))
        .and_then(|r| {
            r.get("status")
                .or_else(|| r.get("result"))
                .and_then(|s| s.as_u64())
        })
        .unwrap_or(1);
    if status == 0 {
        let msg = raw
            .get("result")
            .or_else(|| raw.get("metadata"))
            .and_then(|r| r.get("statusmsg").or_else(|| r.get("reason")))
            .and_then(|m| m.as_str())
            .unwrap_or("WHM API call failed");
        return Err(CpanelError::api(msg));
    }
    Ok(())
}
