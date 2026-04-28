#![cfg(feature = "docker-e2e")]

//! RDPDR integration harness.
//!
//! The live xrdp session covers the behavior that is observable through the
//! stock `danielguerra/ubuntu-xrdp` desktop image: clipboard text round-trips
//! and clipboard direction policy. Drive announcement gating, read-only device
//! behavior, path traversal rejection, and CLIPRDR file payload streaming stay
//! deterministic here because this xrdp image exposes `~/thinclient_drives`
//! but does not reliably surface redirected shares for assertion, and it does
//! not provide a stable automation surface for issuing synthetic traversal IRPs
//! or a reliable file-paste action.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex, Once};
use std::time::Duration;

use secrecy::SecretString;
use serde_json::Value;
use sorng_core::events::{AppEventEmitter, DynEventEmitter};
use sorng_rdp::rdp::cert_trust::{
    bind_session_prompt_context, initialize_store_path, submit_prompt_response,
    ServerCertValidationMode, SessionPromptContext,
};
use sorng_rdp::rdp::clipboard::{
    build_file_list, ClipboardState, StagedFile, CF_UNICODETEXT, FILEGROUPDESCRIPTORW_ID,
};
use sorng_rdp::rdp::frame_channel::{DynFrameChannel, NoopFrameChannel};
use sorng_rdp::rdp::frame_store::SharedFrameStore;
use sorng_rdp::rdp::rdpdr::filesystem::FileSystemDevice;
use sorng_rdp::rdp::rdpdr::pdu::{
    encode_utf16le as encode_rdp_utf16le, read_u32, FILE_NON_DIRECTORY_FILE, FILE_OPEN,
    FILE_OPEN_IF, IRP_MJ_CREATE, IRP_MJ_WRITE, STATUS_ACCESS_DENIED, STATUS_SUCCESS,
};
use sorng_rdp::rdp::session_runner::{
    effective_drive_redirections, run_rdp_session, should_register_rdpdr,
};
use sorng_rdp::rdp::settings::{ClipboardDirection, DriveRedirectionConfig, ResolvedSettings};
use sorng_rdp::rdp::stats::RdpSessionStats;
use sorng_rdp::rdp::types::RdpLogEntry;
use sorng_rdp::rdp::wake_channel::{create_wake_channel, WakeSender};
use sorng_rdp::rdp::RdpSettingsPayload;
use sorng_rdp_vendor::ironrdp_cliprdr::pdu::{
    ClipboardFormat, ClipboardFormatId, FileContentsFlags, FileContentsRequest,
    FileContentsResponse, FormatDataRequest, FormatDataResponse,
};
use tempfile::TempDir;
use tokio::net::TcpStream;
use tokio::task::JoinHandle;
use uuid::Uuid;

const RDP_HOST_DEFAULT: &str = "127.0.0.1";
const RDP_PORT_DEFAULT: u16 = 13389;
const RDP_USER_DEFAULT: &str = "ubuntu";
const RDP_PASSWORD_DEFAULT: &str = "ubuntu";

