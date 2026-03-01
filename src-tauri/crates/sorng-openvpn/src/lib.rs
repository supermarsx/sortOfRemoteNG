//! # sorng-openvpn
//!
//! Specialized crate for instantiating and managing OpenVPN connections.
//!
//! ## Modules
//!
//! | Module | Purpose |
//! |--------|---------|
//! | **types** | Shared enums, structs, errors, event payloads |
//! | **config** | `.ovpn` parsing, generation, validation, templating |
//! | **process** | OpenVPN binary lifecycle – spawn, signal, kill, env |
//! | **management** | Real-time management-interface client (TCP socket) |
//! | **tunnel** | Tunnel health monitoring, bandwidth stats, reconnect logic |
//! | **auth** | Certificate helpers, credential files, PKCS, OTP/2FA |
//! | **routing** | Route table manipulation, split-tunnel policies |
//! | **dns** | DNS leak prevention, resolver push/restore |
//! | **logging** | Structured OpenVPN log capture, rotation, export |
//! | **service** | Top-level service orchestrating all modules |
//! | **commands** | Thin `#[tauri::command]` wrappers |

pub mod openvpn;
