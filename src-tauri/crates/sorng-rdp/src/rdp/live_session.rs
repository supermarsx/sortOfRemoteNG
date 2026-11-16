//! Live-session registry row for RDP.
//!
//! RDP viewers re-attach with `attach_rdp_session`, which already queues a
//! full-desktop sync for the new frame channel (a replacement viewer receives
//! its own sequence from row zero). `detach_rdp_session` leaves the session
//! running headless. `viewer_attached` here mirrors the backend flag, which a
//! webview reload cannot clear on its own; treat the frontend heartbeat claim
//! as the authority for "someone is watching".

use sorng_core::session_resilience::{LiveSessionDescriptor, OrphanStatus};

use super::types::RdpSession;

pub fn live_descriptor(info: &RdpSession) -> LiveSessionDescriptor {
    LiveSessionDescriptor {
        protocol: "rdp".to_string(),
        backend_session_id: info.id.clone(),
        frontend_session_id: info.frontend_session_id.clone(),
        connection_id: info.connection_id.clone(),
        title: format!("{}@{}", info.username, info.host),
        target: info.host.clone(),
        port: Some(info.port),
        username: Some(info.username.clone()),
        state: if !info.connected {
            "disconnected"
        } else if info.viewer_attached {
            "connected"
        } else {
            "detached"
        }
        .to_string(),
        viewer_attached: Some(info.viewer_attached),
        created_at: None,
        last_activity_at: None,
        buffer: None,
        orphan: OrphanStatus::default(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session(connected: bool, attached: bool) -> RdpSession {
        RdpSession {
            id: "r1".into(),
            connection_id: Some("conn-1".into()),
            frontend_session_id: Some("tab-3".into()),
            host: "srv".into(),
            port: 3389,
            target_identity: None,
            username: "admin".into(),
            connected,
            desktop_width: 1280,
            desktop_height: 720,
            server_cert_fingerprint: None,
            viewer_attached: attached,
            reconnect_count: 0,
            reconnecting: false,
        }
    }

    #[test]
    fn attached_detached_and_dead_states() {
        assert_eq!(live_descriptor(&session(true, true)).state, "connected");
        assert_eq!(live_descriptor(&session(true, false)).state, "detached");
        assert_eq!(live_descriptor(&session(false, true)).state, "disconnected");
    }

    #[test]
    fn carries_the_tab_binding_the_backend_already_stores() {
        let row = live_descriptor(&session(true, false));
        assert_eq!(row.frontend_session_id.as_deref(), Some("tab-3"));
        assert_eq!(row.connection_id.as_deref(), Some("conn-1"));
        assert_eq!(row.viewer_attached, Some(false));
    }
}