static RUSTLS_PROVIDER: Once = Once::new();

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

    fn latest_status(&self) -> Option<Value> {
        self.events_named("rdp://status").into_iter().last()
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

struct SessionHarness {
    emitter: RecordingEmitter,
    cmd_tx: WakeSender,
    handle: JoinHandle<()>,
    _trust_store_dir: TempDir,
}

impl SessionHarness {
    async fn connect(settings: ResolvedSettings) -> Result<Self, String> {
        ensure_rustls_provider();

        let trust_store_dir = tempfile::tempdir().map_err(|error| format!("tempdir: {error}"))?;
        initialize_store_path(Some(trust_store_dir.path().to_path_buf()));

        let session_id = format!("rdpdr-e2e-{}", Uuid::new_v4());
        let emitter = RecordingEmitter::default();
        let dyn_emitter: DynEventEmitter = Arc::new(emitter.clone());
        let (cmd_tx, cmd_rx) = create_wake_channel().map_err(|error| format!("wake channel: {error}"))?;
        let stats = Arc::new(RdpSessionStats::new());
        let frame_store = SharedFrameStore::new();
        let frame_channel: DynFrameChannel = Arc::new(NoopFrameChannel);
        let (log_tx, _log_rx) = std::sync::mpsc::channel::<RdpLogEntry>();

        let host = env_or("RDP_HOST", RDP_HOST_DEFAULT);
        let port = env_or("RDP_PORT", &RDP_PORT_DEFAULT.to_string())
            .parse()
            .unwrap_or(RDP_PORT_DEFAULT);
        let username = env_or("RDP_USER", RDP_USER_DEFAULT);
        let password = SecretString::new(env_or("RDP_PASSWORD", RDP_PASSWORD_DEFAULT));
        let prompt_emitter = dyn_emitter.clone();

        let handle = tokio::task::spawn_blocking(move || {
            let _guard = bind_session_prompt_context(SessionPromptContext::new(
                session_id.clone(),
                ServerCertValidationMode::Warn,
                Duration::from_secs(10),
                prompt_emitter.clone(),
            ));

            run_rdp_session(
                session_id,
                host,
                port,
                username,
                password,
                None,
                settings,
                prompt_emitter,
                cmd_rx,
                stats,
                None,
                None,
                frame_store,
                frame_channel,
                log_tx,
            );
        });

        Ok(Self {
            emitter,
            cmd_tx,
            handle,
            _trust_store_dir: trust_store_dir,
        })
    }

    async fn wait_connected(&self) -> Result<(), String> {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(45);
        while tokio::time::Instant::now() < deadline {
            if let Some(status) = self.emitter.latest_status() {
                match status.get("status").and_then(Value::as_str) {
                    Some("connected") => return Ok(()),
                    Some("error") => {
                        let message = status
                            .get("message")
                            .and_then(Value::as_str)
                            .unwrap_or("unknown session error");
                        return Err(message.to_string());
                    }
                    _ => {}
                }
            }
            tokio::time::sleep(Duration::from_millis(200)).await;
        }

        Err("timed out waiting for RDP session to connect".to_string())
    }

    async fn wait_connected_dimensions(&self, width: u16, height: u16) -> Result<(), String> {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(30);
        let width = u64::from(width);
        let height = u64::from(height);

        while tokio::time::Instant::now() < deadline {
            let statuses = self.emitter.events_named("rdp://status");
            if statuses.iter().any(|status| {
                status.get("status").and_then(Value::as_str) == Some("connected")
                    && status.get("desktop_width").and_then(Value::as_u64) == Some(width)
                    && status.get("desktop_height").and_then(Value::as_u64) == Some(height)
            }) {
                return Ok(());
            }

            if let Some(status) = statuses.last() {
                if status.get("status").and_then(Value::as_str) == Some("error") {
                    let message = status
                        .get("message")
                        .and_then(Value::as_str)
                        .unwrap_or("unknown session error");
                    return Err(message.to_string());
                }
            }

            tokio::time::sleep(Duration::from_millis(200)).await;
        }

        Err(format!(
            "timed out waiting for resized connected status {width}x{height}"
        ))
    }

    async fn shutdown(self) -> Result<(), String> {
        let _ = self.cmd_tx.send(sorng_rdp::rdp::types::RdpCommand::Shutdown);

        tokio::time::timeout(Duration::from_secs(20), self.handle)
            .await
            .map_err(|_| "timed out waiting for the RDP session to stop".to_string())?
            .map_err(|error| format!("session task join failed: {error}"))
    }
}

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

fn ensure_rustls_provider() {
    RUSTLS_PROVIDER.call_once(|| {
        let _ = rustls::crypto::ring::default_provider().install_default();
    });
}

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("..")
        .canonicalize()
        .expect("repo root")
}

