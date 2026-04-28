// App-layer wrapper: compiles SSH command files (which use #[tauri::command])
// in the context of the app crate where tauri is available.

// ── Shim modules for ssh/ sub-module commands ──────────────────────────
// Each _cmds.rs file uses `use super::<module>::*;` — these shims make
// those paths resolve when the files are compiled via include!().

mod types {
    pub use crate::ssh::types::*;
    pub use crate::ssh::TERMINAL_BUFFERS;

    /// Information about an SSH key file.
    /// (Mirrored from commands.rs which is not compiled as a crate module.)
    #[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
    pub struct SshKeyFileInfo {
        pub path: String,
        pub is_valid: bool,
        pub is_sk: bool,
        pub sk_algorithm: Option<String>,
        pub is_encrypted: bool,
        pub needs_touch: bool,
    }
}
mod service {
    pub use crate::ssh::service::*;
}
mod automation {

    pub use crate::ssh::types::*;
    pub use crate::ssh::{ACTIVE_AUTOMATIONS, TERMINAL_BUFFERS};
    pub use chrono::Utc;
    pub use regex::Regex;
    pub use std::time::Duration;
}
mod diagnostics {
    pub use crate::ssh::diagnostics::*;
    pub use crate::ssh::types::*;
    pub use sorng_core::diagnostics::DiagnosticReport;
}
mod highlighting {
    pub use crate::ssh::highlighting::*;
    pub use crate::ssh::types::*;
    pub use crate::ssh::ACTIVE_HIGHLIGHTS;
    pub use regex::Regex;
    pub use std::collections::HashMap;
}
mod proxy_command {
    pub use crate::ssh::proxy_command::*;
    pub use crate::ssh::types::*;
    pub use std::time::Duration;
}
mod recording {

    pub use crate::ssh::types::*;
    pub use crate::ssh::ACTIVE_RECORDINGS;
    pub use chrono::Utc;
}
mod tunnels {

    pub use crate::ssh::types::*;
    pub use crate::ssh::{FTP_TUNNELS, RDP_TUNNELS, VNC_TUNNELS};
    pub use chrono::Utc;
    pub use uuid::Uuid;
}
mod fido2 {
    pub use crate::ssh::fido2::*;
}
mod sk_keys {}
mod x11 {
    pub use crate::ssh::types::*;
    pub use crate::ssh::x11::*;
}
// Shims for crate-root-level modules
mod script {}
mod script_stub {
    pub use crate::script::*;
    pub const DISABLED_MESSAGE: &str =
        "SSH script execution is disabled. Rebuild with the `script-engine` feature enabled.";
}
mod ssh3 {
    pub use crate::ssh3::*;
}

pub(crate) fn redact_ssh_command_error(error: String) -> String {
    crate::redact_secrets(&error, &[])
}

pub(crate) fn redact_ssh_command_result<T>(result: Result<T, String>) -> Result<T, String> {
    result.map_err(redact_ssh_command_error)
}

#[tauri::command]
pub fn ssh_respond_to_host_key_prompt(
    session_id: String,
    decision: crate::ssh::SshHostKeyPromptDecision,
) -> Result<(), String> {
    let sender = {
        let mut pending = crate::ssh::PENDING_HOST_KEY_PROMPTS.lock().map_err(|e| {
            redact_ssh_command_error(format!("Failed to lock host-key prompt map: {}", e))
        })?;
        pending.remove(&session_id)
    }
    .ok_or_else(|| {
        redact_ssh_command_error(format!(
            "No pending host-key prompt found for session {}",
            session_id
        ))
    })?;

    sender.send(decision).map_err(|_| {
        redact_ssh_command_error(format!(
            "Host-key prompt for session {} is no longer active",
            session_id
        ))
    })
}

// ── Include command wrappers ───────────────────────────────────────────

#[allow(dead_code)]
mod commands_inner {
    include!("../crates/sorng-ssh/src/ssh/commands_cmds.rs");
}
#[allow(dead_code)]
mod automation_inner {
    include!("../crates/sorng-ssh/src/ssh/automation_cmds.rs");
}
#[allow(dead_code)]
mod diagnostics_inner {
    include!("../crates/sorng-ssh/src/ssh/diagnostics_cmds.rs");
}
#[allow(dead_code)]
mod highlighting_inner {
    include!("../crates/sorng-ssh/src/ssh/highlighting_cmds.rs");
}
#[allow(dead_code)]
mod proxy_command_inner {
    include!("../crates/sorng-ssh/src/ssh/proxy_command_cmds.rs");
}
#[allow(dead_code)]
mod recording_inner {
    include!("../crates/sorng-ssh/src/ssh/recording_cmds.rs");
}
#[allow(dead_code)]
mod tunnels_inner {
    include!("../crates/sorng-ssh/src/ssh/tunnels_cmds.rs");
}
#[allow(dead_code)]
mod x11_inner {
    include!("../crates/sorng-ssh/src/ssh/x11_cmds.rs");
}
#[cfg(feature = "script-engine")]
#[allow(dead_code)]
mod script_inner {
    include!("../crates/sorng-ssh/src/script_cmds.rs");
}
#[cfg(not(feature = "script-engine"))]
#[allow(dead_code)]
mod script_stub_inner {
    include!("../crates/sorng-ssh/src/script_stub_cmds.rs");
}
#[allow(dead_code)]
mod ssh3_inner {
    include!("../crates/sorng-ssh/src/ssh3_cmds.rs");
}

// ── Re-exports ─────────────────────────────────────────────────────────
pub(crate) use automation_inner::*;
pub(crate) use commands_inner::*;
pub(crate) use diagnostics_inner::*;
pub(crate) use highlighting_inner::*;
pub(crate) use proxy_command_inner::*;
pub(crate) use recording_inner::*;
#[cfg(feature = "script-engine")]
pub(crate) use script_inner::*;
#[cfg(not(feature = "script-engine"))]
pub(crate) use script_stub_inner::*;
pub(crate) use ssh3_inner::*;
pub(crate) use tunnels_inner::*;
pub(crate) use x11_inner::*;
