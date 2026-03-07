//! # sorng-rabbitmq
//!
//! RabbitMQ message broker integration for SortOfRemote NG.
//!
//! Manages RabbitMQ servers via the HTTP Management API (port 15672), providing
//! comprehensive control over vhosts, exchanges, queues, bindings, users,
//! permissions, policies, shovels, federation, cluster nodes, connections,
//! channels, consumers, monitoring, and full broker definition import/export.

pub mod types;
pub mod error;
pub mod client;
pub mod vhosts;
pub mod exchanges;
pub mod queues;
pub mod bindings;
pub mod users;
pub mod permissions;
pub mod policies;
pub mod shovels;
pub mod federation;
pub mod cluster;
pub mod connections;
pub mod channels;
pub mod consumers;
pub mod monitoring;
pub mod definitions;
pub mod service;
pub mod commands;

pub use types::*;
pub use error::*;
pub use service::{RabbitService, RabbitServiceState, new_state};
