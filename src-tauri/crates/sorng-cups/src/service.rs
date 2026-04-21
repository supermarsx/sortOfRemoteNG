//! Session-based service façade for CUPS operations.
//!
//! Wraps all the lower-level modules (printers, jobs, classes, ppd, drivers,
//! admin, subscriptions) behind a single `CupsService` that manages named
//! sessions. Each session holds a `CupsConnectionConfig` and a shared
//! `reqwest::Client`.
//!
//! The service is designed to live inside a `Arc<Mutex<CupsService>>` Tauri
//! state object so every `#[tauri::command]` can acquire a lock and delegate.

use crate::error::CupsError;
use crate::types::*;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

// ═══════════════════════════════════════════════════════════════════════
// State type alias
// ═══════════════════════════════════════════════════════════════════════

/// The shared state type to register with `tauri::Builder::manage()`.
pub type CupsServiceState = Arc<Mutex<CupsService>>;

/// Create a new, empty service state.
pub fn new_state() -> CupsServiceState {
    Arc::new(Mutex::new(CupsService::new()))
}

// ═══════════════════════════════════════════════════════════════════════
// Session
// ═══════════════════════════════════════════════════════════════════════

/// An active session to a CUPS server, including an HTTP client.
struct CupsSession {
    config: CupsConnectionConfig,
    client: reqwest::Client,
}

impl CupsSession {
    fn new(config: CupsConnectionConfig) -> Result<Self, CupsError> {
        let timeout = std::time::Duration::from_secs(config.timeout_secs);
        let client = reqwest::Client::builder()
            .timeout(timeout)
            .danger_accept_invalid_certs(!config.use_tls)
            .build()
            .map_err(|e| CupsError::connection_failed(format!("HTTP client init: {e}")))?;
        Ok(Self { config, client })
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Service
// ═══════════════════════════════════════════════════════════════════════

/// The top-level CUPS service managing multiple concurrent sessions.
pub struct CupsService {
    sessions: HashMap<String, CupsSession>,
}

impl Default for CupsService {
    fn default() -> Self {
        Self::new()
    }
}

impl CupsService {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
        }
    }

    // ── Session management ──────────────────────────────────────

    /// Open a new session (or replace an existing one).
    pub fn open_session(
        &mut self,
        id: String,
        config: CupsConnectionConfig,
    ) -> Result<(), CupsError> {
        let session = CupsSession::new(config)?;
        self.sessions.insert(id, session);
        Ok(())
    }

    /// Disconnect (remove) a session by ID.
    pub fn disconnect(&mut self, id: &str) -> Result<(), CupsError> {
        self.sessions
            .remove(id)
            .map(|_| ())
            .ok_or_else(|| CupsError::session_not_found(id))
    }

    /// List all active session IDs.
    pub fn list_sessions(&self) -> Vec<String> {
        self.sessions.keys().cloned().collect()
    }

    /// Get a reference to a session (internal).
    fn session(&self, id: &str) -> Result<&CupsSession, CupsError> {
        self.sessions
            .get(id)
            .ok_or_else(|| CupsError::session_not_found(id))
    }

    // ── Printers ────────────────────────────────────────────────

    pub async fn list_printers(&self, session_id: &str) -> Result<Vec<PrinterInfo>, CupsError> {
        let s = self.session(session_id)?;
        crate::printers::list_printers(&s.client, &s.config).await
    }

