//! NX printer redirection — manage printer forwarding over NX sessions.

use crate::nx::types::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// State of a redirected printer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PrinterState {
    Idle,
    Printing,
    Error,
    Offline,
}

/// A printer available for redirection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NxPrinter {
    pub name: String,
    pub driver: PrinterDriver,
    pub state: PrinterState,
    pub is_default: bool,
    pub jobs_printed: u64,
    pub bytes_transferred: u64,
}

/// Print job.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrintJob {
    pub id: String,
    pub printer: String,
    pub title: String,
    pub pages: Option<u32>,
    pub size_bytes: u64,
    pub submitted_at: String,
    pub completed: bool,
}

/// Manages printer redirection for an NX session.
#[derive(Debug)]
pub struct PrintManager {
    enabled: bool,
    printers: HashMap<String, NxPrinter>,
    jobs: Vec<PrintJob>,
    config: NxPrintConfig,
}

impl PrintManager {
    pub fn new(config: NxPrintConfig) -> Self {
        Self {
            enabled: config.enabled,
            printers: HashMap::new(),
            jobs: Vec::new(),
            config,
        }
    }

    pub fn is_enabled(&self) -> bool {
        self.enabled
    }

    /// Register a local printer for redirection.
    pub fn add_printer(&mut self, name: String, driver: PrinterDriver, is_default: bool) {
        if !self.enabled {
            return;
        }
        self.printers.insert(
            name.clone(),
            NxPrinter {
                name,
                driver,
                state: PrinterState::Idle,
                is_default,
                jobs_printed: 0,
                bytes_transferred: 0,
            },
        );
    }

    /// Remove a printer.
    pub fn remove_printer(&mut self, name: &str) -> bool {
        self.printers.remove(name).is_some()
    }

    /// Get the default printer name.
    pub fn default_printer(&self) -> Option<&str> {
        if let Some(name) = &self.config.default_printer {
            if self.printers.contains_key(name) {
                return Some(name);
            }
        }
        self.printers
            .values()
            .find(|p| p.is_default)
            .map(|p| p.name.as_str())
    }

    /// List all printers.
    pub fn list_printers(&self) -> Vec<&NxPrinter> {
        self.printers.values().collect()
    }

    /// Submit a print job.
    pub fn submit_job(&mut self, printer: &str, title: &str, size: u64) -> Result<String, String> {
        if !self.enabled {
            return Err("printing is disabled".into());
        }
        if !self.printers.contains_key(printer) {
            return Err(format!("printer '{}' not found", printer));
        }

        let id = uuid::Uuid::new_v4().to_string();
        self.jobs.push(PrintJob {
            id: id.clone(),
            printer: printer.to_string(),
            title: title.to_string(),
            pages: None,
            size_bytes: size,
            submitted_at: chrono::Utc::now().to_rfc3339(),
            completed: false,
        });

        if let Some(p) = self.printers.get_mut(printer) {
            p.state = PrinterState::Printing;
        }

        Ok(id)
    }

    /// Mark a job as completed.
    pub fn complete_job(&mut self, job_id: &str) -> bool {
        if let Some(job) = self.jobs.iter_mut().find(|j| j.id == job_id) {
            job.completed = true;
            if let Some(p) = self.printers.get_mut(&job.printer) {
                p.jobs_printed += 1;
                p.bytes_transferred += job.size_bytes;
                p.state = PrinterState::Idle;
            }
            true
        } else {
            false
        }
    }

    /// List all jobs.
    pub fn list_jobs(&self) -> &[PrintJob] {
        &self.jobs
    }

    /// List pending (incomplete) jobs.
    pub fn pending_jobs(&self) -> Vec<&PrintJob> {
        self.jobs.iter().filter(|j| !j.completed).collect()
    }

    /// Clear completed jobs.
    pub fn clear_completed(&mut self) {
        self.jobs.retain(|j| !j.completed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn print_lifecycle() {
        let config = NxPrintConfig {
            enabled: true,
            ..NxPrintConfig::default()
        };
        let mut mgr = PrintManager::new(config);

        mgr.add_printer("MyPrinter".into(), PrinterDriver::Cups, true);
        assert_eq!(mgr.list_printers().len(), 1);
        assert_eq!(mgr.default_printer(), Some("MyPrinter"));

        let job_id = mgr.submit_job("MyPrinter", "Test Doc", 1024).unwrap();
        assert_eq!(mgr.pending_jobs().len(), 1);

        mgr.complete_job(&job_id);
        assert_eq!(mgr.pending_jobs().len(), 0);
        assert_eq!(mgr.list_printers()[0].jobs_printed, 1);
    }

    #[test]
    fn print_disabled() {
        let config = NxPrintConfig {
            enabled: false,
            ..NxPrintConfig::default()
        };
        let mut mgr = PrintManager::new(config);
        assert!(mgr.submit_job("any", "test", 100).is_err());
    }

    #[test]
    fn printer_not_found() {
        let config = NxPrintConfig {
            enabled: true,
            ..NxPrintConfig::default()
        };
        let mut mgr = PrintManager::new(config);
        assert!(mgr.submit_job("nonexistent", "test", 100).is_err());
    }
}
