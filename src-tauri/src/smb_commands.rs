// src-tauri/src/smb_commands.rs
//
// Wrapper module for SMB Tauri commands. Mirrors the pattern used by
// `ftp_commands.rs`, `sftp_commands.rs`, and `rustdesk_commands.rs`:
// include the crate-level `commands.rs` file via `include!`, and bring
// the `service` / `types` modules into the inclusion scope via local
// path aliases.
//
// The `crate::smb::*` paths below are satisfied once the aggregator
// re-exports `sorng_smb::smb` — exactly the same pattern used by
// `sorng-app-domains-core/src/lib.rs:40` for `sorng_ftp::ftp`.
//
// Threading model: commands are async. They lock a `tokio::sync::Mutex`
// briefly, then delegate to the backend, which internally uses
// `tokio::task::spawn_blocking` for blocking subprocess / UNC I/O.
// The Tauri command thread is never blocked on SMB I/O.

mod service {
    pub use crate::smb::service::SmbServiceState;
}

mod types {
    pub use crate::smb::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-smb/src/smb/commands.rs");
}

pub(crate) use inner::*;
