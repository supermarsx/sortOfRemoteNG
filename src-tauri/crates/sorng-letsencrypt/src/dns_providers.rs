//! # DNS Provider Implementations
//!
//! Pluggable DNS provider interface for DNS-01 challenge automation.
//! Each provider implements the `DnsRecordManager` trait for creating
//! and deleting TXT records programmatically.

use crate::types::*;
use reqwest::Client;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::io::Write;
use std::process::{Command, Stdio};

/// A DNS record managed by a provider.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsRecord {
    /// Provider-specific record ID.
    pub id: String,
    /// Record name (e.g., "_acme-challenge.example.com").
    pub name: String,
    /// Record type (always "TXT" for ACME).
    pub record_type: String,
    /// Record value.
    pub value: String,
    /// TTL in seconds.
    pub ttl: u32,
    /// Provider that manages this record.
    pub provider: DnsProvider,
}

/// Result of a DNS operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsOperationResult {
    pub success: bool,
    pub record_id: Option<String>,
    pub message: String,
}

/// Cloudflare API response structures.
pub mod cloudflare {
    use serde::{Deserialize, Serialize};

    #[derive(Debug, Serialize)]
    pub struct CreateRecordRequest {
        #[serde(rename = "type")]
        pub record_type: String,
        pub name: String,
        pub content: String,
        pub ttl: u32,
    }

    #[derive(Debug, Deserialize)]
    pub struct CloudflareResponse<T> {
        pub success: bool,
        pub result: Option<T>,
        pub errors: Vec<CloudflareError>,
    }

    #[derive(Debug, Deserialize)]
    pub struct CloudflareError {
        pub code: u32,
        pub message: String,
    }

    #[derive(Debug, Deserialize)]
    pub struct DnsRecordResult {
        pub id: String,
        pub name: String,
        pub content: String,
        pub ttl: u32,
    }
}

/// AWS Route 53 API structures.
pub mod route53 {
    use serde::{Deserialize, Serialize};

    #[derive(Debug, Serialize)]
    pub struct ChangeResourceRecordSetsRequest {
        pub hosted_zone_id: String,
        pub change_batch: ChangeBatch,
    }

    #[derive(Debug, Serialize)]
    pub struct ChangeBatch {
        pub comment: String,
        pub changes: Vec<Change>,
    }

    #[derive(Debug, Serialize)]
    pub struct Change {
        pub action: String, // "UPSERT", "CREATE", "DELETE"
        pub resource_record_set: ResourceRecordSet,
    }

    #[derive(Debug, Serialize)]
    pub struct ResourceRecordSet {
        pub name: String,
        #[serde(rename = "type")]
        pub record_type: String,
        pub ttl: u32,
        pub resource_records: Vec<ResourceRecord>,
    }

    #[derive(Debug, Serialize)]
    pub struct ResourceRecord {
        pub value: String,
    }

    #[derive(Debug, Deserialize)]
    pub struct ChangeInfo {
        pub id: String,
        pub status: String,
    }
}

/// DigitalOcean DNS API structures.
pub mod digitalocean {
    use serde::{Deserialize, Serialize};

    #[derive(Debug, Serialize)]
    pub struct CreateRecordRequest {
        #[serde(rename = "type")]
        pub record_type: String,
        pub name: String,
        pub data: String,
        pub ttl: u32,
    }

    #[derive(Debug, Deserialize)]
    pub struct DomainRecord {
        pub id: u64,
        #[serde(rename = "type")]
        pub record_type: String,
        pub name: String,
        pub data: String,
        pub ttl: u32,
    }
}

/// Hetzner DNS API structures.
pub mod hetzner {
    use serde::{Deserialize, Serialize};

    #[derive(Debug, Serialize)]
    pub struct CreateRecordRequest {
        #[serde(rename = "type")]
        pub record_type: String,
        pub name: String,
        pub value: String,
        pub ttl: u32,
        pub zone_id: String,
    }

