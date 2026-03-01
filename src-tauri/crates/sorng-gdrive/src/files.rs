//! Google Drive file operations (CRUD, trash, copy, export, generate IDs).

use serde::Deserialize;

use crate::client::GDriveClient;
use crate::types::{
    CopyFileRequest, CreateFileRequest, DriveFile, FileList, GDriveResult,
    ListFilesParams, UpdateFileRequest,
};

/// Standard fields to request for file metadata.
pub const DEFAULT_FILE_FIELDS: &str = "id,name,mimeType,size,parents,createdTime,modifiedTime,trashed,starred,webViewLink,webContentLink,owners,permissions,capabilities,description,fileExtension,md5Checksum,headRevisionId,version,originalFilename,fullFileExtension,writersCanShare,viewersCanCopyContent,iconLink,thumbnailLink,explicitlyTrashed,viewedByMeTime,sharedWithMeTime,sharingUser,lastModifyingUser";

/// Get file metadata by ID.
pub async fn get_file(client: &GDriveClient, file_id: &str) -> GDriveResult<DriveFile> {
    let url = GDriveClient::api_url(&format!("files/{}", file_id));
    let query = [
        ("fields", client.config().default_file_fields.as_str()),
        ("supportsAllDrives", "true"),
    ];
    client.get_json_with_query(&url, &query).await
}

/// Get file metadata with custom fields.
pub async fn get_file_with_fields(
    client: &GDriveClient,
    file_id: &str,
    fields: &str,
) -> GDriveResult<DriveFile> {
    let url = GDriveClient::api_url(&format!("files/{}", file_id));
    let query = [("fields", fields), ("supportsAllDrives", "true")];
    client.get_json_with_query(&url, &query).await
}

/// List files matching the given parameters.
pub async fn list_files(
    client: &GDriveClient,
    params: &ListFilesParams,
) -> GDriveResult<FileList> {
    let url = GDriveClient::api_url("files");

    let mut query: Vec<(&str, String)> = Vec::new();

    if let Some(ref q) = params.query {
        query.push(("q", q.clone()));
    }

    let page_size = params.page_size.unwrap_or(client.config().default_page_size);
    query.push(("pageSize", page_size.to_string()));

    if let Some(ref token) = params.page_token {
        query.push(("pageToken", token.clone()));
    }

    let default_fields = format!("nextPageToken,incompleteSearch,files({})", client.config().default_file_fields);
    let fields = params.fields.as_deref().unwrap_or(&default_fields);
    query.push(("fields", fields.to_string()));

    if let Some(ref order) = params.order_by {
        query.push(("orderBy", order.clone()));
    }

    if let Some(ref corpora) = params.corpora {
        query.push(("corpora", corpora.clone()));
    }

    if let Some(ref drive_id) = params.drive_id {
        query.push(("driveId", drive_id.clone()));
    }

    if params.include_items_from_all_drives.unwrap_or(false) {
        query.push(("includeItemsFromAllDrives", "true".to_string()));
        query.push(("supportsAllDrives", "true".to_string()));
    }

    if let Some(ref spaces) = params.spaces {
        query.push(("spaces", spaces.clone()));
    }

    client.get_json_with_query(&url, &query).await
}

/// List all files matching the params by consuming all pages.
pub async fn list_all_files(
    client: &GDriveClient,
    params: &ListFilesParams,
) -> GDriveResult<Vec<DriveFile>> {
    let mut all_files = Vec::new();
    let mut page_params = params.clone();

    loop {
        let page = list_files(client, &page_params).await?;
        all_files.extend(page.files);

        match page.next_page_token {
            Some(token) => page_params.page_token = Some(token),
            None => break,
        }
    }

    Ok(all_files)
}

/// Create a new file (metadata only, no content).
pub async fn create_file(
    client: &GDriveClient,
    request: &CreateFileRequest,
) -> GDriveResult<DriveFile> {
    let url = format!(
        "{}?supportsAllDrives=true&fields={}",
        GDriveClient::api_url("files"),
        client.config().default_file_fields
    );
    client.post_json(&url, request).await
}

/// Update a file's metadata.
pub async fn update_file(
    client: &GDriveClient,
    file_id: &str,
    request: &UpdateFileRequest,
) -> GDriveResult<DriveFile> {
    let mut url = format!(
        "{}?supportsAllDrives=true&fields={}",
        GDriveClient::api_url(&format!("files/{}", file_id)),
        client.config().default_file_fields
    );

    if !request.add_parents.is_empty() {
        url.push_str(&format!("&addParents={}", request.add_parents.join(",")));
    }
    if !request.remove_parents.is_empty() {
        url.push_str(&format!(
            "&removeParents={}",
            request.remove_parents.join(",")
        ));
    }

    client.patch_json(&url, request).await
}

/// Copy a file.
pub async fn copy_file(
    client: &GDriveClient,
    file_id: &str,
    request: &CopyFileRequest,
) -> GDriveResult<DriveFile> {
    let url = format!(
        "{}?supportsAllDrives=true&fields={}",
        GDriveClient::api_url(&format!("files/{}/copy", file_id)),
        client.config().default_file_fields
    );
    client.post_json(&url, request).await
}

/// Delete a file permanently (bypasses trash).
pub async fn delete_file(client: &GDriveClient, file_id: &str) -> GDriveResult<()> {
    let url = format!(
        "{}?supportsAllDrives=true",
        GDriveClient::api_url(&format!("files/{}", file_id))
    );
    client.delete(&url).await
}

