// ──────────────────────────────────────────────────────────────────────────────
// sorng-nextcloud · commands
// ──────────────────────────────────────────────────────────────────────────────
// Tauri `#[tauri::command]` wrappers for the Nextcloud integration.
//
// Each command acquires the `NextcloudServiceState` mutex, delegates to the
// appropriate module, and returns a JSON-serialisable result.
// ──────────────────────────────────────────────────────────────────────────────

use crate::activity;
use crate::auth;
use crate::client::NextcloudClient;
use crate::files;
use crate::folders;
use crate::service::NextcloudServiceState;
use crate::sharing;
use crate::types::*;
use crate::users;
use tauri::State;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Helper — build a NextcloudClient from locked service state
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

fn get_client(state: &State<'_, NextcloudServiceState>) -> Result<NextcloudClient, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    let server = svc
        .server_url
        .as_deref()
        .ok_or("Nextcloud server URL not configured")?;

    match svc.auth_method {
        AuthMethod::AppPassword => {
            let user = svc
                .username
                .as_deref()
                .ok_or("Username not configured")?;
            let pass = svc
                .app_password
                .as_deref()
                .ok_or("App password not configured")?;
            Ok(NextcloudClient::with_credentials(server, user, pass))
        }
        AuthMethod::OAuth2 => {
            let token = svc
                .bearer_token
                .as_deref()
                .ok_or("Bearer token not set")?;
            Ok(NextcloudClient::with_bearer(server, token))
        }
        AuthMethod::None => Err("Not connected to Nextcloud".to_string()),
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Configuration & Connection
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub fn nextcloud_configure(
    state: State<'_, NextcloudServiceState>,
    server_url: String,
    username: String,
    app_password: String,
) -> Result<String, String> {
    let mut svc = state.lock().map_err(|e| e.to_string())?;
    svc.configure(&server_url, &username, &app_password);
    Ok("configured".into())
}

#[tauri::command]
pub fn nextcloud_set_bearer_token(
    state: State<'_, NextcloudServiceState>,
    token: String,
    refresh_token: Option<String>,
    expires_in: Option<i64>,
) -> Result<String, String> {
    let mut svc = state.lock().map_err(|e| e.to_string())?;
    svc.set_bearer_token(&token, refresh_token.as_deref(), expires_in);
    Ok("token_set".into())
}

#[tauri::command]
pub fn nextcloud_configure_oauth2(
    state: State<'_, NextcloudServiceState>,
    client_id: String,
    client_secret: Option<String>,
    redirect_uri: Option<String>,
) -> Result<String, String> {
    let mut svc = state.lock().map_err(|e| e.to_string())?;
    svc.configure_oauth2(&client_id, client_secret.as_deref(), redirect_uri.as_deref());
    Ok("oauth2_configured".into())
}

#[tauri::command]
pub fn nextcloud_disconnect(state: State<'_, NextcloudServiceState>) -> Result<String, String> {
    let mut svc = state.lock().map_err(|e| e.to_string())?;
    svc.disconnect();
    Ok("disconnected".into())
}

#[tauri::command]
pub fn nextcloud_is_connected(state: State<'_, NextcloudServiceState>) -> Result<bool, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    Ok(svc.is_connected())
}

#[tauri::command]
pub fn nextcloud_masked_credential(
    state: State<'_, NextcloudServiceState>,
) -> Result<String, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    Ok(svc.masked_credential())
}

#[tauri::command]
pub fn nextcloud_get_server_url(
    state: State<'_, NextcloudServiceState>,
) -> Result<Option<String>, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    Ok(svc.server_url().map(|s| s.to_string()))
}

