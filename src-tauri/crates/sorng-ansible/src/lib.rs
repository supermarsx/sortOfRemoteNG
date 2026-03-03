//! # SortOfRemote NG – Ansible Automation Management
//!
//! Comprehensive Ansible integration for managing infrastructure as code.
//! Wraps the Ansible CLI tool-chain and provides structured access to
//! inventories, playbooks, ad-hoc commands, roles, galaxy, vault,
//! facts, and configuration from the Tauri front-end.
//!
//! ## Modules
//!
//! - **types** — Shared data structures (inventory, playbooks, tasks, roles, etc.)
//! - **error** — Crate-specific error types
//! - **client** — Ansible CLI wrapper: binary detection, version parsing, execution
//! - **inventory** — Inventory file parsing (INI / YAML), host & group CRUD, dynamic inventory
//! - **playbooks** — Playbook parsing, validation, execution, check mode, diff mode
//! - **adhoc** — Ad-hoc command execution (ansible <pattern> -m <module> -a <args>)
//! - **roles** — Role scaffolding, listing, dependency resolution
//! - **vault** — Ansible Vault encrypt / decrypt / rekey / view
//! - **galaxy** — Ansible Galaxy role & collection management (install, list, search, remove)
//! - **facts** — Fact gathering, caching, and querying per host
//! - **config** — ansible.cfg parsing, environment overrides, config dump
//! - **service** — Aggregate façade + Tauri state alias
//! - **commands** — `#[tauri::command]` handlers

pub mod types;
pub mod error;
pub mod client;
pub mod inventory;
pub mod playbooks;
pub mod adhoc;
pub mod roles;
pub mod vault;
pub mod galaxy;
pub mod facts;
pub mod config;
pub mod service;
pub mod commands;
