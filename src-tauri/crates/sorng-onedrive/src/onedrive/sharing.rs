//! Sharing links, invitations, and shared-with-me items.
//!
//! Covers creating anonymous / organization links, sending sharing
//! invitations, listing shared items, and accessing items via share tokens.

use base64::Engine;
use crate::onedrive::api_client::GraphApiClient;
use crate::onedrive::error::OneDriveResult;
use crate::onedrive::types::{
    CreateLinkRequest, DriveItem, InviteRequest, Permission,
};
use log::info;

/// Sharing operations.
pub struct OneDriveSharing<'a> {
    client: &'a GraphApiClient,
    drive_id: String,
}

impl<'a> OneDriveSharing<'a> {
    pub fn new(client: &'a GraphApiClient, drive_id: &str) -> Self {
        Self {
            client,
            drive_id: drive_id.to_string(),
        }
    }

    /// Create a sharing link for an item.
    pub async fn create_link(
        &self,
        item_id: &str,
        request: &CreateLinkRequest,
    ) -> OneDriveResult<Permission> {
        let path = format!(
            "drives/{}/items/{}/createLink",
            self.drive_id, item_id
        );
        let body = serde_json::to_value(request)?;
        let resp = self.client.post(&path, &body).await?;
        let perm: Permission = serde_json::from_value(resp)?;
        info!(
            "Created sharing link for item {} (type={})",
            item_id, request.link_type
        );
        Ok(perm)
    }

    /// Send sharing invitations to recipients.
    pub async fn invite(
        &self,
        item_id: &str,
        request: &InviteRequest,
    ) -> OneDriveResult<Vec<Permission>> {
        let path = format!(
            "drives/{}/items/{}/invite",
            self.drive_id, item_id
        );
        let body = serde_json::to_value(request)?;
        let resp = self.client.post(&path, &body).await?;
        let perms: Vec<Permission> = resp["value"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| serde_json::from_value(v.clone()).ok())
                    .collect()
            })
            .unwrap_or_default();
        info!("Invited {} recipients to item {}", request.recipients.len(), item_id);
        Ok(perms)
    }

    /// List items shared with the current user.
    pub async fn shared_with_me(&self) -> OneDriveResult<Vec<DriveItem>> {
        let path = "me/drive/sharedWithMe";
        let resp = self.client.get(path, &[]).await?;
        let items: Vec<DriveItem> = resp["value"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| serde_json::from_value(v.clone()).ok())
                    .collect()
            })
            .unwrap_or_default();
        Ok(items)
    }

    /// Resolve a sharing token / URL to a DriveItem.
    pub async fn resolve_sharing_url(
        &self,
        sharing_url: &str,
    ) -> OneDriveResult<DriveItem> {
        let encoded = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(sharing_url.as_bytes());
        let token = format!("u!{}", encoded);
        let path = format!("shares/{}/driveItem", token);
        let resp = self.client.get(&path, &[]).await?;
        let item: DriveItem = serde_json::from_value(resp)?;
        Ok(item)
    }

    /// Get the root folder of a shared drive item (for shared folders).
    pub async fn resolve_sharing_url_root(
        &self,
        sharing_url: &str,
    ) -> OneDriveResult<DriveItem> {
        let encoded = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(sharing_url.as_bytes());
        let token = format!("u!{}", encoded);
        let path = format!("shares/{}/root", token);
        let resp = self.client.get(&path, &[]).await?;
        let item: DriveItem = serde_json::from_value(resp)?;
        Ok(item)
    }

    /// List children within a shared folder via sharing token.
    pub async fn list_shared_children(
        &self,
        sharing_url: &str,
    ) -> OneDriveResult<Vec<DriveItem>> {
        let encoded = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(sharing_url.as_bytes());
        let token = format!("u!{}", encoded);
        let path = format!("shares/{}/driveItem/children", token);
        let resp = self.client.get(&path, &[]).await?;
        let items: Vec<DriveItem> = resp["value"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| serde_json::from_value(v.clone()).ok())
                    .collect()
            })
            .unwrap_or_default();
        Ok(items)
    }
}

// ═══════════════════════════════════════════════════════════════════════
//  Tests
// ═══════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;
    use crate::onedrive::types::DriveRecipient;

    #[test]
    fn test_create_link_request_serde() {
        let req = CreateLinkRequest {
            link_type: "view".into(),
            scope: Some("anonymous".into()),
            expiration_date_time: None,
            password: None,
            retain_inherited_permissions: None,
        };
        let v = serde_json::to_value(&req).unwrap();
        assert_eq!(v["type"], "view");
        assert_eq!(v["scope"], "anonymous");
    }

    #[test]
    fn test_invite_request_serde() {
        let req = InviteRequest {
            recipients: vec![DriveRecipient {
                email: Some("alice@example.com".into()),
                alias: None,
                object_id: None,
            }],
            roles: vec!["read".into()],
            require_sign_in: Some(true),
            send_invitation: Some(true),
            message: Some("Check this out!".into()),
            expiration_date_time: None,
            password: None,
            retain_inherited_permissions: None,
        };
        let v = serde_json::to_value(&req).unwrap();
        assert_eq!(v["recipients"][0]["email"], "alice@example.com");
        assert_eq!(v["roles"][0], "read");
    }

    #[test]
    fn test_sharing_url_encoding() {
        let url = "https://onedrive.live.com/redir?resid=ABC123";
        let encoded = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(url.as_bytes());
        let token = format!("u!{}", encoded);
        assert!(token.starts_with("u!"));
        assert!(!token.contains('='));
    }
}
