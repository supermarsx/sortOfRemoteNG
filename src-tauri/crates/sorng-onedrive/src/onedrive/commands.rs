//! Tauri `#[tauri::command]` handlers for the OneDrive integration.
//!
//! Every command is prefixed with `od_` and takes the managed
//! `OneDriveServiceState` as its first parameter.

use crate::onedrive::auth;
use crate::onedrive::error::OneDriveResult;
use crate::onedrive::service::OneDriveServiceState;
use crate::onedrive::types::*;
#[allow(unused_imports)]
use log::info;

// ═══════════════════════════════════════════════════════════════════════
//  Auth
// ═══════════════════════════════════════════════════════════════════════

/// Generate a PKCE challenge for the auth-code flow.
#[tauri::command]
pub fn od_generate_pkce() -> PkceChallenge {
    auth::generate_pkce()
}

/// Build the authorization URL.
#[tauri::command]
pub fn od_build_auth_url(
    config: OneDriveConfig,
    pkce: PkceChallenge,
    state: String,
) -> String {
    auth::build_auth_url(&config, &pkce, &state)
}

/// Exchange an authorization code for tokens.
#[tauri::command]
pub async fn od_exchange_code(
    config: OneDriveConfig,
    code: String,
    pkce: PkceChallenge,
) -> OneDriveResult<OAuthTokenSet> {
    auth::exchange_code(&config, &code, &pkce).await
}

/// Start a device-code flow.
#[tauri::command]
pub async fn od_start_device_code(
    config: OneDriveConfig,
) -> OneDriveResult<DeviceCodeInfo> {
    auth::start_device_code_flow(&config).await
}

/// Poll a device-code flow.
#[tauri::command]
pub async fn od_poll_device_code(
    config: OneDriveConfig,
    device_code: String,
) -> OneDriveResult<OAuthTokenSet> {
    auth::poll_device_code(&config, &device_code).await
}

/// Client-credentials token grant.
#[tauri::command]
pub async fn od_client_credentials(
    config: OneDriveConfig,
) -> OneDriveResult<OAuthTokenSet> {
    auth::client_credentials_token(&config).await
}

// ═══════════════════════════════════════════════════════════════════════
//  Session management
// ═══════════════════════════════════════════════════════════════════════

/// Add a new OneDrive session.
#[tauri::command]
pub async fn od_add_session(
    state: tauri::State<'_, OneDriveServiceState>,
    config: OneDriveConfig,
    token: OAuthTokenSet,
) -> OneDriveResult<String> {
    let mut svc = state.write().await;
    svc.add_session(config, token).await
}

/// Remove a session.
#[tauri::command]
pub async fn od_remove_session(
    state: tauri::State<'_, OneDriveServiceState>,
    session_id: String,
) -> OneDriveResult<()> {
    let mut svc = state.write().await;
    svc.remove_session(&session_id)
}

/// List sessions.
#[tauri::command]
pub async fn od_list_sessions(
    state: tauri::State<'_, OneDriveServiceState>,
) -> OneDriveResult<Vec<OneDriveSessionSummary>> {
    let svc = state.read().await;
    Ok(svc.list_sessions())
}

// ═══════════════════════════════════════════════════════════════════════
//  Drives
// ═══════════════════════════════════════════════════════════════════════

/// Get the current user's default drive.
#[tauri::command]
pub async fn od_get_my_drive(
    state: tauri::State<'_, OneDriveServiceState>,
    session_id: String,
) -> OneDriveResult<Drive> {
    let mut svc = state.write().await;
    let (client, _) = svc.client_for(&session_id).await?;
    let drives = svc.drives(&client);
    drives.get_my_drive().await
}

/// List all drives accessible to the user.
#[tauri::command]
pub async fn od_list_drives(
    state: tauri::State<'_, OneDriveServiceState>,
    session_id: String,
) -> OneDriveResult<Vec<Drive>> {
    let mut svc = state.write().await;
    let (client, _) = svc.client_for(&session_id).await?;
    let drives = svc.drives(&client);
    drives.list_my_drives().await
}

