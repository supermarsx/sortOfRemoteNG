//! # WireGuard NAT Keepalive
//!
//! Persistent keepalive management, adaptive keepalive tuning,
//! NAT timeout detection, UDP hole maintenance.

use serde::{Deserialize, Serialize};

/// NAT keepalive configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NatKeepaliveConfig {
    /// Base persistent keepalive interval (seconds). 0 = disabled.
    pub interval: u16,
    /// Whether to use adaptive keepalive.
    pub adaptive: bool,
    /// Minimum adaptive interval (seconds).
    pub min_interval: u16,
    /// Maximum adaptive interval (seconds).
    pub max_interval: u16,
    /// Number of probes to send for NAT timeout detection.
    pub detection_probes: u8,
}

impl Default for NatKeepaliveConfig {
    fn default() -> Self {
        Self {
            interval: 25,
            adaptive: false,
            min_interval: 15,
            max_interval: 120,
            detection_probes: 5,
        }
    }
}

/// Result of NAT timeout detection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NatTimeoutResult {
    pub estimated_timeout_secs: u64,
    pub recommended_keepalive: u16,
    pub nat_type: NatTraversalType,
    pub probes_sent: u8,
    pub probes_received: u8,
}

/// NAT traversal classification for WireGuard.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum NatTraversalType {
    /// No NAT — direct connection.
    Direct,
    /// Endpoint-independent mapping (easy).
    EndpointIndependent,
    /// Address-dependent mapping.
    AddressDependent,
    /// Address and port dependent (hard).
    AddressPortDependent,
    /// Symmetric NAT (hardest).
    Symmetric,
    /// Unknown — detection inconclusive.
    Unknown,
}

/// Recommend a keepalive interval based on NAT detection results.
pub fn recommend_keepalive(nat_result: &NatTimeoutResult) -> u16 {
    if nat_result.estimated_timeout_secs == 0 {
        return 25; // safe default
    }

    // Use 2/3 of detected timeout, clamped to reasonable range
    let recommended = (nat_result.estimated_timeout_secs * 2 / 3) as u16;
    recommended.clamp(10, 120)
}

/// Recommend keepalive for known NAT types.
pub fn keepalive_for_nat_type(nat_type: NatTraversalType) -> u16 {
    match nat_type {
        NatTraversalType::Direct => 0, // no keepalive needed
        NatTraversalType::EndpointIndependent => 25,
        NatTraversalType::AddressDependent => 25,
        NatTraversalType::AddressPortDependent => 20,
        NatTraversalType::Symmetric => 15,
        NatTraversalType::Unknown => 25,
    }
}

/// Adaptive keepalive state tracker.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdaptiveKeepalive {
    pub current_interval: u16,
    pub min_interval: u16,
    pub max_interval: u16,
    pub consecutive_successes: u32,
    pub consecutive_failures: u32,
    pub last_adjustment: Option<String>,
}

impl AdaptiveKeepalive {
    pub fn new(config: &NatKeepaliveConfig) -> Self {
        Self {
            current_interval: config.interval,
            min_interval: config.min_interval,
            max_interval: config.max_interval,
            consecutive_successes: 0,
            consecutive_failures: 0,
            last_adjustment: None,
        }
    }

    /// Record a successful handshake/keepalive.
    pub fn record_success(&mut self) {
        self.consecutive_successes += 1;
        self.consecutive_failures = 0;

        // After many successes, try increasing the interval
        if self.consecutive_successes >= 10 && self.current_interval < self.max_interval {
            self.current_interval = (self.current_interval + 5).min(self.max_interval);
            self.consecutive_successes = 0;
            self.last_adjustment = Some(format!(
                "Increased to {} after sustained connectivity",
                self.current_interval
            ));
        }
    }

    /// Record a failed keepalive / stale handshake.
    pub fn record_failure(&mut self) {
        self.consecutive_failures += 1;
        self.consecutive_successes = 0;

        // Rapidly decrease on failure
        if self.consecutive_failures >= 2 && self.current_interval > self.min_interval {
            self.current_interval = (self.current_interval - 5).max(self.min_interval);
            self.last_adjustment = Some(format!(
                "Decreased to {} after connectivity issues",
                self.current_interval
            ));
        }
    }

    /// Get current recommended interval.
    pub fn interval(&self) -> u16 {
        self.current_interval
    }
}

/// Analyze if the current keepalive is appropriate based on handshake history.
pub fn analyze_keepalive_effectiveness(
    current_keepalive: u16,
    handshake_intervals: &[u64],
) -> KeepaliveAnalysis {
    if handshake_intervals.is_empty() {
        return KeepaliveAnalysis {
            current_interval: current_keepalive,
            recommended_interval: current_keepalive,
            effectiveness: 0.0,
            issue: Some("No handshake data available".to_string()),
        };
    }

    let expected_max = (current_keepalive as u64) + 10; // tolerance

    let on_time = handshake_intervals
        .iter()
        .filter(|&&interval| interval <= expected_max)
        .count();

    let effectiveness = on_time as f64 / handshake_intervals.len() as f64;

    let avg_interval: u64 =
        handshake_intervals.iter().sum::<u64>() / handshake_intervals.len() as u64;

    let recommended = if effectiveness < 0.8 {
        // Keepalive is too long, reduce
        (current_keepalive as u64 * 3 / 4).max(10) as u16
    } else if effectiveness > 0.99 && avg_interval < (current_keepalive as u64 / 2) {
        // Handshakes happening much more frequently than keepalive
        // keepalive is fine, leave it
        current_keepalive
    } else {
        current_keepalive
    };

    let issue = if effectiveness < 0.5 {
        Some("Keepalive interval appears too high — handshakes frequently stale".to_string())
    } else if effectiveness < 0.8 {
        Some("Some handshake gaps detected — consider reducing keepalive interval".to_string())
    } else {
        None
    };

    KeepaliveAnalysis {
        current_interval: current_keepalive,
        recommended_interval: recommended,
        effectiveness,
        issue,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeepaliveAnalysis {
    pub current_interval: u16,
    pub recommended_interval: u16,
    pub effectiveness: f64,
    pub issue: Option<String>,
}

/// Build the PersistentKeepAlive line for a WireGuard config peer section.
pub fn keepalive_config_line(seconds: u16) -> String {
    if seconds == 0 {
        String::new()
    } else {
        format!("PersistentKeepalive = {}", seconds)
    }
}

/// Validate a keepalive value.
pub fn validate_keepalive(seconds: u16) -> Vec<String> {
    let mut issues = Vec::new();

    if seconds > 0 && seconds < 10 {
        issues.push(format!(
            "Keepalive of {} seconds is very aggressive — may increase bandwidth usage",
            seconds
        ));
    }

    if seconds > 120 {
        issues.push(format!(
            "Keepalive of {} seconds may be too long for some NAT types (typical timeout: 30-120s)",
            seconds
        ));
    }

    issues
}
