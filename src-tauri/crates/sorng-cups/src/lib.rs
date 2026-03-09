//! # sorng-cups
//!
//! CUPS (Common UNIX Printing System) integration crate for SortOfRemote NG.
//!
//! Provides complete management of remote print servers via the IPP
//! (Internet Printing Protocol) and the CUPS HTTP/HTTPS API:
//!
//! - **types** — Data structures for printers, jobs, classes, PPDs, drivers, and server config.
//! - **error** — Typed error handling with IPP status codes.
//! - **ipp** — Low-level IPP 1.1/2.0 binary request building and response parsing.
//! - **printers** — Printer discovery, CRUD, pause/resume, enable/reject, statistics.
//! - **jobs** — Job submission (data & URI), cancel, hold, release, restart, move.
//! - **classes** — Printer class CRUD and membership management.
//! - **ppd** — PPD listing, retrieval, parsing, upload, and assignment.
//! - **drivers** — Driver listing, lookup, and recommendation.
//! - **admin** — Server settings, log retrieval, test pages, and history cleanup.
//! - **subscriptions** — IPP event subscriptions and notification polling.
//! - **service** — Session-based service façade with `Arc<Mutex<>>` state.
//! - **commands** — `#[tauri::command]` handlers exposed to the Tauri frontend.

pub mod admin;
pub mod classes;
pub mod commands;
pub mod drivers;
pub mod error;
pub mod ipp;
pub mod jobs;
pub mod ppd;
pub mod printers;
pub mod service;
pub mod subscriptions;
pub mod types;
