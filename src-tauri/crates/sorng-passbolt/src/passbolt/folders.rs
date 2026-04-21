//! Folder CRUD operations for Passbolt.
//!
//! Endpoints:
//! - `GET  /folders.json`        — list folders
//! - `POST /folders.json`        — create a folder
//! - `GET  /folders/{id}.json`   — get a single folder
//! - `PUT  /folders/{id}.json`   — update a folder
//! - `DELETE /folders/{id}.json` — delete a folder
//! - `PUT  /move/folder/{id}.json` — move a folder

use crate::passbolt::api_client::PassboltApiClient;
use crate::passbolt::types::*;
use log::{debug, info};
use std::collections::HashMap;

/// Folder API operations.
pub struct PassboltFolders;

impl PassboltFolders {
    /// List all folders.
    pub async fn list(
        client: &PassboltApiClient,
        params: Option<&FolderListParams>,
    ) -> Result<Vec<Folder>, PassboltError> {
        let mut query: HashMap<String, String> = HashMap::new();

        if let Some(p) = params {
            if let Some(ref search) = p.search {
                query.insert("filter[search]".into(), search.clone());
            }
            if let Some(ref parent_id) = p.has_parent {
                query.insert("filter[has-parent]".into(), parent_id.clone());
            }
            if p.contain_permissions.unwrap_or(false) {
                query.insert("contain[permissions]".into(), "1".into());
            }
            if p.contain_children_resources.unwrap_or(false) {
                query.insert("contain[children_resources]".into(), "1".into());
            }
            if p.contain_children_folders.unwrap_or(false) {
                query.insert("contain[children_folders]".into(), "1".into());
            }
            if p.contain_creator.unwrap_or(false) {
                query.insert("contain[creator]".into(), "1".into());
            }
            if p.contain_modifier.unwrap_or(false) {
                query.insert("contain[modifier]".into(), "1".into());
            }
            if p.contain_permission.unwrap_or(false) {
                query.insert("contain[permission]".into(), "1".into());
            }
            if let Some(ref order) = p.order {
                query.insert("order[]".into(), order.clone());
            }
            if let Some(limit) = p.limit {
                query.insert("limit".into(), limit.to_string());
            }
            if let Some(page) = p.page {
                query.insert("page".into(), page.to_string());
            }
        }

        debug!("Listing folders with {} query params", query.len());
        let resp: ApiResponse<Vec<Folder>> = if query.is_empty() {
            client.get("/folders.json").await?
        } else {
            client.get_with_params("/folders.json", &query).await?
        };

        info!("Listed {} folders", resp.body.len());
        Ok(resp.body)
    }

    /// Get a single folder by ID with all relations.
    pub async fn get(client: &PassboltApiClient, folder_id: &str) -> Result<Folder, PassboltError> {
        let mut query = HashMap::new();
        query.insert("contain[permissions]".into(), "1".into());
        query.insert("contain[children_resources]".into(), "1".into());
        query.insert("contain[children_folders]".into(), "1".into());
        query.insert("contain[creator]".into(), "1".into());
        query.insert("contain[modifier]".into(), "1".into());
        query.insert("contain[permission]".into(), "1".into());

        let resp: ApiResponse<Folder> = client
            .get_with_params(&format!("/folders/{}.json", folder_id), &query)
            .await?;
        Ok(resp.body)
    }

    /// Get a folder with custom contain flags.
    pub async fn get_with_contains(
        client: &PassboltApiClient,
        folder_id: &str,
        contains: &[&str],
    ) -> Result<Folder, PassboltError> {
        let mut query = HashMap::new();
        for c in contains {
            query.insert(format!("contain[{}]", c), "1".into());
        }
        let resp: ApiResponse<Folder> = client
            .get_with_params(&format!("/folders/{}.json", folder_id), &query)
            .await?;
        Ok(resp.body)
    }

    /// Create a new folder.
    pub async fn create(
        client: &PassboltApiClient,
        request: &CreateFolderRequest,
    ) -> Result<Folder, PassboltError> {
        info!("Creating folder: {}", request.name);
        let resp: ApiResponse<Folder> = client.post("/folders.json", request).await?;
        info!("Created folder {}", resp.body.id);
        Ok(resp.body)
    }

    /// Update an existing folder.
    pub async fn update(
        client: &PassboltApiClient,
        folder_id: &str,
        request: &UpdateFolderRequest,
    ) -> Result<Folder, PassboltError> {
        info!("Updating folder {}", folder_id);
        let resp: ApiResponse<Folder> = client
            .put(&format!("/folders/{}.json", folder_id), request)
            .await?;
        Ok(resp.body)
    }

    /// Delete a folder.
    pub async fn delete(
        client: &PassboltApiClient,
        folder_id: &str,
        cascade: bool,
    ) -> Result<(), PassboltError> {
        info!("Deleting folder {} (cascade={})", folder_id, cascade);
        let url = if cascade {
            format!("/folders/{}.json?cascade=1", folder_id)
        } else {
            format!("/folders/{}.json", folder_id)
        };
        client.delete_void(&url).await?;
        Ok(())
    }

