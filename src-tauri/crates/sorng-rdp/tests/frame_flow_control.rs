//! Integration coverage for the frame-flow-control module (e2 + L2). These
//! tests exercise the public `FrameFlowController`/`FrameFlowBudget`/
//! `FrameFlowSnapshot` surface: high/low watermark backpressure with
//! hysteresis, supersedable-frame disposition (deliver vs. coalesce),
//! queue/drop/coalesce accounting, and the projection into the
//! `FrameFlowSummary` that L2 persists (coalesced/render telemetry rides on the
//! lifecycle snapshot). Deterministic and host-independent — no live RDP server.

use sorng_rdp::rdp::frame_flow_control::{
    FrameDisposition, FrameFlowBudget, FrameFlowController, FrameFlowSnapshot, FramePressureState,
};
use sorng_rdp::rdp::session_state::FrameFlowSummary;

/// A fresh controller starts healthy and delivers supersedable frames.
#[test]
fn controller_starts_healthy_and_delivers() {
    let controller = FrameFlowController::default();
    assert_eq!(controller.pressure_state(), FramePressureState::Healthy);
    assert_eq!(
        controller.disposition_for_supersedable_frame(),
        FrameDisposition::Deliver
    );
}

/// Backpressure raises only at/above the high watermark and clears only at/below
/// the low watermark — the hysteresis band prevents flapping between the two.
#[test]
fn watermarks_have_hysteresis_band() {
    let mut controller = FrameFlowController::new(FrameFlowBudget::new(6, 2));

    // Below high watermark: stay healthy.
    assert_eq!(controller.observe_queue_depth(5), FramePressureState::Healthy);
    // At high watermark: enter backpressure.
    assert_eq!(
        controller.observe_queue_depth(6),
        FramePressureState::Backpressured
    );
    // Between low and high while already backpressured: stay backpressured.
    assert_eq!(
        controller.observe_queue_depth(3),
        FramePressureState::Backpressured
    );
    // At low watermark: recover to healthy.
    assert_eq!(controller.observe_queue_depth(2), FramePressureState::Healthy);
    // Just above low watermark from healthy: stay healthy (no flap).
    assert_eq!(controller.observe_queue_depth(5), FramePressureState::Healthy);
}

/// Supersedable frames are delivered while healthy and coalesced under
/// backpressure — this is the queue/drop/coalesce decision the runner makes per
/// frame.
#[test]
fn supersedable_frames_coalesce_only_under_pressure() {
    let mut controller = FrameFlowController::new(FrameFlowBudget::new(3, 1));

    assert_eq!(
        controller.disposition_for_supersedable_frame(),
        FrameDisposition::Deliver
    );

    controller.observe_queue_depth(3); // -> backpressured
    assert_eq!(
        controller.disposition_for_supersedable_frame(),
        FrameDisposition::Coalesce
    );

    controller.observe_queue_depth(1); // -> healthy
    assert_eq!(
        controller.disposition_for_supersedable_frame(),
        FrameDisposition::Deliver
    );
}

/// Delivered/dropped/coalesced counters accumulate via the record_* hooks and
/// the snapshot reflects the running totals plus the latest observed queue depth.
#[test]
fn delivery_counters_accumulate_into_snapshot() {
    let mut controller = FrameFlowController::new(FrameFlowBudget::new(4, 1));

    controller.observe_queue_depth(2);
    for _ in 0..10 {
        controller.record_delivered();
    }
    for _ in 0..3 {
        controller.record_dropped();
    }
    for _ in 0..7 {
        controller.record_coalesced();
    }

    let snapshot = controller.snapshot();
    assert_eq!(snapshot.queued_frames, 2);
    assert_eq!(snapshot.delivered_frames, 10);
    assert_eq!(snapshot.dropped_frames, 3);
    assert_eq!(snapshot.coalesced_frames, 7);
    assert_eq!(snapshot.pressure_state, FramePressureState::Healthy);
}

