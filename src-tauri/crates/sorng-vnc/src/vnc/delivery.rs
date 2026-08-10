//! Bounded, non-blocking delivery state between the RFB actor and renderer.
//!
//! Control notifications are coalesced into a fixed number of typed slots and
//! terminal state has a dedicated out-of-band slot. Framebuffer rectangles are
//! applied to one canonical RGBA buffer, while fixed-size dirty tiles preserve
//! damage until the renderer's existing post-draw update request acknowledges
//! the delivered tile.

use std::sync::{Arc, Mutex as StdMutex};

use super::encoding::DecodedRect;
use super::session::SessionEvent;
use super::types::{
    VncError, VncErrorKind, MAX_VNC_CLIPBOARD_BYTES, MAX_VNC_CURSOR_DIMENSION,
    MAX_VNC_DESKTOP_NAME_BYTES, MAX_VNC_DIMENSION, MAX_VNC_DRAIN_EVENTS, MAX_VNC_EVENT_QUEUE,
    MAX_VNC_FRAMEBUFFER_BYTES, MAX_VNC_RECT_RGBA_BYTES,
};

const RGBA_BYTES_PER_PIXEL: usize = 4;
const DIRTY_TILE_SIZE: usize = 256;
const MAX_DIRTY_TILES: usize = 256;
const MAX_PENDING_CONTROL_ENTRIES: usize = 6;
const MAX_PENDING_CONTROL_BYTES: usize = 2 * 1024 * 1024;
const MAX_CONTROL_TEXT_BYTES: usize = 256 * 1024;
const MAX_TERMINAL_REASON_BYTES: usize = 64 * 1024;
const MAX_CURSOR_RGBA_BYTES: usize =
    MAX_VNC_CURSOR_DIMENSION as usize * MAX_VNC_CURSOR_DIMENSION as usize * RGBA_BYTES_PER_PIXEL;

#[derive(Clone)]
pub(crate) struct VncEventSender {
    shared: Arc<StdMutex<DeliveryState>>,
}

pub(crate) struct VncEventReceiver {
    shared: Arc<StdMutex<DeliveryState>>,
}

/// Resets delivery state if a framebuffer update future fails, times out, or
/// is cancelled before the whole RFB update is committed.
pub(crate) struct FramebufferUpdateGuard<'a> {
    sender: &'a VncEventSender,
    committed: bool,
}

pub struct RefreshRequestReservation {
    shared: Arc<StdMutex<DeliveryState>>,
    incremental: bool,
    forced_epoch: Option<u64>,
    completed: bool,
}

impl std::fmt::Debug for RefreshRequestReservation {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("RefreshRequestReservation")
            .field("incremental", &self.incremental)
            .field("forced_epoch", &self.forced_epoch)
            .finish_non_exhaustive()
    }
}

impl RefreshRequestReservation {
    pub(crate) fn incremental(&self) -> bool {
        self.incremental
    }

    pub(crate) fn commit(mut self) -> Result<(), VncError> {
        if let Some(epoch) = self.forced_epoch {
            let mut delivery = lock_delivery(&self.shared)?;
            let framebuffer = &mut delivery.framebuffer;
            if framebuffer.reserved_refresh_epoch == Some(epoch) {
                framebuffer.reserved_refresh_epoch = None;
            }
            if framebuffer.force_refresh_epoch == epoch {
                framebuffer.force_full_refresh = false;
            }
        }
        self.completed = true;
        Ok(())
    }
}

impl Drop for RefreshRequestReservation {
    fn drop(&mut self) {
        let Some(epoch) = self.forced_epoch else {
            return;
        };
        if self.completed {
            return;
        }
        let Ok(mut delivery) = lock_delivery(&self.shared) else {
            return;
        };
        if delivery.framebuffer.reserved_refresh_epoch == Some(epoch) {
            delivery.framebuffer.reserved_refresh_epoch = None;
        }
    }
}

impl FramebufferUpdateGuard<'_> {
    pub(crate) fn finish(mut self) -> Result<(), VncError> {
        self.sender.finish_framebuffer_update()?;
        self.committed = true;
        Ok(())
    }
}

impl Drop for FramebufferUpdateGuard<'_> {
    fn drop(&mut self) {
        if !self.committed {
            self.sender.abort_framebuffer_update();
        }
    }
}

pub(crate) fn event_delivery() -> (VncEventSender, VncEventReceiver) {
    let shared = Arc::new(StdMutex::new(DeliveryState::default()));
    (
        VncEventSender {
            shared: Arc::clone(&shared),
        },
        VncEventReceiver { shared },
    )
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ControlKind {
    Connected,
    Bell,
    Clipboard,
    Resize,
    StateChanged,
    Cursor,
}

#[derive(Debug)]
struct PendingControl {
    sequence: u64,
    kind: ControlKind,
    bytes: usize,
    occurrences: u64,
    event: SessionEvent,
}

#[derive(Clone, Debug)]
struct InFlightTile {
    tile_index: usize,
    dirty_generation: u64,
    frame: DecodedRect,
}

#[derive(Debug)]
struct PendingFramebufferUpdate {
    width: u16,
    height: u16,
    tiles_x: usize,
    tiles_y: usize,
    tiles: Vec<Option<Vec<u8>>>,
    resized_pixels: Option<Vec<u8>>,
    touched_tiles: Vec<bool>,
    rectangles: u64,
    resized: bool,
}

#[derive(Debug, Default)]
struct DeliveryDiagnostics {
    coalesced_controls: u64,
    coalesced_bells: u64,
    superseded_controls: u64,
    dropped_controls: u64,
    truncated_controls: u64,
    coalesced_updates: u64,
    coalesced_rectangles: u64,
    gap_epochs: u64,
    replayed_unacknowledged_tiles: u64,
}

#[derive(Debug, Default)]
struct FramebufferState {
    width: u16,
    height: u16,
    pixels: Vec<u8>,
    tiles_x: usize,
    tiles_y: usize,
    dirty_generation: Vec<u64>,
    update_in_progress: bool,
    generation: u64,
    updates_since_ack: u64,
    rectangles_since_ack: u64,
    next_tile_cursor: usize,
    in_flight: Option<InFlightTile>,
    force_full_refresh: bool,
    force_refresh_epoch: u64,
    reserved_refresh_epoch: Option<u64>,
    gap_epoch_active: bool,
    delivery_suspended: bool,
}

#[derive(Debug, Default)]
struct DeliveryState {
    next_control_sequence: u64,
    controls: Vec<PendingControl>,
    control_bytes: usize,
    terminal: Option<SessionEvent>,
    terminal_published: bool,
    terminal_delivered: bool,
    prefer_frame_for_single_slot: bool,
    framebuffer: FramebufferState,
    pending_framebuffer: Option<PendingFramebufferUpdate>,
    diagnostics: DeliveryDiagnostics,
}

fn delivery_error(message: impl Into<String>) -> VncError {
    VncError::new(VncErrorKind::Internal, message)
}

fn lock_delivery(
    shared: &StdMutex<DeliveryState>,
) -> Result<std::sync::MutexGuard<'_, DeliveryState>, VncError> {
    shared
        .lock()
        .map_err(|_| delivery_error("VNC delivery state lock is poisoned"))
}

fn checked_framebuffer_len(width: u16, height: u16) -> Result<usize, VncError> {
    if width == 0 || height == 0 || width > MAX_VNC_DIMENSION || height > MAX_VNC_DIMENSION {
        return Err(VncError::protocol("Invalid VNC framebuffer dimensions"));
    }
    (width as usize)
        .checked_mul(height as usize)
        .and_then(|pixels| pixels.checked_mul(RGBA_BYTES_PER_PIXEL))
        .filter(|bytes| *bytes <= MAX_VNC_FRAMEBUFFER_BYTES)
        .ok_or_else(|| VncError::protocol("VNC framebuffer exceeds the 32 MiB safety limit"))
}

fn checked_rect_len(width: u16, height: u16) -> Result<usize, VncError> {
    (width as usize)
        .checked_mul(height as usize)
        .and_then(|pixels| pixels.checked_mul(RGBA_BYTES_PER_PIXEL))
        .filter(|bytes| *bytes <= MAX_VNC_RECT_RGBA_BYTES)
        .ok_or_else(|| VncError::protocol("VNC rectangle exceeds the RGBA safety limit"))
}

