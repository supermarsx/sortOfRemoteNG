use std::io;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use secrecy::{ExposeSecret, SecretString};
use serde_json::Value;
use sorng_core::events::{AppEventEmitter, DynEventEmitter};
use sorng_rdp::rdp::cert_trust::{
    bind_session_prompt_context, evaluate_presented_certificate, initialize_store_path,
    submit_prompt_response, ChainStatus, PresentedCertificate, ServerCertValidationMode,
    SessionPromptContext,
};
use sorng_rdp::rdp::frame_store::SharedFrameStore;
use sorng_rdp::rdp::session_runner::{run_reconnect_loop_for_test, SessionLoopExit};
use sorng_rdp::rdp::settings::ResolvedSettings;
use sorng_rdp::rdp::stats::RdpSessionStats;
use sorng_rdp::rdp::types::RdpLogEntry;
use sorng_rdp::rdp::wake_channel::create_wake_channel;
use sorng_rdp::rdp::RdpSettingsPayload;

#[derive(Clone, Default)]
struct RecordingEmitter {
    events: Arc<Mutex<Vec<(String, Value)>>>,
}

impl RecordingEmitter {
    fn events_named(&self, event_name: &str) -> Vec<Value> {
        self.events
            .lock()
            .expect("events lock")
            .iter()
            .filter(|(event, _)| event == event_name)
            .map(|(_, payload)| payload.clone())
            .collect()
    }

    fn reconnect_messages(&self) -> Vec<String> {
        self.events_named("rdp://status")
            .into_iter()
            .filter(|payload| payload.get("status").and_then(Value::as_str) == Some("reconnecting"))
            .map(|payload| {
                payload
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string()
            })
            .collect()
    }

    fn auto_approve_prompt(&self, payload: &Value) -> Result<(), String> {
        let session_id = payload
            .get("sessionId")
            .and_then(Value::as_str)
            .map(str::to_string);
        let host = payload
            .get("host")
            .and_then(Value::as_str)
            .ok_or_else(|| "missing cert prompt host".to_string())?
            .to_string();
        let port = payload
            .get("port")
            .and_then(Value::as_u64)
            .ok_or_else(|| "missing cert prompt port".to_string())? as u16;
        let fingerprint = payload
            .get("fingerprint")
            .and_then(Value::as_str)
            .ok_or_else(|| "missing cert prompt fingerprint".to_string())?
            .to_string();

        submit_prompt_response(session_id, host, port, fingerprint, true, true)
    }
}

impl AppEventEmitter for RecordingEmitter {
    fn emit_event(&self, event: &str, payload: Value) -> Result<(), String> {
        self.events
            .lock()
            .expect("events lock")
            .push((event.to_string(), payload.clone()));

        if matches!(event, "rdp://cert-trust-prompt" | "rdp://cert-trust-change") {
            self.auto_approve_prompt(&payload)?;
        }

        Ok(())
    }
}

fn reconnect_settings() -> ResolvedSettings {
    let mut settings = ResolvedSettings::from_payload(&RdpSettingsPayload::default(), 4, 4);
    settings.reconnect_base_delay = Duration::from_secs(1);
    settings.reconnect_max_delay = Duration::from_secs(4);
    settings.reconnect_on_network_loss = true;
    settings
}

fn presented_cert(host: &str, port: u16) -> PresentedCertificate {
    PresentedCertificate {
        host: host.to_string(),
        port,
        fingerprint: "aa:bb:cc:dd".to_string(),
        subject: format!("CN={host}"),
        issuer: "CN=Reconnect Test CA".to_string(),
        valid_from: "2026-04-01T00:00:00+00:00".to_string(),
        valid_to: "2027-04-01T00:00:00+00:00".to_string(),
        serial: "12:34:56:78".to_string(),
        signature_algorithm: "1.2.840.113549.1.1.11".to_string(),
        san: vec![format!("DNS:{host}")],
        pem: "-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----".to_string(),
    }
}

fn seed_frame(store: &Arc<sorng_rdp::rdp::frame_store::SharedFrameStore>, session_id: &str, fill: u8) {
    store.init(session_id, 4, 4);
    let slots = store.slots.read().expect("frame slots lock");
    let mut slot = slots
        .get(session_id)
        .expect("frame slot")
        .inner
        .write()
        .expect("frame slot lock");
    slot.data.fill(fill);
}

fn snapshot_frame(
    store: &Arc<sorng_rdp::rdp::frame_store::SharedFrameStore>,
    session_id: &str,
) -> (u16, u16, Vec<u8>) {
    let slots = store.slots.read().expect("frame slots lock");
    let slot = slots
        .get(session_id)
        .expect("frame slot")
        .inner
        .read()
        .expect("frame slot lock");
    (slot.width, slot.height, slot.data.clone())
}

