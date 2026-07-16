//! Deterministic PSRP-over-WSMan contract tests.
//!
//! The development host used for this milestone had no HTTPS WinRM listener,
//! so the live row remains ignored and unclaimed. These tests exercise the
//! real reqwest/auth adapter against a bounded in-process HTTPS/SOAP peer.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use base64::Engine as _;
use chrono::Utc;
use psrp_rs::clixml::{to_clixml, PsObject, PsValue};
use psrp_rs::fragment::{encode_message, Reassembler};
use psrp_rs::message::{Destination, MessageType, PsrpMessage};
use psrp_rs::{Pipeline, PipelineState, PsrpError, RunspacePool};
use sha2::{Digest, Sha256};
use sorng_storage::trust_store::{CertIdentity, Identity, SyncTrustStore};
use sorng_tls_trust::TLS_RECORD_TYPE;
use tempfile::TempDir;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use tokio_rustls::rustls::pki_types::{CertificateDer, PrivateKeyDer};
use tokio_rustls::rustls::ServerConfig;
use tokio_rustls::TlsAcceptor;
use tokio_util::sync::CancellationToken;

use sorng_powershell::psrp_wsman::{
    canonical_wsman_endpoint, WsmanPsrpLimits, WsmanPsrpTransport, PSRP_WSMAN_LIMITATIONS,
};
use sorng_powershell::runspace_session::{
    PowerShellEventEnvelope, PowerShellSessionNetworkPath, PowerShellSessionOptions,
    PowerShellSessionPhase, PowerShellSessionService, PowerShellSessionSink, PowerShellSinkError,
    PowerShellStreamKind, PowerShellWsmanAuth, PowerShellWsmanSessionOptions,
    PowerShellWsmanTrustPolicy,
};
use sorng_powershell::test_support::WinRmTestTrust;
use sorng_powershell::types::{PsAuthMethod, PsRemotingConfig, PsTransportProtocol};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FixtureMode {
    Flow,
    Fault,
    Oversized,
    RejectAuth,
}

#[derive(Debug, Default)]
struct FixtureState {
    authenticated: bool,
    ntlm_message_types: Vec<u32>,
    request_paths: Vec<String>,
    actions: Vec<String>,
    shell_id: String,
    command_count: usize,
    active_command_id: Option<String>,
    active_rpid: Option<uuid::Uuid>,
    active_pid: Option<uuid::Uuid>,
    cancelled: bool,
    next_object_id: u64,
}

impl FixtureState {
    fn new() -> Self {
        Self {
            shell_id: "SHELL_0001".to_string(),
            next_object_id: 100,
            ..Self::default()
        }
    }
}

struct SoapFixture {
    endpoint: String,
    state: Arc<Mutex<FixtureState>>,
    trust: WinRmTestTrust,
    _trust_directory: TempDir,
    shutdown: Option<oneshot::Sender<()>>,
    task: tokio::task::JoinHandle<()>,
}

