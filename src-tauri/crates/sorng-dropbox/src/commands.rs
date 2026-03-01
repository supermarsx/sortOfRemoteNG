//! Tauri `#[tauri::command]` wrappers for the Dropbox integration.
//!
//! Each command acquires the `DropboxServiceState` mutex, delegates to the
//! appropriate module, and returns a JSON-serialisable result.

use crate::account;
use crate::auth;
use crate::client::DropboxClient;
use crate::files;
use crate::folders;
use crate::paper;
use crate::service::DropboxServiceState;
use crate::sharing;
use crate::team;
use crate::types::*;
use tauri::State;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Configuration & Connection
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub fn dropbox_configure(
    state: State<'_, DropboxServiceState>,
    app_key: String,
    app_secret: Option<String>,
    redirect_uri: Option<String>,
) -> Result<String, String> {
    let mut svc = state.lock().map_err(|e| e.to_string())?;
    svc.configure(&app_key, app_secret.as_deref(), redirect_uri.as_deref());
    Ok("configured".into())
}

#[tauri::command]
pub fn dropbox_set_token(
    state: State<'_, DropboxServiceState>,
    token: String,
    refresh_token: Option<String>,
    expires_in: Option<i64>,
) -> Result<String, String> {
    let mut svc = state.lock().map_err(|e| e.to_string())?;
    svc.set_token(&token, refresh_token.as_deref(), expires_in);
    Ok("token_set".into())
}

#[tauri::command]
pub fn dropbox_disconnect(state: State<'_, DropboxServiceState>) -> Result<String, String> {
    let mut svc = state.lock().map_err(|e| e.to_string())?;
    svc.disconnect();
    Ok("disconnected".into())
}

#[tauri::command]
pub fn dropbox_is_connected(state: State<'_, DropboxServiceState>) -> Result<bool, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    Ok(svc.is_connected())
}

