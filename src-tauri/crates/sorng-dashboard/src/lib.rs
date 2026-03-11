//! # sorng-dashboard
//!
//! Connection health dashboard engine for SortOfRemote NG.
//!
//! Provides background-threaded health monitoring with widgets,
//! status aggregation, sparkline data, alert feeds, quick stats
//! computation, and low-overhead periodic polling.
//!
//! | Module       | Purpose                                           |
//! |--------------|---------------------------------------------------|
//! | `types`      | Data types, enums, and configuration structs       |
//! | `error`      | Error types for the dashboard engine               |
//! | `monitor`    | Health monitoring and connection checking           |
//! | `aggregator` | Data aggregation and summary computation            |
//! | `widgets`    | Widget data generation for the UI                  |
//! | `sparkline`  | Sparkline data, statistics, and trend detection    |
//! | `alerts`     | Dashboard alert management                         |
//! | `worker`     | Background worker for periodic polling             |
//! | `service`    | Service façade (`DashboardServiceState`)           |
//! | `commands`   | Tauri `#[command]` handlers                        |

pub mod aggregator;
pub mod alerts;
pub mod error;
pub mod monitor;
pub mod service;
pub mod sparkline;
pub mod types;
pub mod widgets;
pub mod worker;
