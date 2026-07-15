use super::io::{BoxedRloginStream, RloginByteStream};
use super::replay::ReplaySnapshot;
use super::session::{InputOutcome, OutputDisposition, ResizeOutcome, RloginEngine, UrgentOutcome};
use super::types::{
    RloginConfig, RloginError, RloginLifecycle, RloginStats, TerminalMode, WindowSize,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;

pub type RloginServiceState = Arc<Mutex<RloginService>>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RloginSession {
    pub id: String,
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
    pub stats: RloginStats,
}

struct ManagedSession {
    config: RloginConfig,
    engine: Arc<Mutex<RloginEngine<BoxedRloginStream>>>,
}

/// Session registry around the transport-independent engine.  The production
/// command layer must resolve a network path and call `connect_with_stream`.
/// The legacy host-only method is retained solely so disabled command shims
/// continue to compile; it intentionally does not bypass the shared transport.
pub struct RloginService {
    connections: HashMap<String, ManagedSession>,
}

impl RloginService {
    pub fn new() -> RloginServiceState {
        Arc::new(Mutex::new(Self {
            connections: HashMap::new(),
        }))
    }

    pub async fn connect_with_stream<S>(
        &mut self,
        config: RloginConfig,
        stream: S,
    ) -> Result<String, RloginError>
    where
        S: RloginByteStream + 'static,
    {
        let boxed = BoxedRloginStream::new(stream);
        let engine = RloginEngine::establish(boxed, config.clone()).await?;
        let session_id = Uuid::new_v4().to_string();
        self.connections.insert(
            session_id.clone(),
            ManagedSession {
                config,
                engine: Arc::new(Mutex::new(engine)),
            },
        );
        Ok(session_id)
    }

    pub async fn connect_rlogin(
        &mut self,
        host: String,
        port: u16,
        local_username: String,
        remote_username: String,
        terminal_type: String,
    ) -> Result<String, String> {
        let config = RloginConfig {
            host,
            port,
            local_username,
            remote_username,
            terminal_type,
            ..RloginConfig::default()
        };
        config.validate().map_err(|error| error.to_string())?;
        Err(RloginError::TransportUnavailable.to_string())
    }

    pub async fn disconnect_rlogin(&mut self, session_id: &str) -> Result<(), String> {
        let Some(session) = self.connections.remove(session_id) else {
            // Disconnect is deliberately idempotent so duplicate window-close
            // and lifecycle cleanup signals cannot turn into user-facing errors.
            return Ok(());
        };
        let result = {
            let mut engine = session.engine.lock().await;
            engine.close().await
        };
        result.map_err(|error| error.to_string())
    }

    pub async fn send_rlogin_command(
        &mut self,
        session_id: &str,
        command: String,
    ) -> Result<(), String> {
        self.send_rlogin_input(session_id, command.as_bytes())
            .await
            .map(|_| ())
            .map_err(|error| error.to_string())
    }

    pub async fn send_rlogin_input(
        &self,
        session_id: &str,
        input: &[u8],
    ) -> Result<InputOutcome, RloginError> {
        let engine = self.engine(session_id)?;
        let mut engine = engine.lock().await;
        engine.write_input(input).await
    }

    pub async fn read_rlogin_output(
        &self,
        session_id: &str,
        buffer: &mut [u8],
    ) -> Result<OutputDisposition, RloginError> {
        let engine = self.engine(session_id)?;
        let mut engine = engine.lock().await;
        engine.read_output(buffer).await
    }

    pub async fn resize_rlogin(
        &self,
        session_id: &str,
        size: WindowSize,
    ) -> Result<ResizeOutcome, RloginError> {
        let engine = self.engine(session_id)?;
        let mut engine = engine.lock().await;
        engine.resize(size).await
    }

    pub async fn handle_rlogin_urgent(
        &self,
        session_id: &str,
        control: u8,
    ) -> Result<UrgentOutcome, RloginError> {
        let engine = self.engine(session_id)?;
        let mut engine = engine.lock().await;
        engine.handle_urgent_control(control).await
    }

    pub async fn get_rlogin_output_snapshot(
        &self,
        session_id: &str,
        after_sequence: u64,
    ) -> Result<ReplaySnapshot, RloginError> {
        let engine = self.engine(session_id)?;
        let engine = engine.lock().await;
        Ok(engine.output_snapshot_after(after_sequence))
    }

    pub async fn get_rlogin_session_info(&self, session_id: &str) -> Result<RloginSession, String> {
        let managed = self
            .connections
            .get(session_id)
            .ok_or(RloginError::SessionNotFound)
            .map_err(|error| error.to_string())?;
        Ok(session_snapshot(session_id, managed).await)
    }

    pub async fn list_rlogin_sessions(&self) -> Vec<RloginSession> {
        let mut sessions = Vec::with_capacity(self.connections.len());
        for (session_id, managed) in &self.connections {
            sessions.push(session_snapshot(session_id, managed).await);
        }
        sessions.sort_by(|left, right| left.id.cmp(&right.id));
        sessions
    }

    fn engine(
        &self,
        session_id: &str,
    ) -> Result<Arc<Mutex<RloginEngine<BoxedRloginStream>>>, RloginError> {
        self.connections
            .get(session_id)
            .map(|session| Arc::clone(&session.engine))
            .ok_or(RloginError::SessionNotFound)
    }
}

async fn session_snapshot(session_id: &str, managed: &ManagedSession) -> RloginSession {
    let engine = managed.engine.lock().await;
    let urgent = engine.urgent_state();
    RloginSession {
        id: session_id.to_string(),
        host: managed.config.host.clone(),
        port: managed.config.port,
        local_username: managed.config.local_username.clone(),
        remote_username: managed.config.remote_username.clone(),
        terminal_type: managed.config.terminal_type.clone(),
        terminal_speed: managed.config.terminal_speed,
        connected: engine.is_connected(),
        lifecycle: engine.lifecycle(),
        terminal_mode: urgent.terminal_mode,
        window_updates_enabled: urgent.window_updates_enabled,
        stats: engine.stats().clone(),
    }
}
