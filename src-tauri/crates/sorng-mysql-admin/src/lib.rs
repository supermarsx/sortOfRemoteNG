// ── sorng-mysql-admin – MySQL/MariaDB server administration ──────────────────
//! Comprehensive MySQL/MariaDB management crate for remote Linux servers.
//! Covers user management, replication, databases, tables, queries,
//! InnoDB internals, variables, backup/restore, processes, binary logs,
//! and service lifecycle — all executed remotely via SSH.

pub mod types;
pub mod error;
pub mod client;
pub mod users;
pub mod replication;
pub mod databases;
pub mod tables;
pub mod queries;
pub mod innodb;
pub mod variables;
pub mod backup;
pub mod processes;
pub mod binlogs;
pub mod service;
pub mod commands;
