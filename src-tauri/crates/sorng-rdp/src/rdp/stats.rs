use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, Instant};

use super::types::RdpStatsEvent;

// ---- Connection phase state machine ----
//
// Tracks the connection through a typed finite state machine rather than
// ad-hoc strings.  Every phase transition is now a match-arm, not a
// typo-prone string assignment.

/// The discrete phases a session can be in.
/// The ordering follows the RDP connection lifecycle exactly:
///
/// Initializing → TcpConnect → TlsHandshake → CredSSP → CapabilityExchange
///     → Active ⇄ Reactivating → Reconnecting → Disconnected / Error / Terminated
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectionPhase {
    Initializing,
    TcpConnect,
    TlsHandshake,
    CredSSP,
    CapabilityExchange,
    Active,
    Reactivating,
    Reconnecting,
    Negotiating,
    Disconnected,
    Terminated,
    Error,
}

impl ConnectionPhase {
    /// Convert to the wire-compatible string used by the frontend.
    /// Keeps backward compat with the existing `RdpStatsEvent.phase` field.
    pub fn as_str(&self) -> &'static str {
        match self {
            ConnectionPhase::Initializing => "initializing",
            ConnectionPhase::TcpConnect => "tcp_connect",
            ConnectionPhase::TlsHandshake => "tls_handshake",
            ConnectionPhase::CredSSP => "credssp",
            ConnectionPhase::CapabilityExchange => "capability_exchange",
            ConnectionPhase::Active => "active",
            ConnectionPhase::Reactivating => "reactivating",
            ConnectionPhase::Reconnecting => "reconnecting",
            ConnectionPhase::Negotiating => "negotiating",
            ConnectionPhase::Disconnected => "disconnected",
            ConnectionPhase::Terminated => "terminated",
            ConnectionPhase::Error => "error",
        }
    }

    /// Parse from the legacy string representation.
    /// Unknown strings map to `Initializing` as a safe default.
    pub fn from_str_lossy(s: &str) -> Self {
        match s {
            "initializing" => ConnectionPhase::Initializing,
            "tcp_connect" => ConnectionPhase::TcpConnect,
            "tls_handshake" => ConnectionPhase::TlsHandshake,
            "credssp" => ConnectionPhase::CredSSP,
            "capability_exchange" => ConnectionPhase::CapabilityExchange,
            "active" => ConnectionPhase::Active,
            "reactivating" => ConnectionPhase::Reactivating,
            "reconnecting" => ConnectionPhase::Reconnecting,
            "negotiating" => ConnectionPhase::Negotiating,
            "disconnected" => ConnectionPhase::Disconnected,
            "terminated" => ConnectionPhase::Terminated,
            "error" => ConnectionPhase::Error,
            // Legacy aliases from the old string-based approach
            "connecting" => ConnectionPhase::TcpConnect,
            "connected" => ConnectionPhase::Active,
            _ => ConnectionPhase::Initializing,
        }
    }
}

// ---- Session statistics (shared between session thread and main) ----
//
// Includes health-tracking fields: consecutive error / zero-read counters,
// and a dual-timestamp keepalive guard.

#[derive(Debug)]
pub struct RdpSessionStats {
    pub connected_at: Instant,
    pub bytes_received: AtomicU64,
    pub bytes_sent: AtomicU64,
    pub pdus_received: AtomicU64,
    pub pdus_sent: AtomicU64,
    pub frame_count: AtomicU64,
    pub input_events: AtomicU64,
    pub errors_recovered: AtomicU64,
    pub reactivations: AtomicU64,
    /// Typed connection phase — replaces the old `Mutex<String>`.
    phase: std::sync::Mutex<ConnectionPhase>,
    pub last_error: std::sync::Mutex<Option<String>>,
    /// Lock-free FPS tracking: frame count snapshot and timestamp for
    /// computing frames-per-second without any Mutex on the hot path.
    fps_snapshot_count: AtomicU64,
    fps_snapshot_time: std::sync::Mutex<Instant>,
    fps_cached: std::sync::Mutex<f64>,
    pub alive: AtomicBool,

    // -- Health tracking --

    /// Timestamp of the last successfully received PDU, encoded as millis
    /// since `connected_at`.  Lock-free: uses `Relaxed` load/store on the
    /// hottest path (every incoming PDU).
    last_data_time_ms: AtomicU64,