// ═══════════════════════════════════════════════════════════════════════
//  Files & Folders
// ═══════════════════════════════════════════════════════════════════════

/// Get item metadata by ID.
#[tauri::command]
pub async fn od_get_item(
    state: tauri::State<'_, OneDriveServiceState>,
    session_id: String,
    item_id: String,
) -> OneDriveResult<DriveItem> {
    let mut svc = state.write().await;
    let (client, drive_id) = svc.client_for(&session_id).await?;
    let files = svc.files(&client, &drive_id);
    files.get_item(&item_id).await
}

/// Get item by path.
#[tauri::command]
pub async fn od_get_item_by_path(
    state: tauri::State<'_, OneDriveServiceState>,
    session_id: String,
    path: String,
) -> OneDriveResult<DriveItem> {
    let mut svc = state.write().await;
    let (client, drive_id) = svc.client_for(&session_id).await?;
    let files = svc.files(&client, &drive_id);
    files.get_item_by_path(&path).await
}

/// List children of a folder.
#[tauri::command]
pub async fn od_list_children(
    state: tauri::State<'_, OneDriveServiceState>,
    session_id: String,
    folder_id: String,
    top: Option<i32>,
) -> OneDriveResult<Vec<DriveItem>> {
    let mut svc = state.write().await;
    let (client, drive_id) = svc.client_for(&session_id).await?;
    let files = svc.files(&client, &drive_id);
    files.list_children(&folder_id, top).await
}

/// List root children.
#[tauri::command]
pub async fn od_list_root(
    state: tauri::State<'_, OneDriveServiceState>,
    session_id: String,
    top: Option<i32>,
) -> OneDriveResult<Vec<DriveItem>> {
    let mut svc = state.write().await;
    let (client, drive_id) = svc.client_for(&session_id).await?;
    let files = svc.files(&client, &drive_id);
    files.list_root_children(top).await
}

/// Download a file by item ID.
#[tauri::command]
pub async fn od_download(
    state: tauri::State<'_, OneDriveServiceState>,
    session_id: String,
    item_id: String,
) -> OneDriveResult<Vec<u8>> {
    let mut svc = state.write().await;
    let (client, drive_id) = svc.client_for(&session_id).await?;
    let files = svc.files(&client, &drive_id);
    files.download(&item_id).await
}

/// Upload a small file (≤ 4 MiB).
#[tauri::command]
pub async fn od_upload_small(
    state: tauri::State<'_, OneDriveServiceState>,
    session_id: String,
    parent_id: String,
    file_name: String,
    data: Vec<u8>,
    content_type: String,
) -> OneDriveResult<DriveItem> {
    let mut svc = state.write().await;
    let (client, drive_id) = svc.client_for(&session_id).await?;
    let files = svc.files(&client, &drive_id);
    files
        .upload_small(&parent_id, &file_name, data, &content_type)
        .await
}

/// Create a folder.
#[tauri::command]
pub async fn od_create_folder(
    state: tauri::State<'_, OneDriveServiceState>,
    session_id: String,
    parent_id: String,
    name: String,
) -> OneDriveResult<DriveItem> {
    let mut svc = state.write().await;
    let (client, drive_id) = svc.client_for(&session_id).await?;
    let files = svc.files(&client, &drive_id);
    files.create_folder(&parent_id, &name, None).await
}

/// Rename an item.
#[tauri::command]
pub async fn od_rename(
    state: tauri::State<'_, OneDriveServiceState>,
    session_id: String,
    item_id: String,
    new_name: String,
) -> OneDriveResult<DriveItem> {
    let mut svc = state.write().await;
    let (client, drive_id) = svc.client_for(&session_id).await?;
    let files = svc.files(&client, &drive_id);
    files.rename(&item_id, &new_name).await
}

/// Delete (trash) an item.
#[tauri::command]
pub async fn od_delete(
    state: tauri::State<'_, OneDriveServiceState>,
    session_id: String,
    item_id: String,
) -> OneDriveResult<()> {
    let mut svc = state.write().await;
    let (client, drive_id) = svc.client_for(&session_id).await?;
    let files = svc.files(&client, &drive_id);
    files.delete(&item_id).await
}

