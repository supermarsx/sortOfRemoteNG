//! # sorng-kafka
//!
//! Apache Kafka integration crate for SortOfRemote NG.
//!
//! Provides comprehensive Kafka cluster management including:
//! - **Cluster administration** — broker discovery, metadata, configuration
//! - **Topic management** — create, delete, configure, partition operations
//! - **Consumer groups** — listing, offset management, lag monitoring
//! - **Producer/Consumer** — message production and consumption with headers
//! - **ACLs** — access control list management for topics, groups, cluster
//! - **Schema Registry** — Confluent Schema Registry integration (Avro, JSON, Protobuf)
//! - **Kafka Connect** — connector lifecycle, task management, plugin discovery
//! - **Quotas** — client quota management (user, client-id, IP)
//! - **Partition reassignment** — replica moves, rebalancing, replication factor changes
//! - **Metrics** — cluster, broker, topic, and consumer group metrics

pub mod acls;
pub mod admin;
pub mod broker;
pub mod connect;
pub mod consumer;
pub mod consumer_groups;
pub mod error;
pub mod metrics;
pub mod partitions;
pub mod producer;
pub mod quotas;
pub mod reassignment;
pub mod schema_registry;
pub mod service;
pub mod topics;
pub mod types;