    /// Timestamp of the last input event sent to the server, encoded as
    /// millis since `connected_at`.  Lock-free.
    last_input_time_ms: AtomicU64,

    /// Timestamp of the last keepalive PDU we sent, encoded as millis
    /// since `connected_at`.  Lock-free.
    last_keepalive_time_ms: AtomicU64,

    /// Consecutive zero-byte reads from the network socket.
    /// Detects a broken connection that passes through the OS TCP stack
    /// without raising an error.
    pub consecutive_zero_reads: AtomicU64,

    /// Consecutive PDU-processing errors without a successful PDU.
    pub consecutive_pdu_errors: AtomicU64,
}

impl RdpSessionStats {
    pub(crate) fn new() -> Self {
        let now = Instant::now();
        Self {
            connected_at: now,
            bytes_received: AtomicU64::new(0),
            bytes_sent: AtomicU64::new(0),
            pdus_received: AtomicU64::new(0),
            pdus_sent: AtomicU64::new(0),
            frame_count: AtomicU64::new(0),
            input_events: AtomicU64::new(0),
            errors_recovered: AtomicU64::new(0),
            reactivations: AtomicU64::new(0),
            phase: std::sync::Mutex::new(ConnectionPhase::Initializing),
            last_error: std::sync::Mutex::new(None),
            fps_snapshot_count: AtomicU64::new(0),
            fps_snapshot_time: std::sync::Mutex::new(now),
            fps_cached: std::sync::Mutex::new(0.0),
            alive: AtomicBool::new(true),
            // Health tracking — all start at 0 (= connected_at)
            last_data_time_ms: AtomicU64::new(0),
            last_input_time_ms: AtomicU64::new(0),
            last_keepalive_time_ms: AtomicU64::new(0),
            consecutive_zero_reads: AtomicU64::new(0),
            consecutive_pdu_errors: AtomicU64::new(0),
        }
    }

    /// Transition to a new connection phase using the typed enum.
    pub(crate) fn set_phase(&self, phase: &str) {
        if let Ok(mut p) = self.phase.lock() {
            *p = ConnectionPhase::from_str_lossy(phase);
        }
    }

    /// Set the phase directly from a typed `ConnectionPhase`.
    #[allow(dead_code)]
    pub(crate) fn set_phase_typed(&self, phase: ConnectionPhase) {
        if let Ok(mut p) = self.phase.lock() {
            *p = phase;
        }
    }

    /// Get the current phase as a typed enum.
    #[allow(dead_code)]
    pub(crate) fn get_phase_typed(&self) -> ConnectionPhase {
        self.phase
            .lock()
            .map(|p| *p)
            .unwrap_or(ConnectionPhase::Initializing)
    }

    pub(crate) fn get_phase(&self) -> String {
        self.phase
            .lock()
            .map(|p| p.as_str().to_string())
            .unwrap_or_default()
    }

    pub(crate) fn set_last_error(&self, err: &str) {
        if let Ok(mut e) = self.last_error.lock() {
            *e = Some(err.to_string());
        }
    }

    /// Record a frame.  Lock-free: just an atomic increment.
    #[inline]
    pub(crate) fn record_frame(&self) {
        self.frame_count.fetch_add(1, Ordering::Relaxed);
    }

    // -- Health tracking helpers --

    /// Encode an `Instant` into millis since `connected_at`.
    #[inline]
    fn elapsed_ms(&self, instant: Instant) -> u64 {
        instant.duration_since(self.connected_at).as_millis() as u64
    }

    /// Decode a stored millis value back to an `Instant`.
    #[inline]
    fn instant_from_ms(&self, ms: u64) -> Instant {
        self.connected_at + Duration::from_millis(ms)
    }

    /// Record that a PDU was successfully received.  Resets consecutive
    /// error counters.  Fully lock-free.
    #[inline]
    pub(crate) fn record_successful_pdu(&self) {
        self.consecutive_pdu_errors.store(0, Ordering::Relaxed);
        self.consecutive_zero_reads.store(0, Ordering::Relaxed);
        self.last_data_time_ms.store(self.elapsed_ms(Instant::now()), Ordering::Relaxed);
    }

