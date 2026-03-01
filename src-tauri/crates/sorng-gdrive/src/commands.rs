//! Tauri command handlers for Google Drive integration.
//!
//! All commands follow the `gdrive_*` naming convention and accept
//! `State<'_, GDriveServiceState>` as their first parameter.

use tauri::State;

use crate::service::GDriveServiceState;
use crate::types::*;

// Helper: convert GDriveError to a String for Tauri error channel.
fn err_str(e: GDriveError) -> String {
    e.to_string()
}

// ── Auth ─────────────────────────────────────────────────────────

/// Set OAuth2 credentials for Drive integration.
#[tauri::command]
pub async fn gdrive_set_credentials(
    state: State<'_, GDriveServiceState>,
    client_id: String,
    client_secret: String,
    redirect_uri: String,
    scopes: Vec<String>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.set_credentials(OAuthCredentials {
        client_id,
        client_secret,
        redirect_uri,
        scopes,
    });
    Ok(())
}

/// Build the OAuth2 authorization URL.
#[tauri::command]
pub async fn gdrive_get_auth_url(
    state: State<'_, GDriveServiceState>,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.build_auth_url().map_err(err_str)
}

/// Exchange an authorization code for tokens.
#[tauri::command]
pub async fn gdrive_exchange_code(
    state: State<'_, GDriveServiceState>,
    code: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.exchange_code(&code).await.map_err(err_str)
}

/// Refresh the access token using the stored refresh token.
#[tauri::command]
pub async fn gdrive_refresh_token(
    state: State<'_, GDriveServiceState>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.refresh_token().await.map_err(err_str)
}

/// Set a token directly (e.g. from persisted storage).
#[tauri::command]
pub async fn gdrive_set_token(
    state: State<'_, GDriveServiceState>,
    token: OAuthToken,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.set_token(token);
    Ok(())
}

/// Get the current token (for persistence).
#[tauri::command]
pub async fn gdrive_get_token(
    state: State<'_, GDriveServiceState>,
) -> Result<Option<OAuthToken>, String> {
    let svc = state.lock().await;
    Ok(svc.get_token())
}

/// Revoke the current token.
#[tauri::command]
pub async fn gdrive_revoke(
    state: State<'_, GDriveServiceState>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.revoke().await.map_err(err_str)
}

/// Check if currently authenticated.
#[tauri::command]
pub async fn gdrive_is_authenticated(
    state: State<'_, GDriveServiceState>,
) -> Result<bool, String> {
    let svc = state.lock().await;
    Ok(svc.is_authenticated())
}

/// Get connection summary.
#[tauri::command]
pub async fn gdrive_connection_summary(
    state: State<'_, GDriveServiceState>,
) -> Result<GDriveConnectionSummary, String> {
    let svc = state.lock().await;
    Ok(svc.connection_summary())
}

// ── About ────────────────────────────────────────────────────────

/// Get account info (user, storage quota, etc.).
#[tauri::command]
pub async fn gdrive_get_about(
    state: State<'_, GDriveServiceState>,
) -> Result<DriveAbout, String> {
    let mut svc = state.lock().await;
    svc.get_about().await.map_err(err_str)
}

// ── Files ────────────────────────────────────────────────────────

/// Get file metadata.
#[tauri::command]
pub async fn gdrive_get_file(
    state: State<'_, GDriveServiceState>,
    file_id: String,
) -> Result<DriveFile, String> {
    let mut svc = state.lock().await;
    svc.get_file(&file_id).await.map_err(err_str)
}

/// List files with optional filter parameters.
#[tauri::command]
pub async fn gdrive_list_files(
    state: State<'_, GDriveServiceState>,
    query: Option<String>,
    page_size: Option<u32>,
    page_token: Option<String>,
    order_by: Option<String>,
) -> Result<FileList, String> {
    let mut svc = state.lock().await;
    let params = ListFilesParams {
        query,
        page_size,
        page_token,
        order_by,
        ..Default::default()
    };
    svc.list_files(&params).await.map_err(err_str)
}

