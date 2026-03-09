// ── sorng-mysql-admin – MySQL/MariaDB server administration ──────────────────
//! Comprehensive MySQL/MariaDB management crate for remote Linux servers.
//! Covers user management, replication, databases, tables, queries,
//! InnoDB internals, variables, backup/restore, processes, binary logs,
//! and service lifecycle — all executed remotely via SSH.

pub mod backup;
pub mod binlogs;
pub mod client;
pub mod commands;
pub mod databases;
pub mod error;
pub mod innodb;
pub mod processes;
pub mod queries;
pub mod replication;
pub mod service;
pub mod tables;
pub mod types;
pub mod users;
pub mod variables;
