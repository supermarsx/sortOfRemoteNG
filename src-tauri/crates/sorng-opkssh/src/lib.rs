//! # SortOfRemote NG – OpenPubkey SSH (opkssh)
//!
//! Full integration with [opkssh](https://github.com/openpubkey/opkssh), the
//! OpenPubkey SSH tool that enables OIDC (OpenID Connect) based SSH
//! authentication.  Instead of managing long-lived SSH keys, users authenticate
//! with their identity provider (Google, Azure/Entra ID, GitLab, Authelia,
//! Authentik, Keycloak, …) and receive short-lived SSH certificates containing
//! PK Tokens.
//!
//! ## Key Capabilities
//!
//! - **Runtime Management** — Resolve the active backend runtime, report
//!   library-vs-CLI availability, detect installed `opkssh` CLI fallback, and
//!   download the latest release for the current platform (Windows / macOS /
//!   Linux, x86_64 / ARM64)
//! - **OIDC Login** — Trigger `opkssh login` with optional provider, custom key
//!   file name, and scopes.  Captures the generated SSH key path and token info.
//! - **Key Lifecycle** — List generated opkssh keys, inspect expiry, detect stale
//!   keys, and trigger re-login when expired.
//! - **Server Policy Management** — Over an existing SSH session, manage
//!   `/etc/opk/providers` and `/etc/opk/auth_id` (and `~/.opk/auth_id`) files,
//!   add/remove authorized identities, and configure expiration policies.
//! - **Provider Configuration** — Local `~/.opk/config.yml` management, custom
//!   provider presets, environment variable helpers for `OPKSSH_PROVIDERS` and
//!   `OPKSSH_DEFAULT`.
//! - **Server Installation** — Execute the opkssh server install script via SSH,
//!   or generate the manual install commands.
//! - **Audit** — Parse `opkssh audit` output for identity and access reviews.
//! - **Status & Diagnostics** — Runtime-first health checks, backend mode,
//!   version info, provider listing, and connection verification.
//!
//! ## Architecture
//!
//! ```text
//! ┌─────────────────────────────────────────────────────────────┐
//! │                     sorng-opkssh                            │
//! │                                                             │
//! │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────┐  │
//! │  │ Binary   │  │  OIDC    │  │  Server  │  │  Provider │  │
//! │  │ Manager  │  │  Login   │  │  Policy  │  │  Config   │  │
//! │  └────┬─────┘  └────┬─────┘  └────┬─────┘  └─────┬─────┘  │
//! │       │              │              │               │       │
//! │  ┌────┴──────────────┴──────────────┴───────────────┴────┐  │
//! │  │              OpksshService (Tauri State)               │  │
//! │  └───────────────────────────────────────────────────────┘  │
//! │       │                                                     │
//! │  ┌────┴──────────────────────────────────────────────────┐  │
//! │  │         commands.rs  (Tauri #[command] handlers)       │  │
//! │  └───────────────────────────────────────────────────────┘  │
//! └─────────────────────────────────────────────────────────────┘
//! ```

pub mod audit;
pub mod binary;
pub mod keys;
pub mod login;
pub mod providers;
pub mod server_policy;
pub mod service;
pub mod types;

pub use service::{OpksshService, OpksshServiceState};
pub use types::*;