fn base_settings() -> ResolvedSettings {
    let mut settings = ResolvedSettings::from_payload(&RdpSettingsPayload::default(), 1024, 768);
    settings.enable_audio_playback = false;
    settings.enable_audio_recording = false;
    settings.codecs_enabled = false;
    settings.remotefx_enabled = false;
    settings.gfx_enabled = false;
    settings.reconnect_on_network_loss = false;
    settings
}

fn drive(name: &str, path: &Path, read_only: bool, preferred_letter: char) -> DriveRedirectionConfig {
    DriveRedirectionConfig {
        name: name.to_string(),
        path: path.to_string_lossy().into_owned(),
        read_only,
        preferred_letter: Some(preferred_letter),
    }
}

async fn wait_for_port(host: &str, port: u16, timeout: Duration) -> Result<(), String> {
    let deadline = tokio::time::Instant::now() + timeout;
    let addr = format!("{host}:{port}");
    let mut last_error: Option<String> = None;

    while tokio::time::Instant::now() < deadline {
        match tokio::time::timeout(Duration::from_secs(2), TcpStream::connect(&addr)).await {
            Ok(Ok(_stream)) => return Ok(()),
            Ok(Err(error)) => last_error = Some(error.to_string()),
            Err(_) => last_error = Some("connect timed out after 2s".to_string()),
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }

    Err(format!(
        "port {host}:{port} unreachable within {timeout:?} (last error: {last_error:?})"
    ))
}

async fn ensure_test_rdp_available() -> Result<String, String> {
    Command::new("docker")
        .arg("--version")
        .output()
        .map_err(|error| format!("docker CLI not available: {error}"))?;

    let compose = repo_root().join("e2e").join("docker-compose.yml");
    let output = Command::new("docker")
        .arg("compose")
        .arg("-f")
        .arg(&compose)
        .arg("ps")
        .arg("-q")
        .arg("test-rdp")
        .output()
        .map_err(|error| format!("spawn docker compose ps: {error}"))?;

    if !output.status.success() {
        return Err(format!(
            "docker compose ps failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    let container_id = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if container_id.is_empty() {
        return Err(format!(
            "test-rdp container is not running; start it with `docker compose -f {} up -d test-rdp`",
            compose.display()
        ));
    }

    wait_for_port(
        &env_or("RDP_HOST", RDP_HOST_DEFAULT),
        env_or("RDP_PORT", &RDP_PORT_DEFAULT.to_string())
            .parse()
            .unwrap_or(RDP_PORT_DEFAULT),
        Duration::from_secs(20),
    )
    .await?;

    Ok(container_id)
}

fn docker_exec(container_id: &str, user: Option<&str>, script: &str) -> Result<String, String> {
    let mut command = Command::new("docker");
    command.arg("exec");
    if let Some(user) = user {
        command.arg("--user").arg(user);
    }
    command.arg(container_id).arg("bash").arg("-c");
    if user == Some("ubuntu") {
        command.arg(format!("export HOME=/home/ubuntu; {script}"));
    } else {
        command.arg(script);
    }

    let output = command
        .output()
        .map_err(|error| format!("spawn docker exec: {error}"))?;
    if !output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "docker exec failed with {}\nstdout: {}\nstderr: {}",
            output.status,
            stdout.trim(),
            stderr.trim()
        ));
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

async fn wait_for_remote_display(container_id: &str, timeout: Duration) -> Result<String, String> {
    let deadline = tokio::time::Instant::now() + timeout;
    while tokio::time::Instant::now() < deadline {
        let display = docker_exec(
            container_id,
            None,
            "ls /tmp/.X11-unix 2>/dev/null | sed -n 's/^X/:/p' | sort | tail -n 1",
        )?;
        if display.starts_with(':') {
            return Ok(display);
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }

    Err("timed out waiting for the remote X display".to_string())
}

fn build_create_request(remote_path: &str, desired_access: u32, disposition: u32, options: u32) -> Vec<u8> {
    let path = encode_rdp_utf16le(remote_path);
    let mut request = Vec::with_capacity(32 + path.len());
    request.extend_from_slice(&desired_access.to_le_bytes());
    request.extend_from_slice(&0u64.to_le_bytes());
    request.extend_from_slice(&0u32.to_le_bytes());
    request.extend_from_slice(&0u32.to_le_bytes());
    request.extend_from_slice(&disposition.to_le_bytes());
    request.extend_from_slice(&options.to_le_bytes());
    request.extend_from_slice(&(path.len() as u32).to_le_bytes());
    request.extend_from_slice(&path);
    request
}

fn build_write_request(data: &[u8], offset: u64) -> Vec<u8> {
    let mut request = Vec::with_capacity(32 + data.len());
    request.extend_from_slice(&(data.len() as u32).to_le_bytes());
    request.extend_from_slice(&offset.to_le_bytes());
    request.resize(32, 0);
    request.extend_from_slice(data);
    request
}

fn io_status(io_completion: &[u8]) -> u32 {
    read_u32(io_completion, 12)
}

fn io_output_u32(io_completion: &[u8], offset: usize) -> u32 {
    read_u32(io_completion, 16 + offset)
}

fn serve_staged_file_contents(
    state: &mut ClipboardState,
    request: &FileContentsRequest,
) -> FileContentsResponse<'static> {
    let file = state
        .staged_files
        .get(request.index as usize)
        .expect("staged file");

    if request.flags.contains(FileContentsFlags::SIZE) {
        return FileContentsResponse::new_size_response(request.stream_id, file.size);
    }

    let mut handle = std::fs::File::open(&file.path).expect("open staged file");
    use std::io::{Read, Seek, SeekFrom};

    handle
        .seek(SeekFrom::Start(request.position))
        .expect("seek staged file");

    let mut buffer = vec![0u8; request.requested_size as usize];
    let read = handle.read(&mut buffer).expect("read staged file");
    buffer.truncate(read);
    state.file_bytes_transferred += read as u64;

    FileContentsResponse::new_data_response(request.stream_id, buffer)
}

#[test]
fn filesystem_device_rejects_traversal_and_read_only_writes() {
    let root = tempfile::tempdir().expect("tempdir");
    let existing_path = root.path().join("existing.txt");
    std::fs::write(&existing_path, b"seed").expect("seed file");

    let mut device = FileSystemDevice::new(7, root.path().to_path_buf(), true);

    let traversal = device
        .handle_irp(
            IRP_MJ_CREATE,
            0,
            1,
            0,
            &build_create_request("..\\..\\outside.txt", 0, FILE_OPEN_IF, FILE_NON_DIRECTORY_FILE),
        )
        .expect("traversal response");
    assert_eq!(
        io_status(&traversal),
        STATUS_ACCESS_DENIED,
        "path traversal should be rejected before the host path is resolved"
    );

    let open_existing = device
        .handle_irp(
            IRP_MJ_CREATE,
            0,
            2,
            0,
            &build_create_request("existing.txt", 0, FILE_OPEN, FILE_NON_DIRECTORY_FILE),
        )
        .expect("open response");
    assert_eq!(
        io_status(&open_existing),
        STATUS_SUCCESS,
        "read-only drives should still allow opening existing files for reads"
    );

    let file_id = io_output_u32(&open_existing, 0);
    let write = device
        .handle_irp(IRP_MJ_WRITE, 0, 3, file_id, &build_write_request(b"blocked", 0))
        .expect("write response");
    assert_eq!(
        io_status(&write),
        STATUS_ACCESS_DENIED,
        "read-only drives should reject write IRPs after a successful open"
    );

    assert_eq!(
        std::fs::read_to_string(&existing_path).expect("existing file"),
        "seed",
        "the host file should remain unchanged after a blocked write"
    );
}

#[test]
fn drive_flag_off_suppresses_rdpdr_drive_announcements() {
    let root = tempfile::tempdir().expect("tempdir");

    let mut disabled = base_settings();
    disabled.drive_redirection_enabled = false;
    disabled.drive_redirections = vec![drive("disabled", root.path(), false, 'R')];
    assert!(
        effective_drive_redirections(&disabled).is_empty(),
        "configured drives should be dropped entirely when drive redirection is disabled"
    );
    assert!(
        !should_register_rdpdr(&disabled),
        "without effective drives or other RDPDR devices, the channel should stay unregistered"
    );

    let mut enabled = base_settings();
    enabled.drive_redirection_enabled = true;
    enabled.drive_redirections = vec![drive("enabled", root.path(), true, 'R')];
    assert_eq!(
        effective_drive_redirections(&enabled).len(),
        1,
        "enabling drive redirection should preserve configured drives for announcement"
    );
    assert!(
        should_register_rdpdr(&enabled),
        "an effective redirected drive should force RDPDR channel registration"
    );
}

#[test]
fn clipboard_file_round_trip_encodes_file_list_and_streams_bytes() {
    let dir = tempfile::tempdir().expect("tempdir");
    let contents = b"cliprdr-file-payload";
    let path = dir.path().join("payload.txt");
    std::fs::write(&path, contents).expect("staged file");

    let staged = StagedFile {
        name: "payload.txt".to_string(),
        size: contents.len() as u64,
        path: path.to_string_lossy().into_owned(),
        is_directory: false,
    };

    let mut state = ClipboardState::new(ClipboardDirection::Bidirectional);
    state.staged_files = vec![staged.clone()];

    let format_request = FormatDataRequest {
        format: ClipboardFormatId::new(FILEGROUPDESCRIPTORW_ID),
    };
    assert!(
        state.queue_format_data_request(format_request),
        "bidirectional clipboard should allow local file advertisement"
    );

    let file_list_response = FormatDataResponse::new_file_list(&build_file_list(&state.staged_files))
        .expect("encode file list");
    let decoded_file_list = file_list_response.to_file_list().expect("decode file list");
    assert_eq!(decoded_file_list.files.len(), 1);
    assert_eq!(decoded_file_list.files[0].name, staged.name);
    assert_eq!(decoded_file_list.files[0].file_size, Some(staged.size));

    let size_request = FileContentsRequest {
        stream_id: 11,
        index: 0,
        flags: FileContentsFlags::SIZE,
        position: 0,
        requested_size: 8,
        data_id: None,
    };
    let size_response = serve_staged_file_contents(&mut state, &size_request);
    assert_eq!(
        size_response.data_as_size().expect("size response"),
        staged.size,
        "the file-clipboard size probe should round-trip the staged file length"
    );

    let data_request = FileContentsRequest {
        stream_id: 12,
        index: 0,
        flags: FileContentsFlags::DATA,
        position: 4,
        requested_size: 5,
        data_id: None,
    };
    let data_response = serve_staged_file_contents(&mut state, &data_request);
    assert_eq!(data_response.data(), &contents[4..9]);
    assert_eq!(
        state.file_bytes_transferred,
        5,
        "streaming file-clipboard bytes should advance transfer progress"
    );
}

#[test]
fn clipboard_text_round_trip_and_direction_policies_are_enforced() {
    let text = "clipboard text payload";
    let remote_text_response = FormatDataResponse::new_unicode_string(text);
    assert_eq!(
        remote_text_response
            .to_unicode_string()
            .expect("decode unicode clipboard text"),
        text,
        "text clipboard payloads should round-trip through CLIPRDR encoding"
    );

    let remote_format = ClipboardFormat::new(ClipboardFormatId::new(CF_UNICODETEXT));

    let mut bidirectional = ClipboardState::new(ClipboardDirection::Bidirectional);
    bidirectional.local_text = Some(text.to_string());
    assert!(bidirectional.store_remote_formats(std::slice::from_ref(&remote_format)));
    assert!(bidirectional.queue_format_data_request(FormatDataRequest {
        format: ClipboardFormatId::new(CF_UNICODETEXT),
    }));
    assert_eq!(bidirectional.local_text.as_deref(), Some(text));
    assert_eq!(bidirectional.remote_formats.len(), 1);

    let mut client_to_server = ClipboardState::new(ClipboardDirection::ClientToServer);
    client_to_server.local_text = Some(text.to_string());
    assert!(!client_to_server.store_remote_formats(std::slice::from_ref(&remote_format)));
    assert!(client_to_server.remote_formats.is_empty());
    assert!(client_to_server.queue_format_data_request(FormatDataRequest {
        format: ClipboardFormatId::new(CF_UNICODETEXT),
    }));
    assert_eq!(client_to_server.local_text.as_deref(), Some(text));

    let mut server_to_client = ClipboardState::new(ClipboardDirection::ServerToClient);
    server_to_client.local_text = Some(text.to_string());
    assert!(server_to_client.store_remote_formats(std::slice::from_ref(&remote_format)));
    assert!(!server_to_client.queue_format_data_request(FormatDataRequest {
        format: ClipboardFormatId::new(CF_UNICODETEXT),
    }));
    assert!(server_to_client.local_text.is_none());
    assert_eq!(server_to_client.remote_formats.len(), 1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires `docker compose -f e2e/docker-compose.yml up -d test-rdp`; run with --features docker-e2e -- --ignored --test-threads=1"]
async fn live_rdpdr_docker_harness() {
    let container_id = ensure_test_rdp_available()
        .await
        .expect("xrdp docker service should be available");

    let smoke_root = tempfile::tempdir().expect("smoke tempdir");
    std::fs::write(smoke_root.path().join("smoke.txt"), "smoke").expect("smoke file");

    let mut smoke_settings = base_settings();
    smoke_settings.clipboard_enabled = true;
    smoke_settings.clipboard_direction = ClipboardDirection::Bidirectional;
    smoke_settings.drive_redirection_enabled = true;
    smoke_settings.drive_redirections = vec![drive("smoke", smoke_root.path(), true, 'R')];

    let smoke = SessionHarness::connect(smoke_settings)
        .await
        .expect("spawn live smoke session");
    smoke.wait_connected().await.expect("connect live smoke session");
    let display = wait_for_remote_display(&container_id, Duration::from_secs(20))
        .await
        .expect("remote display for live smoke session");
    assert_eq!(
        display.chars().next(),
        Some(':'),
        "the live smoke should reach a real desktop session with an X display"
    );
    smoke.shutdown().await.expect("shutdown live smoke session");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires `docker compose -f e2e/docker-compose.yml up -d test-rdp`; run with --features docker-e2e -- --ignored --test-threads=1"]
async fn live_dynamic_resize_docker_harness() {
    let container_id = ensure_test_rdp_available()
        .await
        .expect("xrdp docker service should be available");

    let smoke = SessionHarness::connect(base_settings())
        .await
        .expect("spawn live resize smoke session");
    smoke
        .wait_connected()
        .await
        .expect("connect live resize smoke session");

    let display = wait_for_remote_display(&container_id, Duration::from_secs(20))
        .await
        .expect("remote display for live resize smoke session");
    assert_eq!(
        display.chars().next(),
        Some(':'),
        "the live resize smoke should reach a real desktop session with an X display"
    );

    smoke
        .cmd_tx
        .send(sorng_rdp::rdp::types::RdpCommand::SetDesktopSize {
            width: 1280,
            height: 720,
        })
        .expect("queue dynamic resize request");

    smoke
        .wait_connected_dimensions(1280, 720)
        .await
        .expect("observe resized connected status");

    smoke
        .shutdown()
        .await
        .expect("shutdown live resize smoke session");
}