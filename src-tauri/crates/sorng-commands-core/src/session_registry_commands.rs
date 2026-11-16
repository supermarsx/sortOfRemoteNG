//! Cross-protocol live-session registry, frontend presence heartbeat and the
//! orphaned-session reaper.
//!
//! A webview reload loses every frontend handle while the backend sessions
//! keep running. This module lets a fresh frontend (1) list what is still
//! alive with enough metadata to rebuild tabs, and (2) tell the backend which
//! sessions it holds, so sessions nobody reattaches to are closed after a
//! grace period instead of living forever.
//!
//! Reaping rules (see `sorng_core::session_resilience::PresenceTracker`):
//! * armed only after a heartbeating frontend has been seen;
//! * only sessions a frontend claimed at least once are eligible;
//! * a session claimed within the grace is never reaped;
//! * grace 0 disables reaping; default 300 s, clamped to 30 s ..= 24 h;
//! * a process stall (suspend) restarts every clock instead of reaping.
//!
//! Sessions are closed through each protocol's normal disconnect path, so
//! forwards, VPN leases and replay rings are released exactly as for a user
//! close.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use sorng_core::session_resilience::{
    global_presence, monotonic_ms, HeartbeatAck, LiveSessionDescriptor, PresenceTracker,
    SessionClaim, SessionKey, HEARTBEAT_INTERVAL_MS, REAPER_TICK_MS,
};
use tauri::{AppHandle, Manager, Runtime};

/// Largest claim list one heartbeat may carry.
const MAX_CLAIMS: usize = 512;
/// Largest identifier accepted in a claim.
const MAX_ID_BYTES: usize = 128;

static REAPER_STARTED: AtomicBool = AtomicBool::new(false);

/// Live sessions of every protocol whose service is managed by the app.
async fn collect_live<R: Runtime>(app: &AppHandle<R>) -> Vec<LiveSessionDescriptor> {
    let mut rows = Vec::new();

    if let Some(ssh) = app.try_state::<crate::ssh::types::SshServiceState>() {
        let service = ssh.lock().await;
        for info in service.list_sessions().await {
            rows.push(crate::ssh::live_session::live_descriptor(&info));
        }
    }
    #[cfg(feature = "rdp")]
    {
        if let Some(rdp) = app.try_state::<crate::rdp::RdpServiceState>() {
            let service = rdp.lock().await;
            for connection in service.connections.values() {
                rows.push(crate::rdp::live_session::live_descriptor(
                    &connection.session,
                ));
            }
        }
    }
    if let Some(vnc) = app.try_state::<crate::vnc::service::VncServiceState>() {
        for info in vnc.list_session_info().await {
            rows.push(crate::vnc::live_session::live_descriptor(&info));
        }
    }
    if let Some(telnet) = app.try_state::<crate::telnet::service::TelnetServiceState>() {
        rows.extend(telnet.live_descriptors().await);
    }
    if let Some(serial) = app.try_state::<crate::serial::service::SerialServiceState>() {
        rows.extend(serial.live_descriptors().await);
    }
    rows
}

fn key_of(row: &LiveSessionDescriptor) -> SessionKey {
    SessionKey::new(&row.protocol, &row.backend_session_id)
}

/// Fill in the orphan status and the frontend tab binding.
fn decorate(rows: &mut [LiveSessionDescriptor], tracker: &PresenceTracker, now_ms: u64) {
    for row in rows {
        let (orphan, frontend_session_id) = tracker.status(&key_of(row), now_ms);
        row.orphan = orphan;
        if row.frontend_session_id.is_none() {
            row.frontend_session_id = frontend_session_id;
        }
    }
}

