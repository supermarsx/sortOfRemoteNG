//! Tauri commands for the Passbolt integration.
//!
//! Each function is a `#[tauri::command]` that can be invoked
//! from the frontend via `invoke("pb_command_name", { ... })`.

use crate::passbolt::service::PassboltServiceState;
use crate::passbolt::types::*;

// ── Configuration ───────────────────────────────────────────────────

/// Get the current Passbolt config (sensitive fields redacted).
#[tauri::command]
pub async fn pb_get_config(
    state: tauri::State<'_, PassboltServiceState>,
) -> Result<PassboltConfig, String> {
    let svc = state.lock().await;
    Ok(svc.config())
}

/// Update the Passbolt config.
#[tauri::command]
pub async fn pb_set_config(
    state: tauri::State<'_, PassboltServiceState>,
    config: PassboltConfig,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.update_config(config);
    Ok(())
}

// ── Authentication ──────────────────────────────────────────────────

/// Login via GPGAuth.
#[tauri::command]
pub async fn pb_login_gpgauth(
    state: tauri::State<'_, PassboltServiceState>,
) -> Result<SessionState, String> {
    let mut svc = state.lock().await;
    svc.login_gpgauth().await.map_err(|e| e.message)
}

/// Login via JWT.
#[tauri::command]
pub async fn pb_login_jwt(
    state: tauri::State<'_, PassboltServiceState>,
    user_id: String,
) -> Result<SessionState, String> {
    let mut svc = state.lock().await;
    svc.login_jwt(&user_id).await.map_err(|e| e.message)
}

/// Refresh the JWT access token.
#[tauri::command]
pub async fn pb_refresh_token(
    state: tauri::State<'_, PassboltServiceState>,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    svc.refresh_token().await.map_err(|e| e.message)
}

/// Logout.
#[tauri::command]
pub async fn pb_logout(state: tauri::State<'_, PassboltServiceState>) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.logout().await.map_err(|e| e.message)
}

/// Check if the session is still valid.
#[tauri::command]
pub async fn pb_check_session(
    state: tauri::State<'_, PassboltServiceState>,
) -> Result<bool, String> {
    let svc = state.lock().await;
    svc.check_session().await.map_err(|e| e.message)
}

/// Check if authenticated.
#[tauri::command]
pub async fn pb_is_authenticated(
    state: tauri::State<'_, PassboltServiceState>,
) -> Result<bool, String> {
    let svc = state.lock().await;
    Ok(svc.is_authenticated())
}

// ── MFA ─────────────────────────────────────────────────────────────

/// Verify TOTP MFA code.
#[tauri::command]
pub async fn pb_verify_mfa_totp(
    state: tauri::State<'_, PassboltServiceState>,
    code: String,
    remember: bool,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.verify_mfa_totp(&code, remember)
        .await
        .map_err(|e| e.message)
}

/// Verify Yubikey MFA OTP.
#[tauri::command]
pub async fn pb_verify_mfa_yubikey(
    state: tauri::State<'_, PassboltServiceState>,
    otp: String,
    remember: bool,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.verify_mfa_yubikey(&otp, remember)
        .await
        .map_err(|e| e.message)
}

/// Get MFA requirements.
#[tauri::command]
pub async fn pb_get_mfa_requirements(
    state: tauri::State<'_, PassboltServiceState>,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.get_mfa_requirements().await.map_err(|e| e.message)
}

// ── Resources ───────────────────────────────────────────────────────

/// List all resources.
#[tauri::command]
pub async fn pb_list_resources(
    state: tauri::State<'_, PassboltServiceState>,
    params: Option<ResourceListParams>,
) -> Result<Vec<Resource>, String> {
    let svc = state.lock().await;
    svc.list_resources(params.as_ref())
        .await
        .map_err(|e| e.message)
}

/// Get a resource by ID.
#[tauri::command]
pub async fn pb_get_resource(
    state: tauri::State<'_, PassboltServiceState>,
    resource_id: String,
) -> Result<Resource, String> {
    let svc = state.lock().await;
    svc.get_resource(&resource_id).await.map_err(|e| e.message)
}

/// Create a new resource.
#[tauri::command]
pub async fn pb_create_resource(
    state: tauri::State<'_, PassboltServiceState>,
    request: CreateResourceRequest,
) -> Result<Resource, String> {
    let mut svc = state.lock().await;
    svc.create_resource(&request).await.map_err(|e| e.message)
}

