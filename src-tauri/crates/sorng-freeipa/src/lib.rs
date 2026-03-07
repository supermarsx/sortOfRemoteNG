//! # SortOfRemote NG – FreeIPA / IdM Integration
//!
//! Comprehensive FreeIPA identity-management crate providing:
//!
//! - **Users** — create, modify, enable/disable, lock/unlock, SSH keys, certificates
//! - **Groups** — POSIX & external groups, membership management
//! - **Hosts** — host enrollment, host groups, keytab management
//! - **HBAC** — Host-Based Access Control rules, services, service groups
//! - **Sudo** — sudo rules, commands, command groups
//! - **DNS** — zones, records, forward zones
//! - **Certificates** — request, revoke, hold/unhold, CA info
//! - **Policies** — password policies, Kerberos ticket policies, global config
//!
//! All operations use the FreeIPA JSON-RPC API (`/ipa/session/json`).

pub mod certificates;
pub mod client;
pub mod commands;
pub mod dns;
pub mod error;
pub mod groups;
pub mod hbac;
pub mod hosts;
pub mod policies;
pub mod service;
pub mod sudo_rules;
pub mod types;
pub mod users;
