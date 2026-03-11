//! # sorng-backup-verify
//!
//! Automated backup orchestration, integrity verification, disaster recovery testing,
//! backup catalog management, compliance reporting, and cross-site replication verification.
//!
//! This crate provides a comprehensive backup lifecycle management system including:
//! - **Backup Policies** — Define what, when, and how to back up with retention rules
//! - **Job Scheduling** — Cron-based scheduling with blackout windows and retry logic
//! - **Backup Catalog** — Persistent index of all backup artifacts with search and chain tracking
//! - **Verification Engine** — Multiple verification methods from checksums to full restore tests
//! - **Integrity Checking** — SHA-256/SHA-512/CRC32 manifest generation and comparison
//! - **Disaster Recovery Testing** — Automated DR drills with RTO/RPO measurement
//! - **Compliance Reporting** — SOX, HIPAA, GDPR, PCI-DSS, ISO 27001, NIST frameworks
//! - **Cross-Site Replication** — Replica management, lag monitoring, and promotion
//! - **Retention Engine** — GFS rotation, immutability enforcement, and storage reclamation
//! - **Notifications** — Email, webhook, syslog, SNMP, and frontend event dispatch

pub mod catalog;
pub mod compliance;
pub mod dr_testing;
pub mod error;
pub mod integrity;
pub mod notifications;
pub mod policies;
pub mod replication;
pub mod retention;
pub mod scheduler;
pub mod service;
pub mod types;
pub mod verification;
