//! Error types for the scheduler.

use std::fmt;

/// All errors that can originate from the scheduler engine.
#[derive(Debug, Clone)]
pub enum SchedulerError {
    /// A task with the given ID was not found.
    TaskNotFound(String),
    /// A duplicate task ID was detected.
    DuplicateTask(String),
    /// A cron expression could not be parsed.
    CronParseError(String),
    /// A task action failed during execution.
    ExecutionError(String),
    /// A task exceeded its timeout.
    TimeoutError(String),
    /// A pipeline step failed and `continue_on_error` is false.
    PipelineError(String),
    /// A condition could not be evaluated.
    ConditionError(String),
    /// Serialization / deserialization failed.
    SerializationError(String),
    /// The scheduler is not running.
    NotRunning,
    /// A generic internal error.
    Internal(String),
}

impl fmt::Display for SchedulerError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::TaskNotFound(id) => write!(f, "task not found: {id}"),
            Self::DuplicateTask(id) => write!(f, "duplicate task id: {id}"),
            Self::CronParseError(msg) => write!(f, "cron parse error: {msg}"),
            Self::ExecutionError(msg) => write!(f, "execution error: {msg}"),
            Self::TimeoutError(msg) => write!(f, "timeout: {msg}"),
            Self::PipelineError(msg) => write!(f, "pipeline error: {msg}"),
            Self::ConditionError(msg) => write!(f, "condition error: {msg}"),
            Self::SerializationError(msg) => write!(f, "serialization error: {msg}"),
            Self::NotRunning => write!(f, "scheduler is not running"),
            Self::Internal(msg) => write!(f, "internal error: {msg}"),
        }
    }
}

impl std::error::Error for SchedulerError {}

impl From<serde_json::Error> for SchedulerError {
    fn from(e: serde_json::Error) -> Self {
        Self::SerializationError(e.to_string())
    }
}