#[tauri::command]
pub fn nextcloud_get_username(
    state: State<'_, NextcloudServiceState>,
) -> Result<Option<String>, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    Ok(svc.username().map(|s| s.to_string()))
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Login Flow v2
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn nextcloud_start_login_flow(
    state: State<'_, NextcloudServiceState>,
    server_url: String,
) -> Result<serde_json::Value, String> {
    let flow = auth::start_login_flow_v2(&server_url).await?;
    let login_url = flow.login_url.clone();
    {
        let mut svc = state.lock().map_err(|e| e.to_string())?;
        svc.server_url = Some(server_url.trim_end_matches('/').to_string());
        svc.set_login_flow(flow.clone());
    }
    serde_json::to_value(&flow).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn nextcloud_poll_login_flow(
    state: State<'_, NextcloudServiceState>,
) -> Result<serde_json::Value, String> {
    let flow = {
        let svc = state.lock().map_err(|e| e.to_string())?;
        svc.login_flow
            .clone()
            .ok_or("No pending Login Flow v2")?
    };

    let creds = auth::poll_login_flow_v2(&flow).await?;

    match creds {
        Some(c) => {
            {
                let mut svc = state.lock().map_err(|e| e.to_string())?;
                svc.complete_login_flow(&c);
            }
            serde_json::to_value(&c).map_err(|e| e.to_string())
        }
        None => Ok(serde_json::json!({"status": "pending"})),
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  OAuth 2.0
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub fn nextcloud_start_oauth2(
    state: State<'_, NextcloudServiceState>,
    scopes: Option<String>,
) -> Result<String, String> {
    let mut svc = state.lock().map_err(|e| e.to_string())?;
    svc.start_oauth2(scopes.as_deref())
}

#[tauri::command]
pub async fn nextcloud_exchange_oauth2_code(
    state: State<'_, NextcloudServiceState>,
    code: String,
) -> Result<String, String> {
    let (server, client_id, client_secret, redirect_uri, verifier) = {
        let svc = state.lock().map_err(|e| e.to_string())?;
        (
            svc.server_url.clone().ok_or("Server URL not configured")?,
            svc.oauth2_client_id.clone().ok_or("OAuth2 client_id not configured")?,
            svc.oauth2_client_secret.clone().unwrap_or_default(),
            svc.oauth2_redirect_uri.clone(),
            svc.pending_code_verifier.clone().unwrap_or_default(),
        )
    };

    let resp = auth::exchange_oauth2_code(
        &server,
        &client_id,
        &client_secret,
        &code,
        &redirect_uri,
        &verifier,
    )
    .await?;

    let mut svc = state.lock().map_err(|e| e.to_string())?;
    svc.bearer_token = Some(resp.access_token.clone());
    svc.oauth2_refresh_token = resp.refresh_token.clone();
    if let Some(exp) = resp.expires_in {
        svc.oauth2_token_expires_at =
            Some(chrono::Utc::now() + chrono::Duration::seconds(exp as i64));
    }
    svc.pending_code_verifier = None;
    svc.auth_method = AuthMethod::OAuth2;
    svc.connected = true;
    svc.log("oauth2", "OAuth2 code exchanged", true);
    Ok("authenticated".into())
}

#[tauri::command]
pub async fn nextcloud_refresh_oauth2_token(
    state: State<'_, NextcloudServiceState>,
) -> Result<String, String> {
    let (server, client_id, client_secret, refresh) = {
        let svc = state.lock().map_err(|e| e.to_string())?;
        (
            svc.server_url.clone().ok_or("Server URL not configured")?,
            svc.oauth2_client_id.clone().ok_or("OAuth2 client_id not configured")?,
            svc.oauth2_client_secret.clone().unwrap_or_default(),
            svc.oauth2_refresh_token
                .clone()
                .ok_or("No refresh token available")?,
        )
    };

    let resp = auth::refresh_oauth2_token(
        &server,
        &client_id,
        &client_secret,
        &refresh,
    )
    .await?;

    let mut svc = state.lock().map_err(|e| e.to_string())?;
    svc.bearer_token = Some(resp.access_token.clone());
    if let Some(new_refresh) = &resp.refresh_token {
        svc.oauth2_refresh_token = Some(new_refresh.clone());
    }
    if let Some(exp) = resp.expires_in {
        svc.oauth2_token_expires_at =
            Some(chrono::Utc::now() + chrono::Duration::seconds(exp as i64));
    }
    svc.log("oauth2", "Token refreshed", true);
    Ok("refreshed".into())
}

#[tauri::command]
pub async fn nextcloud_validate_credentials(
    state: State<'_, NextcloudServiceState>,
) -> Result<String, String> {
    let client = get_client(&state)?;
    auth::validate_credentials(&client).await
}

#[tauri::command]
pub async fn nextcloud_revoke_app_password(
    state: State<'_, NextcloudServiceState>,
) -> Result<String, String> {
    let client = get_client(&state)?;
    auth::revoke_app_password(&client).await?;
    let mut svc = state.lock().map_err(|e| e.to_string())?;
    svc.disconnect();
    Ok("revoked".into())
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  File Operations
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn nextcloud_upload(
    state: State<'_, NextcloudServiceState>,
    remote_path: String,
    data: Vec<u8>,
    content_type: Option<String>,
) -> Result<String, String> {
    let client = get_client(&state)?;
    let args = files::build_upload_args(&remote_path, true);
    files::upload(&client, &args, data.clone()).await?;
    {
        let mut svc = state.lock().map_err(|e| e.to_string())?;
        svc.record_upload(data.len() as u64);
        svc.log("upload", &format!("Uploaded {remote_path}"), true);
    }
    Ok("uploaded".into())
}

#[tauri::command]
pub async fn nextcloud_download(
    state: State<'_, NextcloudServiceState>,
    remote_path: String,
) -> Result<Vec<u8>, String> {
    let client = get_client(&state)?;
    let bytes = files::download(&client, &remote_path).await?;
    {
        let mut svc = state.lock().map_err(|e| e.to_string())?;
        svc.record_download(bytes.len() as u64);
        svc.log("download", &format!("Downloaded {remote_path}"), true);
    }
    Ok(bytes)
}

#[tauri::command]
pub async fn nextcloud_get_metadata(
    state: State<'_, NextcloudServiceState>,
    remote_path: String,
) -> Result<serde_json::Value, String> {
    let client = get_client(&state)?;
    let resource = files::get_metadata(&client, &remote_path).await?;
    {
        let mut svc = state.lock().map_err(|e| e.to_string())?;
        svc.record_api_call();
    }
    serde_json::to_value(&resource).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn nextcloud_move_file(
    state: State<'_, NextcloudServiceState>,
    from_path: String,
    to_path: String,
    overwrite: Option<bool>,
) -> Result<String, String> {
    let client = get_client(&state)?;
    let args = files::build_move_args(&from_path, &to_path, overwrite.unwrap_or(false));
    files::move_file(&client, &args).await?;
    {
        let mut svc = state.lock().map_err(|e| e.to_string())?;
        svc.record_api_call();
        svc.log("move", &format!("Moved {from_path} → {to_path}"), true);
    }
    Ok("moved".into())
}

#[tauri::command]
pub async fn nextcloud_copy_file(
    state: State<'_, NextcloudServiceState>,
    from_path: String,
    to_path: String,
    overwrite: Option<bool>,
) -> Result<String, String> {
    let client = get_client(&state)?;
    let args = files::build_move_args(&from_path, &to_path, overwrite.unwrap_or(false));
    files::copy_file(&client, &args).await?;
    {
        let mut svc = state.lock().map_err(|e| e.to_string())?;
        svc.record_api_call();
        svc.log("copy", &format!("Copied {from_path} → {to_path}"), true);
    }
    Ok("copied".into())
}

#[tauri::command]
pub async fn nextcloud_delete_file(
    state: State<'_, NextcloudServiceState>,
    remote_path: String,
) -> Result<String, String> {
    let client = get_client(&state)?;
    files::delete_file(&client, &remote_path).await?;
    {
        let mut svc = state.lock().map_err(|e| e.to_string())?;
        svc.record_api_call();
        svc.log("delete", &format!("Deleted {remote_path}"), true);
    }
    Ok("deleted".into())
}

#[tauri::command]
pub async fn nextcloud_set_favorite(
    state: State<'_, NextcloudServiceState>,
    remote_path: String,
    favorite: bool,
) -> Result<String, String> {
    let client = get_client(&state)?;
    files::set_favorite(&client, &remote_path, favorite).await?;
    Ok(if favorite { "favorited" } else { "unfavorited" }.into())
}

#[tauri::command]
pub async fn nextcloud_set_tags(
    state: State<'_, NextcloudServiceState>,
    remote_path: String,
    tags: Vec<String>,
) -> Result<String, String> {
    let client = get_client(&state)?;
    let tag_refs: Vec<&str> = tags.iter().map(|s| s.as_str()).collect();
    files::set_tags(&client, &remote_path, &tag_refs).await?;
    Ok("tags_set".into())
}

#[tauri::command]
pub async fn nextcloud_list_versions(
    state: State<'_, NextcloudServiceState>,
    file_id: String,
) -> Result<serde_json::Value, String> {
    let client = get_client(&state)?;
    let versions = files::list_versions(&client, &file_id).await?;
    serde_json::to_value(&versions).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn nextcloud_restore_version(
    state: State<'_, NextcloudServiceState>,
    file_id: String,
    version_id: String,
) -> Result<String, String> {
    let client = get_client(&state)?;
    files::restore_version(&client, &file_id, &version_id).await?;
    Ok("restored".into())
}

#[tauri::command]
pub async fn nextcloud_list_trash(
    state: State<'_, NextcloudServiceState>,
) -> Result<serde_json::Value, String> {
    let client = get_client(&state)?;
    let items = files::list_trash(&client).await?;
    serde_json::to_value(&items).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn nextcloud_restore_trash_item(
    state: State<'_, NextcloudServiceState>,
    filename: String,
    original_location: String,
) -> Result<String, String> {
    let client = get_client(&state)?;
    files::restore_trash_item(&client, &filename, &original_location).await?;
    Ok("restored".into())
}

#[tauri::command]
pub async fn nextcloud_delete_trash_item(
    state: State<'_, NextcloudServiceState>,
    filename: String,
) -> Result<String, String> {
    let client = get_client(&state)?;
    files::delete_trash_item(&client, &filename).await?;
    Ok("deleted".into())
}

#[tauri::command]
pub async fn nextcloud_empty_trash(
    state: State<'_, NextcloudServiceState>,
) -> Result<String, String> {
    let client = get_client(&state)?;
    files::empty_trash(&client).await?;
    Ok("emptied".into())
}

#[tauri::command]
pub async fn nextcloud_search(
    state: State<'_, NextcloudServiceState>,
    term: String,
    path: Option<String>,
    limit: Option<u32>,
) -> Result<serde_json::Value, String> {
    let client = get_client(&state)?;
    let query = SearchQuery {
        term,
        base_path: path,
        limit,
        content_types: Vec::new(),
    };
    let result = files::unified_search(&client, &query).await?;
    serde_json::to_value(&result).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn nextcloud_content_hash(data: Vec<u8>) -> String {
    files::content_hash_sha256(&data)
}

#[tauri::command]
pub fn nextcloud_guess_mime(filename: String) -> String {
    files::guess_mime(&filename).to_string()
}

#[tauri::command]
pub async fn nextcloud_get_preview(
    state: State<'_, NextcloudServiceState>,
    path: String,
    width: Option<u32>,
    height: Option<u32>,
) -> Result<Vec<u8>, String> {
    let client = get_client(&state)?;
    let args = PreviewArgs {
        path,
        width: width.unwrap_or(256),
        height: height.unwrap_or(256),
        mode: None,
        force_icon: None,
    };
    files::get_preview(&client, &args).await
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Folder Operations
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn nextcloud_create_folder(
    state: State<'_, NextcloudServiceState>,
    remote_path: String,
) -> Result<String, String> {
    let client = get_client(&state)?;
    folders::create_folder(&client, &remote_path).await?;
    Ok("created".into())
}

#[tauri::command]
pub async fn nextcloud_create_folder_recursive(
    state: State<'_, NextcloudServiceState>,
    remote_path: String,
) -> Result<String, String> {
    let client = get_client(&state)?;
    folders::create_folder_recursive(&client, &remote_path).await?;
    Ok("created".into())
}

#[tauri::command]
pub async fn nextcloud_list_folder(
    state: State<'_, NextcloudServiceState>,
    remote_path: String,
) -> Result<serde_json::Value, String> {
    let client = get_client(&state)?;
    let result = folders::list_folder(&client, &remote_path).await?;
    {
        let mut svc = state.lock().map_err(|e| e.to_string())?;
        svc.record_listing(result.children.len() as u64);
    }
    serde_json::to_value(&result).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn nextcloud_list_files(
    state: State<'_, NextcloudServiceState>,
    remote_path: String,
) -> Result<serde_json::Value, String> {
    let client = get_client(&state)?;
    let result = folders::list_folder(&client, &remote_path).await?;
    let files_only = folders::filter_files(&result.children);
    serde_json::to_value(&files_only).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn nextcloud_list_subfolders(
    state: State<'_, NextcloudServiceState>,
    remote_path: String,
) -> Result<serde_json::Value, String> {
    let client = get_client(&state)?;
    let result = folders::list_folder(&client, &remote_path).await?;
    let folders_only = folders::filter_folders(&result.children);
    serde_json::to_value(&folders_only).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn nextcloud_list_folder_recursive(
    state: State<'_, NextcloudServiceState>,
    remote_path: String,
    max_depth: Option<u32>,
) -> Result<serde_json::Value, String> {
    let client = get_client(&state)?;
    let result = folders::list_folder_recursive(&client, &remote_path, max_depth.unwrap_or(5)).await?;
    serde_json::to_value(&result).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn nextcloud_breadcrumbs(path: String) -> Vec<(String, String)> {
    folders::breadcrumbs(&path)
}

#[tauri::command]
pub fn nextcloud_parent_path(path: String) -> String {
    folders::parent_path(&path).to_string()
}

#[tauri::command]
pub fn nextcloud_join_path(base: String, child: String) -> String {
    folders::join_path(&base, &child)
}

#[tauri::command]
pub fn nextcloud_filename(path: String) -> String {
    folders::filename(&path).to_string()
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Sharing (OCS Share API v1)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn nextcloud_create_share(
    state: State<'_, NextcloudServiceState>,
    path: String,
    share_type: i32,
    share_with: Option<String>,
    permissions: Option<u32>,
    password: Option<String>,
    expire_date: Option<String>,
) -> Result<serde_json::Value, String> {
    let client = get_client(&state)?;
    let args = CreateShareArgs {
        path,
        share_type,
        share_with,
        public_upload: None,
        password,
        expire_date,
        permissions,
        label: None,
        note: None,
        send_password_by_talk: None,
    };
    let result = sharing::create_share(&client, &args).await?;
    {
        let mut svc = state.lock().map_err(|e| e.to_string())?;
        svc.record_share();
        svc.log("share", "Share created", true);
    }
    serde_json::to_value(&result).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn nextcloud_create_public_link(
    state: State<'_, NextcloudServiceState>,
    path: String,
    password: Option<String>,
    expire_date: Option<String>,
    permissions: Option<u32>,
    label: Option<String>,
) -> Result<serde_json::Value, String> {
    let client = get_client(&state)?;
    let args = sharing::build_public_link_share(
        &path,
        password.as_deref(),
        expire_date.as_deref(),
        permissions,
        label.as_deref(),
    );
    let result = sharing::create_share(&client, &args).await?;
    {
        let mut svc = state.lock().map_err(|e| e.to_string())?;
        svc.record_share();
    }
    serde_json::to_value(&result).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn nextcloud_list_shares(
    state: State<'_, NextcloudServiceState>,
) -> Result<serde_json::Value, String> {
    let client = get_client(&state)?;
    let result = sharing::list_shares(&client).await?;
    serde_json::to_value(&result).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn nextcloud_list_shares_for_path(
    state: State<'_, NextcloudServiceState>,
    path: String,
    reshares: Option<bool>,
    subfiles: Option<bool>,
) -> Result<serde_json::Value, String> {
    let client = get_client(&state)?;
    let result = sharing::list_shares_for_path(
        &client,
        &path,
        reshares.unwrap_or(false),
        subfiles.unwrap_or(false),
    )
    .await?;
    serde_json::to_value(&result).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn nextcloud_list_shared_with_me(
    state: State<'_, NextcloudServiceState>,
) -> Result<serde_json::Value, String> {
    let client = get_client(&state)?;
    let result = sharing::list_shared_with_me(&client).await?;
    serde_json::to_value(&result).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn nextcloud_list_pending_shares(
    state: State<'_, NextcloudServiceState>,
) -> Result<serde_json::Value, String> {
    let client = get_client(&state)?;
    let result = sharing::list_pending_shares(&client).await?;
    serde_json::to_value(&result).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn nextcloud_get_share(
    state: State<'_, NextcloudServiceState>,
    share_id: String,
) -> Result<serde_json::Value, String> {
    let client = get_client(&state)?;
    let result = sharing::get_share(&client, &share_id).await?;
    serde_json::to_value(&result).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn nextcloud_update_share(
    state: State<'_, NextcloudServiceState>,
    share_id: String,
    permissions: Option<u32>,
    password: Option<String>,
    expire_date: Option<String>,
    note: Option<String>,
) -> Result<serde_json::Value, String> {
    let client = get_client(&state)?;
    let args = UpdateShareArgs {
        share_id,
        permissions,
        password,
        expire_date,
        note,
        label: None,
        public_upload: None,
        hide_download: None,
    };
    let result = sharing::update_share(&client, &args).await?;
    serde_json::to_value(&result).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn nextcloud_delete_share(
    state: State<'_, NextcloudServiceState>,
    share_id: String,
) -> Result<String, String> {
    let client = get_client(&state)?;
    sharing::delete_share(&client, &share_id).await?;
    Ok("deleted".into())
}

#[tauri::command]
pub async fn nextcloud_accept_remote_share(
    state: State<'_, NextcloudServiceState>,
    share_id: String,
) -> Result<String, String> {
    let client = get_client(&state)?;
    sharing::accept_remote_share(&client, &share_id).await?;
    Ok("accepted".into())
}

#[tauri::command]
pub async fn nextcloud_decline_remote_share(
    state: State<'_, NextcloudServiceState>,
    share_id: String,
) -> Result<String, String> {
    let client = get_client(&state)?;
    sharing::decline_remote_share(&client, &share_id).await?;
    Ok("declined".into())
}

#[tauri::command]
pub fn nextcloud_share_url(server_url: String, token: String) -> String {
    sharing::share_url(&server_url, &token)
}

#[tauri::command]
pub fn nextcloud_share_download_url(server_url: String, token: String) -> String {
    sharing::share_download_url(&server_url, &token)
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Users & Capabilities
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn nextcloud_get_current_user(
    state: State<'_, NextcloudServiceState>,
) -> Result<serde_json::Value, String> {
    let client = get_client(&state)?;
    let user = users::get_current_user(&client).await?;
    {
        let mut svc = state.lock().map_err(|e| e.to_string())?;
        svc.user_info = Some(user.clone());
        svc.record_api_call();
    }
    serde_json::to_value(&user).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn nextcloud_get_quota(
    state: State<'_, NextcloudServiceState>,
) -> Result<serde_json::Value, String> {
    let client = get_client(&state)?;
    let quota = users::get_quota(&client).await?;
    serde_json::to_value(&quota).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn nextcloud_get_user(
    state: State<'_, NextcloudServiceState>,
    user_id: String,
) -> Result<serde_json::Value, String> {
    let client = get_client(&state)?;
    let user = users::get_user(&client, &user_id).await?;
    serde_json::to_value(&user).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn nextcloud_list_users(
    state: State<'_, NextcloudServiceState>,
    search: Option<String>,
    limit: Option<u32>,
    offset: Option<u32>,
) -> Result<serde_json::Value, String> {
    let client = get_client(&state)?;
    let result = users::list_users(&client, search.as_deref(), limit, offset).await?;
    serde_json::to_value(&result).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn nextcloud_list_groups(
    state: State<'_, NextcloudServiceState>,
    search: Option<String>,
    limit: Option<u32>,
    offset: Option<u32>,
) -> Result<serde_json::Value, String> {
    let client = get_client(&state)?;
    let result = users::list_groups(&client, search.as_deref(), limit, offset).await?;
    serde_json::to_value(&result).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn nextcloud_get_capabilities(
    state: State<'_, NextcloudServiceState>,
) -> Result<serde_json::Value, String> {
    let client = get_client(&state)?;
    let cap = users::get_capabilities(&client).await?;
    serde_json::to_value(&cap).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn nextcloud_get_server_status(
    state: State<'_, NextcloudServiceState>,
) -> Result<serde_json::Value, String> {
    let server_url = {
        let svc = state.lock().map_err(|e| e.to_string())?;
        svc.server_url
            .clone()
            .ok_or("Server URL not configured")?
    };
    let status = users::get_server_status(&server_url).await?;
    serde_json::to_value(&status).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn nextcloud_list_notifications(
    state: State<'_, NextcloudServiceState>,
) -> Result<serde_json::Value, String> {
    let client = get_client(&state)?;
    let result = users::list_notifications(&client).await?;
    serde_json::to_value(&result).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn nextcloud_delete_notification(
    state: State<'_, NextcloudServiceState>,
    notification_id: String,
) -> Result<String, String> {
    let client = get_client(&state)?;
    users::delete_notification(&client, &notification_id).await?;
    Ok("deleted".into())
}

#[tauri::command]
pub async fn nextcloud_delete_all_notifications(
    state: State<'_, NextcloudServiceState>,
) -> Result<String, String> {
    let client = get_client(&state)?;
    users::delete_all_notifications(&client).await?;
    Ok("cleared".into())
}

#[tauri::command]
pub async fn nextcloud_list_external_storages(
    state: State<'_, NextcloudServiceState>,
) -> Result<serde_json::Value, String> {
    let client = get_client(&state)?;
    let result = users::list_external_storages(&client).await?;
    serde_json::to_value(&result).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn nextcloud_avatar_url(server_url: String, user_id: String, size: Option<u32>) -> String {
    users::avatar_url(&server_url, &user_id, size.unwrap_or(64))
}

#[tauri::command]
pub async fn nextcloud_get_avatar(
    state: State<'_, NextcloudServiceState>,
    user_id: String,
    size: Option<u32>,
) -> Result<Vec<u8>, String> {
    let client = get_client(&state)?;
    users::get_avatar(&client, &user_id, size.unwrap_or(64)).await
}

#[tauri::command]
pub fn nextcloud_format_bytes(bytes: u64) -> String {
    users::format_bytes(bytes)
}

#[tauri::command]
pub fn nextcloud_format_quota(quota: UserQuota) -> String {
    users::format_quota(&quota)
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Activity Feed
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn nextcloud_list_activities(
    state: State<'_, NextcloudServiceState>,
    since: Option<u64>,
    limit: Option<u32>,
    object_type: Option<String>,
    object_id: Option<String>,
    sort: Option<String>,
) -> Result<serde_json::Value, String> {
    let client = get_client(&state)?;
    let query = ActivityQuery {
        since,
        limit,
        object_type,
        object_id: object_id.and_then(|s| s.parse().ok()),
        sort,
    };
    let result = activity::list_activities(&client, &query).await?;
    serde_json::to_value(&result).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn nextcloud_activities_for_file(
    state: State<'_, NextcloudServiceState>,
    file_id: u64,
    limit: Option<u32>,
) -> Result<serde_json::Value, String> {
    let client = get_client(&state)?;
    let result = activity::activities_for_file(&client, file_id, limit).await?;
    serde_json::to_value(&result).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn nextcloud_recent_activities(
    state: State<'_, NextcloudServiceState>,
    count: Option<u32>,
) -> Result<serde_json::Value, String> {
    let client = get_client(&state)?;
    let result = activity::recent_activities(&client, count.unwrap_or(50)).await?;
    serde_json::to_value(&result).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn nextcloud_list_activity_filters(
    state: State<'_, NextcloudServiceState>,
) -> Result<serde_json::Value, String> {
    let client = get_client(&state)?;
    let result = activity::list_activity_filters(&client).await?;
    serde_json::to_value(&result).map_err(|e| e.to_string())
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Sync Manager
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub fn nextcloud_sync_add(
    state: State<'_, NextcloudServiceState>,
    local_path: String,
    remote_path: String,
    direction: String,
) -> Result<String, String> {
    let mut svc = state.lock().map_err(|e| e.to_string())?;
    let dir = match direction.as_str() {
        "upload" => SyncDirection::Upload,
        "download" => SyncDirection::Download,
        _ => SyncDirection::Bidirectional,
    };
    let config = crate::sync::build_sync_config(&local_path, &remote_path, dir);
    let id = config.id.clone();
    svc.sync_manager.add_config(config);
    Ok(id)
}

#[tauri::command]
pub fn nextcloud_sync_remove(
    state: State<'_, NextcloudServiceState>,
    id: String,
) -> Result<bool, String> {
    let mut svc = state.lock().map_err(|e| e.to_string())?;
    Ok(svc.sync_manager.remove_config(&id).is_some())
}

#[tauri::command]
pub fn nextcloud_sync_list(
    state: State<'_, NextcloudServiceState>,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    let configs: Vec<&SyncConfig> = svc.sync_manager.list_configs();
    serde_json::to_value(configs).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn nextcloud_sync_set_enabled(
    state: State<'_, NextcloudServiceState>,
    id: String,
    enabled: bool,
) -> Result<bool, String> {
    let mut svc = state.lock().map_err(|e| e.to_string())?;
    if let Some(c) = svc.sync_manager.get_config_mut(&id) {
        c.enabled = enabled;
        Ok(true)
    } else {
        Ok(false)
    }
}

#[tauri::command]
pub fn nextcloud_sync_set_interval(
    state: State<'_, NextcloudServiceState>,
    id: String,
    secs: u64,
) -> Result<bool, String> {
    let mut svc = state.lock().map_err(|e| e.to_string())?;
    if let Some(c) = svc.sync_manager.get_config_mut(&id) {
        c.interval_secs = secs;
        Ok(true)
    } else {
        Ok(false)
    }
}

#[tauri::command]
pub fn nextcloud_sync_set_exclude_patterns(
    state: State<'_, NextcloudServiceState>,
    id: String,
    patterns: Vec<String>,
) -> Result<bool, String> {
    let mut svc = state.lock().map_err(|e| e.to_string())?;
    if let Some(c) = svc.sync_manager.get_config_mut(&id) {
        c.exclude_patterns = patterns;
        Ok(true)
    } else {
        Ok(false)
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Backup Manager
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn nextcloud_backup_add(
    state: State<'_, NextcloudServiceState>,
    remote_path: String,
    include_connections: Option<bool>,
    include_credentials: Option<bool>,
    include_settings: Option<bool>,
    include_scripts: Option<bool>,
    include_templates: Option<bool>,
) -> Result<String, String> {
    let mut svc = state.lock().map_err(|e| e.to_string())?;
    let includes = BackupIncludes {
        connections: include_connections.unwrap_or(true),
        credentials: include_credentials.unwrap_or(false),
        settings: include_settings.unwrap_or(true),
        scripts: include_scripts.unwrap_or(false),
        templates: include_templates.unwrap_or(false),
    };
    let config = crate::backup::build_backup_config(&remote_path, includes);
    let id = config.id.clone();
    svc.backup_manager.add_config(config);
    Ok(id)
}

#[tauri::command]
pub fn nextcloud_backup_remove(
    state: State<'_, NextcloudServiceState>,
    id: String,
) -> Result<bool, String> {
    let mut svc = state.lock().map_err(|e| e.to_string())?;
    Ok(svc.backup_manager.remove_config(&id).is_some())
}

#[tauri::command]
pub fn nextcloud_backup_list(
    state: State<'_, NextcloudServiceState>,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    let configs: Vec<&BackupConfig> = svc.backup_manager.list_configs();
    serde_json::to_value(configs).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn nextcloud_backup_set_enabled(
    state: State<'_, NextcloudServiceState>,
    id: String,
    enabled: bool,
) -> Result<bool, String> {
    let mut svc = state.lock().map_err(|e| e.to_string())?;
    if let Some(c) = svc.backup_manager.get_config_mut(&id) {
        c.enabled = enabled;
        Ok(true)
    } else {
        Ok(false)
    }
}

#[tauri::command]
pub fn nextcloud_backup_set_max_versions(
    state: State<'_, NextcloudServiceState>,
    id: String,
    count: u32,
) -> Result<bool, String> {
    let mut svc = state.lock().map_err(|e| e.to_string())?;
    if let Some(c) = svc.backup_manager.get_config_mut(&id) {
        c.max_versions = count;
        Ok(true)
    } else {
        Ok(false)
    }
}

#[tauri::command]
pub fn nextcloud_backup_set_interval(
    state: State<'_, NextcloudServiceState>,
    id: String,
    seconds: u64,
) -> Result<bool, String> {
    let mut svc = state.lock().map_err(|e| e.to_string())?;
    if let Some(c) = svc.backup_manager.get_config_mut(&id) {
        c.interval_secs = seconds;
        Ok(true)
    } else {
        Ok(false)
    }
}

#[tauri::command]
pub fn nextcloud_backup_get_history(
    state: State<'_, NextcloudServiceState>,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    let hist = svc.backup_manager.get_history();
    serde_json::to_value(hist).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn nextcloud_backup_total_size(
    state: State<'_, NextcloudServiceState>,
) -> Result<u64, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    Ok(svc.backup_manager.total_backup_size())
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Watcher
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub fn nextcloud_watch_add(
    state: State<'_, NextcloudServiceState>,
    remote_path: String,
    poll_interval_secs: Option<u64>,
    recursive: Option<bool>,
) -> Result<String, String> {
    let mut svc = state.lock().map_err(|e| e.to_string())?;
    let mut config = crate::watcher::build_watch_config(&remote_path, poll_interval_secs.unwrap_or(60));
    config.recursive = recursive.unwrap_or(false);
    let id = config.id.clone();
    svc.watch_manager.add_config(config);
    Ok(id)
}

#[tauri::command]
pub fn nextcloud_watch_remove(
    state: State<'_, NextcloudServiceState>,
    id: String,
) -> Result<bool, String> {
    let mut svc = state.lock().map_err(|e| e.to_string())?;
    Ok(svc.watch_manager.remove_config(&id).is_some())
}

#[tauri::command]
pub fn nextcloud_watch_list(
    state: State<'_, NextcloudServiceState>,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    let watches: Vec<&WatchConfig> = svc.watch_manager.list_configs();
    serde_json::to_value(watches).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn nextcloud_watch_set_enabled(
    state: State<'_, NextcloudServiceState>,
    id: String,
    enabled: bool,
) -> Result<bool, String> {
    let mut svc = state.lock().map_err(|e| e.to_string())?;
    if let Some(c) = svc.watch_manager.get_config(&id) {
        let mut updated = c.clone();
        updated.enabled = enabled;
        svc.watch_manager.update_config(updated);
        Ok(true)
    } else {
        Ok(false)
    }
}

#[tauri::command]
pub fn nextcloud_watch_get_changes(
    state: State<'_, NextcloudServiceState>,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    let changes = svc.watch_manager.changes();
    serde_json::to_value(changes).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn nextcloud_watch_clear_changes(
    state: State<'_, NextcloudServiceState>,
) -> Result<String, String> {
    let mut svc = state.lock().map_err(|e| e.to_string())?;
    svc.watch_manager.clear_changes();
    Ok("cleared".into())
}

#[tauri::command]
pub fn nextcloud_watch_total_pending(
    state: State<'_, NextcloudServiceState>,
) -> Result<usize, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    Ok(svc.watch_manager.changes().len())
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Activity Log & Stats
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub fn nextcloud_get_activity_log(
    state: State<'_, NextcloudServiceState>,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    serde_json::to_value(svc.get_activity_log()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn nextcloud_clear_activity_log(
    state: State<'_, NextcloudServiceState>,
) -> Result<String, String> {
    let mut svc = state.lock().map_err(|e| e.to_string())?;
    svc.clear_activity_log();
    Ok("cleared".into())
}

#[tauri::command]
pub fn nextcloud_get_stats(
    state: State<'_, NextcloudServiceState>,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    serde_json::to_value(&svc.stats).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn nextcloud_reset_stats(
    state: State<'_, NextcloudServiceState>,
) -> Result<String, String> {
    let mut svc = state.lock().map_err(|e| e.to_string())?;
    svc.reset_stats();
    Ok("reset".into())
}
