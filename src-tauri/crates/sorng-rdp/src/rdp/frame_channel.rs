//! Framework-agnostic frame delivery channel.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use serde::{Deserialize, Serialize};

/// Trait for sending raw frame data to the frontend.
///
/// Implementations must be `Send + Sync + 'static` so they can be shared
/// across threads. In the Tauri app layer this wraps
/// `Channel<InvokeResponseBody>`.
pub trait FrameChannel: Send + Sync + 'static {
    /// Send a raw binary frame payload.
    fn send_raw(&self, data: Vec<u8>) -> Result<(), String>;

    /// Cheap capacity probe used before allocating/copying a raw payload.
    /// The definitive reservation still occurs inside `send_raw`.
    fn can_send_payload(&self, _bytes: usize) -> bool {
        true
    }

    /// Record frames dropped before transport reservation (for example, by a
    /// bounded decoder mailbox) so the next acknowledgement can surface an
    /// incremental-codec recovery requirement to the frontend.
    fn record_delivery_drop(&self, _count: u64, _nal_chain_broken: bool) -> Result<(), String> {
        Ok(())
    }
}

/// Type alias for a shared, boxed frame channel.
pub type DynFrameChannel = Arc<dyn FrameChannel>;

/// Maximum size of one frame retained at the native-to-webview boundary.
/// Keep this synchronized with `MAX_RDP_FRAME_PAYLOAD_BYTES` in the frontend.
pub const MAX_RDP_FRAME_PAYLOAD_BYTES: usize = 32 * 1024 * 1024;

/// The whole process may have at most this many raw frame bodies waiting for
/// JavaScript Channel callbacks. The byte ceiling is authoritative for large
/// frames (for example, one 4K RGBA frame nearly fills it by itself).
pub const MAX_RDP_IN_FLIGHT_FRAME_COUNT: usize = 2;
pub const MAX_RDP_IN_FLIGHT_FRAME_BYTES: usize = MAX_RDP_FRAME_PAYLOAD_BYTES;

/// Successful acknowledgements are retained briefly so a frontend retry is
/// idempotent when native processing succeeded but its invoke response was
/// lost. This is deliberately fixed-size: delivery history cannot become a
/// second unbounded queue.
const MAX_RDP_DELIVERY_ACK_TOMBSTONES: usize = 64;

