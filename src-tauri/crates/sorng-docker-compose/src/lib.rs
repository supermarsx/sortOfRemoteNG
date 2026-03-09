// ── sorng-docker-compose – Docker Compose Management ──────────────────────────
//!
//! # SortOfRemote NG – Docker Compose
//!
//! Comprehensive Docker Compose management providing:
//!
//! ## Modules
//!
//! - **types** — Full Compose Specification model (services, networks, volumes,
//!   secrets, configs, deploy, healthcheck, etc.) plus CLI config structs,
//!   output types, and runtime state representations.
//! - **error** — Crate-specific error types with fine-grained error kinds.
//! - **parser** — YAML/JSON parsing, multi-file merge, `${VAR}` interpolation
//!   with all Compose variable substitution operators, `.env` file parsing,
//!   and structural validation.
//! - **cli** — Auto-detecting CLI wrapper for `docker compose` (v2 plugin) and
//!   `docker-compose` (v1) covering every sub-command: up, down, ps, logs,
//!   build, pull, push, run, exec, create, start, stop, restart, pause,
//!   unpause, kill, rm, cp, top, port, images, events, config/convert,
//!   watch, scale, ls.
//! - **graph** — Dependency graph construction via `petgraph` with topological
//!   sort for startup/shutdown ordering and cycle detection.
//! - **profiles** — Profile analysis, active-service filtering, and
//!   cross-profile dependency validation.
//! - **templates** — Built-in ready-to-use compose templates (databases, web
//!   servers, monitoring stacks, full-stack apps, etc.) with scaffolding.
//! - **service** — Aggregate façade + Tauri `Arc<Mutex<_>>` state alias.
//! - **commands** — `#[tauri::command]` handlers (50+ commands).

pub mod cli;
pub mod commands;
pub mod error;
pub mod graph;
pub mod parser;
pub mod profiles;
pub mod service;
pub mod templates;
pub mod types;
