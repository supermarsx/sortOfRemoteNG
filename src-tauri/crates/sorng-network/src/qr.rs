use std::sync::Arc;
use tokio::sync::Mutex;
use qrcode::QrCode;
use qrcode::render::svg;
use base64::{Engine as _, engine::general_purpose};

pub type QrServiceState = Arc<Mutex<QrService>>;

pub struct QrService {
    // Placeholder
}

impl QrService {
    pub fn new() -> QrServiceState {
        Arc::new(Mutex::new(QrService {}))
    }

    pub async fn generate_qr_code(&self, data: String, size: Option<u32>) -> Result<String, String> {
        let size = size.unwrap_or(256);

        let code = QrCode::new(data.as_bytes())
            .map_err(|e| format!("Failed to create QR code: {}", e))?;

        // Generate SVG
        let image = code.render::<svg::Color>()
            .min_dimensions(size, size)
            .build();

        Ok(image)
    }

    pub async fn generate_qr_code_png(&self, data: String, size: Option<u32>) -> Result<String, String> {
        let size = size.unwrap_or(256);

        let code = QrCode::new(data.as_bytes())
            .map_err(|e| format!("Failed to create QR code: {}", e))?;

        // Generate PNG bytes
        let image = code.render::<image::Luma<u8>>()
            .min_dimensions(size, size)
            .build();

        // Convert to base64
        let b64 = general_purpose::STANDARD.encode(image.as_raw());
        Ok(format!("data:image/png;base64,{}", b64))
    }
}

#[tauri::command]
pub async fn generate_qr_code(state: tauri::State<'_, QrServiceState>, data: String, size: Option<u32>) -> Result<String, String> {
    let qr = state.lock().await;
    qr.generate_qr_code(data, size).await
}

#[tauri::command]
pub async fn generate_qr_code_png(state: tauri::State<'_, QrServiceState>, data: String, size: Option<u32>) -> Result<String, String> {
    let qr = state.lock().await;
    qr.generate_qr_code_png(data, size).await
}