//! # sorng-rabbitmq
//!
//! RabbitMQ message broker integration for SortOfRemote NG.
//!
//! Manages RabbitMQ servers via the HTTP Management API (port 15672), providing
//! comprehensive control over vhosts, exchanges, queues, bindings, users,
//! permissions, policies, shovels, federation, cluster nodes, connections,
//! channels, consumers, monitoring, and full broker definition import/export.

pub mod bindings;
pub mod channels;
pub mod client;
pub mod cluster;
pub mod commands;
pub mod connections;
pub mod consumers;
pub mod definitions;
pub mod error;
pub mod exchanges;
pub mod federation;
pub mod monitoring;
pub mod permissions;
pub mod policies;
pub mod queues;
pub mod service;
pub mod shovels;
pub mod types;
pub mod users;
pub mod vhosts;

pub use error::*;
pub use service::{new_state, RabbitService, RabbitServiceState};
pub use types::*;
