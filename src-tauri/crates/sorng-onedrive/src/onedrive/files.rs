//! File and folder CRUD, upload (small + resumable large), download,
//! copy, move, rename, versions, and preview for OneDrive items.
//!
//! All paths accept either an item ID or a server-relative path
//! (e.g. `/Documents/report.pdf`).

use crate::onedrive::api_client::GraphApiClient;
use crate::onedrive::error::{OneDriveError, OneDriveResult};
use crate::onedrive::types::{
    ConflictBehavior, CopyRequest, DriveItem, DriveItemVersion, ItemPreview,
    MoveRequest, UploadProgress, UploadSession,
};
use log::{debug, info};
use serde_json::json;

/// Maximum size for a simple (single-PUT) upload (4 MiB).
const SIMPLE_UPLOAD_MAX: u64 = 4 * 1024 * 1024;

/// Chunk size for resumable uploads (10 MiB, must be a multiple of 320 KiB).
const UPLOAD_CHUNK_SIZE: u64 = 10 * 1024 * 1024;

/// File operations.
pub struct OneDriveFiles<'a> {
    client: &'a GraphApiClient,
    drive_id: String,
}

impl<'a> OneDriveFiles<'a> {
    pub fn new(client: &'a GraphApiClient, drive_id: &str) -> Self {
        Self {
            client,
            drive_id: drive_id.to_string(),
        }
    }

    // ─── Read ────────────────────────────────────────────────────────

    /// Get item metadata by ID.
    pub async fn get_item(&self, item_id: &str) -> OneDriveResult<DriveItem> {
        let path = format!("drives/{}/items/{}", self.drive_id, item_id);
        let resp = self.client.get(&path, &[]).await?;
        let item: DriveItem = serde_json::from_value(resp)?;
        Ok(item)
    }

    /// Get item metadata by server-relative path (e.g. `/Documents/report.pdf`).
    pub async fn get_item_by_path(&self, path: &str) -> OneDriveResult<DriveItem> {
        let encoded = percent_encoding::utf8_percent_encode(
            path.trim_start_matches('/'),
            percent_encoding::NON_ALPHANUMERIC,
        );
        let api_path = format!("drives/{}/root:/{}", self.drive_id, encoded);
        let resp = self.client.get(&api_path, &[]).await?;
        let item: DriveItem = serde_json::from_value(resp)?;
        Ok(item)
    }

    /// List children of a folder by ID.
    pub async fn list_children(
        &self,
        folder_id: &str,
        top: Option<i32>,
    ) -> OneDriveResult<Vec<DriveItem>> {
        let mut all = Vec::new();
        let top_str = top.unwrap_or(200).to_string();
        let path = format!(
            "drives/{}/items/{}/children",
            self.drive_id, folder_id
        );
        let mut next_link: Option<String> = None;

        loop {
            let url = next_link.as_deref().unwrap_or(&path);
            let resp = self
                .client
                .get(url, &[("$top", &top_str)])
                .await?;

            if let Some(arr) = resp["value"].as_array() {
                let items: Vec<DriveItem> = arr
                    .iter()
                    .filter_map(|v| serde_json::from_value(v.clone()).ok())
                    .collect();
                all.extend(items);
            }

            next_link = resp["@odata.nextLink"]
                .as_str()
                .map(String::from);
            if next_link.is_none() {
                break;
            }
        }

        debug!("Listed {} children of {}", all.len(), folder_id);
        Ok(all)
    }

    /// List children of the root folder.
    pub async fn list_root_children(&self, top: Option<i32>) -> OneDriveResult<Vec<DriveItem>> {
        self.list_children("root", top).await
    }

