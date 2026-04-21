use super::cloudflare::*;

#[tauri::command]
pub async fn connect_cloudflare(
    state: tauri::State<'_, CloudflareServiceState>,
    config: CloudflareConnectionConfig,
) -> Result<String, String> {
    let mut cloudflare = state.lock().await;
    cloudflare.connect_cloudflare(config).await
}

#[tauri::command]
pub async fn disconnect_cloudflare(
    state: tauri::State<'_, CloudflareServiceState>,
    session_id: String,
) -> Result<(), String> {
    let mut cloudflare = state.lock().await;
    cloudflare.disconnect_cloudflare(&session_id).await
}

#[tauri::command]
pub async fn list_cloudflare_sessions(
    state: tauri::State<'_, CloudflareServiceState>,
) -> Result<Vec<CloudflareSession>, String> {
    let cloudflare = state.lock().await;
    Ok(cloudflare.list_cloudflare_sessions().await)
}

#[tauri::command]
pub async fn get_cloudflare_session(
    state: tauri::State<'_, CloudflareServiceState>,
    session_id: String,
) -> Result<CloudflareSession, String> {
    let cloudflare = state.lock().await;
    cloudflare
        .get_cloudflare_session(&session_id)
        .await
        .ok_or_else(|| format!("Cloudflare session {} not found", session_id))
}

#[tauri::command]
pub async fn list_cloudflare_zones(
    state: tauri::State<'_, CloudflareServiceState>,
    session_id: String,
) -> Result<Vec<CloudflareZone>, String> {
    let cloudflare = state.lock().await;
    cloudflare.list_cloudflare_zones(&session_id).await
}

#[tauri::command]
pub async fn list_cloudflare_dns_records(
    state: tauri::State<'_, CloudflareServiceState>,
    session_id: String,
    zone_id: String,
) -> Result<Vec<CloudflareDNSRecord>, String> {
    let cloudflare = state.lock().await;
    cloudflare
        .list_cloudflare_dns_records(&session_id, &zone_id)
        .await
}

#[tauri::command]
pub async fn create_cloudflare_dns_record(
    state: tauri::State<'_, CloudflareServiceState>,
    session_id: String,
    zone_id: String,
    record: CloudflareDNSRecord,
) -> Result<String, String> {
    let cloudflare = state.lock().await;
    cloudflare
        .create_cloudflare_dns_record(&session_id, &zone_id, record)
        .await
}

#[tauri::command]
pub async fn update_cloudflare_dns_record(
    state: tauri::State<'_, CloudflareServiceState>,
    session_id: String,
    zone_id: String,
    record_id: String,
    record: CloudflareDNSRecord,
) -> Result<String, String> {
    let cloudflare = state.lock().await;
    cloudflare
        .update_cloudflare_dns_record(&session_id, &zone_id, &record_id, record)
        .await
}

#[tauri::command]
pub async fn delete_cloudflare_dns_record(
    state: tauri::State<'_, CloudflareServiceState>,
    session_id: String,
    zone_id: String,
    record_id: String,
) -> Result<String, String> {
    let cloudflare = state.lock().await;
    cloudflare
        .delete_cloudflare_dns_record(&session_id, &zone_id, &record_id)
        .await
}

#[tauri::command]
pub async fn list_cloudflare_workers(
    state: tauri::State<'_, CloudflareServiceState>,
    session_id: String,
    account_id: String,
) -> Result<Vec<CloudflareWorker>, String> {
    let cloudflare = state.lock().await;
    cloudflare
        .list_cloudflare_workers(&session_id, &account_id)
        .await
}

#[tauri::command]
pub async fn deploy_cloudflare_worker(
    state: tauri::State<'_, CloudflareServiceState>,
    session_id: String,
    account_id: String,
    script_name: String,
    script_content: String,
) -> Result<String, String> {
    let cloudflare = state.lock().await;
    cloudflare
        .deploy_cloudflare_worker(&session_id, &account_id, &script_name, &script_content)
        .await
}

#[tauri::command]
pub async fn list_cloudflare_page_rules(
    state: tauri::State<'_, CloudflareServiceState>,
    session_id: String,
    zone_id: String,
) -> Result<Vec<CloudflarePageRule>, String> {
    let cloudflare = state.lock().await;
    cloudflare
        .list_cloudflare_page_rules(&session_id, &zone_id)
        .await
}

#[tauri::command]
pub async fn get_cloudflare_analytics(
    state: tauri::State<'_, CloudflareServiceState>,
    session_id: String,
    zone_id: String,
    since: Option<String>,
    until: Option<String>,
) -> Result<CloudflareAnalytics, String> {
    let cloudflare = state.lock().await;
    cloudflare
        .get_cloudflare_analytics(&session_id, &zone_id, since, until)
        .await
}

#[tauri::command]
pub async fn purge_cloudflare_cache(
    state: tauri::State<'_, CloudflareServiceState>,
    session_id: String,
    zone_id: String,
    files: Option<Vec<String>>,
    tags: Option<Vec<String>>,
    hosts: Option<Vec<String>>,
) -> Result<String, String> {
    let cloudflare = state.lock().await;
    cloudflare
        .purge_cloudflare_cache(&session_id, &zone_id, files, tags, hosts)
        .await
}

