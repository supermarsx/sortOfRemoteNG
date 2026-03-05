//! # sorng-xdmcp
//!
//! X Display Manager Control Protocol (XDMCP) implementation.
//!
//! XDMCP (RFC 1198) manages remote X Window System displays. It handles
//! the negotiation between an X terminal (or thin client) and an X
//! Display Manager (XDM, GDM, KDM, LightDM, SDDM) to establish an X11
//! session on a remote host.
//!
//! ## Protocol phases
//!
//! 1. **Discovery** — `Query`, `BroadcastQuery`, `IndirectQuery` → `Willing`
//! 2. **Request** — `Request` → `Accept` / `Decline`
//! 3. **Manage** — `Manage` → session start / `Refuse` / `Failed`
//! 4. **KeepAlive** — periodic `KeepAlive` → `Alive`
//!
//! ## Module layout
//!
//! | Module       | Purpose                                        |
//! |------------- |------------------------------------------------|
//! | `types`      | Core data types, config, errors                |
//! | `protocol`   | XDMCP wire protocol encoding/decoding          |
//! | `discovery`  | Host discovery via Query/BroadcastQuery         |
//! | `xserver`    | X server process management (Xephyr/Xorg)      |
//! | `session`    | Async session lifecycle                         |
//! | `service`    | Multi-session facade                            |
//! | `commands`   | Tauri command handlers                          |

pub mod xdmcp;
