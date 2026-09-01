use std::io;
use std::time::Duration;

use super::frame_channel::{
    send_accounted_frame, DynFrameChannel, FrameDeliveryAccounting, FramePayloadKind,
    MAX_RDP_FRAME_PAYLOAD_BYTES, MAX_RDP_IN_FLIGHT_FRAME_COUNT,
};
use super::types::RdpPointerEvent;
use crate::ironrdp::session::image::DecodedImage;
use crate::ironrdp::session::ActiveStageOutput;
use crate::ironrdp_blocking::Framed;

use super::frame_store::SharedFrameStore;
use super::stats::RdpSessionStats;
use super::RdpTlsStream;
use sorng_core::native_renderer;

use std::sync::atomic::Ordering;

pub const MAX_PENDING_DIRTY_REGIONS: usize = 256;
pub const MAX_PENDING_DIRTY_REGION_METADATA_BYTES: usize =
    MAX_PENDING_DIRTY_REGIONS * std::mem::size_of::<(u16, u16, u16, u16)>();

/// Keep one RGBA tile at or below half of the native/webview byte budget so
/// both delivery credits can be used without exceeding the aggregate cap.
/// The 8-byte rectangle header is included in this limit.
pub const MAX_RDP_RGBA_TILE_PAYLOAD_BYTES: usize = MAX_RDP_FRAME_PAYLOAD_BYTES / 2;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct RgbaTileDeliveryProgress {
    pub sent_tiles: usize,
    pub complete: bool,
}

fn is_full_desktop_region(
    region: (u16, u16, u16, u16),
    desktop_width: u16,
    desktop_height: u16,
) -> bool {
    region == (0, 0, desktop_width, desktop_height)
}

/// Add one dirty rectangle without allowing the metadata backlog to grow.
/// Once the hard count is reached, the current framebuffer becomes the source
/// of truth and the backlog collapses to one full-sync marker. Subsequent
/// updates coalesce into that marker until it is successfully delivered.
pub fn accumulate_dirty_region(
    regions: &mut Vec<(u16, u16, u16, u16)>,
    region: (u16, u16, u16, u16),
    desktop_width: u16,
    desktop_height: u16,
) -> bool {
    let (_, _, width, height) = region;
    if width == 0 || height == 0 || desktop_width == 0 || desktop_height == 0 {
        return false;
    }
    if regions.len() == 1 && is_full_desktop_region(regions[0], desktop_width, desktop_height) {
        return true;
    }
    if is_full_desktop_region(region, desktop_width, desktop_height) {
        regions.clear();
        regions.push(region);
        return true;
    }
    if regions.len() >= MAX_PENDING_DIRTY_REGIONS {
        regions.clear();
        regions.push((0, 0, desktop_width, desktop_height));
        return true;
    }
    regions.push(region);
    false
}

pub fn checked_rect_payload_bytes(width: u16, height: u16) -> Option<usize> {
    (width as usize)
        .checked_mul(height as usize)?
        .checked_mul(4)?
        .checked_add(8)
}

/// Return the framebuffer-clamped bounding rectangle for a set of dirty
/// regions. This is the exact rectangle a compositor flush would allocate.
pub fn bounding_dirty_region(
    rects: &[(u16, u16, u16, u16)],
    desktop_width: u16,
    desktop_height: u16,
) -> Option<(u16, u16, u16, u16)> {
    if desktop_width == 0 || desktop_height == 0 {
        return None;
    }

    let mut left = u32::from(desktop_width);
    let mut top = u32::from(desktop_height);
    let mut right = 0u32;
    let mut bottom = 0u32;
    let mut found = false;

    for &(x, y, width, height) in rects {
        let x = u32::from(x);
        let y = u32::from(y);
        if width == 0
            || height == 0
            || x >= u32::from(desktop_width)
            || y >= u32::from(desktop_height)
        {
            continue;
        }
        let rect_right = x
            .saturating_add(u32::from(width))
            .min(u32::from(desktop_width));
        let rect_bottom = y
            .saturating_add(u32::from(height))
            .min(u32::from(desktop_height));
        if rect_right <= x || rect_bottom <= y {
            continue;
        }
        left = left.min(x);
        top = top.min(y);
        right = right.max(rect_right);
        bottom = bottom.max(rect_bottom);
        found = true;
    }

    found.then_some((
        left as u16,
        top as u16,
        (right - left) as u16,
        (bottom - top) as u16,
    ))
}

