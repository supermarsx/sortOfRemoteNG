//! # sorng-marketplace
//!
//! Plugin marketplace for SortOfRemote NG — Git/GitHub-backed extension
//! discovery, browsing, installation, ratings, reviews, verified badges,
//! repository indexing, manifest validation, dependency resolution,
//! and one-click install.
//!
//! | Module       | Purpose                                          |
//! |--------------|--------------------------------------------------|
//! | `types`      | Data types, enums, and configuration structs     |
//! | `error`      | Error types for the marketplace                  |
//! | `registry`   | In-memory listing store, install tracking        |
//! | `repository` | Git/GitHub repository indexing & manifest fetch   |
//! | `resolver`   | Dependency resolution & compatibility checks     |
//! | `search`     | Full-text search, tokenisation, relevance scoring|
//! | `ratings`    | Review storage, averages, distributions          |
//! | `installer`  | Download, verify, extract, uninstall extensions  |
//! | `service`    | Service façade (`MarketplaceServiceState`)       |
//! | `commands`   | Tauri `#[command]` handlers                      |

pub mod commands;
pub mod error;
pub mod installer;
pub mod ratings;
pub mod registry;
pub mod repository;
pub mod resolver;
pub mod search;
pub mod service;
pub mod types;