#[test]
fn reconnect_loop_reuses_cached_secret_and_resumes_frames() {
    let session_id = "reconnect-test-session";
    let host = "rdp.example.com";
    let port = 3389;
    let tempdir = tempfile::tempdir().expect("tempdir");

    initialize_store_path(Some(tempdir.path().to_path_buf()));

    let emitter = RecordingEmitter::default();
    let dyn_emitter: DynEventEmitter = Arc::new(emitter.clone());
    let _prompt_guard = bind_session_prompt_context(SessionPromptContext::new(
        session_id.to_string(),
        ServerCertValidationMode::Warn,
        Duration::from_secs(1),
        dyn_emitter.clone(),
    ));

    let cert = presented_cert(host, port);
    let frame_store = SharedFrameStore::new();
    let stats = Arc::new(RdpSessionStats::new());
    let (_cmd_tx, mut cmd_rx) = create_wake_channel().expect("wake channel");
    let (log_tx, _log_rx) = std::sync::mpsc::channel::<RdpLogEntry>();
    let settings = reconnect_settings();
    let cached_password = SecretString::new("opensesame".to_string());

    let mut establish_attempt = 0usize;
    let mut active_attempt = 0usize;
    let mut seen_passwords = Vec::new();
    let mut sleep_delays = Vec::new();
    let mut cleared_snapshots = Vec::new();

    let result = run_reconnect_loop_for_test(
        session_id,
        cached_password.expose_secret(),
        &settings,
        &dyn_emitter,
        &mut cmd_rx,
        &stats,
        &frame_store,
        &log_tx,
        |password, _cmd_rx| {
            seen_passwords.push(password.to_string());
            establish_attempt += 1;
            evaluate_presented_certificate(cert.clone(), ChainStatus::Valid)?;

            match establish_attempt {
                1 => {
                    seed_frame(&frame_store, session_id, 0x11);
                    Ok(establish_attempt)
                }
                2 => Err(io::Error::new(io::ErrorKind::ConnectionReset, "handshake reset").into()),
                3 => {
                    seed_frame(&frame_store, session_id, 0x22);
                    Ok(establish_attempt)
                }
                4 => {
                    seed_frame(&frame_store, session_id, 0x33);
                    Ok(establish_attempt)
                }
                other => panic!("unexpected establish attempt {other}"),
            }
        },
        |_session, _cmd_rx| {
            active_attempt += 1;
            match active_attempt {
                1 => SessionLoopExit::NetworkError("connection reset by peer".to_string()),
                2 => SessionLoopExit::NetworkError("connection reset by peer (again)".to_string()),
                3 => SessionLoopExit::Shutdown,
                other => panic!("unexpected active attempt {other}"),
            }
        },
        |_cmd_rx, delay| {
            sleep_delays.push(delay);
            cleared_snapshots.push(snapshot_frame(&frame_store, session_id));
            Ok(())
        },
    );

    assert!(result.is_ok(), "reconnect loop should finish cleanly: {result:?}");
    assert_eq!(establish_attempt, 4, "expected 4 total establish attempts");
    assert_eq!(active_attempt, 3, "expected 3 active-loop runs");
    assert_eq!(
        seen_passwords,
        vec!["opensesame", "opensesame", "opensesame", "opensesame"],
        "every reconnect should reuse the cached secret-backed password"
    );
    assert_eq!(
        sleep_delays,
        vec![
            Duration::from_secs(1),
            Duration::from_secs(2),
            Duration::from_secs(1),
        ],
        "reconnect waits should follow exponential backoff and reset after a successful reconnect"
    );
    assert_eq!(
        emitter.events_named("rdp://cert-trust-prompt").len(),
        1,
        "pinned reconnects should consult the trust store without prompting again"
    );
    assert_eq!(
        emitter.reconnect_messages(),
        vec![
            "Reconnecting (1)...".to_string(),
            "Reconnecting (2)... handshake reset".to_string(),
            "Reconnecting (1)...".to_string(),
        ],
        "reconnect status events should expose the attempt counter and reset after success"
    );

    for (width, height, data) in &cleared_snapshots {
        assert_eq!((*width, *height), (0, 0), "reconnect should clear the framebuffer shape before sleeping");
        assert!(data.is_empty(), "reconnect should drop stale frame pixels before the next connect attempt");
    }

    let (width, height, data) = snapshot_frame(&frame_store, session_id);
    assert_eq!((width, height), (4, 4), "final reconnect should restore the framebuffer dimensions");
    assert_eq!(data.len(), 4 * 4 * 4, "final frame should repopulate the framebuffer");
    assert!(
        data.iter().all(|byte| *byte == 0x33),
        "frame resumption should populate the post-reconnect framebuffer with the new frame"
    );
}