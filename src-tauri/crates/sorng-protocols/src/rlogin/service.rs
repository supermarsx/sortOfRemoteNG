use super::io::RloginByteStream;
use super::replay::{OutputFrame, ReplaySnapshot};
use super::session::{InputOutcome, OutputDisposition, ResizeOutcome, RloginEngine};
use super::sink::{output_metadata, DynRloginSink, NoopRloginSink};
use super::types::{
    RloginCapabilities, RloginConfig, RloginConnectOptions, RloginDiagnosis, RloginError,
    RloginLifecycle, RloginSourcePortMode, RloginStats, TerminalMode, WindowSize,
    MAX_ACTIVE_RLOGIN_SESSIONS, MAX_RLOGIN_INPUT_BYTES,
};
use chrono::Utc;
use serde::Serialize;
use sorng_socket_transport::{
    IoTimeouts, LocalBind, Route, SocketConnector, SocketTarget, TcpOptions,
};
use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;
use tokio::sync::{mpsc, oneshot, RwLock as AsyncRwLock};
use tokio::task::JoinHandle;
use tokio::time::timeout;
use uuid::Uuid;

const COMMAND_QUEUE_CAPACITY: usize = 64;
const COMMAND_QUEUE_WAIT: Duration = Duration::from_secs(2);
const READ_CHUNK_BYTES: usize = 16 * 1024;
const MAX_COMPLETED_SESSIONS: usize = 128;

