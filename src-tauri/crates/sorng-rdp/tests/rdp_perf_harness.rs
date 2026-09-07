//! Delivery-accounting microbenchmark and opt-in connection diagnostics smoke.
//!
//! The microbenchmark allocates synthetic bytes and sends them to a discard
//! sink. It does not include protocol decode, framebuffer copies, IPC, worker
//! execution, or screen presentation, and cannot estimate desktop FPS.
//!
//! Both tests are `#[ignore]`d so the default `cargo test -p sorng-rdp` stays
//! fast and host-independent. The live test is *additionally* gated on the
//! `RDP_PERF_HOST` env var so it is a no-op unless a target is supplied.
//!
//! # Running the deterministic accounting microbenchmark
//!
//! ```bash
//! cargo test -p sorng-rdp --test rdp_perf_harness \
//!     frame_delivery_accounting_microbenchmark -- --ignored --nocapture
//! ```
//!
//! Tunables (env vars, all optional):
//! - `RDP_PERF_FRAMES`   total graphics updates to drive        (default 20000)
//! - `RDP_PERF_WIDTH`    framebuffer width  in px               (default 1920)
//! - `RDP_PERF_RECT_H`   dirty-rect height in px (payload size) (default 64)
//! - `RDP_PERF_BATCH`    updates coalesced per flush            (default 8)
//! - `RDP_PERF_DROP_EVERY` fail every Nth send (0 = never)      (default 0)
//!
//! # Running the live xrdp connection diagnostics smoke
//!
//! Uses the Docker xrdp recipe already shipped in `e2e/docker-compose.yml`
//! (`danielguerra/ubuntu-xrdp`, mapped to 127.0.0.1:13389):
//!
//! ```bash
//! cd e2e && docker compose up -d test-rdp
//! RDP_PERF_HOST=127.0.0.1 RDP_PERF_PORT=13389 \
//!     cargo test -p sorng-rdp --test rdp_perf_harness \
//!     live_xrdp_connection_diagnostics -- --ignored --nocapture
//! ```
//!
//! Tunables: `RDP_PERF_HOST` (required to run), `RDP_PERF_PORT` (default 13389),
//! `RDP_PERF_USER` / `RDP_PERF_PASSWORD` (default `ubuntu`/`ubuntu`),
//! `RDP_PERF_CONNECTS` connect cycles to time (default 10).

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;

use sorng_rdp::rdp::frame_channel::{
    send_accounted_frame, DynFrameChannel, FrameChannel, FrameDeliveryAccounting, FramePayloadKind,
};
use sorng_rdp::rdp::frame_flow_control::{FrameFlowBudget, FrameFlowController};