fn framebuffer_layout(width: u16, height: u16) -> Result<(usize, usize, usize, usize), VncError> {
    let bytes = checked_framebuffer_len(width, height)?;
    let tiles_x = (width as usize).div_ceil(DIRTY_TILE_SIZE);
    let tiles_y = (height as usize).div_ceil(DIRTY_TILE_SIZE);
    let tile_count = tiles_x
        .checked_mul(tiles_y)
        .filter(|count| *count <= MAX_DIRTY_TILES)
        .ok_or_else(|| VncError::protocol("VNC dirty-tile grid exceeds the safety limit"))?;
    Ok((bytes, tiles_x, tiles_y, tile_count))
}

fn tile_geometry(
    width: u16,
    height: u16,
    tiles_x: usize,
    tile_index: usize,
) -> Result<(usize, usize, usize, usize), VncError> {
    if tiles_x == 0 {
        return Err(delivery_error("VNC dirty-tile grid has no columns"));
    }
    let tile_x = tile_index % tiles_x;
    let tile_y = tile_index / tiles_x;
    let x = tile_x
        .checked_mul(DIRTY_TILE_SIZE)
        .ok_or_else(|| delivery_error("VNC dirty-tile x coordinate overflow"))?;
    let y = tile_y
        .checked_mul(DIRTY_TILE_SIZE)
        .ok_or_else(|| delivery_error("VNC dirty-tile y coordinate overflow"))?;
    if x >= width as usize || y >= height as usize {
        return Err(delivery_error(
            "VNC dirty-tile index lies outside the framebuffer",
        ));
    }
    Ok((
        x,
        y,
        DIRTY_TILE_SIZE.min(width as usize - x),
        DIRTY_TILE_SIZE.min(height as usize - y),
    ))
}

fn copy_canonical_tile(
    framebuffer: &FramebufferState,
    tile_index: usize,
) -> Result<Vec<u8>, VncError> {
    let (x, y, width, height) = tile_geometry(
        framebuffer.width,
        framebuffer.height,
        framebuffer.tiles_x,
        tile_index,
    )?;
    let row_bytes = width * RGBA_BYTES_PER_PIXEL;
    let stride = framebuffer.width as usize * RGBA_BYTES_PER_PIXEL;
    let mut pixels = Vec::with_capacity(row_bytes * height);
    for row in 0..height {
        let start = (y + row) * stride + x * RGBA_BYTES_PER_PIXEL;
        pixels.extend_from_slice(&framebuffer.pixels[start..start + row_bytes]);
    }
    Ok(pixels)
}

fn write_canonical_tile(
    framebuffer: &mut FramebufferState,
    tile_index: usize,
    pixels: &[u8],
) -> Result<(), VncError> {
    let (x, y, width, height) = tile_geometry(
        framebuffer.width,
        framebuffer.height,
        framebuffer.tiles_x,
        tile_index,
    )?;
    let row_bytes = width * RGBA_BYTES_PER_PIXEL;
    if pixels.len() != row_bytes * height {
        return Err(delivery_error(
            "VNC pending tile has an invalid payload length",
        ));
    }
    let stride = framebuffer.width as usize * RGBA_BYTES_PER_PIXEL;
    for row in 0..height {
        let target = (y + row) * stride + x * RGBA_BYTES_PER_PIXEL;
        let source = row * row_bytes;
        framebuffer.pixels[target..target + row_bytes]
            .copy_from_slice(&pixels[source..source + row_bytes]);
    }
    Ok(())
}

fn read_pending_rect(
    framebuffer: &FramebufferState,
    pending: &PendingFramebufferUpdate,
    x: u16,
    y: u16,
    width: u16,
    height: u16,
) -> Result<Vec<u8>, VncError> {
    let payload_bytes = checked_rect_len(width, height)?;
    if let Some(pixels) = pending.resized_pixels.as_ref() {
        let row_bytes = width as usize * RGBA_BYTES_PER_PIXEL;
        let stride = pending.width as usize * RGBA_BYTES_PER_PIXEL;
        let mut copied = Vec::with_capacity(payload_bytes);
        for row in 0..height as usize {
            let start = (y as usize + row) * stride + x as usize * RGBA_BYTES_PER_PIXEL;
            copied.extend_from_slice(&pixels[start..start + row_bytes]);
        }
        return Ok(copied);
    }

    let mut copied = Vec::with_capacity(payload_bytes);
    for row in 0..height as usize {
        let global_y = y as usize + row;
        let tile_y = global_y / DIRTY_TILE_SIZE;
        let local_y = global_y % DIRTY_TILE_SIZE;
        let mut global_x = x as usize;
        let end_x = global_x + width as usize;
        while global_x < end_x {
            let tile_x = global_x / DIRTY_TILE_SIZE;
            let tile_index = tile_y * pending.tiles_x + tile_x;
            let (tile_origin_x, _, tile_width, _) =
                tile_geometry(pending.width, pending.height, pending.tiles_x, tile_index)?;
            let local_x = global_x - tile_origin_x;
            let segment_pixels = (end_x - global_x).min(tile_width - local_x);
            let segment_bytes = segment_pixels * RGBA_BYTES_PER_PIXEL;
            if let Some(tile) = pending.tiles[tile_index].as_ref() {
                let start = (local_y * tile_width + local_x) * RGBA_BYTES_PER_PIXEL;
                copied.extend_from_slice(&tile[start..start + segment_bytes]);
            } else {
                let stride = framebuffer.width as usize * RGBA_BYTES_PER_PIXEL;
                let start = global_y * stride + global_x * RGBA_BYTES_PER_PIXEL;
                copied.extend_from_slice(&framebuffer.pixels[start..start + segment_bytes]);
            }
            global_x += segment_pixels;
        }
    }
    Ok(copied)
}

fn write_pending_rect(
    framebuffer: &FramebufferState,
    pending: &mut PendingFramebufferUpdate,
    x: u16,
    y: u16,
    width: u16,
    height: u16,
    pixels: &[u8],
) -> Result<(), VncError> {
    if let Some(resized_pixels) = pending.resized_pixels.as_mut() {
        let row_bytes = width as usize * RGBA_BYTES_PER_PIXEL;
        let stride = pending.width as usize * RGBA_BYTES_PER_PIXEL;
        for row in 0..height as usize {
            let target = (y as usize + row) * stride + x as usize * RGBA_BYTES_PER_PIXEL;
            let source = row * row_bytes;
            resized_pixels[target..target + row_bytes]
                .copy_from_slice(&pixels[source..source + row_bytes]);
        }
    } else {
        for row in 0..height as usize {
            let global_y = y as usize + row;
            let tile_y = global_y / DIRTY_TILE_SIZE;
            let local_y = global_y % DIRTY_TILE_SIZE;
            let mut global_x = x as usize;
            let end_x = global_x + width as usize;
            while global_x < end_x {
                let tile_x = global_x / DIRTY_TILE_SIZE;
                let tile_index = tile_y * pending.tiles_x + tile_x;
                let (tile_origin_x, _, tile_width, _) =
                    tile_geometry(pending.width, pending.height, pending.tiles_x, tile_index)?;
                if pending.tiles[tile_index].is_none() {
                    pending.tiles[tile_index] = Some(copy_canonical_tile(framebuffer, tile_index)?);
                }
                let local_x = global_x - tile_origin_x;
                let segment_pixels = (end_x - global_x).min(tile_width - local_x);
                let segment_bytes = segment_pixels * RGBA_BYTES_PER_PIXEL;
                let source =
                    (row * width as usize + (global_x - x as usize)) * RGBA_BYTES_PER_PIXEL;
                let target = (local_y * tile_width + local_x) * RGBA_BYTES_PER_PIXEL;
                let tile = pending.tiles[tile_index]
                    .as_mut()
                    .expect("VNC pending tile was initialized above");
                tile[target..target + segment_bytes]
                    .copy_from_slice(&pixels[source..source + segment_bytes]);
                global_x += segment_pixels;
            }
        }
    }

    let first_tile_x = x as usize / DIRTY_TILE_SIZE;
    let last_tile_x = (x as usize + width as usize - 1) / DIRTY_TILE_SIZE;
    let first_tile_y = y as usize / DIRTY_TILE_SIZE;
    let last_tile_y = (y as usize + height as usize - 1) / DIRTY_TILE_SIZE;
    for tile_y in first_tile_y..=last_tile_y {
        for tile_x in first_tile_x..=last_tile_x {
            pending.touched_tiles[tile_y * pending.tiles_x + tile_x] = true;
        }
    }
    Ok(())
}