    /// Move a folder to a new parent.
    pub async fn move_folder(
        client: &PassboltApiClient,
        folder_id: &str,
        new_parent_id: Option<&str>,
    ) -> Result<(), PassboltError> {
        let request = MoveRequest {
            folder_parent_id: new_parent_id.map(String::from),
        };
        info!(
            "Moving folder {} to {:?}",
            folder_id,
            new_parent_id.unwrap_or("root")
        );
        let _: ApiResponse<serde_json::Value> = client
            .put(&format!("/move/folder/{}.json", folder_id), &request)
            .await?;
        Ok(())
    }

    /// Move a resource to a folder.
    pub async fn move_resource(
        client: &PassboltApiClient,
        resource_id: &str,
        folder_id: Option<&str>,
    ) -> Result<(), PassboltError> {
        let request = MoveRequest {
            folder_parent_id: folder_id.map(String::from),
        };
        info!(
            "Moving resource {} to folder {:?}",
            resource_id,
            folder_id.unwrap_or("root")
        );
        let _: ApiResponse<serde_json::Value> = client
            .put(&format!("/move/resource/{}.json", resource_id), &request)
            .await?;
        Ok(())
    }

    /// Search folders by name.
    pub async fn search(
        client: &PassboltApiClient,
        keyword: &str,
    ) -> Result<Vec<Folder>, PassboltError> {
        let params = FolderListParams {
            search: Some(keyword.to_string()),
            contain_creator: Some(true),
            ..Default::default()
        };
        Self::list(client, Some(&params)).await
    }

    /// List root-level folders (no parent).
    pub async fn list_root(client: &PassboltApiClient) -> Result<Vec<Folder>, PassboltError> {
        // Root folders have null parent_id, but the API filters by has-parent.
        // We'll use the is-root filter if supported, otherwise list all and filter.
        let resp: ApiResponse<Vec<Folder>> = client.get("/folders.json").await?;
        let root_folders = resp
            .body
            .into_iter()
            .filter(|f| f.folder_parent_id.is_none())
            .collect();
        Ok(root_folders)
    }

    /// List child folders of a parent.
    pub async fn list_children(
        client: &PassboltApiClient,
        parent_id: &str,
    ) -> Result<Vec<Folder>, PassboltError> {
        let params = FolderListParams {
            has_parent: Some(parent_id.to_string()),
            contain_creator: Some(true),
            ..Default::default()
        };
        Self::list(client, Some(&params)).await
    }

    /// Get the full folder tree (all folders in one list).
    pub async fn get_tree(client: &PassboltApiClient) -> Result<Vec<Folder>, PassboltError> {
        let params = FolderListParams {
            contain_children_resources: Some(true),
            contain_children_folders: Some(true),
            ..Default::default()
        };
        Self::list(client, Some(&params)).await
    }
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_folder_request_serialize() {
        let req = CreateFolderRequest {
            name: "Test Folder".into(),
            metadata: None,
            metadata_key_id: None,
            metadata_key_type: None,
            folder_parent_id: Some("parent-uuid".into()),
        };
        let json = serde_json::to_value(&req).unwrap();
        assert_eq!(json["name"], "Test Folder");
        assert_eq!(json["folder_parent_id"], "parent-uuid");
    }

    #[test]
    fn test_create_folder_request_no_parent() {
        let req = CreateFolderRequest {
            name: "Root Folder".into(),
            metadata: None,
            metadata_key_id: None,
            metadata_key_type: None,
            folder_parent_id: None,
        };
        let json = serde_json::to_value(&req).unwrap();
        assert_eq!(json["name"], "Root Folder");
    }

    #[test]
    fn test_update_folder_request() {
        let req = UpdateFolderRequest {
            metadata: "encrypted-name".into(),
            metadata_key_id: "mk-uuid".into(),
            metadata_key_type: "shared_key".into(),
        };
        let json = serde_json::to_value(&req).unwrap();
        assert_eq!(json["metadata"], "encrypted-name");
    }

    #[test]
    fn test_move_request_serialize() {
        let req = MoveRequest {
            folder_parent_id: Some("new-parent".into()),
        };
        let json = serde_json::to_value(&req).unwrap();
        assert_eq!(json["folder_parent_id"], "new-parent");
    }

    #[test]
    fn test_folder_deserialize() {
        let json = r#"{
            "id": "folder-uuid",
            "name": "My Folder",
            "created": "2024-01-01T00:00:00Z",
            "modified": "2024-01-02T00:00:00Z",
            "created_by": "user-uuid",
            "modified_by": "user-uuid"
        }"#;
        let f: Folder = serde_json::from_str(json).unwrap();
        assert_eq!(f.id, "folder-uuid");
        assert_eq!(f.name, Some("My Folder".into()));
    }

    #[test]
    fn test_folder_list_params_default() {
        let params = FolderListParams::default();
        assert!(params.search.is_none());
        assert!(params.has_parent.is_none());
    }
}