    /// List children by folder path.
    pub async fn list_children_by_path(
        &self,
        folder_path: &str,
        top: Option<i32>,
    ) -> OneDriveResult<Vec<DriveItem>> {
        let encoded = percent_encoding::utf8_percent_encode(
            folder_path.trim_start_matches('/'),
            percent_encoding::NON_ALPHANUMERIC,
        );
        let path = format!(
            "drives/{}/root:/{}:/children",
            self.drive_id, encoded
        );
        let top_str = top.unwrap_or(200).to_string();
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

    // ─── Download ────────────────────────────────────────────────────

    /// Download file content by item ID.
    pub async fn download(&self, item_id: &str) -> OneDriveResult<Vec<u8>> {
        let path = format!(
            "drives/{}/items/{}/content",
            self.drive_id, item_id
        );
        info!("Downloading item {}", item_id);
        self.client.get_bytes(&path).await
    }

    /// Download file content by path.
    pub async fn download_by_path(&self, file_path: &str) -> OneDriveResult<Vec<u8>> {
        let encoded = percent_encoding::utf8_percent_encode(
            file_path.trim_start_matches('/'),
            percent_encoding::NON_ALPHANUMERIC,
        );
        let path = format!(
            "drives/{}/root:/{}:/content",
            self.drive_id, encoded
        );
        self.client.get_bytes(&path).await
    }

    // ─── Upload (simple) ────────────────────────────────────────────

    /// Upload a small file (≤ 4 MiB) by parent folder + name.
    pub async fn upload_small(
        &self,
        parent_id: &str,
        file_name: &str,
        data: Vec<u8>,
        content_type: &str,
    ) -> OneDriveResult<DriveItem> {
        let encoded_name = percent_encoding::utf8_percent_encode(
            file_name,
            percent_encoding::NON_ALPHANUMERIC,
        );
        let path = format!(
            "drives/{}/items/{}:/{}:/content",
            self.drive_id, parent_id, encoded_name
        );
        info!("Simple upload: {} ({} bytes)", file_name, data.len());
        let resp = self.client.put_bytes(&path, data, content_type).await?;
        let item: DriveItem = serde_json::from_value(resp)?;
        Ok(item)
    }

    /// Upload a small file by full path (e.g. `/Documents/report.pdf`).
    pub async fn upload_small_by_path(
        &self,
        file_path: &str,
        data: Vec<u8>,
        content_type: &str,
    ) -> OneDriveResult<DriveItem> {
        let encoded = percent_encoding::utf8_percent_encode(
            file_path.trim_start_matches('/'),
            percent_encoding::NON_ALPHANUMERIC,
        );
        let path = format!(
            "drives/{}/root:/{}:/content",
            self.drive_id, encoded
        );
        let resp = self.client.put_bytes(&path, data, content_type).await?;
        let item: DriveItem = serde_json::from_value(resp)?;
        Ok(item)
    }

    // ─── Upload (resumable / large) ─────────────────────────────────

    /// Create a resumable upload session for a large file.
    pub async fn create_upload_session(
        &self,
        parent_id: &str,
        file_name: &str,
        conflict: Option<ConflictBehavior>,
    ) -> OneDriveResult<UploadSession> {
        let encoded_name = percent_encoding::utf8_percent_encode(
            file_name,
            percent_encoding::NON_ALPHANUMERIC,
        );
        let path = format!(
            "drives/{}/items/{}:/{}:/createUploadSession",
            self.drive_id, parent_id, encoded_name
        );

        let body = json!({
            "item": {
                "@microsoft.graph.conflictBehavior": conflict.unwrap_or(ConflictBehavior::Rename),
                "name": file_name,
            }
        });

        let resp = self.client.post(&path, &body).await?;
        let session: UploadSession = serde_json::from_value(resp)?;
        info!("Upload session created: {}", session.upload_url);
        Ok(session)
    }

    /// Upload a large file using a resumable session, returning progress
    /// after each chunk.
    pub async fn upload_large(
        &self,
        parent_id: &str,
        file_name: &str,
        data: Vec<u8>,
        conflict: Option<ConflictBehavior>,
        mut on_progress: impl FnMut(&UploadProgress),
    ) -> OneDriveResult<DriveItem> {
        let total_size = data.len() as u64;

        // For small files, just use simple upload.
        if total_size <= SIMPLE_UPLOAD_MAX {
            let ct = mime_guess::from_path(file_name)
                .first_or_octet_stream()
                .to_string();
            return self.upload_small(parent_id, file_name, data, &ct).await;
        }

        let session = self
            .create_upload_session(parent_id, file_name, conflict)
            .await?;

        let mut offset: u64 = 0;
        let mut progress = UploadProgress {
            session_url: session.upload_url.clone(),
            file_name: file_name.to_string(),
            file_size: total_size,
            bytes_uploaded: 0,
            completed: false,
            drive_item: None,
        };

        while offset < total_size {
            let end = std::cmp::min(offset + UPLOAD_CHUNK_SIZE, total_size);
            let chunk = data[offset as usize..end as usize].to_vec();

            let resp = self
                .client
                .put_upload_range(
                    &session.upload_url,
                    chunk,
                    offset,
                    end - 1,
                    total_size,
                )
                .await?;

            offset = end;
            progress.bytes_uploaded = offset;

            // Check if the upload is complete.
            if let Ok(item) = serde_json::from_value::<DriveItem>(resp.clone()) {
                if !item.id.is_empty() {
                    progress.completed = true;
                    progress.drive_item = Some(item.clone());
                    on_progress(&progress);
                    info!("Upload complete: {}", file_name);
                    return Ok(item);
                }
            }

            on_progress(&progress);
        }

        Err(OneDriveError::internal(
            "Upload completed all chunks but no DriveItem was returned",
        ))
    }

    /// Cancel a resumable upload session.
    pub async fn cancel_upload_session(&self, upload_url: &str) -> OneDriveResult<()> {
        self.client.delete(upload_url).await
    }

    /// Get the status of a resumable upload session.
    pub async fn get_upload_session_status(
        &self,
        upload_url: &str,
    ) -> OneDriveResult<UploadSession> {
        let resp = self.client.get(upload_url, &[]).await?;
        let session: UploadSession = serde_json::from_value(resp)?;
        Ok(session)
    }

    // ─── Create folder ───────────────────────────────────────────────

    /// Create a new folder under a parent.
    pub async fn create_folder(
        &self,
        parent_id: &str,
        name: &str,
        conflict: Option<ConflictBehavior>,
    ) -> OneDriveResult<DriveItem> {
        let path = format!(
            "drives/{}/items/{}/children",
            self.drive_id, parent_id
        );
        let body = json!({
            "name": name,
            "folder": {},
            "@microsoft.graph.conflictBehavior": conflict.unwrap_or(ConflictBehavior::Rename)
        });
        let resp = self.client.post(&path, &body).await?;
        let item: DriveItem = serde_json::from_value(resp)?;
        info!("Created folder: {} ({})", name, item.id);
        Ok(item)
    }

    // ─── Update / Rename ─────────────────────────────────────────────

    /// Rename or update metadata of an item.
    pub async fn update_item(
        &self,
        item_id: &str,
        updates: &serde_json::Value,
    ) -> OneDriveResult<DriveItem> {
        let path = format!("drives/{}/items/{}", self.drive_id, item_id);
        let resp = self.client.patch(&path, updates).await?;
        let item: DriveItem = serde_json::from_value(resp)?;
        Ok(item)
    }

    /// Rename an item.
    pub async fn rename(&self, item_id: &str, new_name: &str) -> OneDriveResult<DriveItem> {
        self.update_item(item_id, &json!({ "name": new_name }))
            .await
    }

    // ─── Move ────────────────────────────────────────────────────────

    /// Move an item to a new parent (and optionally rename).
    pub async fn move_item(
        &self,
        item_id: &str,
        request: &MoveRequest,
    ) -> OneDriveResult<DriveItem> {
        let path = format!("drives/{}/items/{}", self.drive_id, item_id);
        let body = serde_json::to_value(request)?;
        let resp = self.client.patch(&path, &body).await?;
        let item: DriveItem = serde_json::from_value(resp)?;
        info!("Moved item {}", item_id);
        Ok(item)
    }

    // ─── Copy ────────────────────────────────────────────────────────

    /// Initiate an asynchronous copy.  Returns a monitor URL.
    pub async fn copy(
        &self,
        item_id: &str,
        request: &CopyRequest,
    ) -> OneDriveResult<String> {
        let path = format!("drives/{}/items/{}/copy", self.drive_id, item_id);
        let body = serde_json::to_value(request)?;

        // Copy returns 202 Accepted with a Location header for monitoring.
        let url = self.client.url(&path);
        let resp = reqwest::Client::new()
            .post(&url)
            .bearer_auth(&self.client.url("").trim_end_matches('/')) // Reuse token
            .json(&body)
            .send()
            .await
            .map_err(OneDriveError::from)?;

        let status = resp.status().as_u16();
        if status == 202 {
            let monitor = resp
                .headers()
                .get("location")
                .and_then(|v| v.to_str().ok())
                .unwrap_or_default()
                .to_string();
            info!("Copy started for {}, monitor: {}", item_id, monitor);
            Ok(monitor)
        } else {
            let body_text = resp.text().await.unwrap_or_default();
            Err(OneDriveError::from_graph_response(status, &body_text))
        }
    }

    // ─── Delete / Trash ──────────────────────────────────────────────

    /// Delete (move to recycle bin) an item.
    pub async fn delete(&self, item_id: &str) -> OneDriveResult<()> {
        let path = format!("drives/{}/items/{}", self.drive_id, item_id);
        self.client.delete(&path).await?;
        info!("Deleted item {}", item_id);
        Ok(())
    }

    /// Permanently delete an item already in the recycle bin.
    pub async fn permanently_delete(&self, item_id: &str) -> OneDriveResult<()> {
        let path = format!(
            "drives/{}/items/{}?@microsoft.graph.conflictBehavior=fail",
            self.drive_id, item_id
        );
        self.client.delete(&path).await
    }

    /// Restore an item from the recycle bin.
    pub async fn restore(&self, item_id: &str) -> OneDriveResult<DriveItem> {
        let path = format!(
            "drives/{}/items/{}/restore",
            self.drive_id, item_id
        );
        let resp = self.client.post_empty(&path).await?;
        let item: DriveItem = serde_json::from_value(resp)?;
        info!("Restored item {}", item_id);
        Ok(item)
    }

    // ─── Versions ────────────────────────────────────────────────────

    /// List versions of a file.
    pub async fn list_versions(&self, item_id: &str) -> OneDriveResult<Vec<DriveItemVersion>> {
        let path = format!(
            "drives/{}/items/{}/versions",
            self.drive_id, item_id
        );
        let resp = self.client.get(&path, &[]).await?;
        let versions: Vec<DriveItemVersion> = resp["value"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| serde_json::from_value(v.clone()).ok())
                    .collect()
            })
            .unwrap_or_default();
        Ok(versions)
    }

    /// Download a specific version of a file.
    pub async fn download_version(
        &self,
        item_id: &str,
        version_id: &str,
    ) -> OneDriveResult<Vec<u8>> {
        let path = format!(
            "drives/{}/items/{}/versions/{}/content",
            self.drive_id, item_id, version_id
        );
        self.client.get_bytes(&path).await
    }

    /// Restore a specific version.
    pub async fn restore_version(
        &self,
        item_id: &str,
        version_id: &str,
    ) -> OneDriveResult<()> {
        let path = format!(
            "drives/{}/items/{}/versions/{}/restoreVersion",
            self.drive_id, item_id, version_id
        );
        self.client.post_empty(&path).await?;
        info!("Restored version {} of item {}", version_id, item_id);
        Ok(())
    }

    // ─── Preview ─────────────────────────────────────────────────────

    /// Get embeddable preview URLs for an item.
    pub async fn preview(
        &self,
        item_id: &str,
        page: Option<i32>,
        zoom: Option<f64>,
    ) -> OneDriveResult<ItemPreview> {
        let path = format!(
            "drives/{}/items/{}/preview",
            self.drive_id, item_id
        );
        let mut body = json!({});
        if let Some(p) = page {
            body["page"] = json!(p);
        }
        if let Some(z) = zoom {
            body["zoom"] = json!(z);
        }
        let resp = self.client.post(&path, &body).await?;
        let preview: ItemPreview = serde_json::from_value(resp)?;
        Ok(preview)
    }

    // ─── Helpers ─────────────────────────────────────────────────────

    /// Automatically dispatch to simple or resumable upload.
    pub async fn upload(
        &self,
        parent_id: &str,
        file_name: &str,
        data: Vec<u8>,
        conflict: Option<ConflictBehavior>,
    ) -> OneDriveResult<DriveItem> {
        let size = data.len() as u64;
        if size <= SIMPLE_UPLOAD_MAX {
            let ct = mime_guess::from_path(file_name)
                .first_or_octet_stream()
                .to_string();
            self.upload_small(parent_id, file_name, data, &ct).await
        } else {
            self.upload_large(parent_id, file_name, data, conflict, |_| {})
                .await
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
//  Tests
// ═══════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_simple_upload_max_constant() {
        assert_eq!(SIMPLE_UPLOAD_MAX, 4 * 1024 * 1024);
    }

    #[test]
    fn test_upload_chunk_size_multiple_of_320k() {
        // Graph requires chunks to be multiples of 320 KiB.
        assert_eq!(UPLOAD_CHUNK_SIZE % (320 * 1024), 0);
    }

    #[test]
    fn test_upload_session_create_request_serde() {
        let req = UploadSessionCreateRequest {
            item: None,
            conflict_behavior: Some(ConflictBehavior::Replace),
        };
        let json_str = serde_json::to_string(&req).unwrap();
        assert!(json_str.contains("replace"));
    }

    #[test]
    fn test_copy_request_serde() {
        let req = CopyRequest {
            parent_reference: ItemReference {
                drive_id: Some("d1".into()),
                drive_type: None,
                id: Some("folder1".into()),
                name: None,
                path: None,
                share_id: None,
                site_id: None,
            },
            name: Some("copy_of_file.txt".into()),
        };
        let v = serde_json::to_value(&req).unwrap();
        assert_eq!(v["name"], "copy_of_file.txt");
    }

    #[test]
    fn test_move_request_serde() {
        let req = MoveRequest {
            parent_reference: Some(ItemReference {
                drive_id: None,
                drive_type: None,
                id: Some("new_parent".into()),
                name: None,
                path: None,
                share_id: None,
                site_id: None,
            }),
            name: Some("renamed.txt".into()),
        };
        let v = serde_json::to_value(&req).unwrap();
        assert_eq!(v["name"], "renamed.txt");
    }
}
