// ── sorng-roundcube – Roundcube Webmail administration ────────────────────────
//! Client for a separately deployed Roundcube JSON administration API.
//!
//! Stock Roundcube does not expose the `/login`, `/system/info`, or administration
//! resources used here. Deployments must provide a compatible custom API whose
//! base URL is supplied in [`types::RoundcubeConnectionConfig`].

pub mod address_books;
pub mod client;
pub mod error;
pub mod filters;
pub mod folders;
pub mod identities;
pub mod maintenance;
pub mod plugins;
pub mod service;
pub mod settings;
pub mod types;
pub mod users;