    #[derive(Debug, Deserialize)]
    pub struct RecordResponse {
        pub record: HetznerRecord,
    }

    #[derive(Debug, Deserialize)]
    pub struct HetznerRecord {
        pub id: String,
        pub name: String,
        pub value: String,
        pub ttl: u32,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct DnsRecordHandle {
    provider: DnsProvider,
    name: String,
    value: String,
}

#[derive(Debug, Deserialize)]
struct DigitalOceanCreateResponse {
    domain_record: digitalocean::DomainRecord,
}

#[derive(Debug, Deserialize)]
struct LinodeRecordResponse {
    id: u64,
}

#[derive(Debug, Deserialize)]
struct VultrCreateResponse {
    record: VultrRecord,
}

#[derive(Debug, Deserialize)]
struct VultrRecord {
    id: String,
}

/// Generic DNS provider manager that dispatches to the correct provider.
pub struct DnsProviderManager {
    config: DnsProviderConfig,
    http: Client,
}

impl DnsProviderManager {
    pub fn new(config: DnsProviderConfig) -> Self {
        Self {
            config,
            http: Client::new(),
        }
    }

    pub fn provider(&self) -> DnsProvider {
        self.config.provider
    }

    /// Create a TXT record for a DNS-01 challenge.
    pub async fn create_txt_record(
        &self,
        name: &str,
        value: &str,
    ) -> Result<DnsOperationResult, String> {
        log::info!(
            "[DNS Provider/{:?}] Creating TXT record: {} = {}",
            self.config.provider,
            name,
            value
        );

        match self.config.provider {
            DnsProvider::Cloudflare => self.cloudflare_create(name, value).await,
            DnsProvider::Route53 => self.route53_create(name, value).await,
            DnsProvider::DigitalOcean => self.digitalocean_create(name, value).await,
            DnsProvider::Hetzner => self.hetzner_create(name, value).await,
            DnsProvider::GoogleCloudDns => self.gcloud_create(name, value).await,
            DnsProvider::AzureDns => self.azure_create(name, value).await,
            DnsProvider::Linode => self.linode_create(name, value).await,
            DnsProvider::Vultr => self.vultr_create(name, value).await,
            DnsProvider::PowerDns => self.powerdns_create(name, value).await,
            DnsProvider::Rfc2136 => self.rfc2136_create(name, value).await,
            DnsProvider::Manual => Ok(DnsOperationResult {
                success: false,
                record_id: None,
                message: format!(
                    "Manual DNS-01 requires you to create TXT record {} = \"{}\" with TTL {}; no record was provisioned by the application",
                    name, value, self.config.ttl
                ),
            }),
            _ => self.generic_create(name, value).await,
        }
    }

    /// Delete a TXT record.
    pub async fn delete_txt_record(&self, record_id: &str) -> Result<DnsOperationResult, String> {
        log::info!(
            "[DNS Provider/{:?}] Deleting TXT record {}",
            self.config.provider,
            record_id
        );

        match self.config.provider {
            DnsProvider::Cloudflare => self.cloudflare_delete(record_id).await,
            DnsProvider::DigitalOcean => self.digitalocean_delete(record_id).await,
            DnsProvider::Hetzner => self.hetzner_delete(record_id).await,
            DnsProvider::Linode => self.linode_delete(record_id).await,
            DnsProvider::Vultr => self.vultr_delete(record_id).await,
            DnsProvider::PowerDns => self.powerdns_delete(record_id).await,
            DnsProvider::Rfc2136 => self.rfc2136_delete(record_id).await,
            DnsProvider::Manual => Ok(DnsOperationResult {
                success: false,
                record_id: Some(record_id.to_string()),
                message: "Manual DNS-01 cleanup requires you to delete the TXT record; no provider API was called".to_string(),
            }),
            _ => Err(dns_provider_unsupported(
                self.config.provider,
                "TXT record deletion",
            )),
        }
    }

