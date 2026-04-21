//! # sorng-mcp — Native MCP Server
//!
//! Full Model Context Protocol (MCP) server implementation for SortOfRemote NG.
//! Exposes the application's connection management, SSH operations, file transfers,
//! network utilities, database queries, and system diagnostics as MCP tools,
//! resources, and prompts that AI assistants (Claude Desktop, VS Code Copilot, etc.)
//! can discover and invoke.
//!
//! ## Architecture
//!
//! ```text
//! ┌──────────────────┐     JSON-RPC 2.0      ┌───────────────────┐
//! │  AI Client        │◄──────────────────────►│  MCP Server       │
//! │  (Claude, etc.)   │   Streamable HTTP     │  (sorng-mcp)      │
//! └──────────────────┘   + SSE                └───────┬───────────┘
//!                                                      │
//!                                              ┌───────▼───────────┐
//!                                              │  Tauri App State   │
//!                                              │  SSH / RDP / VNC   │
//!                                              │  SFTP / DB / Net   │
//!                                              └───────────────────┘
//! ```
//!
//! ## Modules
//!
//! - **types** — MCP protocol types (JSON-RPC, Tool, Resource, Prompt, etc.)
//! - **protocol** — JSON-RPC message parsing, routing, and response building
//! - **transport** — Streamable HTTP transport with SSE support
//! - **session** — MCP session lifecycle management
//! - **server** — Main MCP server start/stop/configure
//! - **tools** — Tool definitions (connection mgmt, SSH, SFTP, network, DB, system)
//! - **resources** — Resource definitions (connections, sessions, settings, logs)
//! - **prompts** — Prompt templates (troubleshoot, bulk command, audit)
//! - **auth** — API key / bearer token authentication
//! - **capabilities** — Server capability negotiation
//! - **logging** — MCP logging notifications
//! - **service** — Central McpService orchestrator + state
//! - **commands** — Tauri command handlers

pub mod auth;
pub mod capabilities;
pub mod logging;
pub mod prompts;
pub mod protocol;
pub mod resources;
pub mod server;
pub mod service;
pub mod session;
pub mod tools;
pub mod transport;
pub mod types;

pub use service::{McpService, McpServiceState};
pub use types::*;
