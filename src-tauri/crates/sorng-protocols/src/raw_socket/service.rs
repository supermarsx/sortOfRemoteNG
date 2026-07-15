use super::replay::ReplayBuffer;
use super::{
    DynRawSocketSink, RawSocketConnectOptions, RawSocketDirection, RawSocketError, RawSocketEvent,
    RawSocketFrame, RawSocketLimits, RawSocketReplay, RawSocketSession, RawSocketStats,
    RawSocketStatus, RawSocketTerminalReason, RawSocketTransport, MAX_ACTIVE_SESSIONS,
    MAX_UDP_DATAGRAM_BYTES,
};
use chrono::Utc;
use sorng_socket_transport::{
    SocketConnector, SocketTarget, TcpConnection, TcpOptions, TransportError, UdpConnection,
    UdpOptions,
};
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicI64, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;
use tokio::sync::{mpsc, oneshot, RwLock as AsyncRwLock};
use tokio::task::JoinHandle;
use tokio::time::timeout;
use uuid::Uuid;

const MAX_COMPLETED_SESSIONS: usize = 128;

pub type RawSocketServiceState = Arc<RawSocketService>;

pub struct RawSocketService {
    shared: Arc<ServiceShared>,
}

struct ServiceShared {
    active: AsyncRwLock<HashMap<String, Arc<ConnectionEntry>>>,
    completed: Mutex<VecDeque<RawSocketSession>>,
}

struct ConnectionEntry {
    id: String,
    connection_id: Option<String>,
    host: String,
    port: u16,
    transport: RawSocketTransport,
    local_address: String,
    remote_address: String,
    limits: RawSocketLimits,
    command_timeout: Duration,
    command_tx: mpsc::Sender<RawSocketCommand>,
    handle: Mutex<Option<JoinHandle<()>>>,
    runtime: RwLock<RuntimeState>,
    counters: RuntimeCounters,
    replay: Mutex<ReplayBuffer>,
    delivery: Mutex<DeliveryState>,
    next_sequence: AtomicU64,
}

struct RuntimeState {
    status: RawSocketStatus,
    disconnected_at_ms: Option<i64>,
    terminal_reason: Option<RawSocketTerminalReason>,
}

struct RuntimeCounters {
    bytes_sent: AtomicU64,
    bytes_received: AtomicU64,
    frames_sent: AtomicU64,
    frames_received: AtomicU64,
    datagrams_sent: AtomicU64,
    datagrams_received: AtomicU64,
    delivery_failures: AtomicU64,
    replay_evictions: AtomicU64,
    connected_at_ms: i64,
    last_activity_at_ms: AtomicI64,
}

struct DeliveryState {
    sink: Option<DynRawSocketSink>,
}

enum ConnectedSocket {
    Tcp(TcpConnection),
    Udp(UdpConnection),
}

enum RawSocketCommand {
    Send {
        data: Vec<u8>,
        result: oneshot::Sender<Result<(), RawSocketError>>,
    },
    ShutdownWrite {
        result: oneshot::Sender<Result<(), RawSocketError>>,
    },
    Shutdown {
        result: oneshot::Sender<Result<(), RawSocketError>>,
    },
}

impl RawSocketService {
    pub fn new() -> RawSocketServiceState {
        Arc::new(Self {
            shared: Arc::new(ServiceShared {
                active: AsyncRwLock::new(HashMap::new()),
                completed: Mutex::new(VecDeque::new()),
            }),
        })
    }