/// Drop/recovery telemetry can precede the next successful delivery. Active
/// RDP sessions are already capped well below this value; the fixed ceiling
/// protects against viewer churn without allowing an unbounded channel map.
const MAX_RDP_DELIVERY_PRESSURE_CHANNELS: usize = 32;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameDeliveryCreditSnapshot {
    pub in_flight_frames: usize,
    pub in_flight_bytes: usize,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameDeliveryAcknowledgement {
    pub channel_id: u32,
    pub delivery_id: u64,
    pub duplicate: bool,
    pub acknowledged_bytes: usize,
    pub in_flight_frames: usize,
    pub in_flight_bytes: usize,
    pub dropped_frames: u64,
    pub nal_chain_broken: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct FrameDeliveryKey {
    channel_id: u32,
    delivery_id: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FrameDeliveryDisposition {
    Sending,
    Delivered,
    SendFailed,
}

#[derive(Debug, Clone, Copy)]
struct InFlightFrameDelivery {
    key: FrameDeliveryKey,
    bytes: usize,
    disposition: FrameDeliveryDisposition,
}

#[derive(Debug, Clone, Copy)]
struct FrameDeliveryAckTombstone {
    key: FrameDeliveryKey,
    acknowledgement: FrameDeliveryAcknowledgement,
}

#[derive(Debug, Clone, Copy)]
struct FrameDeliveryPressure {
    channel_id: u32,
    dropped_frames: u64,
    nal_chain_broken: bool,
}

#[derive(Debug, Default)]
struct FrameDeliveryCreditState {
    in_flight: VecDeque<InFlightFrameDelivery>,
    in_flight_bytes: usize,
    acknowledgement_tombstones: VecDeque<FrameDeliveryAckTombstone>,
    pending_pressure: VecDeque<FrameDeliveryPressure>,
    overflow_dropped_frames: u64,
    overflow_nal_chain_broken: bool,
}

/// Process-global count-and-byte credit fence placed immediately in front of
/// Tauri's raw Channel cache. A reservation remains live after
/// `Channel.send()` succeeds and is released only by the exact
/// `(channel_id, delivery_id)` acknowledgement. If `Channel.send()` fails, its
/// cache insertion may already have happened, so that reservation is retained
/// permanently and the owning transport is closed.
#[derive(Debug, Default)]
pub struct FrameDeliveryCredits {
    state: Mutex<FrameDeliveryCreditState>,
}

impl FrameDeliveryCredits {
    pub fn new() -> Self {
        Self::default()
    }

    fn try_reserve(
        &self,
        channel_id: u32,
        delivery_id: u64,
        bytes: usize,
    ) -> Result<FrameDeliveryReservation<'_>, String> {
        if bytes > MAX_RDP_FRAME_PAYLOAD_BYTES {
            return Err(format!(
                "RDP frame payload is {bytes} bytes (maximum {MAX_RDP_FRAME_PAYLOAD_BYTES})"
            ));
        }

        let mut state = self
            .state
            .lock()
            .map_err(|_| "RDP frame delivery credit lock poisoned".to_string())?;
        let next_bytes = state
            .in_flight_bytes
            .checked_add(bytes)
            .ok_or_else(|| "RDP frame delivery byte accounting overflow".to_string())?;
        let key = FrameDeliveryKey {
            channel_id,
            delivery_id,
        };
        if state
            .acknowledgement_tombstones
            .iter()
            .any(|entry| entry.key == key)
        {
            return Err(format!(
                "RDP frame delivery ID collision for channel {channel_id}, delivery {delivery_id}"
            ));
        }
        if state
            .in_flight
            .iter()
            .any(|entry| entry.key.channel_id == channel_id)
        {
            return Err(format!(
                "RDP frame channel {channel_id} is still awaiting its previous acknowledgement"
            ));
        }
        if state.in_flight.len() >= MAX_RDP_IN_FLIGHT_FRAME_COUNT
            || next_bytes > MAX_RDP_IN_FLIGHT_FRAME_BYTES
        {
            return Err(format!(
                "RDP frame delivery credits exhausted ({} frames, {} bytes in flight)",
                state.in_flight.len(),
                state.in_flight_bytes
            ));
        }

        state.in_flight.push_back(InFlightFrameDelivery {
            key,
            bytes,
            disposition: FrameDeliveryDisposition::Sending,
        });
        state.in_flight_bytes = next_bytes;
        Ok(FrameDeliveryReservation {
            state,
            key,
            retained: false,
        })
    }

    pub fn acknowledge(
        &self,
        channel_id: u32,
        delivery_id: u64,
    ) -> Result<FrameDeliveryAcknowledgement, String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "RDP frame delivery credit lock poisoned".to_string())?;

        let key = FrameDeliveryKey {
            channel_id,
            delivery_id,
        };
        if let Some(tombstone) = state
            .acknowledgement_tombstones
            .iter()
            .find(|entry| entry.key == key)
        {
            return Ok(FrameDeliveryAcknowledgement {
                duplicate: true,
                ..tombstone.acknowledgement
            });
        }

        let index = state
            .in_flight
            .iter()
            .position(|entry| entry.key == key)
            .ok_or_else(|| {
                format!(
                    "RDP frame acknowledgement has no matching payload for channel {channel_id}, delivery {delivery_id}"
                )
            })?;
        let entry = state.in_flight[index];
        match entry.disposition {
            FrameDeliveryDisposition::Delivered => {}
            FrameDeliveryDisposition::SendFailed => {
                return Err(format!(
                    "RDP frame channel {channel_id} delivery {delivery_id} failed after cache insertion and cannot be acknowledged"
                ));
            }
            FrameDeliveryDisposition::Sending => {
                return Err(format!(
                    "RDP frame channel {channel_id} delivery {delivery_id} is not committed"
                ));
            }
        }

        let acknowledged = state
            .in_flight
            .remove(index)
            .expect("frame delivery index was found while holding the ledger lock");
        let acknowledged_bytes = acknowledged.bytes;
        state.in_flight_bytes = state.in_flight_bytes.saturating_sub(acknowledged_bytes);
        let mut dropped_frames = std::mem::take(&mut state.overflow_dropped_frames);
        let mut nal_chain_broken = std::mem::take(&mut state.overflow_nal_chain_broken);
        if let Some(index) = state
            .pending_pressure
            .iter()
            .position(|pressure| pressure.channel_id == channel_id)
        {
            let pressure = state
                .pending_pressure
                .remove(index)
                .expect("frame pressure index was found while holding the ledger lock");
            dropped_frames = dropped_frames.saturating_add(pressure.dropped_frames);
            nal_chain_broken |= pressure.nal_chain_broken;
        }
        let acknowledgement = FrameDeliveryAcknowledgement {
            channel_id,
            delivery_id,
            duplicate: false,
            acknowledged_bytes,
            in_flight_frames: state.in_flight.len(),
            in_flight_bytes: state.in_flight_bytes,
            dropped_frames,
            nal_chain_broken,
        };
        if state.acknowledgement_tombstones.len() >= MAX_RDP_DELIVERY_ACK_TOMBSTONES {
            state.acknowledgement_tombstones.pop_front();
        }
        state
            .acknowledgement_tombstones
            .push_back(FrameDeliveryAckTombstone {
                key,
                acknowledgement,
            });
        Ok(acknowledgement)
    }

    pub fn record_dropped_payloads(
        &self,
        channel_id: u32,
        count: u64,
        nal_chain_broken: bool,
    ) -> Result<(), String> {
        if count == 0 && !nal_chain_broken {
            return Ok(());
        }
        let mut state = self
            .state
            .lock()
            .map_err(|_| "RDP frame delivery credit lock poisoned".to_string())?;
        if let Some(pressure) = state
            .pending_pressure
            .iter_mut()
            .find(|pressure| pressure.channel_id == channel_id)
        {
            pressure.dropped_frames = pressure.dropped_frames.saturating_add(count);
            pressure.nal_chain_broken |= nal_chain_broken;
        } else if state.pending_pressure.len() < MAX_RDP_DELIVERY_PRESSURE_CHANNELS {
            state.pending_pressure.push_back(FrameDeliveryPressure {
                channel_id,
                dropped_frames: count,
                nal_chain_broken,
            });
        } else {
            // Preserve the safety signal without growing another per-channel
            // map. Applying overflow pressure to the next acknowledgement can
            // cause an extra refresh, but never misses a broken NAL chain.
            state.overflow_dropped_frames = state.overflow_dropped_frames.saturating_add(count);
            state.overflow_nal_chain_broken |= nal_chain_broken;
        }
        Ok(())
    }

    pub fn snapshot(&self) -> Result<FrameDeliveryCreditSnapshot, String> {
        let state = self
            .state
            .lock()
            .map_err(|_| "RDP frame delivery credit lock poisoned".to_string())?;
        Ok(FrameDeliveryCreditSnapshot {
            in_flight_frames: state.in_flight.len(),
            in_flight_bytes: state.in_flight_bytes,
        })
    }

    fn has_capacity_for(&self, channel_id: u32, bytes: usize) -> bool {
        if bytes > MAX_RDP_FRAME_PAYLOAD_BYTES {
            return false;
        }
        self.state
            .lock()
            .map(|state| {
                !state
                    .in_flight
                    .iter()
                    .any(|entry| entry.key.channel_id == channel_id)
                    && state.in_flight.len() < MAX_RDP_IN_FLIGHT_FRAME_COUNT
                    && state.in_flight_bytes.saturating_add(bytes) <= MAX_RDP_IN_FLIGHT_FRAME_BYTES
            })
            .unwrap_or(false)
    }
}