/// Restore an item from the recycle bin.
#[tauri::command]
pub async fn od_restore(
    state: tauri::State<'_, OneDriveServiceState>,
    session_id: String,
    item_id: String,
) -> OneDriveResult<DriveItem> {
    let mut svc = state.write().await;
    let (client, drive_id) = svc.client_for(&session_id).await?;
    let files = svc.files(&client, &drive_id);
    files.restore(&item_id).await
}

/// List versions of a file.
#[tauri::command]
pub async fn od_list_versions(
    state: tauri::State<'_, OneDriveServiceState>,
    session_id: String,
    item_id: String,
) -> OneDriveResult<Vec<DriveItemVersion>> {
    let mut svc = state.write().await;
    let (client, drive_id) = svc.client_for(&session_id).await?;
    let files = svc.files(&client, &drive_id);
    files.list_versions(&item_id).await
}

// ═══════════════════════════════════════════════════════════════════════
//  Search
// ═══════════════════════════════════════════════════════════════════════

/// Search for files/folders.
#[tauri::command]
pub async fn od_search(
    state: tauri::State<'_, OneDriveServiceState>,
    session_id: String,
    query: String,
    top: Option<i32>,
) -> OneDriveResult<Vec<DriveItem>> {
    let mut svc = state.write().await;
    let (client, drive_id) = svc.client_for(&session_id).await?;
    let search = svc.search(&client, &drive_id);
    search.search(&query, top).await
}

/// List recently accessed files.
#[tauri::command]
pub async fn od_recent(
    state: tauri::State<'_, OneDriveServiceState>,
    session_id: String,
) -> OneDriveResult<Vec<DriveItem>> {
    let mut svc = state.write().await;
    let (client, drive_id) = svc.client_for(&session_id).await?;
    let search = svc.search(&client, &drive_id);
    search.recent().await
}

// ═══════════════════════════════════════════════════════════════════════
//  Sharing
// ═══════════════════════════════════════════════════════════════════════

/// Create a sharing link.
#[tauri::command]
pub async fn od_create_link(
    state: tauri::State<'_, OneDriveServiceState>,
    session_id: String,
    item_id: String,
    link_type: String,
    scope: Option<String>,
) -> OneDriveResult<Permission> {
    let mut svc = state.write().await;
    let (client, drive_id) = svc.client_for(&session_id).await?;
    let sharing = svc.sharing(&client, &drive_id);
    let req = CreateLinkRequest {
        link_type,
        scope,
        expiration_date_time: None,
        password: None,
        retain_inherited_permissions: None,
    };
    sharing.create_link(&item_id, &req).await
}

/// List items shared with the current user.
#[tauri::command]
pub async fn od_shared_with_me(
    state: tauri::State<'_, OneDriveServiceState>,
    session_id: String,
) -> OneDriveResult<Vec<DriveItem>> {
    let mut svc = state.write().await;
    let (client, drive_id) = svc.client_for(&session_id).await?;
    let sharing = svc.sharing(&client, &drive_id);
    sharing.shared_with_me().await
}

// ═══════════════════════════════════════════════════════════════════════
//  Permissions
// ═══════════════════════════════════════════════════════════════════════

/// List permissions on an item.
#[tauri::command]
pub async fn od_list_permissions(
    state: tauri::State<'_, OneDriveServiceState>,
    session_id: String,
    item_id: String,
) -> OneDriveResult<Vec<Permission>> {
    let mut svc = state.write().await;
    let (client, drive_id) = svc.client_for(&session_id).await?;
    let perms = svc.permissions(&client, &drive_id);
    perms.list(&item_id).await
}

/// Remove a permission from an item.
#[tauri::command]
pub async fn od_remove_permission(
    state: tauri::State<'_, OneDriveServiceState>,
    session_id: String,
    item_id: String,
    permission_id: String,
) -> OneDriveResult<()> {
    let mut svc = state.write().await;
    let (client, drive_id) = svc.client_for(&session_id).await?;
    let perms = svc.permissions(&client, &drive_id);
    perms.remove(&item_id, &permission_id).await
}

