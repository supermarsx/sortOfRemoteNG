// ── sorng-smb / smb module ────────────────────────────────────────────────────
//
// SMB/CIFS client service providing:
//   • Connection management (credential caching, per-host sessions)
//   • Share enumeration (list shares on a server)
//   • Directory listing with metadata
//   • File read / write (download / upload)
//   • mkdir / rmdir / rename / delete
//   • stat (file metadata query)
//   • Tauri command bindings for the frontend
//
// Platform split: Windows uses UNC paths + std::fs + `net view`; Unix
// uses the `smbclient` CLI subprocess. See `lib.rs` top docstring for the
// full rationale (pavao rejected due to libsmbclient C-library dependency
// unavailable on Windows).

// NOTE: `commands.rs` is intentionally NOT `mod`-declared here.
// Tauri command bindings live in that file and require the `tauri`
// crate, which is a dependency of the aggregator (`sorng-commands-core`),
// not of this crate. The aggregator includes `commands.rs` via
// `include!()` through `src-tauri/src/smb_commands.rs`. Same pattern as
// `sorng-sftp`, `sorng-ftp`, and `sorng-rustdesk`.

pub mod file_ops;
pub mod service;
pub mod session;
pub mod types;

pub use service::{SmbService, SmbServiceState};
pub use types::*;