fn require_full_refresh(framebuffer: &mut FramebufferState) -> Result<(), VncError> {
    framebuffer.force_refresh_epoch = framebuffer
        .force_refresh_epoch
        .checked_add(1)
        .ok_or_else(|| delivery_error("VNC full-refresh epoch overflow"))?;
    framebuffer.force_full_refresh = true;
    Ok(())
}

fn truncate_utf8(value: &mut String, max_bytes: usize) -> bool {
    if value.len() <= max_bytes {
        return false;
    }
    let mut boundary = max_bytes.min(value.len());
    while boundary > 0 && !value.is_char_boundary(boundary) {
        boundary -= 1;
    }
    value.truncate(boundary);
    true
}

fn normalize_control_event(event: &mut SessionEvent) -> Option<(ControlKind, usize, bool)> {
    let mut truncated = false;
    let (kind, bytes) = match event {
        SessionEvent::Connected {
            server_name,
            protocol_version,
            security_type,
            ..
        } => {
            truncated |= truncate_utf8(server_name, MAX_VNC_DESKTOP_NAME_BYTES);
            truncated |= truncate_utf8(protocol_version, MAX_CONTROL_TEXT_BYTES);
            truncated |= truncate_utf8(security_type, MAX_CONTROL_TEXT_BYTES);
            (
                ControlKind::Connected,
                server_name
                    .len()
                    .saturating_add(protocol_version.len())
                    .saturating_add(security_type.len()),
            )
        }
        SessionEvent::Bell => (ControlKind::Bell, 0),
        SessionEvent::Clipboard(text) => {
            truncated |= truncate_utf8(text, MAX_VNC_CLIPBOARD_BYTES);
            (ControlKind::Clipboard, text.len())
        }
        SessionEvent::Resize { .. } => (ControlKind::Resize, 0),
        SessionEvent::StateChanged(state) => {
            truncated |= truncate_utf8(&mut state.session_id, MAX_CONTROL_TEXT_BYTES);
            truncated |= truncate_utf8(&mut state.state, MAX_CONTROL_TEXT_BYTES);
            truncated |= truncate_utf8(&mut state.message, MAX_CONTROL_TEXT_BYTES);
            (
                ControlKind::StateChanged,
                state
                    .session_id
                    .len()
                    .saturating_add(state.state.len())
                    .saturating_add(state.message.len()),
            )
        }
        SessionEvent::Cursor {
            pixels,
            width,
            height,
            hotspot_x,
            hotspot_y,
            ..
        } => {
            let expected_bytes = (*width as usize)
                .checked_mul(*height as usize)
                .and_then(|pixels| pixels.checked_mul(RGBA_BYTES_PER_PIXEL));
            if *width == 0
                || *height == 0
                || *width > MAX_VNC_CURSOR_DIMENSION
                || *height > MAX_VNC_CURSOR_DIMENSION
                || *hotspot_x >= *width
                || *hotspot_y >= *height
                || expected_bytes != Some(pixels.len())
                || pixels.len() > MAX_CURSOR_RGBA_BYTES
            {
                return None;
            }
            (ControlKind::Cursor, pixels.len())
        }
        SessionEvent::Frame(_) | SessionEvent::Disconnected(_) => {
            unreachable!("frame and terminal events are handled by dedicated delivery paths")
        }
    };
    Some((kind, bytes, truncated))
}

fn normalize_terminal(mut event: SessionEvent) -> (SessionEvent, bool) {
    let mut truncated = false;
    if let SessionEvent::Disconnected(Some(reason)) = &mut event {
        truncated = truncate_utf8(reason, MAX_TERMINAL_REASON_BYTES);
    }
    (event, truncated)
}

impl VncEventSender {
    pub(crate) fn initialize_framebuffer(&self, width: u16, height: u16) -> Result<(), VncError> {
        let (bytes, tiles_x, tiles_y, tile_count) = framebuffer_layout(width, height)?;
        let pixels = vec![0; bytes];
        let mut delivery = lock_delivery(&self.shared)?;
        delivery.framebuffer = FramebufferState {
            width,
            height,
            pixels,
            tiles_x,
            tiles_y,
            dirty_generation: vec![0; tile_count],
            ..FramebufferState::default()
        };
        delivery.pending_framebuffer = None;
        Ok(())
    }

    pub(crate) fn resize_framebuffer(&self, width: u16, height: u16) -> Result<(), VncError> {
        let (bytes, tiles_x, tiles_y, tile_count) = framebuffer_layout(width, height)?;
        let pixels = vec![0; bytes];
        let mut delivery = lock_delivery(&self.shared)?;
        if delivery.framebuffer.update_in_progress {
            let pending = delivery
                .pending_framebuffer
                .as_mut()
                .ok_or_else(|| delivery_error("VNC framebuffer transaction is missing"))?;
            pending.width = width;
            pending.height = height;
            pending.tiles_x = tiles_x;
            pending.tiles_y = tiles_y;
            pending.tiles = (0..tile_count).map(|_| None).collect();
            pending.resized_pixels = Some(pixels);
            pending.touched_tiles = vec![false; tile_count];
            pending.rectangles = 0;
            pending.resized = true;
            return Ok(());
        }
        if delivery.framebuffer.delivery_suspended {
            return Err(delivery_error(
                "VNC framebuffer delivery is suspended after an aborted update",
            ));
        }
        let mut framebuffer = FramebufferState {
            width,
            height,
            pixels,
            tiles_x,
            tiles_y,
            dirty_generation: vec![0; tile_count],
            generation: delivery.framebuffer.generation,
            force_refresh_epoch: delivery.framebuffer.force_refresh_epoch,
            reserved_refresh_epoch: delivery.framebuffer.reserved_refresh_epoch,
            gap_epoch_active: true,
            ..FramebufferState::default()
        };
        require_full_refresh(&mut framebuffer)?;
        delivery.framebuffer = framebuffer;
        Ok(())
    }

    pub(crate) fn begin_framebuffer_update(&self) -> Result<(), VncError> {
        let mut delivery = lock_delivery(&self.shared)?;
        let framebuffer = &mut delivery.framebuffer;
        if framebuffer.delivery_suspended {
            return Err(delivery_error(
                "VNC framebuffer delivery is suspended after an aborted update",
            ));
        }
        if framebuffer.update_in_progress {
            return Err(delivery_error("Nested VNC framebuffer update"));
        }
        framebuffer.update_in_progress = true;
        let tile_count = framebuffer.dirty_generation.len();
        delivery.pending_framebuffer = Some(PendingFramebufferUpdate {
            width: framebuffer.width,
            height: framebuffer.height,
            tiles_x: framebuffer.tiles_x,
            tiles_y: framebuffer.tiles_y,
            tiles: (0..tile_count).map(|_| None).collect(),
            resized_pixels: None,
            touched_tiles: vec![false; tile_count],
            rectangles: 0,
            resized: false,
        });
        Ok(())
    }