    /// Verify that a TXT record has propagated to public DNS.
    pub async fn verify_propagation(
        &self,
        name: &str,
        expected_value: &str,
    ) -> Result<bool, String> {
        log::info!(
            "[DNS Provider] Verifying propagation of {} = {}",
            name,
            expected_value
        );

        let output = std::process::Command::new("nslookup")
            .arg("-type=TXT")
            .arg(name)
            .output()
            .map_err(|e| format!("Failed to run nslookup for DNS propagation check: {}", e))?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        if !output.status.success() {
            log::debug!(
                "[DNS Provider] nslookup for {} exited with {:?}: {}",
                name,
                output.status.code(),
                stderr
            );
            return Ok(false);
        }

        Ok(stdout.contains(expected_value) || stderr.contains(expected_value))
    }

    // ── Provider-specific implementations ─────────────────────────

    async fn cloudflare_create(
        &self,
        name: &str,
        value: &str,
    ) -> Result<DnsOperationResult, String> {
        let zone_id = required(self.config.zone_id.as_deref(), "Cloudflare zone_id")?;
        let api_token = required(self.config.api_token.as_deref(), "Cloudflare api_token")?;
        let record_name = absolute_record_name(name);
        let url = format!("https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records");
        let body = json!({
            "type": "TXT",
            "name": record_name,
            "content": value,
            "ttl": self.config.ttl,
        });

        let response: cloudflare::CloudflareResponse<cloudflare::DnsRecordResult> =
            parse_json_response(
                self.http
                    .post(url)
                    .bearer_auth(api_token)
                    .json(&body)
                    .send()
                    .await,
                "Cloudflare TXT record creation",
            )
            .await?;
        let record = response.result.ok_or_else(|| {
            format!(
                "Cloudflare TXT record creation failed: {}",
                cloudflare_errors(&response.errors)
            )
        })?;
        if !response.success {
            return Err(format!(
                "Cloudflare TXT record creation failed: {}",
                cloudflare_errors(&response.errors)
            ));
        }

        Ok(DnsOperationResult {
            success: true,
            record_id: Some(record.id),
            message: format!("Cloudflare TXT record created: {}", record.name),
        })
    }

    async fn route53_create(&self, _name: &str, value: &str) -> Result<DnsOperationResult, String> {
        let _hosted_zone_id = self
            .config
            .hosted_zone_id
            .as_ref()
            .ok_or("Route 53 hosted_zone_id required")?;

        let _ = value;
        Err("DNS provider Route53 TXT record creation is unsupported: Route 53 requires AWS SigV4 request signing or the AWS SDK, which is intentionally not pulled into this lightweight DNS automation path".to_string())
    }

    async fn digitalocean_create(
        &self,
        name: &str,
        value: &str,
    ) -> Result<DnsOperationResult, String> {
        let api_token = required(self.config.api_token.as_deref(), "DigitalOcean api_token")?;
        let domain = required(
            self.config.zone_id.as_deref(),
            "DigitalOcean zone_id (domain name)",
        )?;
        let record_name = relative_record_name(name, domain);
        let url = format!("https://api.digitalocean.com/v2/domains/{domain}/records");
        let body = json!({
            "type": "TXT",
            "name": record_name,
            "data": value,
            "ttl": self.config.ttl,
        });

        let response: DigitalOceanCreateResponse = parse_json_response(
            self.http
                .post(url)
                .bearer_auth(api_token)
                .json(&body)
                .send()
                .await,
            "DigitalOcean TXT record creation",
        )
        .await?;

        Ok(DnsOperationResult {
            success: true,
            record_id: Some(response.domain_record.id.to_string()),
            message: format!(
                "DigitalOcean TXT record created: {}",
                response.domain_record.name
            ),
        })
    }

