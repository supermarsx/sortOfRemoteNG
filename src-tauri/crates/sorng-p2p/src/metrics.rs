//! # P2P Metrics
//!
//! Connection quality measurement, latency tracking, jitter computation,
//! packet loss detection, and aggregate statistics for P2P sessions.

use crate::types::P2pMetrics;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;

/// Sliding window size for metrics computation.
const METRICS_WINDOW_SIZE: usize = 100;

/// A metrics collector for a single P2P session.
pub struct MetricsCollector {
    /// Session ID
    session_id: String,
    /// RTT samples (milliseconds)
    rtt_samples: VecDeque<u64>,
    /// Packet counts for loss calculation
    packets_sent: u64,
    packets_received: u64,
    packets_lost: u64,
    /// Byte counters
    bytes_sent: u64,
    bytes_received: u64,
    /// Throughput tracking
    last_bytes_sent: u64,
    last_bytes_received: u64,
    last_throughput_check: Option<chrono::DateTime<chrono::Utc>>,
    /// Current computed values
    current_rtt: u64,
    current_jitter: u64,
    current_loss_pct: f32,
    current_throughput_send: u64,
    current_throughput_recv: u64,
    /// Session start time
    started_at: chrono::DateTime<chrono::Utc>,
}

impl MetricsCollector {
    /// Create a new metrics collector for a session.
    pub fn new(session_id: &str) -> Self {
        Self {
            session_id: session_id.to_string(),
            rtt_samples: VecDeque::with_capacity(METRICS_WINDOW_SIZE),
            packets_sent: 0,
            packets_received: 0,
            packets_lost: 0,
            bytes_sent: 0,
            bytes_received: 0,
            last_bytes_sent: 0,
            last_bytes_received: 0,
            last_throughput_check: None,
            current_rtt: 0,
            current_jitter: 0,
            current_loss_pct: 0.0,
            current_throughput_send: 0,
            current_throughput_recv: 0,
            started_at: Utc::now(),
        }
    }

    /// Record an RTT sample (from a STUN keepalive or data ACK).
    pub fn record_rtt(&mut self, rtt_ms: u64) {
        if self.rtt_samples.len() >= METRICS_WINDOW_SIZE {
            self.rtt_samples.pop_front();
        }
        self.rtt_samples.push_back(rtt_ms);
        self.recompute();
    }

    /// Record a sent packet.
    pub fn record_sent(&mut self, bytes: u64) {
        self.packets_sent += 1;
        self.bytes_sent += bytes;
    }

    /// Record a received packet.
    pub fn record_received(&mut self, bytes: u64) {
        self.packets_received += 1;
        self.bytes_received += bytes;
    }

    /// Record a lost packet (timeout on expected ACK).
    pub fn record_loss(&mut self) {
        self.packets_lost += 1;
        self.recompute_loss();
    }

    /// Update throughput calculation.
    pub fn update_throughput(&mut self) {
        let now = Utc::now();
        if let Some(last) = self.last_throughput_check {
            let elapsed_secs = (now - last).num_seconds().max(1) as u64;
            self.current_throughput_send = (self.bytes_sent - self.last_bytes_sent) / elapsed_secs;
            self.current_throughput_recv =
                (self.bytes_received - self.last_bytes_received) / elapsed_secs;
        }
        self.last_bytes_sent = self.bytes_sent;
        self.last_bytes_received = self.bytes_received;
        self.last_throughput_check = Some(now);
    }

    /// Get the current metrics snapshot.
    pub fn snapshot(&mut self) -> P2pMetrics {
        self.update_throughput();
        let uptime = (Utc::now() - self.started_at).num_seconds().max(0) as u64;
        let quality_score = P2pMetrics::compute_quality_score(
            self.current_rtt,
            self.current_jitter,
            self.current_loss_pct,
        );

        P2pMetrics {
            session_id: self.session_id.clone(),
            rtt_ms: self.current_rtt,
            jitter_ms: self.current_jitter,
            packet_loss_pct: self.current_loss_pct,
            throughput_send: self.current_throughput_send,
            throughput_recv: self.current_throughput_recv,
            total_bytes_sent: self.bytes_sent,
            total_bytes_received: self.bytes_received,
            keepalives_sent: 0, // tracked externally
            retransmissions: self.packets_lost,
            uptime_secs: uptime,
            quality_score,
            measured_at: Utc::now(),
        }
    }

    // ── Internal Computation ───────────────────────────────────

    fn recompute(&mut self) {
        if self.rtt_samples.is_empty() {
            return;
        }

        // Average RTT
        let sum: u64 = self.rtt_samples.iter().sum();
        self.current_rtt = sum / self.rtt_samples.len() as u64;

        // Jitter (average deviation from mean)
        let mean = self.current_rtt as f64;
        let jitter: f64 = self
            .rtt_samples
            .iter()
            .map(|&s| (s as f64 - mean).abs())
            .sum::<f64>()
            / self.rtt_samples.len() as f64;
        self.current_jitter = jitter as u64;

        self.recompute_loss();
    }

