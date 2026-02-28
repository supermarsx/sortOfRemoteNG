use std::io;
use std::net::TcpStream;
use std::time::Duration;

use ironrdp::session::image::DecodedImage;
use ironrdp::session::ActiveStageOutput;
use ironrdp_blocking::Framed;
use tauri::ipc::{Channel, InvokeResponseBody};

use super::frame_store::SharedFrameStore;
use super::stats::RdpSessionStats;
use sorng_core::native_renderer;

use std::sync::atomic::Ordering;

/// Helper to write response frames and emit graphics/pointer events from
/// `process_fastpath_input` outputs.  Returns `Err` only on fatal write errors.
#[allow(clippy::too_many_arguments)]
pub(crate) fn process_outputs(
    session_id: &str,
    outputs: &[ActiveStageOutput],
    tls_framed: &mut Framed<native_tls::TlsStream<TcpStream>>,
    image: &DecodedImage,
    desktop_width: u16,
    desktop_height: u16,
    _app_handle: &tauri::AppHandle,
    stats: &RdpSessionStats,
    full_frame_sync_interval: u64,
    frame_store: &SharedFrameStore,
    frame_channel: &Channel<InvokeResponseBody>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    for output in outputs {
        match output {
            ActiveStageOutput::ResponseFrame(data) => {
                stats
                    .bytes_sent
                    .fetch_add(data.len() as u64, Ordering::Relaxed);
                stats.pdus_sent.fetch_add(1, Ordering::Relaxed);
                if let Err(e) = tls_framed.write_all(data) {
                    return Err(format!("Write failed: {e}").into());
                }
            }
            ActiveStageOutput::GraphicsUpdate(region) => {
                stats.record_frame();
                // Push dirty region directly through the Channel (no event+invoke round-trip)
                push_frame_via_channel(image.data(), desktop_width, region, frame_channel);
                let fc = stats.frame_count.load(Ordering::Relaxed);
                if fc > 0 && fc % full_frame_sync_interval == 0 {
                    send_full_frame_via_channel(
                        session_id,
                        image,
                        desktop_width,
                        desktop_height,
                        frame_channel,
                        frame_store,
                    );
                }
            }
            _ => {}
        }
    }
    Ok(())
}

/// Merge overlapping/adjacent dirty regions to reduce Channel sends.
///
/// Sorts by (y, x) then greedily merges rects whose bounding boxes overlap.
/// If the result still has more than `MAX_REGIONS` rects, collapses everything
/// into a single bounding rect.
pub(crate) fn merge_dirty_regions(regions: &mut Vec<(u16, u16, u16, u16)>) {
    if regions.len() <= 1 {
        return;
    }

    // Sort by top-left for spatial coherence.
    regions.sort_unstable_by_key(|&(x, y, _, _)| (y, x));

    let mut merged: Vec<(u16, u16, u16, u16)> = Vec::with_capacity(regions.len());
    merged.push(regions[0]);

    for &(rx, ry, rw, rh) in &regions[1..] {
        let last = merged.last_mut().unwrap();
        let (lx, ly, lw, lh) = *last;

        // Check overlap: two rects overlap if neither is entirely left/right/above/below.
        let l_right = lx.saturating_add(lw);
        let l_bottom = ly.saturating_add(lh);
        let r_right = rx.saturating_add(rw);
        let r_bottom = ry.saturating_add(rh);

        if rx <= l_right && lx <= r_right && ry <= l_bottom && ly <= r_bottom {
            // Merge into bounding rect.
            let new_x = lx.min(rx);
            let new_y = ly.min(ry);
            let new_right = l_right.max(r_right);
            let new_bottom = l_bottom.max(r_bottom);
            *last = (new_x, new_y, new_right - new_x, new_bottom - new_y);
        } else {
            merged.push((rx, ry, rw, rh));
        }
    }

    // Don't collapse to a single bounding rect -- scattered small rects
    // (e.g. 10 x 100x100 = 400 KB) would expand into one huge rect
    // (e.g. 1920x800 = 6 MB), amplifying data by 15x.  Just send the
    // individually merged rects; Channel overhead per rect is negligible.
    *regions = merged;
}