fn clamp_rgba_region(
    region: (u16, u16, u16, u16),
    fb_width: u16,
    fb_height: u16,
    image_data_len: usize,
) -> Option<(u16, u16, u16, u16)> {
    if fb_width == 0 || fb_height == 0 {
        return None;
    }
    let stride = usize::from(fb_width).checked_mul(4)?;
    let available_rows = (image_data_len / stride).min(usize::from(fb_height));
    let (x, y, width, height) = region;
    let x_usize = usize::from(x);
    let y_usize = usize::from(y);
    if width == 0 || height == 0 || x_usize >= usize::from(fb_width) || y_usize >= available_rows {
        return None;
    }
    let width = usize::from(width).min(usize::from(fb_width) - x_usize);
    let height = usize::from(height).min(available_rows - y_usize);
    if width == 0 || height == 0 {
        return None;
    }
    Some((x, y, width as u16, height as u16))
}

fn build_rgba_tile_payload(
    image_data: &[u8],
    fb_width: u16,
    region: (u16, u16, u16, u16),
) -> Result<Vec<u8>, String> {
    let (x, y, width, height) = region;
    let total = checked_rect_payload_bytes(width, height)
        .ok_or_else(|| "RDP tile payload size overflow".to_string())?;
    if total > MAX_RDP_RGBA_TILE_PAYLOAD_BYTES {
        return Err(format!(
            "RDP tile payload is {total} bytes (maximum {MAX_RDP_RGBA_TILE_PAYLOAD_BYTES})"
        ));
    }

    let stride = usize::from(fb_width)
        .checked_mul(4)
        .ok_or_else(|| "RDP framebuffer stride overflow".to_string())?;
    let row_bytes = usize::from(width)
        .checked_mul(4)
        .ok_or_else(|| "RDP tile row size overflow".to_string())?;
    let mut payload = Vec::with_capacity(total);
    payload.extend_from_slice(&x.to_le_bytes());
    payload.extend_from_slice(&y.to_le_bytes());
    payload.extend_from_slice(&width.to_le_bytes());
    payload.extend_from_slice(&height.to_le_bytes());

    if x == 0 && width == fb_width {
        let start = usize::from(y) * stride;
        let end = start + usize::from(height) * stride;
        payload.extend_from_slice(&image_data[start..end]);
    } else {
        for row in usize::from(y)..usize::from(y) + usize::from(height) {
            let start = row * stride + usize::from(x) * 4;
            payload.extend_from_slice(&image_data[start..start + row_bytes]);
        }
    }
    debug_assert_eq!(payload.len(), total);
    Ok(payload)
}

/// Deliver pending RGBA rectangles as framebuffer-clamped horizontal tiles.
///
/// The queue is mutated only after a successful send. A partially delivered
/// rectangle becomes its unsent tail in-place, so even a 65K-high desktop
/// retains constant-size metadata rather than materializing every tile. At
/// most the transport's two in-flight messages are produced per call.
pub fn push_tiled_rects_via_channel(
    image_data: &[u8],
    fb_width: u16,
    fb_height: u16,
    pending_rects: &mut Vec<(u16, u16, u16, u16)>,
    frame_channel: &DynFrameChannel,
    payload_kind: FramePayloadKind,
    accounting: &FrameDeliveryAccounting,
) -> Result<RgbaTileDeliveryProgress, String> {
    let mut sent_tiles = 0usize;

    while !pending_rects.is_empty() && sent_tiles < MAX_RDP_IN_FLIGHT_FRAME_COUNT {
        let Some((x, y, width, height)) =
            clamp_rgba_region(pending_rects[0], fb_width, fb_height, image_data.len())
        else {
            pending_rects.remove(0);
            continue;
        };
        pending_rects[0] = (x, y, width, height);

        let row_bytes = usize::from(width)
            .checked_mul(4)
            .ok_or_else(|| "RDP tile row size overflow".to_string())?;
        let max_pixel_bytes = MAX_RDP_RGBA_TILE_PAYLOAD_BYTES
            .checked_sub(8)
            .ok_or_else(|| "RDP tile budget is smaller than its header".to_string())?;
        let max_rows = max_pixel_bytes / row_bytes;
        if max_rows == 0 {
            return Err(format!(
                "RDP framebuffer row is {row_bytes} bytes and cannot fit the tile budget"
            ));
        }
        let tile_height = usize::from(height).min(max_rows) as u16;
        let tile_bytes = checked_rect_payload_bytes(width, tile_height)
            .ok_or_else(|| "RDP tile payload size overflow".to_string())?;

        // Capacity is checked before allocating or copying any pixel data.
        if !frame_channel.can_send_payload(tile_bytes) {
            return Ok(RgbaTileDeliveryProgress {
                sent_tiles,
                complete: false,
            });
        }

        let payload = build_rgba_tile_payload(image_data, fb_width, (x, y, width, tile_height))?;
        send_accounted_frame(accounting, frame_channel, payload_kind, payload)?;
        sent_tiles += 1;

        if tile_height == height {
            pending_rects.remove(0);
        } else {
            pending_rects[0] = (
                x,
                y.checked_add(tile_height)
                    .ok_or_else(|| "RDP tile coordinate overflow".to_string())?,
                width,
                height - tile_height,
            );
        }
    }

    Ok(RgbaTileDeliveryProgress {
        sent_tiles,
        complete: pending_rects.is_empty(),
    })
}

