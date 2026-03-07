//! # sorng-port-knock — Comprehensive Port Knocking
//!
//! Full-featured port knocking crate supporting multiple knock methods, firewall integration,
//! and advanced single packet authorization.
//!
//! ## Capabilities
//!
//! ### Knock Client (client)
//! - Send TCP SYN knock sequences to target hosts
//! - Send UDP knock packets with configurable payloads
//! - Mixed TCP/UDP knock sequences
//! - Configurable inter-knock delays and timeouts
//! - Verify target port opens after knock sequence
//! - Retry logic with exponential backoff
//! - IPv4 and IPv6 support
//! - Async non-blocking knock operations
//! - Bulk knock to multiple hosts simultaneously
//!
//! ### Sequence Management (sequence)
//! - Define ordered port knock sequences
//! - Random sequence generation with configurable parameters
//! - Sequence validation and sanitization
//! - Time-based one-time sequences (TOKS)
//! - Sequence encoding/decoding (base64, hex)
//! - Sequence complexity scoring
//! - Import/export sequences in various formats
//!
//! ### Cryptographic Knocks (crypto)
//! - HMAC-SHA256 authenticated knock payloads
//! - AES-256-GCM encrypted knock packets
//! - Rijndael CBC legacy encryption support
//! - Asymmetric knock authentication (GPG/RSA)
//! - Shared secret key management
//! - Nonce/replay protection with sliding window
//! - Key derivation (PBKDF2, Argon2 parameters)
//! - Digest-based knock verification tokens
//!
//! ### Single Packet Authorization (spa)
//! - SPA packet construction and parsing
//! - fwknop-compatible SPA format
//! - Encrypted SPA payloads (AES, GPG)
//! - SPA with NAT traversal support
//! - SPA server access request encoding
//! - SPA forward access mode
//! - SPA local NAT access mode
//! - SPA client timeout mode
//! - SPA with HMAC authentication
//!
//! ### Firewall Integration (firewall)
//! - iptables rule generation for knock sequences
//! - nftables rule sets for port knock gates
//! - pf (BSD) anchor rules for knock responses
//! - Windows Firewall (netsh) rule management
//! - Automatic rule insertion/removal after knock
//! - Timed rule expiration (auto-close after N seconds)
//! - Rule chain management for multi-stage knocks
//! - Firewall state inspection
//! - Rule backup and restore
//!
//! ### knockd Compatibility (knockd)
//! - Parse knockd.conf configuration files
//! - Generate knockd.conf from profiles
//! - knockd sequence format support
//! - knockd command triggers (open/close)
//! - knockd log format parsing
//! - knockd service management (start/stop/status)
//! - Multi-interface knock binding
//! - knockd one-time sequence support
//!
//! ### fwknop Protocol (fwknop)
//! - Full fwknop client protocol implementation
//! - fwknop SPA message formatting
//! - fwknop server configuration generation
//! - Rijndael and GPG encryption modes
//! - HMAC authentication (SHA-256/384/512)
//! - fwknop access.conf parsing/generation
//! - fwknop NAT mode support
//! - fwknop digest caching
//! - fwknop stanza management
//!
//! ### Profiles (profiles)
//! - Create/update/delete knock profiles
//! - Named profiles with descriptions
//! - Profile categories and tags
//! - Import/export profiles (JSON, TOML)
//! - Profile sharing and templates
//! - Default profile management
//! - Profile validation
//! - Profile cloning
//!
//! ### Scanner & Verification (scanner)
//! - Verify port accessibility after knock
//! - TCP connect verification
//! - Service banner detection post-knock
//! - Knock sequence timing analysis
//! - Port state change detection
//! - Knock reliability testing
//! - Round-trip time measurement
//! - Multi-port verification
//!
//! ### History & Audit (history)
//! - Log all knock attempts with timestamps
//! - Success/failure tracking per host
//! - Knock duration and timing stats
//! - Export history (JSON, CSV)
//! - History search and filtering
//! - Statistics aggregation
//! - Retention policy management
//! - Audit trail for compliance

pub mod types;
pub mod error;
pub mod client;
pub mod sequence;
pub mod crypto;
pub mod spa;
pub mod firewall;
pub mod knockd;
pub mod fwknop;
pub mod profiles;
pub mod scanner;
pub mod history;
pub mod service;
pub mod base64_util;
pub mod commands;