/// Push multiple dirty regions in a single Channel message.
///
/// Binary protocol: concatenated `[header][pixels][header][pixels]...`
/// where each header is 8 bytes `[x:u16LE, y:u16LE, w:u16LE, h:u16LE]`.
/// JS walks the buffer with an offset, parsing rects until exhausted.
///
/// This reduces IPC overhead dramatically -- one `Channel.send()` and one
/// `ArrayBuffer` allocation instead of N.
#[inline]
pub(crate) fn push_multi_rect_via_channel(
    image_data: &[u8],
    fb_width: u16,
    rects: &[(u16, u16, u16, u16)],
    frame_channel: &Channel<InvokeResponseBody>,
) {
    if rects.is_empty() {
        return;
    }

    let bpp = 4usize;
    let stride = fb_width as usize * bpp;

    // Pre-calculate total size for a single allocation.
    let total: usize = rects
        .iter()
        .filter(|&&(_, _, w, h)| w > 0 && h > 0)
        .map(|&(_, _, w, h)| 8 + w as usize * h as usize * bpp)
        .sum();
    if total == 0 {
        return;
    }

    let mut payload = Vec::with_capacity(total);
    for &(x, y, w, h) in rects {
        if w == 0 || h == 0 {
            continue;
        }
        let left = x as usize;
        let top = y as usize;
        let rw = w as usize;
        let rh = h as usize;
        let bottom = top + rh - 1;
        let row_bytes = rw * bpp;

        // 8-byte header
        let header: [u8; 8] = {
            let mut hdr = [0u8; 8];
            hdr[0..2].copy_from_slice(&x.to_le_bytes());
            hdr[2..4].copy_from_slice(&y.to_le_bytes());
            hdr[4..6].copy_from_slice(&w.to_le_bytes());
            hdr[6..8].copy_from_slice(&h.to_le_bytes());
            hdr
        };
        payload.extend_from_slice(&header);

        // Pixel data
        let last_row_end = bottom * stride + left * bpp + row_bytes;
        if last_row_end <= image_data.len() {
            if left == 0 && rw == fb_width as usize {
                let start = top * stride;
                let end = (bottom + 1) * stride;
                payload.extend_from_slice(&image_data[start..end]);
            } else {
                for row in top..=bottom {
                    let row_start = row * stride + left * bpp;
                    payload.extend_from_slice(&image_data[row_start..row_start + row_bytes]);
                }
            }
        } else {
            for row in top..=bottom {
                let row_start = row * stride + left * bpp;
                let row_end = row_start + row_bytes;
                if row_end <= image_data.len() {
                    payload.extend_from_slice(&image_data[row_start..row_end]);
                }
            }
        }
    }

    let _ = frame_channel.send(InvokeResponseBody::Raw(payload));
}

/// Push a dirty region's pixel data directly through the Tauri Channel.
///
/// Binary protocol: 8-byte header [x:u16LE, y:u16LE, w:u16LE, h:u16LE]
/// followed by w*h*4 raw RGBA bytes.  The JS side receives this as a
/// single ArrayBuffer -- zero JSON, zero base64, zero invoke round-trips.
#[inline]
pub(crate) fn push_frame_via_channel(
    image_data: &[u8],
    fb_width: u16,
    region: &ironrdp::pdu::geometry::InclusiveRectangle,
    frame_channel: &Channel<InvokeResponseBody>,
) {
    let bpp = 4usize;
    let stride = fb_width as usize * bpp;
    let left = region.left as usize;
    let top = region.top as usize;
    let right = region.right as usize;
    let bottom = region.bottom as usize;
    let rw = right.saturating_sub(left) + 1;
    let rh = bottom.saturating_sub(top) + 1;

    let row_bytes = rw * bpp;
    let total = 8 + rw * rh * bpp;
    let mut payload = Vec::with_capacity(total);

    // 8-byte header as a single write
    let header: [u8; 8] = {
        let mut h = [0u8; 8];
        h[0..2].copy_from_slice(&region.left.to_le_bytes());
        h[2..4].copy_from_slice(&region.top.to_le_bytes());
        h[4..6].copy_from_slice(&(rw as u16).to_le_bytes());
        h[6..8].copy_from_slice(&(rh as u16).to_le_bytes());
        h
    };
    payload.extend_from_slice(&header);

    // RGBA pixel data from the framebuffer.
    let last_row_end = bottom * stride + left * bpp + row_bytes;
    if last_row_end <= image_data.len() {
        if left == 0 && rw == fb_width as usize {
            // Full-width region -- rows are contiguous in memory.
            // Single memcpy instead of one per row (e.g. 1 call vs 1080).
            let start = top * stride;
            let end = (bottom + 1) * stride;
            payload.extend_from_slice(&image_data[start..end]);
        } else {
            // Partial-width -- must copy row by row.
            for row in top..=bottom {
                let row_start = row * stride + left * bpp;
                payload.extend_from_slice(&image_data[row_start..row_start + row_bytes]);
            }
        }
    } else {
        for row in top..=bottom {
            let row_start = row * stride + left * bpp;
            let row_end = row_start + row_bytes;
            if row_end <= image_data.len() {
                payload.extend_from_slice(&image_data[row_start..row_end]);
            }
        }
    }

    let _ = frame_channel.send(InvokeResponseBody::Raw(payload));
}