/// Create a file (metadata only).
#[tauri::command]
pub async fn gdrive_create_file(
    state: State<'_, GDriveServiceState>,
    name: String,
    mime_type: Option<String>,
    parents: Vec<String>,
    description: Option<String>,
) -> Result<DriveFile, String> {
    let mut svc = state.lock().await;
    let request = CreateFileRequest {
        name,
        mime_type,
        parents,
        description,
        starred: None,
    };
    svc.create_file(&request).await.map_err(err_str)
}

/// Update file metadata.
#[tauri::command]
pub async fn gdrive_update_file(
    state: State<'_, GDriveServiceState>,
    file_id: String,
    name: Option<String>,
    description: Option<String>,
    starred: Option<bool>,
    trashed: Option<bool>,
) -> Result<DriveFile, String> {
    let mut svc = state.lock().await;
    let request = UpdateFileRequest {
        name,
        description,
        starred,
        trashed,
        ..Default::default()
    };
    svc.update_file(&file_id, &request).await.map_err(err_str)
}

/// Copy a file.
#[tauri::command]
pub async fn gdrive_copy_file(
    state: State<'_, GDriveServiceState>,
    file_id: String,
    new_name: Option<String>,
    parents: Vec<String>,
) -> Result<DriveFile, String> {
    let mut svc = state.lock().await;
    let request = CopyFileRequest {
        name: new_name,
        parents,
        description: None,
    };
    svc.copy_file(&file_id, &request).await.map_err(err_str)
}

/// Delete a file permanently.
#[tauri::command]
pub async fn gdrive_delete_file(
    state: State<'_, GDriveServiceState>,
    file_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.delete_file(&file_id).await.map_err(err_str)
}

/// Move a file to trash.
#[tauri::command]
pub async fn gdrive_trash_file(
    state: State<'_, GDriveServiceState>,
    file_id: String,
) -> Result<DriveFile, String> {
    let mut svc = state.lock().await;
    svc.trash_file(&file_id).await.map_err(err_str)
}

/// Restore a file from trash.
#[tauri::command]
pub async fn gdrive_untrash_file(
    state: State<'_, GDriveServiceState>,
    file_id: String,
) -> Result<DriveFile, String> {
    let mut svc = state.lock().await;
    svc.untrash_file(&file_id).await.map_err(err_str)
}

/// Empty the trash.
#[tauri::command]
pub async fn gdrive_empty_trash(
    state: State<'_, GDriveServiceState>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.empty_trash().await.map_err(err_str)
}

/// Star a file.
#[tauri::command]
pub async fn gdrive_star_file(
    state: State<'_, GDriveServiceState>,
    file_id: String,
) -> Result<DriveFile, String> {
    let mut svc = state.lock().await;
    svc.star_file(&file_id).await.map_err(err_str)
}

/// Rename a file.
#[tauri::command]
pub async fn gdrive_rename_file(
    state: State<'_, GDriveServiceState>,
    file_id: String,
    new_name: String,
) -> Result<DriveFile, String> {
    let mut svc = state.lock().await;
    svc.rename_file(&file_id, &new_name).await.map_err(err_str)
}

/// Move a file to a different folder.
#[tauri::command]
pub async fn gdrive_move_file(
    state: State<'_, GDriveServiceState>,
    file_id: String,
    new_parent_id: String,
    old_parent_id: String,
) -> Result<DriveFile, String> {
    let mut svc = state.lock().await;
    svc.move_file(&file_id, &new_parent_id, &old_parent_id)
        .await
        .map_err(err_str)
}

/// Generate unique file IDs.
#[tauri::command]
pub async fn gdrive_generate_ids(
    state: State<'_, GDriveServiceState>,
    count: u32,
) -> Result<Vec<String>, String> {
    let mut svc = state.lock().await;
    svc.generate_ids(count).await.map_err(err_str)
}

// ── Folders ──────────────────────────────────────────────────────

/// Create a folder.
#[tauri::command]
pub async fn gdrive_create_folder(
    state: State<'_, GDriveServiceState>,
    name: String,
    parent_id: Option<String>,
) -> Result<DriveFile, String> {
    let mut svc = state.lock().await;
    svc.create_folder(&name, parent_id.as_deref())
        .await
        .map_err(err_str)
}

