//! # SortOfRemote NG – Telegram Bot Integration
//!
//! Comprehensive Telegram Bot API integration for remote management
//! notifications, alerts, and interactive bot commands.
//!
//! ## Features
//!
//! - **Bot Management** – configure, validate, and manage bot tokens
//! - **Messaging** – send text, markdown, HTML, photos, documents, videos,
//!   audio, voice, stickers, locations, contacts, polls, dice
//! - **Message Management** – edit, delete, forward, copy, pin, unpin messages
//! - **Chat Management** – get chat info, members, set title/description/photo,
//!   ban/unban, restrict, promote members
//! - **Inline Keyboards** – interactive buttons with callback queries
//! - **File Operations** – upload and download files via Bot API
//! - **Webhooks & Updates** – long polling and webhook configuration
//! - **Notifications** – connection event alerts, status change notifications
//! - **Monitoring** – scheduled health checks, threshold alerts, digest reports
//! - **Templates** – reusable message templates with variable substitution
//! - **Scheduled Messages** – queue messages for future delivery

pub mod types;
pub mod client;
pub mod bot;
pub mod messaging;
pub mod chat;
pub mod files;
pub mod webhooks;
pub mod notifications;
pub mod monitoring;
pub mod templates;
pub mod service;
pub mod commands;

// Re-export for use in the main app crate.
pub use service::TelegramServiceState;
