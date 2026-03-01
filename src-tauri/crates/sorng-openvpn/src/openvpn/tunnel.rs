//! Tunnel health monitoring, bandwidth statistics, and reconnect logic.

use crate::openvpn::types::*;
use chrono::Utc;
use std::sync::Arc;
use tokio::sync::RwLock;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Bandwidth tracker
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Tracks bandwidth samples and computes statistics.
pub struct BandwidthTracker {
    samples: Vec<BandwidthSample>,
    max_samples: usize,
    last_rx: u64,
    last_tx: u64,
    last_time_ms: u64,
}

impl BandwidthTracker {
    pub fn new(max_samples: usize) -> Self {
        Self {
            samples: Vec::new(),
            max_samples,
            last_rx: 0,
            last_tx: 0,
            last_time_ms: 0,
        }
    }

    /// Record a new byte count sample from the management interface.
    pub fn record(&mut self, total_rx: u64, total_tx: u64) -> BandwidthSample {
        let now = Utc::now();
        let now_ms = now.timestamp_millis() as u64;

        let elapsed_ms = if self.last_time_ms > 0 {
            now_ms.saturating_sub(self.last_time_ms)
        } else {
            1000 // assume 1s for first sample
        };

        let delta_rx = total_rx.saturating_sub(self.last_rx);
        let delta_tx = total_tx.saturating_sub(self.last_tx);

        let elapsed_secs = elapsed_ms as f64 / 1000.0;
        let rx_per_sec = if elapsed_secs > 0.0 {
            delta_rx as f64 / elapsed_secs
        } else {
            0.0
        };
        let tx_per_sec = if elapsed_secs > 0.0 {
            delta_tx as f64 / elapsed_secs
        } else {
            0.0
        };

        let sample = BandwidthSample {
            timestamp: now,
            bytes_rx: total_rx,
            bytes_tx: total_tx,
            rx_per_sec,
            tx_per_sec,
        };

        self.last_rx = total_rx;
        self.last_tx = total_tx;
        self.last_time_ms = now_ms;

        self.samples.push(sample.clone());
        if self.samples.len() > self.max_samples {
            self.samples.remove(0);
        }

        sample
    }

    /// Compute aggregate statistics from all recorded samples.
    pub fn stats(&self) -> SessionStats {
        if self.samples.is_empty() {
            return SessionStats::default();
        }

        let total_rx = self.last_rx;
        let total_tx = self.last_tx;
        let peak_rx = self
            .samples
            .iter()
            .map(|s| s.rx_per_sec)
            .fold(0.0_f64, f64::max);
        let peak_tx = self
            .samples
            .iter()
            .map(|s| s.tx_per_sec)
            .fold(0.0_f64, f64::max);
        let avg_rx: f64 = self.samples.iter().map(|s| s.rx_per_sec).sum::<f64>()
            / self.samples.len() as f64;
        let avg_tx: f64 = self.samples.iter().map(|s| s.tx_per_sec).sum::<f64>()
            / self.samples.len() as f64;

        SessionStats {
            total_bytes_rx: total_rx,
            total_bytes_tx: total_tx,
            peak_rx_per_sec: peak_rx,
            peak_tx_per_sec: peak_tx,
            avg_rx_per_sec: avg_rx,
            avg_tx_per_sec: avg_tx,
            samples: self.samples.len(),
            ..Default::default()
        }
    }

    /// Get the most recent N samples.
    pub fn recent_samples(&self, n: usize) -> Vec<BandwidthSample> {
        let start = self.samples.len().saturating_sub(n);
        self.samples[start..].to_vec()
    }

    /// Reset the tracker.
    pub fn reset(&mut self) {
        self.samples.clear();
        self.last_rx = 0;
        self.last_tx = 0;
        self.last_time_ms = 0;
    }