/// Push a composed frame from the compositor through the Channel.
/// Uses the same binary protocol as `push_frame_via_channel`.
#[inline]
pub(crate) fn push_compositor_frame_via_channel(
    frame: native_renderer::CompositorFrame,
    frame_channel: &Channel<InvokeResponseBody>,
) {
    // The compositor's flush() pre-reserves 8 leading bytes (zeroed) in
    // frame.rgba.  Write the header in-place -- zero extra allocation,
    // zero extra memcpy.
    let mut payload = frame.rgba;
    debug_assert!(payload.len() >= 8, "CompositorFrame rgba too short for header");
    payload[0..2].copy_from_slice(&frame.x.to_le_bytes());
    payload[2..4].copy_from_slice(&frame.y.to_le_bytes());
    payload[4..6].copy_from_slice(&frame.width.to_le_bytes());
    payload[6..8].copy_from_slice(&frame.height.to_le_bytes());

    let _ = frame_channel.send(InvokeResponseBody::Raw(payload));
}

/// Push the entire desktop as a single full-frame through the channel
/// and update the SharedFrameStore (for the rdp_get_frame_data fallback).
pub(crate) fn send_full_frame_via_channel(
    session_id: &str,
    image: &DecodedImage,
    width: u16,
    height: u16,
    frame_channel: &Channel<InvokeResponseBody>,
    frame_store: &SharedFrameStore,
) {
    let region = ironrdp::pdu::geometry::InclusiveRectangle {
        left: 0,
        top: 0,
        right: width.saturating_sub(1),
        bottom: height.saturating_sub(1),
    };
    // Update fallback store (periodic, not on hot path)
    frame_store.update_region(session_id, image.data(), width, &region);
    // Push full frame through channel
    push_frame_via_channel(image.data(), width, &region, frame_channel);
}

/// Legacy: extract a rectangular region as a contiguous RGBA byte vec.
/// Used only by the `rdp_get_frame_data` fallback command.
#[allow(dead_code)]
pub(crate) fn extract_region_rgba(
    framebuffer: &[u8],
    fb_width: u16,
    region: &ironrdp::pdu::geometry::InclusiveRectangle,
) -> Vec<u8> {
    let bytes_per_pixel = 4usize;
    let stride = fb_width as usize * bytes_per_pixel;
    let left = region.left as usize;
    let top = region.top as usize;
    let right = region.right as usize;
    let bottom = region.bottom as usize;
    let region_w = right.saturating_sub(left) + 1;
    let region_h = bottom.saturating_sub(top) + 1;

    let mut rgba = Vec::with_capacity(region_w * region_h * bytes_per_pixel);

    for row in top..=bottom {
        let row_start = row * stride + left * bytes_per_pixel;
        let row_end = row_start + region_w * bytes_per_pixel;
        if row_end > framebuffer.len() {
            break;
        }
        rgba.extend_from_slice(&framebuffer[row_start..row_end]);
    }

    rgba
}

pub(crate) fn set_read_timeout_on_framed(
    framed: &Framed<native_tls::TlsStream<TcpStream>>,
    timeout: Option<Duration>,
) {
    let (tls_stream, _) = framed.get_inner();
    let tcp = tls_stream.get_ref();
    let _ = tcp.set_read_timeout(timeout);
}

pub(crate) fn is_timeout_error(e: &io::Error) -> bool {
    matches!(
        e.kind(),
        io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut
    )
}