fn env_usize(key: &str, default: usize) -> usize {
    std::env::var(key)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

/// A frame channel that discards payloads but records byte counts and can be
/// told to fail (simulating a closed/backed-up sink) every Nth send so the
/// harness exercises the `dropped` accounting path.
struct BenchFrameChannel {
    sends: AtomicU64,
    bytes: AtomicU64,
    fail_every: u64,
}

impl FrameChannel for BenchFrameChannel {
    fn send_raw(&self, data: Vec<u8>) -> Result<(), String> {
        let n = self.sends.fetch_add(1, Ordering::Relaxed) + 1;
        self.bytes.fetch_add(data.len() as u64, Ordering::Relaxed);
        if self.fail_every != 0 && n.is_multiple_of(self.fail_every) {
            return Err("bench sink backpressure".to_string());
        }
        Ok(())
    }
}

#[test]
#[ignore = "perf: run explicitly with --ignored --nocapture"]
fn frame_delivery_accounting_microbenchmark() {
    let total_frames = env_usize("RDP_PERF_FRAMES", 20_000);
    let width = env_usize("RDP_PERF_WIDTH", 1920);
    let rect_h = env_usize("RDP_PERF_RECT_H", 64);
    let batch = env_usize("RDP_PERF_BATCH", 8).max(1);
    let drop_every = env_usize("RDP_PERF_DROP_EVERY", 0) as u64;

    // One merged batch payload mirrors push_multi_rect: 8-byte header + RGBA.
    assert!(
        total_frames > 0 && total_frames <= 10_000_000,
        "RDP_PERF_FRAMES must be 1..=10000000"
    );
    assert!(width > 0 && rect_h > 0, "dimensions must be positive");
    let payload_bytes = width
        .checked_mul(rect_h)
        .and_then(|n| n.checked_mul(4))
        .and_then(|n| n.checked_add(8))
        .expect("payload size overflow");
    assert!(
        payload_bytes <= 16 * 1024 * 1024,
        "synthetic payload exceeds 16 MiB"
    );

    let channel: DynFrameChannel = Arc::new(BenchFrameChannel {
        sends: AtomicU64::new(0),
        bytes: AtomicU64::new(0),
        fail_every: drop_every,
    });
    let accounting = FrameDeliveryAccounting::new();
    let mut flow = FrameFlowController::new(FrameFlowBudget::default());

    let mut attempted_batches: u64 = 0;
    let mut latencies_ns: Vec<u128> = Vec::with_capacity(total_frames / batch + 1);

    let start = Instant::now();
    let mut produced = 0usize;
    while produced < total_frames {
        let this_batch = batch.min(total_frames - produced);
        // Per-graphics-update coalescing decision (backlog grows 0..this_batch).
        for pending_before in 0..this_batch {
            flow.account_batched_update(pending_before.min(u16::MAX as usize) as u16);
        }
        produced += this_batch;

        // One flush: the whole coalesced backlog is sent as a single frame.
        let send_start = Instant::now();
        let payload = vec![0u8; payload_bytes];
        let delivered =
            send_accounted_frame(&accounting, &channel, FramePayloadKind::RgbaRects, payload);
        latencies_ns.push(send_start.elapsed().as_nanos());
        if delivered.is_ok() {
            flow.record_delivered();
        }
        attempted_batches += 1;
    }
    let elapsed = start.elapsed();

    let delivery = accounting.snapshot();
    let flow_snap = flow.snapshot();

    latencies_ns.sort_unstable();
    let mean_ns = if latencies_ns.is_empty() {
        0
    } else {
        latencies_ns.iter().sum::<u128>() / latencies_ns.len() as u128
    };
    let p95_ns = if latencies_ns.is_empty() {
        0
    } else {
        latencies_ns[(latencies_ns.len() * 95 / 100).min(latencies_ns.len() - 1)]
    };
    let batches_per_second =
        delivery.delivered_frames as f64 / elapsed.as_secs_f64().max(f64::EPSILON);

    eprintln!("── RDP delivery-accounting microbenchmark ─────────────────────────────");
    eprintln!("graphics updates driven : {total_frames}");
    eprintln!("batch (coalesce) size   : {batch}");
    eprintln!("payload / frame         : {payload_bytes} bytes ({width}x{rect_h} RGBA + 8B hdr)");
    eprintln!(
        "wall time               : {:.3} ms",
        elapsed.as_secs_f64() * 1e3
    );
    eprintln!("successful synthetic batches/s: {batches_per_second:.0} (not desktop FPS)");
    eprintln!("coalesced frames        : {}", flow_snap.coalesced_frames);
    eprintln!(
        "attempted / delivered   : {} / {}",
        delivery.attempted_frames, delivery.delivered_frames
    );
    eprintln!("dropped (send failures) : {}", delivery.failed_frames);
    eprintln!("bytes delivered         : {}", delivery.delivered_bytes);
    eprintln!("allocation + discard-send : mean {mean_ns} ns, p95 {p95_ns} ns");
    eprintln!("────────────────────────────────────────────────────────");

    // Sanity: the wired controller must report the real coalesced count
    // (previously hard-wired to 0). Each batch coalesces (batch-1) updates.
    let full_batches = (total_frames / batch) as u64;
    let expected_min_coalesced = full_batches.saturating_mul((batch - 1) as u64);
    assert!(
        flow_snap.coalesced_frames >= expected_min_coalesced,
        "coalesced {} should be >= {expected_min_coalesced}",
        flow_snap.coalesced_frames
    );
    assert_eq!(delivery.attempted_frames, attempted_batches);
    assert_eq!(flow_snap.delivered_frames, delivery.delivered_frames);
    if let Some(expected_failures) = attempted_batches.checked_div(drop_every) {
        assert_eq!(delivery.failed_frames, expected_failures);
    } else {
        assert_eq!(delivery.failed_frames, 0);
        assert_eq!(delivery.delivered_frames, attempted_batches);
    }
}

#[test]
#[ignore = "perf+live: needs RDP_PERF_HOST and a reachable xrdp; run with --ignored --nocapture"]
fn live_xrdp_connection_diagnostics() {
    let host = match std::env::var("RDP_PERF_HOST") {
        Ok(h) if !h.is_empty() => h,
        _ => {
            eprintln!(
                "live_xrdp_connection_diagnostics: RDP_PERF_HOST unset — skipping live benchmark"
            );
            return;
        }
    };
    let port: u16 = std::env::var("RDP_PERF_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(13389);
    let username = std::env::var("RDP_PERF_USER").unwrap_or_else(|_| "ubuntu".into());
    let password = secrecy::SecretString::from(
        std::env::var("RDP_PERF_PASSWORD").unwrap_or_else(|_| "ubuntu".into()),
    );
    let connects = env_usize("RDP_PERF_CONNECTS", 10).max(1);

    let payload = sorng_rdp::rdp::RdpSettingsPayload::default();
    let settings = sorng_rdp::rdp::settings::ResolvedSettings::from_payload(&payload, 1024, 768);

    let mut latencies_ms: Vec<f64> = Vec::with_capacity(connects);
    for i in 0..connects {
        let start = Instant::now();
        let report = sorng_rdp::rdp::diagnostics::run_diagnostics(
            &host, port, &username, &password, None, &settings, None, None,
        );
        let ms = start.elapsed().as_secs_f64() * 1e3;
        latencies_ms.push(ms);
        assert!(
            !report.steps.is_empty()
                && !report.steps.iter().any(|step| step.status == "fail")
                && report
                    .steps
                    .iter()
                    .any(|step| step.name == "Server Capabilities" && step.status == "info"),
            "diagnostic cycle {i} failed to verify an RDP connection"
        );
    }

    latencies_ms.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let mean = latencies_ms.iter().sum::<f64>() / latencies_ms.len() as f64;
    let p95 = latencies_ms[(latencies_ms.len() * 95 / 100).min(latencies_ms.len() - 1)];
    eprintln!("── live xrdp connection diagnostics smoke ({host}:{port}) ─────────────");
    eprintln!("connect cycles          : {connects}");
    eprintln!("diagnostic run duration : mean {mean:.1} ms, p95 {p95:.1} ms");
    eprintln!("────────────────────────────────────────────────────────");
}
