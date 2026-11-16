//! Live-session registry row for VNC (no credentials, no framebuffer data).
//!
//! VNC viewers re-attach through the existing renderer-activity epoch
//! (`set_vnc_session_activity`): claiming a newer generation with
//! `active: true` creates a new delivery epoch and queues one non-incremental
//! full-framebuffer refresh, so no separate attach command is needed.

use sorng_core::session_resilience::{LiveSessionDescriptor, OrphanStatus};

use super::types::VncSession;

pub fn live_descriptor(info: &VncSession) -> LiveSessionDescriptor {
    LiveSessionDescriptor {
        protocol: "vnc".to_string(),
        backend_session_id: info.id.clone(),
        frontend_session_id: None,
        connection_id: None,
        title: info
            .label
            .clone()
            .or_else(|| info.server_name.clone())
            .unwrap_or_else(|| info.host.clone()),
        target: info.host.clone(),
        port: Some(info.port),
        username: info.username.clone(),
        state: if info.connected {
            "connected"
        } else {
            "disconnected"
        }
        .to_string(),
        viewer_attached: None,
        created_at: Some(info.connected_at.clone()),
        last_activity_at: Some(info.last_activity.clone()),
        buffer: None,
        orphan: OrphanStatus::default(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn info() -> VncSession {
        VncSession {
            id: "v1".into(),
            host: "10.0.0.5".into(),
            port: 5900,
            connected: true,
            username: Some("root".into()),
            label: None,
            protocol_version: Some("3.8".into()),
            security_type: None,
            server_name: Some("desk".into()),
            framebuffer_width: 800,
            framebuffer_height: 600,
            pixel_format: String::new(),
            connected_at: "2026-01-01T00:00:00Z".into(),
            last_activity: "2026-01-01T00:00:01Z".into(),
            frame_count: 4,
            bytes_received: 1,
            bytes_sent: 2,
            view_only: false,
        }
    }

    #[test]
    fn describes_a_connected_session_without_payload() {
        let row = live_descriptor(&info());
        assert_eq!(row.protocol, "vnc");
        assert_eq!(row.backend_session_id, "v1");
        assert_eq!(row.title, "desk");
        assert_eq!(row.target, "10.0.0.5");
        assert_eq!(row.port, Some(5900));
        assert_eq!(row.state, "connected");
        assert!(row.buffer.is_none());
    }

    #[test]
    fn disconnected_session_is_reported_disconnected() {
        let mut i = info();
        i.connected = false;
        assert_eq!(live_descriptor(&i).state, "disconnected");
    }
}
