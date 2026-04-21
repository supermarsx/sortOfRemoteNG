//! # SortOfRemote NG – YubiKey Hardware Token Support
//!
//! Comprehensive YubiKey management providing full integration with
//! Yubico tools via the `ykman` CLI.
//!
//! ## Key Capabilities
//!
//! - **Device Detection & Enumeration** — Discover connected YubiKeys,
//!   poll for insertion/removal, read firmware and serial information
//! - **PIV (CCID) Smart Card Operations** — Key generation, certificate
//!   management, signing, CSR generation, import/export, attestation,
//!   PIN/PUK/management-key lifecycle across all PIV slots
//! - **FIDO2/WebAuthn Credential Management** — List, inspect, and delete
//!   discoverable credentials; PIN management; UV policies; large-blob
//! - **OATH TOTP/HOTP Accounts** — Add, remove, rename, and calculate
//!   one-time codes for TOTP and HOTP accounts stored on the device
//! - **Yubico OTP Configuration** — Configure short/long OTP slots for
//!   Yubico OTP, challenge-response, static passwords, or HOTP
//! - **YubiKey Device Management** — Interface enable/disable (USB/NFC),
//!   config lock/unlock, auto-eject, factory reset
//! - **PIN/PUK Management** — Change, verify, unblock, and audit PIN
//!   status across PIV and FIDO2 applets
//! - **Certificate Operations for PIV Slots** — Self-signed certs, CSRs,
//!   import, export, delete, and slot-level attestation
//! - **Attestation** — Prove that keys were generated on-device with
//!   YubiKey attestation certificates
//! - **Audit Logging** — Ring-buffer audit trail of all YubiKey operations
//!
//! ## Architecture
//!
//! ```text
//! ┌───────────────────────────────────────────────────────────┐
//! │                    sorng-yubikey                          │
//! │                                                          │
//! │  ┌──────────┐  ┌──────────┐  ┌──────────┐ ┌──────────┐  │
//! │  │  Detect  │  │   PIV    │  │  FIDO2   │ │   OATH   │  │
//! │  │  Module  │  │  Module  │  │  Module  │ │  Module  │  │
//! │  └────┬─────┘  └────┬─────┘  └────┬─────┘ └────┬─────┘  │
//! │       │              │              │             │        │
//! │  ┌────┴──────────────┴──────────────┴─────────────┴────┐  │
//! │  │            YubiKeyService (orchestrator)            │  │
//! │  └──────────────────────┬──────────────────────────────┘  │
//! │                         │                                 │
//! │  ┌──────────┐  ┌───────┴─────┐  ┌──────────┐ ┌────────┐ │
//! │  │   OTP    │  │   Config    │  │  Manage  │ │ Audit  │ │
//! │  │  Module  │  │   Manager   │  │  Module  │ │  Log   │ │
//! │  └──────────┘  └─────────────┘  └──────────┘ └────────┘ │
//! └───────────────────────────────────────────────────────────┘
//! ```

pub mod audit;
pub mod config;
pub mod detect;
pub mod fido2;
pub mod management;
pub mod oath;
pub mod otp;
pub mod piv;
pub mod service;
pub mod types;
