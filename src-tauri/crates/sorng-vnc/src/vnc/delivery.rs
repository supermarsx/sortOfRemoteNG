//! Bounded, non-blocking delivery state between the RFB actor and renderer.
//!
//! Control notifications are coalesced into a fixed number of typed slots and
//! terminal state has a dedicated out-of-band slot. Framebuffer rectangles are
//! applied to one canonical RGBA buffer, while fixed-size dirty tiles preserve
//! damage until an explicit epoch-and-token renderer ACK acknowledges the
//! delivered tile. Renderer activity is generation-authoritative here: hiding
//! a viewer closes only frame delivery and refresh scheduling while canonical
//! framebuffer and bounded control/terminal state remain live.

use std::sync::{Arc, Mutex as StdMutex};
use tokio::sync::Notify;

use super::encoding::DecodedRect;
use super::session::{DeliveredFrame, SessionEvent};
use super::types::{
    VncActivityResult, VncError, VncErrorKind, VncFrameAckResult, MAX_VNC_ACTIVITY_GENERATION,
    MAX_VNC_CLIPBOARD_BYTES, MAX_VNC_CURSOR_DIMENSION, MAX_VNC_DESKTOP_NAME_BYTES,
    MAX_VNC_DIMENSION, MAX_VNC_DRAIN_EVENTS, MAX_VNC_EVENT_QUEUE, MAX_VNC_FRAMEBUFFER_BYTES,
    MAX_VNC_RECT_RGBA_BYTES,
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
const MAX_FORCED_REPAINT_COVERAGE_BYTES: usize =
    MAX_VNC_FRAMEBUFFER_BYTES / RGBA_BYTES_PER_PIXEL / u8::BITS as usize;

#[derive(Clone)]
pub(crate) struct VncEventSender {
    shared: Arc<StdMutex<DeliveryState>>,
    request_wake: Arc<Notify>,
}

pub(crate) struct VncEventReceiver {
    shared: Arc<StdMutex<DeliveryState>>,
    request_wake: Arc<Notify>,
}

/// Resets delivery state if a framebuffer update future fails, times out, or
/// is cancelled before the whole RFB update is committed.
pub(crate) struct FramebufferUpdateGuard<'a> {
    sender: &'a VncEventSender,
    committed: bool,
}

pub struct RefreshRequestReservation {
    shared: Arc<StdMutex<DeliveryState>>,
    request_wake: Arc<Notify>,
    incremental: bool,
    forced_epoch: Option<u64>,
    forced_override: bool,
    delivery_epoch: u64,
    activated: bool,
    completed: bool,
}

impl std::fmt::Debug for RefreshRequestReservation {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("RefreshRequestReservation")
            .field("incremental", &self.incremental)
            .field("forced_epoch", &self.forced_epoch)
            .field("forced_override", &self.forced_override)
            .field("delivery_epoch", &self.delivery_epoch)
            .field("activated", &self.activated)
            .finish_non_exhaustive()
    }
}

impl RefreshRequestReservation {
    pub(crate) fn incremental(&self) -> bool {
        self.incremental
    }

    /// Make this request visible to the response reader before its socket
    /// write starts. The reservation fence remains held until `commit` or
    /// drop, so an early response cannot admit a competing request while the
    /// writer is still awaiting completion.
    pub(crate) fn activate(&mut self) -> Result<(), VncError> {
        if self.activated || self.completed {
            return Err(delivery_error(
                "VNC refresh reservation was activated more than once",
            ));
        }
        let mut delivery = lock_delivery(&self.shared)?;
        let framebuffer = &mut delivery.framebuffer;
        if !framebuffer.request_reserved || framebuffer.request_reservation_active {
            return Err(delivery_error("VNC refresh reservation is not current"));
        }
        if self.forced_override {
            if framebuffer.forced_request_outstanding {
                return Err(delivery_error(
                    "VNC forced refresh credit is already outstanding",
                ));
            }
            framebuffer.forced_request_outstanding = true;
            framebuffer.forced_request_delivery_epoch = Some(self.delivery_epoch);
        } else {
            if framebuffer.request_outstanding {
                return Err(delivery_error(
                    "VNC incremental refresh credit is already outstanding",
                ));
            }
            framebuffer.request_outstanding = true;
        }
        framebuffer.request_reservation_active = true;
        framebuffer.reserved_request_forced = self.forced_override;
        framebuffer.reserved_response_consumed = false;
        if let Some(epoch) = self.forced_epoch {
            if framebuffer.reserved_refresh_epoch == Some(epoch) {
                framebuffer.reserved_refresh_epoch = None;
            }
            if framebuffer.force_refresh_epoch == epoch {
                framebuffer.force_full_refresh = false;
            }
        }
        self.activated = true;
        Ok(())
    }

    pub(crate) fn commit(mut self) -> Result<(), VncError> {
        if !self.activated {
            return Err(delivery_error(
                "VNC refresh reservation was committed before write activation",
            ));
        }
        let mut delivery = lock_delivery(&self.shared)?;
        let terminal_published = delivery.terminal_published;
        let framebuffer = &mut delivery.framebuffer;
        if !framebuffer.request_reserved
            || !framebuffer.request_reservation_active
            || framebuffer.reserved_request_forced != self.forced_override
        {
            return Err(delivery_error("VNC refresh reservation is not current"));
        }
        let response_consumed = framebuffer.reserved_response_consumed;
        framebuffer.request_reserved = false;
        framebuffer.request_reservation_active = false;
        framebuffer.reserved_request_forced = false;
        framebuffer.reserved_response_consumed = false;
        let should_wake = !terminal_published
            && framebuffer.renderer_active
            && !framebuffer.delivery_suspended
            && !framebuffer.forced_request_outstanding
            && (framebuffer.force_full_refresh
                || (response_consumed && !framebuffer.request_outstanding));
        drop(delivery);
        self.completed = true;
        if should_wake {
            self.request_wake.notify_one();
        }
        Ok(())
    }
}