    pub async fn connect_raw_socket(
        &self,
        options: RawSocketConnectOptions,
        sink: DynRawSocketSink,
    ) -> Result<String, RawSocketError> {
        options.validate()?;

        if let Some(connection_id) = options.connection_id.as_deref() {
            let previous = {
                let active = self.shared.active.read().await;
                active
                    .values()
                    .find(|entry| entry.connection_id.as_deref() == Some(connection_id))
                    .map(|entry| entry.id.clone())
            };
            if let Some(previous) = previous {
                self.disconnect_raw_socket(&previous).await?;
            }
        }

        if self.shared.active.read().await.len() >= MAX_ACTIVE_SESSIONS {
            return Err(RawSocketError::SessionLimitReached);
        }

        let connector = SocketConnector::new();
        let target = SocketTarget::new(options.host.clone(), options.port);
        let connected = match options.transport {
            RawSocketTransport::Tcp => ConnectedSocket::Tcp(
                connector
                    .connect_tcp(
                        &target,
                        options.route,
                        TcpOptions {
                            address_family: options.address_family,
                            local_bind: options.local_bind(),
                            no_delay: options.tcp_no_delay,
                            keepalive: options.tcp_keepalive_ms.map(Duration::from_millis),
                            timeouts: options.timeouts(),
                        },
                    )
                    .await?,
            ),
            RawSocketTransport::Udp => ConnectedSocket::Udp(
                connector
                    .connect_udp(
                        &target,
                        options.route,
                        UdpOptions {
                            address_family: options.address_family,
                            local_bind: options.local_bind(),
                            timeouts: options.timeouts(),
                        },
                    )
                    .await?,
            ),
        };

        let (local_address, remote_address) = match &connected {
            ConnectedSocket::Tcp(connection) => (
                connection.local_addr()?.to_string(),
                connection.peer_addr()?.to_string(),
            ),
            ConnectedSocket::Udp(connection) => (
                connection.local_addr()?.to_string(),
                connection.peer_addr()?.to_string(),
            ),
        };
        let session_id = Uuid::new_v4().to_string();
        let (command_tx, command_rx) = mpsc::channel(options.limits.command_queue_capacity);
        let now = Utc::now().timestamp_millis();
        let entry = Arc::new(ConnectionEntry {
            id: session_id.clone(),
            connection_id: options.connection_id.clone(),
            host: options.host.clone(),
            port: options.port,
            transport: options.transport,
            local_address,
            remote_address,
            limits: options.limits.clone(),
            command_timeout: Duration::from_millis(
                options
                    .write_timeout_ms
                    .saturating_add(options.limits.queue_wait_timeout_ms),
            ),
            command_tx,
            handle: Mutex::new(None),
            runtime: RwLock::new(RuntimeState {
                status: RawSocketStatus::Connected,
                disconnected_at_ms: None,
                terminal_reason: None,
            }),
            counters: RuntimeCounters::new(now),
            replay: Mutex::new(ReplayBuffer::new(
                options.limits.replay_frames,
                options.limits.replay_bytes,
            )),
            delivery: Mutex::new(DeliveryState { sink: Some(sink) }),
            next_sequence: AtomicU64::new(1),
        });

        {
            let mut active = self.shared.active.write().await;
            if active.len() >= MAX_ACTIVE_SESSIONS {
                close_unstarted(connected);
                return Err(RawSocketError::SessionLimitReached);
            }
            active.insert(session_id.clone(), entry.clone());
        }

        deliver_event(
            &entry,
            RawSocketEvent::Connected {
                session: entry.snapshot(),
            },
        );
        let shared = self.shared.clone();
        let task_entry = entry.clone();
        let handle = tokio::spawn(async move {
            let reason = match connected {
                ConnectedSocket::Tcp(connection) => {
                    run_tcp(task_entry.clone(), connection, command_rx).await
                }
                ConnectedSocket::Udp(connection) => {
                    run_udp(task_entry.clone(), connection, command_rx).await
                }
            };
            finish_session(shared, task_entry, reason).await;
        });
        *lock_mutex(&entry.handle) = Some(handle);

        Ok(session_id)
    }