/// Accounting-only: recording deliveries/drops/coalesces never changes the
/// pressure state — only observed queue depth drives backpressure.
#[test]
fn record_calls_do_not_change_pressure_state() {
    let mut controller = FrameFlowController::new(FrameFlowBudget::new(2, 0));
    controller.observe_queue_depth(2); // backpressured
    assert_eq!(controller.pressure_state(), FramePressureState::Backpressured);

    controller.record_delivered();
    controller.record_dropped();
    controller.record_coalesced();

    assert_eq!(controller.pressure_state(), FramePressureState::Backpressured);
}

/// The snapshot projects into the `FrameFlowSummary` that lands on the lifecycle
/// snapshot. The L2 coalesced field is threaded through; render telemetry is
/// `None` here because the controller does not measure render latency (it is
/// supplied by the frontend telemetry path).
#[test]
fn snapshot_projects_into_lifecycle_frame_flow_summary() {
    let mut controller = FrameFlowController::default();
    controller.observe_queue_depth(3);
    controller.record_delivered();
    controller.record_delivered();
    controller.record_dropped();
    controller.record_coalesced();
    controller.record_coalesced();

    let summary: FrameFlowSummary = controller.snapshot().summary();

    assert_eq!(summary.queued_frames, 3);
    assert_eq!(summary.delivered_frames, 2);
    assert_eq!(summary.dropped_frames, 1);
    assert_eq!(summary.coalesced_frames, 2);
    assert_eq!(summary.average_render_ms, None);
}

/// The frame-flow snapshot serializes with the camelCase wire keys (including
/// `coalescedFrames` from L2) the frontend consumes.
#[test]
fn snapshot_serializes_with_coalesced_wire_key() {
    let mut controller = FrameFlowController::default();
    controller.observe_queue_depth(1);
    controller.record_coalesced();

    let snapshot: FrameFlowSnapshot = controller.snapshot();
    let encoded = serde_json::to_string(&snapshot).unwrap();

    assert!(encoded.contains("queuedFrames"));
    assert!(encoded.contains("deliveredFrames"));
    assert!(encoded.contains("droppedFrames"));
    assert!(encoded.contains("coalescedFrames"));
    assert!(encoded.contains("pressureState"));
}

/// A budget with equal high/low watermarks collapses the hysteresis band: at the
/// threshold the raise and clear conditions are both satisfiable, so a steady
/// queue depth sitting exactly on the watermark flaps each observation. This
/// documents why the default budget keeps a real gap (6/2) between the marks.
#[test]
fn equal_watermarks_collapse_the_hysteresis_band() {
    let mut controller = FrameFlowController::new(FrameFlowBudget::new(4, 4));

    // Below threshold: healthy.
    assert_eq!(controller.observe_queue_depth(3), FramePressureState::Healthy);
    // At threshold from healthy: raise (4 >= high 4).
    assert_eq!(
        controller.observe_queue_depth(4),
        FramePressureState::Backpressured
    );
    // Still at threshold from backpressured: clears (4 <= low 4) — flap.
    assert_eq!(controller.observe_queue_depth(4), FramePressureState::Healthy);
    // And raises again on the next identical observation.
    assert_eq!(
        controller.observe_queue_depth(4),
        FramePressureState::Backpressured
    );
    // Dropping below the threshold clears and stays clear.
    assert_eq!(controller.observe_queue_depth(3), FramePressureState::Healthy);
    assert_eq!(controller.observe_queue_depth(3), FramePressureState::Healthy);
}

/// A low watermark exceeding the high watermark is rejected at construction —
/// the budget invariant is enforced so the controller can never be built with an
/// impossible hysteresis band.
#[test]
#[should_panic(expected = "low watermark must not exceed high watermark")]
fn budget_rejects_low_above_high() {
    let _ = FrameFlowBudget::new(2, 5);
}

/// A zero high watermark is rejected — a controller must always have a positive
/// backpressure threshold.
#[test]
#[should_panic(expected = "high watermark must be positive")]
fn budget_rejects_zero_high_watermark() {
    let _ = FrameFlowBudget::new(0, 0);
}
