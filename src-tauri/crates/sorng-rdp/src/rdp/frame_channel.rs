//! Framework-agnostic frame delivery channel.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

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

/// Per-session frame-delivery accounting.
///
/// One instance is owned by the active-session loop and passed by reference to
/// the frame-send helpers. Unlike the previous process-global
/// `HashMap<Arc-ptr, snapshot>`, this carries no cross-session lock (the frame
/// hot path no longer serializes all sessions through one mutex), leaks no
/// per-session entry (it drops with the session), and cannot suffer
/// Arc-pointer key reuse (there is no pointer key). All counters are lock-free
/// atomics.
#[derive(Debug, Default)]
pub struct FrameDeliveryAccounting {
    attempted_frames: AtomicU64,
    delivered_frames: AtomicU64,
    failed_frames: AtomicU64,
    attempted_bytes: AtomicU64,
    delivered_bytes: AtomicU64,
    failed_bytes: AtomicU64,
    rgba_frames: AtomicU64,
    nal_frames: AtomicU64,
    full_frame_syncs: AtomicU64,
    compositor_frames: AtomicU64,
    multi_rect_batches: AtomicU64,
}

impl FrameDeliveryAccounting {
    pub fn new() -> Self {
        Self::default()
    }

    fn record_attempt(&self, kind: FramePayloadKind, bytes: u64) {
        self.attempted_frames.fetch_add(1, Ordering::Relaxed);
        self.attempted_bytes.fetch_add(bytes, Ordering::Relaxed);
        match kind {
            FramePayloadKind::Nal => {
                self.nal_frames.fetch_add(1, Ordering::Relaxed);
            }
            FramePayloadKind::FullFrame => {
                self.rgba_frames.fetch_add(1, Ordering::Relaxed);
                self.full_frame_syncs.fetch_add(1, Ordering::Relaxed);
            }
            FramePayloadKind::Compositor => {
                self.rgba_frames.fetch_add(1, Ordering::Relaxed);
                self.compositor_frames.fetch_add(1, Ordering::Relaxed);
            }
            FramePayloadKind::RgbaRects => {
                self.rgba_frames.fetch_add(1, Ordering::Relaxed);
                self.multi_rect_batches.fetch_add(1, Ordering::Relaxed);
            }
            FramePayloadKind::RgbaRect => {
                self.rgba_frames.fetch_add(1, Ordering::Relaxed);
            }
        }
    }

    fn record_success(&self, bytes: u64) {
        self.delivered_frames.fetch_add(1, Ordering::Relaxed);
        self.delivered_bytes.fetch_add(bytes, Ordering::Relaxed);
    }

    fn record_failure(&self, bytes: u64) {
        self.failed_frames.fetch_add(1, Ordering::Relaxed);
        self.failed_bytes.fetch_add(bytes, Ordering::Relaxed);
    }

    /// Snapshot the current counters into the serializable summary.
    pub fn snapshot(&self) -> FrameDeliverySnapshot {
        FrameDeliverySnapshot {
            attempted_frames: self.attempted_frames.load(Ordering::Relaxed),
            delivered_frames: self.delivered_frames.load(Ordering::Relaxed),
            failed_frames: self.failed_frames.load(Ordering::Relaxed),
            attempted_bytes: self.attempted_bytes.load(Ordering::Relaxed),
            delivered_bytes: self.delivered_bytes.load(Ordering::Relaxed),
            failed_bytes: self.failed_bytes.load(Ordering::Relaxed),
            rgba_frames: self.rgba_frames.load(Ordering::Relaxed),
            nal_frames: self.nal_frames.load(Ordering::Relaxed),
            full_frame_syncs: self.full_frame_syncs.load(Ordering::Relaxed),
            compositor_frames: self.compositor_frames.load(Ordering::Relaxed),
            multi_rect_batches: self.multi_rect_batches.load(Ordering::Relaxed),
        }
    }
}

pub fn send_accounted_frame(
    accounting: &FrameDeliveryAccounting,
    frame_channel: &DynFrameChannel,
    kind: FramePayloadKind,
    data: Vec<u8>,
) -> Result<(), String> {
    let bytes = data.len() as u64;
    accounting.record_attempt(kind, bytes);

    match frame_channel.send_raw(data) {
        Ok(()) => {
            accounting.record_success(bytes);
            Ok(())
        }
        Err(error) => {
            accounting.record_failure(bytes);
            Err(error)
        }
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
        let accounting = FrameDeliveryAccounting::new();

        send_accounted_frame(
            &accounting,
            &frame_channel,
            FramePayloadKind::FullFrame,
            vec![1, 2, 3, 4],
        )
        .expect("noop channel should accept payloads");

        let snapshot = accounting.snapshot();
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
        let accounting = FrameDeliveryAccounting::new();

        let result =
            send_accounted_frame(&accounting, &frame_channel, FramePayloadKind::Nal, vec![0; 16]);

        assert!(result.is_err());
        let snapshot = accounting.snapshot();
        assert_eq!(snapshot.attempted_frames, 1);
        assert_eq!(snapshot.delivered_frames, 0);
        assert_eq!(snapshot.failed_frames, 1);
        assert_eq!(snapshot.failed_bytes, 16);
        assert_eq!(snapshot.nal_frames, 1);
    }

    #[test]
    fn frame_channel_accounting_is_independent_per_session() {
        // Two sessions with their own accounting never share counters — the old
        // global map keyed by Arc pointer could alias reused addresses; this
        // per-session design cannot.
        let ch: DynFrameChannel = Arc::new(NoopFrameChannel);
        let session_a = FrameDeliveryAccounting::new();
        let session_b = FrameDeliveryAccounting::new();

        send_accounted_frame(&session_a, &ch, FramePayloadKind::RgbaRect, vec![0; 8])
            .expect("noop channel accepts payloads");

        assert_eq!(session_a.snapshot().attempted_frames, 1);
        assert_eq!(session_b.snapshot().attempted_frames, 0);
    }
}