    pub async fn send_raw_socket_data(
        &self,
        session_id: &str,
        data: Vec<u8>,
    ) -> Result<(), RawSocketError> {
        let entry = self.active_entry(session_id).await?;
        let protocol_max = match entry.transport {
            RawSocketTransport::Tcp => entry.limits.max_send_bytes,
            RawSocketTransport::Udp => entry.limits.max_send_bytes.min(MAX_UDP_DATAGRAM_BYTES),
        };
        if data.len() > protocol_max {
            return Err(RawSocketError::PayloadTooLarge);
        }
        let (result_tx, result_rx) = oneshot::channel();
        self.enqueue(
            &entry,
            RawSocketCommand::Send {
                data,
                result: result_tx,
            },
            result_rx,
        )
        .await
    }

    pub async fn shutdown_raw_socket_write(&self, session_id: &str) -> Result<(), RawSocketError> {
        let entry = self.active_entry(session_id).await?;
        let (result_tx, result_rx) = oneshot::channel();
        self.enqueue(
            &entry,
            RawSocketCommand::ShutdownWrite { result: result_tx },
            result_rx,
        )
        .await
    }

    pub async fn disconnect_raw_socket(&self, session_id: &str) -> Result<(), RawSocketError> {
        let entry = match self.shared.active.read().await.get(session_id).cloned() {
            Some(entry) => entry,
            None if self.completed_session(session_id).is_some() => return Ok(()),
            None => return Err(RawSocketError::SessionNotFound),
        };
        {
            let mut runtime = write_lock(&entry.runtime);
            if runtime.status == RawSocketStatus::Connected
                || runtime.status == RawSocketStatus::WriteClosed
            {
                runtime.status = RawSocketStatus::Closing;
            }
        }
        let (result_tx, result_rx) = oneshot::channel();
        let command_result = self
            .enqueue(
                &entry,
                RawSocketCommand::Shutdown { result: result_tx },
                result_rx,
            )
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

    pub async fn disconnect_all_raw_sockets(&self) -> usize {
        let session_ids: Vec<String> = self.shared.active.read().await.keys().cloned().collect();
        let mut disconnected = 0;
        for session_id in session_ids {
            if self.disconnect_raw_socket(&session_id).await.is_ok() {
                disconnected += 1;
            }
        }
        disconnected
    }

    pub async fn attach_raw_socket(
        &self,
        session_id: &str,
        sink: DynRawSocketSink,
    ) -> Result<RawSocketReplay, RawSocketError> {
        let entry = self.active_entry(session_id).await?;
        let mut delivery = lock_mutex(&entry.delivery);
        let replay = entry.replay_snapshot();
        if sink
            .send_event(&RawSocketEvent::ReplayStarted {
                session_id: session_id.to_owned(),
                frame_count: replay.frames.len(),
            })
            .is_err()
        {
            entry.counters.record_delivery_failure();
            return Err(RawSocketError::DeliveryUnavailable);
        }
        for frame in &replay.frames {
            if sink.send_frame(session_id, frame, true).is_err() {
                entry.counters.record_delivery_failure();
                return Err(RawSocketError::DeliveryUnavailable);
            }
        }
        if sink
            .send_event(&RawSocketEvent::ReplayCompleted {
                session_id: session_id.to_owned(),
                frame_count: replay.frames.len(),
            })
            .is_err()
        {
            entry.counters.record_delivery_failure();
            return Err(RawSocketError::DeliveryUnavailable);
        }
        delivery.sink = Some(sink);
        Ok(replay)
    }

    pub async fn detach_raw_socket(&self, session_id: &str) -> Result<(), RawSocketError> {
        let entry = self.active_entry(session_id).await?;
        let mut delivery = lock_mutex(&entry.delivery);
        if let Some(sink) = delivery.sink.take() {
            let _ = sink.send_event(&RawSocketEvent::Detached {
                session_id: session_id.to_owned(),
            });
        }
        Ok(())
    }

    pub async fn get_raw_socket_replay(
        &self,
        session_id: &str,
    ) -> Result<RawSocketReplay, RawSocketError> {
        Ok(self.active_entry(session_id).await?.replay_snapshot())
    }

    pub async fn get_raw_socket_session_info(
        &self,
        session_id: &str,
    ) -> Result<RawSocketSession, RawSocketError> {
        if let Some(entry) = self.shared.active.read().await.get(session_id).cloned() {
            return Ok(entry.snapshot());
        }
        self.completed_session(session_id)
            .ok_or(RawSocketError::SessionNotFound)
    }

    pub async fn list_raw_socket_sessions(&self) -> Vec<RawSocketSession> {
        let active: Vec<_> = self
            .shared
            .active
            .read()
            .await
            .values()
            .map(|entry| entry.snapshot())
            .collect();
        let mut sessions = active;
        sessions.extend(lock_mutex(&self.shared.completed).iter().cloned());
        sessions.sort_by_key(|session| std::cmp::Reverse(session.stats.connected_at_ms));
        sessions
    }

    pub async fn active_session_count(&self) -> usize {
        self.shared.active.read().await.len()
    }

    async fn active_entry(&self, session_id: &str) -> Result<Arc<ConnectionEntry>, RawSocketError> {
        self.shared
            .active
            .read()
            .await
            .get(session_id)
            .cloned()
            .ok_or(RawSocketError::SessionClosed)
    }

    async fn enqueue(
        &self,
        entry: &Arc<ConnectionEntry>,
        command: RawSocketCommand,
        result_rx: oneshot::Receiver<Result<(), RawSocketError>>,
    ) -> Result<(), RawSocketError> {
        match timeout(
            Duration::from_millis(entry.limits.queue_wait_timeout_ms),
            entry.command_tx.send(command),
        )
        .await
        {
            Err(_) => return Err(RawSocketError::CommandQueueFull),
            Ok(Err(_)) => return Err(RawSocketError::SessionClosed),
            Ok(Ok(())) => {}
        }
        match timeout(entry.command_timeout, result_rx).await {
            Err(_) => Err(RawSocketError::CommandTimedOut),
            Ok(Err(_)) => Err(RawSocketError::SessionClosed),
            Ok(Ok(result)) => result,
        }
    }

    fn completed_session(&self, session_id: &str) -> Option<RawSocketSession> {
        lock_mutex(&self.shared.completed)
            .iter()
            .find(|session| session.id == session_id)
            .cloned()
    }
}

impl RuntimeCounters {
    fn new(now: i64) -> Self {
        Self {
            bytes_sent: AtomicU64::new(0),
            bytes_received: AtomicU64::new(0),
            frames_sent: AtomicU64::new(0),
            frames_received: AtomicU64::new(0),
            datagrams_sent: AtomicU64::new(0),
            datagrams_received: AtomicU64::new(0),
            delivery_failures: AtomicU64::new(0),
            replay_evictions: AtomicU64::new(0),
            connected_at_ms: now,
            last_activity_at_ms: AtomicI64::new(now),
        }
    }