    pub async fn get_printer(
        &self,
        session_id: &str,
        name: &str,
    ) -> Result<PrinterInfo, CupsError> {
        let s = self.session(session_id)?;
        crate::printers::get_printer(&s.client, &s.config, name).await
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn add_printer(
        &self,
        session_id: &str,
        name: &str,
        device_uri: &str,
        ppd_name: Option<&str>,
        location: Option<&str>,
        description: Option<&str>,
        shared: bool,
    ) -> Result<(), CupsError> {
        let s = self.session(session_id)?;
        crate::printers::add_printer(
            &s.client,
            &s.config,
            name,
            device_uri,
            ppd_name,
            location,
            description,
            shared,
        )
        .await
    }

    pub async fn modify_printer(
        &self,
        session_id: &str,
        name: &str,
        changes: &ModifyPrinterArgs,
    ) -> Result<(), CupsError> {
        let s = self.session(session_id)?;
        crate::printers::modify_printer(&s.client, &s.config, name, changes).await
    }

    pub async fn delete_printer(&self, session_id: &str, name: &str) -> Result<(), CupsError> {
        let s = self.session(session_id)?;
        crate::printers::delete_printer(&s.client, &s.config, name).await
    }

    pub async fn pause_printer(&self, session_id: &str, name: &str) -> Result<(), CupsError> {
        let s = self.session(session_id)?;
        crate::printers::pause_printer(&s.client, &s.config, name).await
    }

    pub async fn resume_printer(&self, session_id: &str, name: &str) -> Result<(), CupsError> {
        let s = self.session(session_id)?;
        crate::printers::resume_printer(&s.client, &s.config, name).await
    }

    pub async fn set_default_printer(&self, session_id: &str, name: &str) -> Result<(), CupsError> {
        let s = self.session(session_id)?;
        crate::printers::set_default_printer(&s.client, &s.config, name).await
    }

    pub async fn get_default_printer(&self, session_id: &str) -> Result<PrinterInfo, CupsError> {
        let s = self.session(session_id)?;
        crate::printers::get_default_printer(&s.client, &s.config).await
    }

    pub async fn accept_jobs(&self, session_id: &str, name: &str) -> Result<(), CupsError> {
        let s = self.session(session_id)?;
        crate::printers::accept_jobs(&s.client, &s.config, name).await
    }

    pub async fn reject_jobs(&self, session_id: &str, name: &str) -> Result<(), CupsError> {
        let s = self.session(session_id)?;
        crate::printers::reject_jobs(&s.client, &s.config, name).await
    }

    pub async fn discover_printers(
        &self,
        session_id: &str,
    ) -> Result<Vec<DiscoveredDevice>, CupsError> {
        let s = self.session(session_id)?;
        crate::printers::discover_printers(&s.client, &s.config).await
    }

    // ── Jobs ────────────────────────────────────────────────────

    pub async fn list_jobs(
        &self,
        session_id: &str,
        printer: Option<&str>,
        which: WhichJobs,
        my_jobs: bool,
        limit: Option<u32>,
    ) -> Result<Vec<JobInfo>, CupsError> {
        let s = self.session(session_id)?;
        crate::jobs::list_jobs(&s.client, &s.config, printer, which, my_jobs, limit).await
    }

    pub async fn get_job(&self, session_id: &str, job_id: u32) -> Result<JobInfo, CupsError> {
        let s = self.session(session_id)?;
        crate::jobs::get_job(&s.client, &s.config, job_id).await
    }

    pub async fn submit_job(
        &self,
        session_id: &str,
        printer: &str,
        document_data: &[u8],
        filename: &str,
        options: &PrintOptions,
    ) -> Result<u32, CupsError> {
        let s = self.session(session_id)?;
        crate::jobs::submit_job(
            &s.client,
            &s.config,
            printer,
            document_data,
            filename,
            options,
        )
        .await
    }

    pub async fn submit_job_uri(
        &self,
        session_id: &str,
        printer: &str,
        document_uri: &str,
        options: &PrintOptions,
    ) -> Result<u32, CupsError> {
        let s = self.session(session_id)?;
        crate::jobs::submit_job_uri(&s.client, &s.config, printer, document_uri, options).await
    }

    pub async fn cancel_job(
        &self,
        session_id: &str,
        printer: &str,
        job_id: u32,
    ) -> Result<(), CupsError> {
        let s = self.session(session_id)?;
        crate::jobs::cancel_job(&s.client, &s.config, printer, job_id).await
    }

    pub async fn hold_job(
        &self,
        session_id: &str,
        printer: &str,
        job_id: u32,
    ) -> Result<(), CupsError> {
        let s = self.session(session_id)?;
        crate::jobs::hold_job(&s.client, &s.config, printer, job_id).await
    }

    pub async fn release_job(
        &self,
        session_id: &str,
        printer: &str,
        job_id: u32,
    ) -> Result<(), CupsError> {
        let s = self.session(session_id)?;
        crate::jobs::release_job(&s.client, &s.config, printer, job_id).await
    }

    pub async fn cancel_all_jobs(&self, session_id: &str, printer: &str) -> Result<(), CupsError> {
        let s = self.session(session_id)?;
        crate::jobs::cancel_all_jobs(&s.client, &s.config, printer).await
    }

    pub async fn move_job(
        &self,
        session_id: &str,
        job_id: u32,
        target_printer: &str,
    ) -> Result<(), CupsError> {
        let s = self.session(session_id)?;
        crate::jobs::move_job(&s.client, &s.config, job_id, target_printer).await
    }

    // ── Classes ─────────────────────────────────────────────────

    pub async fn list_classes(&self, session_id: &str) -> Result<Vec<PrinterClass>, CupsError> {
        let s = self.session(session_id)?;
        crate::classes::list_classes(&s.client, &s.config).await
    }

    pub async fn get_class(&self, session_id: &str, name: &str) -> Result<PrinterClass, CupsError> {
        let s = self.session(session_id)?;
        crate::classes::get_class(&s.client, &s.config, name).await
    }

    pub async fn create_class(
        &self,
        session_id: &str,
        name: &str,
        members: &[&str],
        description: Option<&str>,
        location: Option<&str>,
        shared: bool,
    ) -> Result<(), CupsError> {
        let s = self.session(session_id)?;
        crate::classes::create_class(
            &s.client,
            &s.config,
            name,
            members,
            description,
            location,
            shared,
        )
        .await
    }

    pub async fn modify_class(
        &self,
        session_id: &str,
        name: &str,
        changes: &ModifyClassArgs,
    ) -> Result<(), CupsError> {
        let s = self.session(session_id)?;
        crate::classes::modify_class(&s.client, &s.config, name, changes).await
    }

    pub async fn delete_class(&self, session_id: &str, name: &str) -> Result<(), CupsError> {
        let s = self.session(session_id)?;
        crate::classes::delete_class(&s.client, &s.config, name).await
    }

    pub async fn add_class_member(
        &self,
        session_id: &str,
        class_name: &str,
        printer_name: &str,
    ) -> Result<(), CupsError> {
        let s = self.session(session_id)?;
        crate::classes::add_member(&s.client, &s.config, class_name, printer_name).await
    }

    pub async fn remove_class_member(
        &self,
        session_id: &str,
        class_name: &str,
        printer_name: &str,
    ) -> Result<(), CupsError> {
        let s = self.session(session_id)?;
        crate::classes::remove_member(&s.client, &s.config, class_name, printer_name).await
    }

    // ── PPD ─────────────────────────────────────────────────────

    pub async fn list_ppds(
        &self,
        session_id: &str,
        filter: Option<&PpdFilter>,
    ) -> Result<Vec<PpdInfo>, CupsError> {
        let s = self.session(session_id)?;
        crate::ppd::list_ppds(&s.client, &s.config, filter).await
    }

    pub async fn search_ppds(
        &self,
        session_id: &str,
        query: &str,
    ) -> Result<Vec<PpdInfo>, CupsError> {
        let s = self.session(session_id)?;
        crate::ppd::search_ppds(&s.client, &s.config, query).await
    }

    pub async fn get_ppd(&self, session_id: &str, printer_name: &str) -> Result<String, CupsError> {
        let s = self.session(session_id)?;
        crate::ppd::get_ppd(&s.client, &s.config, printer_name).await
    }

    pub async fn get_ppd_options(
        &self,
        session_id: &str,
        printer_name: &str,
    ) -> Result<PpdContent, CupsError> {
        let s = self.session(session_id)?;
        crate::ppd::get_ppd_options(&s.client, &s.config, printer_name).await
    }

    pub async fn upload_ppd(
        &self,
        session_id: &str,
        printer_name: &str,
        ppd_content: &str,
    ) -> Result<(), CupsError> {
        let s = self.session(session_id)?;
        crate::ppd::upload_ppd(&s.client, &s.config, printer_name, ppd_content).await
    }

    pub async fn assign_ppd(
        &self,
        session_id: &str,
        printer_name: &str,
        ppd_name: &str,
    ) -> Result<(), CupsError> {
        let s = self.session(session_id)?;
        crate::ppd::assign_ppd(&s.client, &s.config, printer_name, ppd_name).await
    }

    // ── Drivers ─────────────────────────────────────────────────

    pub async fn list_drivers(&self, session_id: &str) -> Result<Vec<DriverInfo>, CupsError> {
        let s = self.session(session_id)?;
        crate::drivers::list_drivers(&s.client, &s.config).await
    }

    pub async fn get_driver(
        &self,
        session_id: &str,
        ppd_name: &str,
    ) -> Result<DriverInfo, CupsError> {
        let s = self.session(session_id)?;
        crate::drivers::get_driver(&s.client, &s.config, ppd_name).await
    }

    pub async fn recommend_driver(
        &self,
        session_id: &str,
        device_id: Option<&str>,
        make_model: Option<&str>,
        limit: Option<usize>,
    ) -> Result<Vec<DriverInfo>, CupsError> {
        let s = self.session(session_id)?;
        crate::drivers::recommend_driver(&s.client, &s.config, device_id, make_model, limit).await
    }

    pub async fn get_driver_options(
        &self,
        session_id: &str,
        ppd_name: &str,
    ) -> Result<Vec<PpdOption>, CupsError> {
        let s = self.session(session_id)?;
        crate::drivers::get_driver_options(&s.client, &s.config, ppd_name).await
    }

    // ── Admin ───────────────────────────────────────────────────

    pub async fn get_server_settings(&self, session_id: &str) -> Result<CupsServerInfo, CupsError> {
        let s = self.session(session_id)?;
        crate::admin::get_server_settings(&s.client, &s.config).await
    }

    pub async fn update_server_settings(
        &self,
        session_id: &str,
        settings: &HashMap<String, String>,
    ) -> Result<(), CupsError> {
        let s = self.session(session_id)?;
        crate::admin::update_server_settings(&s.client, &s.config, settings).await
    }

    pub async fn get_error_log(
        &self,
        session_id: &str,
        log_type: LogType,
        max_lines: Option<usize>,
    ) -> Result<Vec<String>, CupsError> {
        let s = self.session(session_id)?;
        crate::admin::get_error_log(&s.client, &s.config, log_type, max_lines).await
    }

    pub async fn test_page(&self, session_id: &str, printer_name: &str) -> Result<u32, CupsError> {
        let s = self.session(session_id)?;
        crate::admin::test_page(&s.client, &s.config, printer_name).await
    }

    pub async fn get_subscriptions_status(&self, session_id: &str) -> Result<u32, CupsError> {
        let s = self.session(session_id)?;
        crate::admin::get_subscriptions_status(&s.client, &s.config).await
    }

    pub async fn cleanup_jobs(
        &self,
        session_id: &str,
        max_age_secs: u64,
    ) -> Result<u32, CupsError> {
        let s = self.session(session_id)?;
        crate::admin::cleanup_jobs(&s.client, &s.config, max_age_secs).await
    }

    pub async fn restart_cups(&self, session_id: &str) -> Result<(), CupsError> {
        let s = self.session(session_id)?;
        crate::admin::restart_cups(&s.client, &s.config).await
    }

    // ── Subscriptions ───────────────────────────────────────────

    pub async fn create_subscription(
        &self,
        session_id: &str,
        events: &[NotifyEvent],
        printer_name: Option<&str>,
        lease_secs: Option<u32>,
        recipient_uri: Option<&str>,
    ) -> Result<u32, CupsError> {
        let s = self.session(session_id)?;
        crate::subscriptions::create_subscription(
            &s.client,
            &s.config,
            events,
            printer_name,
            lease_secs,
            recipient_uri,
        )
        .await
    }

    pub async fn cancel_subscription(
        &self,
        session_id: &str,
        subscription_id: u32,
    ) -> Result<(), CupsError> {
        let s = self.session(session_id)?;
        crate::subscriptions::cancel_subscription(&s.client, &s.config, subscription_id).await
    }

    pub async fn list_subscriptions(
        &self,
        session_id: &str,
        printer_name: Option<&str>,
    ) -> Result<Vec<SubscriptionInfo>, CupsError> {
        let s = self.session(session_id)?;
        crate::subscriptions::list_subscriptions(&s.client, &s.config, printer_name).await
    }

    pub async fn get_events(
        &self,
        session_id: &str,
        subscription_id: u32,
        since_sequence: u32,
    ) -> Result<Vec<NotificationEvent>, CupsError> {
        let s = self.session(session_id)?;
        crate::subscriptions::get_events(&s.client, &s.config, subscription_id, since_sequence)
            .await
    }

    pub async fn renew_subscription(
        &self,
        session_id: &str,
        subscription_id: u32,
        lease_secs: Option<u32>,
    ) -> Result<(), CupsError> {
        let s = self.session(session_id)?;
        crate::subscriptions::renew_subscription(&s.client, &s.config, subscription_id, lease_secs)
            .await
    }
}
