//! # sorng-scheduler
//!
//! Scheduled tasks and cron-like automation engine for SortOfRemote NG.
//!
//! Provides cron expression parsing, one-shot and recurring schedules,
//! task pipelines, connection auto-connect/disconnect, script scheduling,
//! health check scheduling, report generation, execution history,
//! and retry policies.
//!
//! | Module      | Purpose                                          |
//! |-------------|--------------------------------------------------|
//! | `types`     | Data types, enums, and configuration structs     |
//! | `error`     | Error types for the scheduler                    |
//! | `cron`      | Cron expression parser and next-occurrence calc  |
//! | `executor`  | Task execution, retry, and pipeline runner       |
//! | `scheduler` | Core scheduler: due-task detection, tick loop    |
//! | `service`   | Service façade (`SchedulerServiceState`)         |
//! | `commands`  | Tauri `#[command]` handlers                      |

pub mod commands;
pub mod cron;
pub mod error;
pub mod executor;
pub mod scheduler;
pub mod service;
pub mod types;