/// Close one session through its protocol's normal disconnect path.
async fn close_session<R: Runtime>(app: &AppHandle<R>, key: &SessionKey) -> Result<(), String> {
    let id = key.backend_session_id.as_str();
    match key.protocol.as_str() {
        "ssh" => match app.try_state::<crate::ssh::types::SshServiceState>() {
            Some(state) => crate::ssh::service::disconnect_ssh_on_state(state.inner(), id).await,
            None => Ok(()),
        },
        "telnet" => match app.try_state::<crate::telnet::service::TelnetServiceState>() {
            Some(state) => state.disconnect(id).await,
            None => Ok(()),
        },
        "serial" => match app.try_state::<crate::serial::service::SerialServiceState>() {
            Some(state) => state.disconnect(id).await,
            None => Ok(()),
        },
        "vnc" => match app.try_state::<crate::vnc::service::VncServiceState>() {
            Some(state) => state
                .disconnect_and_remove(id)
                .await
                .map_err(|error| error.message),
            None => Ok(()),
        },
        #[cfg(feature = "rdp")]
        "rdp" => match app.try_state::<crate::rdp::RdpServiceState>() {
            Some(state) => {
                let selector =
                    crate::rdp::commands::RdpConnectionSelector::for_existing(Some(id), None)
                        .ok_or_else(|| "Invalid RDP session identifier".to_string())?;
                match crate::rdp::commands::close_rdp_connection(
                    state.inner(),
                    &selector,
                    "orphaned session grace expired",
                    crate::rdp::commands::RDP_WORKER_SHUTDOWN_GRACE,
                )
                .await
                {
                    crate::rdp::commands::RdpCloseOutcome::StillClosing { .. }
                    | crate::rdp::commands::RdpCloseOutcome::NotFound
                    | crate::rdp::commands::RdpCloseOutcome::Closed { .. } => Ok(()),
                }
            }
            None => Ok(()),
        },
        other => Err(format!("Unknown session protocol '{other}'")),
    }
}

/// One reaper pass with an injected clock and tracker. Returns the sessions
/// that were closed (or that no longer existed) this pass.
pub(crate) async fn reap_once<R: Runtime>(
    app: &AppHandle<R>,
    tracker: &PresenceTracker,
    now_ms: u64,
) -> Vec<SessionKey> {
    // A stalled process (laptop sleep) cannot have heartbeated either.
    tracker.note_tick(now_ms, REAPER_TICK_MS * 4);
    let live = collect_live(app).await;
    let keys: Vec<SessionKey> = live.iter().map(key_of).collect();
    tracker.reconcile_live(&keys, now_ms);

    let mut reaped = Vec::new();
    for key in tracker.take_expired(now_ms) {
        log::info!(
            "[session-registry] closing orphaned {} session {} (no frontend reattached within the grace)",
            key.protocol,
            key.backend_session_id
        );
        if let Err(error) = close_session(app, &key).await {
            log::warn!(
                "[session-registry] closing orphaned {} session {} failed: {}",
                key.protocol,
                key.backend_session_id,
                error
            );
        }
        reaped.push(key);
    }
    reaped
}

fn ensure_reaper(app: &AppHandle) {
    if REAPER_STARTED.swap(true, Ordering::AcqRel) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_millis(REAPER_TICK_MS)).await;
            reap_once(&app, global_presence(), monotonic_ms()).await;
        }
    });
}

fn validate_claims(claims: &[SessionClaim]) -> Result<(), String> {
    if claims.len() > MAX_CLAIMS {
        return Err(format!("At most {MAX_CLAIMS} session claims per heartbeat"));
    }
    for claim in claims {
        let ok = |value: &str| !value.is_empty() && value.len() <= MAX_ID_BYTES;
        if !ok(&claim.protocol)
            || !ok(&claim.backend_session_id)
            || claim
                .frontend_session_id
                .as_deref()
                .is_some_and(|id| id.len() > MAX_ID_BYTES)
        {
            return Err("Invalid session claim".to_string());
        }
    }
    Ok(())
}

pub(crate) async fn heartbeat_inner<R: Runtime>(
    app: &AppHandle<R>,
    tracker: &PresenceTracker,
    window_label: &str,
    sessions: Vec<SessionClaim>,
    grace_seconds: Option<u64>,
    now_ms: u64,
) -> Result<HeartbeatAck, String> {
    validate_claims(&sessions)?;
    if let Some(seconds) = grace_seconds {
        tracker.set_grace_secs(seconds);
    }
    let live = collect_live(app).await;
    let live_keys: Vec<SessionKey> = live.iter().map(key_of).collect();
    tracker.reconcile_live(&live_keys, now_ms);
    let (alive, missing): (Vec<SessionClaim>, Vec<SessionClaim>) = sessions
        .into_iter()
        .partition(|claim| live_keys.contains(&claim.key()));
    tracker.heartbeat(window_label, &alive, now_ms);
    Ok(HeartbeatAck {
        grace_seconds: tracker.grace_secs(),
        reaper_enabled: tracker.reaper_armed(),
        heartbeat_interval_ms: HEARTBEAT_INTERVAL_MS,
        missing: missing.iter().map(SessionClaim::key).collect(),
    })
}

