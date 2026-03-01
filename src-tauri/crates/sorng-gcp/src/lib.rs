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

pub mod error;
pub mod config;
pub mod auth;
pub mod client;

// Service clients
pub mod compute;
pub mod storage;
pub mod iam;
pub mod secrets;
pub mod sql;
pub mod functions;
pub mod gke;
pub mod dns;
pub mod pubsub;
pub mod run;
pub mod logging;
pub mod monitoring;

// High-level service + Tauri bindings
pub mod service;
pub mod commands;

// ── Re-exports for ergonomic access ─────────────────────────────────────

pub use config::{
    GcpConnectionConfig, GcpRegion, GcpServiceInfo, GcpSession, Label, PaginatedResponse,
    ServiceAccountKey,
};
pub use error::{GcpError, GcpResult};
pub use service::{GcpService, GcpServiceState};

// Re-export all Tauri commands for registration in the main app
pub use commands::{
    access_gcp_secret_version,
    call_gcp_function,
    connect_gcp,
    create_gcp_bucket,
    create_gcp_secret,
    create_gcp_topic,
    delete_gcp_bucket,
    delete_gcp_instance,
    delete_gcp_object,
    delete_gcp_secret,
    delete_gcp_topic,
    disconnect_gcp,
    download_gcp_object,
    get_gcp_bucket,
    get_gcp_cluster,
    get_gcp_function,
    get_gcp_iam_policy,
    get_gcp_instance,
    get_gcp_secret,
    get_gcp_session,
    get_gcp_sql_instance,
    list_gcp_alert_policies,
    list_gcp_buckets,
    list_gcp_clusters,
    list_gcp_disks,
    list_gcp_dns_record_sets,
    list_gcp_firewalls,
    list_gcp_functions,
    list_gcp_instances,
    list_gcp_log_entries,
    list_gcp_log_sinks,
    list_gcp_logs,
    list_gcp_machine_types,
    list_gcp_managed_zones,
    list_gcp_metric_descriptors,
    list_gcp_networks,
    list_gcp_node_pools,
    list_gcp_objects,
    list_gcp_roles,
    list_gcp_run_jobs,
    list_gcp_run_services,
    list_gcp_secrets,
    list_gcp_service_accounts,
    list_gcp_sessions,
    list_gcp_snapshots,
    list_gcp_sql_databases,
    list_gcp_sql_instances,
    list_gcp_sql_users,
    list_gcp_subscriptions,
    list_gcp_time_series,
    list_gcp_topics,
    publish_gcp_message,
    pull_gcp_messages,
    reset_gcp_instance,
    start_gcp_instance,
    stop_gcp_instance,
};
