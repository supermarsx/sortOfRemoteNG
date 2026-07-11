//! # SortOfRemote NG – Storage
//!
//! Secure encrypted storage and backup management.

#![cfg_attr(test, allow(clippy::field_reassign_with_default))]

pub mod backup;
pub mod durable;
pub mod payload_hash;
pub mod storage;
pub mod trust_store;
