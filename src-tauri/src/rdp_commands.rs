// App-layer wrapper: compiles RDP command files (which use #[tauri::command])
// in the context of the app crate where tauri is available.

// Shim modules so `super::commands::*` and `super::diagnostics::*` resolve
// when the _cmds.rs files are included via include!().
mod commands {
    pub use crate::rdp::commands::*;
    pub use crate::rdp::frame_channel::{DynFrameChannel, FrameChannel};
    pub use sorng_core::events::DynEventEmitter;
    // Tauri types used unqualified in commands_cmds.rs
    pub use tauri::AppHandle;
    pub use tauri::ipc::{Channel, InvokeResponseBody};
    pub use tauri::Manager;

    /// Adapter: wraps a Tauri `Channel<InvokeResponseBody>` as a `FrameChannel`.
    pub struct TauriFrameChannel(pub Channel<InvokeResponseBody>);

    impl FrameChannel for TauriFrameChannel {
        fn send_raw(&self, data: Vec<u8>) -> Result<(), String> {
            self.0
                .send(InvokeResponseBody::Raw(data))
                .map_err(|e| e.to_string())
        }
    }

    /// Convert an `AppHandle` into a `DynEventEmitter`.
    pub fn app_handle_to_emitter(handle: &AppHandle) -> DynEventEmitter {
        crate::event_bridge::from_app_handle(handle)
    }
}

mod diagnostics {
    pub use crate::rdp::diagnostics::*;
    pub use crate::rdp::settings::{RdpSettingsPayload, ResolvedSettings};
    pub use crate::rdp::RdpServiceState;
    pub use sorng_core::diagnostics::DiagnosticReport;
}

#[allow(dead_code)]
mod commands_inner {
    include!("../crates/sorng-rdp/src/rdp/commands_cmds.rs");
}

#[allow(dead_code)]
mod diagnostics_inner {
    include!("../crates/sorng-rdp/src/rdp/diagnostics_cmds.rs");
}

pub(crate) use commands_inner::*;
pub(crate) use diagnostics_inner::*;