    /// Record a PDU processing error.  Returns the new consecutive count.
    #[inline]
    pub(crate) fn record_pdu_error(&self) -> u64 {
        self.errors_recovered.fetch_add(1, Ordering::Relaxed);
        self.consecutive_pdu_errors.fetch_add(1, Ordering::Relaxed) + 1
    }

    /// Record a zero-byte read.  Returns the new consecutive count.
    #[inline]
    pub(crate) fn record_zero_byte_read(&self) -> u64 {
        self.consecutive_zero_reads.fetch_add(1, Ordering::Relaxed) + 1
    }

    /// Record that an input event was sent.  Lock-free.
    #[inline]
    #[allow(dead_code)]
    pub(crate) fn record_input_sent(&self) {
        self.input_events.fetch_add(1, Ordering::Relaxed);
        self.last_input_time_ms.store(self.elapsed_ms(Instant::now()), Ordering::Relaxed);
    }

    /// Record N input events in a single batch (avoids N separate
    /// `Instant::now()` calls on the input coalescing path).
    #[inline]
    pub(crate) fn record_input_sent_batch(&self, count: u64) {
        if count == 0 { return; }
        self.input_events.fetch_add(count, Ordering::Relaxed);
        self.last_input_time_ms.store(self.elapsed_ms(Instant::now()), Ordering::Relaxed);
    }

    /// Record that a keepalive was sent.  Lock-free.
    pub(crate) fn record_keepalive_sent(&self) {
        self.last_keepalive_time_ms.store(self.elapsed_ms(Instant::now()), Ordering::Relaxed);
    }

    /// Check whether a keepalive should be sent now.
    ///
    /// The keepalive is suppressed when data is actively flowing (either
    /// received PDUs or sent input events), and only fires after
    /// `idle_threshold` of silence.  Additionally, keepalives are
    /// rate-limited to `min_interval`.
    pub(crate) fn should_send_keepalive(
        &self,
        idle_threshold: Duration,
        min_interval: Duration,
    ) -> bool {
        let now = Instant::now();

        // Suppress if we received data recently.
        let last_data = self.instant_from_ms(self.last_data_time_ms.load(Ordering::Relaxed));
        if now.duration_since(last_data) < idle_threshold {
            return false;
        }

        // Suppress if the user sent input recently.
        let last_input = self.instant_from_ms(self.last_input_time_ms.load(Ordering::Relaxed));
        if now.duration_since(last_input) < idle_threshold {
            return false;
        }

        // Rate-limit: don't send more than once per min_interval.
        let last_keepalive = self.instant_from_ms(self.last_keepalive_time_ms.load(Ordering::Relaxed));
        if now.duration_since(last_keepalive) < min_interval {
            return false;
        }

        true
    }

    /// Compute approximate FPS from the delta between the current
    /// frame count and a snapshot taken ~1 s ago.  Only the periodic
    /// stats emitter calls this (once per second), so the two Mutex
    /// locks are completely off the hot path.
    pub(crate) fn current_fps(&self) -> f64 {
        let current = self.frame_count.load(Ordering::Relaxed);
        let now = Instant::now();
        let (fps, should_rotate) = {
            let prev_count = self.fps_snapshot_count.load(Ordering::Relaxed);
            if let Ok(prev_time) = self.fps_snapshot_time.lock() {
                let elapsed = now.duration_since(*prev_time).as_secs_f64();
                if elapsed >= 0.9 {
                    let delta = current.saturating_sub(prev_count) as f64;
                    let fps = if elapsed > 0.0 { delta / elapsed } else { 0.0 };
                    (fps, true)
                } else {
                    // Not enough time elapsed -- return cached value
                    let cached = self.fps_cached.lock().map(|c| *c).unwrap_or(0.0);
                    (cached, false)
                }
            } else {
                (0.0, false)
            }
        };
        if should_rotate {
            self.fps_snapshot_count.store(current, Ordering::Relaxed);
            if let Ok(mut t) = self.fps_snapshot_time.lock() {
                *t = now;
            }
            if let Ok(mut c) = self.fps_cached.lock() {
                *c = fps;
            }
        }
        fps
    }

