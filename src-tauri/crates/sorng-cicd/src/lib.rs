//! CI/CD integration crate for SortOfRemote NG.
//!
//! Provides Drone CI, Jenkins, and GitHub Actions pipeline management,
//! builds, artifacts, secrets, environments, and Tauri command integration.

pub mod types;
pub mod error;
pub mod client;
pub mod drone;
pub mod jenkins;
pub mod github_actions;
pub mod service;
pub mod commands;
