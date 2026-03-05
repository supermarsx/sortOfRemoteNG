//! Background worker for periodic health polling.
//!
//! [`DashboardWorker`] runs a low-overhead loop on a Tokio task, polling
//! connection health at the configured interval, aggregating results,
//! generating widget data, detecting alerts, and updating the shared
//! dashboard state.

use std::sync::Arc;
use tokio::sync::{watch, Mutex, Notify};
use tokio::time::{interval, Duration};

use log::{debug, info};

use crate::aggregator;
use crate::alerts::DashboardAlertManager;
use crate::monitor::HealthMonitor;
use crate::types::*;
use crate::widgets;

/// Shared dashboard state accessible from commands.
pub type SharedDashboardState = Arc<Mutex<DashboardState>>;

/// A connection descriptor for the worker to poll.
#[derive(Debug, Clone)]
pub struct ConnectionDescriptor {
    pub id: String,
    pub name: String,
    pub hostname: String,
    pub port: u16,
    pub protocol: String,
    pub group: Option<String>,
}

/// Background dashboard worker.
pub struct DashboardWorker {
    config: DashboardConfig,
    state: SharedDashboardState,
    connections: Arc<Mutex<Vec<ConnectionDescriptor>>>,
    running: Arc<Mutex<bool>>,
    stop_tx: Option<watch::Sender<bool>>,
    force_notify: Arc<Notify>,
}

impl DashboardWorker {
    /// Create a new worker (not yet started).
    pub fn new(config: DashboardConfig) -> Self {
        Self {
            config,
            state: Arc::new(Mutex::new(DashboardState::default())),
            connections: Arc::new(Mutex::new(Vec::new())),
            running: Arc::new(Mutex::new(false)),
            stop_tx: None,
            force_notify: Arc::new(Notify::new()),
        }
    }

    /// Get a handle to the shared dashboard state.
    pub fn state_handle(&self) -> SharedDashboardState {
        self.state.clone()
    }

    /// Set the list of connections the worker should poll.
    pub async fn set_connections(&self, conns: Vec<ConnectionDescriptor>) {
        let mut lock = self.connections.lock().await;
        *lock = conns;
    }

    /// Start the background polling loop.
    pub async fn start(&mut self) -> Result<(), crate::error::DashboardError> {
        {
            let is_running = self.running.lock().await;
            if *is_running {
                return Err(crate::error::DashboardError::AlreadyRunning);
            }
        }

        let (stop_tx, stop_rx) = watch::channel(false);
        self.stop_tx = Some(stop_tx);

        let config = self.config.clone();
        let state = self.state.clone();
        let connections = self.connections.clone();
        let running = self.running.clone();
        let force_notify = self.force_notify.clone();

        {
            let mut r = running.lock().await;
            *r = true;
        }

        info!("Dashboard worker starting (poll every {}s)", config.poll_interval_seconds);

        tokio::spawn(async move {
            let mut tick = interval(Duration::from_secs(config.poll_interval_seconds));
            let mut stop_rx = stop_rx;
            let mut monitor = HealthMonitor::new(config.clone());
            let mut alert_mgr = DashboardAlertManager::new(config.alert_retention_hours);

            loop {
                tokio::select! {
                    _ = tick.tick() => {},
                    _ = force_notify.notified() => {
                        debug!("Dashboard worker: forced refresh");
                    },
                    Ok(()) = stop_rx.changed() => {
                        if *stop_rx.borrow() {
                            info!("Dashboard worker stopping");
                            break;
                        }
                    }
                }

                // 1. Read current connection list.
                let conns = {
                    let lock = connections.lock().await;
                    lock.clone()
                };

                if conns.is_empty() {
                    debug!("Dashboard worker: no connections to poll");
                    continue;
                }

                // 2. Poll health with concurrency limit.
                let semaphore = Arc::new(tokio::sync::Semaphore::new(
                    config.max_concurrent_checks,
                ));

                let monitor_ref = Arc::new(Mutex::new(&mut monitor));

                // Sequential polling to avoid complex shared-mut issues while
                // still remaining non-blocking on the async runtime.
                for conn in &conns {
                    let _permit = semaphore.acquire().await;
                    let mut mon = monitor_ref.lock().await;
                    let mut entry = mon
                        .check_connection_health(
                            &conn.id,
                            &conn.hostname,
                            conn.port,
                            &conn.protocol,
                        )
                        .await;
                    // Attach group and name.
                    entry.group = conn.group.clone();
                    entry.name = conn.name.clone();
                    mon.update_entry(&conn.id, entry);
                }

                // 3. Aggregate.
                let all_entries = {
                    let mon = monitor_ref.lock().await;
                    mon.get_all_entries()
                        .into_iter()
                        .cloned()
                        .collect::<Vec<_>>()
                };
                let entry_refs: Vec<&ConnectionHealthEntry> = all_entries.iter().collect();
                let summary = aggregator::aggregate_health_summary(&entry_refs);
                let quick_stats =
                    aggregator::compute_quick_stats(&entry_refs, 0, None, None);

                // 4. Generate alerts.
                let new_alerts =
                    DashboardAlertManager::generate_alerts_from_health(&entry_refs);
                alert_mgr.add_alerts(new_alerts);
                alert_mgr.cleanup_old();

                // 5. Build widget data.
                let widget_types = vec![
                    WidgetType::StatusHeatMap,
                    WidgetType::RecentConnections,
                    WidgetType::LatencySparklines,
                    WidgetType::AlertFeed,
                    WidgetType::QuickStats,
                    WidgetType::ProtocolBreakdown,
                    WidgetType::UptimeChart,
                    WidgetType::TopLatency,
                    WidgetType::GroupOverview,
                ];
                let alerts_snapshot: Vec<DashboardAlert> =
                    alert_mgr.get_all_alerts().to_vec();
                let widget_data: Vec<WidgetData> = widget_types
                    .iter()
                    .map(|wt| {
                        widgets::build_widget_data(wt, &entry_refs, &alerts_snapshot, &summary)
                    })
                    .collect();

                // 6. Update shared state.
                {
                    let mut st = state.lock().await;
                    st.widgets = widget_data;
                    st.last_updated = chrono::Utc::now();
                    st.health_summary = summary;
                    st.alerts = alerts_snapshot;
                    st.quick_stats = quick_stats;
                }

                debug!("Dashboard worker: cycle complete ({} connections)", conns.len());
            }

            // Mark as stopped.
            {
                let mut r = running.lock().await;
                *r = false;
            }
        });

        Ok(())
    }

    /// Stop the background worker.
    pub async fn stop(&mut self) -> Result<(), crate::error::DashboardError> {
        if let Some(ref tx) = self.stop_tx {
            let _ = tx.send(true);
            self.stop_tx = None;
            // Give the task a moment to wind down.
            tokio::time::sleep(Duration::from_millis(50)).await;
            Ok(())
        } else {
            Err(crate::error::DashboardError::NotRunning)
        }
    }

    /// Check whether the worker is currently running.
    pub async fn is_running(&self) -> bool {
        let r = self.running.lock().await;
        *r
    }

    /// Trigger an immediate poll cycle without waiting for the next tick.
    pub fn force_refresh(&self) {
        self.force_notify.notify_one();
    }

    /// Get a clone of the current configuration.
    pub fn config(&self) -> &DashboardConfig {
        &self.config
    }

    /// Update the worker configuration. Takes effect on next cycle.
    pub fn set_config(&mut self, config: DashboardConfig) {
        self.config = config;
    }
}