/// Reservation guard held across the synchronous `Channel.send()` call.
/// Dropping before calling either retain method rolls back a send that was
/// never attempted. A returned send error must use `retain_send_failure`
/// because Tauri inserts a large raw body in its cache before the fallible
/// webview notification.
#[derive(Debug)]
pub struct FrameDeliveryReservation<'a> {
    state: MutexGuard<'a, FrameDeliveryCreditState>,
    key: FrameDeliveryKey,
    retained: bool,
}

impl FrameDeliveryReservation<'_> {
    fn retain(mut self, disposition: FrameDeliveryDisposition) {
        let entry = self
            .state
            .in_flight
            .back_mut()
            .expect("a frame reservation owns the last ledger entry");
        debug_assert_eq!(entry.key, self.key);
        entry.disposition = disposition;
        self.retained = true;
    }

    fn retain_success(self) {
        self.retain(FrameDeliveryDisposition::Delivered);
    }

    fn retain_send_failure(self) {
        self.retain(FrameDeliveryDisposition::SendFailed);
    }
}

impl Drop for FrameDeliveryReservation<'_> {
    fn drop(&mut self) {
        if self.retained {
            return;
        }
        let rolled_back = self.state.in_flight.pop_back();
        debug_assert_eq!(rolled_back.map(|entry| entry.key), Some(self.key));
        if let Some(entry) = rolled_back {
            self.state.in_flight_bytes = self.state.in_flight_bytes.saturating_sub(entry.bytes);
        }
    }
}

