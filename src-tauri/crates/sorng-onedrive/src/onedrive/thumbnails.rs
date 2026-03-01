//! Thumbnail retrieval for OneDrive items (images, videos, PDFs, etc.).

use crate::onedrive::api_client::GraphApiClient;
use crate::onedrive::error::OneDriveResult;
use crate::onedrive::types::ThumbnailSet;
use log::debug;

/// Thumbnail operations.
pub struct OneDriveThumbnails<'a> {
    client: &'a GraphApiClient,
    drive_id: String,
}

impl<'a> OneDriveThumbnails<'a> {
    pub fn new(client: &'a GraphApiClient, drive_id: &str) -> Self {
        Self {
            client,
            drive_id: drive_id.to_string(),
        }
    }

    /// List all thumbnail sets for an item.
    pub async fn list(&self, item_id: &str) -> OneDriveResult<Vec<ThumbnailSet>> {
        let path = format!(
            "drives/{}/items/{}/thumbnails",
            self.drive_id, item_id
        );
        let resp = self.client.get(&path, &[]).await?;
        let sets: Vec<ThumbnailSet> = resp["value"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| serde_json::from_value(v.clone()).ok())
                    .collect()
            })
            .unwrap_or_default();
        debug!("Item {} has {} thumbnail sets", item_id, sets.len());
        Ok(sets)
    }

    /// Get a specific thumbnail set by index (usually 0).
    pub async fn get_set(
        &self,
        item_id: &str,
        set_index: i32,
    ) -> OneDriveResult<ThumbnailSet> {
        let path = format!(
            "drives/{}/items/{}/thumbnails/{}",
            self.drive_id, item_id, set_index
        );
        let resp = self.client.get(&path, &[]).await?;
        let set: ThumbnailSet = serde_json::from_value(resp)?;
        Ok(set)
    }

    /// Get the raw bytes of a specific thumbnail size.
    ///
    /// `size` is one of `small`, `medium`, `large`, or a custom size like
    /// `c200x200` (crop) or `200x0` (scale width).
    pub async fn download(
        &self,
        item_id: &str,
        set_index: i32,
        size: &str,
    ) -> OneDriveResult<Vec<u8>> {
        let path = format!(
            "drives/{}/items/{}/thumbnails/{}/{}/content",
            self.drive_id, item_id, set_index, size
        );
        self.client.get_bytes(&path).await
    }

    /// Get a custom-sized thumbnail (crop or scale).
    ///
    /// `width` × `height` in pixels; set either to `0` for auto.
    /// `crop` — if `true`, use center-crop (`c{w}x{h}`); otherwise scale.
    pub async fn download_custom(
        &self,
        item_id: &str,
        width: u32,
        height: u32,
        crop: bool,
    ) -> OneDriveResult<Vec<u8>> {
        let size = if crop {
            format!("c{}x{}", width, height)
        } else {
            format!("{}x{}", width, height)
        };
        self.download(item_id, 0, &size).await
    }
}

// ═══════════════════════════════════════════════════════════════════════
//  Tests
// ═══════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;
    use crate::onedrive::types::Thumbnail;

    #[test]
    fn test_thumbnail_set_serde() {
        let json_str = r#"{
            "id": "0",
            "small": { "url": "https://thumb/s.jpg", "width": 96, "height": 96 },
            "medium": { "url": "https://thumb/m.jpg", "width": 176, "height": 176 },
            "large": { "url": "https://thumb/l.jpg", "width": 800, "height": 800 }
        }"#;
        let set: ThumbnailSet = serde_json::from_str(json_str).unwrap();
        assert_eq!(set.id.as_deref(), Some("0"));
        assert!(set.small.is_some());
        assert_eq!(set.small.as_ref().unwrap().width, Some(96));
    }

    #[test]
    fn test_custom_size_format() {
        let crop = format!("c{}x{}", 200, 200);
        assert_eq!(crop, "c200x200");
        let scale = format!("{}x{}", 300, 0);
        assert_eq!(scale, "300x0");
    }
}
