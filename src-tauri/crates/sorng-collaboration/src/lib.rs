//! # SortOfRemote NG – Collaboration
//!
//! Multi-user collaboration engine for shared workspaces, real-time presence tracking,
//! role-based access control, live session sharing, and team coordination.
//!
//! ## Architecture
//!
//! The collaboration system is built around three pillars:
//!
//! 1. **Shared Workspaces** — Collections of connections that multiple users can access
//!    with granular permissions (Owner, Admin, Editor, Viewer).
//!
//! 2. **Real-time Presence** — WebSocket-driven presence tracking showing who is online,
//!    what they're connected to, and enabling live session sharing.
//!
//! 3. **Audit & Sync** — Immutable audit trails for compliance, vector-clock conflict
//!    resolution for concurrent edits, and real-time state synchronization.
//!
//! ## Module Overview
//!
//! - [`types`] — Core data types shared across all collaboration modules
//! - [`service`] — Main entry point and Tauri state management
//! - [`workspace`] — Shared workspace lifecycle (create, join, leave, archive)
//! - [`presence`] — User presence tracking and heartbeat management
//! - [`sharing`] — Connection/folder sharing with permission management
//! - [`session_share`] — Live session sharing (view-only or interactive)
//! - [`sync`] — Real-time synchronization engine with WebSocket transport
//! - [`audit`] — Immutable, append-only audit log
//! - [`rbac`] — Role-Based Access Control enforcement
//! - [`messaging`] — In-app team messaging and connection annotations
//! - [`notifications`] — Event-driven notification system
//! - [`conflict`] — Vector-clock based conflict resolution
//! - [`discovery`] — User and team discovery, invitations

pub mod audit;
pub mod conflict;
pub mod discovery;
pub mod messaging;
pub mod notifications;
pub mod presence;
pub mod rbac;
pub mod service;
pub mod session_share;
pub mod sharing;
pub mod sync;
pub mod types;
pub mod workspace;