    pub fn sample_count(&self) -> usize {
        self.samples.len()
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Health checker
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Tunnel health status.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HealthStatus {
    Healthy,
    Degraded,
    Unhealthy,
    Unknown,
}

/// Health check result.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct HealthCheck {
    pub status: HealthStatus,
    pub latency_ms: Option<u64>,
    pub packet_loss_pct: Option<f64>,
    pub last_check: chrono::DateTime<Utc>,
    pub message: String,
}

/// Perform a basic tunnel health check by pinging the remote gateway.
pub async fn check_tunnel_health(
    gateway_ip: &str,
    timeout_ms: u64,
) -> HealthCheck {
    let now = Utc::now();

    // Use platform ping
    let result = ping_host(gateway_ip, timeout_ms).await;

    match result {
        Ok(latency) => {
            let status = if latency < 100 {
                HealthStatus::Healthy
            } else if latency < 500 {
                HealthStatus::Degraded
            } else {
                HealthStatus::Unhealthy
            };
            HealthCheck {
                status,
                latency_ms: Some(latency),
                packet_loss_pct: Some(0.0),
                last_check: now,
                message: format!("Ping {}ms", latency),
            }
        }
        Err(e) => HealthCheck {
            status: HealthStatus::Unhealthy,
            latency_ms: None,
            packet_loss_pct: Some(100.0),
            last_check: now,
            message: e,
        },
    }
}

/// Ping a host and return latency in ms.
async fn ping_host(host: &str, timeout_ms: u64) -> Result<u64, String> {
    let start = std::time::Instant::now();

    #[cfg(target_os = "windows")]
    let output = tokio::process::Command::new("ping")
        .args(["-n", "1", "-w", &timeout_ms.to_string(), host])
        .output()
        .await;

    #[cfg(not(target_os = "windows"))]
    let output = tokio::process::Command::new("ping")
        .args([
            "-c",
            "1",
            "-W",
            &(timeout_ms / 1000).max(1).to_string(),
            host,
        ])
        .output()
        .await;

    match output {
        Ok(o) if o.status.success() => {
            let elapsed = start.elapsed().as_millis() as u64;
            // Try to parse actual latency from output
            let stdout = String::from_utf8_lossy(&o.stdout);
            let latency = parse_ping_latency(&stdout).unwrap_or(elapsed);
            Ok(latency)
        }
        Ok(o) => Err(format!(
            "Ping failed: {}",
            String::from_utf8_lossy(&o.stderr)
        )),
        Err(e) => Err(format!("Ping error: {}", e)),
    }
}

/// Parse the latency value from a ping output string.
pub fn parse_ping_latency(output: &str) -> Option<u64> {
    // Windows: "time=42ms" or "time<1ms"
    // Linux: "time=42.3 ms"
    let re = regex::Regex::new(r"time[<=](\d+(?:\.\d+)?)").ok()?;
    re.captures(output)
        .and_then(|c| c[1].parse::<f64>().ok())
        .map(|v| v as u64)
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Reconnect controller
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Tracks reconnect attempts and applies the policy.
pub struct ReconnectController {
    policy: ReconnectPolicy,
    attempt: u32,
    total_reconnects: u32,
}

impl ReconnectController {
    pub fn new(policy: ReconnectPolicy) -> Self {
        Self {
            policy,
            attempt: 0,
            total_reconnects: 0,
        }
    }

    /// Record a failed connection – should we try again?
    pub fn on_disconnect(&mut self) -> Option<u64> {
        if !self.policy.should_retry(self.attempt) {
            return None;
        }
        let delay = self.policy.delay_for_attempt(self.attempt);
        self.attempt += 1;
        self.total_reconnects += 1;
        Some(delay)
    }

    /// Call when a successful connection is established.
    pub fn on_connected(&mut self) {
        self.attempt = 0;
    }

    /// Reset to initial state.
    pub fn reset(&mut self) {
        self.attempt = 0;
    }

    pub fn current_attempt(&self) -> u32 {
        self.attempt
    }

    pub fn total_reconnects(&self) -> u32 {
        self.total_reconnects
    }

    pub fn policy(&self) -> &ReconnectPolicy {
        &self.policy
    }

    pub fn set_policy(&mut self, policy: ReconnectPolicy) {
        self.policy = policy;
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Tunnel state tracker (aggregated view)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Aggregated tunnel state that the service exposes.
pub struct TunnelState {
    pub status: RwLock<ConnectionStatus>,
    pub local_ip: RwLock<Option<String>>,
    pub remote_ip: RwLock<Option<String>>,
    pub server_ip: RwLock<Option<String>>,
    pub bandwidth: RwLock<BandwidthTracker>,
    pub reconnect: RwLock<ReconnectController>,
    pub last_health: RwLock<Option<HealthCheck>>,
    pub connected_at: RwLock<Option<chrono::DateTime<Utc>>>,
    pub disconnected_at: RwLock<Option<chrono::DateTime<Utc>>>,
    pub last_error: RwLock<Option<String>>,
}

impl TunnelState {
    pub fn new(reconnect_policy: ReconnectPolicy) -> Arc<Self> {
        Arc::new(Self {
            status: RwLock::new(ConnectionStatus::Disconnected),
            local_ip: RwLock::new(None),
            remote_ip: RwLock::new(None),
            server_ip: RwLock::new(None),
            bandwidth: RwLock::new(BandwidthTracker::new(3600)),
            reconnect: RwLock::new(ReconnectController::new(reconnect_policy)),
            last_health: RwLock::new(None),
            connected_at: RwLock::new(None),
            disconnected_at: RwLock::new(None),
            last_error: RwLock::new(None),
        })
    }

    pub async fn set_status(&self, status: ConnectionStatus) {
        *self.status.write().await = status;
    }

    pub async fn get_status(&self) -> ConnectionStatus {
        self.status.read().await.clone()
    }

    pub async fn set_connected(&self, local_ip: String, remote_ip: Option<String>) {
        *self.status.write().await = ConnectionStatus::Connected;
        *self.local_ip.write().await = Some(local_ip);
        *self.remote_ip.write().await = remote_ip;
        *self.connected_at.write().await = Some(Utc::now());
        self.reconnect.write().await.on_connected();
    }

    pub async fn set_disconnected(&self, error: Option<String>) {
        *self.status.write().await = if error.is_some() {
            ConnectionStatus::Error(error.clone().unwrap_or_default())
        } else {
            ConnectionStatus::Disconnected
        };
        *self.disconnected_at.write().await = Some(Utc::now());
        *self.last_error.write().await = error;
    }

    pub async fn record_bandwidth(&self, rx: u64, tx: u64) -> BandwidthSample {
        self.bandwidth.write().await.record(rx, tx)
    }

    pub async fn get_stats(&self) -> SessionStats {
        let mut stats = self.bandwidth.read().await.stats();
        stats.reconnect_count = self.reconnect.read().await.total_reconnects();
        stats
    }

    pub async fn uptime_seconds(&self) -> u64 {
        if let Some(connected_at) = *self.connected_at.read().await {
            Utc::now()
                .signed_duration_since(connected_at)
                .num_seconds()
                .max(0) as u64
        } else {
            0
        }
    }

    pub async fn to_connection_info(
        &self,
        id: &str,
        label: &str,
        remote: Option<RemoteEndpoint>,
        pid: Option<u32>,
        created_at: chrono::DateTime<Utc>,
    ) -> ConnectionInfo {
        let stats = self.get_stats().await;
        ConnectionInfo {
            id: id.to_string(),
            label: label.to_string(),
            status: self.get_status().await,
            remote,
            local_ip: self.local_ip.read().await.clone(),
            remote_ip: self.remote_ip.read().await.clone(),
            server_ip: self.server_ip.read().await.clone(),
            process_id: pid,
            created_at,
            connected_at: *self.connected_at.read().await,
            disconnected_at: *self.disconnected_at.read().await,
            bytes_rx: stats.total_bytes_rx,
            bytes_tx: stats.total_bytes_tx,
            uptime_seconds: self.uptime_seconds().await,
            last_error: self.last_error.read().await.clone(),
        }
    }
}

/// Format bytes into a human-readable string (e.g. "1.23 MB").
pub fn format_bytes(bytes: u64) -> String {
    const KB: f64 = 1024.0;
    const MB: f64 = 1024.0 * 1024.0;
    const GB: f64 = 1024.0 * 1024.0 * 1024.0;

    let b = bytes as f64;
    if b >= GB {
        format!("{:.2} GB", b / GB)
    } else if b >= MB {
        format!("{:.2} MB", b / MB)
    } else if b >= KB {
        format!("{:.2} KB", b / KB)
    } else {
        format!("{} B", bytes)
    }
}

/// Format a speed in bytes/sec into a human-readable string.
pub fn format_speed(bytes_per_sec: f64) -> String {
    let formatted = format_bytes(bytes_per_sec as u64);
    format!("{}/s", formatted)
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── BandwidthTracker ─────────────────────────────────────────

    #[test]
    fn tracker_empty_stats() {
        let t = BandwidthTracker::new(100);
        let s = t.stats();
        assert_eq!(s.total_bytes_rx, 0);
        assert_eq!(s.samples, 0);
    }

    #[test]
    fn tracker_single_sample() {
        let mut t = BandwidthTracker::new(100);
        let sample = t.record(1000, 500);
        assert_eq!(sample.bytes_rx, 1000);
        assert_eq!(sample.bytes_tx, 500);
        assert_eq!(t.sample_count(), 1);
    }

    #[test]
    fn tracker_cumulative_stats() {
        let mut t = BandwidthTracker::new(100);
        t.record(1000, 500);
        t.record(2000, 1000);
        let s = t.stats();
        assert_eq!(s.total_bytes_rx, 2000);
        assert_eq!(s.total_bytes_tx, 1000);
        assert_eq!(s.samples, 2);
    }

    #[test]
    fn tracker_max_samples() {
        let mut t = BandwidthTracker::new(3);
        for i in 0..5 {
            t.record(i * 100, i * 50);
        }
        assert_eq!(t.sample_count(), 3);
    }

    #[test]
    fn tracker_recent_samples() {
        let mut t = BandwidthTracker::new(100);
        for i in 0..10 {
            t.record(i * 100, i * 50);
        }
        let recent = t.recent_samples(3);
        assert_eq!(recent.len(), 3);
    }

    #[test]
    fn tracker_reset() {
        let mut t = BandwidthTracker::new(100);
        t.record(1000, 500);
        t.reset();
        assert_eq!(t.sample_count(), 0);
    }

    // ── ReconnectController ──────────────────────────────────────

    #[test]
    fn reconnect_first_attempt() {
        let mut rc = ReconnectController::new(ReconnectPolicy::default());
        let delay = rc.on_disconnect();
        assert!(delay.is_some());
        assert_eq!(delay.unwrap(), 2); // base_delay
    }

    #[test]
    fn reconnect_exponential_backoff() {
        let mut rc = ReconnectController::new(ReconnectPolicy::default());
        let d0 = rc.on_disconnect().unwrap();
        let d1 = rc.on_disconnect().unwrap();
        let d2 = rc.on_disconnect().unwrap();
        assert!(d1 > d0);
        assert!(d2 > d1);
    }

    #[test]
    fn reconnect_max_attempts() {
        let policy = ReconnectPolicy {
            max_attempts: 2,
            ..Default::default()
        };
        let mut rc = ReconnectController::new(policy);
        assert!(rc.on_disconnect().is_some()); // attempt 0
        assert!(rc.on_disconnect().is_some()); // attempt 1
        assert!(rc.on_disconnect().is_none()); // attempt 2 = max → None
    }

    #[test]
    fn reconnect_reset_on_connected() {
        let mut rc = ReconnectController::new(ReconnectPolicy::default());
        rc.on_disconnect();
        rc.on_disconnect();
        rc.on_connected();
        assert_eq!(rc.current_attempt(), 0);
        assert_eq!(rc.total_reconnects(), 2);
    }

    #[test]
    fn reconnect_disabled() {
        let policy = ReconnectPolicy {
            enabled: false,
            ..Default::default()
        };
        let mut rc = ReconnectController::new(policy);
        assert!(rc.on_disconnect().is_none());
    }

    #[test]
    fn reconnect_total_count() {
        let mut rc = ReconnectController::new(ReconnectPolicy::default());
        rc.on_disconnect();
        rc.on_connected();
        rc.on_disconnect();
        rc.on_disconnect();
        assert_eq!(rc.total_reconnects(), 3);
    }

    // ── TunnelState ──────────────────────────────────────────────

    #[tokio::test]
    async fn tunnel_state_initial() {
        let ts = TunnelState::new(ReconnectPolicy::default());
        assert_eq!(ts.get_status().await, ConnectionStatus::Disconnected);
        assert_eq!(ts.uptime_seconds().await, 0);
    }

    #[tokio::test]
    async fn tunnel_state_set_connected() {
        let ts = TunnelState::new(ReconnectPolicy::default());
        ts.set_connected("10.8.0.2".into(), Some("10.8.0.1".into()))
            .await;
        assert_eq!(ts.get_status().await, ConnectionStatus::Connected);
        assert_eq!(
            *ts.local_ip.read().await,
            Some("10.8.0.2".to_string())
        );
    }

    #[tokio::test]
    async fn tunnel_state_set_disconnected_error() {
        let ts = TunnelState::new(ReconnectPolicy::default());
        ts.set_disconnected(Some("timeout".into())).await;
        assert!(matches!(
            ts.get_status().await,
            ConnectionStatus::Error(_)
        ));
        assert_eq!(
            *ts.last_error.read().await,
            Some("timeout".to_string())
        );
    }

    #[tokio::test]
    async fn tunnel_state_bandwidth() {
        let ts = TunnelState::new(ReconnectPolicy::default());
        ts.record_bandwidth(1000, 500).await;
        ts.record_bandwidth(2000, 1000).await;
        let stats = ts.get_stats().await;
        assert_eq!(stats.total_bytes_rx, 2000);
        assert_eq!(stats.samples, 2);
    }

    #[tokio::test]
    async fn tunnel_state_to_info() {
        let ts = TunnelState::new(ReconnectPolicy::default());
        ts.set_connected("10.8.0.2".into(), None).await;
        let info = ts
            .to_connection_info("conn-1", "My VPN", None, Some(1234), Utc::now())
            .await;
        assert_eq!(info.id, "conn-1");
        assert_eq!(info.status, ConnectionStatus::Connected);
        assert_eq!(info.local_ip, Some("10.8.0.2".into()));
        assert_eq!(info.process_id, Some(1234));
    }

    // ── Health check parsing ─────────────────────────────────────

    #[test]
    fn parse_ping_latency_windows() {
        let output = "Reply from 10.8.0.1: bytes=32 time=42ms TTL=64";
        assert_eq!(parse_ping_latency(output), Some(42));
    }

    #[test]
    fn parse_ping_latency_linux() {
        let output = "64 bytes from 10.8.0.1: icmp_seq=1 ttl=64 time=42.3 ms";
        assert_eq!(parse_ping_latency(output), Some(42));
    }

    #[test]
    fn parse_ping_latency_sub_ms() {
        let output = "Reply from 10.8.0.1: bytes=32 time<1ms TTL=64";
        assert_eq!(parse_ping_latency(output), Some(1));
    }

    #[test]
    fn parse_ping_latency_no_match() {
        assert_eq!(parse_ping_latency("Request timed out."), None);
    }

    // ── Format helpers ───────────────────────────────────────────

    #[test]
    fn format_bytes_units() {
        assert_eq!(format_bytes(0), "0 B");
        assert_eq!(format_bytes(512), "512 B");
        assert_eq!(format_bytes(1024), "1.00 KB");
        assert_eq!(format_bytes(1048576), "1.00 MB");
        assert_eq!(format_bytes(1073741824), "1.00 GB");
    }

    #[test]
    fn format_speed_test() {
        let s = format_speed(1048576.0);
        assert!(s.contains("MB"));
        assert!(s.contains("/s"));
    }

    // ── HealthStatus serde ───────────────────────────────────────

    #[test]
    fn health_status_serde() {
        let variants = vec![
            HealthStatus::Healthy,
            HealthStatus::Degraded,
            HealthStatus::Unhealthy,
            HealthStatus::Unknown,
        ];
        for v in &variants {
            let json = serde_json::to_string(v).unwrap();
            let back: HealthStatus = serde_json::from_str(&json).unwrap();
            assert_eq!(v, &back);
        }
    }
}
