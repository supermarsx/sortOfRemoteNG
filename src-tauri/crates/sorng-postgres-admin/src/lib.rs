// ── sorng-postgres-admin – PostgreSQL server administration ───────────────────
//! Comprehensive PostgreSQL administration crate for remote Linux servers.
//! Covers roles, databases, pg_hba.conf, replication, vacuum/analyze,
//! extensions, statistics, WAL, tablespaces, schemas, backups, and service control.

pub mod backup;
pub mod client;
pub mod databases;
pub mod error;
pub mod extensions;
pub mod pg_hba;
pub mod replication;
pub mod roles;
pub mod schemas;
pub mod service;
pub mod stats;
pub mod tablespaces;
pub mod types;
pub mod vacuum;
pub mod wal;