    async fn hetzner_create(&self, name: &str, value: &str) -> Result<DnsOperationResult, String> {
        let api_token = required(self.config.api_token.as_deref(), "Hetzner api_token")?;
        let zone_id = required(self.config.zone_id.as_deref(), "Hetzner zone_id")?;
        let zone_name = self.config.hosted_zone_id.as_deref().unwrap_or(zone_id);
        let record_name = relative_record_name(name, zone_name);
        let url = format!(
            "https://api.hetzner.cloud/v1/zones/{zone_id}/rrsets/{record_name}/TXT/actions/add_records"
        );
        let body = json!({
            "records": [{
                "value": value,
                "comment": "ACME DNS-01 challenge"
            }]
        });
        ensure_success_response(
            self.http
                .post(url)
                .bearer_auth(api_token)
                .json(&body)
                .send()
                .await,
            "Hetzner TXT record creation",
        )
        .await?;

        Ok(DnsOperationResult {
            success: true,
            record_id: Some(record_handle(DnsProvider::Hetzner, name, value)?),
            message: format!("Hetzner TXT record created: {}", name),
        })
    }

    async fn gcloud_create(&self, _name: &str, value: &str) -> Result<DnsOperationResult, String> {
        let _ = value;
        Err("DNS provider GoogleCloudDns TXT record creation is unsupported: Google Cloud DNS requires OAuth2 service-account authentication and change-set handling, which is outside this lightweight token/basic REST lane".to_string())
    }

    async fn azure_create(&self, _name: &str, value: &str) -> Result<DnsOperationResult, String> {
        let _ = value;
        Err("DNS provider AzureDns TXT record creation is unsupported: Azure DNS requires Azure AD OAuth and ARM record-set semantics, which is outside this lightweight token/basic REST lane".to_string())
    }

    async fn rfc2136_create(&self, name: &str, value: &str) -> Result<DnsOperationResult, String> {
        log::info!(
            "[DNS/RFC2136] nsupdate TXT {} = \"{}\" TTL {}",
            name,
            value,
            self.config.ttl
        );
        self.run_nsupdate(&format!(
            "update add {} {} TXT {}\nsend\n",
            nsupdate_name(name),
            self.config.ttl,
            quoted_txt(value)
        ))?;

        Ok(DnsOperationResult {
            success: true,
            record_id: Some(record_handle(DnsProvider::Rfc2136, name, value)?),
            message: format!("RFC 2136 TXT record created: {}", name),
        })
    }

    async fn linode_create(&self, name: &str, value: &str) -> Result<DnsOperationResult, String> {
        let api_token = required(self.config.api_token.as_deref(), "Linode api_token")?;
        let domain_id = required(self.config.zone_id.as_deref(), "Linode zone_id (domain ID)")?;
        let zone_name = self.config.hosted_zone_id.as_deref().unwrap_or(domain_id);
        let record_name = relative_record_name(name, zone_name);
        let url = format!("https://api.linode.com/v4/domains/{domain_id}/records");
        let body = json!({
            "type": "TXT",
            "name": record_name,
            "target": value,
            "ttl_sec": self.config.ttl,
        });

        let response: LinodeRecordResponse = parse_json_response(
            self.http
                .post(url)
                .bearer_auth(api_token)
                .json(&body)
                .send()
                .await,
            "Linode TXT record creation",
        )
        .await?;

        Ok(DnsOperationResult {
            success: true,
            record_id: Some(response.id.to_string()),
            message: format!("Linode TXT record created: {}", name),
        })
    }

    async fn vultr_create(&self, name: &str, value: &str) -> Result<DnsOperationResult, String> {
        let api_token = required(self.config.api_token.as_deref(), "Vultr api_token")?;
        let domain = required(
            self.config.zone_id.as_deref(),
            "Vultr zone_id (domain name)",
        )?;
        let record_name = relative_record_name(name, domain);
        let url = format!("https://api.vultr.com/v2/domains/{domain}/records");
        let body = json!({
            "type": "TXT",
            "name": record_name,
            "data": value,
            "ttl": self.config.ttl,
        });

        let response: VultrCreateResponse = parse_json_response(
            self.http
                .post(url)
                .bearer_auth(api_token)
                .json(&body)
                .send()
                .await,
            "Vultr TXT record creation",
        )
        .await?;

        Ok(DnsOperationResult {
            success: true,
            record_id: Some(response.record.id),
            message: format!("Vultr TXT record created: {}", name),
        })
    }