/// Deliver a local RGBA surface (such as a decoded RDPGFX frame) as
/// destination-positioned horizontal tiles while retaining only a row cursor.
#[expect(
    clippy::too_many_arguments,
    reason = "the hot-path boundary keeps the RGBA surface, destination, resume cursor, transport, and accounting explicit"
)]
pub fn push_tiled_local_rgba_via_channel(
    rgba: &[u8],
    width: u16,
    height: u16,
    screen_x: u16,
    screen_y: u16,
    next_row: &mut u16,
    frame_channel: &DynFrameChannel,
    accounting: &FrameDeliveryAccounting,
) -> Result<RgbaTileDeliveryProgress, String> {
    if width == 0 || height == 0 || *next_row >= height {
        return Ok(RgbaTileDeliveryProgress {
            sent_tiles: 0,
            complete: true,
        });
    }
    let stride = usize::from(width)
        .checked_mul(4)
        .ok_or_else(|| "RDPGFX RGBA stride overflow".to_string())?;
    let expected_len = stride
        .checked_mul(usize::from(height))
        .ok_or_else(|| "RDPGFX RGBA frame size overflow".to_string())?;
    if rgba.len() < expected_len {
        return Err(format!(
            "RDPGFX RGBA frame is truncated ({} bytes, expected {expected_len})",
            rgba.len()
        ));
    }
    let max_rows = (MAX_RDP_RGBA_TILE_PAYLOAD_BYTES - 8) / stride;
    if max_rows == 0 {
        return Err(format!(
            "RDPGFX RGBA row is {stride} bytes and cannot fit the tile budget"
        ));
    }

    let mut sent_tiles = 0usize;
    while *next_row < height && sent_tiles < MAX_RDP_IN_FLIGHT_FRAME_COUNT {
        let remaining_rows = usize::from(height - *next_row);
        let tile_height = remaining_rows.min(max_rows) as u16;
        let tile_bytes = checked_rect_payload_bytes(width, tile_height)
            .ok_or_else(|| "RDPGFX tile payload size overflow".to_string())?;
        if !frame_channel.can_send_payload(tile_bytes) {
            break;
        }

        let destination_y = screen_y
            .checked_add(*next_row)
            .ok_or_else(|| "RDPGFX tile destination coordinate overflow".to_string())?;
        let source_start = usize::from(*next_row) * stride;
        let source_end = source_start + usize::from(tile_height) * stride;
        let mut payload = Vec::with_capacity(tile_bytes);
        payload.extend_from_slice(&screen_x.to_le_bytes());
        payload.extend_from_slice(&destination_y.to_le_bytes());
        payload.extend_from_slice(&width.to_le_bytes());
        payload.extend_from_slice(&tile_height.to_le_bytes());
        payload.extend_from_slice(&rgba[source_start..source_end]);
        debug_assert_eq!(payload.len(), tile_bytes);
        send_accounted_frame(
            accounting,
            frame_channel,
            FramePayloadKind::RgbaRect,
            payload,
        )?;
        *next_row += tile_height;
        sent_tiles += 1;
    }

    Ok(RgbaTileDeliveryProgress {
        sent_tiles,
        complete: *next_row >= height,
    })
}

pub fn queue_full_desktop_sync(
    pending_rects: &mut Vec<(u16, u16, u16, u16)>,
    width: u16,
    height: u16,
) {
    pending_rects.clear();
    if width > 0 && height > 0 {
        pending_rects.push((0, 0, width, height));
    }
}

pub fn ensure_full_desktop_sync(
    pending_rects: &mut Vec<(u16, u16, u16, u16)>,
    width: u16,
    height: u16,
) {
    if pending_rects.is_empty() {
        queue_full_desktop_sync(pending_rects, width, height);
    }
}

#[allow(dead_code)]
pub fn checked_multi_rect_payload_bytes(rects: &[(u16, u16, u16, u16)]) -> Option<usize> {
    rects
        .iter()
        .filter(|&&(_, _, width, height)| width > 0 && height > 0)
        .try_fold(0usize, |total, &(_, _, width, height)| {
            total.checked_add(checked_rect_payload_bytes(width, height)?)
        })
}

