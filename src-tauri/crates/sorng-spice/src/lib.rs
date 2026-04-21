//! SPICE (Simple Protocol for Independent Computing Environments) crate.
//!
//! Provides comprehensive SPICE remote-display support including:
//!
//! - **types** — Full protocol model: channels, pixel formats, connection config,
//!   session metadata, display/input/USB/clipboard events, QoS, TLS options.
//! - **protocol** — SPICE mini-header & full-header framing, ticket auth, link
//!   messages, capability negotiation.
//! - **channels** — Channel multiplexer: main, display, inputs, cursor, playback,
//!   record, USB redirection, webdav, port.
//! - **display** — Display channel decoder: surface create/destroy, draw commands,
//!   image decompression (QUIC, LZ4, JPEG, ZLIB), streaming regions.
//! - **input** — Keyboard & mouse event encoding (scan-codes, button mask).
//! - **clipboard** — Clipboard/cut-buffer sharing between guest and client.
//! - **usb** — USB device redirection channel management.
//! - **streaming** — Gstreamer-style video streaming region handling.
//! - **session** — Async session lifecycle (connect → auth → channel-open → run).
//! - **service** — Multi-session facade + `Arc<Mutex<_>>` Tauri state alias.
//! - **commands** — `#[tauri::command]` handlers for the frontend.

pub mod spice;