    async fn powerdns_create(&self, name: &str, value: &str) -> Result<DnsOperationResult, String> {
        let record_name = absolute_record_name_with_dot(name);
        let content = quoted_txt(value);
        let body = json!({
            "rrsets": [{
                "name": record_name,
                "type": "TXT",
                "changetype": "EXTEND",
                "ttl": self.config.ttl,
                "records": [{
                    "content": content,
                    "disabled": false
                }]
            }]
        });
        self.powerdns_patch(body, "PowerDNS TXT record creation")
            .await?;

        Ok(DnsOperationResult {
            success: true,
            record_id: Some(record_handle(DnsProvider::PowerDns, name, value)?),
            message: format!("PowerDNS TXT record created: {}", name),
        })
    }

    async fn cloudflare_delete(&self, record_id: &str) -> Result<DnsOperationResult, String> {
        let zone_id = required(self.config.zone_id.as_deref(), "Cloudflare zone_id")?;
        let api_token = required(self.config.api_token.as_deref(), "Cloudflare api_token")?;
        let url =
            format!("https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records/{record_id}");
        ensure_success_response(
            self.http.delete(url).bearer_auth(api_token).send().await,
            "Cloudflare TXT record deletion",
        )
        .await?;
        Ok(deleted(record_id, "Cloudflare TXT record deleted"))
    }

    async fn digitalocean_delete(&self, record_id: &str) -> Result<DnsOperationResult, String> {
        let api_token = required(self.config.api_token.as_deref(), "DigitalOcean api_token")?;
        let domain = required(
            self.config.zone_id.as_deref(),
            "DigitalOcean zone_id (domain name)",
        )?;
        let url = format!("https://api.digitalocean.com/v2/domains/{domain}/records/{record_id}");
        ensure_success_response(
            self.http.delete(url).bearer_auth(api_token).send().await,
            "DigitalOcean TXT record deletion",
        )
        .await?;
        Ok(deleted(record_id, "DigitalOcean TXT record deleted"))
    }

    async fn hetzner_delete(&self, record_id: &str) -> Result<DnsOperationResult, String> {
        let handle = parse_record_handle(record_id, DnsProvider::Hetzner)?;
        let api_token = required(self.config.api_token.as_deref(), "Hetzner api_token")?;
        let zone_id = required(self.config.zone_id.as_deref(), "Hetzner zone_id")?;
        let zone_name = self.config.hosted_zone_id.as_deref().unwrap_or(zone_id);
        let record_name = relative_record_name(&handle.name, zone_name);
        let url = format!(
            "https://api.hetzner.cloud/v1/zones/{zone_id}/rrsets/{record_name}/TXT/actions/remove_records"
        );
        let body = json!({
            "records": [{
                "value": handle.value,
                "comment": "ACME DNS-01 challenge"
            }]
        });
        ensure_success_response(
            self.http
                .post(url)
                .bearer_auth(api_token)
                .json(&body)
                .send()
                .await,
            "Hetzner TXT record deletion",
        )
        .await?;
        Ok(deleted(record_id, "Hetzner TXT record deleted"))
    }

    async fn linode_delete(&self, record_id: &str) -> Result<DnsOperationResult, String> {
        let api_token = required(self.config.api_token.as_deref(), "Linode api_token")?;
        let domain_id = required(self.config.zone_id.as_deref(), "Linode zone_id (domain ID)")?;
        let url = format!("https://api.linode.com/v4/domains/{domain_id}/records/{record_id}");
        ensure_success_response(
            self.http.delete(url).bearer_auth(api_token).send().await,
            "Linode TXT record deletion",
        )
        .await?;
        Ok(deleted(record_id, "Linode TXT record deleted"))
    }