impl Drop for RefreshRequestReservation {
    fn drop(&mut self) {
        if self.completed {
            return;
        }
        let Ok(mut delivery) = lock_delivery(&self.shared) else {
            return;
        };
        let terminal_published = delivery.terminal_published;
        let framebuffer = &mut delivery.framebuffer;
        let response_consumed = framebuffer.reserved_response_consumed;
        if self.activated && !response_consumed {
            if self.forced_override {
                if framebuffer.forced_request_delivery_epoch == Some(self.delivery_epoch) {
                    framebuffer.forced_request_outstanding = false;
                    framebuffer.forced_request_delivery_epoch = None;
                }
            } else {
                framebuffer.request_outstanding = false;
            }
        }
        framebuffer.request_reserved = false;
        framebuffer.request_reservation_active = false;
        framebuffer.reserved_request_forced = false;
        framebuffer.reserved_response_consumed = false;
        if let Some(epoch) = self.forced_epoch {
            if framebuffer.reserved_refresh_epoch == Some(epoch) {
                framebuffer.reserved_refresh_epoch = None;
            }
            if self.activated && !response_consumed && framebuffer.force_refresh_epoch == epoch {
                framebuffer.force_full_refresh = true;
            }
        }
        let should_wake = !terminal_published
            && framebuffer.renderer_active
            && !framebuffer.delivery_suspended
            && framebuffer.force_full_refresh
            && !framebuffer.forced_request_outstanding;
        drop(delivery);
        if should_wake {
            self.request_wake.notify_one();
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
    let request_wake = Arc::new(Notify::new());
    (
        VncEventSender {
            shared: Arc::clone(&shared),
            request_wake: Arc::clone(&request_wake),
        },
        VncEventReceiver {
            shared,
            request_wake,
        },
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
    frame: DeliveredFrame,
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
    consumed_forced_delivery_epoch: Option<u64>,
    covered_pixels: Option<Vec<u64>>,
    covered_pixel_count: usize,
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

#[derive(Debug)]
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
    renderer_active: bool,
    activity_generation: u64,
    delivery_epoch: u64,
    next_frame_token: u64,
    request_reserved: bool,
    request_reservation_active: bool,
    reserved_request_forced: bool,
    reserved_response_consumed: bool,
    request_outstanding: bool,
    forced_request_outstanding: bool,
    forced_request_delivery_epoch: Option<u64>,
    awaiting_full_delivery_epoch: Option<u64>,
    force_full_refresh: bool,
    force_refresh_epoch: u64,
    reserved_refresh_epoch: Option<u64>,
    gap_epoch_active: bool,
    delivery_suspended: bool,
}

impl Default for FramebufferState {
    fn default() -> Self {
        Self {
            width: 0,
            height: 0,
            pixels: Vec::new(),
            tiles_x: 0,
            tiles_y: 0,
            dirty_generation: Vec::new(),
            update_in_progress: false,
            generation: 0,
            updates_since_ack: 0,
            rectangles_since_ack: 0,
            next_tile_cursor: 0,
            in_flight: None,
            renderer_active: true,
            activity_generation: 0,
            delivery_epoch: 1,
            next_frame_token: 0,
            request_reserved: false,
            request_reservation_active: false,
            reserved_request_forced: false,
            reserved_response_consumed: false,
            request_outstanding: false,
            forced_request_outstanding: false,
            forced_request_delivery_epoch: None,
            awaiting_full_delivery_epoch: None,
            force_full_refresh: false,
            force_refresh_epoch: 0,
            reserved_refresh_epoch: None,
            gap_epoch_active: false,
            delivery_suspended: false,
        }
    }
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

fn reset_forced_response_coverage(pending: &mut PendingFramebufferUpdate) -> Result<(), VncError> {
    if pending.consumed_forced_delivery_epoch.is_none() {
        pending.covered_pixels = None;
        pending.covered_pixel_count = 0;
        return Ok(());
    }
    let pixel_count = (pending.width as usize)
        .checked_mul(pending.height as usize)
        .ok_or_else(|| delivery_error("VNC repaint coverage size overflow"))?;
    let coverage_words = pixel_count.div_ceil(u64::BITS as usize);
    coverage_words
        .checked_mul(std::mem::size_of::<u64>())
        .filter(|bytes| *bytes <= MAX_FORCED_REPAINT_COVERAGE_BYTES)
        .ok_or_else(|| delivery_error("VNC repaint coverage exceeds the safety limit"))?;
    pending.covered_pixels = Some(vec![0; coverage_words]);
    pending.covered_pixel_count = 0;
    Ok(())
}

fn mark_forced_response_coverage(
    pending: &mut PendingFramebufferUpdate,
    x: u16,
    y: u16,
    width: u16,
    height: u16,
) {
    let Some(covered_pixels) = pending.covered_pixels.as_mut() else {
        return;
    };
    let stride = pending.width as usize;
    for row in y as usize..y as usize + height as usize {
        let start = row * stride + x as usize;
        let end = start + width as usize;
        let first_word = start / u64::BITS as usize;
        let last_word = (end - 1) / u64::BITS as usize;
        for (word_index, covered_word) in covered_pixels
            .iter_mut()
            .enumerate()
            .take(last_word + 1)
            .skip(first_word)
        {
            let word_start = word_index * u64::BITS as usize;
            let lower_bit = start.saturating_sub(word_start).min(u64::BITS as usize);
            let upper_bit = (end - word_start).min(u64::BITS as usize);
            let lower_mask = u64::MAX << lower_bit;
            let upper_mask = if upper_bit == u64::BITS as usize {
                u64::MAX
            } else {
                (1u64 << upper_bit) - 1
            };
            let mask = lower_mask & upper_mask;
            let prior = *covered_word;
            pending.covered_pixel_count += (mask & !prior).count_ones() as usize;
            *covered_word = prior | mask;
        }
    }
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
            reset_forced_response_coverage(pending)?;
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
            renderer_active: delivery.framebuffer.renderer_active,
            activity_generation: delivery.framebuffer.activity_generation,
            delivery_epoch: delivery.framebuffer.delivery_epoch,
            next_frame_token: delivery.framebuffer.next_frame_token,
            request_reserved: delivery.framebuffer.request_reserved,
            request_reservation_active: delivery.framebuffer.request_reservation_active,
            reserved_request_forced: delivery.framebuffer.reserved_request_forced,
            reserved_response_consumed: delivery.framebuffer.reserved_response_consumed,
            request_outstanding: delivery.framebuffer.request_outstanding,
            forced_request_outstanding: delivery.framebuffer.forced_request_outstanding,
            forced_request_delivery_epoch: delivery.framebuffer.forced_request_delivery_epoch,
            awaiting_full_delivery_epoch: delivery.framebuffer.awaiting_full_delivery_epoch,
            force_refresh_epoch: delivery.framebuffer.force_refresh_epoch,
            reserved_refresh_epoch: delivery.framebuffer.reserved_refresh_epoch,
            gap_epoch_active: true,
            ..FramebufferState::default()
        };
        require_full_refresh(&mut framebuffer)?;
        delivery.framebuffer = framebuffer;
        drop(delivery);
        self.request_wake.notify_one();
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
        // Responses consume wire credits in request order: an older normal
        // request first, then the single forced resume override. Keep forced
        // credit marked outstanding while its body is decoded so no retry can
        // overlap it; a committed partial response releases that credit and
        // queues exactly one sequential forced retry.
        let consumed_forced_delivery_epoch = if framebuffer.request_outstanding {
            framebuffer.request_outstanding = false;
            if framebuffer.request_reservation_active && !framebuffer.reserved_request_forced {
                framebuffer.reserved_response_consumed = true;
            }
            None
        } else if framebuffer.forced_request_outstanding {
            if framebuffer.request_reservation_active && framebuffer.reserved_request_forced {
                framebuffer.reserved_response_consumed = true;
            }
            framebuffer.forced_request_delivery_epoch
        } else {
            None
        };
        let tile_count = framebuffer.dirty_generation.len();
        let mut pending = PendingFramebufferUpdate {
            width: framebuffer.width,
            height: framebuffer.height,
            tiles_x: framebuffer.tiles_x,
            tiles_y: framebuffer.tiles_y,
            tiles: (0..tile_count).map(|_| None).collect(),
            resized_pixels: None,
            touched_tiles: vec![false; tile_count],
            rectangles: 0,
            resized: false,
            consumed_forced_delivery_epoch,
            covered_pixels: None,
            covered_pixel_count: 0,
        };
        reset_forced_response_coverage(&mut pending)?;
        framebuffer.update_in_progress = true;
        delivery.pending_framebuffer = Some(pending);
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
        mark_forced_response_coverage(pending, rect.x, rect.y, rect.width, rect.height);
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
        let canonical_pixel_count = (pending.width as usize)
            .checked_mul(pending.height as usize)
            .ok_or_else(|| delivery_error("VNC repaint coverage size overflow"))?;
        let full_canonical_repaint = pending.covered_pixels.is_some()
            && pending.covered_pixel_count == canonical_pixel_count;
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
                renderer_active: delivery.framebuffer.renderer_active,
                activity_generation: delivery.framebuffer.activity_generation,
                delivery_epoch: delivery.framebuffer.delivery_epoch,
                next_frame_token: delivery.framebuffer.next_frame_token,
                request_reserved: delivery.framebuffer.request_reserved,
                request_reservation_active: delivery.framebuffer.request_reservation_active,
                reserved_request_forced: delivery.framebuffer.reserved_request_forced,
                reserved_response_consumed: delivery.framebuffer.reserved_response_consumed,
                request_outstanding: delivery.framebuffer.request_outstanding,
                forced_request_outstanding: delivery.framebuffer.forced_request_outstanding,
                forced_request_delivery_epoch: delivery.framebuffer.forced_request_delivery_epoch,
                awaiting_full_delivery_epoch: delivery.framebuffer.awaiting_full_delivery_epoch,
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
        if let Some(completed_epoch) = pending.consumed_forced_delivery_epoch {
            debug_assert!(framebuffer.forced_request_outstanding);
            debug_assert_eq!(
                framebuffer.forced_request_delivery_epoch,
                Some(completed_epoch)
            );
            framebuffer.forced_request_outstanding = false;
            framebuffer.forced_request_delivery_epoch = None;
            if full_canonical_repaint
                && framebuffer.awaiting_full_delivery_epoch == Some(completed_epoch)
            {
                framebuffer.awaiting_full_delivery_epoch = None;
                framebuffer.gap_epoch_active = false;
                framebuffer.updates_since_ack = 1;
                framebuffer.rectangles_since_ack = pending.rectangles;
                framebuffer.force_full_refresh = false;
                framebuffer.reserved_refresh_epoch = None;
            } else if framebuffer.renderer_active
                && framebuffer.awaiting_full_delivery_epoch.is_some()
                && !framebuffer.force_full_refresh
            {
                require_full_refresh(framebuffer)?;
            }
        }
        let should_wake = framebuffer.renderer_active;
        drop(delivery);
        if should_wake {
            self.request_wake.notify_one();
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

    /// Apply one generation-aware renderer activity claim.
    ///
    /// Every higher-generation active claim represents new renderer ownership,
    /// even if the prior renderer was also active. It therefore advances the
    /// delivery epoch, invalidates the old token, preserves dirty state, and
    /// queues one coalesced full repaint.
    pub(crate) fn set_activity(
        &self,
        session_id: &str,
        active: bool,
        activity_generation: u64,
    ) -> Result<VncActivityResult, VncError> {
        let mut delivery = lock_delivery(&self.shared)?;
        if delivery.terminal_published {
            return Err(VncError::new(
                VncErrorKind::NotConnected,
                "VNC session delivery is terminal",
            ));
        }
        let framebuffer = &mut delivery.framebuffer;
        if activity_generation > MAX_VNC_ACTIVITY_GENERATION {
            return Err(VncError::protocol(
                "VNC activity generation exceeds the JavaScript-safe limit",
            ));
        }
        let accepted = activity_generation > framebuffer.activity_generation;
        let mut refresh_queued = false;
        if activity_generation > framebuffer.activity_generation {
            if active {
                let next_delivery_epoch = framebuffer
                    .delivery_epoch
                    .checked_add(1)
                    .filter(|epoch| *epoch <= MAX_VNC_ACTIVITY_GENERATION)
                    .ok_or_else(|| delivery_error("VNC delivery epoch overflow"))?;
                let next_refresh_epoch = framebuffer
                    .force_refresh_epoch
                    .checked_add(1)
                    .ok_or_else(|| delivery_error("VNC full-refresh epoch overflow"))?;
                framebuffer.activity_generation = activity_generation;
                framebuffer.renderer_active = true;
                framebuffer.delivery_epoch = next_delivery_epoch;
                framebuffer.next_frame_token = 0;
                framebuffer.in_flight = None;
                framebuffer.awaiting_full_delivery_epoch = Some(next_delivery_epoch);
                framebuffer.force_refresh_epoch = next_refresh_epoch;
                framebuffer.force_full_refresh = true;
                refresh_queued = true;
            } else {
                framebuffer.activity_generation = activity_generation;
                framebuffer.renderer_active = false;
            }
        }

        let result = VncActivityResult {
            session_id: session_id.to_string(),
            active: framebuffer.renderer_active,
            activity_generation: framebuffer.activity_generation,
            delivery_epoch: framebuffer.delivery_epoch,
            accepted,
            refresh_queued,
        };
        drop(delivery);
        if refresh_queued {
            self.request_wake.notify_one();
        }
        Ok(result)
    }

    /// A renderer-driven post-draw callback acknowledges only the exact tile
    /// returned by the preceding drain. Native refresh requests never call it.
    pub(crate) fn acknowledge_rendered_tile(
        &self,
        session_id: &str,
        delivery_epoch: u64,
        frame_token: u64,
    ) -> Result<VncFrameAckResult, VncError> {
        let mut delivery = lock_delivery(&self.shared)?;
        let framebuffer = &mut delivery.framebuffer;
        let accepted = framebuffer.renderer_active
            && !framebuffer.delivery_suspended
            && delivery_epoch == framebuffer.delivery_epoch
            && framebuffer.in_flight.as_ref().is_some_and(|in_flight| {
                in_flight.frame.delivery_epoch == delivery_epoch
                    && in_flight.frame.frame_token == frame_token
            });
        if accepted {
            let in_flight = framebuffer
                .in_flight
                .take()
                .expect("accepted VNC renderer ACK has an in-flight tile");
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
        Ok(VncFrameAckResult {
            session_id: session_id.to_string(),
            accepted,
            active: framebuffer.renderer_active,
            activity_generation: framebuffer.activity_generation,
            delivery_epoch: framebuffer.delivery_epoch,
        })
    }

    /// Reserve a forced full refresh without clearing it. The reservation must
    /// be committed only after queue admission/socket write succeeds; dropping
    /// it restores eligibility for the same epoch.
    pub(crate) fn reserve_update_request(
        &self,
        requested_incremental: bool,
    ) -> Result<Option<RefreshRequestReservation>, VncError> {
        let mut delivery = lock_delivery(&self.shared)?;
        if delivery.terminal_published {
            return Ok(None);
        }
        let framebuffer = &mut delivery.framebuffer;
        if framebuffer.delivery_suspended {
            return Err(delivery_error(
                "VNC framebuffer delivery is suspended after an aborted update",
            ));
        }
        if !framebuffer.renderer_active || framebuffer.request_reserved {
            return Ok(None);
        }
        let forced_epoch = framebuffer
            .force_full_refresh
            .then_some(framebuffer.force_refresh_epoch)
            .filter(|_| framebuffer.reserved_refresh_epoch.is_none());
        let forced_override = forced_epoch.is_some();
        if framebuffer.forced_request_outstanding
            || (!forced_override && framebuffer.request_outstanding)
        {
            return Ok(None);
        }
        if let Some(epoch) = forced_epoch {
            framebuffer.reserved_refresh_epoch = Some(epoch);
        }
        framebuffer.request_reserved = true;
        Ok(Some(RefreshRequestReservation {
            shared: Arc::clone(&self.shared),
            request_wake: Arc::clone(&self.request_wake),
            incremental: requested_incremental && forced_epoch.is_none(),
            forced_epoch,
            forced_override,
            delivery_epoch: framebuffer.delivery_epoch,
            activated: false,
            completed: false,
        }))
    }

    #[cfg(test)]
    pub(crate) fn test_request_state(&self) -> Result<(bool, bool, bool), VncError> {
        let delivery = lock_delivery(&self.shared)?;
        Ok((
            delivery.framebuffer.request_reserved,
            delivery.framebuffer.request_outstanding,
            delivery.framebuffer.forced_request_outstanding,
        ))
    }

    #[cfg(test)]
    fn acknowledge_and_select_incremental(
        &self,
        requested_incremental: bool,
    ) -> Result<bool, VncError> {
        let in_flight = {
            let delivery = lock_delivery(&self.shared)?;
            delivery
                .framebuffer
                .in_flight
                .as_ref()
                .map(|in_flight| (in_flight.frame.delivery_epoch, in_flight.frame.frame_token))
        };
        if let Some((epoch, token)) = in_flight {
            let result = self.acknowledge_rendered_tile("test", epoch, token)?;
            debug_assert!(result.accepted);
        }
        let mut reservation = self
            .reserve_update_request(requested_incremental)?
            .ok_or_else(|| delivery_error("VNC refresh request was coalesced in a unit test"))?;
        let incremental = reservation.incremental();
        reservation.activate()?;
        reservation.commit()?;
        self.test_complete_request()?;
        Ok(incremental)
    }

    #[cfg(test)]
    fn select_incremental_without_ack(
        &self,
        requested_incremental: bool,
    ) -> Result<bool, VncError> {
        let mut reservation = self
            .reserve_update_request(requested_incremental)?
            .ok_or_else(|| delivery_error("VNC refresh request was coalesced in a unit test"))?;
        let incremental = reservation.incremental();
        reservation.activate()?;
        reservation.commit()?;
        self.test_complete_request()?;
        Ok(incremental)
    }

    #[cfg(test)]
    pub(crate) fn test_complete_request(&self) -> Result<(), VncError> {
        let mut delivery = lock_delivery(&self.shared)?;
        delivery.framebuffer.request_outstanding = false;
        delivery.framebuffer.forced_request_outstanding = false;
        delivery.framebuffer.forced_request_delivery_epoch = None;
        Ok(())
    }

    #[cfg(test)]
    pub(crate) fn test_framebuffer_dimensions(&self) -> Result<(u16, u16), VncError> {
        let delivery = lock_delivery(&self.shared)?;
        Ok((delivery.framebuffer.width, delivery.framebuffer.height))
    }

    pub(crate) fn refresh_notifier(&self) -> Arc<Notify> {
        Arc::clone(&self.request_wake)
    }

    #[cfg(test)]
    pub(crate) async fn test_wait_for_request_wake(&self) {
        self.request_wake.notified().await;
    }
}

impl VncEventReceiver {
    pub(crate) fn drain(&self, max: usize) -> Result<Vec<SessionEvent>, VncError> {
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
            if let Some(frame) = take_dirty_tile(&mut delivery, &self.request_wake)? {
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

    pub(crate) fn drain_frame_only(&self) -> Result<Option<DeliveredFrame>, VncError> {
        let mut delivery = lock_delivery(&self.shared)?;
        if delivery.terminal_published || delivery.terminal_delivered {
            return Ok(None);
        }
        take_dirty_tile(&mut delivery, &self.request_wake)
    }
}

fn frame_ready(framebuffer: &FramebufferState) -> bool {
    if framebuffer.update_in_progress
        || framebuffer.delivery_suspended
        || !framebuffer.renderer_active
        || framebuffer.awaiting_full_delivery_epoch.is_some()
    {
        return false;
    }
    framebuffer.in_flight.is_some()
        || framebuffer
            .dirty_generation
            .iter()
            .any(|generation| *generation != 0)
}

fn take_dirty_tile(
    delivery: &mut DeliveryState,
    request_wake: &Notify,
) -> Result<Option<DeliveredFrame>, VncError> {
    let DeliveryState {
        framebuffer,
        diagnostics,
        ..
    } = delivery;
    if framebuffer.update_in_progress
        || framebuffer.delivery_suspended
        || !framebuffer.renderer_active
        || framebuffer.awaiting_full_delivery_epoch.is_some()
        || framebuffer.width == 0
        || framebuffer.height == 0
    {
        return Ok(None);
    }
    if framebuffer.updates_since_ack > 1 && !framebuffer.gap_epoch_active {
        framebuffer.gap_epoch_active = true;
        require_full_refresh(framebuffer)?;
        request_wake.notify_one();
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
    let rect = DecodedRect {
        x: x as u16,
        y: y as u16,
        width: width as u16,
        height: height as u16,
        source_x: None,
        source_y: None,
        pixels,
    };
    framebuffer.next_frame_token = framebuffer
        .next_frame_token
        .checked_add(1)
        .filter(|token| *token <= MAX_VNC_ACTIVITY_GENERATION)
        .ok_or_else(|| delivery_error("VNC frame token overflow"))?;
    let frame = DeliveredFrame {
        rect,
        delivery_epoch: framebuffer.delivery_epoch,
        frame_token: framebuffer.next_frame_token,
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

    fn solid_rect(width: u16, height: u16, value: u8) -> DecodedRect {
        let mut pixels = Vec::with_capacity(width as usize * height as usize * 4);
        for _ in 0..width as usize * height as usize {
            pixels.extend_from_slice(&[value, value, value, 255]);
        }
        DecodedRect {
            x: 0,
            y: 0,
            width,
            height,
            source_x: None,
            source_y: None,
            pixels,
        }
    }

    fn commit_update(sender: &VncEventSender, rect: DecodedRect) {
        sender.begin_framebuffer_update().unwrap();
        sender.apply_frame(rect).unwrap();
        sender.finish_framebuffer_update().unwrap();
    }

    fn commit_request(mut reservation: RefreshRequestReservation) {
        reservation.activate().unwrap();
        reservation.commit().unwrap();
    }

    fn frame_from(events: Vec<SessionEvent>) -> DecodedRect {
        events
            .into_iter()
            .find_map(|event| match event {
                SessionEvent::Frame(frame) => Some(frame.rect),
                _ => None,
            })
            .expect("expected one dirty-tile frame")
    }

    fn delivered_frame_from(events: Vec<SessionEvent>) -> DeliveredFrame {
        events
            .into_iter()
            .find_map(|event| match event {
                SessionEvent::Frame(frame) => Some(frame),
                _ => None,
            })
            .expect("expected one delivered VNC frame")
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
            draw_frame(&mut framebuffer, width, &frame.rect);
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
            let (sender, receiver) = event_delivery();
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
        let (sender, receiver) = event_delivery();
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
        let (sender, receiver) = event_delivery();
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
        let (sender, receiver) = event_delivery();
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
        let (sender, receiver) = event_delivery();
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
        let (sender, receiver) = event_delivery();
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
        let (sender, receiver) = event_delivery();
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
        let (sender, receiver) = event_delivery();
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
        let (sender, receiver) = event_delivery();
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
    fn scheduled_request_consumes_one_forced_full_without_losing_newer_pixels() {
        let (sender, receiver) = event_delivery();
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
        let older = sender.reserve_update_request(true).unwrap().unwrap();
        assert!(!older.incremental());

        sender.resize_framebuffer(3, 1).unwrap();
        commit_request(older);
        sender.test_complete_request().unwrap();
        let newer = sender.reserve_update_request(true).unwrap().unwrap();
        assert!(!newer.incremental());
        commit_request(newer);
        sender.test_complete_request().unwrap();
        let incremental = sender.reserve_update_request(true).unwrap().unwrap();
        assert!(incremental.incremental());
    }

    #[test]
    fn aborted_update_suspends_frames_and_preserves_terminal_exclusivity() {
        let (sender, receiver) = event_delivery();
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
        let (sender, receiver) = event_delivery();
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
        let (sender, receiver) = event_delivery();
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
        let (sender, receiver) = event_delivery();
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
        let (sender, receiver) = event_delivery();
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
    fn activity_authority_rejects_every_equal_or_stale_generation() {
        let (sender, _receiver) = event_delivery();
        sender.initialize_framebuffer(1, 1).unwrap();

        let first_owner = sender.set_activity("session", true, 5).unwrap();
        assert!(first_owner.accepted);
        assert!(first_owner.refresh_queued);
        assert_eq!(first_owner.delivery_epoch, 2);

        let stale_same_state = sender.set_activity("session", true, 1).unwrap();
        assert!(!stale_same_state.accepted);
        assert_eq!(stale_same_state.activity_generation, 5);
        assert!(stale_same_state.active);
        assert_eq!(stale_same_state.delivery_epoch, 2);

        let equal_same_state = sender.set_activity("session", true, 5).unwrap();
        assert!(!equal_same_state.accepted);
        assert!(!equal_same_state.refresh_queued);
        let equal_conflict = sender.set_activity("session", false, 5).unwrap();
        assert!(!equal_conflict.accepted);
        assert!(equal_conflict.active);

        let corrected_owner = sender.set_activity("session", true, 6).unwrap();
        assert!(corrected_owner.accepted);
        assert!(corrected_owner.refresh_queued);
        assert_eq!(corrected_owner.delivery_epoch, 3);
    }

    #[test]
    fn delivery_epoch_fails_closed_at_javascript_safe_boundary() {
        let (sender, _receiver) = event_delivery();
        sender.initialize_framebuffer(1, 1).unwrap();
        {
            let mut delivery = lock_delivery(&sender.shared).unwrap();
            delivery.framebuffer.delivery_epoch = MAX_VNC_ACTIVITY_GENERATION;
        }

        let error = sender
            .set_activity("session", true, 1)
            .expect_err("delivery epoch must not exceed the JS-safe boundary");
        assert!(error.message.contains("delivery epoch overflow"));
        let delivery = lock_delivery(&sender.shared).unwrap();
        assert_eq!(delivery.framebuffer.activity_generation, 0);
        assert_eq!(
            delivery.framebuffer.delivery_epoch,
            MAX_VNC_ACTIVITY_GENERATION
        );
        assert!(!delivery.framebuffer.force_full_refresh);
    }

    #[test]
    fn replacement_mount_wins_before_or_after_old_final_inactive() {
        let (sender, _receiver) = event_delivery();
        sender.initialize_framebuffer(1, 1).unwrap();
        assert!(sender.set_activity("session", true, 1).unwrap().accepted);

        let replacement_first = sender.set_activity("session", true, 3).unwrap();
        assert!(replacement_first.accepted);
        assert!(replacement_first.refresh_queued);
        let delayed_old_final = sender.set_activity("session", false, 2).unwrap();
        assert!(!delayed_old_final.accepted);
        assert!(delayed_old_final.active);
        assert_eq!(delayed_old_final.activity_generation, 3);

        let (sender, _receiver) = event_delivery();
        sender.initialize_framebuffer(1, 1).unwrap();
        assert!(sender.set_activity("session", true, 1).unwrap().accepted);
        assert!(sender.set_activity("session", false, 2).unwrap().accepted);
        let replacement_after = sender.set_activity("session", true, 3).unwrap();
        assert!(replacement_after.accepted);
        assert!(replacement_after.active);
        assert!(replacement_after.refresh_queued);
        assert_eq!(replacement_after.delivery_epoch, 3);

        let equal_old_final = sender.set_activity("session", false, 3).unwrap();
        assert!(!equal_old_final.accepted);
        assert!(equal_old_final.active);
    }

    #[test]
    fn inactive_rejects_ack_without_releasing_in_flight_tile() {
        let (sender, receiver) = event_delivery();
        sender.initialize_framebuffer(1, 1).unwrap();
        commit_update(&sender, pixel_rect(0, 4));
        let first = delivered_frame_from(receiver.drain(2).unwrap());

        let inactive = sender.set_activity("session", false, 1).unwrap();
        assert!(inactive.accepted);
        let rejected = sender
            .acknowledge_rendered_tile("session", first.delivery_epoch, first.frame_token)
            .unwrap();
        assert!(!rejected.accepted);
        {
            let delivery = lock_delivery(&sender.shared).unwrap();
            assert!(delivery.framebuffer.in_flight.is_some());
            assert!(delivery.framebuffer.dirty_generation[0] > 0);
        }
        assert!(receiver.drain_frame_only().unwrap().is_none());

        let resumed = sender.set_activity("session", true, 2).unwrap();
        assert!(resumed.accepted);
        assert!(resumed.refresh_queued);
        assert_eq!(resumed.delivery_epoch, first.delivery_epoch + 1);
        let stale = sender
            .acknowledge_rendered_tile("session", first.delivery_epoch, first.frame_token)
            .unwrap();
        assert!(!stale.accepted);
        assert!(receiver.drain_frame_only().unwrap().is_none());
    }

    #[test]
    fn generic_refresh_never_acknowledges_renderer_tile() {
        let (sender, receiver) = event_delivery();
        sender.initialize_framebuffer(1, 1).unwrap();
        commit_update(&sender, pixel_rect(0, 8));
        let first = delivered_frame_from(receiver.drain(2).unwrap());

        let refresh = sender.reserve_update_request(true).unwrap().unwrap();
        assert!(refresh.incremental());
        commit_request(refresh);
        let replay = delivered_frame_from(receiver.drain(2).unwrap());
        assert_eq!(replay.delivery_epoch, first.delivery_epoch);
        assert_eq!(replay.frame_token, first.frame_token);
        assert_eq!(replay.rect.pixels, first.rect.pixels);

        let wrong_token = sender
            .acknowledge_rendered_tile("session", first.delivery_epoch, first.frame_token + 1)
            .unwrap();
        assert!(!wrong_token.accepted);
        let replay = delivered_frame_from(receiver.drain(2).unwrap());
        assert_eq!(replay.frame_token, first.frame_token);

        let accepted = sender
            .acknowledge_rendered_tile("session", first.delivery_epoch, first.frame_token)
            .unwrap();
        assert!(accepted.accepted);
        assert!(receiver.drain_frame_only().unwrap().is_none());
    }

    #[test]
    fn resume_waits_for_proven_full_repaint_after_idle_incremental() {
        let (sender, receiver) = event_delivery();
        sender.initialize_framebuffer(512, 1).unwrap();

        let idle_incremental = sender.reserve_update_request(true).unwrap().unwrap();
        assert!(idle_incremental.incremental());
        commit_request(idle_incremental);
        let resumed = sender.set_activity("session", true, 1).unwrap();
        assert!(resumed.accepted);
        assert!(resumed.refresh_queued);

        let forced = sender.reserve_update_request(true).unwrap().unwrap();
        assert!(!forced.incremental());
        commit_request(forced);
        assert_eq!(sender.test_request_state().unwrap(), (false, true, true));

        // Even a complete response to the older incremental request consumes
        // only normal credit; it cannot satisfy the newer forced epoch.
        commit_update(&sender, solid_rect(512, 1, 3));
        assert_eq!(sender.test_request_state().unwrap(), (false, false, true));
        assert!(receiver.drain_frame_only().unwrap().is_none());
        assert!(sender.reserve_update_request(true).unwrap().is_none());

        // The full canonical response proves the forced repaint. Only now may
        // the new epoch drain, with fresh epoch-scoped tokens.
        commit_update(&sender, solid_rect(512, 1, 9));
        assert_eq!(sender.test_request_state().unwrap(), (false, false, false));
        let mut delivered_tiles = 0;
        while let Some(frame) = receiver.drain_frame_only().unwrap() {
            assert_eq!(frame.delivery_epoch, resumed.delivery_epoch);
            assert!(frame.frame_token > 0);
            assert!(frame.rect.pixels.chunks_exact(4).all(|pixel| pixel[0] == 9));
            let ack = sender
                .acknowledge_rendered_tile("session", frame.delivery_epoch, frame.frame_token)
                .unwrap();
            assert!(ack.accepted);
            delivered_tiles += 1;
        }
        assert_eq!(delivered_tiles, 2);

        let next = sender.reserve_update_request(true).unwrap().unwrap();
        assert!(next.incremental());
    }

    #[test]
    fn forced_resize_and_partial_responses_retry_without_overlapping_credit() {
        let (sender, receiver) = event_delivery();
        sender.initialize_framebuffer(256, 1).unwrap();
        let resumed = sender.set_activity("session", true, 1).unwrap();
        assert!(resumed.accepted);

        let resize_request = sender.reserve_update_request(true).unwrap().unwrap();
        assert!(!resize_request.incremental());
        commit_request(resize_request);
        assert_eq!(sender.test_request_state().unwrap(), (false, false, true));

        // A DesktopSize-only response consumes the forced wire credit but
        // cannot open renderer delivery. It must permit one sequential full
        // retry at the new dimensions.
        let resize = sender.framebuffer_update().unwrap();
        sender.resize_framebuffer(512, 1).unwrap();
        resize.finish().unwrap();
        assert_eq!(sender.test_request_state().unwrap(), (false, false, false));
        assert_eq!(sender.test_framebuffer_dimensions().unwrap(), (512, 1));
        assert!(receiver.drain_frame_only().unwrap().is_none());

        let partial_request = sender.reserve_update_request(true).unwrap().unwrap();
        assert!(!partial_request.incremental());
        commit_request(partial_request);
        for _ in 0..1_000 {
            assert!(sender.reserve_update_request(true).unwrap().is_none());
        }

        // A partial response similarly releases its consumed credit while the
        // full-delivery gate remains closed and exactly one retry is eligible.
        commit_update(&sender, pixel_rect(0, 4));
        assert_eq!(sender.test_request_state().unwrap(), (false, false, false));
        assert!(receiver.drain_frame_only().unwrap().is_none());

        let full_request = sender.reserve_update_request(true).unwrap().unwrap();
        assert!(!full_request.incremental());
        commit_request(full_request);
        for _ in 0..1_000 {
            assert!(sender.reserve_update_request(true).unwrap().is_none());
        }

        commit_update(&sender, solid_rect(512, 1, 9));
        assert_eq!(sender.test_request_state().unwrap(), (false, false, false));
        let mut delivered_tiles = 0;
        while let Some(frame) = receiver.drain_frame_only().unwrap() {
            assert_eq!(frame.delivery_epoch, resumed.delivery_epoch);
            let ack = sender
                .acknowledge_rendered_tile("session", frame.delivery_epoch, frame.frame_token)
                .unwrap();
            assert!(ack.accepted);
            delivered_tiles += 1;
        }
        assert_eq!(delivered_tiles, 2);
    }

    #[test]
    fn normal_responses_before_write_finalize_do_not_create_phantom_credit() {
        let (sender, _receiver) = event_delivery();
        sender.initialize_framebuffer(2, 1).unwrap();

        let mut partial = sender.reserve_update_request(true).unwrap().unwrap();
        assert!(partial.incremental());
        partial.activate().unwrap();
        assert_eq!(sender.test_request_state().unwrap(), (true, true, false));
        commit_update(&sender, pixel_rect(0, 3));
        assert_eq!(sender.test_request_state().unwrap(), (true, false, false));
        partial.commit().unwrap();
        assert_eq!(sender.test_request_state().unwrap(), (false, false, false));

        let mut full = sender.reserve_update_request(true).unwrap().unwrap();
        assert!(full.incremental());
        full.activate().unwrap();
        commit_update(&sender, solid_rect(2, 1, 7));
        assert_eq!(sender.test_request_state().unwrap(), (true, false, false));
        full.commit().unwrap();
        assert_eq!(sender.test_request_state().unwrap(), (false, false, false));

        let next = sender.reserve_update_request(true).unwrap().unwrap();
        assert!(next.incremental());
    }

    #[test]
    fn activated_reservation_drop_rolls_back_unconsumed_wire_credit() {
        let (sender, _receiver) = event_delivery();
        sender.initialize_framebuffer(1, 1).unwrap();

        let mut normal = sender.reserve_update_request(true).unwrap().unwrap();
        normal.activate().unwrap();
        assert_eq!(sender.test_request_state().unwrap(), (true, true, false));
        drop(normal);
        assert_eq!(sender.test_request_state().unwrap(), (false, false, false));

        assert!(sender.set_activity("session", true, 1).unwrap().accepted);
        let mut forced = sender.reserve_update_request(true).unwrap().unwrap();
        assert!(!forced.incremental());
        forced.activate().unwrap();
        assert_eq!(sender.test_request_state().unwrap(), (true, false, true));
        drop(forced);
        assert_eq!(sender.test_request_state().unwrap(), (false, false, false));

        let retry = sender.reserve_update_request(true).unwrap().unwrap();
        assert!(!retry.incremental());
    }

    #[test]
    fn forced_responses_before_write_finalize_preserve_full_gate_and_retry_bound() {
        let (sender, receiver) = event_delivery();
        sender.initialize_framebuffer(256, 1).unwrap();
        let resumed = sender.set_activity("session", true, 1).unwrap();
        assert!(resumed.accepted);

        let mut partial = sender.reserve_update_request(true).unwrap().unwrap();
        assert!(!partial.incremental());
        partial.activate().unwrap();
        commit_update(&sender, pixel_rect(0, 4));
        assert_eq!(sender.test_request_state().unwrap(), (true, false, false));
        assert!(receiver.drain_frame_only().unwrap().is_none());
        partial.commit().unwrap();
        assert_eq!(sender.test_request_state().unwrap(), (false, false, false));

        let mut resize = sender.reserve_update_request(true).unwrap().unwrap();
        assert!(!resize.incremental());
        for _ in 0..1_000 {
            assert!(sender.reserve_update_request(true).unwrap().is_none());
        }
        resize.activate().unwrap();
        let update = sender.framebuffer_update().unwrap();
        sender.resize_framebuffer(512, 1).unwrap();
        update.finish().unwrap();
        assert_eq!(sender.test_request_state().unwrap(), (true, false, false));
        assert!(receiver.drain_frame_only().unwrap().is_none());
        resize.commit().unwrap();
        assert_eq!(sender.test_request_state().unwrap(), (false, false, false));

        let mut full = sender.reserve_update_request(true).unwrap().unwrap();
        assert!(!full.incremental());
        for _ in 0..1_000 {
            assert!(sender.reserve_update_request(true).unwrap().is_none());
        }
        full.activate().unwrap();
        commit_update(&sender, solid_rect(512, 1, 9));
        assert_eq!(sender.test_request_state().unwrap(), (true, false, false));
        full.commit().unwrap();
        assert_eq!(sender.test_request_state().unwrap(), (false, false, false));

        let mut delivered_tiles = 0;
        while let Some(frame) = receiver.drain_frame_only().unwrap() {
            assert_eq!(frame.delivery_epoch, resumed.delivery_epoch);
            let ack = sender
                .acknowledge_rendered_tile("session", frame.delivery_epoch, frame.frame_token)
                .unwrap();
            assert!(ack.accepted);
            delivered_tiles += 1;
        }
        assert_eq!(delivered_tiles, 2);

        let next = sender.reserve_update_request(true).unwrap().unwrap();
        assert!(next.incremental());
    }

    #[test]
    fn request_and_timer_floods_keep_one_normal_plus_one_forced_credit() {
        for flood in [100usize, 500, 1_000] {
            let (sender, _receiver) = event_delivery();
            sender.initialize_framebuffer(1, 1).unwrap();
            let mut normal_admissions = 0;
            for _ in 0..flood {
                if let Some(request) = sender.reserve_update_request(true).unwrap() {
                    assert!(request.incremental());
                    commit_request(request);
                    normal_admissions += 1;
                }
            }
            assert_eq!(normal_admissions, 1);
            assert_eq!(sender.test_request_state().unwrap(), (false, true, false));

            let claim = sender.set_activity("session", true, 1).unwrap();
            assert!(claim.accepted);
            assert!(claim.refresh_queued);
            let mut forced_admissions = 0;
            for _ in 0..flood {
                if let Some(request) = sender.reserve_update_request(true).unwrap() {
                    assert!(!request.incremental());
                    commit_request(request);
                    forced_admissions += 1;
                }
            }
            assert_eq!(forced_admissions, 1);
            assert_eq!(sender.test_request_state().unwrap(), (false, true, true));

            let replacement = sender.set_activity("session", true, 2).unwrap();
            assert!(replacement.accepted);
            assert!(replacement.refresh_queued);
            assert!(sender.reserve_update_request(true).unwrap().is_none());
            let delivery = lock_delivery(&sender.shared).unwrap();
            assert_eq!(delivery.framebuffer.awaiting_full_delivery_epoch, Some(3));
            assert!(delivery.framebuffer.force_full_refresh);
        }
    }

    #[tokio::test(start_paused = true)]
    async fn inactive_authorities_have_zero_high_rate_scheduler_wakes() {
        for flood in [100u64, 500, 1_000] {
            let (sender, _receiver) = event_delivery();
            sender.initialize_framebuffer(1, 1).unwrap();
            for generation in 1..=flood {
                let result = sender.set_activity("session", false, generation).unwrap();
                assert!(result.accepted);
                assert!(!result.refresh_queued);
                assert!(sender.reserve_update_request(true).unwrap().is_none());
            }

            assert!(
                tokio::time::timeout(
                    std::time::Duration::from_secs(3_600),
                    sender.test_wait_for_request_wake(),
                )
                .await
                .is_err(),
                "inactive activity changes must not wake the request scheduler"
            );

            let active = sender.set_activity("session", true, flood + 1).unwrap();
            assert!(active.accepted);
            assert!(active.refresh_queued);
            tokio::time::timeout(
                std::time::Duration::from_secs(1),
                sender.test_wait_for_request_wake(),
            )
            .await
            .expect("active ownership must wake the request scheduler");
        }
    }

    #[tokio::test(start_paused = true)]
    async fn committed_response_emits_one_coalesced_progress_wake() {
        let (sender, _receiver) = event_delivery();
        sender.initialize_framebuffer(1, 1).unwrap();
        let request = sender.reserve_update_request(true).unwrap().unwrap();
        commit_request(request);
        assert_eq!(sender.test_request_state().unwrap(), (false, true, false));

        commit_update(&sender, pixel_rect(0, 6));
        tokio::time::timeout(
            std::time::Duration::from_secs(1),
            sender.test_wait_for_request_wake(),
        )
        .await
        .expect("a committed response must wake request progression");

        let next = sender.reserve_update_request(true).unwrap().unwrap();
        assert!(next.incremental());
        commit_request(next);
        for _ in 0..1_000 {
            assert!(sender.reserve_update_request(true).unwrap().is_none());
        }
        assert_eq!(sender.test_request_state().unwrap(), (false, true, false));
    }

    #[test]
    fn inactive_frame_and_control_flood_remains_bounded_and_terminal_wins() {
        let (sender, receiver) = event_delivery();
        sender.initialize_framebuffer(1, 1).unwrap();
        assert!(sender.set_activity("session", false, 1).unwrap().accepted);
        for value in 0..1_000u16 {
            commit_update(&sender, pixel_rect(0, value as u8));
            sender.publish_control(SessionEvent::Bell).unwrap();
        }
        assert!(sender.reserve_update_request(true).unwrap().is_none());
        {
            let delivery = lock_delivery(&sender.shared).unwrap();
            assert_eq!(delivery.framebuffer.pixels.len(), 4);
            assert!(delivery.framebuffer.dirty_generation.len() <= MAX_DIRTY_TILES);
            assert!(delivery.framebuffer.in_flight.is_none());
            assert!(delivery.controls.len() <= MAX_PENDING_CONTROL_ENTRIES);
            assert!(delivery.control_bytes <= MAX_PENDING_CONTROL_BYTES);
        }
        let controls = receiver.drain(MAX_VNC_DRAIN_EVENTS).unwrap();
        assert!(controls
            .iter()
            .all(|event| !matches!(event, SessionEvent::Frame(_))));

        sender
            .publish_control(SessionEvent::Disconnected(Some("closed".into())))
            .unwrap();
        assert!(sender.set_activity("session", true, 2).is_err());
        assert!(matches!(
            receiver.drain(2).unwrap().as_slice(),
            [SessionEvent::Disconnected(Some(reason))] if reason == "closed"
        ));

        let (replacement, _receiver) = event_delivery();
        replacement.initialize_framebuffer(1, 1).unwrap();
        let new_claim = replacement.set_activity("replacement", true, 1).unwrap();
        assert!(new_claim.accepted);
        assert_eq!(new_claim.delivery_epoch, 2);
    }

    #[test]
    fn utf8_truncation_stays_on_codepoint_boundary_and_records_pressure() {
        let (sender, receiver) = event_delivery();
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
