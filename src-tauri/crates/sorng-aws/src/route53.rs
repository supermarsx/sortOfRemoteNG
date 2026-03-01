//! AWS Route 53 DNS service client.
//!
//! Mirrors `aws-sdk-route53` types and operations. Route 53 uses REST+XML protocol.
//! It is a global service with a single endpoint.
//!
//! Reference: <https://docs.aws.amazon.com/Route53/latest/APIReference/>

use crate::client::{self, AwsClient};
use crate::error::{AwsError, AwsResult};
use serde::{Deserialize, Serialize};

const SERVICE: &str = "route53";

// ── Types ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HostedZone {
    pub id: String,
    pub name: String,
    pub caller_reference: String,
    pub config: Option<HostedZoneConfig>,
    pub resource_record_set_count: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HostedZoneConfig {
    pub comment: Option<String>,
    pub private_zone: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub enum RecordType {
    A,
    AAAA,
    CNAME,
    MX,
    NS,
    PTR,
    SOA,
    SRV,
    TXT,
    CAA,
    DS,
}

impl std::fmt::Display for RecordType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::A => write!(f, "A"),
            Self::AAAA => write!(f, "AAAA"),
            Self::CNAME => write!(f, "CNAME"),
            Self::MX => write!(f, "MX"),
            Self::NS => write!(f, "NS"),
            Self::PTR => write!(f, "PTR"),
            Self::SOA => write!(f, "SOA"),
            Self::SRV => write!(f, "SRV"),
            Self::TXT => write!(f, "TXT"),
            Self::CAA => write!(f, "CAA"),
            Self::DS => write!(f, "DS"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceRecordSet {
    pub name: String,
    pub record_type: String,
    pub ttl: Option<u32>,
    pub resource_records: Vec<ResourceRecord>,
    pub alias_target: Option<AliasTarget>,
    pub set_identifier: Option<String>,
    pub weight: Option<u32>,
    pub region: Option<String>,
    pub failover: Option<String>,
    pub health_check_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceRecord {
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AliasTarget {
    pub hosted_zone_id: String,
    pub dns_name: String,
    pub evaluate_target_health: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthCheck {
    pub id: String,
    pub caller_reference: String,
    pub health_check_config: HealthCheckConfig,
    pub health_check_version: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthCheckConfig {
    pub ip_address: Option<String>,
    pub port: Option<u16>,
    pub health_check_type: String,
    pub resource_path: Option<String>,
    pub fqdn: Option<String>,
    pub request_interval: Option<u32>,
    pub failure_threshold: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChangeInfo {
    pub id: String,
    pub status: String,
    pub submitted_at: String,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum ChangeAction {
    CREATE,
    DELETE,
    UPSERT,
}

impl std::fmt::Display for ChangeAction {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::CREATE => write!(f, "CREATE"),
            Self::DELETE => write!(f, "DELETE"),
            Self::UPSERT => write!(f, "UPSERT"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Change {
    pub action: String,
    pub resource_record_set: ResourceRecordSet,
}

// ── Route53 Client ──────────────────────────────────────────────────────

pub struct Route53Client {
    client: AwsClient,
}

impl Route53Client {
    pub fn new(client: AwsClient) -> Self {
        Self { client }
    }

    /// Lists all hosted zones.
    pub async fn list_hosted_zones(&self, max_items: Option<u32>, marker: Option<&str>) -> AwsResult<(Vec<HostedZone>, Option<String>)> {
        let mut path = "/2013-04-01/hostedzone".to_string();
        let mut qp = Vec::new();
        if let Some(mi) = max_items { qp.push(format!("maxitems={}", mi)); }
        if let Some(mk) = marker { qp.push(format!("marker={}", mk)); }
        if !qp.is_empty() { path = format!("{}?{}", path, qp.join("&")); }
        let response = self.client.rest_xml_request(SERVICE, "GET", &path, None).await?;
        let zones = self.parse_hosted_zones(&response.body);
        let next_marker = client::xml_text(&response.body, "NextMarker");
        Ok((zones, next_marker))
    }

    /// Gets a specific hosted zone.
    pub async fn get_hosted_zone(&self, zone_id: &str) -> AwsResult<HostedZone> {
        let clean_id = zone_id.trim_start_matches("/hostedzone/");
        let path = format!("/2013-04-01/hostedzone/{}", clean_id);
        let response = self.client.rest_xml_request(SERVICE, "GET", &path, None).await?;
        self.parse_hosted_zones(&response.body)
            .into_iter()
            .next()
            .ok_or_else(|| AwsError::new(SERVICE, "NoSuchHostedZone", &format!("Zone {} not found", zone_id), 404))
    }

    /// Creates a new hosted zone.
    pub async fn create_hosted_zone(&self, name: &str, comment: Option<&str>, private_zone: bool, vpc_id: Option<&str>, vpc_region: Option<&str>) -> AwsResult<(HostedZone, ChangeInfo)> {
        let caller_ref = uuid::Uuid::new_v4().to_string();
        let mut xml = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<CreateHostedZoneRequest xmlns="https://route53.amazonaws.com/doc/2013-04-01/">
  <Name>{}</Name>
  <CallerReference>{}</CallerReference>"#,
            name, caller_ref
        );
        if comment.is_some() || private_zone {
            xml.push_str("  <HostedZoneConfig>");
            if let Some(c) = comment {
                xml.push_str(&format!("    <Comment>{}</Comment>", c));
            }
            xml.push_str(&format!("    <PrivateZone>{}</PrivateZone>", private_zone));
            xml.push_str("  </HostedZoneConfig>");
        }
        if let (Some(vid), Some(vr)) = (vpc_id, vpc_region) {
            xml.push_str(&format!(
                "  <VPC><VPCId>{}</VPCId><VPCRegion>{}</VPCRegion></VPC>",
                vid, vr
            ));
        }
        xml.push_str("</CreateHostedZoneRequest>");
        let response = self.client.rest_xml_request(SERVICE, "POST", "/2013-04-01/hostedzone", Some(&xml)).await?;
        let zone = self.parse_hosted_zones(&response.body)
            .into_iter()
            .next()
            .ok_or_else(|| AwsError::new(SERVICE, "ParseError", "No zone in CreateHostedZone response", 200))?;
        let change_info = self.parse_change_info(&response.body)
            .unwrap_or(ChangeInfo { id: String::new(), status: "PENDING".to_string(), submitted_at: String::new(), comment: None });
        Ok((zone, change_info))
    }

    /// Deletes a hosted zone.
    pub async fn delete_hosted_zone(&self, zone_id: &str) -> AwsResult<ChangeInfo> {
        let clean_id = zone_id.trim_start_matches("/hostedzone/");
        let path = format!("/2013-04-01/hostedzone/{}", clean_id);
        let response = self.client.rest_xml_request(SERVICE, "DELETE", &path, None).await?;
        self.parse_change_info(&response.body)
            .ok_or_else(|| AwsError::new(SERVICE, "ParseError", "No ChangeInfo in response", 200))
    }

    /// Lists resource record sets for a hosted zone.
    pub async fn list_resource_record_sets(&self, zone_id: &str, start_record_name: Option<&str>, start_record_type: Option<&str>, max_items: Option<u32>) -> AwsResult<Vec<ResourceRecordSet>> {
        let clean_id = zone_id.trim_start_matches("/hostedzone/");
        let mut path = format!("/2013-04-01/hostedzone/{}/rrset", clean_id);
        let mut qp = Vec::new();
        if let Some(srn) = start_record_name { qp.push(format!("name={}", srn)); }
        if let Some(srt) = start_record_type { qp.push(format!("type={}", srt)); }
        if let Some(mi) = max_items { qp.push(format!("maxitems={}", mi)); }
        if !qp.is_empty() { path = format!("{}?{}", path, qp.join("&")); }
        let response = self.client.rest_xml_request(SERVICE, "GET", &path, None).await?;
        Ok(self.parse_resource_record_sets(&response.body))
    }

    /// Changes resource record sets (create, delete, or upsert).
    pub async fn change_resource_record_sets(&self, zone_id: &str, changes: &[Change], comment: Option<&str>) -> AwsResult<ChangeInfo> {
        let clean_id = zone_id.trim_start_matches("/hostedzone/");
        let path = format!("/2013-04-01/hostedzone/{}/rrset", clean_id);
        let mut xml = String::from(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<ChangeResourceRecordSetsRequest xmlns="https://route53.amazonaws.com/doc/2013-04-01/">
  <ChangeBatch>"#
        );
        if let Some(c) = comment {
            xml.push_str(&format!("    <Comment>{}</Comment>", c));
        }
        xml.push_str("    <Changes>");
        for change in changes {
            xml.push_str(&format!("      <Change><Action>{}</Action>", change.action));
            xml.push_str("        <ResourceRecordSet>");
            xml.push_str(&format!("          <Name>{}</Name>", change.resource_record_set.name));
            xml.push_str(&format!("          <Type>{}</Type>", change.resource_record_set.record_type));
            if let Some(ttl) = change.resource_record_set.ttl {
                xml.push_str(&format!("          <TTL>{}</TTL>", ttl));
            }
            if !change.resource_record_set.resource_records.is_empty() {
                xml.push_str("          <ResourceRecords>");
                for rr in &change.resource_record_set.resource_records {
                    xml.push_str(&format!("            <ResourceRecord><Value>{}</Value></ResourceRecord>", rr.value));
                }
                xml.push_str("          </ResourceRecords>");
            }
            if let Some(ref alias) = change.resource_record_set.alias_target {
                xml.push_str("          <AliasTarget>");
                xml.push_str(&format!("            <HostedZoneId>{}</HostedZoneId>", alias.hosted_zone_id));
                xml.push_str(&format!("            <DNSName>{}</DNSName>", alias.dns_name));
                xml.push_str(&format!("            <EvaluateTargetHealth>{}</EvaluateTargetHealth>", alias.evaluate_target_health));
                xml.push_str("          </AliasTarget>");
            }
            xml.push_str("        </ResourceRecordSet>");
            xml.push_str("      </Change>");
        }
        xml.push_str("    </Changes>");
        xml.push_str("  </ChangeBatch>");
        xml.push_str("</ChangeResourceRecordSetsRequest>");
        let response = self.client.rest_xml_request(SERVICE, "POST", &path, Some(&xml)).await?;
        self.parse_change_info(&response.body)
            .ok_or_else(|| AwsError::new(SERVICE, "ParseError", "No ChangeInfo in response", 200))
    }

    // ── Health Checks ───────────────────────────────────────────────

    pub async fn list_health_checks(&self) -> AwsResult<Vec<HealthCheck>> {
        let response = self.client.rest_xml_request(SERVICE, "GET", "/2013-04-01/healthcheck", None).await?;
        Ok(self.parse_health_checks(&response.body))
    }

    pub async fn create_health_check(&self, config: &HealthCheckConfig) -> AwsResult<HealthCheck> {
        let caller_ref = uuid::Uuid::new_v4().to_string();
        let mut xml = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<CreateHealthCheckRequest xmlns="https://route53.amazonaws.com/doc/2013-04-01/">
  <CallerReference>{}</CallerReference>
  <HealthCheckConfig>
    <Type>{}</Type>"#,
            caller_ref, config.health_check_type
        );
        if let Some(ref ip) = config.ip_address { xml.push_str(&format!("    <IPAddress>{}</IPAddress>", ip)); }
        if let Some(p) = config.port { xml.push_str(&format!("    <Port>{}</Port>", p)); }
        if let Some(ref rp) = config.resource_path { xml.push_str(&format!("    <ResourcePath>{}</ResourcePath>", rp)); }
        if let Some(ref f) = config.fqdn { xml.push_str(&format!("    <FullyQualifiedDomainName>{}</FullyQualifiedDomainName>", f)); }
        if let Some(ri) = config.request_interval { xml.push_str(&format!("    <RequestInterval>{}</RequestInterval>", ri)); }
        if let Some(ft) = config.failure_threshold { xml.push_str(&format!("    <FailureThreshold>{}</FailureThreshold>", ft)); }
        xml.push_str("  </HealthCheckConfig>");
        xml.push_str("</CreateHealthCheckRequest>");
        let response = self.client.rest_xml_request(SERVICE, "POST", "/2013-04-01/healthcheck", Some(&xml)).await?;
        self.parse_health_checks(&response.body)
            .into_iter()
            .next()
            .ok_or_else(|| AwsError::new(SERVICE, "ParseError", "No HealthCheck in response", 200))
    }

    pub async fn delete_health_check(&self, health_check_id: &str) -> AwsResult<()> {
        let path = format!("/2013-04-01/healthcheck/{}", health_check_id);
        self.client.rest_xml_request(SERVICE, "DELETE", &path, None).await?;
        Ok(())
    }

    // ── XML Parsers ─────────────────────────────────────────────────

    fn parse_hosted_zones(&self, xml: &str) -> Vec<HostedZone> {
        client::xml_blocks(xml, "HostedZone").iter().filter_map(|b| {
            Some(HostedZone {
                id: client::xml_text(b, "Id")?,
                name: client::xml_text(b, "Name")?,
                caller_reference: client::xml_text(b, "CallerReference").unwrap_or_default(),
                config: client::xml_block(b, "Config").map(|cb| HostedZoneConfig {
                    comment: client::xml_text(&cb, "Comment"),
                    private_zone: client::xml_text(&cb, "PrivateZone").map(|v| v == "true").unwrap_or(false),
                }),
                resource_record_set_count: client::xml_text(b, "ResourceRecordSetCount").and_then(|v| v.parse().ok()),
            })
        }).collect()
    }

    fn parse_resource_record_sets(&self, xml: &str) -> Vec<ResourceRecordSet> {
        client::xml_blocks(xml, "ResourceRecordSet").iter().filter_map(|b| {
            Some(ResourceRecordSet {
                name: client::xml_text(b, "Name")?,
                record_type: client::xml_text(b, "Type")?,
                ttl: client::xml_text(b, "TTL").and_then(|v| v.parse().ok()),
                resource_records: client::xml_blocks(b, "ResourceRecord").iter().filter_map(|rr| {
                    Some(ResourceRecord { value: client::xml_text(rr, "Value")? })
                }).collect(),
                alias_target: client::xml_block(b, "AliasTarget").map(|ab| AliasTarget {
                    hosted_zone_id: client::xml_text(&ab, "HostedZoneId").unwrap_or_default(),
                    dns_name: client::xml_text(&ab, "DNSName").unwrap_or_default(),
                    evaluate_target_health: client::xml_text(&ab, "EvaluateTargetHealth").map(|v| v == "true").unwrap_or(false),
                }),
                set_identifier: client::xml_text(b, "SetIdentifier"),
                weight: client::xml_text(b, "Weight").and_then(|v| v.parse().ok()),
                region: client::xml_text(b, "Region"),
                failover: client::xml_text(b, "Failover"),
                health_check_id: client::xml_text(b, "HealthCheckId"),
            })
        }).collect()
    }

    fn parse_health_checks(&self, xml: &str) -> Vec<HealthCheck> {
        client::xml_blocks(xml, "HealthCheck").iter().filter_map(|b| {
            Some(HealthCheck {
                id: client::xml_text(b, "Id")?,
                caller_reference: client::xml_text(b, "CallerReference").unwrap_or_default(),
                health_check_config: {
                    let cfg_block = client::xml_block(b, "HealthCheckConfig").unwrap_or_default();
                    HealthCheckConfig {
                        ip_address: client::xml_text(&cfg_block, "IPAddress"),
                        port: client::xml_text(&cfg_block, "Port").and_then(|v| v.parse().ok()),
                        health_check_type: client::xml_text(&cfg_block, "Type").unwrap_or_default(),
                        resource_path: client::xml_text(&cfg_block, "ResourcePath"),
                        fqdn: client::xml_text(&cfg_block, "FullyQualifiedDomainName"),
                        request_interval: client::xml_text(&cfg_block, "RequestInterval").and_then(|v| v.parse().ok()),
                        failure_threshold: client::xml_text(&cfg_block, "FailureThreshold").and_then(|v| v.parse().ok()),
                    }
                },
                health_check_version: client::xml_text(b, "HealthCheckVersion").and_then(|v| v.parse().ok()).unwrap_or(1),
            })
        }).collect()
    }

    fn parse_change_info(&self, xml: &str) -> Option<ChangeInfo> {
        let block = client::xml_block(xml, "ChangeInfo")?;
        Some(ChangeInfo {
            id: client::xml_text(&block, "Id")?,
            status: client::xml_text(&block, "Status")?,
            submitted_at: client::xml_text(&block, "SubmittedAt").unwrap_or_default(),
            comment: client::xml_text(&block, "Comment"),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn record_type_display() {
        assert_eq!(RecordType::A.to_string(), "A");
        assert_eq!(RecordType::CNAME.to_string(), "CNAME");
        assert_eq!(RecordType::MX.to_string(), "MX");
    }

    #[test]
    fn hosted_zone_serde() {
        let zone = HostedZone {
            id: "/hostedzone/Z1234".to_string(),
            name: "example.com.".to_string(),
            caller_reference: "ref-1".to_string(),
            config: Some(HostedZoneConfig { comment: Some("Main zone".to_string()), private_zone: false }),
            resource_record_set_count: Some(5),
        };
        let json = serde_json::to_string(&zone).unwrap();
        let back: HostedZone = serde_json::from_str(&json).unwrap();
        assert_eq!(back.name, "example.com.");
    }

    #[test]
    fn resource_record_set_serde() {
        let rrs = ResourceRecordSet {
            name: "www.example.com.".to_string(),
            record_type: "A".to_string(),
            ttl: Some(300),
            resource_records: vec![ResourceRecord { value: "192.0.2.1".to_string() }],
            alias_target: None,
            set_identifier: None,
            weight: None,
            region: None,
            failover: None,
            health_check_id: None,
        };
        let json = serde_json::to_string(&rrs).unwrap();
        assert!(json.contains("192.0.2.1"));
    }
}
