//! # SortOfRemote NG – Terraform Infrastructure-as-Code Management
//!
//! Comprehensive Terraform integration for managing cloud infrastructure.
//! Wraps the Terraform CLI and provides structured access to init, plan,
//! apply, destroy, state management, workspaces, modules, providers,
//! HCL analysis, drift detection, and more from the Tauri front-end.
//!
//! ## Modules
//!
//! - **types** — Shared data structures (plans, state, resources, providers, etc.)
//! - **error** — Crate-specific error types
//! - **client** — Terraform CLI wrapper: binary detection, version parsing, execution
//! - **init** — `terraform init` — backend & provider initialization
//! - **plan** — `terraform plan` — execution plan creation, diffing, JSON plan parsing
//! - **apply** — `terraform apply` / `terraform destroy` — infrastructure mutations
//! - **state** — State management: list, show, mv, rm, pull, push, import, taint, untaint
//! - **workspace** — Workspace management: new, select, list, delete, show
//! - **validate** — `terraform validate` / `terraform fmt` — config validation & formatting
//! - **output** — `terraform output` — output value management
//! - **providers** — Provider listing, lock-file inspection, mirror
//! - **modules** — Module management, registry search, `terraform get`
//! - **graph** — `terraform graph` — dependency graph generation (DOT format)
//! - **hcl** — HCL file analysis: variable extraction, resource enumeration, data sources
//! - **drift** — Drift detection: refresh + plan comparison for out-of-band changes
//! - **service** — Aggregate façade + Tauri state alias
//! - **commands** — `#[tauri::command]` handlers

pub mod apply;
pub mod client;
pub mod commands;
pub mod drift;
pub mod error;
pub mod graph;
pub mod hcl;
pub mod init;
pub mod modules;
pub mod output;
pub mod plan;
pub mod providers;
pub mod service;
pub mod state;
pub mod types;
pub mod validate;
pub mod workspace;