    async fn vultr_delete(&self, record_id: &str) -> Result<DnsOperationResult, String> {
        let api_token = required(self.config.api_token.as_deref(), "Vultr api_token")?;
        let domain = required(
            self.config.zone_id.as_deref(),
            "Vultr zone_id (domain name)",
        )?;
        let url = format!("https://api.vultr.com/v2/domains/{domain}/records/{record_id}");
        ensure_success_response(
            self.http.delete(url).bearer_auth(api_token).send().await,
            "Vultr TXT record deletion",
        )
        .await?;
        Ok(deleted(record_id, "Vultr TXT record deleted"))
    }

    async fn powerdns_delete(&self, record_id: &str) -> Result<DnsOperationResult, String> {
        let handle = parse_record_handle(record_id, DnsProvider::PowerDns)?;
        let body = json!({
            "rrsets": [{
                "name": absolute_record_name_with_dot(&handle.name),
                "type": "TXT",
                "changetype": "PRUNE",
                "records": [{
                    "content": quoted_txt(&handle.value),
                    "disabled": false
                }]
            }]
        });
        self.powerdns_patch(body, "PowerDNS TXT record deletion")
            .await?;
        Ok(deleted(record_id, "PowerDNS TXT record deleted"))
    }

    async fn rfc2136_delete(&self, record_id: &str) -> Result<DnsOperationResult, String> {
        let handle = parse_record_handle(record_id, DnsProvider::Rfc2136)?;
        self.run_nsupdate(&format!(
            "update delete {} TXT {}\nsend\n",
            nsupdate_name(&handle.name),
            quoted_txt(&handle.value)
        ))?;
        Ok(deleted(record_id, "RFC 2136 TXT record deleted"))
    }

    async fn powerdns_patch(&self, body: serde_json::Value, context: &str) -> Result<(), String> {
        let base_url = required(
            self.config.api_key_id.as_deref(),
            "PowerDNS api_key_id (API base URL)",
        )?;
        let api_token = required(self.config.api_token.as_deref(), "PowerDNS api_token")?;
        let zone_id = required(self.config.zone_id.as_deref(), "PowerDNS zone_id")?;
        let server_id = self.config.api_secret.as_deref().unwrap_or("localhost");
        let url = format!(
            "{}/api/v1/servers/{}/zones/{}",
            base_url.trim_end_matches('/'),
            server_id,
            zone_id
        );

        ensure_success_response(
            self.http
                .patch(url)
                .header("X-API-Key", api_token)
                .json(&body)
                .send()
                .await,
            context,
        )
        .await
    }

    fn run_nsupdate(&self, updates: &str) -> Result<(), String> {
        let mut command = Command::new("nsupdate");
        if let Some(key_file) = self.config.api_token.as_deref().filter(|v| !v.is_empty()) {
            command.arg("-k").arg(key_file);
        }
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = command
            .spawn()
            .map_err(|e| format!("Failed to start nsupdate for RFC 2136 DNS update: {e}"))?;
        {
            let stdin = child
                .stdin
                .as_mut()
                .ok_or("Failed to open nsupdate stdin")?;
            if let Some(server) = self.config.api_key_id.as_deref().filter(|v| !v.is_empty()) {
                writeln!(stdin, "server {server}")
                    .map_err(|e| format!("Failed to write nsupdate server command: {e}"))?;
            }
            if let Some(zone) = self.config.zone_id.as_deref().filter(|v| !v.is_empty()) {
                writeln!(stdin, "zone {zone}")
                    .map_err(|e| format!("Failed to write nsupdate zone command: {e}"))?;
            }
            stdin
                .write_all(updates.as_bytes())
                .map_err(|e| format!("Failed to write nsupdate commands: {e}"))?;
        }

        let output = child
            .wait_with_output()
            .map_err(|e| format!("Failed to wait for nsupdate: {e}"))?;
        if output.status.success() {
            return Ok(());
        }

        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        Err(format!(
            "nsupdate failed with status {:?}: {}{}",
            output.status.code(),
            stdout,
            stderr
        ))
    }

