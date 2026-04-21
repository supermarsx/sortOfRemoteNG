#![allow(dead_code, non_snake_case)]

//! # sorng-gcp – Comprehensive Google Cloud Platform integration crate
//!
//! Provides GCP service clients with OAuth2 JWT-based authentication, covering
//! Compute Engine, Cloud Storage, IAM, Secret Manager, Cloud SQL,
//! Cloud Functions, GKE, Cloud DNS, Pub/Sub, Cloud Run, Logging, and Monitoring.
//!
//! ## Architecture
//!
//! ```text
//! ┌──────────────────────────────────────────────────┐
//! │  GcpService  (service.rs)                        │
//! │  ├── session management                          │
//! │  └── per-session GcpClient + delegates to:       │
//! │       ComputeClient · StorageClient · IamClient  │
//! │       SecretManagerClient · CloudSqlClient        │
//! │       FunctionsClient · GkeClient · DnsClient     │
//! │       PubSubClient · CloudRunClient               │
//! │       LoggingClient · MonitoringClient             │
//! ├──────────────────────────────────────────────────┤
//! │  GcpClient  (client.rs)                          │
//! │  ├── get / post / put / patch / delete           │
//! │  ├── get_all_pages  (pagination)                 │
//! │  └── wait_for_operation  (polling)               │
//! ├──────────────────────────────────────────────────┤
//! │  TokenManager  (auth.rs)                         │
//! │  └── JWT → access_token exchange + caching       │
//! └──────────────────────────────────────────────────┘
//! ```
//!
//! ## GCP Services
//!
//! | Service           | Module         | API Base                                    |
//! |-------------------|----------------|---------------------------------------------|
//! | Compute Engine    | `compute`      | `https://compute.googleapis.com/compute/v1`  |
//! | Cloud Storage     | `storage`      | `https://storage.googleapis.com/storage/v1`  |
//! | IAM               | `iam`          | `https://iam.googleapis.com/v1`              |
//! | Secret Manager    | `secrets`      | `https://secretmanager.googleapis.com/v1`    |
//! | Cloud SQL         | `sql`          | `https://sqladmin.googleapis.com/v1`         |
//! | Cloud Functions   | `functions`    | `https://cloudfunctions.googleapis.com/v2`   |
//! | GKE               | `gke`          | `https://container.googleapis.com/v1`        |
//! | Cloud DNS         | `dns`          | `https://dns.googleapis.com/dns/v1`          |
//! | Pub/Sub           | `pubsub`       | `https://pubsub.googleapis.com/v1`           |
//! | Cloud Run         | `run`          | `https://run.googleapis.com/v2`              |
//! | Cloud Logging     | `logging`      | `https://logging.googleapis.com/v2`          |
//! | Cloud Monitoring  | `monitoring`   | `https://monitoring.googleapis.com/v3`       |

// ── Sub-modules ─────────────────────────────────────────────────────────

pub mod auth;
pub mod client;
pub mod config;
pub mod error;

// Service clients
pub mod compute;
pub mod dns;
pub mod functions;
pub mod gke;
pub mod iam;
pub mod logging;
pub mod monitoring;
pub mod pubsub;
pub mod run;
pub mod secrets;
pub mod sql;
pub mod storage;

// High-level service + Tauri bindings
pub mod service;

// ── Re-exports for ergonomic access ─────────────────────────────────────

pub use config::{
    GcpConnectionConfig, GcpRegion, GcpServiceInfo, GcpSession, Label, PaginatedResponse,
    ServiceAccountKey,
};
pub use error::{GcpError, GcpResult};
pub use service::{GcpService, GcpServiceState};