impl SoapFixture {
    async fn start(mode: FixtureMode) -> Self {
        let _ = tokio_rustls::rustls::crypto::ring::default_provider().install_default();
        let certificate =
            rcgen::generate_simple_self_signed(vec!["127.0.0.1".to_string()]).unwrap();
        let certificate_der = certificate.serialize_der().unwrap();
        let private_key_der = certificate.serialize_private_key_der();
        let server_config = ServerConfig::builder()
            .with_no_client_auth()
            .with_single_cert(
                vec![CertificateDer::from(certificate_der.clone())],
                PrivateKeyDer::Pkcs8(private_key_der.into()),
            )
            .unwrap();
        let acceptor = TlsAcceptor::from(Arc::new(server_config));

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let trust_directory = tempfile::tempdir().unwrap();
        let trust_store = Arc::new(SyncTrustStore::new(
            trust_directory.path().join("trust_store.json"),
        ));
        let now = Utc::now().to_rfc3339();
        trust_store
            .trust_identity_blocking(
                format!("127.0.0.1:{}", address.port()),
                TLS_RECORD_TYPE.to_string(),
                Identity::Tls(CertIdentity {
                    fingerprint: hex::encode(Sha256::digest(&certificate_der)),
                    subject: Some("127.0.0.1".to_string()),
                    issuer: Some("127.0.0.1".to_string()),
                    first_seen: now.clone(),
                    last_seen: now,
                    valid_from: None,
                    valid_to: None,
                    pem: None,
                    serial: None,
                    signature_algorithm: None,
                    san: Some(vec!["127.0.0.1".to_string()]),
                    chain_fingerprints: Vec::new(),
                }),
                true,
            )
            .unwrap();
        let trust = WinRmTestTrust::new(trust_store);
        let state = Arc::new(Mutex::new(FixtureState::new()));
        let (shutdown_tx, mut shutdown_rx) = oneshot::channel();
        let task_state = state.clone();
        let task = tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = &mut shutdown_rx => break,
                    accepted = listener.accept() => {
                        let Ok((stream, _)) = accepted else { break };
                        let connection_state = task_state.clone();
                        let acceptor = acceptor.clone();
                        tokio::spawn(async move {
                            if let Ok(stream) = acceptor.accept(stream).await {
                                serve_connection(stream, mode, connection_state).await;
                            }
                        });
                    }
                }
            }
        });
        Self {
            endpoint: format!("https://{address}/custom/wsman/wsman"),
            state,
            trust,
            _trust_directory: trust_directory,
            shutdown: Some(shutdown_tx),
            task,
        }
    }

    fn trust(&self) -> &WinRmTestTrust {
        &self.trust
    }

    fn snapshot(&self) -> FixtureSnapshot {
        let state = lock(&self.state);
        FixtureSnapshot {
            ntlm_message_types: state.ntlm_message_types.clone(),
            request_paths: state.request_paths.clone(),
            actions: state.actions.clone(),
            command_count: state.command_count,
        }
    }

    async fn stop(mut self) {
        if let Some(shutdown) = self.shutdown.take() {
            let _ = shutdown.send(());
        }
        let _ = self.task.await;
    }
}

#[derive(Debug)]
struct FixtureSnapshot {
    ntlm_message_types: Vec<u32>,
    request_paths: Vec<String>,
    actions: Vec<String>,
    command_count: usize,
}

#[derive(Default)]
struct RecordingSink {
    events: Mutex<Vec<PowerShellEventEnvelope>>,
}

impl PowerShellSessionSink for RecordingSink {
    fn send(&self, envelope: &PowerShellEventEnvelope) -> Result<(), PowerShellSinkError> {
        lock(&self.events).push(envelope.clone());
        Ok(())
    }
}

#[derive(Debug)]
struct HttpRequest {
    path: String,
    headers: HashMap<String, String>,
    body: String,
}

#[derive(Debug)]
struct HttpResponse {
    status: u16,
    reason: &'static str,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

impl HttpResponse {
    fn xml(status: u16, body: impl Into<Vec<u8>>) -> Self {
        Self {
            status,
            reason: if status < 400 {
                "OK"
            } else {
                "Internal Server Error"
            },
            headers: vec![("Content-Type".into(), "application/soap+xml".into())],
            body: body.into(),
        }
    }

    fn unauthorized(challenge: String) -> Self {
        Self {
            status: 401,
            reason: "Unauthorized",
            headers: vec![("WWW-Authenticate".into(), challenge)],
            body: Vec::new(),
        }
    }
}

async fn serve_connection<S>(mut stream: S, mode: FixtureMode, state: Arc<Mutex<FixtureState>>)
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let mut buffer = Vec::new();
    while let Some(request) = read_request(&mut stream, &mut buffer).await {
        let response = handle_request(mode, &state, request);
        if write_response(&mut stream, response).await.is_err() {
            break;
        }
    }
}

async fn read_request<S>(stream: &mut S, buffer: &mut Vec<u8>) -> Option<HttpRequest>
where
    S: AsyncRead + Unpin,
{
    let header_end = loop {
        if let Some(position) = find_subslice(buffer, b"\r\n\r\n") {
            break position + 4;
        }
        let mut chunk = [0u8; 4096];
        let read = stream.read(&mut chunk).await.ok()?;
        if read == 0 {
            return None;
        }
        buffer.extend_from_slice(&chunk[..read]);
        if buffer.len() > 1024 * 1024 {
            return None;
        }
    };

    let header_text = std::str::from_utf8(&buffer[..header_end]).ok()?;
    let mut lines = header_text.split("\r\n");
    let request_line = lines.next()?;
    let mut request_parts = request_line.split_ascii_whitespace();
    if request_parts.next()? != "POST" {
        return None;
    }
    let path = request_parts.next()?.to_string();
    let mut headers = HashMap::new();
    for line in lines.filter(|line| !line.is_empty()) {
        let (name, value) = line.split_once(':')?;
        headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_string());
    }
    let content_length = headers
        .get("content-length")
        .and_then(|value| value.parse::<usize>().ok())?;
    while buffer.len() < header_end + content_length {
        let mut chunk = [0u8; 4096];
        let read = stream.read(&mut chunk).await.ok()?;
        if read == 0 {
            return None;
        }
        buffer.extend_from_slice(&chunk[..read]);
    }
    let body = String::from_utf8(buffer[header_end..header_end + content_length].to_vec()).ok()?;
    buffer.drain(..header_end + content_length);
    Some(HttpRequest {
        path,
        headers,
        body,
    })
}