pub type RloginServiceState = Arc<RloginService>;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RloginSession {
    pub id: String,
    pub connection_id: Option<String>,
    pub host: String,
    pub port: u16,
    pub local_username: String,
    pub remote_username: String,
    pub terminal_type: String,
    pub terminal_speed: u32,
    pub connected: bool,
    pub lifecycle: RloginLifecycle,
    pub terminal_mode: TerminalMode,
    pub window_updates_enabled: bool,
    pub local_address: String,
    pub remote_address: String,
    pub source_port_fallback: bool,
    pub capabilities: RloginCapabilities,
    pub stats: RloginStats,
    pub connected_at_ms: i64,
    pub disconnected_at_ms: Option<i64>,
    pub terminal_reason: Option<RloginTerminalReason>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RloginOutputMetadata {
    pub session_id: String,
    pub sequence: u64,
    pub byte_length: usize,
    pub prefix_truncated: bool,
    pub replayed: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RloginEvent {
    Connected {
        session: RloginSession,
    },
    Output {
        frame: RloginOutputMetadata,
    },
    ReplayStarted {
        session_id: String,
        frame_count: usize,
        truncated: bool,
    },
    ReplayCompleted {
        session_id: String,
        next_sequence: u64,
    },
    LifecycleChanged {
        session_id: String,
        lifecycle: RloginLifecycle,
    },
    CapabilityNotice {
        session_id: String,
        capabilities: RloginCapabilities,
        source_port_fallback: bool,
    },
    Disconnected {
        session: RloginSession,
        reason: RloginTerminalReason,
    },
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RloginTerminalReason {
    Requested,
    PeerEof,
    IdleTimeout,
    CommandChannelClosed,
    ProtocolError { error: RloginError },
}

pub struct RloginService {
    shared: Arc<ServiceShared>,
}

struct ServiceShared {
    active: AsyncRwLock<HashMap<String, Arc<SessionEntry>>>,
    completed: Mutex<VecDeque<RloginSession>>,
}

struct SessionEntry {
    id: String,
    options: RloginConnectOptions,
    local_address: String,
    remote_address: String,
    source_port_fallback: bool,
    connected_at_ms: i64,
    command_timeout: Duration,
    command_tx: mpsc::Sender<RloginCommand>,
    handle: Mutex<Option<JoinHandle<()>>>,
    runtime: RwLock<RuntimeSnapshot>,
    sink: DynRloginSink,
}

#[derive(Clone)]
struct RuntimeSnapshot {
    lifecycle: RloginLifecycle,
    terminal_mode: TerminalMode,
    window_updates_enabled: bool,
    stats: RloginStats,
    disconnected_at_ms: Option<i64>,
    terminal_reason: Option<RloginTerminalReason>,
}

enum RloginCommand {
    Send {
        data: Vec<u8>,
        result: oneshot::Sender<Result<InputOutcome, RloginError>>,
    },
    Resize {
        size: WindowSize,
        result: oneshot::Sender<Result<ResizeOutcome, RloginError>>,
    },
    Snapshot {
        after_sequence: u64,
        result: oneshot::Sender<Result<ReplaySnapshot, RloginError>>,
    },
    Shutdown {
        result: oneshot::Sender<Result<(), RloginError>>,
    },
}

impl RloginService {
    pub fn new() -> RloginServiceState {
        Arc::new(Self {
            shared: Arc::new(ServiceShared {
                active: AsyncRwLock::new(HashMap::new()),
                completed: Mutex::new(VecDeque::new()),
            }),
        })
    }

    pub fn diagnose_rlogin(&self, options: &RloginConnectOptions) -> RloginDiagnosis {
        RloginDiagnosis::for_options(options)
    }

    pub async fn connect_rlogin(
        &self,
        options: RloginConnectOptions,
        sink: DynRloginSink,
    ) -> Result<String, RloginError> {
        options.validate()?;
        self.disconnect_replaced_connection(options.connection_id.as_deref())
            .await?;
        self.ensure_capacity().await?;

        let local_bind = options.local_bind_address.map(|address| LocalBind {
            address,
            // Reserved mode fails validation. Auto truthfully uses the
            // documented ephemeral fallback instead of pretending to bind a
            // privileged port.
            port: 0,
        });
        let connector = SocketConnector::new();
        let connection = connector
            .connect_tcp(
                &SocketTarget::new(options.config.host.clone(), options.config.port),
                Route::Direct,
                TcpOptions {
                    address_family: options.address_family,
                    local_bind,
                    no_delay: options.tcp_no_delay,
                    keepalive: options.tcp_keepalive_seconds.map(Duration::from_secs),
                    timeouts: IoTimeouts {
                        connect: Duration::from_millis(options.connect_timeout_ms),
                        write: options.config.write_timeout(),
                        idle: options.config.idle_timeout(),
                    },
                },
            )
            .await?;
        let local_address = connection.local_addr()?.to_string();
        let remote_address = connection.peer_addr()?.to_string();
        self.start_session(
            options,
            connection.into_stream(),
            local_address,
            remote_address,
            sink,
        )
        .await
    }

    /// Test and embedding seam for an already-resolved direct byte stream.
    /// Production Tauri commands always use `connect_rlogin` above.
    pub async fn connect_with_stream<S>(
        &self,
        config: RloginConfig,
        stream: S,
    ) -> Result<String, RloginError>
    where
        S: RloginByteStream + 'static,
    {
        self.connect_with_stream_and_sink(config, stream, Arc::new(NoopRloginSink))
            .await
    }

    pub async fn connect_with_stream_and_sink<S>(
        &self,
        config: RloginConfig,
        stream: S,
        sink: DynRloginSink,
    ) -> Result<String, RloginError>
    where
        S: RloginByteStream + 'static,
    {
        let options = RloginConnectOptions {
            config,
            plaintext_acknowledged: true,
            ..RloginConnectOptions::default()
        };
        self.start_session(
            options,
            stream,
            "injected".to_string(),
            "injected".to_string(),
            sink,
        )
        .await
    }

    async fn start_session<S>(
        &self,
        options: RloginConnectOptions,
        stream: S,
        local_address: String,
        remote_address: String,
        sink: DynRloginSink,
    ) -> Result<String, RloginError>
    where
        S: RloginByteStream + 'static,
    {
        options.validate()?;
        self.ensure_capacity().await?;
        let engine = RloginEngine::establish(stream, options.config.clone()).await?;
        let session_id = Uuid::new_v4().to_string();
        let source_port_fallback = options.source_port_mode == RloginSourcePortMode::Auto;
        let connected_at_ms = Utc::now().timestamp_millis();
        let (command_tx, command_rx) = mpsc::channel(COMMAND_QUEUE_CAPACITY);
        let entry = Arc::new(SessionEntry {
            id: session_id.clone(),
            options,
            local_address,
            remote_address,
            source_port_fallback,
            connected_at_ms,
            command_timeout: Duration::from_secs(2).saturating_add(engine.config().write_timeout()),
            command_tx,
            handle: Mutex::new(None),
            runtime: RwLock::new(runtime_from_engine(&engine)),
            sink,
        });

        {
            let mut active = self.shared.active.write().await;
            if active.len() >= MAX_ACTIVE_RLOGIN_SESSIONS {
                let mut engine = engine;
                let _ = engine.close().await;
                return Err(RloginError::SessionLimitReached);
            }
            active.insert(session_id.clone(), entry.clone());
        }

        deliver_event(
            &entry,
            RloginEvent::Connected {
                session: entry.snapshot(),
            },
        );
        deliver_event(
            &entry,
            RloginEvent::CapabilityNotice {
                session_id: session_id.clone(),
                capabilities: RloginCapabilities::production(),
                source_port_fallback,
            },
        );

        let shared = self.shared.clone();
        let task_entry = entry.clone();
        let handle = tokio::spawn(async move {
            let reason = run_session(task_entry.clone(), engine, command_rx).await;
            finish_session(shared, task_entry, reason).await;
        });
        *lock_mutex(&entry.handle) = Some(handle);
        Ok(session_id)
    }

    pub async fn send_rlogin_input(
        &self,
        session_id: &str,
        data: Vec<u8>,
    ) -> Result<InputOutcome, RloginError> {
        if data.len() > MAX_RLOGIN_INPUT_BYTES {
            return Err(RloginError::InputTooLarge);
        }
        let entry = self.active_entry(session_id).await?;
        let (result, receiver) = oneshot::channel();
        self.enqueue(&entry, RloginCommand::Send { data, result }, receiver)
            .await
    }

    pub async fn resize_rlogin(
        &self,
        session_id: &str,
        size: WindowSize,
    ) -> Result<ResizeOutcome, RloginError> {
        let entry = self.active_entry(session_id).await?;
        let (result, receiver) = oneshot::channel();
        self.enqueue(&entry, RloginCommand::Resize { size, result }, receiver)
            .await
    }

    pub async fn get_rlogin_output_snapshot(
        &self,
        session_id: &str,
        after_sequence: u64,
    ) -> Result<ReplaySnapshot, RloginError> {
        let entry = self.active_entry(session_id).await?;
        let (result, receiver) = oneshot::channel();
        self.enqueue(
            &entry,
            RloginCommand::Snapshot {
                after_sequence,
                result,
            },
            receiver,
        )
        .await
    }

    pub async fn disconnect_rlogin(&self, session_id: &str) -> Result<(), RloginError> {
        let entry = match self.shared.active.read().await.get(session_id).cloned() {
            Some(entry) => entry,
            None if self.completed_session(session_id).is_some() => return Ok(()),
            None => return Err(RloginError::SessionNotFound),
        };
        let (result, receiver) = oneshot::channel();
        let command_result = self
            .enqueue(&entry, RloginCommand::Shutdown { result }, receiver)
            .await;
        let handle = lock_mutex(&entry.handle).take();
        if let Some(handle) = handle {
            let _ = handle.await;
        }
        if self.completed_session(session_id).is_some() {
            Ok(())
        } else {
            command_result
        }
    }

    pub async fn disconnect_all_rlogin_sessions(&self) -> usize {
        let ids: Vec<_> = self.shared.active.read().await.keys().cloned().collect();
        let mut count = 0;
        for id in ids {
            if self.disconnect_rlogin(&id).await.is_ok() {
                count += 1;
            }
        }
        count
    }

    pub async fn get_rlogin_session_info(
        &self,
        session_id: &str,
    ) -> Result<RloginSession, RloginError> {
        if let Some(entry) = self.shared.active.read().await.get(session_id).cloned() {
            return Ok(entry.snapshot());
        }
        self.completed_session(session_id)
            .ok_or(RloginError::SessionNotFound)
    }

    pub async fn list_rlogin_sessions(&self) -> Vec<RloginSession> {
        let mut sessions: Vec<_> = self
            .shared
            .active
            .read()
            .await
            .values()
            .map(|entry| entry.snapshot())
            .collect();
        sessions.extend(lock_mutex(&self.shared.completed).iter().cloned());
        sessions.sort_by_key(|session| std::cmp::Reverse(session.connected_at_ms));
        sessions
    }

    pub async fn active_session_count(&self) -> usize {
        self.shared.active.read().await.len()
    }

    async fn disconnect_replaced_connection(
        &self,
        connection_id: Option<&str>,
    ) -> Result<(), RloginError> {
        let Some(connection_id) = connection_id else {
            return Ok(());
        };
        let previous = self
            .shared
            .active
            .read()
            .await
            .values()
            .find(|entry| entry.options.connection_id.as_deref() == Some(connection_id))
            .map(|entry| entry.id.clone());
        if let Some(previous) = previous {
            self.disconnect_rlogin(&previous).await?;
        }
        Ok(())
    }

    async fn ensure_capacity(&self) -> Result<(), RloginError> {
        if self.shared.active.read().await.len() >= MAX_ACTIVE_RLOGIN_SESSIONS {
            Err(RloginError::SessionLimitReached)
        } else {
            Ok(())
        }
    }

    async fn active_entry(&self, session_id: &str) -> Result<Arc<SessionEntry>, RloginError> {
        self.shared
            .active
            .read()
            .await
            .get(session_id)
            .cloned()
            .ok_or(RloginError::SessionClosed)
    }

    async fn enqueue<T>(
        &self,
        entry: &Arc<SessionEntry>,
        command: RloginCommand,
        receiver: oneshot::Receiver<Result<T, RloginError>>,
    ) -> Result<T, RloginError> {
        match timeout(COMMAND_QUEUE_WAIT, entry.command_tx.send(command)).await {
            Err(_) => return Err(RloginError::CommandQueueFull),
            Ok(Err(_)) => return Err(RloginError::SessionClosed),
            Ok(Ok(())) => {}
        }
        match timeout(entry.command_timeout, receiver).await {
            Err(_) => Err(RloginError::CommandTimedOut),
            Ok(Err(_)) => Err(RloginError::SessionClosed),
            Ok(Ok(result)) => result,
        }
    }

    fn completed_session(&self, session_id: &str) -> Option<RloginSession> {
        lock_mutex(&self.shared.completed)
            .iter()
            .find(|session| session.id == session_id)
            .cloned()
    }
}

impl SessionEntry {
    fn snapshot(&self) -> RloginSession {
        let runtime = read_lock(&self.runtime);
        RloginSession {
            id: self.id.clone(),
            connection_id: self.options.connection_id.clone(),
            host: self.options.config.host.clone(),
            port: self.options.config.port,
            local_username: self.options.config.local_username.clone(),
            remote_username: self.options.config.remote_username.clone(),
            terminal_type: self.options.config.terminal_type.clone(),
            terminal_speed: self.options.config.terminal_speed,
            connected: runtime.lifecycle == RloginLifecycle::Connected,
            lifecycle: runtime.lifecycle,
            terminal_mode: runtime.terminal_mode,
            window_updates_enabled: runtime.window_updates_enabled,
            local_address: self.local_address.clone(),
            remote_address: self.remote_address.clone(),
            source_port_fallback: self.source_port_fallback,
            capabilities: RloginCapabilities::production(),
            stats: runtime.stats.clone(),
            connected_at_ms: self.connected_at_ms,
            disconnected_at_ms: runtime.disconnected_at_ms,
            terminal_reason: runtime.terminal_reason.clone(),
        }
    }

    fn refresh<S: RloginByteStream>(&self, engine: &RloginEngine<S>) {
        let mut runtime = write_lock(&self.runtime);
        runtime.lifecycle = engine.lifecycle();
        runtime.terminal_mode = engine.urgent_state().terminal_mode;
        runtime.window_updates_enabled = engine.urgent_state().window_updates_enabled;
        runtime.stats = engine.stats().clone();
    }
}

fn runtime_from_engine<S: RloginByteStream>(engine: &RloginEngine<S>) -> RuntimeSnapshot {
    RuntimeSnapshot {
        lifecycle: engine.lifecycle(),
        terminal_mode: engine.urgent_state().terminal_mode,
        window_updates_enabled: engine.urgent_state().window_updates_enabled,
        stats: engine.stats().clone(),
        disconnected_at_ms: None,
        terminal_reason: None,
    }
}

async fn run_session<S>(
    entry: Arc<SessionEntry>,
    mut engine: RloginEngine<S>,
    mut commands: mpsc::Receiver<RloginCommand>,
) -> RloginTerminalReason
where
    S: RloginByteStream + 'static,
{
    let mut buffer = vec![0_u8; READ_CHUNK_BYTES];
    let reason = loop {
        tokio::select! {
            biased;
            command = commands.recv() => match command {
                Some(RloginCommand::Send { data, result }) => {
                    let outcome = engine.write_input(&data).await;
                    entry.refresh(&engine);
                    let disconnect_requested = outcome
                        .as_ref()
                        .is_ok_and(|outcome| outcome.disconnect_requested);
                    if let Ok(outcome) = &outcome {
                        if let Some(snapshot) = &outcome.resumed_output {
                            deliver_replay(&entry, snapshot);
                        }
                    }
                    let _ = result.send(outcome);
                    if disconnect_requested {
                        break RloginTerminalReason::Requested;
                    }
                }
                Some(RloginCommand::Resize { size, result }) => {
                    let outcome = engine.resize(size).await;
                    entry.refresh(&engine);
                    let _ = result.send(outcome);
                }
                Some(RloginCommand::Snapshot { after_sequence, result }) => {
                    let _ = result.send(Ok(engine.output_snapshot_after(after_sequence)));
                }
                Some(RloginCommand::Shutdown { result }) => {
                    let outcome = engine.close().await;
                    entry.refresh(&engine);
                    let _ = result.send(outcome);
                    break RloginTerminalReason::Requested;
                }
                None => {
                    let _ = engine.close().await;
                    entry.refresh(&engine);
                    break RloginTerminalReason::CommandChannelClosed;
                }
            },
            output = engine.read_output(&mut buffer) => {
                entry.refresh(&engine);
                match output {
                    Ok(OutputDisposition::Display { frame }) => deliver_frame(&entry, &frame, false),
                    Ok(OutputDisposition::Buffered { .. }) => {}
                    Ok(OutputDisposition::EndOfStream) => break RloginTerminalReason::PeerEof,
                    Err(RloginError::OperationTimeout { operation: "idle read", .. }) => {
                        break RloginTerminalReason::IdleTimeout;
                    }
                    Err(RloginError::Cancelled) => break RloginTerminalReason::Requested,
                    Err(error) => break RloginTerminalReason::ProtocolError { error },
                }
            }
        }
    };
    // Every terminal path performs the same idempotent shutdown. This also
    // trips the engine cancellation handle if a future adapter adds a
    // secondary reader around the same session.
    let _ = engine.close().await;
    entry.refresh(&engine);
    reason
}

fn deliver_replay(entry: &SessionEntry, snapshot: &ReplaySnapshot) {
    deliver_event(
        entry,
        RloginEvent::ReplayStarted {
            session_id: entry.id.clone(),
            frame_count: snapshot.frames.len(),
            truncated: snapshot.truncated,
        },
    );
    for frame in &snapshot.frames {
        deliver_frame(entry, frame, true);
    }
    deliver_event(
        entry,
        RloginEvent::ReplayCompleted {
            session_id: entry.id.clone(),
            next_sequence: snapshot.next_sequence,
        },
    );
}

fn deliver_frame(entry: &SessionEntry, frame: &OutputFrame, replayed: bool) {
    if entry.sink.send_frame(&entry.id, frame, replayed).is_ok() {
        let _ = entry.sink.send_event(&RloginEvent::Output {
            frame: output_metadata(&entry.id, frame, replayed),
        });
    }
}

fn deliver_event(entry: &SessionEntry, event: RloginEvent) {
    let _ = entry.sink.send_event(&event);
}

async fn finish_session(
    shared: Arc<ServiceShared>,
    entry: Arc<SessionEntry>,
    reason: RloginTerminalReason,
) {
    {
        let mut runtime = write_lock(&entry.runtime);
        runtime.lifecycle = RloginLifecycle::Closed;
        runtime.disconnected_at_ms = Some(Utc::now().timestamp_millis());
        runtime.terminal_reason = Some(reason.clone());
    }
    let session = entry.snapshot();
    deliver_event(
        &entry,
        RloginEvent::LifecycleChanged {
            session_id: entry.id.clone(),
            lifecycle: RloginLifecycle::Closed,
        },
    );
    deliver_event(
        &entry,
        RloginEvent::Disconnected {
            session: session.clone(),
            reason,
        },
    );
    {
        let mut completed = lock_mutex(&shared.completed);
        completed.push_front(session);
        completed.truncate(MAX_COMPLETED_SESSIONS);
    }
    shared.active.write().await.remove(&entry.id);
}

fn lock_mutex<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn read_lock<T>(lock: &RwLock<T>) -> std::sync::RwLockReadGuard<'_, T> {
    lock.read().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn write_lock<T>(lock: &RwLock<T>) -> std::sync::RwLockWriteGuard<'_, T> {
    lock.write()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}
