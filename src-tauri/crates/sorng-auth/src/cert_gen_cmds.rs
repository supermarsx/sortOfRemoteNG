use super::cert_gen::*;

#[tauri::command]
pub async fn cert_gen_self_signed(
    state: tauri::State<'_, CertGenServiceState>,
    params: CertGenParams,
) -> Result<GeneratedCert, String> {
    let mut svc = state.lock().await;
    svc.generate_self_signed(params).await
}

#[tauri::command]
pub async fn cert_gen_ca(
    state: tauri::State<'_, CertGenServiceState>,
    params: CertGenParams,
) -> Result<GeneratedCert, String> {
    let mut svc = state.lock().await;
    svc.generate_ca(params).await
}

#[tauri::command]
pub async fn cert_gen_csr(
    state: tauri::State<'_, CertGenServiceState>,
    params: CsrGenParams,
) -> Result<GeneratedCsr, String> {
    let mut svc = state.lock().await;
    svc.generate_csr(params).await
}

#[tauri::command]
pub async fn cert_sign_csr(
    state: tauri::State<'_, CertGenServiceState>,
    params: CsrSignParams,
) -> Result<GeneratedCert, String> {
    let mut svc = state.lock().await;
    svc.sign_csr(params).await
}

#[tauri::command]
pub async fn cert_gen_export_pem(
    state: tauri::State<'_, CertGenServiceState>,
    cert_id: String,
    dir: String,
) -> Result<(String, String), String> {
    let svc = state.lock().await;
    svc.export_pem(&cert_id, &dir).await
}

#[tauri::command]
pub async fn cert_gen_export_der(
    state: tauri::State<'_, CertGenServiceState>,
    cert_id: String,
    dir: String,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.export_der(&cert_id, &dir).await
}

#[tauri::command]
pub async fn cert_gen_list(
    state: tauri::State<'_, CertGenServiceState>,
) -> Result<Vec<GeneratedCert>, String> {
    let svc = state.lock().await;
    Ok(svc.list_generated_certs().await)
}

#[tauri::command]
pub async fn cert_gen_get(
    state: tauri::State<'_, CertGenServiceState>,
    id: String,
) -> Result<GeneratedCert, String> {
    let svc = state.lock().await;
    svc.get_generated_cert(&id).await
}

#[tauri::command]
pub async fn cert_gen_delete(
    state: tauri::State<'_, CertGenServiceState>,
    id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.delete_generated_cert(&id).await
}

#[tauri::command]
pub async fn cert_gen_list_csrs(
    state: tauri::State<'_, CertGenServiceState>,
) -> Result<Vec<GeneratedCsr>, String> {
    let svc = state.lock().await;
    Ok(svc.list_generated_csrs().await)
}

#[tauri::command]
pub async fn cert_gen_delete_csr(
    state: tauri::State<'_, CertGenServiceState>,
    id: String,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.delete_generated_csr(&id).await
}

#[tauri::command]
pub async fn cert_gen_update_label(
    state: tauri::State<'_, CertGenServiceState>,
    id: String,
    label: Option<String>,
    tags: Option<Vec<String>>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.update_cert_label(&id, label, tags).await
}

#[tauri::command]
pub async fn cert_gen_get_chain(
    state: tauri::State<'_, CertGenServiceState>,
    id: String,
) -> Result<Vec<GeneratedCert>, String> {
    let svc = state.lock().await;
    svc.get_cert_chain(&id).await
}

#[tauri::command]
pub async fn cert_gen_issue(
    state: tauri::State<'_, CertGenServiceState>,
    params: CertGenParams,
    ca_id: String,
) -> Result<GeneratedCert, String> {
    let mut svc = state.lock().await;
    svc.issue_certificate(params, ca_id).await
}

#[tauri::command]
pub async fn cert_gen_export_chain(
    state: tauri::State<'_, CertGenServiceState>,
    cert_id: String,
    dir: String,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.export_chain_pem(&cert_id, &dir).await
}

