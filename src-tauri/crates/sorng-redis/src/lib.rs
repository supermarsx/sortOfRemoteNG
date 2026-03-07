//! # sorng-redis
//!
//! Redis integration for SortOfRemote NG.
//!
//! Provides comprehensive Redis management including key-value operations,
//! data structure commands (lists, sets, hashes, sorted sets, streams),
//! pub/sub, server administration, cluster management, sentinel operations,
//! and replication monitoring.

pub mod types;
pub mod error;
pub mod client;
pub mod keys;
pub mod strings;
pub mod lists;
pub mod sets;
pub mod hashes;
pub mod sorted_sets;
pub mod streams;
pub mod pubsub;
pub mod server;
pub mod cluster;
pub mod sentinel;
pub mod replication;
pub mod service;
pub mod commands;

pub use types::*;
pub use error::*;
pub use service::{RedisService, RedisServiceState, new_state};