async fn write_response<S>(stream: &mut S, response: HttpResponse) -> std::io::Result<()>
where
    S: AsyncWrite + Unpin,
{
    let mut head = format!(
        "HTTP/1.1 {} {}\r\nContent-Length: {}\r\nConnection: keep-alive\r\n",
        response.status,
        response.reason,
        response.body.len()
    );
    for (name, value) in response.headers {
        head.push_str(&format!("{name}: {value}\r\n"));
    }
    head.push_str("\r\n");
    stream.write_all(head.as_bytes()).await?;
    stream.write_all(&response.body).await?;
    stream.flush().await
}

fn handle_request(
    mode: FixtureMode,
    state: &Arc<Mutex<FixtureState>>,
    request: HttpRequest,
) -> HttpResponse {
    let mut state = lock(state);
    state.request_paths.push(request.path);
    let auth_type = request
        .headers
        .get("authorization")
        .and_then(|value| ntlm_message_type(value));
    if let Some(message_type) = auth_type {
        state.ntlm_message_types.push(message_type);
    }

    if !state.authenticated {
        match auth_type {
            None => return HttpResponse::unauthorized("NTLM".into()),
            Some(1) => return HttpResponse::unauthorized(ntlm_type2_challenge()),
            Some(3) if mode != FixtureMode::RejectAuth => state.authenticated = true,
            Some(3) => return HttpResponse::unauthorized(ntlm_type2_challenge()),
            _ => return HttpResponse::unauthorized("NTLM".into()),
        }
    }

    if mode == FixtureMode::Fault {
        return HttpResponse::xml(
            500,
            br#"<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:f="http://schemas.microsoft.com/wbem/wsman/1/wsmanfault"><s:Body><s:Fault><s:Reason><s:Text>Access denied for alice</s:Text></s:Reason><s:Detail><f:WSManFault Code="5"><f:Message>Access denied</f:Message><Secret>do-not-leak</Secret></f:WSManFault></s:Detail></s:Fault></s:Body></s:Envelope>"#
                .to_vec(),
        );
    }
    if mode == FixtureMode::Oversized {
        return HttpResponse::xml(200, vec![b'x'; 4096]);
    }

    let action = element_text(&request.body, "a:Action").unwrap_or_default();
    let action_name = action.rsplit('/').next().unwrap_or(&action).to_string();
    state.actions.push(action_name.clone());
    match action_name.as_str() {
        "Create" => create_response(&mut state, &request.body),
        "Command" => command_response(&mut state, &request.body),
        "Receive" => receive_response(&mut state),
        "Send" => HttpResponse::xml(200, soap_body("<rsp:SendResponse/>", "")),
        "Signal" => {
            state.cancelled = true;
            HttpResponse::xml(200, soap_body("<rsp:SignalResponse/>", ""))
        }
        "Delete" => HttpResponse::xml(200, soap_body("", "")),
        other => HttpResponse::xml(
            500,
            soap_fault("2150858793", &format!("unexpected action {other}")),
        ),
    }
}

fn create_response(state: &mut FixtureState, request: &str) -> HttpResponse {
    let encoded = element_text(request, "pwsh:creationXml").expect("creationXml");
    let messages = decode_fragment_messages(&decode_base64(&encoded));
    assert_eq!(
        messages
            .iter()
            .map(|message| message.message_type)
            .collect::<Vec<_>>(),
        vec![
            MessageType::SessionCapability,
            MessageType::InitRunspacePool
        ]
    );
    let rpid = messages[0].rpid;
    state.active_rpid = Some(rpid);
    let opened = PsrpMessage {
        destination: Destination::Client,
        message_type: MessageType::RunspacePoolState,
        rpid,
        pid: uuid::Uuid::nil(),
        data: to_clixml(&PsValue::Object(
            PsObject::new().with("RunspaceState", PsValue::I32(2)),
        )),
    };
    let wire = encode_message(next_oid(state), &opened.encode());
    let creation = base64::engine::general_purpose::STANDARD.encode(wire);
    HttpResponse::xml(
        200,
        soap_body(
            &format!(
                "<rsp:Shell ShellId=\"{}\"><pwsh:creationXml>{creation}</pwsh:creationXml></rsp:Shell>",
                state.shell_id
            ),
            "",
        ),
    )
}