/// List children of a folder.
#[tauri::command]
pub async fn gdrive_list_children(
    state: State<'_, GDriveServiceState>,
    folder_id: String,
    page_size: Option<u32>,
    page_token: Option<String>,
) -> Result<FileList, String> {
    let mut svc = state.lock().await;
    svc.list_children(&folder_id, page_size, page_token.as_deref())
        .await
        .map_err(err_str)
}

/// List subfolders of a folder.
#[tauri::command]
pub async fn gdrive_list_subfolders(
    state: State<'_, GDriveServiceState>,
    folder_id: String,
) -> Result<Vec<DriveFile>, String> {
    let mut svc = state.lock().await;
    svc.list_subfolders(&folder_id).await.map_err(err_str)
}

/// Find a folder by name under a parent.
#[tauri::command]
pub async fn gdrive_find_folder(
    state: State<'_, GDriveServiceState>,
    name: String,
    parent_id: Option<String>,
) -> Result<Option<DriveFile>, String> {
    let mut svc = state.lock().await;
    svc.find_folder(&name, parent_id.as_deref())
        .await
        .map_err(err_str)
}

// ── Uploads ──────────────────────────────────────────────────────

/// Upload a file from the local filesystem.
#[tauri::command]
pub async fn gdrive_upload_file(
    state: State<'_, GDriveServiceState>,
    file_path: String,
    name: String,
    parents: Vec<String>,
    mime_type: Option<String>,
    description: Option<String>,
) -> Result<DriveFile, String> {
    let mut svc = state.lock().await;
    let request = UploadRequest {
        file_path,
        name,
        parents,
        mime_type,
        description,
        upload_type: UploadType::default(),
        convert_to_google_format: false,
    };
    svc.upload_file(&request).await.map_err(err_str)
}

// ── Downloads ────────────────────────────────────────────────────

/// Download a file to the local filesystem.
#[tauri::command]
pub async fn gdrive_download_file(
    state: State<'_, GDriveServiceState>,
    file_id: String,
    destination: String,
) -> Result<u64, String> {
    let mut svc = state.lock().await;
    svc.download_file(&file_id, &destination)
        .await
        .map_err(err_str)
}

/// Export a Google Workspace file and download.
#[tauri::command]
pub async fn gdrive_export_file(
    state: State<'_, GDriveServiceState>,
    file_id: String,
    export_mime_type: String,
    destination: String,
) -> Result<u64, String> {
    let mut svc = state.lock().await;
    svc.export_and_download(&file_id, &export_mime_type, &destination)
        .await
        .map_err(err_str)
}

// ── Sharing ──────────────────────────────────────────────────────

/// Share a file with a user by email.
#[tauri::command]
pub async fn gdrive_share_with_user(
    state: State<'_, GDriveServiceState>,
    file_id: String,
    email: String,
    role: PermissionRole,
    send_notification: bool,
) -> Result<DrivePermission, String> {
    let mut svc = state.lock().await;
    svc.share_with_user(&file_id, &email, role, send_notification)
        .await
        .map_err(err_str)
}

/// Make a file public (share with anyone).
#[tauri::command]
pub async fn gdrive_share_with_anyone(
    state: State<'_, GDriveServiceState>,
    file_id: String,
    role: PermissionRole,
) -> Result<DrivePermission, String> {
    let mut svc = state.lock().await;
    svc.share_with_anyone(&file_id, role).await.map_err(err_str)
}

/// List permissions on a file.
#[tauri::command]
pub async fn gdrive_list_permissions(
    state: State<'_, GDriveServiceState>,
    file_id: String,
) -> Result<Vec<DrivePermission>, String> {
    let mut svc = state.lock().await;
    svc.list_permissions(&file_id).await.map_err(err_str)
}

/// Delete a permission from a file.
#[tauri::command]
pub async fn gdrive_delete_permission(
    state: State<'_, GDriveServiceState>,
    file_id: String,
    permission_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.delete_permission(&file_id, &permission_id)
        .await
        .map_err(err_str)
}

/// Remove all non-owner permissions from a file.
#[tauri::command]
pub async fn gdrive_unshare_all(
    state: State<'_, GDriveServiceState>,
    file_id: String,
) -> Result<BatchResult, String> {
    let mut svc = state.lock().await;
    svc.unshare_all(&file_id).await.map_err(err_str)
}

