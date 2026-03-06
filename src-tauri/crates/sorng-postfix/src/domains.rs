// ── postfix domain management ────────────────────────────────────────────────

use crate::client::PostfixClient;
use crate::error::{PostfixError, PostfixResult};
use crate::types::*;

pub struct DomainManager;

impl DomainManager {
    /// List all configured domains across virtual_mailbox_domains, relay_domains,
    /// and mydestination.
    pub async fn list(client: &PostfixClient) -> PostfixResult<Vec<PostfixDomain>> {
        let mut domains = Vec::new();

        // Virtual domains
        let virtual_raw = client.postconf("virtual_mailbox_domains").await.unwrap_or_default();
        for d in parse_domain_list(&virtual_raw) {
            domains.push(PostfixDomain {
                domain: d,
                domain_type: DomainType::Virtual,
                transport: None,
                description: Some("Virtual mailbox domain".into()),
            });
        }

        // Relay domains
        let relay_raw = client.postconf("relay_domains").await.unwrap_or_default();
        for d in parse_domain_list(&relay_raw) {
            domains.push(PostfixDomain {
                domain: d,
                domain_type: DomainType::Relay,
                transport: None,
                description: Some("Relay domain".into()),
            });
        }

        // Local domains (mydestination)
        let local_raw = client.postconf("mydestination").await.unwrap_or_default();
        for d in parse_domain_list(&local_raw) {
            domains.push(PostfixDomain {
                domain: d,
                domain_type: DomainType::Local,
                transport: None,
                description: Some("Local destination".into()),
            });
        }

        // Augment with transport info from transport table
        let transport_path = format!("{}/transport", client.config_dir());
        if let Ok(content) = client.read_remote_file(&transport_path).await {
            for line in content.lines() {
                let trimmed = line.trim();
                if trimmed.is_empty() || trimmed.starts_with('#') {
                    continue;
                }
                if let Some((domain_key, transport_val)) = trimmed.split_once(char::is_whitespace) {
                    if let Some(entry) = domains.iter_mut().find(|d| d.domain == domain_key.trim()) {
                        entry.transport = Some(transport_val.trim().to_string());
                    }
                }
            }
        }

        Ok(domains)
    }

    /// Get details for a specific domain.
    pub async fn get(client: &PostfixClient, domain: &str) -> PostfixResult<PostfixDomain> {
        let all = Self::list(client).await?;
        all.into_iter()
            .find(|d| d.domain == domain)
            .ok_or_else(|| PostfixError::domain_not_found(domain))
    }

    /// Create a new domain entry.
    pub async fn create(
        client: &PostfixClient,
        req: &CreateDomainRequest,
    ) -> PostfixResult<PostfixDomain> {
        let param_name = match req.domain_type {
            DomainType::Virtual => "virtual_mailbox_domains",
            DomainType::Relay => "relay_domains",
            DomainType::Local => "mydestination",
        };
        let current = client.postconf(param_name).await.unwrap_or_default();
        let mut entries = parse_domain_list(&current);
        if entries.iter().any(|d| d == &req.domain) {
            return Err(PostfixError::new(
                crate::error::PostfixErrorKind::InternalError,
                format!("Domain '{}' already exists in {}", req.domain, param_name),
            ));
        }
        entries.push(req.domain.clone());
        let new_value = entries.join(", ");
        client.postconf_set(param_name, &new_value).await?;

        // Add transport entry if provided
        if let Some(ref transport) = req.transport {
            let transport_path = format!("{}/transport", client.config_dir());
            let existing = client.read_remote_file(&transport_path).await.unwrap_or_default();
            let new_content = format!("{}{}\t{}\n", existing, req.domain, transport);
            client.write_remote_file(&transport_path, &new_content).await?;
            client.postmap(&transport_path).await?;
        }

        Ok(PostfixDomain {
            domain: req.domain.clone(),
            domain_type: req.domain_type.clone(),
            transport: req.transport.clone(),
            description: req.description.clone(),
        })
    }

