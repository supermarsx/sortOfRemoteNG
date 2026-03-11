use base64::{engine::general_purpose, Engine as _};
use qrcode::render::svg;
use qrcode::QrCode;
use std::sync::Arc;
use tokio::sync::Mutex;

pub type QrServiceState = Arc<Mutex<QrService>>;

pub struct QrService {
    // Placeholder
}

impl QrService {
    pub fn new() -> QrServiceState {
        Arc::new(Mutex::new(QrService {}))
    }

    pub async fn generate_qr_code(
        &self,
        data: String,
        size: Option<u32>,
    ) -> Result<String, String> {
        let size = size.unwrap_or(256);

        let code =
            QrCode::new(data.as_bytes()).map_err(|e| format!("Failed to create QR code: {}", e))?;

        // Generate SVG
        let image = code
            .render::<svg::Color>()
            .min_dimensions(size, size)
            .build();

        Ok(image)
    }

    pub async fn generate_qr_code_png(
        &self,
        data: String,
        size: Option<u32>,
    ) -> Result<String, String> {
        let svg = self.generate_qr_code(data, size).await?;
        let b64 = general_purpose::STANDARD.encode(svg.as_bytes());
        Ok(format!("data:image/svg+xml;base64,{}", b64))
    }
}

