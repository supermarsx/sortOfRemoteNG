use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicI64, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, RwLock, RwLockReadGuard, RwLockWriteGuard};
use std::time::Duration;

use base64::Engine as _;
use chrono::Utc;
use psrp_rs::message::{MessageType, PsrpMessage};
use psrp_rs::{
    parse_clixml, ErrorRecord, FromPsObject, InformationRecord, Pipeline, ProgressRecord, PsValue,
    PsrpTransport, RunspacePool, TraceRecord, WarningRecord,
};
use tokio::sync::{mpsc, oneshot, RwLock as AsyncRwLock};
use tokio::task::JoinHandle;
use tokio::time::timeout;
use uuid::Uuid;

use crate::strict_ssh::{
    SshHostKeyPolicy, StrictSshAuth, StrictSshPsrpConfig, StrictSshPsrpTransport,
    STRICT_SSH_PSRP_LIMITATIONS,
};

use super::replay::ReplayBuffer;
use super::{
    DynPowerShellSessionSink, PowerShellEventEnvelope, PowerShellEventReplay,
    PowerShellPipelineInput, PowerShellPipelineStarted, PowerShellProgress, PowerShellSession,
    PowerShellSessionCapabilities, PowerShellSessionDiagnostics, PowerShellSessionError,
    PowerShellSessionEvent, PowerShellSessionPhase, PowerShellSessionStats, PowerShellSshAuth,
    PowerShellSshHostKeyPolicy, PowerShellSshSessionOptions, PowerShellStreamKind,
    MAX_ACTIVE_POWERSHELL_SESSIONS, MAX_INPUT_TEXT_BYTES, MAX_SCRIPT_BYTES,
};

const MAX_COMPLETED_SESSIONS: usize = 128;

pub type PowerShellSessionServiceState = Arc<PowerShellSessionService>;

pub struct PowerShellSessionService {
    shared: Arc<ServiceShared>,
}

struct ServiceShared {
    active: AsyncRwLock<HashMap<String, Arc<SessionEntry>>>,
    completed: Mutex<VecDeque<PowerShellSession>>,
}

struct SessionEntry {
    id: String,
    connection_id: Option<String>,
    host: String,
    port: u16,
    username: String,
    runspace_id: String,
    command_tx: mpsc::Sender<ActorCommand>,
    queue_wait_timeout: Duration,
    command_timeout: Duration,
    actor: Mutex<Option<JoinHandle<()>>>,
    runtime: RwLock<RuntimeState>,
    counters: RuntimeCounters,
    replay: Mutex<ReplayBuffer>,
    delivery: Mutex<DeliveryState>,
    next_sequence: AtomicU64,
}

struct RuntimeState {
    phase: PowerShellSessionPhase,
    active_pipeline_id: Option<String>,
    input_open: bool,
    terminal_error_code: Option<String>,
    closed_at_ms: Option<i64>,
}

struct RuntimeCounters {
    opened_at_ms: i64,
    last_activity_at_ms: AtomicI64,
    pipelines_started: AtomicU64,
    pipelines_completed: AtomicU64,
    pipelines_failed: AtomicU64,
    pipelines_cancelled: AtomicU64,
    input_objects_sent: AtomicU64,
    events_emitted: AtomicU64,
    delivery_failures: AtomicU64,
    replay_evictions: AtomicU64,
}

struct DeliveryState {
    sink: Option<DynPowerShellSessionSink>,
}

enum ActorCommand {
    Start {
        script: String,
        accepts_input: bool,
        result: oneshot::Sender<Result<PowerShellPipelineStarted, PowerShellSessionError>>,
    },
    Input {
        value: PsValue,
        result: oneshot::Sender<Result<(), PowerShellSessionError>>,
    },
    EndInput {
        result: oneshot::Sender<Result<(), PowerShellSessionError>>,
    },
    Cancel {
        result: oneshot::Sender<Result<(), PowerShellSessionError>>,
    },
    Close {
        result: oneshot::Sender<Result<(), PowerShellSessionError>>,
    },
}

enum PipelineOutcome {
    Complete,
    Fatal(PowerShellSessionError),
    Close(oneshot::Sender<Result<(), PowerShellSessionError>>),
    ChannelClosed,
}

impl PowerShellSessionService {
    #[must_use]
    pub fn new() -> PowerShellSessionServiceState {
        Arc::new(Self {
            shared: Arc::new(ServiceShared {
                active: AsyncRwLock::new(HashMap::new()),
                completed: Mutex::new(VecDeque::new()),
            }),
        })
    }

    pub async fn open_session(
        &self,
        options: PowerShellSshSessionOptions,
        sink: DynPowerShellSessionSink,
    ) -> Result<String, PowerShellSessionError> {
        options.validate()?;

        if let Some(connection_id) = options.connection_id.as_deref() {
            let previous = self
                .shared
                .active
                .read()
                .await
                .values()
                .find(|entry| entry.connection_id.as_deref() == Some(connection_id))
                .map(|entry| entry.id.clone());
            if let Some(previous) = previous {
                self.close_session(&previous).await?;
            }
        }

        if self.shared.active.read().await.len() >= MAX_ACTIVE_POWERSHELL_SESSIONS {
            return Err(PowerShellSessionError::SessionLimitReached);
        }

        let strict_config = strict_config(&options);
        let transport = StrictSshPsrpTransport::connect(strict_config)
            .await
            .map_err(|_| PowerShellSessionError::ConnectionFailed)?;
        let pool = RunspacePool::open_with_transport(transport)
            .await
            .map_err(|_| PowerShellSessionError::RunspaceOpenFailed)?;

        self.register_pool(options, sink, pool).await
    }