    /// Update a domain entry (change type, transport, or description).
    pub async fn update(
        client: &PostfixClient,
        domain: &str,
        req: &UpdateDomainRequest,
    ) -> PostfixResult<PostfixDomain> {
        let existing = Self::get(client, domain).await?;

        // If domain type changed, remove from old list and add to new
        let new_type = req.domain_type.as_ref().unwrap_or(&existing.domain_type);
        let old_param = match existing.domain_type {
            DomainType::Virtual => "virtual_mailbox_domains",
            DomainType::Relay => "relay_domains",
            DomainType::Local => "mydestination",
        };
        let new_param = match new_type {
            DomainType::Virtual => "virtual_mailbox_domains",
            DomainType::Relay => "relay_domains",
            DomainType::Local => "mydestination",
        };
        if old_param != new_param {
            // Remove from old
            let old_val = client.postconf(old_param).await.unwrap_or_default();
            let old_entries: Vec<String> = parse_domain_list(&old_val)
                .into_iter()
                .filter(|d| d != domain)
                .collect();
            client
                .postconf_set(old_param, &old_entries.join(", "))
                .await?;

            // Add to new
            let new_val = client.postconf(new_param).await.unwrap_or_default();
            let mut new_entries = parse_domain_list(&new_val);
            new_entries.push(domain.to_string());
            client
                .postconf_set(new_param, &new_entries.join(", "))
                .await?;
        }

        // Update transport if provided
        if let Some(ref transport) = req.transport {
            let transport_path = format!("{}/transport", client.config_dir());
            let content = client.read_remote_file(&transport_path).await.unwrap_or_default();
            let mut lines: Vec<String> = Vec::new();
            let mut found = false;
            for line in content.lines() {
                let trimmed = line.trim();
                if !trimmed.is_empty()
                    && !trimmed.starts_with('#')
                    && trimmed.split_whitespace().next() == Some(domain)
                {
                    lines.push(format!("{}\t{}", domain, transport));
                    found = true;
                } else {
                    lines.push(line.to_string());
                }
            }
            if !found {
                lines.push(format!("{}\t{}", domain, transport));
            }
            let new_content = lines.join("\n") + "\n";
            client.write_remote_file(&transport_path, &new_content).await?;
            client.postmap(&transport_path).await?;
        }

        Ok(PostfixDomain {
            domain: domain.to_string(),
            domain_type: new_type.clone(),
            transport: req.transport.clone().or(existing.transport),
            description: req.description.clone().or(existing.description),
        })
    }

    /// Delete a domain from all domain lists and the transport table.
    pub async fn delete(client: &PostfixClient, domain: &str) -> PostfixResult<()> {
        for param in &[
            "virtual_mailbox_domains",
            "relay_domains",
            "mydestination",
        ] {
            let current = client.postconf(param).await.unwrap_or_default();
            let entries: Vec<String> = parse_domain_list(&current)
                .into_iter()
                .filter(|d| d != domain)
                .collect();
            let new_value = entries.join(", ");
            client.postconf_set(param, &new_value).await?;
        }

        // Remove from transport table
        let transport_path = format!("{}/transport", client.config_dir());
        if let Ok(content) = client.read_remote_file(&transport_path).await {
            let new_lines: Vec<&str> = content
                .lines()
                .filter(|line| {
                    let trimmed = line.trim();
                    trimmed.is_empty()
                        || trimmed.starts_with('#')
                        || trimmed.split_whitespace().next() != Some(domain)
                })
                .collect();
            let new_content = new_lines.join("\n") + "\n";
            client.write_remote_file(&transport_path, &new_content).await?;
            client.postmap(&transport_path).await?;
        }

        Ok(())
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn parse_domain_list(raw: &str) -> Vec<String> {
    raw.split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty() && !s.starts_with('$'))
        .collect()
}