#[derive(Debug)]
struct FrameDeliveryTransportState {
    next_delivery_id: u64,
    permanently_closed: bool,
}

/// Per-Tauri-Channel sequencing combined with the process-global ledger.
/// Only one delivery may be outstanding per channel, so JavaScript can derive
/// IDs as `1, 2, ...` from ordered callbacks without putting metadata in the
/// raw frame body. IDs advance only after `Channel.send()` succeeds. Any send
/// error permanently closes this transport and retains its cache credit,
/// preventing a missing callback from shifting all subsequent IDs.
#[derive(Debug)]
pub struct FrameDeliveryTransport {
    channel_id: u32,
    credits: Arc<FrameDeliveryCredits>,
    state: Mutex<FrameDeliveryTransportState>,
}

impl FrameDeliveryTransport {
    pub fn new(channel_id: u32, credits: Arc<FrameDeliveryCredits>) -> Self {
        Self {
            channel_id,
            credits,
            state: Mutex::new(FrameDeliveryTransportState {
                next_delivery_id: 1,
                permanently_closed: false,
            }),
        }
    }

    pub fn prepare(&self, bytes: usize) -> Result<PreparedFrameDelivery<'_>, String> {
        let state = self
            .state
            .lock()
            .map_err(|_| "RDP frame delivery sequence lock poisoned".to_string())?;
        if state.permanently_closed {
            return Err(format!(
                "RDP frame channel {} is permanently closed after a failed send",
                self.channel_id
            ));
        }
        let delivery_id = state.next_delivery_id;
        let reservation = self
            .credits
            .try_reserve(self.channel_id, delivery_id, bytes)?;
        Ok(PreparedFrameDelivery {
            state,
            reservation: Some(reservation),
            delivery_id,
        })
    }

    pub fn has_capacity_for(&self, bytes: usize) -> bool {
        self.state
            .lock()
            .map(|state| {
                !state.permanently_closed && self.credits.has_capacity_for(self.channel_id, bytes)
            })
            .unwrap_or(false)
    }

    pub fn record_dropped_payloads(
        &self,
        count: u64,
        nal_chain_broken: bool,
    ) -> Result<(), String> {
        let state = self
            .state
            .lock()
            .map_err(|_| "RDP frame delivery sequence lock poisoned".to_string())?;
        if state.permanently_closed {
            return Ok(());
        }
        self.credits
            .record_dropped_payloads(self.channel_id, count, nal_chain_broken)
    }
}

#[derive(Debug)]
pub struct PreparedFrameDelivery<'a> {
    state: MutexGuard<'a, FrameDeliveryTransportState>,
    reservation: Option<FrameDeliveryReservation<'a>>,
    delivery_id: u64,
}

