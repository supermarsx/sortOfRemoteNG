mod service {
    pub use crate::vnc::service::*;
}

mod types {
    pub use crate::vnc::types::*;
}

mod session {
    pub use crate::vnc::session::{frame_to_event, SessionEvent};
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-vnc/src/vnc/commands.rs");
}

pub(crate) use inner::*;

#[derive(serde::Serialize)]
pub struct VncFrontendPoll {
    stats: types::VncStats,
    events: Vec<VncFrontendEvent>,
}

#[derive(serde::Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum VncFrontendEvent {
    Frame {
        frame: types::VncFrameEvent,
    },
    Bell,
    Clipboard {
        text: String,
    },
    Resize {
        width: u16,
        height: u16,
    },
    StateChanged {
        state: String,
        message: String,
    },
    Disconnected {
        reason: Option<String>,
    },
    Connected {
        width: u16,
        height: u16,
        server_name: String,
        protocol_version: String,
        security_type: String,
    },
    CursorChanged,
}

/// Preserve the registered stats command name while extending its app-facing
/// response with a bounded drain of native session events. The underlying VNC
/// delivery state is bounded and coalesced; the app-facing drain is clamped to
/// two events here so control and framebuffer progress remain balanced.
#[tauri::command]
pub async fn get_vnc_session_stats(
    state: tauri::State<'_, service::VncServiceState>,
    session_id: String,
    max_events: Option<usize>,
) -> Result<VncFrontendPoll, String> {
    let (stats, drained) = state
        .poll_session_stats_and_events(&session_id, max_events.unwrap_or(2).clamp(1, 2))
        .await
        .map_err(|error| error.message)?;
    let mut events = Vec::with_capacity(drained.len());
    for event in drained {
        events.push(match event {
            session::SessionEvent::Frame(rect) => VncFrontendEvent::Frame {
                frame: session::frame_to_event(&session_id, rect).map_err(|error| error.message)?,
            },
            session::SessionEvent::Bell => VncFrontendEvent::Bell,
            session::SessionEvent::Clipboard(text) => VncFrontendEvent::Clipboard { text },
            session::SessionEvent::Resize { width, height } => {
                VncFrontendEvent::Resize { width, height }
            }
            session::SessionEvent::StateChanged(event) => VncFrontendEvent::StateChanged {
                state: event.state,
                message: event.message,
            },
            session::SessionEvent::Disconnected(reason) => {
                VncFrontendEvent::Disconnected { reason }
            }
            session::SessionEvent::Connected {
                width,
                height,
                pixel_format: _,
                server_name,
                protocol_version,
                security_type,
            } => VncFrontendEvent::Connected {
                width,
                height,
                server_name,
                protocol_version,
                security_type,
            },
            session::SessionEvent::Cursor { .. } => VncFrontendEvent::CursorChanged,
        });
    }
    Ok(VncFrontendPoll { stats, events })
}
