//! Access well-known special folders (Documents, Photos, Camera Roll,
//! App Root, Music) via the Graph API.

use crate::onedrive::api_client::GraphApiClient;
use crate::onedrive::error::OneDriveResult;
use crate::onedrive::types::{DriveItem, SpecialFolder};
use log::debug;

/// Special folder operations.
pub struct OneDriveSpecialFolders<'a> {
    client: &'a GraphApiClient,
}

impl<'a> OneDriveSpecialFolders<'a> {
    pub fn new(client: &'a GraphApiClient) -> Self {
        Self { client }
    }

    /// Get the DriveItem for a well-known special folder.
    pub async fn get(&self, folder: SpecialFolder) -> OneDriveResult<DriveItem> {
        let path = format!("me/drive/special/{}", folder.as_str());
        let resp = self.client.get(&path, &[]).await?;
        let item: DriveItem = serde_json::from_value(resp)?;
        debug!("Special folder {:?}: id={}", folder, item.id);
        Ok(item)
    }

    /// List children of a special folder.
    pub async fn list_children(
        &self,
        folder: SpecialFolder,
        top: Option<i32>,
    ) -> OneDriveResult<Vec<DriveItem>> {
        let top_str = top.unwrap_or(200).to_string();
        let path = format!("me/drive/special/{}/children", folder.as_str());
        let resp = self.client.get(&path, &[("$top", &top_str)]).await?;

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

    /// Get the App Root folder (used for app-specific data).
    pub async fn get_app_root(&self) -> OneDriveResult<DriveItem> {
        self.get(SpecialFolder::AppRoot).await
    }

    /// Get the Documents folder.
    pub async fn get_documents(&self) -> OneDriveResult<DriveItem> {
        self.get(SpecialFolder::Documents).await
    }

    /// Get the Photos folder.
    pub async fn get_photos(&self) -> OneDriveResult<DriveItem> {
        self.get(SpecialFolder::Photos).await
    }

    /// Get the Camera Roll folder.
    pub async fn get_camera_roll(&self) -> OneDriveResult<DriveItem> {
        self.get(SpecialFolder::CameraRoll).await
    }

    /// Get the Music folder.
    pub async fn get_music(&self) -> OneDriveResult<DriveItem> {
        self.get(SpecialFolder::Music).await
    }
}

// ═══════════════════════════════════════════════════════════════════════
//  Tests
// ═══════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_special_folder_path_format() {
        let path = format!("me/drive/special/{}", SpecialFolder::Documents.as_str());
        assert_eq!(path, "me/drive/special/documents");
    }

    #[test]
    fn test_special_folder_children_path() {
        let path = format!(
            "me/drive/special/{}/children",
            SpecialFolder::Photos.as_str()
        );
        assert_eq!(path, "me/drive/special/photos/children");
    }
}
