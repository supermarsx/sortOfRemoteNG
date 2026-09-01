// App-layer wrapper: compiles RDP command files (which use #[tauri::command])
// in the context of the app crate where tauri is available.

// Shim modules so `super::commands::*` and `super::diagnostics::*` resolve
// when the _cmds.rs files are included via include!().
mod session_runner {
    pub use crate::rdp::session_runner::{RDP_LOG_CHANNEL_CAPACITY, RDP_LOG_DRAIN_BATCH_SIZE};
}

mod commands {
    pub use crate::rdp::commands::*;
    pub use crate::rdp::frame_channel::{
        DynFrameChannel, FrameChannel, FrameDeliveryAcknowledgement, FrameDeliveryCredits,
        FrameDeliveryTransport,
    };
    pub use sorng_core::events::DynEventEmitter;
    // Tauri types used unqualified in commands_cmds.rs
    pub use tauri::ipc::{Channel, InvokeResponseBody};
    pub use tauri::AppHandle;
    pub use tauri::Manager;

    /// Adapter: wraps a Tauri `Channel<InvokeResponseBody>` as a credit-bound
    /// `FrameChannel`. Credits stay reserved until the JavaScript callback
    /// acknowledges this channel ID, bounding Tauri's raw body cache.
    pub struct TauriFrameChannel {
        channel: Channel<InvokeResponseBody>,
        delivery: FrameDeliveryTransport,
    }

    impl TauriFrameChannel {
        pub fn new(
            channel: Channel<InvokeResponseBody>,
            credits: std::sync::Arc<FrameDeliveryCredits>,
        ) -> Self {
            let delivery = FrameDeliveryTransport::new(channel.id(), credits);
            Self { channel, delivery }
        }
    }

    impl FrameChannel for TauriFrameChannel {
        fn send_raw(&self, data: Vec<u8>) -> Result<(), String> {
            let nal_magic = NAL_MAGIC.to_le_bytes();
            let nal_payload = data.get(..nal_magic.len()) == Some(nal_magic.as_slice());
            let prepared = match self.delivery.prepare(data.len()) {
                Ok(prepared) => prepared,
                Err(error) => {
                    let _ = self.delivery.record_dropped_payloads(1, nal_payload);
                    return Err(error);
                }
            };
            match self.channel.send(InvokeResponseBody::Raw(data)) {
                Ok(()) => {
                    prepared.mark_sent();
                    Ok(())
                }
                Err(error) => {
                    let delivery_id = prepared.delivery_id();
                    prepared.mark_send_failed();
                    Err(format!(
                        "RDP frame channel {} delivery {delivery_id} failed after its raw body may have entered Tauri's cache; the channel is permanently closed: {error}",
                        self.channel.id()
                    ))
                }
            }
        }

        fn can_send_payload(&self, bytes: usize) -> bool {
            self.delivery.has_capacity_for(bytes)
        }

        fn record_delivery_drop(&self, count: u64, nal_chain_broken: bool) -> Result<(), String> {
            self.delivery
                .record_dropped_payloads(count, nal_chain_broken)
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
