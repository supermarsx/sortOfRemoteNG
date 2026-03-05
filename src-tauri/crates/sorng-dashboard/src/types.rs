//! Data types, enums, and configuration structs for the dashboard engine.

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

// ─── Dashboard State ────────────────────────────────────────────────

/// Top-level dashboard state returned to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashboardState {
    pub widgets: Vec<WidgetData>,
    pub last_updated: DateTime<Utc>,
    pub health_summary: HealthSummary,
    pub alerts: Vec<DashboardAlert>,
    pub quick_stats: QuickStats,
}

impl Default for DashboardState {
    fn default() -> Self {
        Self {
            widgets: Vec::new(),
            last_updated: Utc::now(),
            health_summary: HealthSummary::default(),
            alerts: Vec::new(),
            quick_stats: QuickStats::default(),
        }
    }
}

// ─── Health Summary ─────────────────────────────────────────────────

/// Aggregated health summary across all monitored connections.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthSummary {
    pub total_connections: usize,
    pub online: usize,
    pub offline: usize,
    pub degraded: usize,
    pub unknown: usize,
    /// Percentage of healthy connections (0.0–100.0).
    pub health_pct: f64,
    pub by_protocol: HashMap<String, ProtocolSummary>,
    pub by_group: HashMap<String, GroupSummary>,
}

impl Default for HealthSummary {
    fn default() -> Self {
        Self {
            total_connections: 0,
            online: 0,
            offline: 0,
            degraded: 0,
            unknown: 0,
            health_pct: 100.0,
            by_protocol: HashMap::new(),
            by_group: HashMap::new(),
        }
    }
}

/// Per-protocol summary.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProtocolSummary {
    pub total: usize,
    pub online: usize,
    pub offline: usize,
    pub avg_latency_ms: Option<f64>,
}

/// Per-group summary.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupSummary {
    pub group_name: String,
    pub total: usize,
    pub online: usize,
    pub offline: usize,
}

// ─── Widgets ────────────────────────────────────────────────────────

/// Data payload for a single dashboard widget.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WidgetData {
    pub id: String,
    pub widget_type: WidgetType,
    pub title: String,
    pub position: WidgetPosition,
    pub size: WidgetSize,
    pub data: serde_json::Value,
    pub last_updated: DateTime<Utc>,
    pub refresh_interval_seconds: u64,
}

/// Available widget types.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum WidgetType {
    StatusHeatMap,
    RecentConnections,
    LatencySparklines,
    AlertFeed,
    QuickStats,
    ProtocolBreakdown,
    ConnectionList,
    UptimeChart,
    CertificateExpiry,
    TopLatency,
    GroupOverview,
    Custom(String),
}

/// Widget position on the grid.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WidgetPosition {
    pub row: u32,
    pub col: u32,
}

/// Widget size in grid units.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WidgetSize {
    pub width: u32,
    pub height: u32,
}

// ─── Alerts ─────────────────────────────────────────────────────────

/// A dashboard alert.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashboardAlert {
    pub id: String,
    pub severity: AlertSeverity,
    pub title: String,
    pub message: String,
    pub connection_id: Option<String>,
    pub timestamp: DateTime<Utc>,
    pub acknowledged: bool,
    pub alert_type: DashboardAlertType,
}

/// Alert severity level.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AlertSeverity {
    Info,
    Warning,
    Error,
    Critical,
}

/// Dashboard alert types.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum DashboardAlertType {
    ConnectionDown,
    HighLatency,
    CertExpiring,
    BackupFailed,
    HealthCheckFailed,
    CredentialExpiring,
    SyncFailed,
}

// ─── Quick Stats ────────────────────────────────────────────────────

/// Quick statistics for the dashboard header.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuickStats {
    pub total_connections: usize,
    pub active_sessions: usize,
    pub protocols_used: Vec<String>,
    pub avg_latency_ms: f64,
    pub uptime_pct: f64,
    pub recent_errors: usize,
    pub last_backup: Option<DateTime<Utc>>,
    pub last_sync: Option<DateTime<Utc>>,
}

impl Default for QuickStats {
    fn default() -> Self {
        Self {
            total_connections: 0,
            active_sessions: 0,
            protocols_used: Vec::new(),
            avg_latency_ms: 0.0,
            uptime_pct: 100.0,
            recent_errors: 0,
            last_backup: None,
            last_sync: None,
        }
    }
}

// ─── Connection Health ──────────────────────────────────────────────

/// Health information for a single connection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionHealthEntry {
    pub connection_id: String,
    pub name: String,
    pub hostname: String,
    pub protocol: String,
    pub status: HealthStatus,
    pub latency_ms: Option<f64>,
    pub latency_history: Vec<LatencyPoint>,
    pub last_checked: Option<DateTime<Utc>>,
    pub uptime_pct: Option<f64>,
    pub error_count: u32,
    pub last_error: Option<String>,
    /// Optional group this connection belongs to.
    #[serde(default)]
    pub group: Option<String>,
}

/// Connection health status.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum HealthStatus {
    Healthy,
    Degraded,
    Down,
    Unknown,
    Unchecked,
}

/// A single latency measurement.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LatencyPoint {
    pub timestamp: DateTime<Utc>,
    pub latency_ms: f64,
}

// ─── Configuration ──────────────────────────────────────────────────

/// Dashboard engine configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashboardConfig {
    pub enabled: bool,
    pub poll_interval_seconds: u64,
    pub max_latency_history: usize,
    pub alert_retention_hours: u64,
    pub widgets: Vec<WidgetConfig>,
    pub max_concurrent_checks: usize,
    pub health_check_timeout_ms: u64,
}

impl Default for DashboardConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            poll_interval_seconds: 60,
            max_latency_history: 120,
            alert_retention_hours: 72,
            widgets: Vec::new(),
            max_concurrent_checks: 10,
            health_check_timeout_ms: 5000,
        }
    }
}

/// Configuration for a single widget.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WidgetConfig {
    pub widget_type: WidgetType,
    pub enabled: bool,
    pub position: WidgetPosition,
    pub size: WidgetSize,
    pub refresh_interval_seconds: u64,
    pub custom_config: Option<serde_json::Value>,
}

/// Full dashboard layout descriptor.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashboardLayout {
    pub widgets: Vec<WidgetConfig>,
    pub columns: u32,
    pub row_height: u32,
    pub gap: u32,
}

impl Default for DashboardLayout {
    fn default() -> Self {
        Self {
            widgets: Vec::new(),
            columns: 12,
            row_height: 80,
            gap: 8,
        }
    }
}