fn command_response(state: &mut FixtureState, request: &str) -> HttpResponse {
    let encoded = element_text(request, "rsp:Command").expect("Command payload");
    let messages = decode_fragment_messages(&decode_base64(&encoded));
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0].message_type, MessageType::CreatePipeline);
    state.command_count += 1;
    state.active_rpid = Some(messages[0].rpid);
    state.active_pid = Some(messages[0].pid);
    state.cancelled = false;
    let command_id = format!("COMMAND_{}", state.command_count);
    state.active_command_id = Some(command_id.clone());
    HttpResponse::xml(
        200,
        soap_body(
            &format!("<rsp:CommandResponse CommandId=\"{command_id}\"/>"),
            "",
        ),
    )
}

fn receive_response(state: &mut FixtureState) -> HttpResponse {
    let rpid = state.active_rpid.expect("active rpid");
    let pid = state.active_pid.expect("active pid");
    let command_id = state.active_command_id.clone().expect("active command id");
    let terminal_state = if state.cancelled { 3 } else { 4 };
    let mut wire = Vec::new();
    if !state.cancelled {
        for (message_type, value) in [
            (MessageType::PipelineOutput, "output"),
            (MessageType::ErrorRecord, "error"),
            (MessageType::WarningRecord, "warning"),
            (MessageType::VerboseRecord, "verbose"),
            (MessageType::DebugRecord, "debug"),
            (MessageType::InformationRecord, "information"),
            (MessageType::ProgressRecord, "progress"),
        ] {
            let message = PsrpMessage {
                destination: Destination::Client,
                message_type,
                rpid,
                pid,
                data: to_clixml(&PsValue::String(format!("{value}-{}", state.command_count))),
            };
            wire.extend_from_slice(&encode_message(next_oid(state), &message.encode()));
        }
    }
    let terminal = PsrpMessage {
        destination: Destination::Client,
        message_type: MessageType::PipelineState,
        rpid,
        pid,
        data: to_clixml(&PsValue::Object(
            PsObject::new().with("PipelineState", PsValue::I32(terminal_state)),
        )),
    };
    wire.extend_from_slice(&encode_message(next_oid(state), &terminal.encode()));
    let encoded = base64::engine::general_purpose::STANDARD.encode(wire);
    state.active_command_id = None;
    HttpResponse::xml(
        200,
        soap_body(
            &format!(
                "<rsp:ReceiveResponse><rsp:Stream Name=\"stdout\" CommandId=\"{command_id}\">{encoded}</rsp:Stream><rsp:CommandState CommandId=\"{command_id}\" State=\"http://schemas.microsoft.com/wbem/wsman/1/windows/shell/CommandState/Done\"/></rsp:ReceiveResponse>"
            ),
            "",
        ),
    )
}

fn soap_body(body: &str, header: &str) -> Vec<u8> {
    format!(
        "<?xml version=\"1.0\"?><s:Envelope xmlns:s=\"http://www.w3.org/2003/05/soap-envelope\" xmlns:rsp=\"http://schemas.microsoft.com/wbem/wsman/1/windows/shell\" xmlns:pwsh=\"http://schemas.microsoft.com/powershell\"><s:Header>{header}</s:Header><s:Body>{body}</s:Body></s:Envelope>"
    )
    .into_bytes()
}

fn soap_fault(code: &str, message: &str) -> Vec<u8> {
    format!(
        "<s:Envelope xmlns:s=\"http://www.w3.org/2003/05/soap-envelope\" xmlns:f=\"http://schemas.microsoft.com/wbem/wsman/1/wsmanfault\"><s:Body><s:Fault><s:Reason><s:Text>{message}</s:Text></s:Reason><s:Detail><f:WSManFault Code=\"{code}\"/></s:Detail></s:Fault></s:Body></s:Envelope>"
    )
    .into_bytes()
}

