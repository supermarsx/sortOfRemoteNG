// Re-exported for use by commands_cmds.rs (compiled via include!() in the app crate).
pub use std::sync::Arc;
pub use std::time::Duration;

pub use crate::ironrdp::pdu::input::fast_path::FastPathInputEvent;
pub use crate::ironrdp_displaycontrol;
pub use tokio::sync::mpsc;
pub use uuid::Uuid;

pub use super::frame_delivery::NAL_MAGIC;
pub use super::frame_store::SharedFrameStoreState;
pub use super::input::convert_input;
pub use super::session_runner::{run_rdp_session, LogSink};
pub use super::session_runtime::{RdpWorkerGeneration, RdpWorkerRuntime};
pub use super::settings::{RdpSettingsPayload, ResolvedSettings};
pub use super::stats::RdpSessionStats;
pub use super::types::*;
pub use super::RdpServiceState;

pub const MAX_RDP_THUMBNAIL_DIMENSION: u32 = 4096;
pub const MAX_RDP_THUMBNAIL_PIXELS: u64 = 4_194_304;
pub const RDP_WORKER_SHUTDOWN_GRACE: Duration = Duration::from_millis(250);
pub const RDP_BINARY_IPC_PREFLIGHT_PAYLOAD_BYTES: usize = 2_048;
pub const RDP_BINARY_IPC_PREFLIGHT_MAGIC: &[u8] = b"SORNG_RDP_BINARY_IPC_V1";