/// Move a file to trash.
pub async fn trash_file(client: &GDriveClient, file_id: &str) -> GDriveResult<DriveFile> {
    let request = UpdateFileRequest {
        trashed: Some(true),
        ..Default::default()
    };
    update_file(client, file_id, &request).await
}

/// Restore a file from trash.
pub async fn untrash_file(client: &GDriveClient, file_id: &str) -> GDriveResult<DriveFile> {
    let request = UpdateFileRequest {
        trashed: Some(false),
        ..Default::default()
    };
    update_file(client, file_id, &request).await
}

/// Empty the user's trash.
pub async fn empty_trash(client: &GDriveClient) -> GDriveResult<()> {
    let url = GDriveClient::api_url("files/trash");
    client.delete(&url).await
}

/// Star a file.
pub async fn star_file(client: &GDriveClient, file_id: &str) -> GDriveResult<DriveFile> {
    let request = UpdateFileRequest {
        starred: Some(true),
        ..Default::default()
    };
    update_file(client, file_id, &request).await
}

/// Unstar a file.
pub async fn unstar_file(client: &GDriveClient, file_id: &str) -> GDriveResult<DriveFile> {
    let request = UpdateFileRequest {
        starred: Some(false),
        ..Default::default()
    };
    update_file(client, file_id, &request).await
}

/// Rename a file.
pub async fn rename_file(
    client: &GDriveClient,
    file_id: &str,
    new_name: &str,
) -> GDriveResult<DriveFile> {
    let request = UpdateFileRequest {
        name: Some(new_name.to_string()),
        ..Default::default()
    };
    update_file(client, file_id, &request).await
}

/// Move a file to a different folder.
pub async fn move_file(
    client: &GDriveClient,
    file_id: &str,
    new_parent_id: &str,
    old_parent_id: &str,
) -> GDriveResult<DriveFile> {
    let request = UpdateFileRequest {
        add_parents: vec![new_parent_id.to_string()],
        remove_parents: vec![old_parent_id.to_string()],
        ..Default::default()
    };
    update_file(client, file_id, &request).await
}

/// Export a Google Workspace document.
pub async fn export_file(
    client: &GDriveClient,
    file_id: &str,
    export_mime_type: &str,
) -> GDriveResult<Vec<u8>> {
    let url = format!(
        "{}?mimeType={}",
        GDriveClient::api_url(&format!("files/{}/export", file_id)),
        url::form_urlencoded::byte_serialize(export_mime_type.as_bytes()).collect::<String>()
    );
    client.get_bytes(&url).await
}

/// Generate unique file IDs for later use.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GeneratedIds {
    ids: Vec<String>,
}

pub async fn generate_ids(client: &GDriveClient, count: u32) -> GDriveResult<Vec<String>> {
    let url = GDriveClient::api_url("files/generateIds");
    let count_clamped = count.min(1000).max(1);
    let query = [
        ("count", count_clamped.to_string()),
        ("space", "drive".to_string()),
    ];
    let resp: GeneratedIds = client.get_json_with_query(&url, &query).await?;
    Ok(resp.ids)
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Tests
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_file_fields_contains_key_fields() {
        assert!(DEFAULT_FILE_FIELDS.contains("id"));
        assert!(DEFAULT_FILE_FIELDS.contains("name"));
        assert!(DEFAULT_FILE_FIELDS.contains("mimeType"));
        assert!(DEFAULT_FILE_FIELDS.contains("parents"));
        assert!(DEFAULT_FILE_FIELDS.contains("capabilities"));
    }

    #[test]
    fn url_patterns() {
        let file_url = GDriveClient::api_url("files/abc123");
        assert!(file_url.ends_with("/files/abc123"));

        let copy_url = GDriveClient::api_url("files/abc123/copy");
        assert!(copy_url.ends_with("/files/abc123/copy"));

        let export_url = GDriveClient::api_url("files/abc123/export");
        assert!(export_url.ends_with("/files/abc123/export"));
    }

    #[test]
    fn list_files_params_default() {
        let p = ListFilesParams::default();
        assert!(p.query.is_none());
        assert!(p.page_size.is_none());
        assert!(p.page_token.is_none());
        assert!(p.order_by.is_none());
        assert!(p.corpora.is_none());
    }

    #[test]
    fn create_file_request_serialization() {
        let req = CreateFileRequest {
            name: "test.txt".into(),
            mime_type: Some("text/plain".into()),
            parents: vec!["root".into()],
            ..Default::default()
        };
        let json = serde_json::to_string(&req).unwrap();
        assert!(json.contains("test.txt"));
        assert!(json.contains("text/plain"));
        assert!(json.contains("root"));
    }

    #[test]
    fn update_file_request_serialization() {
        let req = UpdateFileRequest {
            name: Some("renamed.txt".into()),
            starred: Some(true),
            ..Default::default()
        };
        let json = serde_json::to_string(&req).unwrap();
        assert!(json.contains("renamed.txt"));
        assert!(json.contains("true"));
    }

    #[test]
    fn copy_file_request_serialization() {
        let req = CopyFileRequest {
            name: Some("copy.txt".into()),
            parents: vec!["folder1".into()],
            description: Some("A copy".into()),
        };
        let json = serde_json::to_string(&req).unwrap();
        assert!(json.contains("copy.txt"));
        assert!(json.contains("folder1"));
    }

    #[test]
    fn generated_ids_deserialize() {
        let json = r#"{"ids":["id1","id2","id3"]}"#;
        let gen: GeneratedIds = serde_json::from_str(json).unwrap();
        assert_eq!(gen.ids.len(), 3);
    }
}
