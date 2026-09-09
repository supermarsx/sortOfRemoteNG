//! # SortOfRemote NG – Storage
//!
//! Secure encrypted storage and backup management.

#![cfg_attr(test, allow(clippy::field_reassign_with_default))]

pub mod backup;
pub mod database_transaction;
pub mod durable;
pub mod envelope_io;
pub mod payload_hash;
pub mod sdbf;
pub mod storage;
pub mod trust_store;

// Independent temporary profiles share the native process-wide coordinator.
// Hold this only around unit-test fixture lifetimes; operations/races inside
// each fixture still use the real production coordinator.
#[cfg(test)]
pub(crate) static STORAGE_FIXTURE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
