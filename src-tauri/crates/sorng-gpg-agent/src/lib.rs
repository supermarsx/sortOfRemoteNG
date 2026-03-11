//! # SortOfRemote NG – GPG Agent Manager
//!
//! Comprehensive GPG agent management providing key operations, signing,
//! encryption, and hardware token support.
//!
//! ## Key Capabilities
//!
//! - **Assuan Protocol** — Client implementation for gpg-agent communication
//!   using the Assuan IPC protocol with socket and command-line fallbacks
//! - **GPG Keyring Management** — List, import, export, delete, and generate
//!   GPG keys with full support for colon-delimited output parsing
//! - **Key Signing & Verification** — Detached, inline, and clear-text
//!   signatures; file and data signing; multi-algorithm verification
//! - **Encryption & Decryption** — Public-key and symmetric encryption,
//!   multi-recipient support, armor/binary output, combined sign+encrypt
//! - **Key Trust Model & Web of Trust** — Owner trust management, trust
//!   database statistics, validity calculation, ownertrust import/export
//! - **Smart Card / Hardware Token Integration** — OpenPGP card operations,
//!   YubiKey support, key-to-card transfers, card PIN management, on-card
//!   key generation via scdaemon
//! - **Key Server Operations** — Search, fetch, send, and refresh keys from
//!   HKP/HKPS key servers
//! - **Subkey Management** — Add, revoke, and modify subkeys with per-key
//!   capability and expiration settings
//! - **Key Expiration & Revocation** — Set expiration dates, generate and
//!   import revocation certificates
//! - **Configuration Management** — Detect gpg installation, read/write
//!   gpg.conf and gpg-agent.conf, manage socket paths
//! - **Audit Logging** — Ring-buffer audit trail of all GPG operations with
//!   optional file persistence, filtering, and JSON export
//!
//! ## Architecture
//!
//! ```text
//! ┌───────────────────────────────────────────────────────────┐
//! │                   sorng-gpg-agent                         │
//! │                                                           │
//! │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐ │
//! │  │ Protocol │  │ Keyring  │  │ Signing  │  │Encryption│ │
//! │  │ (Assuan) │  │ Manager  │  │ Engine   │  │  Engine  │ │
//! │  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘ │
//! │       │              │              │              │       │
//! │  ┌────┴──────────────┴──────────────┴──────────────┴───┐  │
//! │  │            GpgAgentService (orchestrator)           │  │
//! │  └──────────────────────┬──────────────────────────────┘  │
//! │                         │                                 │
//! │  ┌──────────┐  ┌───────┴─────┐  ┌──────────┐ ┌────────┐ │
//! │  │  Trust   │  │  SmartCard  │  │  Config  │ │ Audit  │ │
//! │  │  Model   │  │  Manager    │  │ Manager  │ │  Log   │ │
//! │  └──────────┘  └─────────────┘  └──────────┘ └────────┘ │
//! └───────────────────────────────────────────────────────────┘
//! ```

pub mod audit;
pub mod card;
pub mod config;
pub mod encryption;
pub mod keyring;
pub mod protocol;
pub mod service;
pub mod signing;
pub mod trust;
pub mod types;
