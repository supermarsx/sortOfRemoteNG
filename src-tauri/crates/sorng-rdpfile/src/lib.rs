//! # sorng-rdpfile
//!
//! RDP file parser and generator for SortOfRemote NG.
//!
//! Provides full import/export of Microsoft `.rdp` files with comprehensive
//! setting coverage, batch generation, and round-trip fidelity.
//!
//! | Module      | Purpose                                          |
//! |-------------|--------------------------------------------------|
//! | `types`     | Data types: RdpFile, RdpValue, RdpParseResult    |
//! | `error`     | Error types for RDP file operations               |
//! | `parser`    | Parse `.rdp` file content into `RdpFile`          |
//! | `generator` | Generate `.rdp` file content from `RdpFile`       |
//! | `converter` | Convert between RdpFile and app connection format |
//! | `batch`     | Batch import/export operations                    |
//! | `service`   | Service façade (`RdpFileServiceState`)            |
//! | `commands`  | Tauri `#[command]` handlers                       |

pub mod batch;
pub mod commands;
pub mod converter;
pub mod error;
pub mod generator;
pub mod parser;
pub mod service;
pub mod types;