    async fn generic_create(&self, name: &str, value: &str) -> Result<DnsOperationResult, String> {
        let _ = value;
        Err(dns_provider_unsupported(
            self.config.provider,
            &format!("TXT record creation for {}", name),
        ))
    }
}

fn dns_provider_unsupported(provider: DnsProvider, operation: &str) -> String {
    let reason = match provider {
        DnsProvider::Route53 => {
            "AWS Route 53 requires SigV4 request signing or the AWS SDK"
        }
        DnsProvider::GoogleCloudDns => {
            "Google Cloud DNS requires OAuth2 service-account authentication and change-set handling"
        }
        DnsProvider::AzureDns => {
            "Azure DNS requires Azure AD OAuth and ARM record-set semantics"
        }
        DnsProvider::Namecheap => {
            "Namecheap DNS updates use account/IP-gated XML APIs and do not expose a safe per-record TXT cleanup ID"
        }
        DnsProvider::GoDaddy => {
            "GoDaddy DNS record replacement APIs do not provide a safe provider-specific ID for deleting only the ACME TXT value"
        }
        DnsProvider::Ovh => {
            "OVH DNS requires consumer-key signing and refresh semantics outside this lightweight token/basic REST lane"
        }
        _ => "provider API client is not implemented",
    };
    format!(
        "DNS provider {:?} {} is unsupported: {}",
        provider, operation, reason
    )
}

fn required<'a>(value: Option<&'a str>, label: &str) -> Result<&'a str, String> {
    value
        .filter(|v| !v.trim().is_empty())
        .ok_or_else(|| format!("{label} required"))
}