pub(crate) async fn list_inner<R: Runtime>(
    app: &AppHandle<R>,
    tracker: &PresenceTracker,
    now_ms: u64,
) -> Vec<LiveSessionDescriptor> {
    let mut rows = collect_live(app).await;
    let keys: Vec<SessionKey> = rows.iter().map(key_of).collect();
    tracker.reconcile_live(&keys, now_ms);
    decorate(&mut rows, tracker, now_ms);
    rows
}

/// List every backend session that is still alive (ssh, rdp, vnc, telnet,
/// serial) with enough metadata to rebuild its tab after a webview reload.
/// Contains no credentials and no terminal/framebuffer payload.
#[tauri::command]
pub async fn list_live_sessions(app: AppHandle) -> Result<Vec<LiveSessionDescriptor>, String> {
    Ok(list_inner(&app, global_presence(), monotonic_ms()).await)
}

/// Frontend presence heartbeat; call about every `heartbeatIntervalMs` (5 s)
/// from each window with the sessions that window currently holds, including
/// hidden tabs. Sessions that were claimed and then stop being claimed are
/// closed after the grace. `graceSeconds` (optional) sets the policy: 0
/// disables reaping, other values are clamped to 30 ..= 86400; the default is
/// 300.
#[tauri::command]
pub async fn session_host_heartbeat(
    app: AppHandle,
    window: tauri::Window,
    sessions: Vec<SessionClaim>,
    grace_seconds: Option<u64>,
) -> Result<HeartbeatAck, String> {
    ensure_reaper(&app);
    heartbeat_inner(
        &app,
        global_presence(),
        window.label(),
        sessions,
        grace_seconds,
        monotonic_ms(),
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use sorng_core::session_resilience::PresenceTracker;
    use tauri::test::{mock_builder, mock_context, noop_assets, MockRuntime};
    use tokio::io::AsyncWriteExt;
    use tokio::net::TcpListener;

    fn mock_app() -> tauri::App<MockRuntime> {
        mock_builder()
            .build(mock_context(noop_assets()))
            .expect("mock app")
    }

    /// A loopback telnet server that sends one banner and then idles.
    async fn banner_server(banner: &'static str) -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let port = listener.local_addr().expect("addr").port();
        tokio::spawn(async move {
            loop {
                let Ok((mut socket, _)) = listener.accept().await else {
                    return;
                };
                tokio::spawn(async move {
                    let _ = socket.write_all(banner.as_bytes()).await;
                    tokio::time::sleep(Duration::from_secs(120)).await;
                });
            }
        });
        port
    }

    async fn dial(app: &tauri::App<MockRuntime>, port: u16) -> String {
        let service = app
            .state::<crate::telnet::service::TelnetServiceState>()
            .inner()
            .clone();
        let config = crate::telnet::types::TelnetConfig {
            host: "127.0.0.1".into(),
            port,
            allow_insecure_transport: true,
            ..Default::default()
        };
        service.connect(config).await.expect("connect")
    }

    fn claim(id: &str) -> SessionClaim {
        SessionClaim {
            protocol: "telnet".into(),
            backend_session_id: id.into(),
            frontend_session_id: Some("tab-1".into()),
        }
    }

    #[tokio::test]
    async fn registry_lists_a_live_telnet_session_with_its_replay_range() {
        let app = mock_app();
        app.manage(crate::telnet::service::TelnetService::new());
        let port = banner_server("login: ").await;
        let id = dial(&app, port).await;
        // Wait for the banner to reach the replay ring.
        let service = app
            .state::<crate::telnet::service::TelnetServiceState>()
            .inner()
            .clone();
        for _ in 0..100 {
            let snapshot = service
                .get_output_snapshot(&id, None, None, None)
                .await
                .expect("snapshot");
            if !snapshot.data.is_empty() {
                assert_eq!(snapshot.data, "login: ");
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        let tracker = PresenceTracker::new();
        let rows = list_inner(app.handle(), &tracker, 1_000).await;
        assert_eq!(rows.len(), 1);
        let row = &rows[0];
        assert_eq!(row.protocol, "telnet");
        assert_eq!(row.backend_session_id, id);
        assert_eq!(row.target, "127.0.0.1");
        assert_eq!(row.port, Some(port));
        assert_eq!(row.state, "connected");
        let range = row.buffer.expect("replay range");
        assert_eq!(range.sequence_end, 7);
        // The registry row carries no payload.
        assert!(!serde_json::to_string(&rows).unwrap().contains("login"));
    }

    #[tokio::test]
    async fn claimed_session_survives_and_orphan_is_reaped_after_grace() {
        let app = mock_app();
        app.manage(crate::telnet::service::TelnetService::new());
        let port = banner_server("hi").await;
        let attached = dial(&app, port).await;
        let orphan = dial(&app, port).await;
        let tracker = PresenceTracker::new();
        tracker.set_grace_secs(60);

        // Both claimed by the previous document.
        let ack = heartbeat_inner(
            app.handle(),
            &tracker,
            "main",
            vec![claim(&attached), claim(&orphan)],
            None,
            0,
        )
        .await
        .expect("heartbeat");
        assert!(ack.missing.is_empty() && ack.reaper_enabled);

        // The new document only reattaches `attached`, for ten graces.
        let mut now = 0;
        while now < 600_000 {
            now += HEARTBEAT_INTERVAL_MS;
            heartbeat_inner(
                app.handle(),
                &tracker,
                "main",
                vec![claim(&attached)],
                None,
                now,
            )
            .await
            .expect("heartbeat");
            let reaped = reap_once(app.handle(), &tracker, now).await;
            if now < 60_000 {
                assert!(reaped.is_empty(), "reaped early at {now}");
            }
        }
        let service = app
            .state::<crate::telnet::service::TelnetServiceState>()
            .inner()
            .clone();
        let live: Vec<String> = service
            .live_descriptors()
            .await
            .into_iter()
            .map(|row| row.backend_session_id)
            .collect();
        assert_eq!(
            live,
            vec![attached.clone()],
            "only the claimed session remains"
        );

        // Reaping released the orphan's replay ring.
        assert!(service
            .get_output_snapshot(&orphan, None, None, None)
            .await
            .is_err());
        // A claim for a session that no longer exists is reported missing.
        let ack = heartbeat_inner(
            app.handle(),
            &tracker,
            "main",
            vec![claim(&attached), claim(&orphan)],
            None,
            now + 5_000,
        )
        .await
        .expect("heartbeat");
        assert_eq!(ack.missing.len(), 1);
        assert_eq!(ack.missing[0].backend_session_id, orphan);
    }

    #[tokio::test]
    async fn unarmed_reaper_and_never_claimed_sessions_are_left_alone() {
        let app = mock_app();
        app.manage(crate::telnet::service::TelnetService::new());
        let port = banner_server("x").await;
        let id = dial(&app, port).await;
        let tracker = PresenceTracker::new();
        tracker.set_grace_secs(30);
        // No heartbeat yet: nothing is ever reaped.
        assert!(reap_once(app.handle(), &tracker, 10_000_000)
            .await
            .is_empty());
        // A heartbeating frontend that never claims this session: still safe.
        heartbeat_inner(app.handle(), &tracker, "main", vec![], None, 10_000_000)
            .await
            .expect("heartbeat");
        assert!(reap_once(app.handle(), &tracker, 20_000_000)
            .await
            .is_empty());
        let service = app
            .state::<crate::telnet::service::TelnetServiceState>()
            .inner()
            .clone();
        assert_eq!(service.live_descriptors().await.len(), 1);
        service.disconnect(&id).await.expect("disconnect");
    }

    #[test]
    fn heartbeat_claims_are_bounded_and_validated() {
        let too_many: Vec<SessionClaim> = (0..=MAX_CLAIMS).map(|i| claim(&i.to_string())).collect();
        assert!(validate_claims(&too_many).is_err());
        assert!(validate_claims(&[SessionClaim {
            protocol: String::new(),
            backend_session_id: "x".into(),
            frontend_session_id: None,
        }])
        .is_err());
        assert!(validate_claims(&[claim(&"a".repeat(MAX_ID_BYTES + 1))]).is_err());
        assert!(validate_claims(&[claim("ok")]).is_ok());
    }
}