pub fn build_rdp_binary_ipc_preflight_payload() -> Vec<u8> {
    let mut payload = vec![0_u8; RDP_BINARY_IPC_PREFLIGHT_PAYLOAD_BYTES];
    for (index, byte) in payload.iter_mut().enumerate() {
        *byte = ((index * 17 + 29) % 251) as u8;
    }
    payload[..RDP_BINARY_IPC_PREFLIGHT_MAGIC.len()].copy_from_slice(RDP_BINARY_IPC_PREFLIGHT_MAGIC);
    payload
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RdpConnectionSelector {
    SessionId(String),
    ConnectionId(String),
    Endpoint {
        host: String,
        port: u16,
        username: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RdpCloseOutcome {
    NotFound,
    Closed {
        session_id: String,
        generation: RdpWorkerGeneration,
    },
    StillClosing {
        session_id: String,
        generation: RdpWorkerGeneration,
    },
}

pub fn find_rdp_connection_id(
    service: &RdpService,
    selector: &RdpConnectionSelector,
) -> Option<String> {
    match selector {
        RdpConnectionSelector::SessionId(session_id) => service
            .connections
            .contains_key(session_id)
            .then(|| session_id.clone()),
        RdpConnectionSelector::ConnectionId(connection_id) => service
            .connections
            .values()
            .find(|connection| {
                connection.session.connection_id.as_deref() == Some(connection_id.as_str())
            })
            .map(|connection| connection.session.id.clone()),
        RdpConnectionSelector::Endpoint {
            host,
            port,
            username,
        } => service
            .connections
            .values()
            .find(|connection| {
                connection.session.host == *host
                    && connection.session.port == *port
                    && connection.session.username == *username
            })
            .map(|connection| connection.session.id.clone()),
    }
}

pub async fn remove_completed_rdp_worker(
    state: &RdpServiceState,
    session_id: &str,
    generation: RdpWorkerGeneration,
) -> bool {
    let mut service = state.lock().await;
    let can_remove = service
        .connections
        .get(session_id)
        .is_some_and(|connection| {
            connection.worker.generation() == generation && connection.worker.is_complete()
        });
    if can_remove {
        service.connections.remove(session_id);
        true
    } else {
        false
    }
}

/// Mark one worker as closing, signal it, and wait outside the service mutex.
/// A generation-scoped reaper keeps a timed-out record observable until the
/// worker genuinely exits and releases its admission permit.
pub async fn close_rdp_connection(
    state: &RdpServiceState,
    selector: &RdpConnectionSelector,
    reason: &str,
    grace: Duration,
) -> RdpCloseOutcome {
    let close_plan = {
        let mut service = state.lock().await;
        let Some(session_id) = find_rdp_connection_id(&service, selector) else {
            return RdpCloseOutcome::NotFound;
        };

        let (ticket, shutdown_sender) = {
            let connection = service
                .connections
                .get_mut(&session_id)
                .expect("selected RDP connection must remain present while locked");
            let ticket = connection.worker.request_close();
            connection.session.connected = false;
            let shutdown_sender = ticket.first_request.then(|| connection.cmd_tx.clone());
            (ticket, shutdown_sender)
        };

        if ticket.first_request {
            service.push_log(
                "info",
                format!("Closing RDP session {session_id}: {reason}"),
                Some(session_id.clone()),
            );
        }
        (session_id, ticket, shutdown_sender)
    };

    let (session_id, ticket, shutdown_sender) = close_plan;
    if let Some(shutdown_sender) = shutdown_sender {
        // Best-effort teardown wake: request_close() above is the authoritative
        // lifecycle fence, so an already-closed command receiver needs no
        // user-visible error and the completion watcher still reaps the worker.
        let _ = shutdown_sender.send(RdpCommand::Shutdown);

        let reap_state = Arc::clone(state);
        let reap_session_id = session_id.clone();
        let reap_completion = ticket.completion.clone();
        let reap_generation = ticket.generation;
        tokio::spawn(async move {
            reap_completion.wait().await;
            remove_completed_rdp_worker(&reap_state, &reap_session_id, reap_generation).await;
        });
    }

    let completed = ticket.completion.is_complete()
        || (!grace.is_zero()
            && tokio::time::timeout(grace, ticket.completion.wait())
                .await
                .is_ok());

    if completed {
        remove_completed_rdp_worker(state, &session_id, ticket.generation).await;
        RdpCloseOutcome::Closed {
            session_id,
            generation: ticket.generation,
        }
    } else {
        RdpCloseOutcome::StillClosing {
            session_id,
            generation: ticket.generation,
        }
    }
}

fn checked_rgba_len(width: u32, height: u32, label: &str) -> Result<usize, String> {
    let width =
        usize::try_from(width).map_err(|_| format!("{label} width does not fit this platform"))?;
    let height = usize::try_from(height)
        .map_err(|_| format!("{label} height does not fit this platform"))?;

    width
        .checked_mul(height)
        .and_then(|pixels| pixels.checked_mul(4))
        .ok_or_else(|| format!("{label} RGBA byte length overflow"))
}

pub fn validate_rdp_thumbnail_dimensions(width: u32, height: u32) -> Result<usize, String> {
    // Preserve the existing empty-thumbnail behavior without considering the
    // unused axis when either requested dimension is zero.
    if width == 0 || height == 0 {
        return Ok(0);
    }

    if width > MAX_RDP_THUMBNAIL_DIMENSION || height > MAX_RDP_THUMBNAIL_DIMENSION {
        return Err(format!(
            "Thumbnail dimensions must not exceed {MAX_RDP_THUMBNAIL_DIMENSION} pixels per axis"
        ));
    }

    let pixels = u64::from(width)
        .checked_mul(u64::from(height))
        .ok_or_else(|| "Thumbnail pixel count overflow".to_string())?;
    if pixels > MAX_RDP_THUMBNAIL_PIXELS {
        return Err(format!(
            "Thumbnail pixel count must not exceed {MAX_RDP_THUMBNAIL_PIXELS}"
        ));
    }

    checked_rgba_len(width, height, "Thumbnail")
}

pub fn resize_rgba_nearest(
    src: &[u8],
    src_w: u32,
    src_h: u32,
    dst_w: u32,
    dst_h: u32,
) -> Result<Vec<u8>, String> {
    if src_w == 0 || src_h == 0 {
        return Err("Source framebuffer dimensions must be non-zero".to_string());
    }

    let expected_src_len = checked_rgba_len(src_w, src_h, "Source framebuffer")?;
    if src.len() != expected_src_len {
        return Err("Invalid framebuffer data".to_string());
    }

    let output_len = validate_rdp_thumbnail_dimensions(dst_w, dst_h)?;
    if output_len == 0 {
        return Ok(Vec::new());
    }

    let mut out = vec![0u8; output_len];
    for y in 0..dst_h {
        let src_y = ((y as u64) * (src_h as u64) / (dst_h as u64)) as u32;
        for x in 0..dst_w {
            let src_x = ((x as u64) * (src_w as u64) / (dst_w as u64)) as u32;
            let src_idx = ((src_y as usize) * (src_w as usize) + (src_x as usize)) * 4;
            let dst_idx = ((y as usize) * (dst_w as usize) + (x as usize)) * 4;
            out[dst_idx..dst_idx + 4].copy_from_slice(&src[src_idx..src_idx + 4]);
        }
    }

    Ok(out)
}

#[cfg(feature = "snapshot")]
pub fn encode_rgba_png(pixels: &[u8], width: u32, height: u32) -> Result<Vec<u8>, String> {
    if pixels.len() != (width as usize) * (height as usize) * 4 {
        return Err("Invalid RGBA buffer for PNG encoding".to_string());
    }

    let mut buf = Vec::new();
    let mut encoder = png::Encoder::new(&mut buf, width, height);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    encoder
        .write_header()
        .map_err(|e| format!("Failed to create PNG header: {e}"))?
        .write_image_data(pixels)
        .map_err(|e| format!("Failed to encode PNG: {e}"))?;

    Ok(buf)
}

#[cfg(not(feature = "snapshot"))]
pub fn encode_rgba_png(_pixels: &[u8], _width: u32, _height: u32) -> Result<Vec<u8>, String> {
    Err("PNG encoding not available (enable `snapshot` feature)".to_string())
}

// ---- Tauri commands ----

#[cfg(test)]
mod thumbnail_safety_tests {
    use super::*;

    #[test]
    fn resize_rejects_oversized_thumbnail_before_allocation() {
        let source = [0_u8; 4];

        let axis_error = resize_rgba_nearest(&source, 1, 1, MAX_RDP_THUMBNAIL_DIMENSION + 1, 1)
            .expect_err("oversized thumbnail axis should be rejected");
        assert!(axis_error.contains("dimensions"));

        let pixel_error = resize_rgba_nearest(
            &source,
            1,
            1,
            MAX_RDP_THUMBNAIL_DIMENSION,
            MAX_RDP_THUMBNAIL_DIMENSION,
        )
        .expect_err("oversized thumbnail pixel count should be rejected");
        assert!(pixel_error.contains("pixel count"));
    }
}

#[cfg(test)]
mod binary_ipc_preflight_tests {
    use super::*;

    #[test]
    fn probe_payload_forces_tauri_fetch_and_is_deterministic() {
        let payload = build_rdp_binary_ipc_preflight_payload();

        assert!(RDP_BINARY_IPC_PREFLIGHT_PAYLOAD_BYTES > 1_024);
        assert_eq!(payload.len(), RDP_BINARY_IPC_PREFLIGHT_PAYLOAD_BYTES);
        assert!(payload.starts_with(RDP_BINARY_IPC_PREFLIGHT_MAGIC));
        assert_eq!(payload, build_rdp_binary_ipc_preflight_payload());
    }
}

#[cfg(test)]
mod worker_lifecycle_tests {
    use super::*;
    use crate::rdp::session_runtime::{RdpWorkerCompletion, RdpWorkerLifecycle};
    use secrecy::SecretString;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Condvar, Mutex};

    const TEST_CAPACITY: usize = 16;

    #[derive(Default)]
    struct BlockingGate {
        open: Mutex<bool>,
        changed: Condvar,
    }

    impl BlockingGate {
        fn wait(&self) {
            let mut open = self.open.lock().expect("gate mutex poisoned");
            while !*open {
                open = self.changed.wait(open).expect("gate mutex poisoned");
            }
        }

        fn open(&self) {
            *self.open.lock().expect("gate mutex poisoned") = true;
            self.changed.notify_all();
        }
    }

    struct FakeWorker {
        gate: Arc<BlockingGate>,
        completion: RdpWorkerCompletion,
        generation: RdpWorkerGeneration,
    }

    async fn insert_blocked_worker(
        state: &RdpServiceState,
        session_id: &str,
        connection_id: &str,
        live_workers: Arc<AtomicUsize>,
    ) -> FakeWorker {
        let (permit, generation) = {
            let mut service = state.lock().await;
            let permit = service
                .try_reserve_session_slot()
                .expect("fake worker should fit within test capacity");
            let generation = service.allocate_worker_generation();
            (permit, generation)
        };

        let gate = Arc::new(BlockingGate::default());
        let worker_gate = Arc::clone(&gate);
        let worker_count = Arc::clone(&live_workers);
        let worker = RdpWorkerRuntime::spawn_blocking(generation, permit, move || {
            worker_count.fetch_add(1, Ordering::AcqRel);
            worker_gate.wait();
            worker_count.fetch_sub(1, Ordering::AcqRel);
        });
        let completion = worker.completion();

        let (cmd_tx, cmd_rx) = crate::rdp::wake_channel::create_wake_channel()
            .expect("fake worker wake channel should be created");
        drop(cmd_rx);

        let connection = RdpActiveConnection {
            session: RdpSession {
                id: session_id.to_string(),
                connection_id: Some(connection_id.to_string()),
                host: "rdp.test".to_string(),
                port: 3389,
                username: "tester".to_string(),
                connected: true,
                desktop_width: 1920,
                desktop_height: 1080,
                server_cert_fingerprint: None,
                viewer_attached: true,
                reconnect_count: 0,
                reconnecting: false,
            },
            cmd_tx,
            frame_channel: Arc::new(crate::rdp::frame_channel::NoopFrameChannel),
            activity_control: Arc::new(RdpSessionActivityControl::default()),
            stats: Arc::new(RdpSessionStats::new()),
            worker,
            cached_password: SecretString::from("test-only".to_string()),
            cached_domain: None,
        };

        state
            .lock()
            .await
            .connections
            .insert(session_id.to_string(), connection);

        FakeWorker {
            gate,
            completion,
            generation,
        }
    }

    async fn wait_for_live_workers(live_workers: &AtomicUsize, expected: usize) {
        tokio::time::timeout(Duration::from_secs(2), async {
            while live_workers.load(Ordering::Acquire) != expected {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("fake workers did not reach expected count");
    }

    async fn wait_for_full_cleanup(state: &RdpServiceState) {
        tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                let service = state.lock().await;
                if service.connections.is_empty()
                    && service.session_slots.available_permits() == TEST_CAPACITY
                {
                    return;
                }
                drop(service);
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("worker registry and permits should fully recover");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn blocked_stable_slot_reconnects_remain_observable_at_scale() {
        for reconnect_attempts in [100_usize, 500, 1_000] {
            let state = RdpService::new_test_state(TEST_CAPACITY);
            let live_workers = Arc::new(AtomicUsize::new(0));
            let worker = insert_blocked_worker(
                &state,
                "blocked-session",
                "stable-slot",
                Arc::clone(&live_workers),
            )
            .await;
            wait_for_live_workers(&live_workers, 1).await;

            for _ in 0..reconnect_attempts {
                let outcome = close_rdp_connection(
                    &state,
                    &RdpConnectionSelector::ConnectionId("stable-slot".to_string()),
                    "test replacement",
                    Duration::ZERO,
                )
                .await;
                assert!(matches!(
                    outcome,
                    RdpCloseOutcome::StillClosing {
                        session_id,
                        generation
                    } if session_id == "blocked-session" && generation == worker.generation
                ));

                let service = state.lock().await;
                let connection = service
                    .connections
                    .get("blocked-session")
                    .expect("timed-out worker must stay observable");
                assert_eq!(connection.worker.lifecycle(), RdpWorkerLifecycle::Closing);
                assert!(live_workers.load(Ordering::Acquire) <= TEST_CAPACITY);
                assert_eq!(
                    service.session_slots.available_permits()
                        + live_workers.load(Ordering::Acquire),
                    TEST_CAPACITY
                );
            }

            worker.gate.open();
            tokio::time::timeout(Duration::from_secs(2), worker.completion.wait())
                .await
                .expect("blocked worker should complete after its gate opens");
            wait_for_full_cleanup(&state).await;
            assert_eq!(live_workers.load(Ordering::Acquire), 0);
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn closing_wait_does_not_block_unrelated_registry_access() {
        let state = RdpService::new_test_state(TEST_CAPACITY);
        let live_workers = Arc::new(AtomicUsize::new(0));
        let worker = insert_blocked_worker(
            &state,
            "slow-session",
            "slow-slot",
            Arc::clone(&live_workers),
        )
        .await;
        wait_for_live_workers(&live_workers, 1).await;

        let close_state = Arc::clone(&state);
        let close_task = tokio::spawn(async move {
            close_rdp_connection(
                &close_state,
                &RdpConnectionSelector::ConnectionId("slow-slot".to_string()),
                "responsiveness test",
                Duration::from_secs(1),
            )
            .await
        });

        tokio::time::timeout(Duration::from_secs(1), async {
            loop {
                let service = state.lock().await;
                let closing = service
                    .connections
                    .get("slow-session")
                    .is_some_and(|connection| {
                        connection.worker.lifecycle() == RdpWorkerLifecycle::Closing
                    });
                drop(service);
                if closing {
                    return;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("close request should mark the worker closing");

        let unrelated_guard = state
            .try_lock()
            .expect("worker cleanup wait must not retain the service mutex");
        drop(unrelated_guard);

        worker.gate.open();
        let close_outcome = tokio::time::timeout(Duration::from_secs(2), close_task)
            .await
            .expect("close task should finish after the worker gate opens")
            .expect("close task should not panic");
        assert!(matches!(close_outcome, RdpCloseOutcome::Closed { .. }));
        wait_for_full_cleanup(&state).await;
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn stale_completion_cannot_remove_a_new_generation() {
        let state = RdpService::new_test_state(TEST_CAPACITY);
        let live_workers = Arc::new(AtomicUsize::new(0));
        let old_worker = insert_blocked_worker(
            &state,
            "shared-session-id",
            "stable-slot",
            Arc::clone(&live_workers),
        )
        .await;
        wait_for_live_workers(&live_workers, 1).await;

        assert!(matches!(
            close_rdp_connection(
                &state,
                &RdpConnectionSelector::ConnectionId("stable-slot".to_string()),
                "stale completion test",
                Duration::ZERO,
            )
            .await,
            RdpCloseOutcome::StillClosing { .. }
        ));

        state.lock().await.connections.remove("shared-session-id");
        let replacement = insert_blocked_worker(
            &state,
            "shared-session-id",
            "stable-slot",
            Arc::clone(&live_workers),
        )
        .await;
        wait_for_live_workers(&live_workers, 2).await;

        old_worker.gate.open();
        old_worker.completion.wait().await;
        assert!(
            !remove_completed_rdp_worker(&state, "shared-session-id", old_worker.generation).await
        );

        let service = state.lock().await;
        assert_eq!(
            service
                .connections
                .get("shared-session-id")
                .expect("replacement must survive stale cleanup")
                .worker
                .generation(),
            replacement.generation
        );
        drop(service);

        assert!(matches!(
            close_rdp_connection(
                &state,
                &RdpConnectionSelector::ConnectionId("stable-slot".to_string()),
                "test cleanup",
                Duration::ZERO,
            )
            .await,
            RdpCloseOutcome::StillClosing { .. }
        ));
        replacement.gate.open();
        replacement.completion.wait().await;
        wait_for_full_cleanup(&state).await;
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn duplicate_disconnect_is_idempotent_and_releases_once() {
        let state = RdpService::new_test_state(TEST_CAPACITY);
        let live_workers = Arc::new(AtomicUsize::new(0));
        let worker = insert_blocked_worker(
            &state,
            "duplicate-session",
            "duplicate-slot",
            Arc::clone(&live_workers),
        )
        .await;
        wait_for_live_workers(&live_workers, 1).await;

        for _ in 0..2 {
            assert!(matches!(
                close_rdp_connection(
                    &state,
                    &RdpConnectionSelector::SessionId("duplicate-session".to_string()),
                    "duplicate disconnect",
                    Duration::ZERO,
                )
                .await,
                RdpCloseOutcome::StillClosing { .. }
            ));
        }

        worker.gate.open();
        worker.completion.wait().await;
        wait_for_full_cleanup(&state).await;
        assert_eq!(live_workers.load(Ordering::Acquire), 0);
        assert!(matches!(
            close_rdp_connection(
                &state,
                &RdpConnectionSelector::SessionId("duplicate-session".to_string()),
                "already disconnected",
                Duration::ZERO,
            )
            .await,
            RdpCloseOutcome::NotFound
        ));
    }
}
