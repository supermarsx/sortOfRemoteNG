//! Integration coverage for the lifecycle-summary projection: that the channel
//! registry summary and the frame-flow summary both land in the emitted
//! lifecycle snapshot shape, that the snapshot serializes with the wire keys the
//! frontend consumes, and that the projection stays secret-safe. This stitches
//! the three diagnostics sources (virtual_channels e1, frame_flow_control e2/L2,
//! lifecycle state machine) through the public `RdpSessionStats` /
//! `LifecycleStateMachine` surfaces the runner uses. Deterministic and
//! host-independent — no live RDP server.

use sorng_rdp::rdp::frame_flow_control::FrameFlowController;
use sorng_rdp::rdp::session_state::{
    ActiveSubstate, ChannelSummary, FailureClass, FrameFlowSummary, LifecycleStateMachine,
    ReconnectContext, SessionState, TerminationReason,
};
use sorng_rdp::rdp::stats::RdpSessionStats;
use sorng_rdp::rdp::virtual_channels::{
    VirtualChannelDescriptor, VirtualChannelKind, VirtualChannelPriority, VirtualChannelRegistry,
};

fn descriptor(name: &str, enabled: bool) -> VirtualChannelDescriptor {
    VirtualChannelDescriptor::new(
        name,
        VirtualChannelKind::Static,
        VirtualChannelPriority::Normal,
        enabled,
    )
}

/// The full diagnostics pipeline: a channel registry summary and a frame-flow
/// controller snapshot are pushed onto `RdpSessionStats`, and the emitted
/// lifecycle snapshot carries both verbatim (delivered_frames is taken from the
/// live frame counter, which is zero here).
#[test]
fn stats_lifecycle_snapshot_carries_channel_and_frame_telemetry() {
    let mut registry = VirtualChannelRegistry::new();
    registry.register(descriptor("rdpdr", true).ready()).unwrap();
    registry.register(descriptor("rdpsnd", true).ready()).unwrap();
    registry.register(descriptor("cliprdr", true)).unwrap();
    registry
        .register(descriptor("audin", true).faulted("channel_fault"))
        .unwrap();

    let mut controller = FrameFlowController::default();
    controller.observe_queue_depth(3);
    controller.record_dropped();
    controller.record_coalesced();
    controller.record_coalesced();

    let stats = RdpSessionStats::new();
    stats.set_channel_summary(registry.summary());
    let mut frame_summary = controller.snapshot().summary();
    frame_summary.average_render_ms = Some(4.5);
    stats.set_frame_flow_summary(frame_summary);

    let snapshot = stats.lifecycle_snapshot("session-1");

    // Channel telemetry round-trips into the snapshot.
    assert_eq!(
        snapshot.channel_summary,
        ChannelSummary {
            enabled_count: 4,
            ready_count: 2,
            failed_count: 1,
        }
    );
    // Frame telemetry round-trips, including L2 coalesced + render fields.
    assert_eq!(snapshot.frame_flow_summary.queued_frames, 3);
    assert_eq!(snapshot.frame_flow_summary.dropped_frames, 1);
    assert_eq!(snapshot.frame_flow_summary.coalesced_frames, 2);
    assert_eq!(snapshot.frame_flow_summary.average_render_ms, Some(4.5));
    assert_eq!(snapshot.session_id, "session-1");
}

/// `lifecycle_snapshot` overrides `delivered_frames` with the live frame counter
/// so the persisted summary always reflects real throughput, not a stale set
/// value.
#[test]
fn delivered_frames_reflects_live_frame_counter() {
    let stats = RdpSessionStats::new();
    // Seed a stale delivered count via the frame-flow summary.
    stats.set_frame_flow_summary(FrameFlowSummary {
        queued_frames: 1,
        delivered_frames: 999,
        dropped_frames: 0,
        coalesced_frames: 0,
        average_render_ms: None,
    });

    for _ in 0..12 {
        stats.record_frame();
    }

    let snapshot = stats.lifecycle_snapshot("session-2");
    assert_eq!(snapshot.frame_flow_summary.delivered_frames, 12);
    // The non-overridden fields are preserved.
    assert_eq!(snapshot.frame_flow_summary.queued_frames, 1);
}

/// A defaulted snapshot (no channel/frame telemetry set) projects zeroed
/// summaries rather than panicking or omitting them — the panel always has a
/// shape to render.
#[test]
fn default_snapshot_has_zeroed_summaries() {
    let stats = RdpSessionStats::new();
    let snapshot = stats.lifecycle_snapshot("session-3");

    assert_eq!(snapshot.channel_summary, ChannelSummary::default());
    assert_eq!(snapshot.frame_flow_summary.queued_frames, 0);
    assert_eq!(snapshot.frame_flow_summary.coalesced_frames, 0);
    assert_eq!(snapshot.frame_flow_summary.delivered_frames, 0);
    assert_eq!(snapshot.frame_flow_summary.average_render_ms, None);
}

