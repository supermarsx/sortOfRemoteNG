//! Google Cloud DNS client.
//!
//! Covers managed zones and resource record sets.
//!
//! API base: `https://dns.googleapis.com/dns/v1`

use crate::client::GcpClient;
use crate::error::GcpResult;
use serde::{Deserialize, Serialize};

const SERVICE: &str = "dns";
const V1: &str = "/dns/v1";

// ── Types ───────────────────────────────────────────────────────────────

/// Cloud DNS managed zone.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManagedZone {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub name: String,
    #[serde(default, rename = "dnsName")]
    pub dns_name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub visibility: String,
    #[serde(default, rename = "nameServers")]
    pub name_servers: Vec<String>,
    #[serde(default, rename = "creationTime")]
    pub creation_time: Option<String>,
    #[serde(default, rename = "dnssecConfig")]
    pub dnssec_config: Option<DnssecConfig>,
    #[serde(default)]
    pub labels: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnssecConfig {
    #[serde(default)]
    pub state: Option<String>,
    #[serde(default, rename = "nonExistence")]
    pub non_existence: Option<String>,
}

/// DNS resource record set.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceRecordSet {
    #[serde(default)]
    pub name: String,
    #[serde(default, rename = "type")]
    pub record_type: String,
    #[serde(default)]
    pub ttl: Option<u32>,
    #[serde(default)]
    pub rrdatas: Vec<String>,
    #[serde(default, rename = "signatureRrdatas")]
    pub signature_rrdatas: Vec<String>,
}

/// Change (batch modification of record sets).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Change {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub additions: Vec<ResourceRecordSet>,
    #[serde(default)]
    pub deletions: Vec<ResourceRecordSet>,
    #[serde(default, rename = "startTime")]
    pub start_time: Option<String>,
}

// ── List wrappers ───────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct ZoneList {
    #[serde(default, rename = "managedZones")]
    managed_zones: Vec<ManagedZone>,
    #[serde(default, rename = "nextPageToken")]
    next_page_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RrsetList {
    #[serde(default)]
    rrsets: Vec<ResourceRecordSet>,
    #[serde(default, rename = "nextPageToken")]
    next_page_token: Option<String>,
}

// ── DNS Client ──────────────────────────────────────────────────────────

pub struct DnsClient;

impl DnsClient {
    /// List managed zones.
    pub async fn list_managed_zones(
        client: &mut GcpClient,
        project: &str,
    ) -> GcpResult<Vec<ManagedZone>> {
        let path = format!("{}/projects/{}/managedZones", V1, project);
        let resp: ZoneList = client.get(SERVICE, &path, &[]).await?;
        Ok(resp.managed_zones)
    }

    /// Get a managed zone.
    pub async fn get_managed_zone(
        client: &mut GcpClient,
        project: &str,
        zone_name: &str,
    ) -> GcpResult<ManagedZone> {
        let path = format!("{}/projects/{}/managedZones/{}", V1, project, zone_name);
        client.get(SERVICE, &path, &[]).await
    }

    /// Create a managed zone.
    pub async fn create_managed_zone(
        client: &mut GcpClient,
        project: &str,
        name: &str,
        dns_name: &str,
        description: Option<&str>,
        visibility: Option<&str>,
    ) -> GcpResult<ManagedZone> {
        let path = format!("{}/projects/{}/managedZones", V1, project);
        let body = serde_json::json!({
            "name": name,
            "dnsName": dns_name,
            "description": description.unwrap_or(""),
            "visibility": visibility.unwrap_or("public"),
        });
        client.post(SERVICE, &path, &body).await
    }

    /// Delete a managed zone.
    pub async fn delete_managed_zone(
        client: &mut GcpClient,
        project: &str,
        zone_name: &str,
    ) -> GcpResult<()> {
        let path = format!("{}/projects/{}/managedZones/{}", V1, project, zone_name);
        client.delete(SERVICE, &path).await?;
        Ok(())
    }

    /// List record sets in a zone.
    pub async fn list_record_sets(
        client: &mut GcpClient,
        project: &str,
        zone_name: &str,
        record_type: Option<&str>,
    ) -> GcpResult<Vec<ResourceRecordSet>> {
        let path = format!(
            "{}/projects/{}/managedZones/{}/rrsets",
            V1, project, zone_name
        );
        let mut query: Vec<(&str, &str)> = Vec::new();
        let type_str;
        if let Some(t) = record_type {
            type_str = t.to_string();
            query.push(("type", &type_str));
        }
        let resp: RrsetList = client.get(SERVICE, &path, &query).await?;
        Ok(resp.rrsets)
    }

    /// Create a change (add/remove records).
    pub async fn create_change(
        client: &mut GcpClient,
        project: &str,
        zone_name: &str,
        additions: Vec<ResourceRecordSet>,
        deletions: Vec<ResourceRecordSet>,
    ) -> GcpResult<Change> {
        let path = format!(
            "{}/projects/{}/managedZones/{}/changes",
            V1, project, zone_name
        );
        let body = serde_json::json!({
            "additions": additions,
            "deletions": deletions,
        });
        client.post(SERVICE, &path, &body).await
    }
}
