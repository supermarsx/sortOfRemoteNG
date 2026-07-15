use super::rlogin::*;
use std::sync::Arc;
use tauri::ipc::{Channel, InvokeResponseBody};

struct TauriRloginSink {
    data_channel: Channel<InvokeResponseBody>,
    event_channel: Channel<RloginEvent>,
}

impl RloginSink for TauriRloginSink {
    fn send_frame(
        &self,
        _session_id: &str,
        frame: &OutputFrame,
        _replayed: bool,
    ) -> Result<(), RloginSinkError> {
        self.data_channel
            .send(InvokeResponseBody::Raw(frame.data.clone()))
            .map_err(|_| RloginSinkError)
    }

    fn send_event(&self, event: &RloginEvent) -> Result<(), RloginSinkError> {
        self.event_channel
            .send(event.clone())
            .map_err(|_| RloginSinkError)
    }
}

fn tauri_sink(
    data_channel: Channel<InvokeResponseBody>,
    event_channel: Channel<RloginEvent>,
) -> DynRloginSink {
    Arc::new(TauriRloginSink {
        data_channel,
        event_channel,
    })
}

#[tauri::command]
pub async fn connect_rlogin(
    options: RloginConnectOptions,
    data_channel: Channel<InvokeResponseBody>,
    event_channel: Channel<RloginEvent>,
    state: tauri::State<'_, RloginServiceState>,
) -> Result<String, RloginError> {
    state
        .connect_rlogin(options, tauri_sink(data_channel, event_channel))
        .await
}

#[tauri::command]
pub async fn send_rlogin_input(
    session_id: String,
    data: Vec<u8>,
    state: tauri::State<'_, RloginServiceState>,
) -> Result<InputOutcome, RloginError> {
    state.send_rlogin_input(&session_id, data).await
}

#[tauri::command]
pub async fn resize_rlogin(
    session_id: String,
    size: WindowSize,
    state: tauri::State<'_, RloginServiceState>,
) -> Result<ResizeOutcome, RloginError> {
    state.resize_rlogin(&session_id, size).await
}

#[tauri::command]
pub async fn get_rlogin_output_snapshot(
    session_id: String,
    after_sequence: u64,
    state: tauri::State<'_, RloginServiceState>,
) -> Result<ReplaySnapshot, RloginError> {
    state
        .get_rlogin_output_snapshot(&session_id, after_sequence)
        .await
}

#[tauri::command]
pub async fn get_rlogin_session_info(
    session_id: String,
    state: tauri::State<'_, RloginServiceState>,
) -> Result<RloginSession, RloginError> {
    state.get_rlogin_session_info(&session_id).await
}

#[tauri::command]
pub async fn list_rlogin_sessions(
    state: tauri::State<'_, RloginServiceState>,
) -> Result<Vec<RloginSession>, RloginError> {
    Ok(state.list_rlogin_sessions().await)
}

#[tauri::command]
pub async fn disconnect_rlogin(
    session_id: String,
    state: tauri::State<'_, RloginServiceState>,
) -> Result<(), RloginError> {
    state.disconnect_rlogin(&session_id).await
}

#[tauri::command]
pub async fn disconnect_all_rlogin_sessions(
    state: tauri::State<'_, RloginServiceState>,
) -> Result<usize, RloginError> {
    Ok(state.disconnect_all_rlogin_sessions().await)
}

#[tauri::command]
pub async fn diagnose_rlogin_connection(
    options: RloginConnectOptions,
    state: tauri::State<'_, RloginServiceState>,
) -> Result<RloginDiagnosis, RloginError> {
    Ok(state.diagnose_rlogin(&options))
}