// ═══════════════════════════════════════════════════════════════════════
//  Thumbnails
// ═══════════════════════════════════════════════════════════════════════

/// List thumbnails for an item.
#[tauri::command]
pub async fn od_list_thumbnails(
    state: tauri::State<'_, OneDriveServiceState>,
    session_id: String,
    item_id: String,
) -> OneDriveResult<Vec<ThumbnailSet>> {
    let mut svc = state.write().await;
    let (client, drive_id) = svc.client_for(&session_id).await?;
    let thumbs = svc.thumbnails(&client, &drive_id);
    thumbs.list(&item_id).await
}

/// Download a specific thumbnail.
#[tauri::command]
pub async fn od_download_thumbnail(
    state: tauri::State<'_, OneDriveServiceState>,
    session_id: String,
    item_id: String,
    size: String,
) -> OneDriveResult<Vec<u8>> {
    let mut svc = state.write().await;
    let (client, drive_id) = svc.client_for(&session_id).await?;
    let thumbs = svc.thumbnails(&client, &drive_id);
    thumbs.download(&item_id, 0, &size).await
}

// ═══════════════════════════════════════════════════════════════════════
//  Special Folders
// ═══════════════════════════════════════════════════════════════════════

/// Get a special folder by name.
#[tauri::command]
pub async fn od_get_special_folder(
    state: tauri::State<'_, OneDriveServiceState>,
    session_id: String,
    folder: SpecialFolder,
) -> OneDriveResult<DriveItem> {
    let mut svc = state.write().await;
    let (client, _) = svc.client_for(&session_id).await?;
    let sf = svc.special_folders(&client);
    sf.get(folder).await
}

// ═══════════════════════════════════════════════════════════════════════
//  Sync / Delta
// ═══════════════════════════════════════════════════════════════════════

/// Get the latest delta link for a drive (initialise sync cursor).
#[tauri::command]
pub async fn od_init_delta(
    state: tauri::State<'_, OneDriveServiceState>,
    session_id: String,
) -> OneDriveResult<DeltaSyncState> {
    let mut svc = state.write().await;
    let (client, drive_id) = svc.client_for(&session_id).await?;
    let engine = svc.sync_engine(&client, &drive_id);
    let link = engine.get_latest_delta_link().await?;
    Ok(DeltaSyncState {
        drive_id,
        delta_link: Some(link),
        last_sync: Some(chrono::Utc::now()),
        synced_items: 0,
    })
}

// ═══════════════════════════════════════════════════════════════════════
//  Webhooks
// ═══════════════════════════════════════════════════════════════════════

/// Create a webhook subscription.
#[tauri::command]
pub async fn od_create_subscription(
    state: tauri::State<'_, OneDriveServiceState>,
    session_id: String,
    request: SubscriptionRequest,
) -> OneDriveResult<Subscription> {
    let mut svc = state.write().await;
    let (client, _) = svc.client_for(&session_id).await?;
    let wh = svc.webhooks(&client);
    wh.create_subscription(&request).await
}

/// List active subscriptions.
#[tauri::command]
pub async fn od_list_subscriptions(
    state: tauri::State<'_, OneDriveServiceState>,
    session_id: String,
) -> OneDriveResult<Vec<Subscription>> {
    let mut svc = state.write().await;
    let (client, _) = svc.client_for(&session_id).await?;
    let wh = svc.webhooks(&client);
    wh.list_subscriptions().await
}

/// Delete a subscription.
#[tauri::command]
pub async fn od_delete_subscription(
    state: tauri::State<'_, OneDriveServiceState>,
    session_id: String,
    subscription_id: String,
) -> OneDriveResult<()> {
    let mut svc = state.write().await;
    let (client, _) = svc.client_for(&session_id).await?;
    let wh = svc.webhooks(&client);
    wh.delete_subscription(&subscription_id).await
}