/// The emitted snapshot serializes with the camelCase wire keys the frontend
/// lifecycle event consumes, nesting both telemetry summaries.
#[test]
fn snapshot_serializes_with_lifecycle_wire_keys() {
    let mut machine = LifecycleStateMachine::with_state(
        "session-4",
        SessionState::Active(ActiveSubstate::Running),
        0,
    );
    machine.set_channel_summary(ChannelSummary {
        enabled_count: 3,
        ready_count: 3,
        failed_count: 0,
    });
    machine.set_frame_flow_summary(FrameFlowSummary {
        queued_frames: 2,
        delivered_frames: 100,
        dropped_frames: 4,
        coalesced_frames: 6,
        average_render_ms: Some(3.25),
    });

    let encoded = serde_json::to_string(&machine.snapshot()).unwrap();

    assert!(encoded.contains("sessionId"));
    assert!(encoded.contains("channelSummary"));
    assert!(encoded.contains("enabledCount"));
    assert!(encoded.contains("frameFlowSummary"));
    assert!(encoded.contains("coalescedFrames"));
    assert!(encoded.contains("averageRenderMs"));
    assert!(encoded.contains("transitionCount"));
    assert!(encoded.contains("\"state\":\"active\""));
}

/// `average_render_ms` is omitted from the wire form when absent (additive,
/// backward-compatible) and present when set.
#[test]
fn average_render_ms_is_omitted_when_absent() {
    let mut machine = LifecycleStateMachine::new("session-5");
    machine.set_frame_flow_summary(FrameFlowSummary {
        queued_frames: 0,
        delivered_frames: 0,
        dropped_frames: 0,
        coalesced_frames: 0,
        average_render_ms: None,
    });
    let absent = serde_json::to_string(&machine.snapshot()).unwrap();
    assert!(!absent.contains("averageRenderMs"));

    machine.set_frame_flow_summary(FrameFlowSummary {
        average_render_ms: Some(2.0),
        ..Default::default()
    });
    let present = serde_json::to_string(&machine.snapshot()).unwrap();
    assert!(present.contains("averageRenderMs"));
}

/// A channel fault drives the lifecycle into the isolated "channels_recovering"
/// active substate and stamps the failure class onto the snapshot, while the
/// merged channel summary still reports the faulted channel — the projection the
/// diagnostics panel renders.
#[test]
fn channel_fault_projects_recovering_substate_and_failure_class() {
    let mut machine = LifecycleStateMachine::with_state(
        "session-6",
        SessionState::Active(ActiveSubstate::Running),
        0,
    );

    let mut registry = VirtualChannelRegistry::new();
    registry.register(descriptor("rdpdr", true).ready()).unwrap();
    registry
        .register(descriptor("cliprdr", true).faulted("channel_fault"))
        .unwrap();
    machine.set_channel_summary(registry.summary());

    let outcome = machine
        .transition(
            sorng_rdp::rdp::session_state::SessionEvent::ChannelFault {
                channel: "cliprdr".to_string(),
            },
            10,
        )
        .unwrap();

    assert_eq!(outcome.emitted_snapshot.state, "active");
    assert_eq!(
        outcome.emitted_snapshot.active_substate.as_deref(),
        Some("channels_recovering")
    );
    assert_eq!(
        outcome.emitted_snapshot.last_failure_class.as_deref(),
        Some("channel_fault")
    );
    assert_eq!(outcome.emitted_snapshot.channel_summary.failed_count, 1);
}

/// Reconnect attempt and the terminal failure class are projected into the
/// snapshot from the state itself — the diagnostics surface shows recovery
/// progress without the runner having to set them explicitly.
#[test]
fn snapshot_projects_reconnect_attempt_and_failure_class() {
    let reconnecting = LifecycleStateMachine::with_state(
        "session-7",
        SessionState::Reconnecting(ReconnectContext::network_lost(2, 0)),
        0,
    );
    assert_eq!(reconnecting.snapshot().reconnect_attempt, 2);

    let failed = LifecycleStateMachine::with_state(
        "session-8",
        SessionState::Terminated(TerminationReason::Failed(FailureClass::TrustRejected)),
        0,
    );
    let snapshot = failed.snapshot();
    assert_eq!(snapshot.state, "terminated");
    assert_eq!(snapshot.last_failure_class.as_deref(), Some("trust_rejected"));
}

/// The emitted lifecycle snapshot — even when carrying channel/frame telemetry —
/// never serializes credentials, hostnames, drive paths, or PDU bytes. Bounded,
/// numeric-only diagnostics.
#[test]
fn lifecycle_snapshot_is_secret_safe() {
    let mut machine = LifecycleStateMachine::with_state(
        "session-9",
        SessionState::Active(ActiveSubstate::Running),
        0,
    );
    machine.set_channel_summary(ChannelSummary {
        enabled_count: 4,
        ready_count: 3,
        failed_count: 1,
    });
    machine.set_frame_flow_summary(FrameFlowSummary {
        queued_frames: 2,
        delivered_frames: 500,
        dropped_frames: 9,
        coalesced_frames: 12,
        average_render_ms: Some(5.5),
    });

    let encoded = serde_json::to_string(&machine.snapshot()).unwrap();

    for marker in [
        "password",
        "username",
        "domain",
        "C:\\\\",
        "pdu",
        "certificate",
        "host",
    ] {
        assert!(
            !encoded.contains(marker),
            "secret marker {marker:?} leaked into lifecycle snapshot: {encoded}"
        );
    }
}
