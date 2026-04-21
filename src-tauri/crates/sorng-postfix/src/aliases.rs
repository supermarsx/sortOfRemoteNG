// ── postfix alias management ─────────────────────────────────────────────────

use crate::client::PostfixClient;
use crate::error::{PostfixError, PostfixResult};
use crate::types::*;

pub struct AliasManager;

impl AliasManager {
    /// List all aliases (both virtual and local).
    pub async fn list(client: &PostfixClient) -> PostfixResult<Vec<PostfixAlias>> {
        let mut aliases = Vec::new();
        aliases.extend(Self::list_virtual(client).await?);
        aliases.extend(Self::list_local(client).await?);
        Ok(aliases)
    }

    /// List virtual aliases from virtual_alias_maps.
    pub async fn list_virtual(client: &PostfixClient) -> PostfixResult<Vec<PostfixAlias>> {
        let virtual_path = format!("{}/virtual", client.config_dir());
        let content = client
            .read_remote_file(&virtual_path)
            .await
            .unwrap_or_default();
        let mut aliases = Vec::new();
        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                continue;
            }
            if let Some((address, recipients_raw)) = trimmed.split_once(char::is_whitespace) {
                let recipients: Vec<String> = recipients_raw
                    .split(',')
                    .map(|r| r.trim().to_string())
                    .filter(|r| !r.is_empty())
                    .collect();
                aliases.push(PostfixAlias {
                    address: address.trim().to_string(),
                    recipients,
                    alias_type: AliasType::Virtual,
                    enabled: !trimmed.starts_with('#'),
                });
            }
        }
        Ok(aliases)
    }

    /// List local aliases from /etc/aliases or alias_maps.
    pub async fn list_local(client: &PostfixClient) -> PostfixResult<Vec<PostfixAlias>> {
        let aliases_path = "/etc/aliases".to_string();
        let content = client
            .read_remote_file(&aliases_path)
            .await
            .unwrap_or_default();
        let mut aliases = Vec::new();
        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                continue;
            }
            if let Some((address, recipients_raw)) = trimmed.split_once(':') {
                let recipients: Vec<String> = recipients_raw
                    .split(',')
                    .map(|r| r.trim().to_string())
                    .filter(|r| !r.is_empty())
                    .collect();
                aliases.push(PostfixAlias {
                    address: address.trim().to_string(),
                    recipients,
                    alias_type: AliasType::Local,
                    enabled: true,
                });
            }
        }
        Ok(aliases)
    }

    /// Get a specific alias by address.
    pub async fn get(client: &PostfixClient, address: &str) -> PostfixResult<PostfixAlias> {
        let all = Self::list(client).await?;
        all.into_iter()
            .find(|a| a.address == address)
            .ok_or_else(|| PostfixError::alias_not_found(address))
    }

    /// Create a new alias.
    pub async fn create(
        client: &PostfixClient,
        req: &CreateAliasRequest,
    ) -> PostfixResult<PostfixAlias> {
        match req.alias_type {
            AliasType::Virtual => {
                let virtual_path = format!("{}/virtual", client.config_dir());
                let existing = client
                    .read_remote_file(&virtual_path)
                    .await
                    .unwrap_or_default();
                // Check for duplicates
                for line in existing.lines() {
                    let trimmed = line.trim();
                    if !trimmed.is_empty()
                        && !trimmed.starts_with('#')
                        && trimmed.split_whitespace().next() == Some(&req.address)
                    {
                        return Err(PostfixError::new(
                            crate::error::PostfixErrorKind::InternalError,
                            format!("Virtual alias '{}' already exists", req.address),
                        ));
                    }
                }
                let recipients_str = req.recipients.join(", ");
                let new_content = format!("{}{}\t{}\n", existing, req.address, recipients_str);
                client
                    .write_remote_file(&virtual_path, &new_content)
                    .await?;
                client.postmap(&virtual_path).await?;
            }
            AliasType::Local => {
                let aliases_path = "/etc/aliases".to_string();
                let existing = client
                    .read_remote_file(&aliases_path)
                    .await
                    .unwrap_or_default();
                let recipients_str = req.recipients.join(", ");
                let new_content = format!("{}{}:\t{}\n", existing, req.address, recipients_str);
                client
                    .write_remote_file(&aliases_path, &new_content)
                    .await?;
                // Rebuild local alias database
                let out = client.exec_ssh("sudo newaliases").await?;
                if out.exit_code != 0 {
                    return Err(PostfixError::io(format!(
                        "newaliases failed: {}",
                        out.stderr
                    )));
                }
            }
        }
        Ok(PostfixAlias {
            address: req.address.clone(),
            recipients: req.recipients.clone(),
            alias_type: req.alias_type.clone(),
            enabled: true,
        })
    }

    /// Update an existing alias.
    pub async fn update(
        client: &PostfixClient,
        address: &str,
        req: &UpdateAliasRequest,
    ) -> PostfixResult<PostfixAlias> {
        let existing = Self::get(client, address).await?;
        let new_recipients = req.recipients.as_ref().unwrap_or(&existing.recipients);
        let new_alias_type = req.alias_type.as_ref().unwrap_or(&existing.alias_type);
        let new_enabled = req.enabled.unwrap_or(existing.enabled);

        // If alias type changed, remove from old location and add to new
        let type_changed = !matches!(
            (&existing.alias_type, new_alias_type),
            (AliasType::Virtual, AliasType::Virtual) | (AliasType::Local, AliasType::Local)
        );

        if type_changed {
            // Remove from old
            Self::delete(client, address).await?;
            // Create in new
            let create_req = CreateAliasRequest {
                address: address.to_string(),
                recipients: new_recipients.clone(),
                alias_type: new_alias_type.clone(),
            };
            return Self::create(client, &create_req).await;
        }

        // Update in place
        match existing.alias_type {
            AliasType::Virtual => {
                let virtual_path = format!("{}/virtual", client.config_dir());
                let content = client.read_remote_file(&virtual_path).await?;
                let recipients_str = new_recipients.join(", ");
                let new_lines: Vec<String> = content
                    .lines()
                    .map(|line| {
                        let trimmed = line.trim();
                        if !trimmed.is_empty()
                            && !trimmed.starts_with('#')
                            && trimmed.split_whitespace().next() == Some(address)
                        {
                            if new_enabled {
                                format!("{}\t{}", address, recipients_str)
                            } else {
                                format!("#{}\t{}", address, recipients_str)
                            }
                        } else {
                            line.to_string()
                        }
                    })
                    .collect();
                let new_content = new_lines.join("\n") + "\n";
                client
                    .write_remote_file(&virtual_path, &new_content)
                    .await?;
                client.postmap(&virtual_path).await?;
            }
            AliasType::Local => {
                let aliases_path = "/etc/aliases".to_string();
                let content = client.read_remote_file(&aliases_path).await?;
                let recipients_str = new_recipients.join(", ");
                let new_lines: Vec<String> = content
                    .lines()
                    .map(|line| {
                        let trimmed = line.trim();
                        if let Some((addr, _)) = trimmed.split_once(':') {
                            if addr.trim() == address {
                                return format!("{}:\t{}", address, recipients_str);
                            }
                        }
                        line.to_string()
                    })
                    .collect();
                let new_content = new_lines.join("\n") + "\n";
                client
                    .write_remote_file(&aliases_path, &new_content)
                    .await?;
                let out = client.exec_ssh("sudo newaliases").await?;
                if out.exit_code != 0 {
                    return Err(PostfixError::io(format!(
                        "newaliases failed: {}",
                        out.stderr
                    )));
                }
            }
        }

        Ok(PostfixAlias {
            address: address.to_string(),
            recipients: new_recipients.clone(),
            alias_type: new_alias_type.clone(),
            enabled: new_enabled,
        })
    }

    /// Delete an alias by address.
    pub async fn delete(client: &PostfixClient, address: &str) -> PostfixResult<()> {
        let existing = Self::get(client, address).await?;
        match existing.alias_type {
            AliasType::Virtual => {
                let virtual_path = format!("{}/virtual", client.config_dir());
                let content = client.read_remote_file(&virtual_path).await?;
                let new_lines: Vec<&str> = content
                    .lines()
                    .filter(|line| {
                        let trimmed = line.trim();
                        trimmed.is_empty()
                            || trimmed.starts_with('#')
                            || trimmed.split_whitespace().next() != Some(address)
                    })
                    .collect();
                let new_content = new_lines.join("\n") + "\n";
                client
                    .write_remote_file(&virtual_path, &new_content)
                    .await?;
                client.postmap(&virtual_path).await?;
            }
            AliasType::Local => {
                let aliases_path = "/etc/aliases".to_string();
                let content = client.read_remote_file(&aliases_path).await?;
                let new_lines: Vec<&str> = content
                    .lines()
                    .filter(|line| {
                        let trimmed = line.trim();
                        if let Some((addr, _)) = trimmed.split_once(':') {
                            addr.trim() != address
                        } else {
                            true
                        }
                    })
                    .collect();
                let new_content = new_lines.join("\n") + "\n";
                client
                    .write_remote_file(&aliases_path, &new_content)
                    .await?;
                let out = client.exec_ssh("sudo newaliases").await?;
                if out.exit_code != 0 {
                    return Err(PostfixError::io(format!(
                        "newaliases failed: {}",
                        out.stderr
                    )));
                }
            }
        }
        Ok(())
    }
}