#[tauri::command]
pub fn dropbox_masked_token(state: State<'_, DropboxServiceState>) -> Result<String, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    Ok(svc.masked_token())
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  OAuth 2.0 PKCE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub fn dropbox_start_auth(
    state: State<'_, DropboxServiceState>,
    scopes: Option<Vec<String>>,
) -> Result<String, String> {
    let mut svc = state.lock().map_err(|e| e.to_string())?;
    svc.start_auth(scopes)
}

#[tauri::command]
pub async fn dropbox_finish_auth(
    state: State<'_, DropboxServiceState>,
    code: String,
) -> Result<String, String> {
    // Clone what we need outside the mutex
    let (app_key, app_secret, pkce) = {
        let svc = state.lock().map_err(|e| e.to_string())?;
        (
            svc.app_key.clone().ok_or("App key not configured")?,
            svc.app_secret.clone(),
            svc.pending_pkce.clone().ok_or("No pending PKCE state")?,
        )
    };

    let token_resp =
        auth::exchange_code(&app_key, app_secret.as_deref(), &code, &pkce).await?;

    let mut svc = state.lock().map_err(|e| e.to_string())?;
    svc.access_token = Some(token_resp.access_token);
    svc.refresh_token = token_resp.refresh_token;
    if let Some(exp) = token_resp.expires_in {
        svc.token_expires_at = Some(auth::expires_at_from_now(exp));
    }
    svc.pending_pkce = None;
    svc.connected = true;
    svc.log(ActivityType::AccountAction, "OAuth flow completed via command", true, None);
    Ok("authenticated".into())
}

#[tauri::command]
pub async fn dropbox_refresh_token(
    state: State<'_, DropboxServiceState>,
) -> Result<String, String> {
    let (app_key, app_secret, refresh) = {
        let svc = state.lock().map_err(|e| e.to_string())?;
        (
            svc.app_key.clone().ok_or("App key not configured")?,
            svc.app_secret.clone(),
            svc.refresh_token
                .clone()
                .ok_or("No refresh token available")?,
        )
    };

    let resp = auth::refresh_token(&app_key, app_secret.as_deref(), &refresh).await?;

    let mut svc = state.lock().map_err(|e| e.to_string())?;
    svc.access_token = Some(resp.access_token);
    if let Some(exp) = resp.expires_in {
        svc.token_expires_at = Some(auth::expires_at_from_now(exp));
    }
    svc.log(ActivityType::AccountAction, "Token refreshed via command", true, None);
    Ok("refreshed".into())
}

#[tauri::command]
pub async fn dropbox_revoke_token(
    state: State<'_, DropboxServiceState>,
) -> Result<String, String> {
    let token = {
        let svc = state.lock().map_err(|e| e.to_string())?;
        svc.access_token.clone().ok_or("No access token")?
    };
    auth::revoke_token(&token).await?;
    let mut svc = state.lock().map_err(|e| e.to_string())?;
    svc.disconnect();
    Ok("revoked".into())
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Helper to get a DropboxClient from locked service state
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

fn get_token(state: &State<'_, DropboxServiceState>) -> Result<String, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    svc.access_token
        .clone()
        .ok_or_else(|| "Not connected to Dropbox".to_string())
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  File Operations
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn dropbox_upload(
    state: State<'_, DropboxServiceState>,
    path: String,
    data: Vec<u8>,
    mode: Option<String>,
    autorename: Option<bool>,
) -> Result<serde_json::Value, String> {
    let token = get_token(&state)?;
    let write_mode = match mode.as_deref() {
        Some("overwrite") => WriteMode::Overwrite,
        Some(rev) if rev.starts_with("update:") => WriteMode::Update(rev[7..].to_string()),
        _ => WriteMode::Add,
    };
    let arg = files::build_upload_arg(&path, &write_mode, autorename.unwrap_or(false));
    let client = DropboxClient::new(&token)?;
    let result: serde_json::Value = client.content_upload("files/upload", &arg, &data).await?;
    {
        let mut svc = state.lock().map_err(|e| e.to_string())?;
        svc.record_upload(result.to_string().len() as u64);
        svc.record_api_call();
        svc.log(ActivityType::Upload, &format!("Uploaded {path}"), true, None);
    }
    Ok(result)
}

#[tauri::command]
pub async fn dropbox_download(
    state: State<'_, DropboxServiceState>,
    path: String,
) -> Result<Vec<u8>, String> {
    let token = get_token(&state)?;
    let arg = files::build_download_arg(&path);
    let client = DropboxClient::new(&token)?;
    let (bytes, _header) = client.content_download("files/download", &arg).await?;
    {
        let mut svc = state.lock().map_err(|e| e.to_string())?;
        svc.record_download(bytes.len() as u64);
        svc.record_api_call();
        svc.log(ActivityType::Download, &format!("Downloaded {path}"), true, None);
    }
    Ok(bytes)
}

#[tauri::command]
pub async fn dropbox_get_metadata(
    state: State<'_, DropboxServiceState>,
    path: String,
    include_media_info: Option<bool>,
) -> Result<serde_json::Value, String> {
    let token = get_token(&state)?;
    let body = files::build_get_metadata(&path, include_media_info.unwrap_or(false));
    let client = DropboxClient::new(&token)?;
    let result = client.rpc("files/get_metadata", &body).await?;
    {
        let mut svc = state.lock().map_err(|e| e.to_string())?;
        svc.record_api_call();
    }
    Ok(result)
}

#[tauri::command]
pub async fn dropbox_move_file(
    state: State<'_, DropboxServiceState>,
    from_path: String,
    to_path: String,
    autorename: Option<bool>,
) -> Result<serde_json::Value, String> {
    let token = get_token(&state)?;
    let body = files::build_move(&from_path, &to_path, autorename.unwrap_or(false));
    let client = DropboxClient::new(&token)?;
    let result = client.rpc("files/move_v2", &body).await?;
    {
        let mut svc = state.lock().map_err(|e| e.to_string())?;
        svc.record_api_call();
        svc.log(ActivityType::Move, &format!("Moved {from_path} → {to_path}"), true, None);
    }
    Ok(result)
}

#[tauri::command]
pub async fn dropbox_copy_file(
    state: State<'_, DropboxServiceState>,
    from_path: String,
    to_path: String,
    autorename: Option<bool>,
) -> Result<serde_json::Value, String> {
    let token = get_token(&state)?;
    let body = files::build_copy(&from_path, &to_path, autorename.unwrap_or(false));
    let client = DropboxClient::new(&token)?;
    let result = client.rpc("files/copy_v2", &body).await?;
    {
        let mut svc = state.lock().map_err(|e| e.to_string())?;
        svc.record_api_call();
        svc.log(ActivityType::Copy, &format!("Copied {from_path} → {to_path}"), true, None);
    }
    Ok(result)
}

#[tauri::command]
pub async fn dropbox_delete(
    state: State<'_, DropboxServiceState>,
    path: String,
) -> Result<serde_json::Value, String> {
    let token = get_token(&state)?;
    let body = files::build_delete(&path);
    let client = DropboxClient::new(&token)?;
    let result = client.rpc("files/delete_v2", &body).await?;
    {
        let mut svc = state.lock().map_err(|e| e.to_string())?;
        svc.record_api_call();
        svc.log(ActivityType::Delete, &format!("Deleted {path}"), true, None);
    }
    Ok(result)
}

#[tauri::command]
pub async fn dropbox_delete_batch(
    state: State<'_, DropboxServiceState>,
    paths: Vec<String>,
) -> Result<serde_json::Value, String> {
    let token = get_token(&state)?;
    let path_refs: Vec<&str> = paths.iter().map(|s| s.as_str()).collect();
    let body = files::build_delete_batch(&path_refs);
    let client = DropboxClient::new(&token)?;
    let result = client.rpc("files/delete_batch", &body).await?;
    {
        let mut svc = state.lock().map_err(|e| e.to_string())?;
        svc.record_api_call();
    }
    Ok(result)
}

#[tauri::command]
pub async fn dropbox_move_batch(
    state: State<'_, DropboxServiceState>,
    entries: Vec<(String, String)>,
    autorename: Option<bool>,
) -> Result<serde_json::Value, String> {
    let token = get_token(&state)?;
    let pairs: Vec<(&str, &str)> = entries
        .iter()
        .map(|(f, t)| (f.as_str(), t.as_str()))
        .collect();
    let body = files::build_move_batch(&pairs, autorename.unwrap_or(false));
    let client = DropboxClient::new(&token)?;
    let result = client.rpc("files/move_batch_v2", &body).await?;
    {
        let mut svc = state.lock().map_err(|e| e.to_string())?;
        svc.record_api_call();
    }
    Ok(result)
}

#[tauri::command]
pub async fn dropbox_copy_batch(
    state: State<'_, DropboxServiceState>,
    entries: Vec<(String, String)>,
    autorename: Option<bool>,
) -> Result<serde_json::Value, String> {
    let token = get_token(&state)?;
    let pairs: Vec<(&str, &str)> = entries
        .iter()
        .map(|(f, t)| (f.as_str(), t.as_str()))
        .collect();
    let body = files::build_copy_batch(&pairs, autorename.unwrap_or(false));
    let client = DropboxClient::new(&token)?;
    let result = client.rpc("files/copy_batch_v2", &body).await?;
    {
        let mut svc = state.lock().map_err(|e| e.to_string())?;
        svc.record_api_call();
    }
    Ok(result)
}

#[tauri::command]
pub async fn dropbox_search(
    state: State<'_, DropboxServiceState>,
    query: String,
    path: Option<String>,
    max_results: Option<u64>,
) -> Result<serde_json::Value, String> {
    let token = get_token(&state)?;
    let body = files::build_search(&query, path.as_deref(), max_results);
    let client = DropboxClient::new(&token)?;
    let result = client.rpc("files/search_v2", &body).await?;
    {
        let mut svc = state.lock().map_err(|e| e.to_string())?;
        svc.record_api_call();
    }
    Ok(result)
}

#[tauri::command]
pub async fn dropbox_search_continue(
    state: State<'_, DropboxServiceState>,
    cursor: String,
) -> Result<serde_json::Value, String> {
    let token = get_token(&state)?;
    let body = files::build_search_continue(&cursor);
    let client = DropboxClient::new(&token)?;
    client.rpc("files/search/continue_v2", &body).await
}

#[tauri::command]
pub async fn dropbox_list_revisions(
    state: State<'_, DropboxServiceState>,
    path: String,
    limit: Option<u64>,
) -> Result<serde_json::Value, String> {
    let token = get_token(&state)?;
    let body = files::build_list_revisions(&path, limit);
    let client = DropboxClient::new(&token)?;
    client.rpc("files/list_revisions", &body).await
}

#[tauri::command]
pub async fn dropbox_restore(
    state: State<'_, DropboxServiceState>,
    path: String,
    rev: String,
) -> Result<serde_json::Value, String> {
    let token = get_token(&state)?;
    let body = files::build_restore(&path, &rev);
    let client = DropboxClient::new(&token)?;
    client.rpc("files/restore", &body).await
}

#[tauri::command]
pub async fn dropbox_get_thumbnail(
    state: State<'_, DropboxServiceState>,
    path: String,
    format: Option<String>,
    size: Option<String>,
) -> Result<Vec<u8>, String> {
    let token = get_token(&state)?;
    let fmt = match format.as_deref() {
        Some("png") => ThumbnailFormat::Png,
        _ => ThumbnailFormat::Jpeg,
    };
    let sz = match size.as_deref() {
        Some("w32h32") => ThumbnailSize::W32H32,
        Some("w64h64") => ThumbnailSize::W64H64,
        Some("w128h128") => ThumbnailSize::W128H128,
        Some("w480h320") => ThumbnailSize::W480H320,
        Some("w640h480") => ThumbnailSize::W640H480,
        Some("w960h640") => ThumbnailSize::W960H640,
        Some("w1024h768") => ThumbnailSize::W1024H768,
        Some("w2048h1536") => ThumbnailSize::W2048H1536,
        _ => ThumbnailSize::W256H256,
    };
    let arg = files::build_get_thumbnail(&path, &fmt, &sz, &ThumbnailMode::Bestfit);
    let client = DropboxClient::new(&token)?;
    let (bytes, _) = client.content_download("files/get_thumbnail_v2", &arg).await?;
    Ok(bytes)
}

#[tauri::command]
pub fn dropbox_content_hash(data: Vec<u8>) -> String {
    files::content_hash(&data)
}

#[tauri::command]
pub fn dropbox_guess_mime(filename: String) -> String {
    files::guess_mime(&filename).to_string()
}

#[tauri::command]
pub async fn dropbox_upload_session_start(
    state: State<'_, DropboxServiceState>,
    data: Vec<u8>,
    close: Option<bool>,
) -> Result<serde_json::Value, String> {
    let token = get_token(&state)?;
    let arg = files::build_upload_session_start(close.unwrap_or(false));
    let client = DropboxClient::new(&token)?;
    client
        .content_upload("files/upload_session/start", &arg, &data)
        .await
}

#[tauri::command]
pub async fn dropbox_upload_session_append(
    state: State<'_, DropboxServiceState>,
    session_id: String,
    offset: u64,
    data: Vec<u8>,
    close: Option<bool>,
) -> Result<String, String> {
    let token = get_token(&state)?;
    let arg = files::build_upload_session_append(&session_id, offset, close.unwrap_or(false));
    let client = DropboxClient::new(&token)?;
    let _result: serde_json::Value = client
        .content_upload("files/upload_session/append_v2", &arg, &data)
        .await?;
    Ok("ok".into())
}

#[tauri::command]
pub async fn dropbox_upload_session_finish(
    state: State<'_, DropboxServiceState>,
    session_id: String,
    offset: u64,
    path: String,
    mode: Option<String>,
    autorename: Option<bool>,
    data: Vec<u8>,
) -> Result<serde_json::Value, String> {
    let token = get_token(&state)?;
    let write_mode = match mode.as_deref() {
        Some("overwrite") => WriteMode::Overwrite,
        _ => WriteMode::Add,
    };
    let arg = files::build_upload_session_finish(
        &session_id,
        offset,
        &path,
        &write_mode,
        autorename.unwrap_or(false),
    );
    let client = DropboxClient::new(&token)?;
    client
        .content_upload("files/upload_session/finish", &arg, &data)
        .await
}

#[tauri::command]
pub async fn dropbox_check_job_status(
    state: State<'_, DropboxServiceState>,
    async_job_id: String,
    route: Option<String>,
) -> Result<serde_json::Value, String> {
    let token = get_token(&state)?;
    let body = files::build_check_job_status(&async_job_id);
    let client = DropboxClient::new(&token)?;
    let r = route.unwrap_or_else(|| "files/delete_batch/check".to_string());
    client.rpc(&r, &body).await
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Folder Operations
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn dropbox_create_folder(
    state: State<'_, DropboxServiceState>,
    path: String,
    autorename: Option<bool>,
) -> Result<serde_json::Value, String> {
    let token = get_token(&state)?;
    let body = folders::build_create_folder(&path, autorename.unwrap_or(false));
    let client = DropboxClient::new(&token)?;
    client.rpc("files/create_folder_v2", &body).await
}

#[tauri::command]
pub async fn dropbox_list_folder(
    state: State<'_, DropboxServiceState>,
    path: String,
    recursive: Option<bool>,
    include_deleted: Option<bool>,
    limit: Option<u32>,
) -> Result<serde_json::Value, String> {
    let token = get_token(&state)?;
    let req = ListFolderRequest {
        path,
        recursive: recursive.unwrap_or(false),
        include_deleted: include_deleted.unwrap_or(false),
        limit,
        ..Default::default()
    };
    let body = folders::build_list_folder(&req);
    let client = DropboxClient::new(&token)?;
    let result = client.rpc("files/list_folder", &body).await?;
    {
        let mut svc = state.lock().map_err(|e| e.to_string())?;
        svc.record_api_call();
    }
    Ok(result)
}

#[tauri::command]
pub async fn dropbox_list_folder_continue(
    state: State<'_, DropboxServiceState>,
    cursor: String,
) -> Result<serde_json::Value, String> {
    let token = get_token(&state)?;
    let body = folders::build_list_folder_continue(&cursor);
    let client = DropboxClient::new(&token)?;
    client.rpc("files/list_folder/continue", &body).await
}

#[tauri::command]
pub async fn dropbox_get_latest_cursor(
    state: State<'_, DropboxServiceState>,
    path: String,
    recursive: Option<bool>,
) -> Result<serde_json::Value, String> {
    let token = get_token(&state)?;
    let body = folders::build_get_latest_cursor(&path, recursive.unwrap_or(false));
    let client = DropboxClient::new(&token)?;
    client.rpc("files/list_folder/get_latest_cursor", &body).await
}

#[tauri::command]
pub async fn dropbox_create_folder_batch(
    state: State<'_, DropboxServiceState>,
    paths: Vec<String>,
    autorename: Option<bool>,
) -> Result<serde_json::Value, String> {
    let token = get_token(&state)?;
    let path_refs: Vec<&str> = paths.iter().map(|s| s.as_str()).collect();
    let body = folders::build_create_folder_batch(&path_refs, autorename.unwrap_or(false), false);
    let client = DropboxClient::new(&token)?;
    client.rpc("files/create_folder_batch", &body).await
}

#[tauri::command]
pub fn dropbox_breadcrumbs(path: String) -> Vec<String> {
    folders::breadcrumbs(&path)
}

#[tauri::command]
pub fn dropbox_parent_path(path: String) -> String {
    folders::parent_path(&path).to_string()
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Sharing
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn dropbox_create_shared_link(
    state: State<'_, DropboxServiceState>,
    path: String,
    visibility: Option<String>,
) -> Result<serde_json::Value, String> {
    let token = get_token(&state)?;
    let settings = visibility.map(|v| SharedLinkSettings {
        requested_visibility: Some(match v.as_str() {
            "team_only" => RequestedVisibility::TeamOnly,
            "password" => RequestedVisibility::Password,
            _ => RequestedVisibility::Public,
        }),
        link_password: None,
        expires: None,
        audience: None,
        access: None,
        allow_download: None,
    });
    let body = sharing::build_create_shared_link(&path, settings.as_ref());
    let client = DropboxClient::new(&token)?;
    client
        .rpc("sharing/create_shared_link_with_settings", &body)
        .await
}

#[tauri::command]
pub async fn dropbox_list_shared_links(
    state: State<'_, DropboxServiceState>,
    path: Option<String>,
    cursor: Option<String>,
    direct_only: Option<bool>,
) -> Result<serde_json::Value, String> {
    let token = get_token(&state)?;
    let body = sharing::build_list_shared_links(
        path.as_deref(),
        cursor.as_deref(),
        direct_only,
    );
    let client = DropboxClient::new(&token)?;
    client.rpc("sharing/list_shared_links", &body).await
}

#[tauri::command]
pub async fn dropbox_revoke_shared_link(
    state: State<'_, DropboxServiceState>,
    url: String,
) -> Result<String, String> {
    let token = get_token(&state)?;
    let body = sharing::build_revoke_shared_link(&url);
    let client = DropboxClient::new(&token)?;
    let _: serde_json::Value = client.rpc("sharing/revoke_shared_link", &body).await?;
    Ok("revoked".into())
}

#[tauri::command]
pub async fn dropbox_share_folder(
    state: State<'_, DropboxServiceState>,
    path: String,
    member_policy: Option<String>,
    acl_update_policy: Option<String>,
    shared_link_policy: Option<String>,
) -> Result<serde_json::Value, String> {
    let token = get_token(&state)?;
    let body = sharing::build_share_folder(
        &path,
        member_policy.as_deref(),
        acl_update_policy.as_deref(),
        shared_link_policy.as_deref(),
        false,
    );
    let client = DropboxClient::new(&token)?;
    client.rpc("sharing/share_folder", &body).await
}

#[tauri::command]
pub async fn dropbox_unshare_folder(
    state: State<'_, DropboxServiceState>,
    shared_folder_id: String,
    leave_a_copy: Option<bool>,
) -> Result<serde_json::Value, String> {
    let token = get_token(&state)?;
    let body = sharing::build_unshare_folder(&shared_folder_id, leave_a_copy.unwrap_or(false));
    let client = DropboxClient::new(&token)?;
    client.rpc("sharing/unshare_folder", &body).await
}

#[tauri::command]
pub async fn dropbox_list_folder_members(
    state: State<'_, DropboxServiceState>,
    shared_folder_id: String,
    limit: Option<u32>,
) -> Result<serde_json::Value, String> {
    let token = get_token(&state)?;
    let body = sharing::build_list_folder_members(&shared_folder_id, limit);
    let client = DropboxClient::new(&token)?;
    client.rpc("sharing/list_folder_members", &body).await
}

#[tauri::command]
pub async fn dropbox_list_shared_folders(
    state: State<'_, DropboxServiceState>,
    limit: Option<u32>,
) -> Result<serde_json::Value, String> {
    let token = get_token(&state)?;
    let body = sharing::build_list_shared_folders(limit);
    let client = DropboxClient::new(&token)?;
    client.rpc("sharing/list_folders", &body).await
}

#[tauri::command]
pub async fn dropbox_mount_folder(
    state: State<'_, DropboxServiceState>,
    shared_folder_id: String,
) -> Result<serde_json::Value, String> {
    let token = get_token(&state)?;
    let body = sharing::build_mount_folder(&shared_folder_id);
    let client = DropboxClient::new(&token)?;
    client.rpc("sharing/mount_folder", &body).await
}

#[tauri::command]
pub async fn dropbox_get_shared_link_metadata(
    state: State<'_, DropboxServiceState>,
    url: String,
) -> Result<serde_json::Value, String> {
    let token = get_token(&state)?;
    let body = sharing::build_get_shared_link_metadata(&url);
    let client = DropboxClient::new(&token)?;
    client.rpc("sharing/get_shared_link_metadata", &body).await
}

#[tauri::command]
pub fn dropbox_shared_link_to_direct(url: String) -> String {
    sharing::shared_link_to_direct(&url)
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Account
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn dropbox_get_current_account(
    state: State<'_, DropboxServiceState>,
) -> Result<serde_json::Value, String> {
    let token = get_token(&state)?;
    let body = account::build_get_current_account();
    let client = DropboxClient::new(&token)?;
    client.rpc("users/get_current_account", &body).await
}

#[tauri::command]
pub async fn dropbox_get_space_usage(
    state: State<'_, DropboxServiceState>,
) -> Result<serde_json::Value, String> {
    let token = get_token(&state)?;
    let body = account::build_get_space_usage();
    let client = DropboxClient::new(&token)?;
    client.rpc("users/get_space_usage", &body).await
}

#[tauri::command]
pub fn dropbox_format_space_usage(used: u64, allocated: u64) -> String {
    account::format_space_usage(used, allocated)
}

#[tauri::command]
pub fn dropbox_is_space_critical(used: u64, allocated: u64, threshold_pct: Option<f64>) -> bool {
    account::is_space_critical(used, allocated, threshold_pct.unwrap_or(90.0))
}

#[tauri::command]
pub async fn dropbox_get_account(
    state: State<'_, DropboxServiceState>,
    account_id: String,
) -> Result<serde_json::Value, String> {
    let token = get_token(&state)?;
    let body = account::build_get_account(&account_id);
    let client = DropboxClient::new(&token)?;
    client.rpc("users/get_account", &body).await
}

#[tauri::command]
pub async fn dropbox_get_features(
    state: State<'_, DropboxServiceState>,
    features: Vec<String>,
) -> Result<serde_json::Value, String> {
    let token = get_token(&state)?;
    let feat_refs: Vec<&str> = features.iter().map(|s| s.as_str()).collect();
    let body = account::build_get_features(&feat_refs);
    let client = DropboxClient::new(&token)?;
    client.rpc("users/features/get_values", &body).await
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Team
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn dropbox_get_team_info(
    state: State<'_, DropboxServiceState>,
) -> Result<serde_json::Value, String> {
    let token = get_token(&state)?;
    let body = team::build_get_team_info();
    let client = DropboxClient::new(&token)?;
    client.rpc("team/get_info", &body).await
}

#[tauri::command]
pub async fn dropbox_team_members_list(
    state: State<'_, DropboxServiceState>,
    limit: Option<u32>,
    include_removed: Option<bool>,
) -> Result<serde_json::Value, String> {
    let token = get_token(&state)?;
    let body = team::build_members_list(limit, include_removed.unwrap_or(false));
    let client = DropboxClient::new(&token)?;
    client.rpc("team/members/list_v2", &body).await
}

#[tauri::command]
pub async fn dropbox_team_members_list_continue(
    state: State<'_, DropboxServiceState>,
    cursor: String,
) -> Result<serde_json::Value, String> {
    let token = get_token(&state)?;
    let body = team::build_members_list_continue(&cursor);
    let client = DropboxClient::new(&token)?;
    client.rpc("team/members/list/continue_v2", &body).await
}

#[tauri::command]
pub async fn dropbox_team_members_get_info(
    state: State<'_, DropboxServiceState>,
    members: Vec<String>,
) -> Result<serde_json::Value, String> {
    let token = get_token(&state)?;
    let mem_refs: Vec<&str> = members.iter().map(|s| s.as_str()).collect();
    let body = team::build_members_get_info(&mem_refs);
    let client = DropboxClient::new(&token)?;
    client.rpc("team/members/get_info_v2", &body).await
}

#[tauri::command]
pub async fn dropbox_team_member_suspend(
    state: State<'_, DropboxServiceState>,
    team_member_id: String,
    wipe_data: Option<bool>,
) -> Result<serde_json::Value, String> {
    let token = get_token(&state)?;
    let body = team::build_members_suspend(&team_member_id, wipe_data.unwrap_or(false));
    let client = DropboxClient::new(&token)?;
    client.rpc("team/members/suspend", &body).await
}

#[tauri::command]
pub async fn dropbox_team_member_unsuspend(
    state: State<'_, DropboxServiceState>,
    team_member_id: String,
) -> Result<serde_json::Value, String> {
    let token = get_token(&state)?;
    let body = team::build_members_unsuspend(&team_member_id);
    let client = DropboxClient::new(&token)?;
    client.rpc("team/members/unsuspend", &body).await
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Paper
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn dropbox_paper_create(
    state: State<'_, DropboxServiceState>,
    path: String,
    content: Vec<u8>,
    import_format: Option<String>,
) -> Result<serde_json::Value, String> {
    let token = get_token(&state)?;
    let fmt = import_format.unwrap_or_else(|| "html".into());
    let arg = paper::build_paper_create(&path, &fmt);
    let client = DropboxClient::new(&token)?;
    client.content_upload("files/paper/create", &arg, &content).await
}

#[tauri::command]
pub async fn dropbox_paper_update(
    state: State<'_, DropboxServiceState>,
    path: String,
    content: Vec<u8>,
    import_format: Option<String>,
    doc_update_policy: Option<String>,
    paper_revision: Option<i64>,
) -> Result<serde_json::Value, String> {
    let token = get_token(&state)?;
    let fmt = import_format.unwrap_or_else(|| "html".into());
    let policy = match doc_update_policy.as_deref() {
        Some("overwrite") => PaperDocUpdatePolicy::Overwrite,
        Some("prepend") => PaperDocUpdatePolicy::Prepend,
        _ => PaperDocUpdatePolicy::Append,
    };
    let arg = paper::build_paper_update(&path, &fmt, &policy, paper_revision);
    let client = DropboxClient::new(&token)?;
    client.content_upload("files/paper/update", &arg, &content).await
}

#[tauri::command]
pub async fn dropbox_paper_list(
    state: State<'_, DropboxServiceState>,
    filter_by: Option<String>,
    sort_by: Option<String>,
    sort_order: Option<String>,
    limit: Option<u32>,
) -> Result<serde_json::Value, String> {
    let token = get_token(&state)?;
    let body = paper::build_paper_list(
        filter_by.as_deref(),
        sort_by.as_deref(),
        sort_order.as_deref(),
        limit,
    );
    let client = DropboxClient::new(&token)?;
    client.rpc("paper/docs/list", &body).await
}

#[tauri::command]
pub async fn dropbox_paper_archive(
    state: State<'_, DropboxServiceState>,
    doc_id: String,
) -> Result<String, String> {
    let token = get_token(&state)?;
    let body = paper::build_paper_archive(&doc_id);
    let client = DropboxClient::new(&token)?;
    let _: serde_json::Value = client.rpc("paper/docs/archive", &body).await?;
    Ok("archived".into())
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Sync Manager
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub fn dropbox_sync_create(
    state: State<'_, DropboxServiceState>,
    name: String,
    account_name: String,
    local_path: String,
    dropbox_path: String,
    direction: String,
) -> Result<String, String> {
    let mut svc = state.lock().map_err(|e| e.to_string())?;
    let dir = match direction.as_str() {
        "upload" => SyncDirection::Upload,
        "download" => SyncDirection::Download,
        _ => SyncDirection::Bidirectional,
    };
    Ok(svc.sync_manager.create_config(&name, &account_name, &local_path, &dropbox_path, dir))
}

#[tauri::command]
pub fn dropbox_sync_remove(
    state: State<'_, DropboxServiceState>,
    id: String,
) -> Result<bool, String> {
    let mut svc = state.lock().map_err(|e| e.to_string())?;
    Ok(svc.sync_manager.remove_config(&id))
}

#[tauri::command]
pub fn dropbox_sync_list(
    state: State<'_, DropboxServiceState>,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    let configs: Vec<&SyncConfig> = svc.sync_manager.list_configs();
    serde_json::to_value(configs).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn dropbox_sync_set_enabled(
    state: State<'_, DropboxServiceState>,
    id: String,
    enabled: bool,
) -> Result<bool, String> {
    let mut svc = state.lock().map_err(|e| e.to_string())?;
    Ok(svc.sync_manager.set_enabled(&id, enabled))
}

#[tauri::command]
pub fn dropbox_sync_set_interval(
    state: State<'_, DropboxServiceState>,
    id: String,
    secs: u64,
) -> Result<bool, String> {
    let mut svc = state.lock().map_err(|e| e.to_string())?;
    Ok(svc.sync_manager.set_sync_interval(&id, secs))
}

#[tauri::command]
pub fn dropbox_sync_set_exclude_patterns(
    state: State<'_, DropboxServiceState>,
    id: String,
    patterns: Vec<String>,
) -> Result<bool, String> {
    let mut svc = state.lock().map_err(|e| e.to_string())?;
    Ok(svc.sync_manager.set_exclude_patterns(&id, patterns))
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Backup Manager
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn dropbox_backup_create(
    state: State<'_, DropboxServiceState>,
    name: String,
    account_name: String,
    dropbox_path: String,
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
    Ok(svc.backup_manager.create_config(&name, &account_name, &dropbox_path, includes))
}

#[tauri::command]
pub fn dropbox_backup_remove(
    state: State<'_, DropboxServiceState>,
    id: String,
) -> Result<bool, String> {
    let mut svc = state.lock().map_err(|e| e.to_string())?;
    Ok(svc.backup_manager.remove_config(&id))
}

#[tauri::command]
pub fn dropbox_backup_list(
    state: State<'_, DropboxServiceState>,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    let configs: Vec<&BackupConfig> = svc.backup_manager.list_configs();
    serde_json::to_value(configs).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn dropbox_backup_set_enabled(
    state: State<'_, DropboxServiceState>,
    id: String,
    enabled: bool,
) -> Result<bool, String> {
    let mut svc = state.lock().map_err(|e| e.to_string())?;
    Ok(svc.backup_manager.set_enabled(&id, enabled))
}

#[tauri::command]
pub fn dropbox_backup_set_max_revisions(
    state: State<'_, DropboxServiceState>,
    id: String,
    count: u32,
) -> Result<bool, String> {
    let mut svc = state.lock().map_err(|e| e.to_string())?;
    Ok(svc.backup_manager.set_max_revisions(&id, count))
}

#[tauri::command]
pub fn dropbox_backup_set_interval(
    state: State<'_, DropboxServiceState>,
    id: String,
    seconds: u64,
) -> Result<bool, String> {
    let mut svc = state.lock().map_err(|e| e.to_string())?;
    Ok(svc.backup_manager.set_interval(&id, seconds))
}

#[tauri::command]
pub fn dropbox_backup_get_history(
    state: State<'_, DropboxServiceState>,
    id: String,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    let hist: Vec<&BackupResult> = svc.backup_manager.get_history(&id);
    serde_json::to_value(hist).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn dropbox_backup_total_size(
    state: State<'_, DropboxServiceState>,
    id: String,
) -> Result<u64, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    Ok(svc.backup_manager.total_backup_size(&id))
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Watcher
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub fn dropbox_watch_create(
    state: State<'_, DropboxServiceState>,
    name: String,
    account_name: String,
    dropbox_path: String,
    recursive: Option<bool>,
    interval_seconds: Option<u64>,
) -> Result<String, String> {
    let mut svc = state.lock().map_err(|e| e.to_string())?;
    Ok(svc.watch_manager.create_watch(
        &name,
        &account_name,
        &dropbox_path,
        recursive.unwrap_or(true),
        interval_seconds.unwrap_or(60),
    ))
}

#[tauri::command]
pub fn dropbox_watch_remove(
    state: State<'_, DropboxServiceState>,
    id: String,
) -> Result<bool, String> {
    let mut svc = state.lock().map_err(|e| e.to_string())?;
    Ok(svc.watch_manager.remove_watch(&id))
}

#[tauri::command]
pub fn dropbox_watch_list(
    state: State<'_, DropboxServiceState>,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    let watches: Vec<&WatchConfig> = svc.watch_manager.list_watches();
    serde_json::to_value(watches).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn dropbox_watch_set_enabled(
    state: State<'_, DropboxServiceState>,
    id: String,
    enabled: bool,
) -> Result<bool, String> {
    let mut svc = state.lock().map_err(|e| e.to_string())?;
    Ok(svc.watch_manager.set_enabled(&id, enabled))
}

#[tauri::command]
pub fn dropbox_watch_get_changes(
    state: State<'_, DropboxServiceState>,
    id: String,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    let changes: Vec<&FileChange> = svc.watch_manager.get_changes(&id);
    serde_json::to_value(changes).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn dropbox_watch_clear_changes(
    state: State<'_, DropboxServiceState>,
    id: String,
) -> Result<String, String> {
    let mut svc = state.lock().map_err(|e| e.to_string())?;
    svc.watch_manager.clear_changes(&id);
    Ok("cleared".into())
}

#[tauri::command]
pub fn dropbox_watch_total_pending(
    state: State<'_, DropboxServiceState>,
) -> Result<usize, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    Ok(svc.watch_manager.total_pending_changes())
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Activity Log & Stats
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub fn dropbox_get_activity_log(
    state: State<'_, DropboxServiceState>,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    serde_json::to_value(svc.get_activity_log()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn dropbox_clear_activity_log(
    state: State<'_, DropboxServiceState>,
) -> Result<String, String> {
    let mut svc = state.lock().map_err(|e| e.to_string())?;
    svc.clear_activity_log();
    Ok("cleared".into())
}

#[tauri::command]
pub fn dropbox_get_stats(
    state: State<'_, DropboxServiceState>,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    serde_json::to_value(&svc.stats).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn dropbox_reset_stats(
    state: State<'_, DropboxServiceState>,
) -> Result<String, String> {
    let mut svc = state.lock().map_err(|e| e.to_string())?;
    svc.reset_stats();
    Ok("reset".into())
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Longpoll
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[tauri::command]
pub async fn dropbox_longpoll(
    state: State<'_, DropboxServiceState>,
    cursor: String,
    timeout: Option<u64>,
) -> Result<serde_json::Value, String> {
    let token = get_token(&state)?;
    let client = DropboxClient::new(&token)?;
    let result = client
        .list_folder_longpoll(&cursor, timeout.unwrap_or(30))
        .await?;
    serde_json::to_value(&result).map_err(|e| e.to_string())
}