/// Update a resource.
#[tauri::command]
pub async fn pb_update_resource(
    state: tauri::State<'_, PassboltServiceState>,
    resource_id: String,
    request: UpdateResourceRequest,
) -> Result<Resource, String> {
    let mut svc = state.lock().await;
    svc.update_resource(&resource_id, &request)
        .await
        .map_err(|e| e.message)
}

/// Delete a resource.
#[tauri::command]
pub async fn pb_delete_resource(
    state: tauri::State<'_, PassboltServiceState>,
    resource_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.delete_resource(&resource_id)
        .await
        .map_err(|e| e.message)
}

/// Search resources by keyword.
#[tauri::command]
pub async fn pb_search_resources(
    state: tauri::State<'_, PassboltServiceState>,
    keyword: String,
) -> Result<Vec<Resource>, String> {
    let svc = state.lock().await;
    svc.search_resources(&keyword).await.map_err(|e| e.message)
}

/// List favorite resources.
#[tauri::command]
pub async fn pb_list_favorite_resources(
    state: tauri::State<'_, PassboltServiceState>,
) -> Result<Vec<Resource>, String> {
    let svc = state.lock().await;
    svc.list_favorite_resources().await.map_err(|e| e.message)
}

/// List resources in a folder.
#[tauri::command]
pub async fn pb_list_resources_in_folder(
    state: tauri::State<'_, PassboltServiceState>,
    folder_id: String,
) -> Result<Vec<Resource>, String> {
    let svc = state.lock().await;
    svc.list_resources_in_folder(&folder_id)
        .await
        .map_err(|e| e.message)
}

/// List resource types.
#[tauri::command]
pub async fn pb_list_resource_types(
    state: tauri::State<'_, PassboltServiceState>,
) -> Result<Vec<ResourceType>, String> {
    let svc = state.lock().await;
    svc.list_resource_types().await.map_err(|e| e.message)
}

// ── Secrets ─────────────────────────────────────────────────────────

/// Get the encrypted secret for a resource.
#[tauri::command]
pub async fn pb_get_secret(
    state: tauri::State<'_, PassboltServiceState>,
    resource_id: String,
) -> Result<Secret, String> {
    let svc = state.lock().await;
    svc.get_secret(&resource_id).await.map_err(|e| e.message)
}

/// Get and decrypt the secret for a resource.
#[tauri::command]
pub async fn pb_get_decrypted_secret(
    state: tauri::State<'_, PassboltServiceState>,
    resource_id: String,
) -> Result<DecryptedSecret, String> {
    let svc = state.lock().await;
    svc.get_decrypted_secret(&resource_id)
        .await
        .map_err(|e| e.message)
}

// ── Folders ─────────────────────────────────────────────────────────

/// List all folders.
#[tauri::command]
pub async fn pb_list_folders(
    state: tauri::State<'_, PassboltServiceState>,
    params: Option<FolderListParams>,
) -> Result<Vec<Folder>, String> {
    let svc = state.lock().await;
    svc.list_folders(params.as_ref())
        .await
        .map_err(|e| e.message)
}

/// Get a folder by ID.
#[tauri::command]
pub async fn pb_get_folder(
    state: tauri::State<'_, PassboltServiceState>,
    folder_id: String,
) -> Result<Folder, String> {
    let svc = state.lock().await;
    svc.get_folder(&folder_id).await.map_err(|e| e.message)
}

/// Create a folder.
#[tauri::command]
pub async fn pb_create_folder(
    state: tauri::State<'_, PassboltServiceState>,
    request: CreateFolderRequest,
) -> Result<Folder, String> {
    let mut svc = state.lock().await;
    svc.create_folder(&request).await.map_err(|e| e.message)
}

/// Update a folder.
#[tauri::command]
pub async fn pb_update_folder(
    state: tauri::State<'_, PassboltServiceState>,
    folder_id: String,
    request: UpdateFolderRequest,
) -> Result<Folder, String> {
    let mut svc = state.lock().await;
    svc.update_folder(&folder_id, &request)
        .await
        .map_err(|e| e.message)
}

/// Delete a folder.
#[tauri::command]
pub async fn pb_delete_folder(
    state: tauri::State<'_, PassboltServiceState>,
    folder_id: String,
    cascade: bool,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.delete_folder(&folder_id, cascade)
        .await
        .map_err(|e| e.message)
}

