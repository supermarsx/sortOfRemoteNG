//! Integration coverage for the RDPGFX diagnostics bridge (t31).
//!
//! Mirrors the runner's behaviour without a live RDP server: drive a
//! `GfxProcessor` through its public DVC surface and observe the live
//! `SharedGfxDiagnostics` handle the runner clones before the processor is
//! moved into DRDYNVC. Asserts the Tier-A one-channel ready/fault view merges
//! into a lifecycle-style `ChannelSummary` exactly like AUDIN, and that the
//! Tier-B snapshot (codec/cap/surfaces/frames/acks/errors) round-trips through
//! the camelCase wire keys the stats event uses. Deterministic / host-independent.

use std::sync::mpsc;

use sorng_rdp::gfx::pdu::{GfxCmdId, CAPVERSION_10, CAPVERSION_101, RDPGFX_HEADER_SIZE};
use sorng_rdp::gfx::processor::{GfxDvcProcessor, GfxOutput, GfxProcessor};
use sorng_rdp::h264::H264DecoderPreference;
use sorng_rdp::rdp::session_state::ChannelSummary;

fn new_processor() -> (GfxProcessor, mpsc::Receiver<GfxOutput>) {
    let (tx, rx) = mpsc::channel::<GfxOutput>();
    let proc = GfxProcessor::new(H264DecoderPreference::Auto, tx, false);
    (proc, rx)
}

fn gfx_pdu(cmd_id: GfxCmdId, body: &[u8]) -> Vec<u8> {
    let pdu_len = (RDPGFX_HEADER_SIZE + body.len()) as u32;
    let mut buf = Vec::new();
    buf.extend_from_slice(&(cmd_id as u16).to_le_bytes());
    buf.extend_from_slice(&0u16.to_le_bytes());
    buf.extend_from_slice(&pdu_len.to_le_bytes());
    buf.extend_from_slice(body);
    buf
}

fn caps_confirm_body(version: u32) -> Vec<u8> {
    let mut body = Vec::new();
    body.extend_from_slice(&version.to_le_bytes());
    body.extend_from_slice(&4u32.to_le_bytes());
    body.extend_from_slice(&0u32.to_le_bytes());
    body
}

/// Replicate the runner's `merge_channel_summary` (private to session_runner.rs):
/// summaries add componentwise into the lifecycle channel summary.
fn merge(into: &mut ChannelSummary, add: &ChannelSummary) {
    into.enabled_count += add.enabled_count;
    into.ready_count += add.ready_count;
    into.failed_count += add.failed_count;
}

#[test]
fn gfx_ready_merges_one_enabled_and_ready_channel() {
    let (mut proc, _rx) = new_processor();
    let handle = proc.shared_diagnostics();

    proc.start(7).expect("gfx start");
    proc.process(7, &gfx_pdu(GfxCmdId::CapsConfirm, &caps_confirm_body(CAPVERSION_10)))
        .expect("caps confirm");

    // Runner-side: merge the GFX one-channel summary into the lifecycle summary,
    // alongside (here, on top of) other channels.
    let mut lifecycle = ChannelSummary {
        enabled_count: 2,
        ready_count: 2,
        failed_count: 0,
    };
    let gfx_summary = handle.lock().unwrap().summary.clone();
    merge(&mut lifecycle, &gfx_summary);

    // GFX added exactly one enabled + one ready channel; nothing failed.
    assert_eq!(lifecycle.enabled_count, 3);
    assert_eq!(lifecycle.ready_count, 3);
    assert_eq!(lifecycle.failed_count, 0);
}

#[test]
fn gfx_fault_merges_one_failed_channel() {
    let (mut proc, _rx) = new_processor();
    let handle = proc.shared_diagnostics();

    // A truncated PDU header is a structural fault.
    let mut bad = Vec::new();
    bad.extend_from_slice(&(GfxCmdId::CapsConfirm as u16).to_le_bytes());
    bad.extend_from_slice(&0u16.to_le_bytes());
    bad.extend_from_slice(&0xFFFF_FFFFu32.to_le_bytes());
    bad.extend_from_slice(&[0u8; 4]);
    proc.process(7, &bad).expect("process bad pdu");

    let mut lifecycle = ChannelSummary::default();
    merge(&mut lifecycle, &handle.lock().unwrap().summary);

    assert_eq!(lifecycle.enabled_count, 1);
    assert_eq!(lifecycle.ready_count, 0);
    assert_eq!(lifecycle.failed_count, 1);
}

#[test]
fn gfx_tier_b_snapshot_round_trips_through_wire_keys() {
    let (mut proc, _rx) = new_processor();
    let handle = proc.shared_diagnostics();

    proc.start(7).expect("start");
    proc.process(7, &gfx_pdu(GfxCmdId::CapsConfirm, &caps_confirm_body(CAPVERSION_101)))
        .expect("caps");

    // Create a surface so surfacesActive is non-zero.
    let mut cs = Vec::new();
    cs.extend_from_slice(&1u16.to_le_bytes());
    cs.extend_from_slice(&16u16.to_le_bytes());
    cs.extend_from_slice(&16u16.to_le_bytes());
    cs.push(0x20);
    proc.process(7, &gfx_pdu(GfxCmdId::CreateSurface, &cs))
        .expect("create surface");

    let snapshot = handle.lock().unwrap().clone();
    assert_eq!(snapshot.codec, Some("AVC444"));
    assert_eq!(snapshot.cap_version, Some(CAPVERSION_101));
    assert_eq!(snapshot.surfaces_active, 1);
    assert_eq!(snapshot.summary.ready_count, 1);

    let json = serde_json::to_string(&snapshot).unwrap();
    for key in [
        "summary",
        "capVersion",
        "codec",
        "surfacesActive",
        "framesDecoded",
        "frameAcksSent",
        "pipelineErrors",
        "nalPassthrough",
    ] {
        assert!(json.contains(key), "missing wire key {key} in {json}");
    }
}