    fn recompute_loss(&mut self) {
        if self.packets_sent > 0 {
            self.current_loss_pct = (self.packets_lost as f32 / self.packets_sent as f32) * 100.0;
        }
    }

    // ── Accessors ──────────────────────────────────────────────

    /// Current smoothed RTT in milliseconds.
    pub fn rtt(&self) -> u64 {
        self.current_rtt
    }

    /// Current jitter in milliseconds.
    pub fn jitter(&self) -> u64 {
        self.current_jitter
    }

    /// Current packet loss percentage.
    pub fn loss_pct(&self) -> f32 {
        self.current_loss_pct
    }

    /// Total bytes sent.
    pub fn bytes_sent(&self) -> u64 {
        self.bytes_sent
    }

    /// Total bytes received.
    pub fn bytes_received(&self) -> u64 {
        self.bytes_received
    }

    /// Current send throughput (bytes/sec).
    pub fn throughput_send(&self) -> u64 {
        self.current_throughput_send
    }

    /// Current receive throughput (bytes/sec).
    pub fn throughput_recv(&self) -> u64 {
        self.current_throughput_recv
    }

    /// Number of RTT samples collected.
    pub fn sample_count(&self) -> usize {
        self.rtt_samples.len()
    }

    /// Minimum RTT observed.
    pub fn min_rtt(&self) -> u64 {
        self.rtt_samples.iter().copied().min().unwrap_or(0)
    }

    /// Maximum RTT observed.
    pub fn max_rtt(&self) -> u64 {
        self.rtt_samples.iter().copied().max().unwrap_or(0)
    }

    /// P95 RTT.
    pub fn p95_rtt(&self) -> u64 {
        if self.rtt_samples.is_empty() {
            return 0;
        }
        let mut sorted: Vec<u64> = self.rtt_samples.iter().copied().collect();
        sorted.sort_unstable();
        let idx = (sorted.len() as f64 * 0.95) as usize;
        sorted[idx.min(sorted.len() - 1)]
    }
}

/// Aggregate metrics across multiple P2P sessions.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AggregateMetrics {
    /// Total active sessions
    pub session_count: usize,
    /// Average RTT across sessions
    pub avg_rtt_ms: u64,
    /// Average jitter
    pub avg_jitter_ms: u64,
    /// Average packet loss
    pub avg_loss_pct: f32,
    /// Total throughput (send)
    pub total_throughput_send: u64,
    /// Total throughput (receive)
    pub total_throughput_recv: u64,
    /// Total bytes sent (all sessions)
    pub total_bytes_sent: u64,
    /// Total bytes received (all sessions)
    pub total_bytes_received: u64,
    /// Best quality score across sessions
    pub best_quality: u8,
    /// Worst quality score
    pub worst_quality: u8,
    /// Timestamp
    pub measured_at: chrono::DateTime<chrono::Utc>,
}

/// Compute aggregate metrics from individual session metrics.
pub fn aggregate(metrics: &[P2pMetrics]) -> AggregateMetrics {
    if metrics.is_empty() {
        return AggregateMetrics {
            session_count: 0,
            avg_rtt_ms: 0,
            avg_jitter_ms: 0,
            avg_loss_pct: 0.0,
            total_throughput_send: 0,
            total_throughput_recv: 0,
            total_bytes_sent: 0,
            total_bytes_received: 0,
            best_quality: 0,
            worst_quality: 0,
            measured_at: Utc::now(),
        };
    }

    let n = metrics.len() as u64;

    AggregateMetrics {
        session_count: metrics.len(),
        avg_rtt_ms: metrics.iter().map(|m| m.rtt_ms).sum::<u64>() / n,
        avg_jitter_ms: metrics.iter().map(|m| m.jitter_ms).sum::<u64>() / n,
        avg_loss_pct: metrics.iter().map(|m| m.packet_loss_pct).sum::<f32>() / n as f32,
        total_throughput_send: metrics.iter().map(|m| m.throughput_send).sum(),
        total_throughput_recv: metrics.iter().map(|m| m.throughput_recv).sum(),
        total_bytes_sent: metrics.iter().map(|m| m.total_bytes_sent).sum(),
        total_bytes_received: metrics.iter().map(|m| m.total_bytes_received).sum(),
        best_quality: metrics.iter().map(|m| m.quality_score).max().unwrap_or(0),
        worst_quality: metrics.iter().map(|m| m.quality_score).min().unwrap_or(0),
        measured_at: Utc::now(),
    }
}

/// Quality level classification based on metrics.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum QualityLevel {
    /// Excellent (score 80-100)
    Excellent,
    /// Good (score 60-79)
    Good,
    /// Fair (score 40-59)
    Fair,
    /// Poor (score 20-39)
    Poor,
    /// Bad (score 0-19)
    Bad,
}

/// Classify a quality score into a QualityLevel.
pub fn classify_quality(score: u8) -> QualityLevel {
    match score {
        80..=100 => QualityLevel::Excellent,
        60..=79 => QualityLevel::Good,
        40..=59 => QualityLevel::Fair,
        20..=39 => QualityLevel::Poor,
        _ => QualityLevel::Bad,
    }
}
