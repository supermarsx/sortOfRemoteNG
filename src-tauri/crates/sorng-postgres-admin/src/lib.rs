// ── sorng-postgres-admin – PostgreSQL server administration ───────────────────
//! Comprehensive PostgreSQL administration crate for remote Linux servers.
//! Covers roles, databases, pg_hba.conf, replication, vacuum/analyze,
//! extensions, statistics, WAL, tablespaces, schemas, backups, and service control.

pub mod types;
pub mod error;
pub mod client;
pub mod roles;
pub mod databases;
pub mod pg_hba;
pub mod replication;
pub mod vacuum;
pub mod extensions;
pub mod stats;
pub mod wal;
pub mod tablespaces;
pub mod schemas;
pub mod backup;
pub mod service;
pub mod commands;
