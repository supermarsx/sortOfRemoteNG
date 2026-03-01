//! QR-code generation for `otpauth://` URIs.
//!
//! Uses the `qrcode` crate to produce the QR matrix and the `image` crate
//! to render it as a PNG blob suitable for embedding in UIs or HTML exports.

use image::{GrayImage, Luma};
use qrcode::QrCode;

use crate::totp::types::*;
use crate::totp::uri;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  QR code as PNG bytes
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Module size in pixels (each QR "module" becomes this many px wide).
const MODULE_PX: u32 = 8;
/// Quiet-zone border in modules.
const QUIET_ZONE: u32 = 4;

/// Generate a PNG image (as bytes) of a QR code encoding the given text.
pub fn text_to_qr_png(text: &str, module_px: Option<u32>) -> Result<Vec<u8>, TotpError> {
    let code = QrCode::new(text.as_bytes()).map_err(|e| {
        TotpError::new(TotpErrorKind::QrEncodeFailed, format!("QR encode error: {}", e))
    })?;

    let px = module_px.unwrap_or(MODULE_PX);
    let matrix = code.to_colors();
    let width = code.width() as u32;
    let img_size = (width + QUIET_ZONE * 2) * px;

    let mut img = GrayImage::from_pixel(img_size, img_size, Luma([255u8]));

    for y in 0..width {
        for x in 0..width {
            let color = matrix[(y * width + x) as usize];
            if color == qrcode::Color::Dark {
                let px_x = (x + QUIET_ZONE) * px;
                let px_y = (y + QUIET_ZONE) * px;
                for dy in 0..px {
                    for dx in 0..px {
                        img.put_pixel(px_x + dx, px_y + dy, Luma([0u8]));
                    }
                }
            }
        }
    }

    let mut buf = Vec::new();
    let encoder = image::codecs::png::PngEncoder::new(&mut buf);
    image::ImageEncoder::write_image(
        encoder,
        img.as_raw(),
        img_size,
        img_size,
        image::ExtendedColorType::L8,
    )
    .map_err(|e| TotpError::new(TotpErrorKind::QrEncodeFailed, format!("PNG encode error: {}", e)))?;

    Ok(buf)
}

/// Generate a PNG QR code for a `TotpEntry` (encodes its otpauth URI).
pub fn entry_to_qr_png(entry: &TotpEntry) -> Result<Vec<u8>, TotpError> {
    let uri = uri::build_otpauth_uri(entry);
    text_to_qr_png(&uri, None)
}

/// Generate a base64-encoded data URI (`data:image/png;base64,...`) for a
/// QR code.  Useful for embedding in HTML.
pub fn entry_to_qr_data_uri(entry: &TotpEntry) -> Result<String, TotpError> {
    let png = entry_to_qr_png(entry)?;
    let b64 = base64_encode(&png);
    Ok(format!("data:image/png;base64,{}", b64))
}

/// Generate a base64-encoded data URI from arbitrary text.
pub fn text_to_qr_data_uri(text: &str) -> Result<String, TotpError> {
    let png = text_to_qr_png(text, None)?;
    let b64 = base64_encode(&png);
    Ok(format!("data:image/png;base64,{}", b64))
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

fn base64_encode(data: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(data)
}

/// Extract the QR matrix width from a QR code (useful for testing).
pub fn qr_matrix_width(text: &str) -> Result<usize, TotpError> {
    let code = QrCode::new(text.as_bytes()).map_err(|e| {
        TotpError::new(TotpErrorKind::QrEncodeFailed, format!("QR encode error: {}", e))
    })?;
    Ok(code.width() as usize)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn qr_png_is_valid_png() {
        let png = text_to_qr_png("otpauth://totp/Test?secret=JBSWY3DPEHPK3PXP", None).unwrap();
        // PNG magic bytes
        assert!(png.len() > 8);
        assert_eq!(&png[..4], b"\x89PNG");
    }

    #[test]
    fn qr_entry_png() {
        let entry = TotpEntry::new("alice", "JBSWY3DPEHPK3PXP").with_issuer("Example");
        let png = entry_to_qr_png(&entry).unwrap();
        assert_eq!(&png[..4], b"\x89PNG");
        assert!(png.len() > 100);
    }

    #[test]
    fn qr_data_uri_format() {
        let entry = TotpEntry::new("test", "ABCDEF");
        let uri = entry_to_qr_data_uri(&entry).unwrap();
        assert!(uri.starts_with("data:image/png;base64,"));
    }

    #[test]
    fn qr_text_data_uri() {
        let uri = text_to_qr_data_uri("hello world").unwrap();
        assert!(uri.starts_with("data:image/png;base64,"));
    }

    #[test]
    fn qr_matrix_width_reasonable() {
        let width = qr_matrix_width("otpauth://totp/Test?secret=ABCDEF").unwrap();
        // Typical QR is 21-177 modules wide
        assert!(width >= 21);
        assert!(width <= 177);
    }

    #[test]
    fn qr_custom_module_px() {
        let png_small = text_to_qr_png("test", Some(2)).unwrap();
        let png_large = text_to_qr_png("test", Some(16)).unwrap();
        // Larger module size → bigger PNG
        assert!(png_large.len() > png_small.len());
    }

    #[test]
    fn qr_empty_string_works() {
        // QR can encode an empty string
        let result = text_to_qr_png("", None);
        assert!(result.is_ok());
    }

    #[test]
    fn qr_long_text() {
        let long_text = "a".repeat(500);
        let png = text_to_qr_png(&long_text, None).unwrap();
        assert_eq!(&png[..4], b"\x89PNG");
    }
}