/// Move a folder.
#[tauri::command]
pub async fn pb_move_folder(
    state: tauri::State<'_, PassboltServiceState>,
    folder_id: String,
    new_parent_id: Option<String>,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.move_folder(&folder_id, new_parent_id.as_deref())
        .await
        .map_err(|e| e.message)
}

/// Move a resource to a folder.
#[tauri::command]
pub async fn pb_move_resource(
    state: tauri::State<'_, PassboltServiceState>,
    resource_id: String,
    folder_id: Option<String>,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.move_resource(&resource_id, folder_id.as_deref())
        .await
        .map_err(|e| e.message)
}

/// Get the folder tree.
#[tauri::command]
pub async fn pb_get_folder_tree(
    state: tauri::State<'_, PassboltServiceState>,
) -> Result<Vec<Folder>, String> {
    let svc = state.lock().await;
    svc.get_folder_tree().await.map_err(|e| e.message)
}

// ── Users ───────────────────────────────────────────────────────────

/// List users.
#[tauri::command]
pub async fn pb_list_users(
    state: tauri::State<'_, PassboltServiceState>,
    params: Option<UserListParams>,
) -> Result<Vec<User>, String> {
    let svc = state.lock().await;
    svc.list_users(params.as_ref()).await.map_err(|e| e.message)
}

/// Get a user by ID.
#[tauri::command]
pub async fn pb_get_user(
    state: tauri::State<'_, PassboltServiceState>,
    user_id: String,
) -> Result<User, String> {
    let svc = state.lock().await;
    svc.get_user(&user_id).await.map_err(|e| e.message)
}

/// Get the current user.
#[tauri::command]
pub async fn pb_get_me(state: tauri::State<'_, PassboltServiceState>) -> Result<User, String> {
    let svc = state.lock().await;
    svc.get_me().await.map_err(|e| e.message)
}

/// Create a user (admin only).
#[tauri::command]
pub async fn pb_create_user(
    state: tauri::State<'_, PassboltServiceState>,
    request: CreateUserRequest,
) -> Result<User, String> {
    let svc = state.lock().await;
    svc.create_user(&request).await.map_err(|e| e.message)
}

/// Update a user.
#[tauri::command]
pub async fn pb_update_user(
    state: tauri::State<'_, PassboltServiceState>,
    user_id: String,
    request: UpdateUserRequest,
) -> Result<User, String> {
    let svc = state.lock().await;
    svc.update_user(&user_id, &request)
        .await
        .map_err(|e| e.message)
}

/// Delete a user.
#[tauri::command]
pub async fn pb_delete_user(
    state: tauri::State<'_, PassboltServiceState>,
    user_id: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.delete_user(&user_id).await.map_err(|e| e.message)
}

/// Dry-run user deletion.
#[tauri::command]
pub async fn pb_delete_user_dry_run(
    state: tauri::State<'_, PassboltServiceState>,
    user_id: String,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.delete_user_dry_run(&user_id)
        .await
        .map_err(|e| e.message)
}

/// Search users.
#[tauri::command]
pub async fn pb_search_users(
    state: tauri::State<'_, PassboltServiceState>,
    keyword: String,
) -> Result<Vec<User>, String> {
    let svc = state.lock().await;
    svc.search_users(&keyword).await.map_err(|e| e.message)
}

// ── Groups ──────────────────────────────────────────────────────────

/// List groups.
#[tauri::command]
pub async fn pb_list_groups(
    state: tauri::State<'_, PassboltServiceState>,
    params: Option<GroupListParams>,
) -> Result<Vec<Group>, String> {
    let svc = state.lock().await;
    svc.list_groups(params.as_ref())
        .await
        .map_err(|e| e.message)
}

/// Get a group by ID.
#[tauri::command]
pub async fn pb_get_group(
    state: tauri::State<'_, PassboltServiceState>,
    group_id: String,
) -> Result<Group, String> {
    let svc = state.lock().await;
    svc.get_group(&group_id).await.map_err(|e| e.message)
}

/// Create a group.
#[tauri::command]
pub async fn pb_create_group(
    state: tauri::State<'_, PassboltServiceState>,
    request: CreateGroupRequest,
) -> Result<Group, String> {
    let svc = state.lock().await;
    svc.create_group(&request).await.map_err(|e| e.message)
}