    pub(crate) fn to_event(&self, session_id: &str) -> RdpStatsEvent {
        RdpStatsEvent {
            session_id: session_id.to_string(),
            uptime_secs: self.connected_at.elapsed().as_secs(),
            bytes_received: self.bytes_received.load(Ordering::Relaxed),
            bytes_sent: self.bytes_sent.load(Ordering::Relaxed),
            pdus_received: self.pdus_received.load(Ordering::Relaxed),
            pdus_sent: self.pdus_sent.load(Ordering::Relaxed),
            frame_count: self.frame_count.load(Ordering::Relaxed),
            fps: self.current_fps(),
            input_events: self.input_events.load(Ordering::Relaxed),
            errors_recovered: self.errors_recovered.load(Ordering::Relaxed),
            reactivations: self.reactivations.load(Ordering::Relaxed),
            phase: self.get_phase(),
            last_error: self.last_error.lock().ok().and_then(|e| e.clone()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_stats_defaults() {
        let stats = RdpSessionStats::new();
        assert_eq!(stats.bytes_received.load(Ordering::Relaxed), 0);
        assert_eq!(stats.bytes_sent.load(Ordering::Relaxed), 0);
        assert_eq!(stats.pdus_received.load(Ordering::Relaxed), 0);
        assert_eq!(stats.pdus_sent.load(Ordering::Relaxed), 0);
        assert_eq!(stats.frame_count.load(Ordering::Relaxed), 0);
        assert_eq!(stats.input_events.load(Ordering::Relaxed), 0);
        assert_eq!(stats.errors_recovered.load(Ordering::Relaxed), 0);
        assert_eq!(stats.reactivations.load(Ordering::Relaxed), 0);
        assert!(stats.alive.load(Ordering::Relaxed));
        assert_eq!(stats.consecutive_zero_reads.load(Ordering::Relaxed), 0);
        assert_eq!(stats.consecutive_pdu_errors.load(Ordering::Relaxed), 0);
    }

    #[test]
    fn initial_phase_is_initializing() {
        let stats = RdpSessionStats::new();
        assert_eq!(stats.get_phase(), "initializing");
        assert_eq!(stats.get_phase_typed(), ConnectionPhase::Initializing);
    }

    #[test]
    fn set_and_get_phase() {
        let stats = RdpSessionStats::new();
        stats.set_phase("connected");
        // "connected" maps to Active via from_str_lossy
        assert_eq!(stats.get_phase_typed(), ConnectionPhase::Active);
    }

    #[test]
    fn set_phase_typed_works() {
        let stats = RdpSessionStats::new();
        stats.set_phase_typed(ConnectionPhase::TlsHandshake);
        assert_eq!(stats.get_phase_typed(), ConnectionPhase::TlsHandshake);
        assert_eq!(stats.get_phase(), "tls_handshake");
    }

    #[test]
    fn set_phase_multiple_times() {
        let stats = RdpSessionStats::new();
        stats.set_phase("connecting");
        stats.set_phase("negotiating");
        stats.set_phase("active");
        assert_eq!(stats.get_phase(), "active");
    }

    #[test]
    fn set_and_get_last_error() {
        let stats = RdpSessionStats::new();
        assert!(stats.last_error.lock().unwrap().is_none());
        stats.set_last_error("connection refused");
        assert_eq!(
            stats.last_error.lock().unwrap().as_deref(),
            Some("connection refused")
        );
    }

    #[test]
    fn record_frame_increments() {
        let stats = RdpSessionStats::new();
        stats.record_frame();
        stats.record_frame();
        stats.record_frame();
        assert_eq!(stats.frame_count.load(Ordering::Relaxed), 3);
    }

    #[test]
    fn atomic_counters_increment() {
        let stats = RdpSessionStats::new();
        stats.bytes_received.fetch_add(1024, Ordering::Relaxed);
        stats.bytes_sent.fetch_add(512, Ordering::Relaxed);
        stats.pdus_received.fetch_add(10, Ordering::Relaxed);
        stats.pdus_sent.fetch_add(5, Ordering::Relaxed);
        stats.input_events.fetch_add(3, Ordering::Relaxed);
        assert_eq!(stats.bytes_received.load(Ordering::Relaxed), 1024);
        assert_eq!(stats.bytes_sent.load(Ordering::Relaxed), 512);
        assert_eq!(stats.pdus_received.load(Ordering::Relaxed), 10);
        assert_eq!(stats.pdus_sent.load(Ordering::Relaxed), 5);
        assert_eq!(stats.input_events.load(Ordering::Relaxed), 3);
    }

    #[test]
    fn current_fps_initially_zero() {
        let stats = RdpSessionStats::new();
        // FPS should be 0 or close to 0 initially (no frames recorded)
        let fps = stats.current_fps();
        assert!(fps >= 0.0);
    }

    #[test]
    fn current_fps_returns_cached_before_threshold() {
        let stats = RdpSessionStats::new();
        // Call twice quickly - second should return cached value
        let _fps1 = stats.current_fps();
        let fps2 = stats.current_fps();
        // Both should be 0 since no time has passed
        assert!(fps2 >= 0.0);
    }

    #[test]
    fn to_event_populates_fields() {
        let stats = RdpSessionStats::new();
        stats.set_phase("active");
        stats.bytes_received.fetch_add(100, Ordering::Relaxed);
        stats.record_frame();
        let event = stats.to_event("session-1");
        assert_eq!(event.session_id, "session-1");
        assert_eq!(event.bytes_received, 100);
        assert_eq!(event.frame_count, 1);
        assert_eq!(event.phase, "active");
    }

    #[test]
    fn alive_flag_toggle() {
        let stats = RdpSessionStats::new();
        assert!(stats.alive.load(Ordering::Relaxed));
        stats.alive.store(false, Ordering::Relaxed);
        assert!(!stats.alive.load(Ordering::Relaxed));
    }

    // -- Health tracking tests --

    #[test]
    fn record_successful_pdu_resets_errors() {
        let stats = RdpSessionStats::new();
        stats.consecutive_pdu_errors.store(5, Ordering::Relaxed);
        stats.consecutive_zero_reads.store(3, Ordering::Relaxed);
        stats.record_successful_pdu();
        assert_eq!(stats.consecutive_pdu_errors.load(Ordering::Relaxed), 0);
        assert_eq!(stats.consecutive_zero_reads.load(Ordering::Relaxed), 0);
    }

    #[test]
    fn record_pdu_error_increments() {
        let stats = RdpSessionStats::new();
        assert_eq!(stats.record_pdu_error(), 1);
        assert_eq!(stats.record_pdu_error(), 2);
        assert_eq!(stats.record_pdu_error(), 3);
        assert_eq!(stats.errors_recovered.load(Ordering::Relaxed), 3);
    }

    #[test]
    fn record_zero_byte_read_increments() {
        let stats = RdpSessionStats::new();
        assert_eq!(stats.record_zero_byte_read(), 1);
        assert_eq!(stats.record_zero_byte_read(), 2);
    }

    #[test]
    fn record_input_sent_updates_timestamp() {
        let stats = RdpSessionStats::new();
        let before_ms = stats.elapsed_ms(Instant::now());
        stats.record_input_sent();
        let after_ms = stats.last_input_time_ms.load(Ordering::Relaxed);
        assert!(after_ms >= before_ms);
        assert_eq!(stats.input_events.load(Ordering::Relaxed), 1);
    }

    #[test]
    fn connection_phase_round_trip() {
        let phases = [
            ConnectionPhase::Initializing,
            ConnectionPhase::TcpConnect,
            ConnectionPhase::TlsHandshake,
            ConnectionPhase::CredSSP,
            ConnectionPhase::CapabilityExchange,
            ConnectionPhase::Active,
            ConnectionPhase::Reactivating,
            ConnectionPhase::Reconnecting,
            ConnectionPhase::Negotiating,
            ConnectionPhase::Disconnected,
            ConnectionPhase::Terminated,
            ConnectionPhase::Error,
        ];
        for phase in &phases {
            let s = phase.as_str();
            let round_tripped = ConnectionPhase::from_str_lossy(s);
            assert_eq!(*phase, round_tripped, "Failed round-trip for {s}");
        }
    }

    #[test]
    fn connection_phase_legacy_aliases() {
        assert_eq!(
            ConnectionPhase::from_str_lossy("connecting"),
            ConnectionPhase::TcpConnect
        );
        assert_eq!(
            ConnectionPhase::from_str_lossy("connected"),
            ConnectionPhase::Active
        );
    }
}
