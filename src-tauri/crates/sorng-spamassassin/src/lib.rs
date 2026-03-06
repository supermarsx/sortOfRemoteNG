// ── sorng-spamassassin – SpamAssassin management via SSH ─────────────────────

pub mod types;
pub mod error;
pub mod client;
pub mod rules;
pub mod bayes;
pub mod channels;
pub mod whitelist;
pub mod plugins;
pub mod config;
pub mod scanning;
pub mod process;
pub mod logs;
pub mod service;
pub mod commands;