    async fn register_pool<T: PsrpTransport + 'static>(
        &self,
        options: PowerShellSshSessionOptions,
        sink: DynPowerShellSessionSink,
        pool: RunspacePool<T>,
    ) -> Result<String, PowerShellSessionError> {
        let session_id = Uuid::new_v4().to_string();
        let runspace_id = pool.id().to_string();
        let (command_tx, command_rx) = mpsc::channel(options.command_queue_capacity);
        let now = Utc::now().timestamp_millis();
        let entry = Arc::new(SessionEntry {
            id: session_id.clone(),
            connection_id: options.connection_id.clone(),
            host: options.host.clone(),
            port: options.port,
            username: options.username.clone(),
            runspace_id,
            command_tx,
            queue_wait_timeout: Duration::from_millis(options.queue_wait_timeout_ms),
            command_timeout: Duration::from_millis(
                options
                    .request_timeout_ms
                    .saturating_add(options.queue_wait_timeout_ms),
            ),
            actor: Mutex::new(None),
            runtime: RwLock::new(RuntimeState {
                phase: PowerShellSessionPhase::Ready,
                active_pipeline_id: None,
                input_open: false,
                terminal_error_code: None,
                closed_at_ms: None,
            }),
            counters: RuntimeCounters::new(now),
            replay: Mutex::new(ReplayBuffer::new(
                session_id.clone(),
                options.event_capacity,
            )),
            delivery: Mutex::new(DeliveryState { sink: Some(sink) }),
            next_sequence: AtomicU64::new(1),
        });

        {
            let mut active = self.shared.active.write().await;
            if active.len() >= MAX_ACTIVE_POWERSHELL_SESSIONS {
                drop(active);
                let _ = pool.close().await;
                return Err(PowerShellSessionError::SessionLimitReached);
            }
            active.insert(session_id.clone(), entry.clone());
        }

        let shared = self.shared.clone();
        let actor_entry = entry.clone();
        let actor = tokio::spawn(async move {
            run_actor(shared, actor_entry, pool, command_rx).await;
        });
        *lock_mutex(&entry.actor) = Some(actor);
        entry.publish_session_state("ready");
        Ok(session_id)
    }

    pub async fn start_pipeline(
        &self,
        session_id: &str,
        script: String,
        accepts_input: bool,
    ) -> Result<PowerShellPipelineStarted, PowerShellSessionError> {
        if script.len() > MAX_SCRIPT_BYTES {
            return Err(PowerShellSessionError::ScriptTooLarge);
        }
        if script.trim().is_empty() {
            return Err(PowerShellSessionError::invalid("script"));
        }
        let entry = self.active_entry(session_id).await?;
        let (result_tx, result_rx) = oneshot::channel();
        self.enqueue(
            &entry,
            ActorCommand::Start {
                script,
                accepts_input,
                result: result_tx,
            },
        )
        .await?;
        await_result(&entry, result_rx).await
    }

    pub async fn write_pipeline_input(
        &self,
        session_id: &str,
        input: PowerShellPipelineInput,
    ) -> Result<(), PowerShellSessionError> {
        if matches!(&input, PowerShellPipelineInput::String(value) if value.len() > MAX_INPUT_TEXT_BYTES)
        {
            return Err(PowerShellSessionError::InputTooLarge);
        }
        let entry = self.active_entry(session_id).await?;
        let (result_tx, result_rx) = oneshot::channel();
        self.enqueue(
            &entry,
            ActorCommand::Input {
                value: input.into(),
                result: result_tx,
            },
        )
        .await?;
        await_result(&entry, result_rx).await
    }

    pub async fn end_pipeline_input(&self, session_id: &str) -> Result<(), PowerShellSessionError> {
        let entry = self.active_entry(session_id).await?;
        let (result_tx, result_rx) = oneshot::channel();
        self.enqueue(&entry, ActorCommand::EndInput { result: result_tx })
            .await?;
        await_result(&entry, result_rx).await
    }

    pub async fn cancel_pipeline(&self, session_id: &str) -> Result<(), PowerShellSessionError> {
        let entry = self.active_entry(session_id).await?;
        let (result_tx, result_rx) = oneshot::channel();
        self.enqueue(&entry, ActorCommand::Cancel { result: result_tx })
            .await?;
        await_result(&entry, result_rx).await
    }

    pub async fn close_session(&self, session_id: &str) -> Result<(), PowerShellSessionError> {
        let entry = match self.shared.active.read().await.get(session_id).cloned() {
            Some(entry) => entry,
            None if self.completed_session(session_id).is_some() => return Ok(()),
            None => return Err(PowerShellSessionError::SessionNotFound),
        };
        let (result_tx, result_rx) = oneshot::channel();
        self.enqueue(&entry, ActorCommand::Close { result: result_tx })
            .await?;
        let result = await_result(&entry, result_rx).await;
        let actor = lock_mutex(&entry.actor).take();
        if let Some(actor) = actor {
            let _ = actor.await;
        }
        result
    }

    pub async fn close_all_sessions(&self) -> usize {
        let ids = self
            .shared
            .active
            .read()
            .await
            .keys()
            .cloned()
            .collect::<Vec<_>>();
        let mut closed = 0;
        for id in ids {
            if self.close_session(&id).await.is_ok() {
                closed += 1;
            }
        }
        closed
    }

    pub async fn attach(
        &self,
        session_id: &str,
        after_sequence: Option<u64>,
        sink: DynPowerShellSessionSink,
    ) -> Result<PowerShellEventReplay, PowerShellSessionError> {
        let entry = self.active_entry(session_id).await?;
        let mut delivery = lock_mutex(&entry.delivery);
        delivery.sink = None;
        let replay = entry.replay_snapshot(after_sequence);
        for event in &replay.events {
            if sink
                .send(&PowerShellEventEnvelope {
                    event: event.clone(),
                    replayed: true,
                })
                .is_err()
            {
                entry
                    .counters
                    .delivery_failures
                    .fetch_add(1, Ordering::Relaxed);
                return Err(PowerShellSessionError::DeliveryUnavailable);
            }
        }
        delivery.sink = Some(sink);
        Ok(replay)
    }

    pub async fn detach(&self, session_id: &str) -> Result<(), PowerShellSessionError> {
        let entry = self.active_entry(session_id).await?;
        lock_mutex(&entry.delivery).sink = None;
        Ok(())
    }

    pub async fn replay(
        &self,
        session_id: &str,
        after_sequence: Option<u64>,
    ) -> Result<PowerShellEventReplay, PowerShellSessionError> {
        if let Some(entry) = self.shared.active.read().await.get(session_id).cloned() {
            return Ok(entry.replay_snapshot(after_sequence));
        }
        Err(PowerShellSessionError::SessionClosed)
    }

    pub async fn session(
        &self,
        session_id: &str,
    ) -> Result<PowerShellSession, PowerShellSessionError> {
        if let Some(entry) = self.shared.active.read().await.get(session_id).cloned() {
            return Ok(entry.snapshot());
        }
        self.completed_session(session_id)
            .ok_or(PowerShellSessionError::SessionNotFound)
    }

    pub async fn sessions(&self) -> Vec<PowerShellSession> {
        let mut sessions = self
            .shared
            .active
            .read()
            .await
            .values()
            .map(|entry| entry.snapshot())
            .collect::<Vec<_>>();
        sessions.extend(lock_mutex(&self.shared.completed).iter().cloned());
        sessions.sort_by_key(|session| std::cmp::Reverse(session.stats.opened_at_ms));
        sessions
    }

    pub fn capabilities(&self) -> PowerShellSessionCapabilities {
        PowerShellSessionCapabilities::default()
    }

    async fn active_entry(
        &self,
        session_id: &str,
    ) -> Result<Arc<SessionEntry>, PowerShellSessionError> {
        self.shared
            .active
            .read()
            .await
            .get(session_id)
            .cloned()
            .ok_or(PowerShellSessionError::SessionClosed)
    }

    async fn enqueue(
        &self,
        entry: &Arc<SessionEntry>,
        command: ActorCommand,
    ) -> Result<(), PowerShellSessionError> {
        match timeout(entry.queue_wait_timeout, entry.command_tx.send(command)).await {
            Err(_) => Err(PowerShellSessionError::CommandQueueFull),
            Ok(Err(_)) => Err(PowerShellSessionError::SessionClosed),
            Ok(Ok(())) => Ok(()),
        }
    }

    fn completed_session(&self, session_id: &str) -> Option<PowerShellSession> {
        lock_mutex(&self.shared.completed)
            .iter()
            .find(|session| session.id == session_id)
            .cloned()
    }
}

