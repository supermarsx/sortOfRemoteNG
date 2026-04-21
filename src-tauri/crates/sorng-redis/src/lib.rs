//! # sorng-redis
//!
//! Redis integration for SortOfRemote NG.
//!
//! Provides comprehensive Redis management including key-value operations,
//! data structure commands (lists, sets, hashes, sorted sets, streams),
//! pub/sub, server administration, cluster management, sentinel operations,
//! and replication monitoring.

pub mod client;
pub mod cluster;
pub mod error;
pub mod hashes;
pub mod keys;
pub mod lists;
pub mod pubsub;
pub mod replication;
pub mod sentinel;
pub mod server;
pub mod service;
pub mod sets;
pub mod sorted_sets;
pub mod streams;
pub mod strings;
pub mod types;

pub use error::*;
pub use service::{new_state, RedisService, RedisServiceState};
pub use types::*;

#[path = "redis/mod.rs"]
pub mod redis_impl;
