// ── sorng-freeipa/src/dns.rs ──────────────────────────────────────────────────
//! DNS zone and record management via FreeIPA JSON-RPC.

use crate::client::FreeIpaClient;
use crate::error::FreeIpaResult;
use crate::types::*;

pub struct DnsManager;

impl DnsManager {
    pub async fn list_zones(client: &FreeIpaClient) -> FreeIpaResult<Vec<DnsZone>> {
        let result = client
            .rpc::<Vec<DnsZone>>(
                "dnszone_find",
                vec![],
                serde_json::json!({"version": "2.251", "sizelimit": 0}),
            )
            .await?;
        Ok(result.result)
    }

    pub async fn get_zone(client: &FreeIpaClient, zone: &str) -> FreeIpaResult<DnsZone> {
        let result = client
            .rpc::<DnsZone>(
                "dnszone_show",
                vec![serde_json::json!(zone)],
                serde_json::json!({"version": "2.251", "all": true}),
            )
            .await?;
        Ok(result.result)
    }

    pub async fn create_zone(
        client: &FreeIpaClient,
        req: &CreateDnsZoneRequest,
    ) -> FreeIpaResult<DnsZone> {
        let mut opts = serde_json::json!({"version": "2.251"});
        let map = opts.as_object_mut().unwrap();
        if let Some(ref v) = req.idnssoamname {
            map.insert("idnssoamname".into(), serde_json::json!(v));
        }
        if let Some(ref v) = req.idnssoarname {
            map.insert("idnssoarname".into(), serde_json::json!(v));
        }
        if let Some(v) = req.idnssoarefresh {
            map.insert("idnssoarefresh".into(), serde_json::json!(v));
        }
        if let Some(v) = req.idnssoaretry {
            map.insert("idnssoaretry".into(), serde_json::json!(v));
        }
        if let Some(v) = req.force {
            map.insert("force".into(), serde_json::json!(v));
        }

        let result = client
            .rpc::<DnsZone>("dnszone_add", vec![serde_json::json!(req.idnsname)], opts)
            .await?;
        Ok(result.result)
    }

    pub async fn delete_zone(client: &FreeIpaClient, zone: &str) -> FreeIpaResult<()> {
        client
            .rpc::<serde_json::Value>(
                "dnszone_del",
                vec![serde_json::json!(zone)],
                serde_json::json!({"version": "2.251"}),
            )
            .await?;
        Ok(())
    }

    pub async fn enable_zone(client: &FreeIpaClient, zone: &str) -> FreeIpaResult<()> {
        client
            .rpc::<serde_json::Value>(
                "dnszone_enable",
                vec![serde_json::json!(zone)],
                serde_json::json!({"version": "2.251"}),
            )
            .await?;
        Ok(())
    }

    pub async fn disable_zone(client: &FreeIpaClient, zone: &str) -> FreeIpaResult<()> {
        client
            .rpc::<serde_json::Value>(
                "dnszone_disable",
                vec![serde_json::json!(zone)],
                serde_json::json!({"version": "2.251"}),
            )
            .await?;
        Ok(())
    }

    pub async fn list_records(client: &FreeIpaClient, zone: &str) -> FreeIpaResult<Vec<DnsRecord>> {
        let result = client
            .rpc::<Vec<DnsRecord>>(
                "dnsrecord_find",
                vec![serde_json::json!(zone)],
                serde_json::json!({"version": "2.251", "sizelimit": 0}),
            )
            .await?;
        Ok(result.result)
    }

    pub async fn get_record(
        client: &FreeIpaClient,
        zone: &str,
        name: &str,
    ) -> FreeIpaResult<DnsRecord> {
        let result = client
            .rpc::<DnsRecord>(
                "dnsrecord_show",
                vec![serde_json::json!(zone), serde_json::json!(name)],
                serde_json::json!({"version": "2.251", "all": true}),
            )
            .await?;
        Ok(result.result)
    }

    pub async fn add_record(
        client: &FreeIpaClient,
        req: &AddDnsRecordRequest,
    ) -> FreeIpaResult<DnsRecord> {
        let attr_key = format!("{}record", req.record_type.to_lowercase());
        let mut opts = serde_json::json!({"version": "2.251"});
        opts.as_object_mut()
            .unwrap()
            .insert(attr_key, serde_json::json!(req.record_data));
        if let Some(ttl) = req.ttl {
            opts.as_object_mut()
                .unwrap()
                .insert("dnsttl".into(), serde_json::json!(ttl));
        }
        let result = client
            .rpc::<DnsRecord>(
                "dnsrecord_add",
                vec![
                    serde_json::json!(req.zone),
                    serde_json::json!(req.record_name),
                ],
                opts,
            )
            .await?;
        Ok(result.result)
    }

    pub async fn modify_record(
        client: &FreeIpaClient,
        zone: &str,
        name: &str,
        record_type: &str,
        record_data: &str,
    ) -> FreeIpaResult<DnsRecord> {
        let attr_key = format!("{}record", record_type.to_lowercase());
        let opts = serde_json::json!({"version": "2.251", attr_key: record_data});
        let result = client
            .rpc::<DnsRecord>(
                "dnsrecord_mod",
                vec![serde_json::json!(zone), serde_json::json!(name)],
                opts,
            )
            .await?;
        Ok(result.result)
    }

    pub async fn delete_record(
        client: &FreeIpaClient,
        zone: &str,
        name: &str,
        record_type: &str,
        record_data: &str,
    ) -> FreeIpaResult<()> {
        let attr_key = format!("{}record", record_type.to_lowercase());
        let opts = serde_json::json!({"version": "2.251", attr_key: record_data});
        client
            .rpc::<serde_json::Value>(
                "dnsrecord_del",
                vec![serde_json::json!(zone), serde_json::json!(name)],
                opts,
            )
            .await?;
        Ok(())
    }
}
