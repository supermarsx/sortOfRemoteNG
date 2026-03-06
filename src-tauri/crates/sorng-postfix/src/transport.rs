// ── postfix transport management ──────────────────────────────────────────────

use crate::client::{shell_escape, PostfixClient};
use crate::error::{PostfixError, PostfixResult};
use crate::types::*;

pub struct TransportManager;

impl TransportManager {
    /// List all transport table entries.
    pub async fn list(client: &PostfixClient) -> PostfixResult<Vec<PostfixTransport>> {
        let transport_path = format!("{}/transport", client.config_dir());
        let content = client
            .read_remote_file(&transport_path)
            .await
            .unwrap_or_default();
        let mut transports = Vec::new();
        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                continue;
            }
            if let Some(entry) = parse_transport_line(trimmed) {
                transports.push(entry);
            }
        }
        Ok(transports)
    }

    /// Get a specific transport entry by domain.
    pub async fn get(client: &PostfixClient, domain: &str) -> PostfixResult<PostfixTransport> {
        let all = Self::list(client).await?;
        all.into_iter()
            .find(|t| t.domain == domain)
            .ok_or_else(|| PostfixError::transport_not_found(domain))
    }

    /// Create a new transport table entry.
    pub async fn create(
        client: &PostfixClient,
        req: &CreateTransportRequest,
    ) -> PostfixResult<PostfixTransport> {
        let transport_path = format!("{}/transport", client.config_dir());
        let existing = client
            .read_remote_file(&transport_path)
            .await
            .unwrap_or_default();

        // Check for duplicates
        for line in existing.lines() {
            let trimmed = line.trim();
            if !trimmed.is_empty()
                && !trimmed.starts_with('#')
                && trimmed.split_whitespace().next() == Some(&req.domain)
            {
                return Err(PostfixError::new(
                    crate::error::PostfixErrorKind::InternalError,
                    format!("Transport entry for '{}' already exists", req.domain),
                ));
            }
        }

        let transport_value = build_transport_value(&req.transport, req.nexthop.as_deref());
        let new_line = format!("{}\t{}", req.domain, transport_value);
        let description_comment = req
            .description
            .as_ref()
            .map(|d| format!("# {}\n", d))
            .unwrap_or_default();
        let new_content = format!("{}{}{}\n", existing, description_comment, new_line);
        client
            .write_remote_file(&transport_path, &new_content)
            .await?;
        client.postmap(&transport_path).await?;

        Ok(PostfixTransport {
            domain: req.domain.clone(),
            transport: req.transport.clone(),
            nexthop: req.nexthop.clone(),
            description: req.description.clone(),
        })
    }

    /// Update an existing transport table entry.
    pub async fn update(
        client: &PostfixClient,
        domain: &str,
        req: &UpdateTransportRequest,
    ) -> PostfixResult<PostfixTransport> {
        let existing_entry = Self::get(client, domain).await?;
        let new_transport = req
            .transport
            .as_deref()
            .unwrap_or(&existing_entry.transport);
        let new_nexthop = req.nexthop.as_deref().or(existing_entry.nexthop.as_deref());

        let transport_path = format!("{}/transport", client.config_dir());
        let content = client.read_remote_file(&transport_path).await?;
        let transport_value = build_transport_value(new_transport, new_nexthop);
        let new_lines: Vec<String> = content
            .lines()
            .map(|line| {
                let trimmed = line.trim();
                if !trimmed.is_empty()
                    && !trimmed.starts_with('#')
                    && trimmed.split_whitespace().next() == Some(domain)
                {
                    format!("{}\t{}", domain, transport_value)
                } else {
                    line.to_string()
                }
            })
            .collect();
        let new_content = new_lines.join("\n") + "\n";
        client
            .write_remote_file(&transport_path, &new_content)
            .await?;
        client.postmap(&transport_path).await?;

        Ok(PostfixTransport {
            domain: domain.to_string(),
            transport: new_transport.to_string(),
            nexthop: new_nexthop.map(String::from),
            description: req.description.clone().or(existing_entry.description),
        })
    }

    /// Delete a transport table entry.
    pub async fn delete(client: &PostfixClient, domain: &str) -> PostfixResult<()> {
        let transport_path = format!("{}/transport", client.config_dir());
        let content = client.read_remote_file(&transport_path).await?;
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
        client
            .write_remote_file(&transport_path, &new_content)
            .await?;
        client.postmap(&transport_path).await
    }

    /// Test a transport entry by sending a probe message.
    pub async fn test_transport(client: &PostfixClient, domain: &str) -> PostfixResult<String> {
        let out = client
            .exec_ssh(&format!(
                "postconf -x transport_maps | xargs -I{{}} postmap -q {} {{}} 2>&1",
                shell_escape(domain)
            ))
            .await?;
        if out.stdout.trim().is_empty() {
            Ok(format!(
                "No explicit transport mapping found for '{}'",
                domain
            ))
        } else {
            Ok(format!(
                "Transport for '{}': {}",
                domain,
                out.stdout.trim()
            ))
        }
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn parse_transport_line(line: &str) -> Option<PostfixTransport> {
    let (domain, rest) = line.split_once(char::is_whitespace)?;
    let rest = rest.trim();
    let (transport, nexthop) = if let Some(idx) = rest.find(':') {
        let t = &rest[..idx];
        let nh = rest[idx + 1..].trim();
        (
            t.to_string(),
            if nh.is_empty() {
                None
            } else {
                Some(nh.to_string())
            },
        )
    } else {
        (rest.to_string(), None)
    };
    Some(PostfixTransport {
        domain: domain.trim().to_string(),
        transport,
        nexthop,
        description: None,
    })
}

fn build_transport_value(transport: &str, nexthop: Option<&str>) -> String {
    match nexthop {
        Some(nh) if !nh.is_empty() => format!("{}:{}", transport, nh),
        _ => format!("{}:", transport),
    }
}