    pub(crate) fn framebuffer_update(&self) -> Result<FramebufferUpdateGuard<'_>, VncError> {
        self.begin_framebuffer_update()?;
        Ok(FramebufferUpdateGuard {
            sender: self,
            committed: false,
        })
    }

    fn abort_framebuffer_update(&self) {
        let Ok(mut delivery) = lock_delivery(&self.shared) else {
            return;
        };
        delivery.pending_framebuffer = None;
        delivery.framebuffer.update_in_progress = false;
        delivery.framebuffer.delivery_suspended = true;
    }

    pub(crate) fn apply_frame(&self, rect: DecodedRect) -> Result<(), VncError> {
        let mut delivery = lock_delivery(&self.shared)?;
        if !delivery.framebuffer.update_in_progress {
            return Err(delivery_error(
                "VNC rectangle published outside a framebuffer update",
            ));
        }
        if rect.width == 0 || rect.height == 0 {
            return Err(VncError::protocol("VNC rectangle has zero dimensions"));
        }
        let pending = delivery
            .pending_framebuffer
            .as_ref()
            .ok_or_else(|| delivery_error("VNC framebuffer transaction is missing"))?;
        let target_right = u32::from(rect.x) + u32::from(rect.width);
        let target_bottom = u32::from(rect.y) + u32::from(rect.height);
        if target_right > u32::from(pending.width) || target_bottom > u32::from(pending.height) {
            return Err(VncError::protocol(
                "VNC rectangle lies outside the pending framebuffer",
            ));
        }
        let rect_bytes = checked_rect_len(rect.width, rect.height)?;
        let copied;
        let pixels = match (rect.source_x, rect.source_y) {
            (Some(source_x), Some(source_y)) => {
                let source_right = u32::from(source_x) + u32::from(rect.width);
                let source_bottom = u32::from(source_y) + u32::from(rect.height);
                if source_right > u32::from(pending.width)
                    || source_bottom > u32::from(pending.height)
                {
                    return Err(VncError::protocol(
                        "VNC CopyRect source lies outside the pending framebuffer",
                    ));
                }
                copied = read_pending_rect(
                    &delivery.framebuffer,
                    pending,
                    source_x,
                    source_y,
                    rect.width,
                    rect.height,
                )?;
                copied.as_slice()
            }
            (None, None) => {
                if rect.pixels.len() != rect_bytes {
                    return Err(VncError::protocol(
                        "Decoded VNC rectangle has an invalid RGBA payload length",
                    ));
                }
                rect.pixels.as_slice()
            }
            _ => {
                return Err(VncError::protocol(
                    "VNC CopyRect requires both source coordinates",
                ));
            }
        };
        let DeliveryState {
            framebuffer,
            pending_framebuffer,
            ..
        } = &mut *delivery;
        let pending = pending_framebuffer
            .as_mut()
            .ok_or_else(|| delivery_error("VNC framebuffer transaction is missing"))?;
        write_pending_rect(
            framebuffer,
            pending,
            rect.x,
            rect.y,
            rect.width,
            rect.height,
            pixels,
        )?;
        pending.rectangles = pending
            .rectangles
            .checked_add(1)
            .ok_or_else(|| delivery_error("VNC rectangle delivery counter overflow"))?;
        Ok(())
    }

    pub(crate) fn finish_framebuffer_update(&self) -> Result<(), VncError> {
        let mut delivery = lock_delivery(&self.shared)?;
        if !delivery.framebuffer.update_in_progress {
            return Err(delivery_error("VNC framebuffer update was not started"));
        }
        let mut pending = delivery
            .pending_framebuffer
            .take()
            .ok_or_else(|| delivery_error("VNC framebuffer transaction is missing"))?;
        let next_generation = if pending.rectangles == 0 {
            delivery.framebuffer.generation
        } else {
            delivery
                .framebuffer
                .generation
                .checked_add(1)
                .ok_or_else(|| delivery_error("VNC framebuffer generation overflow"))?
        };

        if pending.resized {
            let pixels = pending
                .resized_pixels
                .take()
                .ok_or_else(|| delivery_error("VNC resized framebuffer payload is missing"))?;
            let mut framebuffer = FramebufferState {
                width: pending.width,
                height: pending.height,
                pixels,
                tiles_x: pending.tiles_x,
                tiles_y: pending.tiles_y,
                dirty_generation: vec![0; pending.touched_tiles.len()],
                generation: delivery.framebuffer.generation,
                force_refresh_epoch: delivery.framebuffer.force_refresh_epoch,
                reserved_refresh_epoch: delivery.framebuffer.reserved_refresh_epoch,
                gap_epoch_active: true,
                ..FramebufferState::default()
            };
            require_full_refresh(&mut framebuffer)?;
            delivery.framebuffer = framebuffer;
        } else {
            for (tile_index, tile) in pending.tiles.iter().enumerate() {
                if let Some(pixels) = tile {
                    write_canonical_tile(&mut delivery.framebuffer, tile_index, pixels)?;
                }
            }
        }

        let framebuffer = &mut delivery.framebuffer;
        framebuffer.update_in_progress = false;
        if pending.rectangles > 0 {
            framebuffer.generation = next_generation;
            for (tile, touched) in framebuffer
                .dirty_generation
                .iter_mut()
                .zip(pending.touched_tiles.iter())
            {
                if *touched {
                    *tile = next_generation;
                }
            }
            framebuffer.updates_since_ack = framebuffer.updates_since_ack.saturating_add(1);
            framebuffer.rectangles_since_ack = framebuffer
                .rectangles_since_ack
                .saturating_add(pending.rectangles);
        }
        Ok(())
    }

    pub(crate) fn publish_control(&self, mut event: SessionEvent) -> Result<(), VncError> {
        if matches!(event, SessionEvent::Frame(_)) {
            return Err(delivery_error(
                "Framebuffer events must use the VNC dirty-tile path",
            ));
        }
        if matches!(event, SessionEvent::Disconnected(_)) {
            let (event, truncated) = normalize_terminal(event);
            let mut delivery = lock_delivery(&self.shared)?;
            if truncated {
                delivery.diagnostics.truncated_controls =
                    delivery.diagnostics.truncated_controls.saturating_add(1);
            }
            if delivery.terminal_published {
                if matches!(
                    delivery.terminal.as_ref(),
                    Some(SessionEvent::Disconnected(None))
                ) && matches!(event, SessionEvent::Disconnected(Some(_)))
                {
                    delivery.terminal = Some(event);
                }
                return Ok(());
            }
            delivery.terminal_published = true;
            delivery.terminal = Some(event);
            let superseded = delivery
                .controls
                .iter()
                .map(|pending| pending.occurrences)
                .fold(0u64, u64::saturating_add);
            delivery.diagnostics.superseded_controls = delivery
                .diagnostics
                .superseded_controls
                .saturating_add(superseded);
            delivery.controls.clear();
            delivery.control_bytes = 0;
            delivery.framebuffer.in_flight = None;
            return Ok(());
        }

        let Some((kind, bytes, truncated)) = normalize_control_event(&mut event) else {
            let mut delivery = lock_delivery(&self.shared)?;
            delivery.diagnostics.dropped_controls =
                delivery.diagnostics.dropped_controls.saturating_add(1);
            return Ok(());
        };
        if bytes > MAX_PENDING_CONTROL_BYTES {
            let mut delivery = lock_delivery(&self.shared)?;
            delivery.diagnostics.dropped_controls =
                delivery.diagnostics.dropped_controls.saturating_add(1);
            return Ok(());
        }
        let mut delivery = lock_delivery(&self.shared)?;
        if delivery.terminal_published {
            delivery.diagnostics.superseded_controls =
                delivery.diagnostics.superseded_controls.saturating_add(1);
            return Ok(());
        }
        if truncated {
            delivery.diagnostics.truncated_controls =
                delivery.diagnostics.truncated_controls.saturating_add(1);
        }
        delivery.next_control_sequence = delivery
            .next_control_sequence
            .checked_add(1)
            .ok_or_else(|| delivery_error("VNC control sequence overflow"))?;
        let sequence = delivery.next_control_sequence;
        if let Some(index) = delivery
            .controls
            .iter()
            .position(|pending| pending.kind == kind)
        {
            if kind == ControlKind::Bell {
                delivery.controls[index].occurrences =
                    delivery.controls[index].occurrences.saturating_add(1);
                delivery.diagnostics.coalesced_controls =
                    delivery.diagnostics.coalesced_controls.saturating_add(1);
                delivery.diagnostics.coalesced_bells =
                    delivery.diagnostics.coalesced_bells.saturating_add(1);
                return Ok(());
            }
            let previous_bytes = delivery.controls[index].bytes;
            let projected = delivery
                .control_bytes
                .saturating_sub(previous_bytes)
                .saturating_add(bytes);
            if projected > MAX_PENDING_CONTROL_BYTES {
                delivery.diagnostics.dropped_controls =
                    delivery.diagnostics.dropped_controls.saturating_add(1);
                return Ok(());
            }
            delivery.control_bytes = projected;
            delivery.controls[index] = PendingControl {
                sequence,
                kind,
                bytes,
                occurrences: 1,
                event,
            };
            delivery.diagnostics.coalesced_controls =
                delivery.diagnostics.coalesced_controls.saturating_add(1);
            return Ok(());
        }
        if delivery.controls.len() >= MAX_PENDING_CONTROL_ENTRIES
            || delivery.control_bytes.saturating_add(bytes) > MAX_PENDING_CONTROL_BYTES
        {
            delivery.diagnostics.dropped_controls =
                delivery.diagnostics.dropped_controls.saturating_add(1);
            return Ok(());
        }
        delivery.control_bytes = delivery.control_bytes.saturating_add(bytes);
        delivery.controls.push(PendingControl {
            sequence,
            kind,
            bytes,
            occurrences: 1,
            event,
        });
        Ok(())
    }

    /// A renderer-driven post-draw callback acknowledges only the tile returned
    /// by the preceding drain. Native periodic/keepalive writes never call it.
    pub(crate) fn acknowledge_rendered_tile(&self) -> Result<(), VncError> {
        let mut delivery = lock_delivery(&self.shared)?;
        let framebuffer = &mut delivery.framebuffer;
        if framebuffer.delivery_suspended {
            return Err(delivery_error(
                "VNC framebuffer delivery is suspended after an aborted update",
            ));
        }
        if let Some(in_flight) = framebuffer.in_flight.take() {
            if framebuffer
                .dirty_generation
                .get(in_flight.tile_index)
                .copied()
                == Some(in_flight.dirty_generation)
            {
                framebuffer.dirty_generation[in_flight.tile_index] = 0;
            }
        }
        if framebuffer.in_flight.is_none()
            && framebuffer
                .dirty_generation
                .iter()
                .all(|generation| *generation == 0)
        {
            framebuffer.gap_epoch_active = false;
            framebuffer.updates_since_ack = 0;
            framebuffer.rectangles_since_ack = 0;
        }
        Ok(())
    }

    /// Reserve a forced full refresh without clearing it. The reservation must
    /// be committed only after queue admission/socket write succeeds; dropping
    /// it restores eligibility for the same epoch.
    pub(crate) fn reserve_update_request(
        &self,
        requested_incremental: bool,
    ) -> Result<RefreshRequestReservation, VncError> {
        let mut delivery = lock_delivery(&self.shared)?;
        let framebuffer = &mut delivery.framebuffer;
        if framebuffer.delivery_suspended {
            return Err(delivery_error(
                "VNC framebuffer delivery is suspended after an aborted update",
            ));
        }
        let forced_epoch =
            if framebuffer.force_full_refresh && framebuffer.reserved_refresh_epoch.is_none() {
                let epoch = framebuffer.force_refresh_epoch;
                framebuffer.reserved_refresh_epoch = Some(epoch);
                Some(epoch)
            } else {
                None
            };
        Ok(RefreshRequestReservation {
            shared: Arc::clone(&self.shared),
            incremental: requested_incremental && forced_epoch.is_none(),
            forced_epoch,
            completed: false,
        })
    }

    #[cfg(test)]
    fn acknowledge_and_select_incremental(
        &self,
        requested_incremental: bool,
    ) -> Result<bool, VncError> {
        self.acknowledge_rendered_tile()?;
        let reservation = self.reserve_update_request(requested_incremental)?;
        let incremental = reservation.incremental();
        reservation.commit()?;
        Ok(incremental)
    }

    #[cfg(test)]
    fn select_incremental_without_ack(
        &self,
        requested_incremental: bool,
    ) -> Result<bool, VncError> {
        let reservation = self.reserve_update_request(requested_incremental)?;
        let incremental = reservation.incremental();
        reservation.commit()?;
        Ok(incremental)
    }

    #[cfg(test)]
    pub(crate) fn test_framebuffer_dimensions(&self) -> Result<(u16, u16), VncError> {
        let delivery = lock_delivery(&self.shared)?;
        Ok((delivery.framebuffer.width, delivery.framebuffer.height))
    }
}