/// Helper to write response frames and emit graphics/pointer events from
/// `process_fastpath_input` outputs.  Returns `Err` only on fatal write errors.
#[allow(clippy::too_many_arguments)]
pub fn process_outputs(
    session_id: &str,
    outputs: &[ActiveStageOutput],
    tls_framed: &mut Framed<RdpTlsStream>,
    image: &DecodedImage,
    desktop_width: u16,
    desktop_height: u16,
    event_emitter: &sorng_core::events::DynEventEmitter,
    stats: &RdpSessionStats,
    full_frame_sync_interval: u64,
    frame_store: &SharedFrameStore,
    frame_channel: &DynFrameChannel,
    accounting: &FrameDeliveryAccounting,
    pending_full_sync: &mut Vec<(u16, u16, u16, u16)>,
    dirty_regions: &mut Vec<(u16, u16, u16, u16)>,
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
                let fc = stats.frame_count.load(Ordering::Relaxed);
                let is_sync = fc > 0 && (fc == 1 || fc.is_multiple_of(full_frame_sync_interval));
                if is_sync {
                    if pending_full_sync.is_empty() {
                        let _ = send_full_frame_via_channel(
                            session_id,
                            image,
                            desktop_width,
                            desktop_height,
                            frame_channel,
                            frame_store,
                            accounting,
                            pending_full_sync,
                        );
                    } else {
                        // Never restart an in-progress full-desktop tile chain
                        // from row zero. Preserve this newer dirty rectangle as
                        // a correction after the chain completes.
                        accumulate_dirty_region(
                            dirty_regions,
                            (
                                region.left,
                                region.top,
                                region.right.saturating_sub(region.left) + 1,
                                region.bottom.saturating_sub(region.top) + 1,
                            ),
                            desktop_width,
                            desktop_height,
                        );
                    }
                } else {
                    accumulate_dirty_region(
                        dirty_regions,
                        (
                            region.left,
                            region.top,
                            region.right.saturating_sub(region.left) + 1,
                            region.bottom.saturating_sub(region.top) + 1,
                        ),
                        desktop_width,
                        desktop_height,
                    );
                }
            }
            ActiveStageOutput::PointerDefault => {
                let _ = event_emitter.emit_event(
                    "rdp://pointer",
                    serde_json::to_value(&RdpPointerEvent {
                        session_id: session_id.to_string(),
                        pointer_type: "default",
                        x: None,
                        y: None,
                        bitmap_rgba: None,
                        bitmap_width: None,
                        bitmap_height: None,
                        hotspot_x: None,
                        hotspot_y: None,
                    })
                    .unwrap_or_default(),
                );
            }
            ActiveStageOutput::PointerHidden => {
                let _ = event_emitter.emit_event(
                    "rdp://pointer",
                    serde_json::to_value(&RdpPointerEvent {
                        session_id: session_id.to_string(),
                        pointer_type: "hidden",
                        x: None,
                        y: None,
                        bitmap_rgba: None,
                        bitmap_width: None,
                        bitmap_height: None,
                        hotspot_x: None,
                        hotspot_y: None,
                    })
                    .unwrap_or_default(),
                );
            }
            ActiveStageOutput::PointerPosition { x, y } => {
                let _ = event_emitter.emit_event(
                    "rdp://pointer",
                    serde_json::to_value(&RdpPointerEvent {
                        session_id: session_id.to_string(),
                        pointer_type: "position",
                        x: Some(*x),
                        y: Some(*y),
                        bitmap_rgba: None,
                        bitmap_width: None,
                        bitmap_height: None,
                        hotspot_x: None,
                        hotspot_y: None,
                    })
                    .unwrap_or_default(),
                );
            }
            ActiveStageOutput::PointerBitmap(bitmap) => {
                let rgba_b64 = base64::Engine::encode(
                    &base64::engine::general_purpose::STANDARD,
                    &bitmap.bitmap_data,
                );
                let _ = event_emitter.emit_event(
                    "rdp://pointer",
                    serde_json::to_value(&RdpPointerEvent {
                        session_id: session_id.to_string(),
                        pointer_type: "bitmap",
                        x: None,
                        y: None,
                        bitmap_rgba: Some(rgba_b64),
                        bitmap_width: Some(bitmap.width),
                        bitmap_height: Some(bitmap.height),
                        hotspot_x: Some(bitmap.hotspot_x),
                        hotspot_y: Some(bitmap.hotspot_y),
                    })
                    .unwrap_or_default(),
                );
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
pub fn merge_dirty_regions(regions: &mut Vec<(u16, u16, u16, u16)>) {
    if regions.len() <= 1 {
        return;
    }

    // Sort by top-left for spatial coherence.
    regions.sort_unstable_by_key(|&(x, y, _, _)| (y, x));

    let mut merged: Vec<(u16, u16, u16, u16)> = Vec::with_capacity(regions.len());
    merged.push(regions[0]);

    for &(rx, ry, rw, rh) in &regions[1..] {
        let last = merged
            .last_mut()
            .expect("merged initialized with first region");
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
#[allow(dead_code)]
pub fn push_multi_rect_via_channel(
    image_data: &[u8],
    fb_width: u16,
    rects: &[(u16, u16, u16, u16)],
    frame_channel: &DynFrameChannel,
    accounting: &FrameDeliveryAccounting,
) -> Result<(), String> {
    if rects.is_empty() {
        return Ok(());
    }

    let bpp = 4usize;
    let stride = fb_width as usize * bpp;

    // Pre-calculate total size for a single allocation.
    let total = checked_multi_rect_payload_bytes(rects)
        .ok_or_else(|| "RDP multi-rectangle payload size overflow".to_string())?;
    if total == 0 {
        return Ok(());
    }
    if total > MAX_RDP_FRAME_PAYLOAD_BYTES {
        return Err(format!(
            "RDP multi-rectangle payload is {total} bytes (maximum {MAX_RDP_FRAME_PAYLOAD_BYTES})"
        ));
    }
    if !frame_channel.can_send_payload(total) {
        let _ = frame_channel.record_delivery_drop(1, false);
        return Err("RDP frame delivery credits exhausted before payload allocation".to_string());
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

    send_accounted_frame(
        accounting,
        frame_channel,
        FramePayloadKind::RgbaRects,
        payload,
    )
}

/// Push a dirty region's pixel data directly through the frame channel.
///
/// Binary protocol: 8-byte header [x:u16LE, y:u16LE, w:u16LE, h:u16LE]
/// followed by w*h*4 raw RGBA bytes.  The JS side receives this as a
/// single ArrayBuffer -- zero JSON, zero base64, zero invoke round-trips.
#[inline]
#[allow(dead_code)]
pub fn push_frame_via_channel(
    image_data: &[u8],
    fb_width: u16,
    region: &crate::ironrdp::pdu::geometry::InclusiveRectangle,
    frame_channel: &DynFrameChannel,
    accounting: &FrameDeliveryAccounting,
) -> Result<(), String> {
    push_frame_payload_via_channel(
        image_data,
        fb_width,
        region,
        frame_channel,
        FramePayloadKind::RgbaRect,
        accounting,
    )
}

#[inline]
#[allow(dead_code)]
fn push_frame_payload_via_channel(
    image_data: &[u8],
    fb_width: u16,
    region: &crate::ironrdp::pdu::geometry::InclusiveRectangle,
    frame_channel: &DynFrameChannel,
    payload_kind: FramePayloadKind,
    accounting: &FrameDeliveryAccounting,
) -> Result<(), String> {
    let bpp = 4usize;
    let stride = fb_width as usize * bpp;
    let left = region.left as usize;
    let top = region.top as usize;
    let right = region.right as usize;
    let bottom = region.bottom as usize;
    let rw = right.saturating_sub(left) + 1;
    let rh = bottom.saturating_sub(top) + 1;

    let row_bytes = rw
        .checked_mul(bpp)
        .ok_or_else(|| "RDP rectangle row size overflow".to_string())?;
    let total = rw
        .checked_mul(rh)
        .and_then(|pixels| pixels.checked_mul(bpp))
        .and_then(|bytes| bytes.checked_add(8))
        .ok_or_else(|| "RDP rectangle payload size overflow".to_string())?;
    if total > MAX_RDP_FRAME_PAYLOAD_BYTES {
        return Err(format!(
            "RDP rectangle payload is {total} bytes (maximum {MAX_RDP_FRAME_PAYLOAD_BYTES})"
        ));
    }
    if !frame_channel.can_send_payload(total) {
        let _ = frame_channel.record_delivery_drop(1, false);
        return Err("RDP frame delivery credits exhausted before payload allocation".to_string());
    }
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

    send_accounted_frame(accounting, frame_channel, payload_kind, payload)
}

/// Push a composed frame from the compositor through the Channel.
/// Uses the same binary protocol as `push_frame_via_channel`.
#[inline]
pub fn push_compositor_frame_via_channel(
    frame: native_renderer::CompositorFrame,
    frame_channel: &DynFrameChannel,
    accounting: &FrameDeliveryAccounting,
) -> Result<(), String> {
    // The compositor's flush() pre-reserves 8 leading bytes (zeroed) in
    // frame.rgba.  Write the header in-place -- zero extra allocation,
    // zero extra memcpy.
    let mut payload = frame.rgba;
    debug_assert!(
        payload.len() >= 8,
        "CompositorFrame rgba too short for header"
    );
    payload[0..2].copy_from_slice(&frame.x.to_le_bytes());
    payload[2..4].copy_from_slice(&frame.y.to_le_bytes());
    payload[4..6].copy_from_slice(&frame.width.to_le_bytes());
    payload[6..8].copy_from_slice(&frame.height.to_le_bytes());

    send_accounted_frame(
        accounting,
        frame_channel,
        FramePayloadKind::Compositor,
        payload,
    )
}

/// NAL header magic prefix — `0x4E414C48` ("NALH" in ASCII).
/// The JS side checks the first 4 bytes of each IPC message: if they match
/// this magic, it's an H.264 NAL passthrough payload; otherwise it's the
/// standard RGBA dirty-rect format.
pub const NAL_MAGIC: u32 = 0x4E41_4C48;

/// Push a raw H.264 NAL unit through the frame channel for frontend WebCodecs decode.
///
/// Binary protocol (16-byte header + NAL data):
/// ```text
/// [magic:u32LE][surface_id:u16LE][screen_x:u16LE][screen_y:u16LE]
/// [dest_w:u16LE][dest_h:u16LE][reserved:u16LE][NAL bytes...]
/// ```
#[inline]
pub fn push_nal_via_channel(
    nal: &crate::gfx::processor::GfxNalFrame,
    frame_channel: &DynFrameChannel,
    accounting: &FrameDeliveryAccounting,
) -> Result<(), String> {
    let hdr_len = 16usize;
    let total = hdr_len
        .checked_add(nal.nal_data.len())
        .ok_or_else(|| "RDP NAL payload size overflow".to_string())?;
    if total > MAX_RDP_FRAME_PAYLOAD_BYTES {
        return Err(format!(
            "RDP NAL payload is {total} bytes (maximum {MAX_RDP_FRAME_PAYLOAD_BYTES})"
        ));
    }
    if !frame_channel.can_send_payload(total) {
        let _ = frame_channel.record_delivery_drop(1, true);
        return Err("RDP frame delivery credits exhausted before NAL allocation".to_string());
    }
    let mut payload = Vec::with_capacity(total);

    // 16-byte header
    payload.extend_from_slice(&NAL_MAGIC.to_le_bytes()); // [0..4]  magic
    payload.extend_from_slice(&nal.surface_id.to_le_bytes()); // [4..6]  surface_id
    payload.extend_from_slice(&nal.screen_x.to_le_bytes()); // [6..8]  screen_x
    payload.extend_from_slice(&nal.screen_y.to_le_bytes()); // [8..10] screen_y
    payload.extend_from_slice(&nal.dest_w.to_le_bytes()); // [10..12] dest_w
    payload.extend_from_slice(&nal.dest_h.to_le_bytes()); // [12..14] dest_h
    payload.extend_from_slice(&0u16.to_le_bytes()); // [14..16] reserved
    payload.extend_from_slice(&nal.nal_data); // [16..]  NAL data

    send_accounted_frame(accounting, frame_channel, FramePayloadKind::Nal, payload)
}

/// Push the entire desktop as a single full-frame through the channel
/// and update the SharedFrameStore (for the rdp_get_frame_data fallback).
#[expect(
    clippy::too_many_arguments,
    reason = "the full-frame boundary keeps source, dimensions, transport, fallback storage, accounting, and resume state explicit"
)]
pub fn send_full_frame_via_channel(
    session_id: &str,
    image: &DecodedImage,
    width: u16,
    height: u16,
    frame_channel: &DynFrameChannel,
    frame_store: &SharedFrameStore,
    accounting: &FrameDeliveryAccounting,
    pending_full_sync: &mut Vec<(u16, u16, u16, u16)>,
) -> Result<RgbaTileDeliveryProgress, String> {
    let region = crate::ironrdp::pdu::geometry::InclusiveRectangle {
        left: 0,
        top: 0,
        right: width.saturating_sub(1),
        bottom: height.saturating_sub(1),
    };
    // Update fallback store (periodic, not on hot path)
    frame_store.update_region(session_id, image.data(), width, &region);
    // Queue a constant-size cursor before any payload allocation. The tiler
    // mutates it to the unsent tail as credits are consumed.
    ensure_full_desktop_sync(pending_full_sync, width, height);
    push_tiled_rects_via_channel(
        image.data(),
        width,
        height,
        pending_full_sync,
        frame_channel,
        FramePayloadKind::FullFrame,
        accounting,
    )
}

/// Legacy: extract a rectangular region as a contiguous RGBA byte vec.
/// Used only by the `rdp_get_frame_data` fallback command.
#[allow(dead_code)]
pub fn extract_region_rgba(
    framebuffer: &[u8],
    fb_width: u16,
    region: &crate::ironrdp::pdu::geometry::InclusiveRectangle,
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

pub fn set_read_timeout_on_framed(framed: &Framed<RdpTlsStream>, timeout: Option<Duration>) {
    let (tls_stream, _) = framed.get_inner();
    let tcp = tls_stream.get_ref();
    let _ = tcp.set_read_timeout(timeout);
}

pub fn set_nonblocking_on_framed(framed: &Framed<RdpTlsStream>, nonblocking: bool) {
    let (tls_stream, _) = framed.get_inner();
    let tcp = tls_stream.get_ref();
    let _ = tcp.set_nonblocking(nonblocking);
}

/// Get a reference to the underlying TCP stream for poll registration.
pub fn tcp_stream_ref(framed: &Framed<RdpTlsStream>) -> &std::net::TcpStream {
    let (tls_stream, _) = framed.get_inner();
    tls_stream.get_ref()
}

pub fn is_timeout_error(e: &io::Error) -> bool {
    matches!(
        e.kind(),
        io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rdp::frame_channel::{FrameChannel, NoopFrameChannel};
    use std::sync::atomic::{AtomicUsize, Ordering as AtomicOrdering};
    use std::sync::{Arc, Mutex};

    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    struct RecordedTile {
        x: u16,
        y: u16,
        width: u16,
        height: u16,
        byte_len: usize,
    }

    struct RecordingTileChannel {
        remaining: AtomicUsize,
        tiles: Mutex<Vec<RecordedTile>>,
    }

    impl RecordingTileChannel {
        fn new(remaining: usize) -> Self {
            Self {
                remaining: AtomicUsize::new(remaining),
                tiles: Mutex::new(Vec::new()),
            }
        }

        fn grant(&self, count: usize) {
            self.remaining.store(count, AtomicOrdering::Release);
        }
    }

    impl FrameChannel for RecordingTileChannel {
        fn send_raw(&self, data: Vec<u8>) -> Result<(), String> {
            let previous = self.remaining.fetch_sub(1, AtomicOrdering::AcqRel);
            assert!(previous > 0, "send_raw requires a delivery credit");
            assert!(data.len() >= 8);
            let read_u16 = |offset: usize| u16::from_le_bytes([data[offset], data[offset + 1]]);
            self.tiles
                .lock()
                .expect("tile lock poisoned")
                .push(RecordedTile {
                    x: read_u16(0),
                    y: read_u16(2),
                    width: read_u16(4),
                    height: read_u16(6),
                    byte_len: data.len(),
                });
            Ok(())
        }

        fn can_send_payload(&self, bytes: usize) -> bool {
            bytes <= MAX_RDP_RGBA_TILE_PAYLOAD_BYTES
                && self.remaining.load(AtomicOrdering::Acquire) > 0
        }
    }

    #[test]
    fn dirty_region_burst_collapses_to_one_bounded_full_sync_marker() {
        let mut regions = Vec::with_capacity(MAX_PENDING_DIRTY_REGIONS);
        for index in 0..100_000usize {
            let x = (index % 1900) as u16;
            let y = (index % 1060) as u16;
            accumulate_dirty_region(&mut regions, (x, y, 20, 20), 1920, 1080);
        }

        assert_eq!(regions, vec![(0, 0, 1920, 1080)]);
        assert!(regions.len() <= MAX_PENDING_DIRTY_REGIONS);
        const { assert!(MAX_PENDING_DIRTY_REGION_METADATA_BYTES <= 4 * 1024) };
    }

    #[test]
    fn checked_payload_size_accepts_uhd_and_identifies_oversized_batch() {
        let uhd = checked_multi_rect_payload_bytes(&[(0, 0, 3840, 2160)])
            .expect("UHD payload arithmetic");
        assert!(uhd <= MAX_RDP_FRAME_PAYLOAD_BYTES);

        let oversized = checked_multi_rect_payload_bytes(&[(0, 0, 4096, 2160)])
            .expect("oversized payload arithmetic");
        assert!(oversized > MAX_RDP_FRAME_PAYLOAD_BYTES);
    }

    #[test]
    fn oversized_multi_rect_is_rejected_before_pixel_allocation() {
        let channel: DynFrameChannel = Arc::new(NoopFrameChannel);
        let accounting = FrameDeliveryAccounting::new();

        let error =
            push_multi_rect_via_channel(&[], 4096, &[(0, 0, 4096, 2160)], &channel, &accounting)
                .expect_err("payload must fail before reading the empty framebuffer");

        assert!(error.contains("maximum"));
        assert_eq!(accounting.snapshot().attempted_frames, 0);
    }

    fn assert_full_desktop_tiles(width: u16, height: u16) {
        let image = vec![0x5a; usize::from(width) * usize::from(height) * 4];
        let recorder = Arc::new(RecordingTileChannel::new(usize::MAX));
        let channel: DynFrameChannel = recorder.clone();
        let accounting = FrameDeliveryAccounting::new();
        let mut pending = vec![(0, 0, width, height)];

        for _ in 0..2048 {
            let progress = push_tiled_rects_via_channel(
                &image,
                width,
                height,
                &mut pending,
                &channel,
                FramePayloadKind::FullFrame,
                &accounting,
            )
            .expect("tile delivery");
            assert!(pending.len() <= 1, "the cursor must stay constant-size");
            if progress.complete {
                break;
            }
        }
        assert!(pending.is_empty(), "all desktop rows must make progress");

        let tiles = recorder.tiles.lock().expect("tile lock poisoned");
        assert!(tiles.len() > 1, "oversized desktop must be tiled");
        let mut next_y = 0u16;
        let mut covered_rows = 0usize;
        for tile in tiles.iter() {
            assert_eq!(tile.x, 0);
            assert_eq!(tile.y, next_y);
            assert_eq!(tile.width, width);
            assert!(tile.height > 0);
            assert!(tile.byte_len <= MAX_RDP_RGBA_TILE_PAYLOAD_BYTES);
            assert_eq!(
                tile.byte_len,
                checked_rect_payload_bytes(tile.width, tile.height).expect("tile size")
            );
            next_y = next_y
                .checked_add(tile.height)
                .expect("covered rows fit u16");
            covered_rows += usize::from(tile.height);
        }
        assert_eq!(covered_rows, usize::from(height));
        assert_eq!(next_y, height);
        assert_eq!(accounting.snapshot().delivered_frames, tiles.len() as u64);
    }

    #[test]
    fn full_desktop_tiling_covers_4096_and_larger_without_over_cap_payloads() {
        assert_full_desktop_tiles(4096, 2160);
        assert_full_desktop_tiles(8192, 2160);
    }

    #[test]
    fn decoded_gfx_4096x2160_surface_is_tiled_from_one_retained_buffer() {
        let width = 4096u16;
        let height = 2160u16;
        let screen_x = 17u16;
        let screen_y = 23u16;
        let rgba = vec![0x33; usize::from(width) * usize::from(height) * 4];
        let recorder = Arc::new(RecordingTileChannel::new(usize::MAX));
        let channel: DynFrameChannel = recorder.clone();
        let accounting = FrameDeliveryAccounting::new();
        let mut next_row = 0u16;

        for _ in 0..16 {
            let progress = push_tiled_local_rgba_via_channel(
                &rgba,
                width,
                height,
                screen_x,
                screen_y,
                &mut next_row,
                &channel,
                &accounting,
            )
            .expect("decoded GFX tile delivery");
            if progress.complete {
                break;
            }
        }
        assert_eq!(next_row, height);

        let tiles = recorder.tiles.lock().expect("tile lock poisoned");
        assert!(tiles.len() > 1);
        let mut expected_y = screen_y;
        let mut covered_rows = 0u16;
        for tile in tiles.iter() {
            assert_eq!(tile.x, screen_x);
            assert_eq!(tile.y, expected_y);
            assert_eq!(tile.width, width);
            assert!(tile.byte_len <= MAX_RDP_RGBA_TILE_PAYLOAD_BYTES);
            expected_y += tile.height;
            covered_rows += tile.height;
        }
        assert_eq!(covered_rows, height);
        assert_eq!(expected_y, screen_y + height);
    }

    #[test]
    fn credit_retry_resumes_from_unsent_row_instead_of_restarting() {
        let width = 4096u16;
        let height = 2160u16;
        let image = vec![0u8; usize::from(width) * usize::from(height) * 4];
        let recorder = Arc::new(RecordingTileChannel::new(1));
        let channel: DynFrameChannel = recorder.clone();
        let accounting = FrameDeliveryAccounting::new();
        let mut pending = vec![(0, 0, width, height)];

        let first = push_tiled_rects_via_channel(
            &image,
            width,
            height,
            &mut pending,
            &channel,
            FramePayloadKind::FullFrame,
            &accounting,
        )
        .expect("first tile");
        assert_eq!(first.sent_tiles, 1);
        assert!(!first.complete);
        let first_unsent_y = pending[0].1;
        assert!(first_unsent_y > 0);
        let unsent_tail = pending[0];
        ensure_full_desktop_sync(&mut pending, width, height);
        assert_eq!(
            pending[0], unsent_tail,
            "a repeated same-channel refresh must not restart at row zero"
        );

        for _ in 0..8 {
            recorder.grant(1);
            let progress = push_tiled_rects_via_channel(
                &image,
                width,
                height,
                &mut pending,
                &channel,
                FramePayloadKind::FullFrame,
                &accounting,
            )
            .expect("credit-backed retry");
            if progress.complete {
                break;
            }
        }
        assert!(pending.is_empty());
        let tiles = recorder.tiles.lock().expect("tile lock poisoned");
        assert_eq!(tiles[1].y, first_unsent_y);
        assert_eq!(
            tiles.last().expect("last tile").y + tiles.last().unwrap().height,
            height
        );
    }
}