async fn await_result<T>(
    entry: &SessionEntry,
    receiver: oneshot::Receiver<Result<T, PowerShellSessionError>>,
) -> Result<T, PowerShellSessionError> {
    match timeout(entry.command_timeout, receiver).await {
        Err(_) => Err(PowerShellSessionError::CommandTimedOut),
        Ok(Err(_)) => Err(PowerShellSessionError::SessionClosed),
        Ok(Ok(result)) => result,
    }
}

async fn run_actor<T: PsrpTransport + 'static>(
    shared: Arc<ServiceShared>,
    entry: Arc<SessionEntry>,
    mut pool: RunspacePool<T>,
    mut commands: mpsc::Receiver<ActorCommand>,
) {
    loop {
        match commands.recv().await {
            Some(ActorCommand::Start {
                script,
                accepts_input,
                result,
            }) => {
                let handle = match Pipeline::new(script)
                    .with_input(accepts_input)
                    .start(&mut pool)
                    .await
                {
                    Ok(handle) => handle,
                    Err(_) => {
                        let _ = result.send(Err(PowerShellSessionError::ProtocolFailed));
                        continue;
                    }
                };
                let pipeline_id = handle.pid().to_string();
                entry.start_pipeline(&pipeline_id, accepts_input);
                let _ = result.send(Ok(PowerShellPipelineStarted {
                    session_id: entry.id.clone(),
                    pipeline_id: pipeline_id.clone(),
                    input_open: accepts_input,
                }));
                entry.publish(
                    Some(&pipeline_id),
                    PowerShellStreamKind::PipelineState,
                    "running".to_owned(),
                    None,
                    None,
                    Some("running".to_owned()),
                );

                match drive_pipeline(&entry, handle, &mut commands, accepts_input).await {
                    PipelineOutcome::Complete => continue,
                    PipelineOutcome::Fatal(error) => {
                        entry.fail(error.code());
                        entry.publish_session_state("failed");
                        let _ = pool.close().await;
                        finish_session(shared, entry).await;
                        return;
                    }
                    PipelineOutcome::Close(result) => {
                        entry.begin_close();
                        let close_result = pool
                            .close()
                            .await
                            .map_err(|_| PowerShellSessionError::ProtocolFailed);
                        entry.finish_close();
                        entry.publish_session_state("closed");
                        finish_session(shared, entry).await;
                        let _ = result.send(close_result);
                        return;
                    }
                    PipelineOutcome::ChannelClosed => {
                        entry.begin_close();
                        let _ = pool.close().await;
                        entry.finish_close();
                        finish_session(shared, entry).await;
                        return;
                    }
                }
            }
            Some(ActorCommand::Close { result }) => {
                entry.begin_close();
                let close_result = pool
                    .close()
                    .await
                    .map_err(|_| PowerShellSessionError::ProtocolFailed);
                entry.finish_close();
                entry.publish_session_state("closed");
                finish_session(shared, entry).await;
                let _ = result.send(close_result);
                return;
            }
            Some(ActorCommand::Input { result, .. }) => {
                let _ = result.send(Err(PowerShellSessionError::PipelineNotRunning));
            }
            Some(ActorCommand::EndInput { result }) | Some(ActorCommand::Cancel { result }) => {
                let _ = result.send(Err(PowerShellSessionError::PipelineNotRunning));
            }
            None => {
                entry.begin_close();
                let _ = pool.close().await;
                entry.finish_close();
                finish_session(shared, entry).await;
                return;
            }
        }
    }
}