impl VncEventReceiver {
    pub(crate) fn drain(&mut self, max: usize) -> Result<Vec<SessionEvent>, VncError> {
        let max = max.min(MAX_VNC_DRAIN_EVENTS);
        if max == 0 {
            return Ok(Vec::new());
        }
        let mut delivery = lock_delivery(&self.shared)?;
        if let Some(terminal) = delivery.terminal.take() {
            delivery.terminal_delivered = true;
            return Ok(vec![terminal]);
        }
        if delivery.terminal_delivered {
            return Ok(Vec::new());
        }

        let frame_ready = frame_ready(&delivery.framebuffer);
        let control_limit = if max >= MAX_VNC_EVENT_QUEUE && frame_ready {
            max - 1
        } else if max == 1 && frame_ready && delivery.prefer_frame_for_single_slot {
            0
        } else {
            max
        };
        let mut events = Vec::with_capacity(max.min(MAX_VNC_DRAIN_EVENTS));
        while events.len() < control_limit && !delivery.controls.is_empty() {
            let next_index = delivery
                .controls
                .iter()
                .enumerate()
                .min_by_key(|(_, pending)| pending.sequence)
                .map(|(index, _)| index)
                .expect("non-empty VNC control list has a minimum sequence");
            let pending = delivery.controls.remove(next_index);
            delivery.control_bytes = delivery.control_bytes.saturating_sub(pending.bytes);
            events.push(pending.event);
        }

        let mut emitted_frame = false;
        if events.len() < max && frame_ready {
            if let Some(frame) = take_dirty_tile(&mut delivery)? {
                events.push(SessionEvent::Frame(frame));
                emitted_frame = true;
                delivery.prefer_frame_for_single_slot = false;
            }
        }
        if max == 1 && frame_ready && !emitted_frame && !events.is_empty() {
            delivery.prefer_frame_for_single_slot = true;
        }
        Ok(events)
    }

    pub(crate) fn drain_frame_only(&mut self) -> Result<Option<DecodedRect>, VncError> {
        let mut delivery = lock_delivery(&self.shared)?;
        if delivery.terminal_published || delivery.terminal_delivered {
            return Ok(None);
        }
        take_dirty_tile(&mut delivery)
    }
}

fn frame_ready(framebuffer: &FramebufferState) -> bool {
    if framebuffer.update_in_progress || framebuffer.delivery_suspended {
        return false;
    }
    framebuffer.in_flight.is_some()
        || framebuffer
            .dirty_generation
            .iter()
            .any(|generation| *generation != 0)
}