async fn parse_json_response<T: DeserializeOwned>(
    response: Result<reqwest::Response, reqwest::Error>,
    context: &str,
) -> Result<T, String> {
    let response = response.map_err(|e| format!("{context} request failed: {e}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| format!("{context} response read failed: {e}"))?;
    if !status.is_success() {
        return Err(format!("{context} failed with HTTP {status}: {body}"));
    }
    serde_json::from_str(&body).map_err(|e| format!("{context} JSON parse failed: {e}: {body}"))
}

async fn ensure_success_response(
    response: Result<reqwest::Response, reqwest::Error>,
    context: &str,
) -> Result<(), String> {
    let response = response.map_err(|e| format!("{context} request failed: {e}"))?;
    let status = response.status();
    if status.is_success() {
        return Ok(());
    }
    let body = response
        .text()
        .await
        .unwrap_or_else(|e| format!("failed to read error body: {e}"));
    Err(format!("{context} failed with HTTP {status}: {body}"))
}

fn cloudflare_errors(errors: &[cloudflare::CloudflareError]) -> String {
    if errors.is_empty() {
        return "API returned no result and no error details".to_string();
    }
    errors
        .iter()
        .map(|e| format!("{}: {}", e.code, e.message))
        .collect::<Vec<_>>()
        .join("; ")
}

fn deleted(record_id: &str, message: &str) -> DnsOperationResult {
    DnsOperationResult {
        success: true,
        record_id: Some(record_id.to_string()),
        message: message.to_string(),
    }
}

pub fn dns01_record_name(domain: &str) -> String {
    format!(
        "_acme-challenge.{}",
        normalize_domain(domain.trim_start_matches("*."))
    )
}

pub(crate) fn absolute_record_name(name: &str) -> String {
    normalize_domain(name)
}

fn absolute_record_name_with_dot(name: &str) -> String {
    let name = absolute_record_name(name);
    if name.ends_with('.') {
        name
    } else {
        format!("{name}.")
    }
}

pub(crate) fn relative_record_name(name: &str, zone: &str) -> String {
    let name = normalize_domain(name);
    let zone = normalize_domain(zone);
    if zone.is_empty() {
        return name;
    }
    if name.eq_ignore_ascii_case(&zone) {
        return "@".to_string();
    }
    let suffix = format!(".{zone}");
    if name
        .to_ascii_lowercase()
        .ends_with(&suffix.to_ascii_lowercase())
    {
        name[..name.len() - suffix.len()].to_string()
    } else {
        name
    }
}

fn normalize_domain(name: &str) -> String {
    name.trim().trim_end_matches('.').to_string()
}

fn nsupdate_name(name: &str) -> String {
    absolute_record_name_with_dot(name)
}

fn quoted_txt(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}

fn record_handle(provider: DnsProvider, name: &str, value: &str) -> Result<String, String> {
    serde_json::to_string(&DnsRecordHandle {
        provider,
        name: absolute_record_name(name),
        value: value.to_string(),
    })
    .map_err(|e| format!("Failed to encode DNS record cleanup handle: {e}"))
}

fn parse_record_handle(
    record_id: &str,
    expected_provider: DnsProvider,
) -> Result<DnsRecordHandle, String> {
    let handle: DnsRecordHandle = serde_json::from_str(record_id).map_err(|e| {
        format!(
            "Invalid DNS record cleanup handle for {:?}: {e}",
            expected_provider
        )
    })?;
    if handle.provider != expected_provider {
        return Err(format!(
            "DNS record cleanup handle provider mismatch: expected {:?}, got {:?}",
            expected_provider, handle.provider
        ));
    }
    Ok(handle)
}

/// List all supported DNS providers with their display names and capabilities.
pub fn list_supported_providers() -> Vec<(DnsProvider, &'static str, bool)> {
    vec![
        (DnsProvider::Cloudflare, "Cloudflare", true),
        (DnsProvider::Route53, "AWS Route 53", false),
        (DnsProvider::DigitalOcean, "DigitalOcean", true),
        (DnsProvider::GoogleCloudDns, "Google Cloud DNS", false),
        (DnsProvider::AzureDns, "Azure DNS", false),
        (DnsProvider::Namecheap, "Namecheap", false),
        (DnsProvider::GoDaddy, "GoDaddy", false),
        (DnsProvider::Ovh, "OVH", false),
        (DnsProvider::Hetzner, "Hetzner", true),
        (DnsProvider::Linode, "Linode", true),
        (DnsProvider::Vultr, "Vultr", true),
        (DnsProvider::PowerDns, "PowerDNS", true),
        (DnsProvider::Rfc2136, "RFC 2136 (nsupdate)", true),
        (DnsProvider::Manual, "Manual", false),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dns01_record_name_normalizes_wildcard_and_trailing_dot() {
        assert_eq!(
            dns01_record_name("*.Example.COM."),
            "_acme-challenge.Example.COM"
        );
        assert_eq!(
            dns01_record_name("example.com"),
            "_acme-challenge.example.com"
        );
    }

    #[test]
    fn relative_record_name_strips_matching_zone_suffix() {
        assert_eq!(
            relative_record_name("_acme-challenge.example.com.", "example.com."),
            "_acme-challenge"
        );
        assert_eq!(relative_record_name("example.com", "example.com"), "@");
        assert_eq!(
            relative_record_name("_acme-challenge.other.test", "example.com"),
            "_acme-challenge.other.test"
        );
    }

    #[test]
    fn supported_provider_capabilities_match_implemented_automation() {
        let providers = list_supported_providers();
        let automated: Vec<DnsProvider> = providers
            .iter()
            .filter_map(|(provider, _, automated)| automated.then_some(*provider))
            .collect();

        assert_eq!(
            automated,
            vec![
                DnsProvider::Cloudflare,
                DnsProvider::DigitalOcean,
                DnsProvider::Hetzner,
                DnsProvider::Linode,
                DnsProvider::Vultr,
                DnsProvider::PowerDns,
                DnsProvider::Rfc2136,
            ]
        );
        assert!(providers
            .iter()
            .any(|(provider, _, automated)| *provider == DnsProvider::GoDaddy && !automated));
    }
}
