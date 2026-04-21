//! # SortOfRemote NG – TOTP / HOTP Authenticator
//!
//! Comprehensive time-based and counter-based one-time password crate:
//!
//! - **RFC 4226 / 6238** – HOTP & TOTP generation with SHA-1, SHA-256, SHA-512
//! - **otpauth:// URIs** – Parsing & generation per the Google Authenticator spec
//! - **QR Codes** – Generate QR images from URIs, decode QR images to extract secrets
//! - **Multi-format Import** – Google Authenticator migration, Aegis, 2FAS, andOTP,
//!   Authy, FreeOTP+, Bitwarden, RAIVO
//! - **Export** – JSON, CSV, encrypted backup, otpauth URI lists
//! - **Encrypted Vault** – AES-256-GCM encrypted storage with PBKDF2 key derivation
//! - **Tauri Commands** – Full command surface for frontend integration

pub mod totp;