/// Update a group.
#[tauri::command]
pub async fn pb_update_group(
    state: tauri::State<'_, PassboltServiceState>,
    group_id: String,
    request: UpdateGroupRequest,
) -> Result<Group, String> {
    let svc = state.lock().await;
    svc.update_group(&group_id, &request)
        .await
        .map_err(|e| e.message)
}

/// Delete a group.
#[tauri::command]
pub async fn pb_delete_group(
    state: tauri::State<'_, PassboltServiceState>,
    group_id: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.delete_group(&group_id).await.map_err(|e| e.message)
}

/// Dry-run group update.
#[tauri::command]
pub async fn pb_update_group_dry_run(
    state: tauri::State<'_, PassboltServiceState>,
    group_id: String,
    request: UpdateGroupRequest,
) -> Result<GroupDryRunResult, String> {
    let svc = state.lock().await;
    svc.update_group_dry_run(&group_id, &request)
        .await
        .map_err(|e| e.message)
}

// ── Sharing & Permissions ───────────────────────────────────────────

/// List permissions for a resource.
#[tauri::command]
pub async fn pb_list_resource_permissions(
    state: tauri::State<'_, PassboltServiceState>,
    resource_id: String,
) -> Result<Vec<Permission>, String> {
    let svc = state.lock().await;
    svc.list_resource_permissions(&resource_id)
        .await
        .map_err(|e| e.message)
}

/// Share a resource.
#[tauri::command]
pub async fn pb_share_resource(
    state: tauri::State<'_, PassboltServiceState>,
    resource_id: String,
    request: ShareRequest,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.share_resource(&resource_id, &request)
        .await
        .map_err(|e| e.message)
}

/// Share a folder.
#[tauri::command]
pub async fn pb_share_folder(
    state: tauri::State<'_, PassboltServiceState>,
    folder_id: String,
    request: ShareRequest,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.share_folder(&folder_id, &request)
        .await
        .map_err(|e| e.message)
}

/// Simulate sharing a resource.
#[tauri::command]
pub async fn pb_simulate_share_resource(
    state: tauri::State<'_, PassboltServiceState>,
    resource_id: String,
    request: ShareRequest,
) -> Result<ShareSimulateResult, String> {
    let svc = state.lock().await;
    svc.simulate_share_resource(&resource_id, &request)
        .await
        .map_err(|e| e.message)
}

/// Search AROs (users/groups).
#[tauri::command]
pub async fn pb_search_aros(
    state: tauri::State<'_, PassboltServiceState>,
    keyword: String,
) -> Result<Vec<Aro>, String> {
    let svc = state.lock().await;
    svc.search_aros(&keyword).await.map_err(|e| e.message)
}

/// Add a resource to favorites.
#[tauri::command]
pub async fn pb_add_favorite(
    state: tauri::State<'_, PassboltServiceState>,
    resource_id: String,
) -> Result<Favorite, String> {
    let svc = state.lock().await;
    svc.add_favorite(&resource_id).await.map_err(|e| e.message)
}

/// Remove a favorite.
#[tauri::command]
pub async fn pb_remove_favorite(
    state: tauri::State<'_, PassboltServiceState>,
    favorite_id: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.remove_favorite(&favorite_id)
        .await
        .map_err(|e| e.message)
}

// ── Comments ────────────────────────────────────────────────────────

/// List comments on a resource.
#[tauri::command]
pub async fn pb_list_comments(
    state: tauri::State<'_, PassboltServiceState>,
    resource_id: String,
) -> Result<Vec<Comment>, String> {
    let svc = state.lock().await;
    svc.list_comments(&resource_id).await.map_err(|e| e.message)
}

/// Add a comment to a resource.
#[tauri::command]
pub async fn pb_add_comment(
    state: tauri::State<'_, PassboltServiceState>,
    resource_id: String,
    content: String,
    parent_id: Option<String>,
) -> Result<Comment, String> {
    let svc = state.lock().await;
    svc.add_comment(&resource_id, &content, parent_id.as_deref())
        .await
        .map_err(|e| e.message)
}

/// Update a comment.
#[tauri::command]
pub async fn pb_update_comment(
    state: tauri::State<'_, PassboltServiceState>,
    comment_id: String,
    content: String,
) -> Result<Comment, String> {
    let svc = state.lock().await;
    svc.update_comment(&comment_id, &content)
        .await
        .map_err(|e| e.message)
}

