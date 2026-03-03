//! # SortOfRemote NG – SSH Agent
//!
//! Full OpenSSH agent implementation providing both a **built-in agent** that
//! manages keys natively and a **system agent bridge** that proxies requests to
//! the host's running `ssh-agent` / Pageant / Windows OpenSSH agent.
//!
//! ## Key Capabilities
//!
//! - **SSH Agent Protocol** — Full implementation of the SSH agent wire protocol
//!   (draft-miller-ssh-agent) including all message types
//! - **Built-in Agent** — Native key store that holds RSA, Ed25519, ECDSA, and
//!   SK (FIDO2) keys in memory with optional encrypted persistence
//! - **System Agent Bridge** — Connects to the platform's native SSH agent via
//!   `SSH_AUTH_SOCK` (Unix) or named pipe (Windows) and proxies requests
//! - **Agent Forwarding** — Full agent forwarding support for SSH sessions,
//!   including multi-hop chains and selective forwarding
//! - **Key Constraints** — Time-based expiry, confirm-before-use, max-sign
//!   limits, host restriction, and extension constraints
//! - **Key Locking** — Lock/unlock the agent with a passphrase (protocol-level)
//! - **Certificate Support** — SSH certificate loading and signing (user and
//!   host certificates, OpenSSH CA format)
//! - **PKCS#11 / Security Keys** — Load keys from PKCS#11 tokens and FIDO2
//!   security keys (SK-ED25519, SK-ECDSA)
//! - **Session Binding** — Bind keys to specific sessions for isolation
//! - **Audit Trail** — Full event log of all agent operations (sign, add,
//!   remove, lock, forward) with timestamps and metadata
//! - **Configurable Socket** — Custom socket path, Windows named pipe, or
//!   TCP listener for IDE/tool integration
//! - **Multi-Agent** — Run multiple isolated agent instances for different
//!   security contexts (work, personal, CI, etc.)
//!
//! ## Architecture
//!
//! ```text
//! ┌─────────────────────────────────────────────────────────┐
//! │                    sorng-ssh-agent                       │
//! │                                                         │
//! │  ┌──────────┐  ┌──────────┐  ┌───────────┐  ┌────────┐│
//! │  │ Protocol │  │ Built-in │  │  System   │  │ Key    ││
//! │  │ Codec    │  │  Agent   │  │  Bridge   │  │ Store  ││
//! │  └────┬─────┘  └────┬─────┘  └─────┬─────┘  └───┬────┘│
//! │       │              │              │             │      │
//! │  ┌────┴──────────────┴──────────────┴─────────────┴──┐  │
//! │  │              AgentService (orchestrator)           │  │
//! │  └───────────────────────┬───────────────────────────┘  │
//! │                          │                              │
//! │  ┌──────────┐  ┌────────┴────┐  ┌──────────┐           │
//! │  │ Socket   │  │  Forwarding │  │  Audit   │           │
//! │  │ Listener │  │  Manager    │  │  Log     │           │
//! │  └──────────┘  └─────────────┘  └──────────┘           │
//! └─────────────────────────────────────────────────────────┘
//! ```

pub mod types;
pub mod protocol;
pub mod keystore;
pub mod agent;
pub mod bridge;
pub mod forwarding;
pub mod constraints;
pub mod socket;
pub mod audit;
pub mod service;
pub mod commands;
