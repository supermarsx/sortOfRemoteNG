//! # Metrics Collector
//!
//! Connection metrics, bandwidth stats, latency tracking, and per-protocol/per-user
//! aggregation for gateway observability.

use crate::types::*;
use chrono::Utc;
use std::collections::HashMap;

/// Collects and aggregates gateway metrics.
pub struct MetricsCollector {
    /// When metrics collection started
    collection_started: chrono::DateTime<Utc>,
    /// Total connections handled
    total_connections: u64,
    /// Currently active connections
    active_connections: u32,
    /// Total bytes sent (all sessions)
    total_bytes_sent: u64,
    /// Total bytes received (all sessions)
    total_bytes_received: u64,
    /// Connection errors
    connection_errors: u64,
    /// Policy denials
    policy_denials: u64,
    /// Auth failures
    auth_failures: u64,
    /// Session durations for averaging (recent N)
    session_durations: Vec<f64>,
    /// Peak concurrent sessions
    peak_concurrent_sessions: u32,
    /// Per-protocol connection counts
    connections_by_protocol: HashMap<String, u64>,
    /// Per-user connection counts
    connections_by_user: HashMap<String, u64>,
}

impl Default for MetricsCollector {
    fn default() -> Self {
        Self::new()
    }
}

impl MetricsCollector {
    pub fn new() -> Self {
        Self {
            collection_started: Utc::now(),
            total_connections: 0,
            active_connections: 0,
            total_bytes_sent: 0,
            total_bytes_received: 0,
            connection_errors: 0,
            policy_denials: 0,
            auth_failures: 0,
            session_durations: Vec::new(),
            peak_concurrent_sessions: 0,
            connections_by_protocol: HashMap::new(),
            connections_by_user: HashMap::new(),
        }
    }

    /// Record a new connection.
    pub fn record_connection(&mut self, protocol: GatewayProtocol) {
        self.total_connections += 1;
        self.active_connections += 1;
        if self.active_connections > self.peak_concurrent_sessions {
            self.peak_concurrent_sessions = self.active_connections;
        }
        let proto_key = format!("{:?}", protocol);
        *self.connections_by_protocol.entry(proto_key).or_insert(0) += 1;
    }

    /// Record a connection with user tracking.
    pub fn record_connection_with_user(&mut self, protocol: GatewayProtocol, user_id: &str) {
        self.record_connection(protocol);
        *self
            .connections_by_user
            .entry(user_id.to_string())
            .or_insert(0) += 1;
    }

    /// Record the end of a session.
    pub fn record_session_end(&mut self, session: &GatewaySession) {
        if self.active_connections > 0 {
            self.active_connections -= 1;
        }
        self.total_bytes_sent += session.bytes_sent;
        self.total_bytes_received += session.bytes_received;

        // Calculate session duration
        if let Some(connected_at) = session.connected_at {
            let ended = session.ended_at.unwrap_or_else(Utc::now);
            let duration = ended
                .signed_duration_since(connected_at)
                .num_seconds()
                .max(0) as f64;
            self.session_durations.push(duration);
            // Keep only last 1000 durations for averaging
            if self.session_durations.len() > 1000 {
                self.session_durations.remove(0);
            }
        }
    }

    /// Record a connection error.
    pub fn record_error(&mut self) {
        self.connection_errors += 1;
    }

    /// Record a policy denial.
    pub fn record_denial(&mut self) {
        self.policy_denials += 1;
    }

    /// Record an auth failure.
    pub fn record_auth_failure(&mut self) {
        self.auth_failures += 1;
    }

    /// Record bandwidth usage.
    pub fn record_bandwidth(&mut self, sent: u64, received: u64) {
        self.total_bytes_sent += sent;
        self.total_bytes_received += received;
    }

    /// Get a snapshot of current metrics.
    pub fn snapshot(&self) -> GatewayMetrics {
        let avg_duration = if self.session_durations.is_empty() {
            0.0
        } else {
            self.session_durations.iter().sum::<f64>() / self.session_durations.len() as f64
        };

        GatewayMetrics {
            collection_started: self.collection_started,
            total_connections: self.total_connections,
            active_connections: self.active_connections,
            total_bytes_sent: self.total_bytes_sent,
            total_bytes_received: self.total_bytes_received,
            connection_errors: self.connection_errors,
            policy_denials: self.policy_denials,
            auth_failures: self.auth_failures,
            avg_session_duration_secs: avg_duration,
            peak_concurrent_sessions: self.peak_concurrent_sessions,
            connections_by_protocol: self.connections_by_protocol.clone(),
            connections_by_user: self.connections_by_user.clone(),
        }
    }

    /// Reset all metrics.
    pub fn reset(&mut self) {
        *self = Self::new();
    }

    /// Get total bandwidth transferred (sent + received).
    pub fn total_bandwidth(&self) -> u64 {
        self.total_bytes_sent + self.total_bytes_received
    }

    /// Get the average session duration in seconds.
    pub fn avg_session_duration(&self) -> f64 {
        if self.session_durations.is_empty() {
            0.0
        } else {
            self.session_durations.iter().sum::<f64>() / self.session_durations.len() as f64
        }
    }
}