    fn record_frame(&self, direction: RawSocketDirection, datagram: bool, byte_length: usize) {
        let bytes = u64::try_from(byte_length).unwrap_or(u64::MAX);
        match direction {
            RawSocketDirection::Inbound => {
                self.bytes_received.fetch_add(bytes, Ordering::Relaxed);
                self.frames_received.fetch_add(1, Ordering::Relaxed);
                if datagram {
                    self.datagrams_received.fetch_add(1, Ordering::Relaxed);
                }
            }
            RawSocketDirection::Outbound => {
                self.bytes_sent.fetch_add(bytes, Ordering::Relaxed);
                self.frames_sent.fetch_add(1, Ordering::Relaxed);
                if datagram {
                    self.datagrams_sent.fetch_add(1, Ordering::Relaxed);
                }
            }
        }
        self.last_activity_at_ms
            .store(Utc::now().timestamp_millis(), Ordering::Relaxed);
    }

    fn record_delivery_failure(&self) {
        self.delivery_failures.fetch_add(1, Ordering::Relaxed);
    }

    fn snapshot(&self, disconnected_at_ms: Option<i64>) -> RawSocketStats {
        RawSocketStats {
            bytes_sent: self.bytes_sent.load(Ordering::Relaxed),
            bytes_received: self.bytes_received.load(Ordering::Relaxed),
            frames_sent: self.frames_sent.load(Ordering::Relaxed),
            frames_received: self.frames_received.load(Ordering::Relaxed),
            datagrams_sent: self.datagrams_sent.load(Ordering::Relaxed),
            datagrams_received: self.datagrams_received.load(Ordering::Relaxed),
            delivery_failures: self.delivery_failures.load(Ordering::Relaxed),
            replay_evictions: self.replay_evictions.load(Ordering::Relaxed),
            connected_at_ms: self.connected_at_ms,
            last_activity_at_ms: self.last_activity_at_ms.load(Ordering::Relaxed),
            disconnected_at_ms,
        }
    }
}

impl ConnectionEntry {
    fn snapshot(&self) -> RawSocketSession {
        let runtime = read_lock(&self.runtime);
        RawSocketSession {
            id: self.id.clone(),
            connection_id: self.connection_id.clone(),
            host: self.host.clone(),
            port: self.port,
            transport: self.transport,
            status: runtime.status,
            local_address: self.local_address.clone(),
            remote_address: self.remote_address.clone(),
            stats: self.counters.snapshot(runtime.disconnected_at_ms),
            terminal_reason: runtime.terminal_reason.clone(),
        }
    }