impl PreparedFrameDelivery<'_> {
    pub fn delivery_id(&self) -> u64 {
        self.delivery_id
    }

    pub fn mark_sent(mut self) {
        self.reservation
            .take()
            .expect("prepared delivery owns its reservation")
            .retain_success();
        if let Some(next_delivery_id) = self.state.next_delivery_id.checked_add(1) {
            self.state.next_delivery_id = next_delivery_id;
        } else {
            self.state.permanently_closed = true;
        }
    }

    pub fn mark_send_failed(mut self) {
        // Tauri's large-payload path inserts into ChannelDataIpcQueue before
        // the fallible webview eval. The retained entry mirrors that possible
        // body even though no callback/acknowledgement will arrive.
        self.state.permanently_closed = true;
        self.reservation
            .take()
            .expect("prepared delivery owns its reservation")
            .retain_send_failure();
    }
}

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

    if data.len() > MAX_RDP_FRAME_PAYLOAD_BYTES {
        accounting.record_failure(bytes);
        return Err(format!(
            "RDP frame payload is {} bytes (maximum {MAX_RDP_FRAME_PAYLOAD_BYTES})",
            data.len()
        ));
    }

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

        let result = send_accounted_frame(
            &accounting,
            &frame_channel,
            FramePayloadKind::Nal,
            vec![0; 16],
        );

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

    #[test]
    fn delivery_credits_enforce_process_global_count_across_channels() {
        let credits = Arc::new(FrameDeliveryCredits::new());
        let channels = (0..=MAX_RDP_IN_FLIGHT_FRAME_COUNT)
            .map(|index| FrameDeliveryTransport::new(100 + index as u32, Arc::clone(&credits)))
            .collect::<Vec<_>>();
        for (index, channel) in channels
            .iter()
            .take(MAX_RDP_IN_FLIGHT_FRAME_COUNT)
            .enumerate()
        {
            channel
                .prepare(index + 1)
                .expect("within global count budget")
                .mark_sent();
        }

        let saturated = channels[MAX_RDP_IN_FLIGHT_FRAME_COUNT]
            .prepare(1)
            .expect_err("count budget must be hard bounded");
        assert!(saturated.contains("credits exhausted"));

        let acknowledgement = credits.acknowledge(100, 1).expect("exact credit");
        assert_eq!(acknowledgement.channel_id, 100);
        assert_eq!(acknowledgement.delivery_id, 1);
        assert_eq!(acknowledgement.acknowledged_bytes, 1);
        assert_eq!(
            acknowledgement.in_flight_frames,
            MAX_RDP_IN_FLIGHT_FRAME_COUNT - 1
        );
        assert_eq!(
            acknowledgement.in_flight_bytes,
            (2..=MAX_RDP_IN_FLIGHT_FRAME_COUNT).sum::<usize>()
        );
    }

    #[test]
    fn delivery_credits_enforce_byte_budget_without_allocating_payloads() {
        let credits = Arc::new(FrameDeliveryCredits::new());
        let channel_a = FrameDeliveryTransport::new(1, Arc::clone(&credits));
        let channel_b = FrameDeliveryTransport::new(2, Arc::clone(&credits));
        channel_a
            .prepare(MAX_RDP_IN_FLIGHT_FRAME_BYTES - 7)
            .expect("large frame within byte budget")
            .mark_sent();

        let saturated = channel_b
            .prepare(8)
            .expect_err("aggregate byte budget must be hard bounded");
        assert!(saturated.contains("credits exhausted"));
        let oversized = channel_b
            .prepare(MAX_RDP_FRAME_PAYLOAD_BYTES + 1)
            .expect_err("single payload ceiling must be hard bounded");
        assert!(oversized.contains("maximum"));
    }

    #[test]
    fn abandoned_pre_send_reservation_rolls_back_all_credit() {
        let credits = Arc::new(FrameDeliveryCredits::new());
        let channel = FrameDeliveryTransport::new(7, Arc::clone(&credits));
        drop(channel.prepare(4096).expect("reservation"));

        assert_eq!(
            credits.snapshot().expect("snapshot"),
            FrameDeliveryCreditSnapshot::default()
        );
    }

    #[test]
    fn send_failure_retains_cache_credit_and_permanently_closes_channel() {
        let credits = Arc::new(FrameDeliveryCredits::new());
        let channel = FrameDeliveryTransport::new(7, Arc::clone(&credits));
        let delivery = channel.prepare(4096).expect("reservation");
        assert_eq!(delivery.delivery_id(), 1);
        delivery.mark_send_failed();

        assert_eq!(
            credits.snapshot().expect("snapshot"),
            FrameDeliveryCreditSnapshot {
                in_flight_frames: 1,
                in_flight_bytes: 4096,
            }
        );
        let closed = channel
            .prepare(1)
            .expect_err("a failed send must close the channel");
        assert!(closed.contains("permanently closed"));
        let failed_ack = credits
            .acknowledge(7, 1)
            .expect_err("a failed send has no matching frontend callback");
        assert!(failed_ack.contains("failed after cache insertion"));
        assert_eq!(credits.snapshot().expect("snapshot").in_flight_frames, 1);
    }

    #[test]
    fn acknowledgements_are_exact_idempotent_and_reject_wrong_ids() {
        let credits = Arc::new(FrameDeliveryCredits::new());
        let channel = FrameDeliveryTransport::new(11, Arc::clone(&credits));
        channel.prepare(128).expect("first frame").mark_sent();

        assert!(credits.acknowledge(12, 1).is_err());
        assert!(credits.acknowledge(11, 2).is_err());
        assert_eq!(credits.snapshot().expect("snapshot").in_flight_frames, 1);

        credits
            .record_dropped_payloads(11, 3, true)
            .expect("record pressure");
        let first = credits.acknowledge(11, 1).expect("exact acknowledgement");
        assert!(!first.duplicate);
        assert_eq!(first.dropped_frames, 3);
        assert!(first.nal_chain_broken);

        let duplicate = credits
            .acknowledge(11, 1)
            .expect("lost response retry is idempotent");
        assert!(duplicate.duplicate);
        assert_eq!(duplicate.acknowledged_bytes, first.acknowledged_bytes);
        assert_eq!(duplicate.dropped_frames, first.dropped_frames);
        assert!(duplicate.nal_chain_broken);
        assert_eq!(credits.snapshot().expect("snapshot").in_flight_frames, 0);

        let second = channel.prepare(64).expect("second frame");
        assert_eq!(second.delivery_id(), 2);
        second.mark_sent();
        assert!(credits.acknowledge(11, 3).is_err());
        assert_eq!(credits.snapshot().expect("snapshot").in_flight_frames, 1);
        assert_eq!(
            credits
                .acknowledge(11, 2)
                .expect("second exact acknowledgement")
                .delivery_id,
            2
        );
    }

    #[test]
    fn acknowledgement_tombstones_and_pressure_channels_are_bounded() {
        let credits = Arc::new(FrameDeliveryCredits::new());
        let channel = FrameDeliveryTransport::new(77, Arc::clone(&credits));
        for delivery_id in 1..=(MAX_RDP_DELIVERY_ACK_TOMBSTONES as u64 + 5) {
            let delivery = channel.prepare(1).expect("delivery within budget");
            assert_eq!(delivery.delivery_id(), delivery_id);
            delivery.mark_sent();
            credits
                .acknowledge(77, delivery_id)
                .expect("exact acknowledgement");
        }
        for channel_id in 1..=(MAX_RDP_DELIVERY_PRESSURE_CHANNELS as u32 + 5) {
            credits
                .record_dropped_payloads(channel_id, 1, channel_id % 2 == 0)
                .expect("bounded pressure recording");
        }

        let state = credits.state.lock().expect("ledger lock");
        assert_eq!(
            state.acknowledgement_tombstones.len(),
            MAX_RDP_DELIVERY_ACK_TOMBSTONES
        );
        assert_eq!(
            state.pending_pressure.len(),
            MAX_RDP_DELIVERY_PRESSURE_CHANNELS
        );
        assert_eq!(state.overflow_dropped_frames, 5);
        assert!(state.overflow_nal_chain_broken);
    }
}
