//! Service façade for the dashboard engine.
//!
//! Wraps the worker, monitor, alert manager, and layout behind a
//! single `Arc<Mutex<..>>` compatible with Tauri managed state.

use std::sync::Arc;
use tokio::sync::Mutex;

use crate::aggregator;
use crate::alerts::DashboardAlertManager;
use crate::error::DashboardError;
use crate::monitor::HealthMonitor;
use crate::sparkline;
use crate::types::*;
use crate::worker::{ConnectionDescriptor, DashboardWorker, SharedDashboardState};

/// Type alias for the Tauri managed state.
pub type DashboardServiceState = Arc<Mutex<DashboardService>>;

/// Top-level façade for the dashboard engine.
pub struct DashboardService {
    pub monitor: HealthMonitor,
    pub alert_manager: DashboardAlertManager,
    pub worker: DashboardWorker,
    pub layout: DashboardLayout,
    pub config: DashboardConfig,
}

impl DashboardService {
    /// Create a new `DashboardService` wrapped in `Arc<Mutex<..>>`.
    pub fn new() -> DashboardServiceState {
        let config = DashboardConfig::default();
        let service = Self {
            monitor: HealthMonitor::new(config.clone()),
            alert_manager: DashboardAlertManager::new(config.alert_retention_hours),
            worker: DashboardWorker::new(config.clone()),
            layout: DashboardLayout::default(),
            config,
        };
        Arc::new(Mutex::new(service))
    }

    /// Create with a custom configuration.
    pub fn with_config(config: DashboardConfig) -> DashboardServiceState {
        let service = Self {
            monitor: HealthMonitor::new(config.clone()),
            alert_manager: DashboardAlertManager::new(config.alert_retention_hours),
            worker: DashboardWorker::new(config.clone()),
            layout: DashboardLayout::default(),
            config,
        };
        Arc::new(Mutex::new(service))
    }

    // ── State accessors ─────────────────────────────────────────

    /// Get the shared dashboard state handle from the worker.
    pub fn state_handle(&self) -> SharedDashboardState {
        self.worker.state_handle()
    }

    /// Snapshot the current dashboard state.
    pub async fn get_state(&self) -> DashboardState {
        let handle = self.worker.state_handle();
        let st = handle.lock().await;
        st.clone()
    }

    /// Get the current health summary.
    pub fn get_health_summary(&self) -> HealthSummary {
        let entries = self.monitor.get_all_entries();
        let refs: Vec<&ConnectionHealthEntry> = entries.into_iter().collect();
        aggregator::aggregate_health_summary(&refs)
    }

    /// Get quick stats.
    pub fn get_quick_stats(&self) -> QuickStats {
        let entries = self.monitor.get_all_entries();
        let refs: Vec<&ConnectionHealthEntry> = entries.into_iter().collect();
        aggregator::compute_quick_stats(&refs, 0, None, None)
    }

    // ── Alerts ──────────────────────────────────────────────────

    pub fn get_alerts(&self) -> Vec<DashboardAlert> {
        self.alert_manager.get_all_alerts().to_vec()
    }

    pub fn get_active_alerts(&self) -> Vec<DashboardAlert> {
        self.alert_manager
            .get_active_alerts()
            .into_iter()
            .cloned()
            .collect()
    }

    pub fn acknowledge_alert(&mut self, alert_id: &str) -> Result<(), DashboardError> {
        if self.alert_manager.acknowledge_alert(alert_id) {
            Ok(())
        } else {
            Err(DashboardError::AlertNotFound(alert_id.to_string()))
        }
    }

    // ── Health entries ──────────────────────────────────────────

    pub fn get_connection_health(
        &self,
        connection_id: &str,
    ) -> Result<ConnectionHealthEntry, DashboardError> {
        self.monitor
            .get_entry(connection_id)
            .cloned()
            .ok_or_else(|| DashboardError::ConnectionNotFound(connection_id.to_string()))
    }