fn take_dirty_tile(delivery: &mut DeliveryState) -> Result<Option<DecodedRect>, VncError> {
    let DeliveryState {
        framebuffer,
        diagnostics,
        ..
    } = delivery;
    if framebuffer.update_in_progress
        || framebuffer.delivery_suspended
        || framebuffer.width == 0
        || framebuffer.height == 0
    {
        return Ok(None);
    }
    if framebuffer.updates_since_ack > 1 && !framebuffer.gap_epoch_active {
        framebuffer.gap_epoch_active = true;
        require_full_refresh(framebuffer)?;
        diagnostics.gap_epochs = diagnostics.gap_epochs.saturating_add(1);
        diagnostics.coalesced_updates = diagnostics
            .coalesced_updates
            .saturating_add(framebuffer.updates_since_ack.saturating_sub(1));
        diagnostics.coalesced_rectangles = diagnostics
            .coalesced_rectangles
            .saturating_add(framebuffer.rectangles_since_ack.saturating_sub(1));
    }
    if let Some(in_flight) = &framebuffer.in_flight {
        diagnostics.replayed_unacknowledged_tiles =
            diagnostics.replayed_unacknowledged_tiles.saturating_add(1);
        return Ok(Some(in_flight.frame.clone()));
    }
    let tile_count = framebuffer.dirty_generation.len();
    if tile_count == 0 {
        return Ok(None);
    }
    let tile_index = (0..tile_count)
        .map(|offset| (framebuffer.next_tile_cursor + offset) % tile_count)
        .find(|index| framebuffer.dirty_generation[*index] != 0);
    let Some(tile_index) = tile_index else {
        return Ok(None);
    };
    framebuffer.next_tile_cursor = (tile_index + 1) % tile_count;
    let tile_x = tile_index % framebuffer.tiles_x;
    let tile_y = tile_index / framebuffer.tiles_x;
    debug_assert!(tile_y < framebuffer.tiles_y);
    let x = tile_x * DIRTY_TILE_SIZE;
    let y = tile_y * DIRTY_TILE_SIZE;
    let width = DIRTY_TILE_SIZE.min(framebuffer.width as usize - x);
    let height = DIRTY_TILE_SIZE.min(framebuffer.height as usize - y);
    let row_bytes = width * RGBA_BYTES_PER_PIXEL;
    let stride = framebuffer.width as usize * RGBA_BYTES_PER_PIXEL;
    let payload_bytes = width
        .checked_mul(height)
        .and_then(|pixels| pixels.checked_mul(RGBA_BYTES_PER_PIXEL))
        .filter(|bytes| *bytes <= MAX_VNC_RECT_RGBA_BYTES)
        .ok_or_else(|| delivery_error("VNC dirty-tile payload exceeds the safety limit"))?;
    let mut pixels = Vec::with_capacity(payload_bytes);
    for row in 0..height {
        let start = (y + row) * stride + x * RGBA_BYTES_PER_PIXEL;
        pixels.extend_from_slice(&framebuffer.pixels[start..start + row_bytes]);
    }
    let frame = DecodedRect {
        x: x as u16,
        y: y as u16,
        width: width as u16,
        height: height as u16,
        source_x: None,
        source_y: None,
        pixels,
    };
    framebuffer.in_flight = Some(InFlightTile {
        tile_index,
        dirty_generation: framebuffer.dirty_generation[tile_index],
        frame: frame.clone(),
    });
    Ok(Some(frame))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vnc::types::{PixelFormat, VncStateEvent};

    fn pixel_rect(x: u16, value: u8) -> DecodedRect {
        DecodedRect {
            x,
            y: 0,
            width: 1,
            height: 1,
            source_x: None,
            source_y: None,
            pixels: vec![value, value.wrapping_add(1), value.wrapping_add(2), 255],
        }
    }

    fn frame_from(events: Vec<SessionEvent>) -> DecodedRect {
        events
            .into_iter()
            .find_map(|event| match event {
                SessionEvent::Frame(frame) => Some(frame),
                _ => None,
            })
            .expect("expected one dirty-tile frame")
    }

    fn draw_frame(framebuffer: &mut [u8], framebuffer_width: usize, frame: &DecodedRect) {
        let row_bytes = frame.width as usize * RGBA_BYTES_PER_PIXEL;
        let stride = framebuffer_width * RGBA_BYTES_PER_PIXEL;
        for row in 0..frame.height as usize {
            let target =
                (frame.y as usize + row) * stride + frame.x as usize * RGBA_BYTES_PER_PIXEL;
            let source = row * row_bytes;
            framebuffer[target..target + row_bytes]
                .copy_from_slice(&frame.pixels[source..source + row_bytes]);
        }
    }

    fn drain_all_frames(
        sender: &VncEventSender,
        receiver: &mut VncEventReceiver,
        width: usize,
        height: usize,
    ) -> Vec<u8> {
        let mut framebuffer = vec![0; width * height * RGBA_BYTES_PER_PIXEL];
        while let Some(frame) = receiver
            .drain(2)
            .unwrap()
            .into_iter()
            .find_map(|event| match event {
                SessionEvent::Frame(frame) => Some(frame),
                _ => None,
            })
        {
            draw_frame(&mut framebuffer, width, &frame);
            sender.acknowledge_and_select_incremental(true).unwrap();
        }
        framebuffer
    }

    fn publish_connected(sender: &VncEventSender) {
        sender
            .publish_control(SessionEvent::Connected {
                width: 1,
                height: 1,
                pixel_format: PixelFormat::rgba32(),
                server_name: "server".into(),
                protocol_version: "3.8".into(),
                security_type: "None".into(),
            })
            .unwrap();
    }

    #[test]
    fn rectangle_bursts_preserve_authoritative_pixels_at_100_500_1000() {
        for count in [100usize, 500, 1_000] {
            let (sender, mut receiver) = event_delivery();
            sender.initialize_framebuffer(count as u16, 1).unwrap();
            sender.begin_framebuffer_update().unwrap();
            for index in 0..count {
                sender
                    .apply_frame(pixel_rect(index as u16, index as u8))
                    .unwrap();
            }
            assert!(receiver.drain(2).unwrap().is_empty());
            sender.finish_framebuffer_update().unwrap();
            let framebuffer = drain_all_frames(&sender, &mut receiver, count, 1);
            for index in 0..count {
                assert_eq!(
                    &framebuffer[index * 4..index * 4 + 4],
                    &[
                        index as u8,
                        (index as u8).wrapping_add(1),
                        (index as u8).wrapping_add(2),
                        255,
                    ],
                    "final pixel {index} differs after a {count}-rectangle burst"
                );
            }
            let delivery = lock_delivery(&sender.shared).unwrap();
            assert_eq!(delivery.framebuffer.generation, 1);
            assert_eq!(delivery.diagnostics.gap_epochs, 0);
        }
    }

    #[test]
    fn control_bursts_are_nonblocking_coalesced_and_memory_bounded() {
        for count in [100usize, 500, 1_000] {
            let (sender, mut receiver) = event_delivery();
            publish_connected(&sender);
            for index in 0..count {
                sender.publish_control(SessionEvent::Bell).unwrap();
                sender
                    .publish_control(SessionEvent::Resize {
                        width: (index % 100 + 1) as u16,
                        height: 1,
                    })
                    .unwrap();
                sender
                    .publish_control(SessionEvent::Clipboard(format!("clipboard-{index}")))
                    .unwrap();
                sender
                    .publish_control(SessionEvent::StateChanged(VncStateEvent {
                        session_id: "session".into(),
                        state: "active".into(),
                        message: format!("message-{index}"),
                    }))
                    .unwrap();
            }
            let delivery = lock_delivery(&sender.shared).unwrap();
            assert!(delivery.controls.len() <= MAX_PENDING_CONTROL_ENTRIES);
            assert!(delivery.control_bytes <= MAX_PENDING_CONTROL_BYTES);
            assert!(delivery.diagnostics.coalesced_controls >= (count as u64 - 1) * 4);
            assert_eq!(delivery.diagnostics.coalesced_bells, count as u64 - 1);
            drop(delivery);

            let delivered = receiver.drain(MAX_VNC_DRAIN_EVENTS).unwrap();
            assert_eq!(
                delivered
                    .iter()
                    .filter(|event| matches!(event, SessionEvent::Bell))
                    .count(),
                1,
                "a Bell burst must remain one bounded pending notification"
            );
            assert!(receiver.drain(MAX_VNC_DRAIN_EVENTS).unwrap().is_empty());
        }
    }

    #[test]
    fn oversized_drain_limit_is_clamped_and_cannot_expand_a_bell_burst() {
        let (sender, mut receiver) = event_delivery();
        for _ in 0..1_000 {
            sender.publish_control(SessionEvent::Bell).unwrap();
        }
        let events = receiver.drain(usize::MAX).unwrap();
        assert_eq!(events.len(), 1);
        assert!(matches!(events.as_slice(), [SessionEvent::Bell]));
        assert!(receiver.drain(usize::MAX).unwrap().is_empty());
    }

    #[test]
    fn malformed_and_oversized_cursors_are_dropped_with_accounting() {
        let (sender, mut receiver) = event_delivery();
        sender
            .publish_control(SessionEvent::Cursor {
                pixels: vec![0; 513 * RGBA_BYTES_PER_PIXEL],
                width: MAX_VNC_CURSOR_DIMENSION + 1,
                height: 1,
                hotspot_x: 0,
                hotspot_y: 0,
            })
            .unwrap();
        sender
            .publish_control(SessionEvent::Cursor {
                pixels: vec![0; 15],
                width: 2,
                height: 2,
                hotspot_x: 0,
                hotspot_y: 0,
            })
            .unwrap();
        sender
            .publish_control(SessionEvent::Cursor {
                pixels: vec![0; 16],
                width: 2,
                height: 2,
                hotspot_x: 2,
                hotspot_y: 0,
            })
            .unwrap();
        {
            let delivery = lock_delivery(&sender.shared).unwrap();
            assert!(delivery.controls.is_empty());
            assert_eq!(delivery.diagnostics.dropped_controls, 3);
        }

        sender
            .publish_control(SessionEvent::Cursor {
                pixels: vec![0; MAX_CURSOR_RGBA_BYTES],
                width: MAX_VNC_CURSOR_DIMENSION,
                height: MAX_VNC_CURSOR_DIMENSION,
                hotspot_x: 0,
                hotspot_y: 0,
            })
            .unwrap();
        assert!(matches!(
            receiver.drain(2).unwrap().as_slice(),
            [SessionEvent::Cursor { .. }]
        ));
    }

    #[test]
    fn frame_only_drain_preserves_controls_for_the_control_consumer() {
        let (sender, mut receiver) = event_delivery();
        sender.initialize_framebuffer(1, 1).unwrap();
        sender
            .publish_control(SessionEvent::Clipboard("preserve-me".into()))
            .unwrap();
        sender.begin_framebuffer_update().unwrap();
        sender.apply_frame(pixel_rect(0, 7)).unwrap();
        sender.finish_framebuffer_update().unwrap();

        assert!(receiver.drain_frame_only().unwrap().is_some());
        let controls = receiver.drain(1).unwrap();
        assert!(matches!(
            controls.as_slice(),
            [SessionEvent::Clipboard(text)] if text == "preserve-me"
        ));
    }

    #[test]
    fn terminal_survives_frame_and_control_flood_and_is_exclusive() {
        let (sender, mut receiver) = event_delivery();
        sender.initialize_framebuffer(1, 1).unwrap();
        for generation in 0..1_000u16 {
            sender.begin_framebuffer_update().unwrap();
            sender.apply_frame(pixel_rect(0, generation as u8)).unwrap();
            sender.finish_framebuffer_update().unwrap();
            sender.publish_control(SessionEvent::Bell).unwrap();
            sender
                .publish_control(SessionEvent::Clipboard(format!("value-{generation}")))
                .unwrap();
        }
        sender
            .publish_control(SessionEvent::Disconnected(Some("terminal".into())))
            .unwrap();
        let events = receiver.drain(2).unwrap();
        assert!(matches!(
            events.as_slice(),
            [SessionEvent::Disconnected(Some(reason))] if reason == "terminal"
        ));
        assert!(receiver.drain(2).unwrap().is_empty());
    }

    #[test]
    fn continuous_controls_reserve_frame_progress_in_normal_two_event_drain() {
        let (sender, mut receiver) = event_delivery();
        sender.initialize_framebuffer(1, 1).unwrap();
        sender.begin_framebuffer_update().unwrap();
        sender.apply_frame(pixel_rect(0, 9)).unwrap();
        sender.finish_framebuffer_update().unwrap();
        for index in 0..100 {
            sender.publish_control(SessionEvent::Bell).unwrap();
            sender
                .publish_control(SessionEvent::Clipboard(format!("control-{index}")))
                .unwrap();
            let events = receiver.drain(2).unwrap();
            assert!(events
                .iter()
                .any(|event| matches!(event, SessionEvent::Frame(_))));
            sender.acknowledge_and_select_incremental(true).unwrap();
            sender.begin_framebuffer_update().unwrap();
            sender.apply_frame(pixel_rect(0, index as u8)).unwrap();
            sender.finish_framebuffer_update().unwrap();
        }
    }

    #[test]
    fn one_event_drains_alternate_controls_and_frames_under_continuous_load() {
        let (sender, mut receiver) = event_delivery();
        sender.initialize_framebuffer(1, 1).unwrap();
        sender.begin_framebuffer_update().unwrap();
        sender.apply_frame(pixel_rect(0, 1)).unwrap();
        sender.finish_framebuffer_update().unwrap();

        for value in 2..=101u8 {
            sender.publish_control(SessionEvent::Bell).unwrap();
            let control = receiver.drain(1).unwrap();
            assert!(matches!(control.as_slice(), [SessionEvent::Bell]));
            sender.publish_control(SessionEvent::Bell).unwrap();
            let frame = receiver.drain(1).unwrap();
            assert!(matches!(frame.as_slice(), [SessionEvent::Frame(_)]));
            sender.acknowledge_and_select_incremental(true).unwrap();
            sender.begin_framebuffer_update().unwrap();
            sender.apply_frame(pixel_rect(0, value)).unwrap();
            sender.finish_framebuffer_update().unwrap();
        }
    }

    #[test]
    fn unacknowledged_tiles_replay_and_newer_damage_survives_ack() {
        let (sender, mut receiver) = event_delivery();
        sender.initialize_framebuffer(1, 1).unwrap();
        sender.begin_framebuffer_update().unwrap();
        sender.apply_frame(pixel_rect(0, 1)).unwrap();
        sender.finish_framebuffer_update().unwrap();
        let first = frame_from(receiver.drain(2).unwrap());
        let replay = frame_from(receiver.drain(2).unwrap());
        assert_eq!(first.pixels, replay.pixels);

        sender.begin_framebuffer_update().unwrap();
        sender.apply_frame(pixel_rect(0, 7)).unwrap();
        sender.finish_framebuffer_update().unwrap();
        assert!(sender.acknowledge_and_select_incremental(true).unwrap());
        let latest = frame_from(receiver.drain(2).unwrap());
        assert_eq!(latest.pixels[0], 7);
        assert!(!sender.acknowledge_and_select_incremental(true).unwrap());
    }

    #[test]
    fn native_requests_never_acknowledge_renderer_in_flight_tiles() {
        let (sender, mut receiver) = event_delivery();
        sender.initialize_framebuffer(1, 1).unwrap();
        sender.begin_framebuffer_update().unwrap();
        sender.apply_frame(pixel_rect(0, 4)).unwrap();
        sender.finish_framebuffer_update().unwrap();
        let first = frame_from(receiver.drain(2).unwrap());

        assert!(sender.select_incremental_without_ack(true).unwrap());
        let replay = frame_from(receiver.drain(2).unwrap());
        assert_eq!(first.pixels, replay.pixels);
        sender.acknowledge_and_select_incremental(true).unwrap();
        assert!(receiver.drain(2).unwrap().is_empty());
    }

    #[test]
    fn periodic_request_consumes_one_forced_full_without_losing_newer_pixels() {
        let (sender, mut receiver) = event_delivery();
        sender.initialize_framebuffer(1, 1).unwrap();
        for value in [1, 2] {
            sender.begin_framebuffer_update().unwrap();
            sender.apply_frame(pixel_rect(0, value)).unwrap();
            sender.finish_framebuffer_update().unwrap();
        }

        let before_full = frame_from(receiver.drain(2).unwrap());
        assert_eq!(before_full.pixels[0], 2);
        assert!(!sender.select_incremental_without_ack(true).unwrap());
        assert!(sender.select_incremental_without_ack(true).unwrap());
        let replay = frame_from(receiver.drain(2).unwrap());
        assert_eq!(replay.pixels, before_full.pixels);

        sender.begin_framebuffer_update().unwrap();
        sender.apply_frame(pixel_rect(0, 3)).unwrap();
        sender.finish_framebuffer_update().unwrap();
        assert!(sender.acknowledge_and_select_incremental(true).unwrap());
        let after_full = frame_from(receiver.drain(2).unwrap());
        assert_eq!(after_full.pixels[0], 3);
    }

    #[test]
    fn older_refresh_reservation_cannot_clear_a_newer_resize_epoch() {
        let (sender, _receiver) = event_delivery();
        sender.initialize_framebuffer(1, 1).unwrap();
        sender.resize_framebuffer(2, 1).unwrap();
        let older = sender.reserve_update_request(true).unwrap();
        assert!(!older.incremental());

        sender.resize_framebuffer(3, 1).unwrap();
        older.commit().unwrap();
        let newer = sender.reserve_update_request(true).unwrap();
        assert!(!newer.incremental());
        newer.commit().unwrap();
        let incremental = sender.reserve_update_request(true).unwrap();
        assert!(incremental.incremental());
    }

    #[test]
    fn aborted_update_suspends_frames_and_preserves_terminal_exclusivity() {
        let (sender, mut receiver) = event_delivery();
        sender.initialize_framebuffer(1, 1).unwrap();
        sender.begin_framebuffer_update().unwrap();
        sender.apply_frame(pixel_rect(0, 1)).unwrap();
        sender.finish_framebuffer_update().unwrap();

        {
            let _guard = sender.framebuffer_update().unwrap();
            sender.apply_frame(pixel_rect(0, 9)).unwrap();
        }
        {
            let delivery = lock_delivery(&sender.shared).unwrap();
            assert!(!delivery.framebuffer.update_in_progress);
            assert!(delivery.framebuffer.delivery_suspended);
            assert!(delivery.pending_framebuffer.is_none());
            assert_eq!(delivery.framebuffer.pixels[0], 1);
        }
        assert!(receiver.drain_frame_only().unwrap().is_none());
        sender
            .publish_control(SessionEvent::Disconnected(Some("decode failed".into())))
            .unwrap();
        assert!(matches!(
            receiver.drain(2).unwrap().as_slice(),
            [SessionEvent::Disconnected(Some(reason))] if reason == "decode failed"
        ));
        assert!(receiver.drain(2).unwrap().is_empty());
    }

    #[test]
    fn initial_and_single_multi_rect_updates_do_not_create_false_gaps() {
        let (sender, mut receiver) = event_delivery();
        sender.initialize_framebuffer(4, 1).unwrap();
        assert!(!sender.acknowledge_and_select_incremental(false).unwrap());
        assert!(sender.acknowledge_and_select_incremental(true).unwrap());

        sender.begin_framebuffer_update().unwrap();
        for x in 0..4u16 {
            sender.apply_frame(pixel_rect(x, x as u8)).unwrap();
        }
        sender.finish_framebuffer_update().unwrap();
        let _ = frame_from(receiver.drain(2).unwrap());
        assert!(sender.acknowledge_and_select_incremental(true).unwrap());
        let delivery = lock_delivery(&sender.shared).unwrap();
        assert_eq!(delivery.framebuffer.generation, 1);
        assert_eq!(delivery.diagnostics.gap_epochs, 0);
    }

    #[test]
    fn generation_gap_and_resize_force_one_full_request_per_epoch() {
        let (sender, mut receiver) = event_delivery();
        sender.initialize_framebuffer(1, 1).unwrap();
        for value in [1u8, 2, 3] {
            sender.begin_framebuffer_update().unwrap();
            sender.apply_frame(pixel_rect(0, value)).unwrap();
            sender.finish_framebuffer_update().unwrap();
        }
        let latest = frame_from(receiver.drain(2).unwrap());
        assert_eq!(latest.pixels[0], 3);
        assert!(!sender.acknowledge_and_select_incremental(true).unwrap());
        assert!(sender.acknowledge_and_select_incremental(true).unwrap());

        sender.resize_framebuffer(2, 1).unwrap();
        assert!(!sender.acknowledge_and_select_incremental(true).unwrap());
        assert!(sender.acknowledge_and_select_incremental(true).unwrap());
        let delivery = lock_delivery(&sender.shared).unwrap();
        assert_eq!(delivery.diagnostics.gap_epochs, 1);
    }

    #[test]
    fn dirty_tile_selection_is_round_robin_under_a_hot_tile() {
        let (sender, mut receiver) = event_delivery();
        sender.initialize_framebuffer(512, 1).unwrap();
        sender.begin_framebuffer_update().unwrap();
        sender.apply_frame(pixel_rect(0, 1)).unwrap();
        sender.apply_frame(pixel_rect(300, 2)).unwrap();
        sender.finish_framebuffer_update().unwrap();

        let first = frame_from(receiver.drain(2).unwrap());
        assert_eq!(first.x, 0);
        sender.begin_framebuffer_update().unwrap();
        sender.apply_frame(pixel_rect(0, 3)).unwrap();
        sender.finish_framebuffer_update().unwrap();
        sender.acknowledge_and_select_incremental(true).unwrap();
        let second = frame_from(receiver.drain(2).unwrap());
        assert_eq!(second.x, 256, "older dirty tile must not be starved");
    }

    #[test]
    fn copyrect_overlap_updates_canonical_pixels() {
        let (sender, mut receiver) = event_delivery();
        sender.initialize_framebuffer(4, 1).unwrap();
        sender.begin_framebuffer_update().unwrap();
        for x in 0..4u16 {
            sender.apply_frame(pixel_rect(x, x as u8)).unwrap();
        }
        sender.finish_framebuffer_update().unwrap();
        let _ = receiver.drain(2).unwrap();
        sender.acknowledge_and_select_incremental(true).unwrap();

        sender.begin_framebuffer_update().unwrap();
        sender
            .apply_frame(DecodedRect {
                x: 1,
                y: 0,
                width: 3,
                height: 1,
                source_x: Some(0),
                source_y: Some(0),
                pixels: Vec::new(),
            })
            .unwrap();
        sender.finish_framebuffer_update().unwrap();
        let copied = frame_from(receiver.drain(2).unwrap());
        assert_eq!(
            copied
                .pixels
                .chunks_exact(4)
                .take(4)
                .map(|pixel| pixel[0])
                .collect::<Vec<_>>(),
            vec![0, 0, 1, 2]
        );
    }

    #[test]
    fn framebuffer_and_delivery_memory_caps_are_enforced() {
        let (sender, _receiver) = event_delivery();
        sender.initialize_framebuffer(16_384, 512).unwrap();
        let delivery = lock_delivery(&sender.shared).unwrap();
        assert_eq!(delivery.framebuffer.pixels.len(), MAX_VNC_FRAMEBUFFER_BYTES);
        assert!(delivery.framebuffer.dirty_generation.len() <= MAX_DIRTY_TILES);
        drop(delivery);
        assert!(sender.initialize_framebuffer(16_384, 513).is_err());
    }

    #[test]
    fn transactional_resize_drops_tile_overlays_and_caps_transient_framebuffers() {
        let (sender, _receiver) = event_delivery();
        sender.initialize_framebuffer(16_384, 512).unwrap();
        sender.begin_framebuffer_update().unwrap();
        sender.apply_frame(pixel_rect(0, 1)).unwrap();
        {
            let delivery = lock_delivery(&sender.shared).unwrap();
            let pending = delivery.pending_framebuffer.as_ref().unwrap();
            let overlay_bytes = pending
                .tiles
                .iter()
                .filter_map(Option::as_ref)
                .map(Vec::len)
                .sum::<usize>();
            assert!(overlay_bytes > 0);
            assert!(overlay_bytes <= MAX_VNC_FRAMEBUFFER_BYTES);
        }

        sender.resize_framebuffer(16_384, 512).unwrap();
        {
            let delivery = lock_delivery(&sender.shared).unwrap();
            let pending = delivery.pending_framebuffer.as_ref().unwrap();
            assert!(pending.tiles.iter().all(Option::is_none));
            assert_eq!(
                pending.resized_pixels.as_ref().unwrap().len(),
                MAX_VNC_FRAMEBUFFER_BYTES
            );
            assert!(
                delivery.framebuffer.pixels.len() + pending.resized_pixels.as_ref().unwrap().len()
                    <= MAX_VNC_FRAMEBUFFER_BYTES * 2
            );
        }
        sender.abort_framebuffer_update();
    }

    #[test]
    fn utf8_truncation_stays_on_codepoint_boundary_and_records_pressure() {
        let (sender, mut receiver) = event_delivery();
        let oversized = "é".repeat(MAX_TERMINAL_REASON_BYTES);
        sender
            .publish_control(SessionEvent::Disconnected(Some(oversized)))
            .unwrap();
        let events = receiver.drain(2).unwrap();
        let SessionEvent::Disconnected(Some(reason)) = &events[0] else {
            panic!("expected terminal reason")
        };
        assert!(reason.len() <= MAX_TERMINAL_REASON_BYTES);
        assert!(reason.is_char_boundary(reason.len()));
        let delivery = lock_delivery(&sender.shared).unwrap();
        assert_eq!(delivery.diagnostics.truncated_controls, 1);
    }
}
