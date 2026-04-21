//! X2Go printing support — redirecting remote print jobs to local printers.

use serde::{Deserialize, Serialize};

// ── Print state ─────────────────────────────────────────────────────────────

/// State of the printing subsystem.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PrintState {
    Disabled,
    Starting,
    Ready,
    Failed,
}

/// A print job received from the remote session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrintJob {
    pub id: String,
    pub title: String,
    pub printer: Option<String>,
    pub pages: u32,
    pub size_bytes: u64,
    pub timestamp: String,
    pub state: PrintJobState,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PrintJobState {
    Pending,
    Printing,
    Completed,
    Failed,
    Cancelled,
}

// ── Print manager ───────────────────────────────────────────────────────────

/// Manages X2Go print job forwarding.
pub struct X2goPrintManager {
    pub state: PrintState,
    pub default_printer: Option<String>,
    pub cups_server: Option<String>,
    jobs: Vec<PrintJob>,
    next_job_id: u32,
}

impl X2goPrintManager {
    pub fn new() -> Self {
        Self {
            state: PrintState::Disabled,
            default_printer: None,
            cups_server: None,
            jobs: Vec::new(),
            next_job_id: 1,
        }
    }

    /// Enable printing with optional CUPS server.
    pub fn enable(&mut self, cups_server: Option<String>, default_printer: Option<String>) {
        self.cups_server = cups_server;
        self.default_printer = default_printer;
        self.state = PrintState::Ready;
    }

    /// Disable printing.
    pub fn disable(&mut self) {
        self.state = PrintState::Disabled;
    }

    /// Record a new incoming print job.
    pub fn add_job(&mut self, title: String, printer: Option<String>, size_bytes: u64) -> String {
        let id = format!("pj-{}", self.next_job_id);
        self.next_job_id += 1;

        self.jobs.push(PrintJob {
            id: id.clone(),
            title,
            printer: printer.or_else(|| self.default_printer.clone()),
            pages: 0,
            size_bytes,
            timestamp: chrono::Utc::now().to_rfc3339(),
            state: PrintJobState::Pending,
        });

        id
    }

    /// Mark a job as printing.
    pub fn start_job(&mut self, job_id: &str) -> bool {
        if let Some(job) = self.jobs.iter_mut().find(|j| j.id == job_id) {
            job.state = PrintJobState::Printing;
            true
        } else {
            false
        }
    }

    /// Mark a job as completed.
    pub fn complete_job(&mut self, job_id: &str, pages: u32) -> bool {
        if let Some(job) = self.jobs.iter_mut().find(|j| j.id == job_id) {
            job.state = PrintJobState::Completed;
            job.pages = pages;
            true
        } else {
            false
        }
    }

    /// Mark a job as failed.
    pub fn fail_job(&mut self, job_id: &str) -> bool {
        if let Some(job) = self.jobs.iter_mut().find(|j| j.id == job_id) {
            job.state = PrintJobState::Failed;
            true
        } else {
            false
        }
    }

    /// Cancel a job.
    pub fn cancel_job(&mut self, job_id: &str) -> bool {
        if let Some(job) = self.jobs.iter_mut().find(|j| j.id == job_id) {
            job.state = PrintJobState::Cancelled;
            true
        } else {
            false
        }
    }

    /// Get all jobs.
    pub fn list_jobs(&self) -> &[PrintJob] {
        &self.jobs
    }

    /// Get pending/active jobs.
    pub fn pending_jobs(&self) -> Vec<&PrintJob> {
        self.jobs
            .iter()
            .filter(|j| matches!(j.state, PrintJobState::Pending | PrintJobState::Printing))
            .collect()
    }

    /// Clear completed/failed/cancelled jobs.
    pub fn clear_finished(&mut self) -> usize {
        let before = self.jobs.len();
        self.jobs
            .retain(|j| matches!(j.state, PrintJobState::Pending | PrintJobState::Printing));
        before - self.jobs.len()
    }

    /// Build the lpr command to send a file to a local printer.
    pub fn build_lpr_command(&self, file_path: &str, printer: Option<&str>) -> String {
        let p = printer
            .or(self.default_printer.as_deref())
            .map(|n| format!(" -P {}", n))
            .unwrap_or_default();
        let server = self
            .cups_server
            .as_ref()
            .map(|s| format!(" -H {}", s))
            .unwrap_or_default();
        format!("lpr{}{} {}", server, p, file_path)
    }
}

impl Default for X2goPrintManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn print_manager_lifecycle() {
        let mut mgr = X2goPrintManager::new();
        assert_eq!(mgr.state, PrintState::Disabled);

        mgr.enable(None, Some("LaserJet".into()));
        assert_eq!(mgr.state, PrintState::Ready);
        assert_eq!(mgr.default_printer.as_deref(), Some("LaserJet"));
    }

    #[test]
    fn job_lifecycle() {
        let mut mgr = X2goPrintManager::new();
        mgr.enable(None, None);

        let id = mgr.add_job("report.pdf".into(), None, 1024);
        assert_eq!(mgr.pending_jobs().len(), 1);

        mgr.start_job(&id);
        assert_eq!(mgr.jobs[0].state, PrintJobState::Printing);

        mgr.complete_job(&id, 5);
        assert_eq!(mgr.jobs[0].state, PrintJobState::Completed);
        assert_eq!(mgr.jobs[0].pages, 5);

        assert_eq!(mgr.clear_finished(), 1);
        assert!(mgr.jobs.is_empty());
    }

    #[test]
    fn lpr_command() {
        let mut mgr = X2goPrintManager::new();
        mgr.enable(Some("cups.local".into()), Some("HP5000".into()));

        let cmd = mgr.build_lpr_command("/tmp/doc.ps", None);
        assert!(cmd.contains("-H cups.local"));
        assert!(cmd.contains("-P HP5000"));
        assert!(cmd.contains("/tmp/doc.ps"));
    }

    #[test]
    fn cancel_and_fail() {
        let mut mgr = X2goPrintManager::new();
        mgr.enable(None, None);

        let id1 = mgr.add_job("a.pdf".into(), None, 100);
        let id2 = mgr.add_job("b.pdf".into(), None, 200);

        mgr.cancel_job(&id1);
        mgr.fail_job(&id2);

        assert_eq!(mgr.jobs[0].state, PrintJobState::Cancelled);
        assert_eq!(mgr.jobs[1].state, PrintJobState::Failed);
    }
}
