use super::qr::*;

#[tauri::command]
pub async fn generate_qr_code(
    state: tauri::State<'_, QrServiceState>,
    data: String,
    size: Option<u32>,
) -> Result<String, String> {
    let qr = state.lock().await;
    qr.generate_qr_code(data, size).await
}

#[tauri::command]
pub async fn generate_qr_code_png(
    state: tauri::State<'_, QrServiceState>,
    data: String,
    size: Option<u32>,
) -> Result<String, String> {
    let qr = state.lock().await;
    qr.generate_qr_code_png(data, size).await
}

