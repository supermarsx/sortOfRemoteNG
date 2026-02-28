use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Instant;

use super::types::RdpStatsEvent;

// ---- Session statistics (shared between session thread and main) ----

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
    pub phase: std::sync::Mutex<String>,
    pub last_error: std::sync::Mutex<Option<String>>,
    /// Lock-free FPS tracking: frame count snapshot and timestamp for
    /// computing frames-per-second without any Mutex on the hot path.
    fps_snapshot_count: AtomicU64,
    fps_snapshot_time: std::sync::Mutex<Instant>,
    fps_cached: std::sync::Mutex<f64>,
    pub alive: AtomicBool,
}

impl RdpSessionStats {
    pub(crate) fn new() -> Self {
        Self {
            connected_at: Instant::now(),
            bytes_received: AtomicU64::new(0),
            bytes_sent: AtomicU64::new(0),
            pdus_received: AtomicU64::new(0),
            pdus_sent: AtomicU64::new(0),
            frame_count: AtomicU64::new(0),
            input_events: AtomicU64::new(0),
            errors_recovered: AtomicU64::new(0),
            reactivations: AtomicU64::new(0),
            phase: std::sync::Mutex::new("initializing".to_string()),
            last_error: std::sync::Mutex::new(None),
            fps_snapshot_count: AtomicU64::new(0),
            fps_snapshot_time: std::sync::Mutex::new(Instant::now()),
            fps_cached: std::sync::Mutex::new(0.0),
            alive: AtomicBool::new(true),
        }
    }

    pub(crate) fn set_phase(&self, phase: &str) {
        if let Ok(mut p) = self.phase.lock() {
            *p = phase.to_string();
        }
    }

    pub(crate) fn get_phase(&self) -> String {
        self.phase.lock().map(|p| p.clone()).unwrap_or_default()
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
