// Re-exported for use by commands_cmds.rs (compiled via include!() in the app crate).
pub use std::sync::Arc;
pub use std::time::Duration;

pub use crate::ironrdp::pdu::input::fast_path::FastPathInputEvent;
pub use crate::ironrdp_displaycontrol;
pub use tokio::sync::mpsc;
pub use uuid::Uuid;

pub use super::frame_store::SharedFrameStoreState;
pub use super::input::convert_input;
pub use super::session_runner::{run_rdp_session, LogSink};
pub use super::settings::{RdpSettingsPayload, ResolvedSettings};
pub use super::stats::RdpSessionStats;
pub use super::types::*;
pub use super::RdpServiceState;

pub const MAX_RDP_THUMBNAIL_DIMENSION: u32 = 4096;
pub const MAX_RDP_THUMBNAIL_PIXELS: u64 = 4_194_304;

fn checked_rgba_len(width: u32, height: u32, label: &str) -> Result<usize, String> {
    let width = usize::try_from(width)
        .map_err(|_| format!("{label} width does not fit this platform"))?;
    let height = usize::try_from(height)
        .map_err(|_| format!("{label} height does not fit this platform"))?;

    width
        .checked_mul(height)
        .and_then(|pixels| pixels.checked_mul(4))
        .ok_or_else(|| format!("{label} RGBA byte length overflow"))
}

pub fn validate_rdp_thumbnail_dimensions(width: u32, height: u32) -> Result<usize, String> {
    // Preserve the existing empty-thumbnail behavior without considering the
    // unused axis when either requested dimension is zero.
    if width == 0 || height == 0 {
        return Ok(0);
    }

    if width > MAX_RDP_THUMBNAIL_DIMENSION || height > MAX_RDP_THUMBNAIL_DIMENSION {
        return Err(format!(
            "Thumbnail dimensions must not exceed {MAX_RDP_THUMBNAIL_DIMENSION} pixels per axis"
        ));
    }

    let pixels = u64::from(width)
        .checked_mul(u64::from(height))
        .ok_or_else(|| "Thumbnail pixel count overflow".to_string())?;
    if pixels > MAX_RDP_THUMBNAIL_PIXELS {
        return Err(format!(
            "Thumbnail pixel count must not exceed {MAX_RDP_THUMBNAIL_PIXELS}"
        ));
    }

    checked_rgba_len(width, height, "Thumbnail")
}

pub fn resize_rgba_nearest(
    src: &[u8],
    src_w: u32,
    src_h: u32,
    dst_w: u32,
    dst_h: u32,
) -> Result<Vec<u8>, String> {
    if src_w == 0 || src_h == 0 {
        return Err("Source framebuffer dimensions must be non-zero".to_string());
    }

    let expected_src_len = checked_rgba_len(src_w, src_h, "Source framebuffer")?;
    if src.len() != expected_src_len {
        return Err("Invalid framebuffer data".to_string());
    }

    let output_len = validate_rdp_thumbnail_dimensions(dst_w, dst_h)?;
    if output_len == 0 {
        return Ok(Vec::new());
    }

    let mut out = vec![0u8; output_len];
    for y in 0..dst_h {
        let src_y = ((y as u64) * (src_h as u64) / (dst_h as u64)) as u32;
        for x in 0..dst_w {
            let src_x = ((x as u64) * (src_w as u64) / (dst_w as u64)) as u32;
            let src_idx = ((src_y as usize) * (src_w as usize) + (src_x as usize)) * 4;
            let dst_idx = ((y as usize) * (dst_w as usize) + (x as usize)) * 4;
            out[dst_idx..dst_idx + 4].copy_from_slice(&src[src_idx..src_idx + 4]);
        }
    }

    Ok(out)
}

#[cfg(feature = "snapshot")]
pub fn encode_rgba_png(pixels: &[u8], width: u32, height: u32) -> Result<Vec<u8>, String> {
    if pixels.len() != (width as usize) * (height as usize) * 4 {
        return Err("Invalid RGBA buffer for PNG encoding".to_string());
    }

    let mut buf = Vec::new();
    let mut encoder = png::Encoder::new(&mut buf, width, height);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    encoder
        .write_header()
        .map_err(|e| format!("Failed to create PNG header: {e}"))?
        .write_image_data(pixels)
        .map_err(|e| format!("Failed to encode PNG: {e}"))?;

    Ok(buf)
}

#[cfg(not(feature = "snapshot"))]
pub fn encode_rgba_png(_pixels: &[u8], _width: u32, _height: u32) -> Result<Vec<u8>, String> {
    Err("PNG encoding not available (enable `snapshot` feature)".to_string())
}

// ---- Tauri commands ----

#[cfg(test)]
mod thumbnail_safety_tests {
    use super::*;

    #[test]
    fn resize_rejects_oversized_thumbnail_before_allocation() {
        let source = [0_u8; 4];

        let axis_error = resize_rgba_nearest(
            &source,
            1,
            1,
            MAX_RDP_THUMBNAIL_DIMENSION + 1,
            1,
        )
        .expect_err("oversized thumbnail axis should be rejected");
        assert!(axis_error.contains("dimensions"));

        let pixel_error = resize_rgba_nearest(
            &source,
            1,
            1,
            MAX_RDP_THUMBNAIL_DIMENSION,
            MAX_RDP_THUMBNAIL_DIMENSION,
        )
        .expect_err("oversized thumbnail pixel count should be rejected");
        assert!(pixel_error.contains("pixel count"));
    }
}
