//! WhatsApp group management via the Cloud API.
//!
//! Create groups, manage participants, update group settings, and more.

use crate::whatsapp::api_client::CloudApiClient;
use crate::whatsapp::error::{WhatsAppError, WhatsAppResult};
use crate::whatsapp::types::*;
use log::info;
use serde::{Deserialize, Serialize};
use serde_json::json;

/// Result of a group creation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WaGroupCreateResult {
    pub group_id: String,
}

/// Group management operations.
pub struct WaGroups {
    client: CloudApiClient,
}

impl WaGroups {
    pub fn new(client: CloudApiClient) -> Self {
        Self { client }
    }

    /// Create a new WhatsApp group.
    pub async fn create_group(
        &self,
        request: &WaCreateGroupRequest,
    ) -> WhatsAppResult<WaGroupCreateResult> {
        let url = self.client.phone_url("groups");

        let body = json!({
            "subject": request.subject,
            "participants": request.participants,
        });

        let resp = self.client.post_json(&url, &body).await?;

        let group_id = resp["id"]
            .as_str()
            .ok_or_else(|| WhatsAppError::internal("No group id in response"))?
            .to_string();

        info!("Created group '{}' → {}", request.subject, group_id);
        Ok(WaGroupCreateResult { group_id })
    }

    /// Get information about a group.
    pub async fn get_group_info(
        &self,
        group_id: &str,
    ) -> WhatsAppResult<WaGroupInfo> {
        let url = self.client.url(group_id);
        let resp = self.client.get(&url).await?;

        let participants = resp["participants"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|p| {
                        Some(WaGroupParticipant {
                            id: p["id"].as_str().or_else(|| p["wa_id"].as_str())?.to_string(),
                            admin: p["admin"].as_str().map(String::from),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        Ok(WaGroupInfo {
            id: group_id.to_string(),
            subject: resp["subject"].as_str().unwrap_or_default().to_string(),
            description: resp["description"].as_str().map(String::from),
            owner: resp["owner"].as_str().map(String::from),
            creation: resp["creation"].as_u64().or_else(|| resp["creation_timestamp"].as_u64()).unwrap_or(0),
            participants,
            invite_link: resp["invite_link"].as_str().map(String::from),
        })
    }

    /// Update group subject (name).
    pub async fn update_subject(
        &self,
        group_id: &str,
        subject: &str,
    ) -> WhatsAppResult<()> {
        let url = self.client.url(group_id);
        let body = json!({ "subject": subject });
        self.client.post_json(&url, &body).await?;
        info!("Updated group {} subject to '{}'", group_id, subject);
        Ok(())
    }

    /// Update group description.
    pub async fn update_description(
        &self,
        group_id: &str,
        description: &str,
    ) -> WhatsAppResult<()> {
        let url = self.client.url(group_id);
        let body = json!({ "description": description });
        self.client.post_json(&url, &body).await?;
        info!("Updated group {} description", group_id);
        Ok(())
    }

    /// Add participants to a group.
    pub async fn add_participants(
        &self,
        group_id: &str,
        phone_numbers: &[&str],
    ) -> WhatsAppResult<Vec<WaGroupParticipantResult>> {
        let url = format!("{}/participants", self.client.url(group_id));

        let body = json!({
            "action": "add",
            "participants": phone_numbers,
        });

        let resp = self.client.post_json(&url, &body).await?;
        let results = parse_participant_results(&resp);

        info!(
            "Added {} participants to group {}",
            phone_numbers.len(),
            group_id
        );
        Ok(results)
    }

    /// Remove participants from a group.
    pub async fn remove_participants(
        &self,
        group_id: &str,
        phone_numbers: &[&str],
    ) -> WhatsAppResult<Vec<WaGroupParticipantResult>> {
        let url = format!("{}/participants", self.client.url(group_id));

        let body = json!({
            "action": "remove",
            "participants": phone_numbers,
        });

        let resp = self.client.post_json(&url, &body).await?;
        let results = parse_participant_results(&resp);

        info!(
            "Removed {} participants from group {}",
            phone_numbers.len(),
            group_id
        );
        Ok(results)
    }

    /// Promote participants to admin.
    pub async fn promote_to_admin(
        &self,
        group_id: &str,
        phone_numbers: &[&str],
    ) -> WhatsAppResult<Vec<WaGroupParticipantResult>> {
        let url = format!("{}/participants", self.client.url(group_id));

        let body = json!({
            "action": "promote",
            "participants": phone_numbers,
        });

        let resp = self.client.post_json(&url, &body).await?;
        Ok(parse_participant_results(&resp))
    }

    /// Demote participants from admin.
    pub async fn demote_from_admin(
        &self,
        group_id: &str,
        phone_numbers: &[&str],
    ) -> WhatsAppResult<Vec<WaGroupParticipantResult>> {
        let url = format!("{}/participants", self.client.url(group_id));

        let body = json!({
            "action": "demote",
            "participants": phone_numbers,
        });

        let resp = self.client.post_json(&url, &body).await?;
        Ok(parse_participant_results(&resp))
    }

    /// Leave a group.
    pub async fn leave_group(&self, group_id: &str) -> WhatsAppResult<()> {
        let url = self.client.url(group_id);
        self.client.delete(&url).await?;
        info!("Left group {}", group_id);
        Ok(())
    }

    /// Get the group invite link.
    pub async fn get_invite_link(
        &self,
        group_id: &str,
    ) -> WhatsAppResult<String> {
        let url = format!("{}/invite_link", self.client.url(group_id));
        let resp = self.client.get(&url).await?;

        resp["link"]
            .as_str()
            .map(String::from)
            .ok_or_else(|| WhatsAppError::internal("No invite link returned"))
    }

    /// Revoke the current group invite link (generates a new one).
    pub async fn revoke_invite_link(
        &self,
        group_id: &str,
    ) -> WhatsAppResult<String> {
        let url = format!("{}/invite_link", self.client.url(group_id));
        let resp = self.client.delete(&url).await?;

        resp["link"]
            .as_str()
            .map(String::from)
            .ok_or_else(|| WhatsAppError::internal("No new invite link returned"))
    }

    /// Set group icon/photo.
    pub async fn set_group_icon(
        &self,
        group_id: &str,
        media_id: &str,
    ) -> WhatsAppResult<()> {
        let url = self.client.url(group_id);
        let body = json!({
            "messaging_product": "whatsapp",
            "image": { "id": media_id },
        });
        self.client.post_json(&url, &body).await?;
        Ok(())
    }
}

/// Per-participant operation result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WaGroupParticipantResult {
    pub phone_number: String,
    pub success: bool,
    pub error: Option<String>,
}

fn parse_participant_results(resp: &serde_json::Value) -> Vec<WaGroupParticipantResult> {
    resp["participants"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .map(|p| WaGroupParticipantResult {
                    phone_number: p["phone_number"]
                        .as_str()
                        .or_else(|| p["wa_id"].as_str())
                        .unwrap_or_default()
                        .to_string(),
                    success: p["code"].as_u64().map(|c| c == 200).unwrap_or(true),
                    error: p["message"].as_str().map(String::from),
                })
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_participant_results() {
        let resp = serde_json::json!({
            "participants": [
                {"phone_number": "+1234", "code": 200},
                {"phone_number": "+5678", "code": 404, "message": "Not found"}
            ]
        });

        let results = parse_participant_results(&resp);
        assert_eq!(results.len(), 2);
        assert!(results[0].success);
        assert!(!results[1].success);
        assert_eq!(results[1].error.as_deref(), Some("Not found"));
    }
}
