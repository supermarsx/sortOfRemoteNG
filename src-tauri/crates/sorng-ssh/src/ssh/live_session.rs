//! Live-session registry row for SSH (no credentials, no terminal payload).

use sorng_core::session_resilience::{LiveSessionDescriptor, OrphanStatus};

use super::output_state::terminal_buffer_range;
use super::types::SshSessionInfo;

/// Describe one SSH session for the cross-protocol live-session registry. The
/// replay buffer range comes from the existing bounded terminal buffer.
pub fn live_descriptor(info: &SshSessionInfo) -> LiveSessionDescriptor {
    LiveSessionDescriptor {
        protocol: "ssh".to_string(),
        backend_session_id: info.id.clone(),
        frontend_session_id: None,
        connection_id: None,
        title: format!("{}@{}", info.config.username, info.config.host),
        target: info.config.host.clone(),
        port: Some(info.config.port),
        username: Some(info.config.username.clone()),
        state: if info.is_alive {
            "connected"
        } else {
            "disconnected"
        }
        .to_string(),
        viewer_attached: None,
        created_at: Some(info.connected_at.to_rfc3339()),
        last_activity_at: Some(info.last_activity.to_rfc3339()),
        buffer: terminal_buffer_range(&info.id).ok().flatten(),
        orphan: OrphanStatus::default(),
    }
}

#[cfg(test)]
mod tests {
    use super::super::output_state::{append_terminal_output, cleanup_session_output_state};
    use super::*;

    #[test]
    fn buffer_range_tracks_appends_and_vanishes_with_the_session() {
        let id = "live-session-range-test";
        assert!(terminal_buffer_range(id).expect("lock").is_none());
        append_terminal_output(id, "hello").expect("append");
        append_terminal_output(id, "world").expect("append");
        let range = terminal_buffer_range(id).expect("lock").expect("range");
        assert_eq!((range.sequence_start, range.sequence_end), (0, 10));
        assert_eq!(range.dropped_bytes, 0);
        cleanup_session_output_state(id).expect("cleanup");
        assert!(terminal_buffer_range(id).expect("lock").is_none());
    }
}
