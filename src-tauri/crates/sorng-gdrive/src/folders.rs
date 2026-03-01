//! Google Drive folder operations.
//!
//! Folders in Drive are files with MIME type `application/vnd.google-apps.folder`.
//! This module provides convenience wrappers around the generic file operations.

use crate::client::GDriveClient;
use crate::files;
use crate::types::{
    mime_types, CreateFileRequest, DriveFile, FileList, GDriveResult, ListFilesParams,
};

/// Create a new folder.
pub async fn create_folder(
    client: &GDriveClient,
    name: &str,
    parent_id: Option<&str>,
) -> GDriveResult<DriveFile> {
    let request = CreateFileRequest {
        name: name.to_string(),
        mime_type: Some(mime_types::FOLDER.to_string()),
        parents: parent_id.map(|p| vec![p.to_string()]).unwrap_or_default(),
        ..Default::default()
    };
    files::create_file(client, &request).await
}

/// Create nested folders, returning the innermost folder.
pub async fn create_folder_path(
    client: &GDriveClient,
    path: &[&str],
    root_parent_id: Option<&str>,
) -> GDriveResult<DriveFile> {
    let mut current_parent = root_parent_id.map(|s| s.to_string());

    let mut last_folder = None;
    for segment in path {
        let folder = create_folder(client, segment, current_parent.as_deref()).await?;
        current_parent = Some(folder.id.clone());
        last_folder = Some(folder);
    }

    last_folder.ok_or_else(|| {
        crate::types::GDriveError::invalid("Path must contain at least one segment")
    })
}

/// List children of a folder.
pub async fn list_children(
    client: &GDriveClient,
    folder_id: &str,
    page_size: Option<u32>,
    page_token: Option<&str>,
) -> GDriveResult<FileList> {
    let params = ListFilesParams {
        query: Some(format!(
            "'{}' in parents and trashed = false",
            folder_id.replace('\'', "\\'")
        )),
        page_size,
        page_token: page_token.map(|s| s.to_string()),
        ..Default::default()
    };
    files::list_files(client, &params).await
}

/// List all children of a folder (consuming all pages).
pub async fn list_all_children(
    client: &GDriveClient,
    folder_id: &str,
) -> GDriveResult<Vec<DriveFile>> {
    let params = ListFilesParams {
        query: Some(format!(
            "'{}' in parents and trashed = false",
            folder_id.replace('\'', "\\'")
        )),
        ..Default::default()
    };
    files::list_all_files(client, &params).await
}

/// List only subfolders of a folder.
pub async fn list_subfolders(
    client: &GDriveClient,
    folder_id: &str,
) -> GDriveResult<Vec<DriveFile>> {
    let params = ListFilesParams {
        query: Some(format!(
            "'{}' in parents and mimeType = '{}' and trashed = false",
            folder_id.replace('\'', "\\'"),
            mime_types::FOLDER
        )),
        ..Default::default()
    };
    files::list_all_files(client, &params).await
}

/// List only non-folder files in a folder.
pub async fn list_files_only(
    client: &GDriveClient,
    folder_id: &str,
) -> GDriveResult<Vec<DriveFile>> {
    let params = ListFilesParams {
        query: Some(format!(
            "'{}' in parents and mimeType != '{}' and trashed = false",
            folder_id.replace('\'', "\\'"),
            mime_types::FOLDER
        )),
        ..Default::default()
    };
    files::list_all_files(client, &params).await
}

/// Search for a folder by name under a given parent.
pub async fn find_folder(
    client: &GDriveClient,
    name: &str,
    parent_id: Option<&str>,
) -> GDriveResult<Option<DriveFile>> {
    let mut q = format!(
        "mimeType = '{}' and name = '{}' and trashed = false",
        mime_types::FOLDER,
        name.replace('\'', "\\'")
    );
    if let Some(pid) = parent_id {
        q.push_str(&format!(
            " and '{}' in parents",
            pid.replace('\'', "\\'")
        ));
    }

    let params = ListFilesParams {
        query: Some(q),
        page_size: Some(1),
        ..Default::default()
    };
    let list = files::list_files(client, &params).await?;
    Ok(list.files.into_iter().next())
}

/// Get or create a folder by name under a given parent.
pub async fn get_or_create_folder(
    client: &GDriveClient,
    name: &str,
    parent_id: Option<&str>,
) -> GDriveResult<DriveFile> {
    if let Some(existing) = find_folder(client, name, parent_id).await? {
        return Ok(existing);
    }
    create_folder(client, name, parent_id).await
}

/// Move a file into a folder.
pub async fn move_to_folder(
    client: &GDriveClient,
    file_id: &str,
    new_folder_id: &str,
    current_folder_id: &str,
) -> GDriveResult<DriveFile> {
    files::move_file(client, file_id, new_folder_id, current_folder_id).await
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Tests
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_file_request_produces_folder_mime() {
        let req = CreateFileRequest {
            name: "Projects".into(),
            mime_type: Some(mime_types::FOLDER.to_string()),
            parents: vec!["root".into()],
            ..Default::default()
        };
        let json = serde_json::to_string(&req).unwrap();
        assert!(json.contains(mime_types::FOLDER));
        assert!(json.contains("Projects"));
    }

    #[test]
    fn query_escaping() {
        let folder_id = "abc'123";
        let q = format!(
            "'{}' in parents and trashed = false",
            folder_id.replace('\'', "\\'")
        );
        assert!(q.contains("abc\\'123"));
    }

    #[test]
    fn subfolder_query() {
        let folder_id = "root";
        let q = format!(
            "'{}' in parents and mimeType = '{}' and trashed = false",
            folder_id,
            mime_types::FOLDER
        );
        assert!(q.contains("mimeType"));
        assert!(q.contains(mime_types::FOLDER));
    }

    #[test]
    fn files_only_query() {
        let folder_id = "parent1";
        let q = format!(
            "'{}' in parents and mimeType != '{}' and trashed = false",
            folder_id,
            mime_types::FOLDER
        );
        assert!(q.contains("mimeType !="));
    }

    #[test]
    fn find_folder_query_with_parent() {
        let name = "Documents";
        let parent_id = Some("root");
        let mut q = format!(
            "mimeType = '{}' and name = '{}' and trashed = false",
            mime_types::FOLDER,
            name.replace('\'', "\\'")
        );
        if let Some(pid) = parent_id {
            q.push_str(&format!(" and '{}' in parents", pid));
        }
        assert!(q.contains("Documents"));
        assert!(q.contains("'root' in parents"));
    }
}
