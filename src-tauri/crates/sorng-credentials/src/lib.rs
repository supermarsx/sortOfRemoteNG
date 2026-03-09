//! # SortOfRemote NG – Credential Lifecycle Management
//!
//! A comprehensive credential rotation and expiry tracking engine for
//! SortOfRemote NG. Provides:
//!
//! - **Password age tracking** — Monitor how old each credential is and flag
//!   stale passwords.
//! - **Certificate expiry monitoring** — Track TLS / SSH certificate expiry
//!   dates and generate timely alerts.
//! - **SSH key rotation reminders** — Policy-driven rotation scheduling for
//!   SSH keys and other credential types.
//! - **Linked credential groups** — Associate related credentials so they can
//!   be rotated together.
//! - **Audit trail** — Full history of credential lifecycle events (creation,
//!   rotation, deletion, policy changes).
//! - **Policy enforcement** — Configurable rotation policies with strength
//!   requirements, maximum age, and automatic notifications.
//! - **Expiry alerting** — Multi-severity alert generation with acknowledgement
//!   tracking.
//! - **Duplicate detection** — SHA-256 fingerprint-based detection of reused
//!   credential values.
//! - **Tauri commands** — Complete IPC command surface for front-end integration.

pub mod alerts;
pub mod audit;
pub mod commands;
pub mod error;
pub mod groups;
pub mod policies;
pub mod service;
pub mod tracker;
pub mod types;
