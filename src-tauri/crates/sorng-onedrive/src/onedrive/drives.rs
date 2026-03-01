//! Drive enumeration: list drives, get drive metadata, and access
//! shared / site drives.

use crate::onedrive::api_client::GraphApiClient;
use crate::onedrive::error::OneDriveResult;
use crate::onedrive::types::Drive;
use log::debug;

/// Drive operations.
pub struct OneDriveDrives<'a> {
    client: &'a GraphApiClient,
}

impl<'a> OneDriveDrives<'a> {
    pub fn new(client: &'a GraphApiClient) -> Self {
        Self { client }
    }

    /// Get the current user's default drive.
    pub async fn get_my_drive(&self) -> OneDriveResult<Drive> {
        let resp = self.client.get("me/drive", &[]).await?;
        let drive: Drive = serde_json::from_value(resp)?;
        debug!("My drive: {} ({:?})", drive.id, drive.drive_type);
        Ok(drive)
    }

    /// Get a specific drive by ID.
    pub async fn get_drive(&self, drive_id: &str) -> OneDriveResult<Drive> {
        let path = format!("drives/{}", drive_id);
        let resp = self.client.get(&path, &[]).await?;
        let drive: Drive = serde_json::from_value(resp)?;
        Ok(drive)
    }

    /// List all drives available to the current user (personal + shared).
    pub async fn list_my_drives(&self) -> OneDriveResult<Vec<Drive>> {
        let resp = self.client.get("me/drives", &[]).await?;
        let drives: Vec<Drive> = resp["value"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| serde_json::from_value(v.clone()).ok())
                    .collect()
            })
            .unwrap_or_default();
        debug!("Found {} drives", drives.len());
        Ok(drives)
    }

    /// List drives in a SharePoint site.
    pub async fn list_site_drives(&self, site_id: &str) -> OneDriveResult<Vec<Drive>> {
        let path = format!("sites/{}/drives", site_id);
        let resp = self.client.get(&path, &[]).await?;
        let drives: Vec<Drive> = resp["value"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| serde_json::from_value(v.clone()).ok())
                    .collect()
            })
            .unwrap_or_default();
        Ok(drives)
    }

    /// List drives for a group.
    pub async fn list_group_drives(&self, group_id: &str) -> OneDriveResult<Vec<Drive>> {
        let path = format!("groups/{}/drives", group_id);
        let resp = self.client.get(&path, &[]).await?;
        let drives: Vec<Drive> = resp["value"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| serde_json::from_value(v.clone()).ok())
                    .collect()
            })
            .unwrap_or_default();
        Ok(drives)
    }

    /// Get the default document library drive for a SharePoint site.
    pub async fn get_site_default_drive(
        &self,
        site_id: &str,
    ) -> OneDriveResult<Drive> {
        let path = format!("sites/{}/drive", site_id);
        let resp = self.client.get(&path, &[]).await?;
        let drive: Drive = serde_json::from_value(resp)?;
        Ok(drive)
    }

    /// Get the root DriveItem of a drive.
    pub async fn get_drive_root(
        &self,
        drive_id: &str,
    ) -> OneDriveResult<crate::onedrive::types::DriveItem> {
        let path = format!("drives/{}/root", drive_id);
        let resp = self.client.get(&path, &[]).await?;
        let item: crate::onedrive::types::DriveItem = serde_json::from_value(resp)?;
        Ok(item)
    }
}

// ═══════════════════════════════════════════════════════════════════════
//  Tests
// ═══════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_drive_serde() {
        let json_str = r#"{
            "id": "d123",
            "name": "OneDrive",
            "driveType": "personal",
            "quota": {
                "total": 5368709120,
                "used": 1073741824,
                "remaining": 4294967296,
                "state": "normal"
            }
        }"#;
        let drive: Drive = serde_json::from_str(json_str).unwrap();
        assert_eq!(drive.id, "d123");
        assert_eq!(drive.drive_type.as_deref(), Some("personal"));
        assert!(drive.quota.is_some());
        let q = drive.quota.unwrap();
        assert_eq!(q.total, Some(5368709120));
        assert_eq!(q.used, Some(1073741824));
    }
}