    fn replay_snapshot(&self) -> RawSocketReplay {
        let replay = lock_mutex(&self.replay);
        RawSocketReplay {
            session_id: self.id.clone(),
            frames: replay.snapshot(),
            evicted_frames: replay.evicted(),
        }
    }
}

async fn run_tcp(
    entry: Arc<ConnectionEntry>,
    connection: TcpConnection,
    mut commands: mpsc::Receiver<RawSocketCommand>,
) -> RawSocketTerminalReason {
    let (mut reader, mut writer) = connection.into_split();
    let mut buffer = vec![0_u8; entry.limits.read_chunk_bytes];
    let reason = loop {
        tokio::select! {
            biased;
            command = commands.recv() => match command {
                Some(RawSocketCommand::Send { data, result }) => {
                    match writer.write_all(&data).await {
                        Ok(()) => {
                            publish_frame(&entry, RawSocketDirection::Outbound, false, data);
                            let _ = result.send(Ok(()));
                        }
                        Err(error) => {
                            let _ = result.send(Err(error.clone().into()));
                            break RawSocketTerminalReason::TransportError { error };
                        }
                    }
                }
                Some(RawSocketCommand::ShutdownWrite { result }) => {
                    match writer.shutdown_write().await {
                        Ok(()) => {
                            write_lock(&entry.runtime).status = RawSocketStatus::WriteClosed;
                            deliver_event(&entry, RawSocketEvent::WriteClosed { session_id: entry.id.clone() });
                            let _ = result.send(Ok(()));
                        }
                        Err(error) => {
                            let _ = result.send(Err(error.clone().into()));
                            break RawSocketTerminalReason::TransportError { error };
                        }
                    }
                }
                Some(RawSocketCommand::Shutdown { result }) => {
                    let _ = result.send(Ok(()));
                    break RawSocketTerminalReason::Requested;
                }
                None => break RawSocketTerminalReason::CommandChannelClosed,
            },
            read = reader.read(&mut buffer) => match read {
                Ok(0) => break RawSocketTerminalReason::PeerEof,
                Ok(size) => publish_frame(
                    &entry,
                    RawSocketDirection::Inbound,
                    false,
                    buffer[..size].to_vec(),
                ),
                Err(TransportError::TimedOut { operation: sorng_socket_transport::Operation::Read }) => {
                    break RawSocketTerminalReason::IdleTimeout;
                }
                Err(error) => break RawSocketTerminalReason::TransportError { error },
            }
        }
    };
    let _ = writer.close().await;
    reason
}

async fn run_udp(
    entry: Arc<ConnectionEntry>,
    connection: UdpConnection,
    mut commands: mpsc::Receiver<RawSocketCommand>,
) -> RawSocketTerminalReason {
    // A connected UDP receive returns one datagram per call.  Always reserve
    // the protocol maximum so the configured TCP chunk size can never
    // truncate a UDP datagram while still keeping allocation strictly bounded.
    let mut buffer = vec![0_u8; MAX_UDP_DATAGRAM_BYTES];
    let reason = loop {
        tokio::select! {
            biased;
            command = commands.recv() => match command {
                Some(RawSocketCommand::Send { data, result }) => {
                    match connection.send(&data).await {
                        Ok(size) if size == data.len() => {
                            publish_frame(&entry, RawSocketDirection::Outbound, true, data);
                            let _ = result.send(Ok(()));
                        }
                        Ok(_) => {
                            let error = TransportError::Io {
                                operation: sorng_socket_transport::Operation::Write,
                                kind: sorng_socket_transport::RedactedIoKind::Other,
                                os_code: None,
                            };
                            let _ = result.send(Err(error.clone().into()));
                            break RawSocketTerminalReason::TransportError { error };
                        }
                        Err(error) => {
                            let _ = result.send(Err(error.clone().into()));
                            break RawSocketTerminalReason::TransportError { error };
                        }
                    }
                }
                Some(RawSocketCommand::ShutdownWrite { result }) => {
                    let _ = result.send(Err(RawSocketError::HalfCloseUnsupported));
                }
                Some(RawSocketCommand::Shutdown { result }) => {
                    let _ = result.send(Ok(()));
                    break RawSocketTerminalReason::Requested;
                }
                None => break RawSocketTerminalReason::CommandChannelClosed,
            },
            read = connection.recv(&mut buffer) => match read {
                Ok(size) => publish_frame(
                    &entry,
                    RawSocketDirection::Inbound,
                    true,
                    buffer[..size].to_vec(),
                ),
                Err(TransportError::TimedOut { operation: sorng_socket_transport::Operation::Read }) => {
                    break RawSocketTerminalReason::IdleTimeout;
                }
                Err(error) => break RawSocketTerminalReason::TransportError { error },
            }
        }
    };
    connection.close();
    reason
}

fn publish_frame(
    entry: &Arc<ConnectionEntry>,
    direction: RawSocketDirection,
    datagram: bool,
    data: Vec<u8>,
) {
    let frame = RawSocketFrame {
        sequence: entry.next_sequence.fetch_add(1, Ordering::Relaxed),
        timestamp_ms: Utc::now().timestamp_millis(),
        direction,
        datagram,
        data,
    };
    entry
        .counters
        .record_frame(direction, datagram, frame.data.len());
    let evicted = lock_mutex(&entry.replay).push(frame.clone());
    if evicted > 0 {
        entry
            .counters
            .replay_evictions
            .fetch_add(evicted, Ordering::Relaxed);
    }
    let mut delivery = lock_mutex(&entry.delivery);
    if delivery
        .sink
        .as_ref()
        .is_some_and(|sink| sink.send_frame(&entry.id, &frame, false).is_err())
    {
        delivery.sink = None;
        entry.counters.record_delivery_failure();
    }
}

fn deliver_event(entry: &Arc<ConnectionEntry>, event: RawSocketEvent) {
    let mut delivery = lock_mutex(&entry.delivery);
    if delivery
        .sink
        .as_ref()
        .is_some_and(|sink| sink.send_event(&event).is_err())
    {
        delivery.sink = None;
        entry.counters.record_delivery_failure();
    }
}

async fn finish_session(
    shared: Arc<ServiceShared>,
    entry: Arc<ConnectionEntry>,
    reason: RawSocketTerminalReason,
) {
    {
        let mut runtime = write_lock(&entry.runtime);
        runtime.status = if matches!(reason, RawSocketTerminalReason::TransportError { .. }) {
            RawSocketStatus::Failed
        } else {
            RawSocketStatus::Disconnected
        };
        runtime.disconnected_at_ms = Some(Utc::now().timestamp_millis());
        runtime.terminal_reason = Some(reason.clone());
    }
    let session = entry.snapshot();
    deliver_event(
        &entry,
        RawSocketEvent::Disconnected {
            session: session.clone(),
            reason,
        },
    );
    {
        let mut completed = lock_mutex(&shared.completed);
        completed.retain(|existing| existing.id != session.id);
        completed.push_front(session);
        completed.truncate(MAX_COMPLETED_SESSIONS);
    }
    // Publish the completed snapshot before removing the active entry so
    // info/disconnect callers never observe a transient "not found" gap.
    shared.active.write().await.remove(&entry.id);
}

fn close_unstarted(socket: ConnectedSocket) {
    match socket {
        ConnectedSocket::Tcp(connection) => connection.cancellation_token().cancel(),
        ConnectedSocket::Udp(connection) => connection.close(),
    }
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::raw_socket::{RawSocketEvent, RawSocketFrame, RawSocketSink, RawSocketSinkError};
    use std::net::{IpAddr, Ipv4Addr};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::{TcpListener, UdpSocket};

    #[derive(Default)]
    struct MemorySink {
        frames: Mutex<Vec<RawSocketFrame>>,
        events: Mutex<Vec<RawSocketEvent>>,
    }

    impl RawSocketSink for MemorySink {
        fn send_frame(
            &self,
            _session_id: &str,
            frame: &RawSocketFrame,
            _replayed: bool,
        ) -> Result<(), RawSocketSinkError> {
            lock_mutex(&self.frames).push(frame.clone());
            Ok(())
        }

        fn send_event(&self, event: &RawSocketEvent) -> Result<(), RawSocketSinkError> {
            lock_mutex(&self.events).push(event.clone());
            Ok(())
        }
    }

    fn options(host: String, port: u16, transport: RawSocketTransport) -> RawSocketConnectOptions {
        RawSocketConnectOptions {
            host,
            port,
            transport,
            connection_id: Some("test-slot".to_owned()),
            route: sorng_socket_transport::Route::Direct,
            address_family: sorng_socket_transport::AddressFamily::Ipv4Only,
            local_bind_address: Some(IpAddr::V4(Ipv4Addr::LOCALHOST)),
            local_bind_port: 0,
            connect_timeout_ms: 2_000,
            write_timeout_ms: 2_000,
            idle_timeout_ms: 2_000,
            tcp_no_delay: true,
            tcp_keepalive_ms: None,
            limits: RawSocketLimits {
                replay_frames: 8,
                replay_bytes: 1_024,
                read_chunk_bytes: 1_024,
                max_send_bytes: 1_024,
                ..RawSocketLimits::default()
            },
        }
    }

    async fn wait_for_inbound(sink: &MemorySink, count: usize) {
        timeout(Duration::from_secs(2), async {
            loop {
                let actual = lock_mutex(&sink.frames)
                    .iter()
                    .filter(|frame| frame.direction == RawSocketDirection::Inbound)
                    .count();
                if actual >= count {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("inbound frames should arrive");
    }

    async fn wait_for_cleanup(service: &RawSocketService) {
        timeout(Duration::from_secs(2), async {
            while service.active_session_count().await != 0 {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("session should leave the active map");
    }

    #[tokio::test]
    async fn tcp_session_sends_receives_half_closes_and_cleans_up_on_eof() {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut payload = [0_u8; 4];
            stream.read_exact(&mut payload).await.unwrap();
            stream.write_all(&payload).await.unwrap();
            let mut eof = [0_u8; 1];
            assert_eq!(stream.read(&mut eof).await.unwrap(), 0);
        });
        let service = RawSocketService::new();
        let sink = Arc::new(MemorySink::default());
        let session_id = service
            .connect_raw_socket(
                options(
                    address.ip().to_string(),
                    address.port(),
                    RawSocketTransport::Tcp,
                ),
                sink.clone(),
            )
            .await
            .unwrap();
        service
            .send_raw_socket_data(&session_id, vec![0, 1, 0xfe, 0xff])
            .await
            .unwrap();
        wait_for_inbound(&sink, 1).await;
        service
            .shutdown_raw_socket_write(&session_id)
            .await
            .unwrap();
        server.await.unwrap();
        wait_for_cleanup(&service).await;
        let session = service
            .get_raw_socket_session_info(&session_id)
            .await
            .unwrap();
        assert_eq!(session.status, RawSocketStatus::Disconnected);
        assert_eq!(session.stats.bytes_sent, 4);
        assert_eq!(session.stats.bytes_received, 4);
        assert_eq!(
            session.terminal_reason,
            Some(RawSocketTerminalReason::PeerEof)
        );
        service.disconnect_raw_socket(&session_id).await.unwrap();
    }

    #[tokio::test]
    async fn udp_session_preserves_binary_and_empty_datagrams() {
        let server = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
        let address = server.local_addr().unwrap();
        let server_task = tokio::spawn(async move {
            let mut buffer = [0_u8; 16];
            for _ in 0..2 {
                let (size, peer) = server.recv_from(&mut buffer).await.unwrap();
                server.send_to(&buffer[..size], peer).await.unwrap();
            }
        });
        let service = RawSocketService::new();
        let sink = Arc::new(MemorySink::default());
        let session_id = service
            .connect_raw_socket(
                options(
                    address.ip().to_string(),
                    address.port(),
                    RawSocketTransport::Udp,
                ),
                sink.clone(),
            )
            .await
            .unwrap();
        service
            .send_raw_socket_data(&session_id, vec![0, 0xff])
            .await
            .unwrap();
        service
            .send_raw_socket_data(&session_id, Vec::new())
            .await
            .unwrap();
        wait_for_inbound(&sink, 2).await;
        let inbound: Vec<_> = lock_mutex(&sink.frames)
            .iter()
            .filter(|frame| frame.direction == RawSocketDirection::Inbound)
            .cloned()
            .collect();
        assert_eq!(inbound[0].data, vec![0, 0xff]);
        assert!(inbound[0].datagram);
        assert!(inbound[1].data.is_empty());
        let session = service
            .get_raw_socket_session_info(&session_id)
            .await
            .unwrap();
        assert_eq!(session.stats.datagrams_sent, 2);
        assert_eq!(session.stats.datagrams_received, 2);
        assert_eq!(
            service.shutdown_raw_socket_write(&session_id).await,
            Err(RawSocketError::HalfCloseUnsupported)
        );
        service.disconnect_raw_socket(&session_id).await.unwrap();
        server_task.await.unwrap();
    }

    #[test]
    fn privileged_raw_protocol_aliases_are_rejected() {
        assert!(serde_json::from_str::<RawSocketTransport>("\"raw_tcp\"").is_err());
        assert!(serde_json::from_str::<RawSocketTransport>("\"raw_udp\"").is_err());
        assert_eq!(
            serde_json::from_str::<RawSocketTransport>("\"tcp\"").unwrap(),
            RawSocketTransport::Tcp
        );
    }

    #[tokio::test]
    async fn invalid_limits_fail_before_network_access() {
        let service = RawSocketService::new();
        let mut invalid = options("example.invalid".to_owned(), 9, RawSocketTransport::Tcp);
        invalid.limits.command_queue_capacity = 0;
        assert_eq!(
            service
                .connect_raw_socket(invalid, Arc::new(MemorySink::default()))
                .await,
            Err(RawSocketError::InvalidConfiguration)
        );
    }
}
