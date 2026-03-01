//! Permission management for OneDrive drive items.
//!
//! List, get, update, and remove permissions on individual files and folders.

use crate::onedrive::api_client::GraphApiClient;
use crate::onedrive::error::OneDriveResult;
use crate::onedrive::types::Permission;
use log::{debug, info};
use serde_json::json;

/// Permission operations.
pub struct OneDrivePermissions<'a> {
    client: &'a GraphApiClient,
    drive_id: String,
}

impl<'a> OneDrivePermissions<'a> {
    pub fn new(client: &'a GraphApiClient, drive_id: &str) -> Self {
        Self {
            client,
            drive_id: drive_id.to_string(),
        }
    }

    /// List all permissions on an item.
    pub async fn list(&self, item_id: &str) -> OneDriveResult<Vec<Permission>> {
        let path = format!(
            "drives/{}/items/{}/permissions",
            self.drive_id, item_id
        );
        let resp = self.client.get(&path, &[]).await?;
        let perms: Vec<Permission> = resp["value"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| serde_json::from_value(v.clone()).ok())
                    .collect()
            })
            .unwrap_or_default();
        debug!("Item {} has {} permissions", item_id, perms.len());
        Ok(perms)
    }

    /// Get a specific permission by ID.
    pub async fn get(
        &self,
        item_id: &str,
        permission_id: &str,
    ) -> OneDriveResult<Permission> {
        let path = format!(
            "drives/{}/items/{}/permissions/{}",
            self.drive_id, item_id, permission_id
        );
        let resp = self.client.get(&path, &[]).await?;
        let perm: Permission = serde_json::from_value(resp)?;
        Ok(perm)
    }

    /// Update the roles of a permission.
    pub async fn update_roles(
        &self,
        item_id: &str,
        permission_id: &str,
        roles: &[String],
    ) -> OneDriveResult<Permission> {
        let path = format!(
            "drives/{}/items/{}/permissions/{}",
            self.drive_id, item_id, permission_id
        );
        let body = json!({ "roles": roles });
        let resp = self.client.patch(&path, &body).await?;
        let perm: Permission = serde_json::from_value(resp)?;
        info!(
            "Updated permission {} on item {} to roles {:?}",
            permission_id, item_id, roles
        );
        Ok(perm)
    }

    /// Remove a permission.
    pub async fn remove(
        &self,
        item_id: &str,
        permission_id: &str,
    ) -> OneDriveResult<()> {
        let path = format!(
            "drives/{}/items/{}/permissions/{}",
            self.drive_id, item_id, permission_id
        );
        self.client.delete(&path).await?;
        info!("Removed permission {} from item {}", permission_id, item_id);
        Ok(())
    }

    /// Grant access to an item using a sharing link token.
    pub async fn grant_via_link(
        &self,
        sharing_token: &str,
        roles: &[String],
        recipients: &[String],
    ) -> OneDriveResult<Vec<Permission>> {
        let path = format!("shares/{}/permission/grant", sharing_token);
        let body = json!({
            "roles": roles,
            "recipients": recipients.iter().map(|e| json!({ "email": e })).collect::<Vec<_>>(),
        });
        let resp = self.client.post(&path, &body).await?;
        let perms: Vec<Permission> = resp["value"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| serde_json::from_value(v.clone()).ok())
                    .collect()
            })
            .unwrap_or_default();
        Ok(perms)
    }
}

// ═══════════════════════════════════════════════════════════════════════
//  Tests
// ═══════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_permission_roles_json() {
        let body = json!({ "roles": ["read", "write"] });
        let roles = body["roles"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|v| v.as_str())
            .collect::<Vec<_>>();
        assert_eq!(roles, vec!["read", "write"]);
    }
}