fn element_text(xml: &str, qualified_name: &str) -> Option<String> {
    let exact = format!("<{qualified_name}>");
    let attributed = format!("<{qualified_name} ");
    let (start, content_start) = if let Some(start) = xml.find(&exact) {
        (start, start + exact.len())
    } else {
        let start = xml.find(&attributed)?;
        (start, start + xml[start..].find('>')? + 1)
    };
    let close = format!("</{qualified_name}>");
    let content_end = content_start + xml[content_start..].find(&close)?;
    debug_assert!(content_start > start);
    Some(xml[content_start..content_end].trim().to_string())
}

fn decode_base64(value: &str) -> Vec<u8> {
    base64::engine::general_purpose::STANDARD
        .decode(value.as_bytes())
        .unwrap()
}

fn decode_fragment_messages(bytes: &[u8]) -> Vec<PsrpMessage> {
    let mut reassembler = Reassembler::new();
    reassembler
        .feed(bytes)
        .unwrap()
        .into_iter()
        .map(|message| PsrpMessage::decode(&message).unwrap())
        .collect()
}

fn next_oid(state: &mut FixtureState) -> u64 {
    let value = state.next_object_id;
    state.next_object_id += 1;
    value
}

fn ntlm_type2_challenge() -> String {
    let mut message = vec![0u8; 32];
    message[..8].copy_from_slice(b"NTLMSSP\0");
    message[8..12].copy_from_slice(&2u32.to_le_bytes());
    message[24..32].copy_from_slice(b"CHALLENG");
    format!(
        "NTLM {}",
        base64::engine::general_purpose::STANDARD.encode(message)
    )
}

fn ntlm_message_type(header: &str) -> Option<u32> {
    let token = header
        .strip_prefix("NTLM ")
        .or_else(|| header.strip_prefix("Negotiate "))?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(token)
        .ok()?;
    if bytes.get(..8)? != b"NTLMSSP\0" {
        return None;
    }
    Some(u32::from_le_bytes(bytes.get(8..12)?.try_into().ok()?))
}

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

fn remoting_config(endpoint: String, auth_method: PsAuthMethod) -> PsRemotingConfig {
    let uses_tls = endpoint.starts_with("https://");
    let mut config: PsRemotingConfig = serde_json::from_value(serde_json::json!({
        "computerName": "127.0.0.1",
        "transport": if uses_tls { "https" } else { "http" },
        "authMethod": auth_method,
        "credential": {
            "username": "alice",
            "password": "do-not-log",
            "domain": "LAB"
        }
    }))
    .unwrap();
    config.connection_uri = Some(endpoint);
    config.transport = if uses_tls {
        PsTransportProtocol::Https
    } else {
        PsTransportProtocol::Http
    };
    config.use_ssl = uses_tls;
    config
}

fn test_limits() -> WsmanPsrpLimits {
    WsmanPsrpLimits {
        operation_timeout: Duration::from_secs(5),
        connect_timeout: Duration::from_secs(2),
        ..WsmanPsrpLimits::default()
    }
}

fn service_options(endpoint: String) -> PowerShellSessionOptions {
    PowerShellSessionOptions::Wsman(PowerShellWsmanSessionOptions {
        endpoint,
        username: "alice".into(),
        password: "do-not-log".into(),
        domain: Some("LAB".into()),
        authentication: PowerShellWsmanAuth::Ntlm,
        tls_trust: PowerShellWsmanTrustPolicy::TrustCenter,
        network_path: PowerShellSessionNetworkPath::Direct,
        connection_id: Some("fixture-connection".into()),
        configuration_name: "Microsoft.PowerShell".into(),
        culture: "en-US".into(),
        connect_timeout_ms: 2_000,
        request_timeout_ms: 5_000,
        idle_timeout_sec: 60,
        max_envelope_bytes: 512 * 1024,
        max_response_bytes: 8 * 1024 * 1024,
        max_auth_rounds: 3,
        max_empty_receives: 32,
        event_capacity: 128,
        command_queue_capacity: 16,
        queue_wait_timeout_ms: 500,
    })
}

