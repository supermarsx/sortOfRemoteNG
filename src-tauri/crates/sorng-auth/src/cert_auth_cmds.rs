use super::cert_auth::*;

#[tauri::command]
pub async fn parse_certificate(
    state: tauri::State<'_, CertAuthServiceState>,
    cert_data: Vec<u8>,
) -> Result<CertInfo, String> {
    let svc = state.lock().await;
    svc.parse_certificate(cert_data)
}

#[tauri::command]
pub async fn validate_certificate(
    state: tauri::State<'_, CertAuthServiceState>,
    cert_data: Vec<u8>,
) -> Result<bool, String> {
    let svc = state.lock().await;
    svc.validate_certificate(cert_data)
}

#[tauri::command]
pub async fn authenticate_with_cert(
    state: tauri::State<'_, CertAuthServiceState>,
    cert_data: Vec<u8>,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.authenticate_with_cert(cert_data).await
}

#[tauri::command]
pub async fn register_certificate(
    state: tauri::State<'_, CertAuthServiceState>,
    username: String,
    cert_data: Vec<u8>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.register_certificate(username, cert_data).await
}

#[tauri::command]
pub async fn list_certificates(
    state: tauri::State<'_, CertAuthServiceState>,
) -> Result<Vec<CertUser>, String> {
    let svc = state.lock().await;
    Ok(svc.list_certificates().await)
}

#[tauri::command]
pub async fn revoke_certificate(
    state: tauri::State<'_, CertAuthServiceState>,
    fingerprint: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.revoke_certificate(fingerprint).await
}

