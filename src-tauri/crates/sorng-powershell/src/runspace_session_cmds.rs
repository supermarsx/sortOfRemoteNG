use std::sync::Arc;

use super::runspace_session::*;
use tauri::ipc::Channel;

struct TauriPowerShellSessionSink {
    channel: Channel<PowerShellEventEnvelope>,
}

impl PowerShellSessionSink for TauriPowerShellSessionSink {
    fn send(&self, envelope: &PowerShellEventEnvelope) -> Result<(), PowerShellSinkError> {
        self.channel
            .send(envelope.clone())
            .map_err(|_| PowerShellSinkError)
    }
}

fn tauri_sink(channel: Channel<PowerShellEventEnvelope>) -> DynPowerShellSessionSink {
    Arc::new(TauriPowerShellSessionSink { channel })
}

#[tauri::command]
pub async fn open_powershell_session(
    options: PowerShellSessionOptions,
    event_channel: Channel<PowerShellEventEnvelope>,
    state: tauri::State<'_, PowerShellSessionServiceState>,
) -> Result<String, PowerShellSessionError> {
    state.open_session(options, tauri_sink(event_channel)).await
}

#[tauri::command]
pub async fn attach_powershell_session(
    session_id: String,
    after_sequence: Option<u64>,
    event_channel: Channel<PowerShellEventEnvelope>,
    state: tauri::State<'_, PowerShellSessionServiceState>,
) -> Result<PowerShellEventReplay, PowerShellSessionError> {
    state
        .attach(&session_id, after_sequence, tauri_sink(event_channel))
        .await
}

#[tauri::command]
pub async fn detach_powershell_session(
    session_id: String,
    state: tauri::State<'_, PowerShellSessionServiceState>,
) -> Result<(), PowerShellSessionError> {
    state.detach(&session_id).await
}

#[tauri::command]
pub async fn close_powershell_session(
    session_id: String,
    state: tauri::State<'_, PowerShellSessionServiceState>,
) -> Result<(), PowerShellSessionError> {
    state.close_session(&session_id).await
}

#[tauri::command]
pub async fn close_all_powershell_sessions(
    state: tauri::State<'_, PowerShellSessionServiceState>,
) -> Result<usize, PowerShellSessionError> {
    Ok(state.close_all_sessions().await)
}

#[tauri::command]
pub async fn start_powershell_pipeline(
    session_id: String,
    script: String,
    accepts_input: bool,
    state: tauri::State<'_, PowerShellSessionServiceState>,
) -> Result<PowerShellPipelineStarted, PowerShellSessionError> {
    state
        .start_pipeline(&session_id, script, accepts_input)
        .await
}

#[tauri::command]
pub async fn write_powershell_pipeline_input(
    session_id: String,
    input: PowerShellPipelineInput,
    state: tauri::State<'_, PowerShellSessionServiceState>,
) -> Result<(), PowerShellSessionError> {
    state.write_pipeline_input(&session_id, input).await
}

#[tauri::command]
pub async fn end_powershell_pipeline_input(
    session_id: String,
    state: tauri::State<'_, PowerShellSessionServiceState>,
) -> Result<(), PowerShellSessionError> {
    state.end_pipeline_input(&session_id).await
}

#[tauri::command]
pub async fn cancel_powershell_pipeline(
    session_id: String,
    state: tauri::State<'_, PowerShellSessionServiceState>,
) -> Result<(), PowerShellSessionError> {
    state.cancel_pipeline(&session_id).await
}

#[tauri::command]
pub async fn get_powershell_session(
    session_id: String,
    state: tauri::State<'_, PowerShellSessionServiceState>,
) -> Result<PowerShellSession, PowerShellSessionError> {
    state.session(&session_id).await
}

#[tauri::command]
pub async fn get_powershell_session_replay(
    session_id: String,
    after_sequence: Option<u64>,
    state: tauri::State<'_, PowerShellSessionServiceState>,
) -> Result<PowerShellEventReplay, PowerShellSessionError> {
    state.replay(&session_id, after_sequence).await
}

#[tauri::command]
pub async fn list_powershell_sessions(
    state: tauri::State<'_, PowerShellSessionServiceState>,
) -> Result<Vec<PowerShellSession>, PowerShellSessionError> {
    Ok(state.sessions().await)
}

#[tauri::command]
pub async fn get_powershell_session_capabilities(
    state: tauri::State<'_, PowerShellSessionServiceState>,
) -> Result<PowerShellSessionCapabilities, PowerShellSessionError> {
    Ok(state.capabilities())
}

#[tauri::command]
pub async fn get_powershell_session_stats(
    session_id: String,
    state: tauri::State<'_, PowerShellSessionServiceState>,
) -> Result<PowerShellSessionStats, PowerShellSessionError> {
    Ok(state.session(&session_id).await?.stats)
}

#[tauri::command]
pub async fn get_powershell_session_diagnostics(
    session_id: String,
    state: tauri::State<'_, PowerShellSessionServiceState>,
) -> Result<PowerShellSessionDiagnostics, PowerShellSessionError> {
    Ok(state.session(&session_id).await?.diagnostics)
}
