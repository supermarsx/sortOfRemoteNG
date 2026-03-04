//! # SNMP Monitoring Engine
//!
//! Polled SNMP monitoring with threshold-based alerts and history ring-buffers.

use crate::client::SnmpClient;
use crate::error::{SnmpError, SnmpResult};
use crate::types::*;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Maximum data points to keep per OID in history.
const MAX_HISTORY_PER_OID: usize = 1000;

/// SNMP monitoring engine that manages multiple polled targets.
pub struct MonitorEngine {
    /// Active monitor targets.
    monitors: HashMap<String, MonitorTarget>,
    /// Poll history: monitor_id → oid → Vec<PollDataPoint>.
    history: HashMap<String, HashMap<String, Vec<PollDataPoint>>>,
    /// Active alerts.
    alerts: Vec<MonitorAlert>,
    /// Running poll tasks (monitor_id → cancel sender).
    running_tasks: HashMap<String, tokio::sync::watch::Sender<bool>>,
}

impl MonitorEngine {
    pub fn new() -> Self {
        Self {
            monitors: HashMap::new(),
            history: HashMap::new(),
            alerts: vec![],
            running_tasks: HashMap::new(),
        }
    }

    /// Add a new monitor target.
    pub fn add_monitor(&mut self, monitor: MonitorTarget) -> SnmpResult<()> {
        if self.monitors.contains_key(&monitor.id) {
            return Err(SnmpError::config(format!("Monitor '{}' already exists", monitor.id)));
        }
        let id = monitor.id.clone();
        self.monitors.insert(id.clone(), monitor);
        self.history.insert(id, HashMap::new());
        Ok(())
    }

    /// Remove a monitor target and stop its poll task.
    pub fn remove_monitor(&mut self, id: &str) -> bool {
        self.stop_monitor(id);
        self.history.remove(id);
        self.monitors.remove(id).is_some()
    }

    /// Update a monitor's configuration.
    pub fn update_monitor(&mut self, monitor: MonitorTarget) -> SnmpResult<()> {
        let was_running = self.running_tasks.contains_key(&monitor.id);
        if was_running {
            self.stop_monitor(&monitor.id);
        }
        self.monitors.insert(monitor.id.clone(), monitor);
        Ok(())
    }

    /// Get a monitor by ID.
    pub fn get_monitor(&self, id: &str) -> Option<&MonitorTarget> {
        self.monitors.get(id)
    }

    /// List all monitors.
    pub fn list_monitors(&self) -> Vec<&MonitorTarget> {
        self.monitors.values().collect()
    }

    /// Start polling a monitor.
    pub fn start_monitor(&mut self, id: &str, engine: Arc<Mutex<MonitorEngine>>) -> SnmpResult<()> {
        let monitor = self.monitors.get(id)
            .ok_or_else(|| SnmpError::config(format!("Monitor '{}' not found", id)))?
            .clone();

        if self.running_tasks.contains_key(id) {
            return Err(SnmpError::config(format!("Monitor '{}' already running", id)));
        }

        let (tx, rx) = tokio::sync::watch::channel(false);
        self.running_tasks.insert(id.to_string(), tx);

        let id = id.to_string();
        tokio::spawn(async move {
            poll_loop(id, monitor, engine, rx).await;
        });

        Ok(())
    }

    /// Stop a monitor's poll task.
    pub fn stop_monitor(&mut self, id: &str) {
        if let Some(cancel) = self.running_tasks.remove(id) {
            let _ = cancel.send(true);
        }
    }

    /// Record a poll data point and check thresholds.
    pub fn record_poll(&mut self, monitor_id: &str, data_point: PollDataPoint) {
        // Record in history
        if let Some(monitor_history) = self.history.get_mut(monitor_id) {
            let oid_history = monitor_history.entry(data_point.oid.clone()).or_default();
            if oid_history.len() >= MAX_HISTORY_PER_OID {
                oid_history.remove(0);
            }
            oid_history.push(data_point.clone());
        }

        // Check thresholds
        if let Some(monitor) = self.monitors.get(monitor_id) {
            for threshold in &monitor.thresholds {
                if threshold.oid == data_point.oid {
                    if let Some(numeric_value) = extract_numeric(&data_point.value) {
                        if threshold_triggered(numeric_value, threshold.operator, threshold.value) {
                            let alert = MonitorAlert {
                                id: uuid::Uuid::new_v4().to_string(),
                                monitor_id: monitor_id.to_string(),
                                oid: data_point.oid.clone(),
                                current_value: numeric_value,
                                threshold_value: threshold.value,
                                operator: threshold.operator,
                                severity: threshold.severity,
                                description: threshold.description.clone(),
                                triggered_at: chrono::Utc::now().to_rfc3339(),
                                acknowledged: false,
                            };
                            self.alerts.push(alert);
                        }
                    }
                }
            }
        }
    }

