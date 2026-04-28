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

pub fn resize_rgba_nearest(
    src: &[u8],
    src_w: u32,
    src_h: u32,
    dst_w: u32,
    dst_h: u32,
) -> Result<Vec<u8>, String> {
    if src.len() != (src_w as usize) * (src_h as usize) * 4 {
        return Err("Invalid framebuffer data".to_string());
    }

    if dst_w == 0 || dst_h == 0 {
        return Ok(Vec::new());
    }

    let mut out = vec![0u8; (dst_w as usize) * (dst_h as usize) * 4];
    for y in 0..dst_h {
        let src_y = ((y as u64) * (src_h as u64) / (dst_h as u64)) as u32;
        for x in 0..dst_w {
            let src_x = ((x as u64) * (src_w as u64) / (dst_w as u64)) as u32;
            let src_idx = ((src_y * src_w + src_x) * 4) as usize;
            let dst_idx = ((y * dst_w + x) * 4) as usize;
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