// ── Revisions ────────────────────────────────────────────────────

/// List all revisions of a file.
#[tauri::command]
pub async fn gdrive_list_revisions(
    state: State<'_, GDriveServiceState>,
    file_id: String,
) -> Result<Vec<DriveRevision>, String> {
    let mut svc = state.lock().await;
    svc.list_revisions(&file_id).await.map_err(err_str)
}

/// Pin a revision (keep forever).
#[tauri::command]
pub async fn gdrive_pin_revision(
    state: State<'_, GDriveServiceState>,
    file_id: String,
    revision_id: String,
) -> Result<DriveRevision, String> {
    let mut svc = state.lock().await;
    svc.pin_revision(&file_id, &revision_id)
        .await
        .map_err(err_str)
}

// ── Comments ─────────────────────────────────────────────────────

/// List comments on a file.
#[tauri::command]
pub async fn gdrive_list_comments(
    state: State<'_, GDriveServiceState>,
    file_id: String,
    include_deleted: bool,
) -> Result<Vec<DriveComment>, String> {
    let mut svc = state.lock().await;
    svc.list_comments(&file_id, include_deleted)
        .await
        .map_err(err_str)
}

/// Create a comment on a file.
#[tauri::command]
pub async fn gdrive_create_comment(
    state: State<'_, GDriveServiceState>,
    file_id: String,
    content: String,
) -> Result<DriveComment, String> {
    let mut svc = state.lock().await;
    svc.create_comment(&file_id, &content)
        .await
        .map_err(err_str)
}

/// Resolve a comment.
#[tauri::command]
pub async fn gdrive_resolve_comment(
    state: State<'_, GDriveServiceState>,
    file_id: String,
    comment_id: String,
) -> Result<DriveReply, String> {
    let mut svc = state.lock().await;
    svc.resolve_comment(&file_id, &comment_id)
        .await
        .map_err(err_str)
}

/// Create a reply to a comment.
#[tauri::command]
pub async fn gdrive_create_reply(
    state: State<'_, GDriveServiceState>,
    file_id: String,
    comment_id: String,
    content: String,
) -> Result<DriveReply, String> {
    let mut svc = state.lock().await;
    svc.create_reply(&file_id, &comment_id, &content)
        .await
        .map_err(err_str)
}

// ── Shared drives ────────────────────────────────────────────────

/// List all shared drives.
#[tauri::command]
pub async fn gdrive_list_drives(
    state: State<'_, GDriveServiceState>,
) -> Result<Vec<SharedDrive>, String> {
    let mut svc = state.lock().await;
    svc.list_drives().await.map_err(err_str)
}

/// Create a shared drive.
#[tauri::command]
pub async fn gdrive_create_drive(
    state: State<'_, GDriveServiceState>,
    name: String,
    request_id: String,
) -> Result<SharedDrive, String> {
    let mut svc = state.lock().await;
    svc.create_drive(&name, &request_id).await.map_err(err_str)
}

/// Delete a shared drive.
#[tauri::command]
pub async fn gdrive_delete_drive(
    state: State<'_, GDriveServiceState>,
    drive_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.delete_drive(&drive_id).await.map_err(err_str)
}

// ── Changes ──────────────────────────────────────────────────────

/// Get the initial page token for change tracking.
#[tauri::command]
pub async fn gdrive_get_start_page_token(
    state: State<'_, GDriveServiceState>,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    svc.get_start_page_token().await.map_err(err_str)
}

/// Poll for changes since the last token.
#[tauri::command]
pub async fn gdrive_poll_changes(
    state: State<'_, GDriveServiceState>,
) -> Result<Vec<DriveChange>, String> {
    let mut svc = state.lock().await;
    svc.poll_changes().await.map_err(err_str)
}

// ── Search ───────────────────────────────────────────────────────

/// Search for files using a Drive query string.
#[tauri::command]
pub async fn gdrive_search(
    state: State<'_, GDriveServiceState>,
    query: String,
    page_size: Option<u32>,
    order_by: Option<String>,
) -> Result<FileList, String> {
    let mut svc = state.lock().await;
    svc.search(&query, page_size, order_by.as_deref())
        .await
        .map_err(err_str)
}