/// Delete a comment.
#[tauri::command]
pub async fn pb_delete_comment(
    state: tauri::State<'_, PassboltServiceState>,
    comment_id: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.delete_comment(&comment_id).await.map_err(|e| e.message)
}

// ── Tags ────────────────────────────────────────────────────────────

/// List all tags.
#[tauri::command]
pub async fn pb_list_tags(
    state: tauri::State<'_, PassboltServiceState>,
) -> Result<Vec<Tag>, String> {
    let svc = state.lock().await;
    svc.list_tags().await.map_err(|e| e.message)
}

/// Update a tag.
#[tauri::command]
pub async fn pb_update_tag(
    state: tauri::State<'_, PassboltServiceState>,
    tag_id: String,
    request: UpdateTagRequest,
) -> Result<Tag, String> {
    let svc = state.lock().await;
    svc.update_tag(&tag_id, &request)
        .await
        .map_err(|e| e.message)
}

/// Delete a tag.
#[tauri::command]
pub async fn pb_delete_tag(
    state: tauri::State<'_, PassboltServiceState>,
    tag_id: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.delete_tag(&tag_id).await.map_err(|e| e.message)
}

/// Add tags to a resource.
#[tauri::command]
pub async fn pb_add_tags_to_resource(
    state: tauri::State<'_, PassboltServiceState>,
    resource_id: String,
    tags: Vec<TagEntry>,
) -> Result<Vec<Tag>, String> {
    let svc = state.lock().await;
    svc.add_tags_to_resource(&resource_id, &tags)
        .await
        .map_err(|e| e.message)
}

// ── GPG Keys ────────────────────────────────────────────────────────

/// List all GPG keys.
#[tauri::command]
pub async fn pb_list_gpg_keys(
    state: tauri::State<'_, PassboltServiceState>,
) -> Result<Vec<GpgKey>, String> {
    let svc = state.lock().await;
    svc.list_gpg_keys().await.map_err(|e| e.message)
}

/// Get a GPG key by ID.
#[tauri::command]
pub async fn pb_get_gpg_key(
    state: tauri::State<'_, PassboltServiceState>,
    key_id: String,
) -> Result<GpgKey, String> {
    let svc = state.lock().await;
    svc.get_gpg_key(&key_id).await.map_err(|e| e.message)
}

/// Load a recipient's GPG key for sharing.
#[tauri::command]
pub async fn pb_load_recipient_key(
    state: tauri::State<'_, PassboltServiceState>,
    user_id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.load_recipient_key(&user_id)
        .await
        .map_err(|e| e.message)
}

// ── Roles ───────────────────────────────────────────────────────────

/// List all roles.
#[tauri::command]
pub async fn pb_list_roles(
    state: tauri::State<'_, PassboltServiceState>,
) -> Result<Vec<Role>, String> {
    let svc = state.lock().await;
    svc.list_roles().await.map_err(|e| e.message)
}

// ── Metadata ────────────────────────────────────────────────────────

/// List metadata keys.
#[tauri::command]
pub async fn pb_list_metadata_keys(
    state: tauri::State<'_, PassboltServiceState>,
) -> Result<Vec<MetadataKey>, String> {
    let svc = state.lock().await;
    svc.list_metadata_keys().await.map_err(|e| e.message)
}

/// Create a metadata key.
#[tauri::command]
pub async fn pb_create_metadata_key(
    state: tauri::State<'_, PassboltServiceState>,
    request: CreateMetadataKeyRequest,
) -> Result<MetadataKey, String> {
    let svc = state.lock().await;
    svc.create_metadata_key(&request)
        .await
        .map_err(|e| e.message)
}

/// Get metadata types settings.
#[tauri::command]
pub async fn pb_get_metadata_types_settings(
    state: tauri::State<'_, PassboltServiceState>,
) -> Result<MetadataTypesSettings, String> {
    let svc = state.lock().await;
    svc.get_metadata_types_settings()
        .await
        .map_err(|e| e.message)
}

/// List metadata session keys.
#[tauri::command]
pub async fn pb_list_metadata_session_keys(
    state: tauri::State<'_, PassboltServiceState>,
) -> Result<Vec<MetadataSessionKey>, String> {
    let svc = state.lock().await;
    svc.list_metadata_session_keys()
        .await
        .map_err(|e| e.message)
}

