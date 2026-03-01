//! **sorng-smtp** — full-featured SMTP client crate.
//!
//! # Modules
//!
//! | Module | Purpose |
//! |---|---|
//! | [`types`] | All data types, error handling, configuration |
//! | [`client`] | Low-level SMTP protocol engine (EHLO, AUTH, STARTTLS, DATA) |
//! | [`auth`] | SMTP authentication mechanisms (PLAIN, LOGIN, CRAM-MD5, XOAUTH2) |
//! | [`message`] | MIME message builder (text, HTML, mixed, attachments, inline images) |
//! | [`templates`] | Template engine with variable substitution |
//! | [`queue`] | Async send queue with retry, scheduling, throttling |
//! | [`dkim`] | DKIM signing (RSA-SHA256) |
//! | [`contacts`] | Contact/address-book management, groups, import/export |
//! | [`diagnostics`] | MX lookup, connectivity tests, deliverability checks |
//! | [`service`] | Service façade (Tauri state) |
//! | [`commands`] | `#[tauri::command]` handlers |

pub mod types;
pub mod client;
pub mod auth;
pub mod message;
pub mod templates;
pub mod queue;
pub mod dkim;
pub mod contacts;
pub mod diagnostics;
pub mod service;
pub mod commands;