#[tokio::test]
async fn live_session_service_registers_wsman_actor_replay_and_diagnostics() {
    let fixture = SoapFixture::start(FixtureMode::Flow).await;
    let sink = Arc::new(RecordingSink::default());
    let service = PowerShellSessionService::new_with_test_trust(fixture.trust().clone());
    let session_id = service
        .open_session(service_options(fixture.endpoint.clone()), sink.clone())
        .await
        .unwrap();

    let opened = service.session(&session_id).await.unwrap();
    assert_eq!(opened.phase, PowerShellSessionPhase::Ready);
    assert_eq!(opened.capabilities.transport, "wsman");
    assert!(opened.capabilities.wsman_contract_verified);
    assert!(!opened.capabilities.wsman_live_windows_verified);
    assert_eq!(opened.diagnostics.transport, "wsman");
    assert_eq!(
        opened.diagnostics.contract_verification,
        "deterministic_contract_verified"
    );
    assert_eq!(
        opened.diagnostics.live_interoperability,
        "live_windows_unverified"
    );

    service
        .start_pipeline(&session_id, "Write-Output fixture".into(), false)
        .await
        .unwrap();
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            let current = service.session(&session_id).await.unwrap();
            if current.phase == PowerShellSessionPhase::Ready
                && current.stats.pipelines_completed == 1
            {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("fixture pipeline should complete");

    let replay = service.replay(&session_id, None).await.unwrap();
    for expected in [
        PowerShellStreamKind::Output,
        PowerShellStreamKind::Error,
        PowerShellStreamKind::Warning,
        PowerShellStreamKind::Verbose,
        PowerShellStreamKind::Debug,
        PowerShellStreamKind::Information,
        PowerShellStreamKind::Progress,
        PowerShellStreamKind::PipelineState,
    ] {
        assert!(
            replay.events.iter().any(|event| event.kind == expected),
            "missing {expected:?}"
        );
    }
    assert!(lock(&sink.events).iter().all(|event| !event.replayed));

    service.close_session(&session_id).await.unwrap();
    let closed = service.session(&session_id).await.unwrap();
    assert_eq!(closed.phase, PowerShellSessionPhase::Closed);
    let snapshot = fixture.snapshot();
    assert!(snapshot.request_paths.iter().all(|path| path == "/wsman"));
    assert_eq!(snapshot.command_count, 1);
    fixture.stop().await;
}

#[tokio::test]
async fn persistent_wsman_runspace_carries_all_streams_cancels_and_reuses() {
    let fixture = SoapFixture::start(FixtureMode::Flow).await;
    let config = remoting_config(fixture.endpoint.clone(), PsAuthMethod::Ntlm);
    let transport =
        WsmanPsrpTransport::new_with_test_trust(&config, test_limits(), fixture.trust()).unwrap();
    let mut pool = RunspacePool::open_with_transport(transport).await.unwrap();

    let first = Pipeline::new("Write-Output first")
        .run_all_streams(&mut pool)
        .await
        .unwrap();
    assert_eq!(first.state, PipelineState::Completed);
    assert_eq!(first.output.len(), 1);
    assert_eq!(first.errors.len(), 1);
    assert_eq!(first.warnings.len(), 1);
    assert_eq!(first.verbose.len(), 1);
    assert_eq!(first.debug.len(), 1);
    assert_eq!(first.information.len(), 1);
    assert_eq!(first.progress.len(), 1);

    let cancellation = CancellationToken::new();
    cancellation.cancel();
    let cancelled = Pipeline::new("Start-Sleep 30")
        .run_all_streams_with_cancel(&mut pool, cancellation)
        .await
        .unwrap_err();
    assert!(matches!(cancelled, PsrpError::Cancelled));

    let reused = Pipeline::new("Write-Output reused")
        .run_all_streams(&mut pool)
        .await
        .unwrap();
    assert_eq!(reused.state, PipelineState::Completed);
    assert_eq!(reused.output.len(), 1);
    pool.close().await.unwrap();

    let snapshot = fixture.snapshot();
    assert_eq!(&snapshot.ntlm_message_types[..2], &[1, 3]);
    assert!(snapshot.ntlm_message_types[2..]
        .iter()
        .all(|kind| *kind == 3));
    assert!(snapshot.request_paths.iter().all(|path| path == "/wsman"));
    assert_eq!(snapshot.command_count, 3);
    assert_eq!(
        snapshot.actions,
        vec![
            "Create", "Command", "Receive", "Command", "Signal", "Receive", "Command", "Receive",
            "Send", "Delete"
        ]
    );
    fixture.stop().await;
}

#[test]
fn canonical_endpoint_and_security_policy_fail_closed() {
    let mut config = remoting_config(
        "http://server.example:5985/custom/wsman/wsman/".into(),
        PsAuthMethod::Ntlm,
    );
    assert_eq!(
        canonical_wsman_endpoint(&config).unwrap(),
        "http://server.example:5985/wsman"
    );

    for auth_method in [PsAuthMethod::Basic, PsAuthMethod::Ntlm] {
        config.auth_method = auth_method;
        let error = WsmanPsrpTransport::new(&config, test_limits())
            .unwrap_err()
            .to_string();
        assert!(error.contains("WSMan authentication is rejected over HTTP"));
        assert!(!error.contains("do-not-log"));
    }

    config.auth_method = PsAuthMethod::Ntlm;
    config.skip_ca_check = true;
    assert!(WsmanPsrpTransport::new(&config, test_limits())
        .unwrap_err()
        .to_string()
        .contains("strict WSMan TLS trust"));
}

#[test]
fn unsupported_auth_modes_are_explicit_and_never_aliased() {
    for (method, expected) in [
        (PsAuthMethod::Negotiate, "Negotiate"),
        (PsAuthMethod::Default, "Negotiate"),
        (PsAuthMethod::Kerberos, "Kerberos"),
        (PsAuthMethod::Certificate, "certificate"),
        (PsAuthMethod::CredSsp, "CredSSP"),
        (PsAuthMethod::Digest, "Digest"),
    ] {
        let config = remoting_config("http://server.example/wsman".into(), method);
        let error = WsmanPsrpTransport::new(&config, test_limits())
            .unwrap_err()
            .to_string();
        assert!(error.contains(expected), "unexpected error: {error}");
    }
    assert!(PSRP_WSMAN_LIMITATIONS
        .iter()
        .any(|row| row.contains("SPNEGO")));
    assert!(PSRP_WSMAN_LIMITATIONS
        .iter()
        .any(|row| row.contains("CredSSP")));
}

#[tokio::test]
async fn faults_are_sanitized_without_echoing_unrelated_detail_or_credentials() {
    let fixture = SoapFixture::start(FixtureMode::Fault).await;
    let config = remoting_config(fixture.endpoint.clone(), PsAuthMethod::Ntlm);
    let transport =
        WsmanPsrpTransport::new_with_test_trust(&config, test_limits(), fixture.trust()).unwrap();
    let error = RunspacePool::open_with_transport(transport)
        .await
        .unwrap_err()
        .to_string();
    assert!(error.contains("WSMan fault (HTTP 500) code 5"));
    assert!(error.contains("Access denied"));
    assert!(!error.contains("do-not-leak"));
    assert!(!error.contains("do-not-log"));
    fixture.stop().await;
}

#[tokio::test]
async fn response_and_auth_round_limits_fail_closed() {
    let oversized = SoapFixture::start(FixtureMode::Oversized).await;
    let config = remoting_config(oversized.endpoint.clone(), PsAuthMethod::Ntlm);
    let limits = WsmanPsrpLimits {
        max_response_bytes: 1024,
        ..test_limits()
    };
    let transport =
        WsmanPsrpTransport::new_with_test_trust(&config, limits, oversized.trust()).unwrap();
    let error = RunspacePool::open_with_transport(transport)
        .await
        .unwrap_err()
        .to_string();
    assert!(error.contains("Content-Length exceeded 1024 bytes"));
    oversized.stop().await;

    let rejecting = SoapFixture::start(FixtureMode::RejectAuth).await;
    let config = remoting_config(rejecting.endpoint.clone(), PsAuthMethod::Ntlm);
    let transport =
        WsmanPsrpTransport::new_with_test_trust(&config, test_limits(), rejecting.trust()).unwrap();
    let error = RunspacePool::open_with_transport(transport)
        .await
        .unwrap_err()
        .to_string();
    assert!(error.contains("authentication failed"));
    assert!(!error.contains("do-not-log"));
    rejecting.stop().await;
}

#[test]
#[ignore = "requires an explicitly provisioned Windows WinRM HTTPS fixture; none was available on this host"]
fn live_windows_winrm_https_contract_is_intentionally_unclaimed() {
    assert!(
        std::env::var_os("SORNG_TEST_WINRM_HTTPS_ENDPOINT").is_some(),
        "set SORNG_TEST_WINRM_HTTPS_ENDPOINT only after provisioning the live fixture"
    );
}