    pub fn get_all_health(&self) -> Vec<ConnectionHealthEntry> {
        self.monitor
            .get_all_entries()
            .into_iter()
            .cloned()
            .collect()
    }

    pub fn get_unhealthy(&self) -> Vec<ConnectionHealthEntry> {
        self.monitor.get_unhealthy().into_iter().cloned().collect()
    }

    // ── Sparkline ───────────────────────────────────────────────

    pub fn get_sparkline(
        &self,
        connection_id: &str,
        width: usize,
    ) -> Result<Vec<f64>, DashboardError> {
        let entry = self
            .monitor
            .get_entry(connection_id)
            .ok_or_else(|| DashboardError::ConnectionNotFound(connection_id.to_string()))?;
        let raw: Vec<f64> = entry.latency_history.iter().map(|p| p.latency_ms).collect();
        Ok(sparkline::generate_sparkline(&raw, width))
    }

    // ── Widget data ─────────────────────────────────────────────

    pub fn get_widget_data(&self, widget_type: &WidgetType) -> WidgetData {
        let entries = self.monitor.get_all_entries();
        let refs: Vec<&ConnectionHealthEntry> = entries.into_iter().collect();
        let summary = aggregator::aggregate_health_summary(&refs);
        let alerts = self.alert_manager.get_all_alerts().to_vec();
        crate::widgets::build_widget_data(widget_type, &refs, &alerts, &summary)
    }

    // ── Worker lifecycle ────────────────────────────────────────

    pub async fn start_monitoring(&mut self) -> Result<(), DashboardError> {
        self.worker.start().await
    }

    pub async fn stop_monitoring(&mut self) -> Result<(), DashboardError> {
        self.worker.stop().await
    }

    pub async fn is_monitoring(&self) -> bool {
        self.worker.is_running().await
    }

    pub fn force_refresh(&self) {
        self.worker.force_refresh();
    }

    // ── Configuration ───────────────────────────────────────────

    pub fn get_config(&self) -> DashboardConfig {
        self.config.clone()
    }

    pub fn update_config(&mut self, config: DashboardConfig) {
        self.monitor.set_config(config.clone());
        self.worker.set_config(config.clone());
        self.config = config;
    }

    // ── Layout ──────────────────────────────────────────────────

    pub fn get_layout(&self) -> DashboardLayout {
        self.layout.clone()
    }

    pub fn update_layout(&mut self, layout: DashboardLayout) {
        self.layout = layout;
    }

    // ── Heatmap & helpers ───────────────────────────────────────

    pub fn get_heatmap(&self) -> serde_json::Value {
        let entries = self.monitor.get_all_entries();
        let refs: Vec<&ConnectionHealthEntry> = entries.into_iter().collect();
        crate::widgets::build_status_heatmap(&refs)
    }

    pub fn get_recent(&self, count: usize) -> Vec<ConnectionHealthEntry> {
        let entries = self.monitor.get_all_entries();
        let refs: Vec<&ConnectionHealthEntry> = entries.into_iter().collect();
        aggregator::get_recent_connections(&refs, count)
            .into_iter()
            .cloned()
            .collect()
    }

    pub fn get_top_latency(&self, count: usize) -> Vec<ConnectionHealthEntry> {
        let entries = self.monitor.get_all_entries();
        let refs: Vec<&ConnectionHealthEntry> = entries.into_iter().collect();
        aggregator::get_top_latency(&refs, count)
            .into_iter()
            .cloned()
            .collect()
    }

    /// Run a single health check for a specific connection and record the result.
    pub async fn check_connection(
        &mut self,
        id: &str,
        hostname: &str,
        port: u16,
        protocol: &str,
    ) -> ConnectionHealthEntry {
        self.monitor
            .check_connection_health(id, hostname, port, protocol)
            .await
    }

    /// Register connections that the worker should poll.
    pub async fn set_connections(&self, conns: Vec<ConnectionDescriptor>) {
        self.worker.set_connections(conns).await;
    }
}
