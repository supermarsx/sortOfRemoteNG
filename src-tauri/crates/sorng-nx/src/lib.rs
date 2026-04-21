//! # sorng-nx
//!
//! NX / NoMachine remote display protocol engine.
//!
//! NX is a set of technologies and tools for optimising remote X Window System
//! connections. Originally developed by NoMachine, the open-source NX libraries
//! (nxcomp, nxproxy, nxagent) enable:
//!
//! - **Differential compression** of X11 traffic
//! - **Session suspend / resume** across network interruptions
//! - **SSH tunnelling** for encryption
//! - **Multimedia forwarding** (audio, video)
//! - **Printing** and file sharing over the session
//!
//! This crate models the NX protocol lifecycle, proxy negotiation,
//! session state machine, and the Tauri command surface required to
//! drive NX connections from the UI.
//!
//! ## Module layout
//!
//! | Module       | Purpose                                        |
//! |------------- |------------------------------------------------|
//! | `types`      | Core data types, config, errors                |
//! | `protocol`   | NX wire protocol messages and negotiation       |
//! | `proxy`      | nxproxy / nxcomp process management             |
//! | `display`    | Display configuration and geometry              |
//! | `media`      | Audio / video forwarding                        |
//! | `printing`   | Printer redirection                             |
//! | `session`    | Async session lifecycle and state machine       |
//! | `service`    | Multi-session facade                            |
//! | `commands`   | Tauri command handlers                          |

pub mod nx;