    /// Get all alerts.
    pub fn get_alerts(&self) -> &[MonitorAlert] {
        &self.alerts
    }

    /// Get unacknowledged alerts.
    pub fn get_active_alerts(&self) -> Vec<&MonitorAlert> {
        self.alerts.iter().filter(|a| !a.acknowledged).collect()
    }

    /// Acknowledge an alert.
    pub fn acknowledge_alert(&mut self, alert_id: &str) -> bool {
        if let Some(alert) = self.alerts.iter_mut().find(|a| a.id == alert_id) {
            alert.acknowledged = true;
            true
        } else {
            false
        }
    }

    /// Clear all alerts.
    pub fn clear_alerts(&mut self) {
        self.alerts.clear();
    }

    /// Get poll history for a monitor.
    pub fn get_history(&self, monitor_id: &str) -> Option<&HashMap<String, Vec<PollDataPoint>>> {
        self.history.get(monitor_id)
    }

    /// Get history for a specific OID on a monitor.
    pub fn get_oid_history(&self, monitor_id: &str, oid: &str) -> Vec<&PollDataPoint> {
        self.history.get(monitor_id)
            .and_then(|h| h.get(oid))
            .map(|v| v.iter().collect())
            .unwrap_or_default()
    }

    /// Get the number of active monitors.
    pub fn active_count(&self) -> usize {
        self.running_tasks.len()
    }
}

/// Background poll loop for a single monitor.
async fn poll_loop(
    id: String,
    monitor: MonitorTarget,
    engine: Arc<Mutex<MonitorEngine>>,
    mut cancel: tokio::sync::watch::Receiver<bool>,
) {
    let client = SnmpClient::new();
    let interval = tokio::time::Duration::from_secs(monitor.interval_secs);

    loop {
        tokio::select! {
            _ = tokio::time::sleep(interval) => {
                for oid in &monitor.oids {
                    let start = std::time::Instant::now();
                    match client.get_value(&monitor.target, oid).await {
                        Ok(value) => {
                            let data_point = PollDataPoint {
                                oid: oid.clone(),
                                value,
                                timestamp: chrono::Utc::now().to_rfc3339(),
                                rtt_ms: start.elapsed().as_millis() as u64,
                            };
                            let mut eng = engine.lock().await;
                            eng.record_poll(&id, data_point);
                        }
                        Err(e) => {
                            log::warn!("Monitor '{}' poll failed for {}: {}", id, oid, e);
                        }
                    }
                }
            }
            _ = cancel.changed() => {
                if *cancel.borrow() {
                    break;
                }
            }
        }
    }

    log::info!("Monitor '{}' poll loop stopped", id);
}

fn extract_numeric(value: &SnmpValue) -> Option<f64> {
    match value {
        SnmpValue::Integer(v) => Some(*v as f64),
        SnmpValue::Counter32(v) | SnmpValue::Gauge32(v) | SnmpValue::TimeTicks(v) => Some(*v as f64),
        SnmpValue::Counter64(v) => Some(*v as f64),
        _ => None,
    }
}

fn threshold_triggered(current: f64, operator: ThresholdOperator, threshold: f64) -> bool {
    match operator {
        ThresholdOperator::GreaterThan => current > threshold,
        ThresholdOperator::GreaterThanOrEqual => current >= threshold,
        ThresholdOperator::LessThan => current < threshold,
        ThresholdOperator::LessThanOrEqual => current <= threshold,
        ThresholdOperator::Equal => (current - threshold).abs() < f64::EPSILON,
        ThresholdOperator::NotEqual => (current - threshold).abs() > f64::EPSILON,
    }
}
