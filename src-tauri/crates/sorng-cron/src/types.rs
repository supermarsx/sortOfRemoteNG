//! Data types for cron / at / anacron management.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ─── Host ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth: SshAuth,
    pub timeout_secs: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SshAuth {
    Password { password: String },
    PrivateKey { key_path: String, passphrase: Option<String> },
    Agent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CronHost {
    pub id: String,
    pub name: String,
    pub ssh: Option<SshConfig>,
    pub use_sudo: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// ─── Cron Schedule ──────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CronSchedule {
    pub minute: String,
    pub hour: String,
    pub day_of_month: String,
    pub month: String,
    pub day_of_week: String,
}

impl CronSchedule {
    pub fn to_expression(&self) -> String {
        format!(
            "{} {} {} {} {}",
            self.minute, self.hour, self.day_of_month, self.month, self.day_of_week
        )
    }
}

impl std::fmt::Display for CronSchedule {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.to_expression())
    }
}

// ─── Cron Job Source ────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum CronJobSource {
    UserCrontab,
    SystemCrond { filename: String },
    EtcCrontab,
    Anacron,
}

// ─── Cron Job ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CronJob {
    pub id: String,
    pub schedule: CronSchedule,
    pub command: String,
    pub user: String,
    pub comment: String,
    pub enabled: bool,
    pub environment: HashMap<String, String>,
    pub source: CronJobSource,
}

impl CronJob {
    /// Render this job as a crontab line (without trailing newline).
    pub fn to_crontab_line(&self) -> String {
        let prefix = if self.enabled { "" } else { "#" };
        format!("{}{} {}", prefix, self.schedule, self.command)
    }
}

// ─── Crontab Entry ──────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum CrontabEntry {
    Job(CronJob),
    Comment { text: String },
    Blank,
    Variable { key: String, value: String },
}

impl CrontabEntry {
    /// Render this entry as a crontab line.
    pub fn to_line(&self) -> String {
        match self {
            Self::Job(job) => job.to_crontab_line(),
            Self::Comment { text } => {
                if text.starts_with('#') {
                    text.clone()
                } else {
                    format!("# {text}")
                }
            }
            Self::Blank => String::new(),
            Self::Variable { key, value } => format!("{key}={value}"),
        }
    }
}

// ─── At Job ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AtJob {
    pub id: u64,
    pub command: String,
    pub scheduled_at: DateTime<Utc>,
    pub queue: char,
    pub user: String,
}

// ─── Anacron Entry ──────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnacronEntry {
    pub period_days: u32,
    pub delay_minutes: u32,
    pub job_identifier: String,
    pub command: String,
}

impl AnacronEntry {
    /// Render this entry as an anacrontab line.
    pub fn to_line(&self) -> String {
        format!(
            "{}\t{}\t{}\t{}",
            self.period_days, self.delay_minutes, self.job_identifier, self.command
        )
    }
}

// ─── Cron Environment ───────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CronEnvironment {
    pub key: String,
    pub value: String,
}

// ─── Cron Access Control ────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CronAccessControl {
    pub allow_users: Vec<String>,
    pub deny_users: Vec<String>,
    pub allow_file_exists: bool,
    pub deny_file_exists: bool,
}

// ─── Cron Job History ───────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CronJobHistory {
    pub job_id: String,
    pub started_at: DateTime<Utc>,
    pub finished_at: Option<DateTime<Utc>>,
    pub exit_code: Option<i32>,
    pub output: String,
    pub error: String,
}

// ─── Cron Next Run ──────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CronNextRun {
    pub expression: String,
    pub next_times: Vec<DateTime<Utc>>,
}
