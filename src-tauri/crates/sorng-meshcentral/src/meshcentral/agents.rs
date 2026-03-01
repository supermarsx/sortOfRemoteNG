//! Agent management — agent download, invite links, invite emails.

use crate::meshcentral::api_client::McApiClient;
use crate::meshcentral::error::{MeshCentralError, MeshCentralResult};
use crate::meshcentral::types::*;
use serde_json::json;

impl McApiClient {
    /// Download an agent installer for a specific OS and device group.
    ///
    /// The `agent_type` field of `McAgentDownload` is provided as a `u32`
    /// matching the MeshCentral agent type IDs directly.
    pub async fn download_agent(
        &self,
        download: &McAgentDownload,
    ) -> MeshCentralResult<Vec<u8>> {
        let url = format!(
            "{}/meshagents?id={}&meshid={}",
            self.base_url.trim_end_matches('/'),
            download.agent_type,
            download.mesh_id
        );

        let data = self.download_bytes(&url).await?;

        if data.is_empty() {
            return Err(MeshCentralError::NetworkError(
                "Agent download returned empty data".to_string(),
            ));
        }

        log::info!(
            "Downloaded agent type {} for mesh {}: {} bytes",
            download.agent_type,
            download.mesh_id,
            data.len()
        );

        Ok(data)
    }

    /// Download an agent and save to a local file.
    pub async fn download_agent_to_file(
        &self,
        download: &McAgentDownload,
        output_path: &str,
    ) -> MeshCentralResult<String> {
        let data = self.download_agent(download).await?;

        tokio::fs::write(output_path, &data).await.map_err(|e| {
            MeshCentralError::FileTransferFailed(format!(
                "Failed to write agent to '{}': {}",
                output_path, e
            ))
        })?;

        Ok(format!(
            "Agent saved to {} ({} bytes)",
            output_path,
            data.len()
        ))
    }

    /// Send an email invitation to install the MeshCentral agent.
    pub async fn send_invite_email(
        &self,
        invite: &McSendInviteEmail,
    ) -> MeshCentralResult<String> {
        let mut payload = serde_json::Map::new();

        if let Some(ref gid) = invite.group_id {
            payload.insert("meshid".to_string(), json!(gid));
        }
        if let Some(ref gname) = invite.group_name {
            payload.insert("meshname".to_string(), json!(gname));
        }

        payload.insert("email".to_string(), json!(invite.email));

        if let Some(ref name) = invite.name {
            payload.insert("name".to_string(), json!(name));
        }
        if let Some(ref msg) = invite.message {
            payload.insert("msg".to_string(), json!(msg));
        }

        let resp = self.send_action("inviteAgent", payload).await?;
        let result = McApiClient::extract_result(&resp)
            .unwrap_or_else(|| format!("Invite email sent to {}", invite.email));
        Ok(result)
    }

    /// Generate an invitation link for agent installation.
    pub async fn generate_invite_link(
        &self,
        invite: &McGenerateInviteLink,
    ) -> MeshCentralResult<String> {
        let mut payload = serde_json::Map::new();

        if let Some(ref gid) = invite.group_id {
            payload.insert("meshid".to_string(), json!(gid));
        }
        if let Some(ref gname) = invite.group_name {
            payload.insert("meshname".to_string(), json!(gname));
        }

        payload.insert("expire".to_string(), json!(invite.hours));

        if invite.flags != 0 {
            payload.insert("flags".to_string(), json!(invite.flags));
        }

        let resp = self.send_action("createInviteLink", payload).await?;

        let url = resp
            .get("url")
            .and_then(|v| v.as_str())
            .or_else(|| resp.get("link").and_then(|v| v.as_str()))
            .unwrap_or("")
            .to_string();

        if url.is_empty() {
            let result = McApiClient::extract_result(&resp)
                .unwrap_or_else(|| "Invite link generated".to_string());
            Ok(result)
        } else {
            Ok(url)
        }
    }

    /// List available agent types for download.
    pub fn list_agent_types() -> Vec<(McAgentType, &'static str)> {
        vec![
            (McAgentType::Win32Console, "Windows x86 Console"),
            (McAgentType::Win64Console, "Windows x64 Console"),
            (McAgentType::Win32Service, "Windows x86 Service"),
            (McAgentType::Win64Service, "Windows x64 Service"),
            (McAgentType::Linux32, "Linux x86"),
            (McAgentType::Linux64, "Linux x86-64"),
            (McAgentType::Mips, "MIPS"),
            (McAgentType::Android, "Android"),
            (McAgentType::LinuxArm, "Linux ARM"),
            (McAgentType::MacOSx86_32, "macOS x86 32-bit"),
            (McAgentType::MacOSx86_64, "macOS x86-64"),
            (McAgentType::ChromeOS, "Chrome OS"),
            (McAgentType::ArmLinaro, "ARM Linaro"),
            (McAgentType::ArmV6V7, "ARM v6/v7"),
            (McAgentType::ArmV8_64, "ARM v8 64-bit"),
            (McAgentType::AppleSilicon, "Apple Silicon"),
            (McAgentType::FreeBSD64, "FreeBSD x86-64"),
            (McAgentType::LinuxArm64, "Linux ARM64 / aarch64"),
            (McAgentType::AlpineLinux64, "Alpine Linux x86-64"),
        ]
    }

    /// Get the mesh agent download URL for direct browser download.
    pub fn get_agent_download_url(
        &self,
        agent_type: u32,
        mesh_id: &str,
    ) -> String {
        format!(
            "{}/meshagents?id={}&meshid={}",
            self.base_url.trim_end_matches('/'),
            agent_type,
            mesh_id
        )
    }

    /// Check if an agent is currently connected for a device.
    pub async fn is_agent_connected(
        &self,
        device_id: &str,
    ) -> MeshCentralResult<bool> {
        let info = self.get_device_info(device_id).await?;
        let conn = info.device.as_ref().and_then(|d| d.conn).unwrap_or(0);
        Ok(conn & McConnState::AGENT != 0)
    }

    /// Get agent version information for a device.
    pub async fn get_agent_version(
        &self,
        device_id: &str,
    ) -> MeshCentralResult<Option<String>> {
        let info = self.get_device_info(device_id).await?;
        if let Some(ref dev) = info.device {
            if let Some(ref agent) = dev.agent {
                Ok(agent.ver.map(|v: u32| v.to_string()))
            } else {
                Ok(None)
            }
        } else {
            Ok(None)
        }
    }

    /// Request an agent to check in / re-connect.
    pub async fn request_agent_checkin(
        &self,
        device_id: &str,
    ) -> MeshCentralResult<String> {
        let mut payload = serde_json::Map::new();
        payload.insert("nodeid".to_string(), json!(device_id));
        payload.insert("type".to_string(), json!("pong"));

        let resp = self.send_action("msg", payload).await?;
        let result = McApiClient::extract_result(&resp)
            .unwrap_or_else(|| "Agent check-in requested".to_string());
        Ok(result)
    }

    /// Request an agent update on a device.
    pub async fn update_agent(
        &self,
        device_id: &str,
    ) -> MeshCentralResult<String> {
        let mut payload = serde_json::Map::new();
        payload.insert("nodeids".to_string(), json!([device_id]));

        let resp = self.send_action("updateagents", payload).await?;
        let result = McApiClient::extract_result(&resp)
            .unwrap_or_else(|| "Agent update requested".to_string());
        Ok(result)
    }
}