/// List resources needing metadata key rotation.
#[tauri::command]
pub async fn pb_list_resources_needing_rotation(
    state: tauri::State<'_, PassboltServiceState>,
) -> Result<Vec<MetadataRotateEntry>, String> {
    let svc = state.lock().await;
    svc.list_resources_needing_rotation()
        .await
        .map_err(|e| e.message)
}

/// Rotate metadata keys for resources.
#[tauri::command]
pub async fn pb_rotate_resource_metadata(
    state: tauri::State<'_, PassboltServiceState>,
    entries: Vec<MetadataRotateEntry>,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.rotate_resource_metadata(&entries)
        .await
        .map_err(|e| e.message)
}

/// List resources needing metadata upgrade.
#[tauri::command]
pub async fn pb_list_resources_needing_upgrade(
    state: tauri::State<'_, PassboltServiceState>,
) -> Result<Vec<MetadataUpgradeEntry>, String> {
    let svc = state.lock().await;
    svc.list_resources_needing_upgrade()
        .await
        .map_err(|e| e.message)
}

/// Upgrade resource metadata.
#[tauri::command]
pub async fn pb_upgrade_resource_metadata(
    state: tauri::State<'_, PassboltServiceState>,
    entries: Vec<MetadataUpgradeEntry>,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.upgrade_resource_metadata(&entries)
        .await
        .map_err(|e| e.message)
}

// ── Health & Settings ───────────────────────────────────────────────

/// Run full health check.
#[tauri::command]
pub async fn pb_healthcheck(
    state: tauri::State<'_, PassboltServiceState>,
) -> Result<HealthcheckInfo, String> {
    let svc = state.lock().await;
    svc.healthcheck().await.map_err(|e| e.message)
}

/// Quick server status.
#[tauri::command]
pub async fn pb_server_status(
    state: tauri::State<'_, PassboltServiceState>,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.server_status().await.map_err(|e| e.message)
}

/// Check server reachability.
#[tauri::command]
pub async fn pb_is_server_reachable(
    state: tauri::State<'_, PassboltServiceState>,
) -> Result<bool, String> {
    let svc = state.lock().await;
    svc.is_server_reachable().await.map_err(|e| e.message)
}

/// Get server settings.
#[tauri::command]
pub async fn pb_server_settings(
    state: tauri::State<'_, PassboltServiceState>,
) -> Result<ServerSettings, String> {
    let svc = state.lock().await;
    svc.server_settings().await.map_err(|e| e.message)
}

// ── Directory Sync ──────────────────────────────────────────────────

/// Dry-run directory sync.
#[tauri::command]
pub async fn pb_directory_sync_dry_run(
    state: tauri::State<'_, PassboltServiceState>,
) -> Result<DirectorySyncResult, String> {
    let svc = state.lock().await;
    svc.directory_sync_dry_run().await.map_err(|e| e.message)
}

/// Execute directory sync.
#[tauri::command]
pub async fn pb_directory_sync(
    state: tauri::State<'_, PassboltServiceState>,
) -> Result<DirectorySyncResult, String> {
    let svc = state.lock().await;
    svc.directory_sync().await.map_err(|e| e.message)
}

// ── Cache ───────────────────────────────────────────────────────────

/// Refresh the resource/folder cache.
#[tauri::command]
pub async fn pb_refresh_cache(state: tauri::State<'_, PassboltServiceState>) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.refresh_cache().await.map_err(|e| e.message)
}

/// Invalidate the cache.
#[tauri::command]
pub async fn pb_invalidate_cache(
    state: tauri::State<'_, PassboltServiceState>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.invalidate_cache();
    Ok(())
}

/// Get cached resources.
#[tauri::command]
pub async fn pb_get_cached_resources(
    state: tauri::State<'_, PassboltServiceState>,
) -> Result<Vec<Resource>, String> {
    let mut svc = state.lock().await;
    svc.get_cached_resources().await.map_err(|e| e.message)
}

/// Get cached folders.
#[tauri::command]
pub async fn pb_get_cached_folders(
    state: tauri::State<'_, PassboltServiceState>,
) -> Result<Vec<Folder>, String> {
    let mut svc = state.lock().await;
    svc.get_cached_folders().await.map_err(|e| e.message)
}
