// ── postfix milter management ────────────────────────────────────────────────

use crate::client::PostfixClient;
use crate::error::{PostfixError, PostfixResult};
use crate::types::*;

pub struct MilterManager;

impl MilterManager {
    /// List all configured milters from smtpd_milters and non_smtpd_milters.
    pub async fn list(client: &PostfixClient) -> PostfixResult<Vec<PostfixMilter>> {
        let mut milters = Vec::new();
        let smtpd_raw = client.postconf("smtpd_milters").await.unwrap_or_default();
        let non_smtpd_raw = client
            .postconf("non_smtpd_milters")
            .await
            .unwrap_or_default();

        for socket_str in smtpd_raw.split(',').chain(non_smtpd_raw.split(',')) {
            let socket = socket_str.trim().to_string();
            if socket.is_empty() {
                continue;
            }
            let name = socket
                .rsplit('/')
                .next()
                .unwrap_or(&socket)
                .to_string();
            // Avoid duplicates
            if milters.iter().any(|m: &PostfixMilter| m.socket == socket) {
                continue;
            }
            milters.push(PostfixMilter {
                name,
                socket,
                flags: None,
                protocol: None,
            });
        }

        // Enrich with milter_default_action and milter_protocol
        let flags = client
            .postconf("milter_default_action")
            .await
            .unwrap_or_default();
        let protocol = client
            .postconf("milter_protocol")
            .await
            .unwrap_or_default();
        for milter in &mut milters {
            if !flags.is_empty() {
                milter.flags = Some(flags.clone());
            }
            if !protocol.is_empty() {
                milter.protocol = Some(protocol.clone());
            }
        }

        Ok(milters)
    }

    /// Add a new milter to smtpd_milters.
    pub async fn add(
        client: &PostfixClient,
        milter: &PostfixMilter,
    ) -> PostfixResult<()> {
        let current_raw = client.postconf("smtpd_milters").await.unwrap_or_default();
        let mut sockets: Vec<String> = current_raw
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();

        if sockets.iter().any(|s| s == &milter.socket) {
            return Err(PostfixError::new(
                crate::error::PostfixErrorKind::InternalError,
                format!("Milter '{}' already configured", milter.socket),
            ));
        }

        sockets.push(milter.socket.clone());
        let new_value = sockets.join(", ");
        client.postconf_set("smtpd_milters", &new_value).await?;

        // Also add to non_smtpd_milters
        let non_smtpd_raw = client
            .postconf("non_smtpd_milters")
            .await
            .unwrap_or_default();
        let mut non_smtpd_sockets: Vec<String> = non_smtpd_raw
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        if !non_smtpd_sockets.iter().any(|s| s == &milter.socket) {
            non_smtpd_sockets.push(milter.socket.clone());
            let new_non_smtpd_value = non_smtpd_sockets.join(", ");
            client
                .postconf_set("non_smtpd_milters", &new_non_smtpd_value)
                .await?;
        }

        // Set milter protocol and default action if provided
        if let Some(ref protocol) = milter.protocol {
            client
                .postconf_set("milter_protocol", protocol)
                .await?;
        }
        if let Some(ref flags) = milter.flags {
            client
                .postconf_set("milter_default_action", flags)
                .await?;
        }

        Ok(())
    }

    /// Remove a milter by name (matching socket path).
    pub async fn remove(client: &PostfixClient, name: &str) -> PostfixResult<()> {
        let all = Self::list(client).await?;
        let milter = all
            .iter()
            .find(|m| m.name == name || m.socket == name)
            .ok_or_else(|| {
                PostfixError::new(
                    crate::error::PostfixErrorKind::InternalError,
                    format!("Milter '{}' not found", name),
                )
            })?;
        let socket_to_remove = milter.socket.clone();

        // Remove from smtpd_milters
        let smtpd_raw = client.postconf("smtpd_milters").await.unwrap_or_default();
        let new_smtpd: Vec<String> = smtpd_raw
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty() && s != &socket_to_remove)
            .collect();
        client
            .postconf_set("smtpd_milters", &new_smtpd.join(", "))
            .await?;

        // Remove from non_smtpd_milters
        let non_smtpd_raw = client
            .postconf("non_smtpd_milters")
            .await
            .unwrap_or_default();
        let new_non_smtpd: Vec<String> = non_smtpd_raw
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty() && s != &socket_to_remove)
            .collect();
        client
            .postconf_set("non_smtpd_milters", &new_non_smtpd.join(", "))
            .await?;

        Ok(())
    }

    /// Update a milter's configuration.
    pub async fn update(
        client: &PostfixClient,
        name: &str,
        milter: &PostfixMilter,
    ) -> PostfixResult<()> {
        let all = Self::list(client).await?;
        let existing = all
            .iter()
            .find(|m| m.name == name || m.socket == name)
            .ok_or_else(|| {
                PostfixError::new(
                    crate::error::PostfixErrorKind::InternalError,
                    format!("Milter '{}' not found", name),
                )
            })?;
        let old_socket = existing.socket.clone();

        // Replace socket in smtpd_milters
        let smtpd_raw = client.postconf("smtpd_milters").await.unwrap_or_default();
        let new_smtpd: Vec<String> = smtpd_raw
            .split(',')
            .map(|s| {
                let trimmed = s.trim().to_string();
                if trimmed == old_socket {
                    milter.socket.clone()
                } else {
                    trimmed
                }
            })
            .filter(|s| !s.is_empty())
            .collect();
        client
            .postconf_set("smtpd_milters", &new_smtpd.join(", "))
            .await?;

        // Replace socket in non_smtpd_milters
        let non_smtpd_raw = client
            .postconf("non_smtpd_milters")
            .await
            .unwrap_or_default();
        let new_non_smtpd: Vec<String> = non_smtpd_raw
            .split(',')
            .map(|s| {
                let trimmed = s.trim().to_string();
                if trimmed == old_socket {
                    milter.socket.clone()
                } else {
                    trimmed
                }
            })
            .filter(|s| !s.is_empty())
            .collect();
        client
            .postconf_set("non_smtpd_milters", &new_non_smtpd.join(", "))
            .await?;

        // Update milter protocol and default action if provided
        if let Some(ref protocol) = milter.protocol {
            client
                .postconf_set("milter_protocol", protocol)
                .await?;
        }
        if let Some(ref flags) = milter.flags {
            client
                .postconf_set("milter_default_action", flags)
                .await?;
        }

        Ok(())
    }
}