async fn drive_pipeline<T: PsrpTransport>(
    entry: &Arc<SessionEntry>,
    mut handle: psrp_rs::PipelineHandle<'_, T>,
    commands: &mut mpsc::Receiver<ActorCommand>,
    accepts_input: bool,
) -> PipelineOutcome {
    let pipeline_id = handle.pid().to_string();
    let mut input_open = accepts_input;
    let mut cancel_requested = false;

    loop {
        tokio::select! {
            command = commands.recv() => match command {
                Some(ActorCommand::Start { result, .. }) => {
                    let _ = result.send(Err(PowerShellSessionError::PipelineBusy));
                }
                Some(ActorCommand::Input { value, result }) => {
                    if !input_open {
                        let _ = result.send(Err(PowerShellSessionError::PipelineInputClosed));
                    } else {
                        let sent = handle.write_input(value).await
                            .map_err(|_| PowerShellSessionError::ProtocolFailed);
                        if sent.is_ok() {
                            entry.counters.input_objects_sent.fetch_add(1, Ordering::Relaxed);
                            entry.counters.touch();
                        }
                        let fatal = sent.is_err();
                        let _ = result.send(sent);
                        if fatal {
                            return PipelineOutcome::Fatal(PowerShellSessionError::ProtocolFailed);
                        }
                    }
                }
                Some(ActorCommand::EndInput { result }) => {
                    if !input_open {
                        let _ = result.send(Err(PowerShellSessionError::PipelineInputClosed));
                    } else {
                        let ended = handle.end_input().await
                            .map_err(|_| PowerShellSessionError::ProtocolFailed);
                        if ended.is_ok() {
                            input_open = false;
                            entry.set_input_open(false);
                        }
                        let fatal = ended.is_err();
                        let _ = result.send(ended);
                        if fatal {
                            return PipelineOutcome::Fatal(PowerShellSessionError::ProtocolFailed);
                        }
                    }
                }
                Some(ActorCommand::Cancel { result }) => {
                    if cancel_requested {
                        let _ = result.send(Ok(()));
                    } else {
                        let stopped = handle.stop().await
                            .map_err(|_| PowerShellSessionError::ProtocolFailed);
                        if stopped.is_ok() {
                            cancel_requested = true;
                            entry.begin_cancel();
                        }
                        let fatal = stopped.is_err();
                        let _ = result.send(stopped);
                        if fatal {
                            return PipelineOutcome::Fatal(PowerShellSessionError::ProtocolFailed);
                        }
                    }
                }
                Some(ActorCommand::Close { result }) => {
                    let _ = handle.stop().await;
                    return PipelineOutcome::Close(result);
                }
                None => return PipelineOutcome::ChannelClosed,
            },
            message = handle.next_message() => {
                let message = match message {
                    Ok(message) => message,
                    Err(_) => return PipelineOutcome::Fatal(PowerShellSessionError::ProtocolFailed),
                };
                let terminal = publish_message(entry, &pipeline_id, &message);
                if let Some(state) = terminal {
                    entry.finish_pipeline(state, cancel_requested);
                    return if state == PipelineTerminal::Disconnected {
                        PipelineOutcome::Fatal(PowerShellSessionError::ProtocolFailed)
                    } else {
                        PipelineOutcome::Complete
                    };
                }
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PipelineTerminal {
    Completed,
    Failed,
    Stopped,
    Disconnected,
}

fn publish_message(
    entry: &SessionEntry,
    pipeline_id: &str,
    message: &PsrpMessage,
) -> Option<PipelineTerminal> {
    let values = parse_clixml(&message.data).unwrap_or_default();
    match message.message_type {
        MessageType::PipelineOutput => {
            publish_values(entry, pipeline_id, PowerShellStreamKind::Output, values)
        }
        MessageType::ErrorRecord => {
            for value in values {
                let text = ErrorRecord::from_ps_object(&value)
                    .and_then(|record| record.exception.and_then(|exception| exception.message))
                    .unwrap_or_else(|| display_value(&value));
                entry.publish(
                    Some(pipeline_id),
                    PowerShellStreamKind::Error,
                    text,
                    Some(value_json(&value)),
                    None,
                    None,
                );
            }
        }
        MessageType::WarningRecord => {
            for value in values {
                let text = WarningRecord::from_ps_object(&value)
                    .map_or_else(|| display_value(&value), |record| record.message);
                entry.publish(
                    Some(pipeline_id),
                    PowerShellStreamKind::Warning,
                    text,
                    Some(value_json(&value)),
                    None,
                    None,
                );
            }
        }
        MessageType::VerboseRecord | MessageType::DebugRecord => {
            let kind = if message.message_type == MessageType::VerboseRecord {
                PowerShellStreamKind::Verbose
            } else {
                PowerShellStreamKind::Debug
            };
            for value in values {
                let text = TraceRecord::from_ps_object(&value)
                    .map_or_else(|| display_value(&value), |record| record.message);
                entry.publish(
                    Some(pipeline_id),
                    kind,
                    text,
                    Some(value_json(&value)),
                    None,
                    None,
                );
            }
        }
        MessageType::InformationRecord => {
            for value in values {
                let text = InformationRecord::from_ps_object(&value)
                    .and_then(|record| record.message_data)
                    .map_or_else(|| display_value(&value), |message| display_value(&message));
                entry.publish(
                    Some(pipeline_id),
                    PowerShellStreamKind::Information,
                    text,
                    Some(value_json(&value)),
                    None,
                    None,
                );
            }
        }
        MessageType::ProgressRecord => {
            for value in values {
                let progress = ProgressRecord::from_ps_object(&value).map(progress_from_record);
                let text = progress
                    .as_ref()
                    .and_then(|progress| {
                        progress
                            .status_description
                            .clone()
                            .or_else(|| progress.activity.clone())
                    })
                    .unwrap_or_else(|| display_value(&value));
                entry.publish(
                    Some(pipeline_id),
                    PowerShellStreamKind::Progress,
                    text,
                    Some(value_json(&value)),
                    progress,
                    None,
                );
            }
        }
        MessageType::PipelineState => {
            let (name, terminal) = pipeline_state(&values);
            entry.publish(
                Some(pipeline_id),
                PowerShellStreamKind::PipelineState,
                name.to_owned(),
                None,
                None,
                Some(name.to_owned()),
            );
            return terminal;
        }
        _ => {}
    }
    None
}

fn publish_values(
    entry: &SessionEntry,
    pipeline_id: &str,
    kind: PowerShellStreamKind,
    values: Vec<PsValue>,
) {
    for value in values {
        entry.publish(
            Some(pipeline_id),
            kind,
            display_value(&value),
            Some(value_json(&value)),
            None,
            None,
        );
    }
}

fn pipeline_state(values: &[PsValue]) -> (&'static str, Option<PipelineTerminal>) {
    let code = values.iter().find_map(|value| match value {
        PsValue::Object(object) => object.get("PipelineState").and_then(PsValue::as_i32),
        _ => None,
    });
    match code {
        Some(0) => ("not_started", None),
        Some(1) => ("running", None),
        Some(2) => ("stopping", None),
        Some(3) => ("stopped", Some(PipelineTerminal::Stopped)),
        Some(4) => ("completed", Some(PipelineTerminal::Completed)),
        Some(5) => ("failed", Some(PipelineTerminal::Failed)),
        Some(6) => ("disconnected", Some(PipelineTerminal::Disconnected)),
        _ => ("unknown", None),
    }
}

fn progress_from_record(record: ProgressRecord) -> PowerShellProgress {
    PowerShellProgress {
        activity: record.activity,
        activity_id: record.activity_id,
        status_description: record.status_description,
        current_operation: record.current_operation,
        parent_activity_id: record.parent_activity_id,
        percent_complete: record.percent_complete,
        seconds_remaining: record.seconds_remaining,
        record_type: record.record_type,
    }
}

fn display_value(value: &PsValue) -> String {
    match value {
        PsValue::Null => "$null".to_owned(),
        PsValue::Bool(value) => value.to_string(),
        PsValue::I8(value) => value.to_string(),
        PsValue::U8(value) => value.to_string(),
        PsValue::I16(value) => value.to_string(),
        PsValue::U16(value) => value.to_string(),
        PsValue::I32(value) => value.to_string(),
        PsValue::U32(value) => value.to_string(),
        PsValue::I64(value) => value.to_string(),
        PsValue::U64(value) => value.to_string(),
        PsValue::F32(value) => value.to_string(),
        PsValue::Double(value) => value.to_string(),
        PsValue::Decimal(value)
        | PsValue::String(value)
        | PsValue::DateTime(value)
        | PsValue::Duration(value)
        | PsValue::Version(value)
        | PsValue::Uri(value)
        | PsValue::Xml(value)
        | PsValue::ScriptBlock(value) => value.clone(),
        PsValue::Char(value) => value.to_string(),
        PsValue::Bytes(value) => base64::engine::general_purpose::STANDARD.encode(value),
        PsValue::Guid(value) => value.to_string(),
        PsValue::SecureString(_) => "[SecureString]".to_owned(),
        PsValue::Object(object) => object
            .to_string
            .clone()
            .unwrap_or_else(|| serde_json::to_string(&value_json(value)).unwrap_or_default()),
        PsValue::List(_) | PsValue::Dict(_) => {
            serde_json::to_string(&value_json(value)).unwrap_or_default()
        }
    }
}

fn value_json(value: &PsValue) -> serde_json::Value {
    match value {
        PsValue::Null => serde_json::Value::Null,
        PsValue::Bool(value) => (*value).into(),
        PsValue::I8(value) => i64::from(*value).into(),
        PsValue::U8(value) => u64::from(*value).into(),
        PsValue::I16(value) => i64::from(*value).into(),
        PsValue::U16(value) => u64::from(*value).into(),
        PsValue::I32(value) => i64::from(*value).into(),
        PsValue::U32(value) => u64::from(*value).into(),
        PsValue::I64(value) => (*value).into(),
        PsValue::U64(value) => (*value).into(),
        PsValue::F32(value) => serde_json::Number::from_f64(f64::from(*value))
            .map_or_else(|| value.to_string().into(), Into::into),
        PsValue::Double(value) => serde_json::Number::from_f64(*value)
            .map_or_else(|| value.to_string().into(), Into::into),
        PsValue::Decimal(value)
        | PsValue::String(value)
        | PsValue::DateTime(value)
        | PsValue::Duration(value)
        | PsValue::Version(value)
        | PsValue::Uri(value)
        | PsValue::Xml(value)
        | PsValue::ScriptBlock(value) => value.clone().into(),
        PsValue::Char(value) => value.to_string().into(),
        PsValue::Bytes(value) => base64::engine::general_purpose::STANDARD.encode(value).into(),
        PsValue::Guid(value) => value.to_string().into(),
        PsValue::SecureString(_) => "[SecureString]".into(),
        PsValue::List(values) => values.iter().map(value_json).collect::<Vec<_>>().into(),
        PsValue::Dict(entries) => entries
            .iter()
            .map(|(key, value)| serde_json::json!({ "key": value_json(key), "value": value_json(value) }))
            .collect::<Vec<_>>()
            .into(),
        PsValue::Object(object) => {
            let mut map = serde_json::Map::new();
            for (key, value) in &object.properties {
                map.insert(key.clone(), value_json(value));
            }
            if !object.type_names.is_empty() {
                map.insert("__typeNames".into(), serde_json::json!(object.type_names));
            }
            if let Some(display) = &object.to_string {
                map.insert("__display".into(), display.clone().into());
            }
            map.into()
        }
    }
}

fn strict_config(options: &PowerShellSshSessionOptions) -> StrictSshPsrpConfig {
    StrictSshPsrpConfig {
        host: options.host.clone(),
        port: options.port,
        username: options.username.clone(),
        auth: match &options.auth {
            PowerShellSshAuth::Password { password } => StrictSshAuth::Password(password.clone()),
            PowerShellSshAuth::PrivateKey { path, passphrase } => StrictSshAuth::PrivateKey {
                path: path.clone(),
                passphrase: passphrase.clone(),
            },
            PowerShellSshAuth::Agent => StrictSshAuth::Agent,
        },
        subsystem: options.subsystem.clone(),
        host_key_policy: match &options.host_key_policy {
            PowerShellSshHostKeyPolicy::PinnedSha256 { fingerprint } => {
                SshHostKeyPolicy::PinnedSha256(fingerprint.clone())
            }
            PowerShellSshHostKeyPolicy::KnownHosts { path } => {
                SshHostKeyPolicy::KnownHosts(path.clone())
            }
        },
        connect_timeout: Duration::from_millis(options.connect_timeout_ms),
        request_timeout: Duration::from_millis(options.request_timeout_ms),
        event_capacity: options.event_capacity,
    }
}

impl From<PowerShellPipelineInput> for PsValue {
    fn from(input: PowerShellPipelineInput) -> Self {
        match input {
            PowerShellPipelineInput::Null => Self::Null,
            PowerShellPipelineInput::String(value) => Self::String(value),
            PowerShellPipelineInput::Boolean(value) => Self::Bool(value),
            PowerShellPipelineInput::Integer(value) => Self::I64(value),
            PowerShellPipelineInput::Float(value) => Self::Double(value),
        }
    }
}

impl RuntimeCounters {
    fn new(now: i64) -> Self {
        Self {
            opened_at_ms: now,
            last_activity_at_ms: AtomicI64::new(now),
            pipelines_started: AtomicU64::new(0),
            pipelines_completed: AtomicU64::new(0),
            pipelines_failed: AtomicU64::new(0),
            pipelines_cancelled: AtomicU64::new(0),
            input_objects_sent: AtomicU64::new(0),
            events_emitted: AtomicU64::new(0),
            delivery_failures: AtomicU64::new(0),
            replay_evictions: AtomicU64::new(0),
        }
    }

    fn touch(&self) {
        self.last_activity_at_ms
            .store(Utc::now().timestamp_millis(), Ordering::Relaxed);
    }

    fn snapshot(&self, closed_at_ms: Option<i64>) -> PowerShellSessionStats {
        PowerShellSessionStats {
            opened_at_ms: self.opened_at_ms,
            last_activity_at_ms: self.last_activity_at_ms.load(Ordering::Relaxed),
            closed_at_ms,
            pipelines_started: self.pipelines_started.load(Ordering::Relaxed),
            pipelines_completed: self.pipelines_completed.load(Ordering::Relaxed),
            pipelines_failed: self.pipelines_failed.load(Ordering::Relaxed),
            pipelines_cancelled: self.pipelines_cancelled.load(Ordering::Relaxed),
            input_objects_sent: self.input_objects_sent.load(Ordering::Relaxed),
            events_emitted: self.events_emitted.load(Ordering::Relaxed),
            delivery_failures: self.delivery_failures.load(Ordering::Relaxed),
            replay_evictions: self.replay_evictions.load(Ordering::Relaxed),
        }
    }
}

impl SessionEntry {
    fn snapshot(&self) -> PowerShellSession {
        let runtime = read_lock(&self.runtime);
        let active_pipeline = runtime.active_pipeline_id.clone();
        PowerShellSession {
            id: self.id.clone(),
            connection_id: self.connection_id.clone(),
            host: self.host.clone(),
            port: self.port,
            username: self.username.clone(),
            runspace_id: self.runspace_id.clone(),
            phase: runtime.phase,
            active_pipeline_id: active_pipeline.clone(),
            input_open: runtime.input_open,
            terminal_error_code: runtime.terminal_error_code.clone(),
            capabilities: PowerShellSessionCapabilities::default(),
            stats: self.counters.snapshot(runtime.closed_at_ms),
            diagnostics: PowerShellSessionDiagnostics {
                transport: "ssh".into(),
                host_key_verification: "strict".into(),
                authentication: "established".into(),
                runspace_health: match runtime.phase {
                    PowerShellSessionPhase::Failed => "failed",
                    PowerShellSessionPhase::Closed => "closed",
                    _ => "healthy",
                }
                .into(),
                active_pipeline,
                limitations: STRICT_SSH_PSRP_LIMITATIONS
                    .iter()
                    .map(|value| (*value).to_owned())
                    .collect(),
            },
        }
    }

    fn start_pipeline(&self, pipeline_id: &str, input_open: bool) {
        let mut runtime = write_lock(&self.runtime);
        runtime.phase = PowerShellSessionPhase::Running;
        runtime.active_pipeline_id = Some(pipeline_id.to_owned());
        runtime.input_open = input_open;
        self.counters
            .pipelines_started
            .fetch_add(1, Ordering::Relaxed);
        self.counters.touch();
    }

    fn finish_pipeline(&self, terminal: PipelineTerminal, cancel_requested: bool) {
        let mut runtime = write_lock(&self.runtime);
        runtime.phase = PowerShellSessionPhase::Ready;
        runtime.active_pipeline_id = None;
        runtime.input_open = false;
        match terminal {
            PipelineTerminal::Completed => {
                self.counters
                    .pipelines_completed
                    .fetch_add(1, Ordering::Relaxed);
            }
            PipelineTerminal::Stopped if cancel_requested => {
                self.counters
                    .pipelines_cancelled
                    .fetch_add(1, Ordering::Relaxed);
            }
            PipelineTerminal::Failed
            | PipelineTerminal::Stopped
            | PipelineTerminal::Disconnected => {
                self.counters
                    .pipelines_failed
                    .fetch_add(1, Ordering::Relaxed);
            }
        }
        self.counters.touch();
    }

    fn set_input_open(&self, open: bool) {
        write_lock(&self.runtime).input_open = open;
        self.counters.touch();
    }

    fn begin_cancel(&self) {
        write_lock(&self.runtime).phase = PowerShellSessionPhase::Cancelling;
        self.publish_session_state("cancelling");
    }

    fn begin_close(&self) {
        write_lock(&self.runtime).phase = PowerShellSessionPhase::Closing;
    }

    fn finish_close(&self) {
        let now = Utc::now().timestamp_millis();
        let mut runtime = write_lock(&self.runtime);
        runtime.phase = PowerShellSessionPhase::Closed;
        runtime.active_pipeline_id = None;
        runtime.input_open = false;
        runtime.closed_at_ms = Some(now);
        self.counters
            .last_activity_at_ms
            .store(now, Ordering::Relaxed);
    }

    fn fail(&self, error_code: &str) {
        let now = Utc::now().timestamp_millis();
        let mut runtime = write_lock(&self.runtime);
        runtime.phase = PowerShellSessionPhase::Failed;
        runtime.active_pipeline_id = None;
        runtime.input_open = false;
        runtime.terminal_error_code = Some(error_code.to_owned());
        runtime.closed_at_ms = Some(now);
        self.counters
            .last_activity_at_ms
            .store(now, Ordering::Relaxed);
    }

    fn publish_session_state(&self, state: &str) {
        self.publish(
            None,
            PowerShellStreamKind::SessionState,
            state.to_owned(),
            None,
            None,
            Some(state.to_owned()),
        );
    }

    fn publish(
        &self,
        pipeline_id: Option<&str>,
        kind: PowerShellStreamKind,
        text: String,
        value: Option<serde_json::Value>,
        progress: Option<PowerShellProgress>,
        pipeline_state: Option<String>,
    ) {
        let sequence = self.next_sequence.fetch_add(1, Ordering::Relaxed);
        let event = PowerShellSessionEvent {
            session_id: self.id.clone(),
            sequence,
            timestamp_ms: Utc::now().timestamp_millis(),
            pipeline_id: pipeline_id.map(str::to_owned),
            kind,
            text,
            value,
            progress,
            pipeline_state,
        };
        let evicted = lock_mutex(&self.replay).push(event.clone());
        self.counters
            .replay_evictions
            .fetch_add(evicted, Ordering::Relaxed);
        self.counters.events_emitted.fetch_add(1, Ordering::Relaxed);
        self.counters.touch();
        let sink = lock_mutex(&self.delivery).sink.clone();
        if let Some(sink) = sink {
            if sink
                .send(&PowerShellEventEnvelope {
                    event,
                    replayed: false,
                })
                .is_err()
            {
                self.counters
                    .delivery_failures
                    .fetch_add(1, Ordering::Relaxed);
            }
        }
    }

    fn replay_snapshot(&self, after_sequence: Option<u64>) -> PowerShellEventReplay {
        lock_mutex(&self.replay)
            .snapshot(after_sequence, self.next_sequence.load(Ordering::Relaxed))
    }
}

async fn finish_session(shared: Arc<ServiceShared>, entry: Arc<SessionEntry>) {
    shared.active.write().await.remove(&entry.id);
    let snapshot = entry.snapshot();
    let mut completed = lock_mutex(&shared.completed);
    completed.push_front(snapshot);
    while completed.len() > MAX_COMPLETED_SESSIONS {
        completed.pop_back();
    }
}

fn lock_mutex<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

fn read_lock<T>(lock: &RwLock<T>) -> RwLockReadGuard<'_, T> {
    lock.read()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

fn write_lock<T>(lock: &RwLock<T>) -> RwLockWriteGuard<'_, T> {
    lock.write()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capabilities_are_truthful_for_shipping_ssh_adapter() {
        let capabilities = PowerShellSessionCapabilities::default();
        assert_eq!(capabilities.transport, "ssh");
        assert!(capabilities.pipeline_input);
        assert!(capabilities.pipeline_cancellation);
        assert!(capabilities.all_streams);
        assert!(!capabilities.transport_reconnect);
        assert!(!capabilities.wsman_available);
    }

    #[test]
    fn secret_values_are_redacted_from_debug_output() {
        let auth = PowerShellSshAuth::Password {
            password: "do-not-print".into(),
        };
        let debug = format!("{auth:?}");
        assert!(!debug.contains("do-not-print"));
        assert!(debug.contains("REDACTED"));
    }

    #[test]
    fn secure_string_is_never_exposed_by_event_value_conversion() {
        let value = PsValue::SecureString("ciphertext".into());
        assert_eq!(display_value(&value), "[SecureString]");
        assert_eq!(value_json(&value), serde_json::json!("[SecureString]"));
    }

    #[test]
    fn terminal_pipeline_states_are_detected() {
        for (code, name, terminal) in [
            (3, "stopped", PipelineTerminal::Stopped),
            (4, "completed", PipelineTerminal::Completed),
            (5, "failed", PipelineTerminal::Failed),
            (6, "disconnected", PipelineTerminal::Disconnected),
        ] {
            let values = vec![PsValue::Object(
                psrp_rs::PsObject::new().with("PipelineState", PsValue::I32(code)),
            )];
            assert_eq!(pipeline_state(&values), (name, Some(terminal)));
        }
    }
}
