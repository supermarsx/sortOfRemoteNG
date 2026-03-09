//! # SortOfRemote NG – Notifications
//!
//! A comprehensive notification rules engine for SortOfRemote NG. Provides
//! rule-based alerting with multi-channel delivery (in-app, desktop, webhook,
//! email, Slack, Discord, Teams, Telegram, PagerDuty), template rendering,
//! throttling, escalation chains, and full notification history.
//!
//! ## Architecture
//!
//! The notification system processes events through a pipeline:
//!
//! 1. **Trigger matching** — An incoming event is matched against registered
//!    notification rules by trigger type.
//!
//! 2. **Condition evaluation** — Each matching rule's conditions are evaluated
//!    against the event payload using a flexible operator set.
//!
//! 3. **Throttle check** — The throttle manager ensures rate limits are respected
//!    and duplicate notifications are suppressed when configured.
//!
//! 4. **Template rendering** — The notification title and body are rendered from
//!    templates with variable substitution.
//!
//! 5. **Channel delivery** — Notifications are dispatched to all configured
//!    channels (Slack, Discord, Teams, webhooks, desktop, in-app, etc.).
//!
//! 6. **Escalation** — If configured, unacknowledged alerts escalate through
//!    progressively more urgent channels after configurable delays.
//!
//! 7. **History** — Every sent notification is recorded for auditing and review.
//!
//! ## Module Overview
//!
//! - [`types`] — Core data types: rules, channels, configs, records
//! - [`error`] — Error types for the notification system
//! - [`rules`] — Rule engine: condition evaluation, trigger matching
//! - [`channels`] — Multi-channel delivery (HTTP, desktop, in-app)
//! - [`templates`] — Template registry and `{{variable}}` rendering
//! - [`throttle`] — Rate-limiting and duplicate suppression
//! - [`escalation`] — Time-based escalation chains
//! - [`history`] — Notification history storage and querying
//! - [`service`] — Top-level orchestration service with Tauri state
//! - [`commands`] — Tauri IPC command handlers

pub mod channels;
pub mod commands;
pub mod error;
pub mod escalation;
pub mod history;
pub mod rules;
pub mod service;
pub mod templates;
pub mod throttle;
pub mod types;
