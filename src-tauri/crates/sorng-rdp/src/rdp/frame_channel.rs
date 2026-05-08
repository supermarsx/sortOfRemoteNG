//! Framework-agnostic frame delivery channel.

use std::collections::HashMap;
use std::sync::Arc;
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};

/// Trait for sending raw frame data to the frontend.
///
/// Implementations must be `Send + Sync + 'static` so they can be shared
/// across threads. In the Tauri app layer this wraps
/// `Channel<InvokeResponseBody>`.
pub trait FrameChannel: Send + Sync + 'static {
    /// Send a raw binary frame payload.
    fn send_raw(&self, data: Vec<u8>) -> Result<(), String>;
}

/// Type alias for a shared, boxed frame channel.
pub type DynFrameChannel = Arc<dyn FrameChannel>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FramePayloadKind {
    RgbaRect,
    RgbaRects,
    FullFrame,
    Compositor,
    Nal,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameDeliverySnapshot {
    pub attempted_frames: u64,
    pub delivered_frames: u64,
    pub failed_frames: u64,
    pub attempted_bytes: u64,
    pub delivered_bytes: u64,
    pub failed_bytes: u64,
    pub rgba_frames: u64,
    pub nal_frames: u64,
    pub full_frame_syncs: u64,
    pub compositor_frames: u64,
    pub multi_rect_batches: u64,
}

static FRAME_DELIVERY_ACCOUNTING: OnceLock<Mutex<HashMap<usize, FrameDeliverySnapshot>>> =
    OnceLock::new();

fn delivery_accounting() -> &'static Mutex<HashMap<usize, FrameDeliverySnapshot>> {
    FRAME_DELIVERY_ACCOUNTING.get_or_init(|| Mutex::new(HashMap::new()))
}

fn accounting_key(frame_channel: &DynFrameChannel) -> usize {
    Arc::as_ptr(frame_channel) as *const () as usize
}

fn record_delivery_attempt(snapshot: &mut FrameDeliverySnapshot, kind: FramePayloadKind, bytes: u64) {
    snapshot.attempted_frames = snapshot.attempted_frames.saturating_add(1);
    snapshot.attempted_bytes = snapshot.attempted_bytes.saturating_add(bytes);
    match kind {
        FramePayloadKind::Nal => {
            snapshot.nal_frames = snapshot.nal_frames.saturating_add(1);
        }
        FramePayloadKind::FullFrame => {
            snapshot.rgba_frames = snapshot.rgba_frames.saturating_add(1);
            snapshot.full_frame_syncs = snapshot.full_frame_syncs.saturating_add(1);
        }
        FramePayloadKind::Compositor => {
            snapshot.rgba_frames = snapshot.rgba_frames.saturating_add(1);
            snapshot.compositor_frames = snapshot.compositor_frames.saturating_add(1);
        }
        FramePayloadKind::RgbaRects => {
            snapshot.rgba_frames = snapshot.rgba_frames.saturating_add(1);
            snapshot.multi_rect_batches = snapshot.multi_rect_batches.saturating_add(1);
        }
        FramePayloadKind::RgbaRect => {
            snapshot.rgba_frames = snapshot.rgba_frames.saturating_add(1);
        }
    }
}

fn with_delivery_snapshot(
    frame_channel: &DynFrameChannel,
    update: impl FnOnce(&mut FrameDeliverySnapshot),
) {
    if let Ok(mut accounting) = delivery_accounting().lock() {
        let snapshot = accounting.entry(accounting_key(frame_channel)).or_default();
        update(snapshot);
    }
}

pub fn send_accounted_frame(
    frame_channel: &DynFrameChannel,
    kind: FramePayloadKind,
    data: Vec<u8>,
) -> Result<(), String> {
    let bytes = data.len() as u64;
    with_delivery_snapshot(frame_channel, |snapshot| {
        record_delivery_attempt(snapshot, kind, bytes);
    });

    match frame_channel.send_raw(data) {
        Ok(()) => {
            with_delivery_snapshot(frame_channel, |snapshot| {
                snapshot.delivered_frames = snapshot.delivered_frames.saturating_add(1);
                snapshot.delivered_bytes = snapshot.delivered_bytes.saturating_add(bytes);
            });
            Ok(())
        }
        Err(error) => {
            with_delivery_snapshot(frame_channel, |snapshot| {
                snapshot.failed_frames = snapshot.failed_frames.saturating_add(1);
                snapshot.failed_bytes = snapshot.failed_bytes.saturating_add(bytes);
            });
            Err(error)
        }
    }
}

pub fn frame_delivery_snapshot(frame_channel: &DynFrameChannel) -> FrameDeliverySnapshot {
    delivery_accounting()
        .lock()
        .ok()
        .and_then(|accounting| accounting.get(&accounting_key(frame_channel)).cloned())
        .unwrap_or_default()
}

#[allow(dead_code)]
pub fn reset_frame_delivery_accounting(frame_channel: &DynFrameChannel) {
    if let Ok(mut accounting) = delivery_accounting().lock() {
        accounting.remove(&accounting_key(frame_channel));
    }
}

/// A no-op frame channel that discards all data.
pub struct NoopFrameChannel;

impl FrameChannel for NoopFrameChannel {
    fn send_raw(&self, _data: Vec<u8>) -> Result<(), String> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct FailingFrameChannel;

    impl FrameChannel for FailingFrameChannel {
        fn send_raw(&self, _data: Vec<u8>) -> Result<(), String> {
            Err("channel closed".to_string())
        }
    }

    #[test]
    fn frame_channel_accounting_records_delivery_success() {
        let frame_channel: DynFrameChannel = Arc::new(NoopFrameChannel);
        reset_frame_delivery_accounting(&frame_channel);

        send_accounted_frame(&frame_channel, FramePayloadKind::FullFrame, vec![1, 2, 3, 4])
            .expect("noop channel should accept payloads");

        let snapshot = frame_delivery_snapshot(&frame_channel);
        assert_eq!(snapshot.attempted_frames, 1);
        assert_eq!(snapshot.delivered_frames, 1);
        assert_eq!(snapshot.failed_frames, 0);
        assert_eq!(snapshot.attempted_bytes, 4);
        assert_eq!(snapshot.delivered_bytes, 4);
        assert_eq!(snapshot.full_frame_syncs, 1);
        assert_eq!(snapshot.rgba_frames, 1);
    }

    #[test]
    fn frame_channel_accounting_records_delivery_failure() {
        let frame_channel: DynFrameChannel = Arc::new(FailingFrameChannel);
        reset_frame_delivery_accounting(&frame_channel);

        let result = send_accounted_frame(&frame_channel, FramePayloadKind::Nal, vec![0; 16]);

        assert!(result.is_err());
        let snapshot = frame_delivery_snapshot(&frame_channel);
        assert_eq!(snapshot.attempted_frames, 1);
        assert_eq!(snapshot.delivered_frames, 0);
        assert_eq!(snapshot.failed_frames, 1);
        assert_eq!(snapshot.failed_bytes, 16);
        assert_eq!(snapshot.nal_frames, 1);
    }
}
