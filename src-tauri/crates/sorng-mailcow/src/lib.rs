// ── sorng-mailcow – Mailcow (mailcow-dockerized) administration ──────────────
//!
//! ## Modules
//!
//! - **types** — Shared data structures (domains, mailboxes, aliases, DKIM, etc.)
//! - **error** — Crate-specific error types
//! - **client** — Mailcow REST API HTTP client with X-API-Key authentication
//! - **domains** — Domain management (list, get, create, update, delete)
//! - **mailboxes** — Mailbox management (CRUD, quarantine notifications)
//! - **aliases** — Alias management (CRUD)
//! - **dkim** — DKIM key management (get, generate, delete, duplicate)
//! - **domain_aliases** — Domain alias management (CRUD)
//! - **transport** — Transport map management (CRUD)
//! - **queue** — Mail queue management (summary, list, flush, delete)
//! - **quarantine** — Quarantine management (list, release, delete, whitelist)
//! - **logs** — Log retrieval (Dovecot, Postfix, SOGo, Rspamd, etc.)
//! - **status** — System status, containers, Fail2Ban, rate limits, resources, app passwords
//! - **service** — Aggregate facade + Tauri state alias
//! - **commands** — `#[tauri::command]` handlers

pub mod aliases;
pub mod client;
pub mod commands;
pub mod dkim;
pub mod domain_aliases;
pub mod domains;
pub mod error;
pub mod logs;
pub mod mailboxes;
pub mod quarantine;
pub mod queue;
pub mod service;
pub mod status;
pub mod transport;
pub mod types;
