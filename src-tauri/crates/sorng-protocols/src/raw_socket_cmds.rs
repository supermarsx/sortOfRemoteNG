use super::raw_socket::*;
use std::sync::Arc;
use tauri::ipc::{Channel, InvokeResponseBody};

struct TauriRawSocketSink {
    data_channel: Channel<InvokeResponseBody>,
    event_channel: Channel<RawSocketEvent>,
}

impl RawSocketSink for TauriRawSocketSink {
    fn send_frame(
        &self,
        session_id: &str,
        frame: &RawSocketFrame,
        replayed: bool,
    ) -> Result<(), RawSocketSinkError> {
        self.data_channel
            .send(InvokeResponseBody::Raw(frame.data.clone()))
            .map_err(|_| RawSocketSinkError)?;
        self.event_channel
            .send(RawSocketEvent::Data {
                frame: frame_metadata(session_id, frame, replayed),
            })
            .map_err(|_| RawSocketSinkError)
    }

    fn send_event(&self, event: &RawSocketEvent) -> Result<(), RawSocketSinkError> {
        self.event_channel
            .send(event.clone())
            .map_err(|_| RawSocketSinkError)
    }
}

fn tauri_sink(
    data_channel: Channel<InvokeResponseBody>,
    event_channel: Channel<RawSocketEvent>,
) -> DynRawSocketSink {
    Arc::new(TauriRawSocketSink {
        data_channel,
        event_channel,
    })
}

#[tauri::command]
pub async fn connect_raw_socket(
    options: RawSocketConnectOptions,
    data_channel: Channel<InvokeResponseBody>,
    event_channel: Channel<RawSocketEvent>,
    state: tauri::State<'_, RawSocketServiceState>,
) -> Result<String, RawSocketError> {
    state
        .connect_raw_socket(options, tauri_sink(data_channel, event_channel))
        .await
}

#[tauri::command]
pub async fn attach_raw_socket(
    session_id: String,
    data_channel: Channel<InvokeResponseBody>,
    event_channel: Channel<RawSocketEvent>,
    state: tauri::State<'_, RawSocketServiceState>,
) -> Result<RawSocketReplay, RawSocketError> {
    state
        .attach_raw_socket(&session_id, tauri_sink(data_channel, event_channel))
        .await
}

#[tauri::command]
pub async fn detach_raw_socket(
    session_id: String,
    state: tauri::State<'_, RawSocketServiceState>,
) -> Result<(), RawSocketError> {
    state.detach_raw_socket(&session_id).await
}

#[tauri::command]
pub async fn disconnect_raw_socket(
    session_id: String,
    state: tauri::State<'_, RawSocketServiceState>,
) -> Result<(), RawSocketError> {
    state.disconnect_raw_socket(&session_id).await
}

#[tauri::command]
pub async fn disconnect_all_raw_sockets(
    state: tauri::State<'_, RawSocketServiceState>,
) -> Result<usize, RawSocketError> {
    Ok(state.disconnect_all_raw_sockets().await)
}

#[tauri::command]
pub async fn send_raw_socket_data(
    session_id: String,
    data: Vec<u8>,
    state: tauri::State<'_, RawSocketServiceState>,
) -> Result<(), RawSocketError> {
    state.send_raw_socket_data(&session_id, data).await
}

#[tauri::command]
pub async fn shutdown_raw_socket_write(
    session_id: String,
    state: tauri::State<'_, RawSocketServiceState>,
) -> Result<(), RawSocketError> {
    state.shutdown_raw_socket_write(&session_id).await
}

#[tauri::command]
pub async fn get_raw_socket_session_info(
    session_id: String,
    state: tauri::State<'_, RawSocketServiceState>,
) -> Result<RawSocketSession, RawSocketError> {
    state.get_raw_socket_session_info(&session_id).await
}

#[tauri::command]
pub async fn get_raw_socket_replay(
    session_id: String,
    state: tauri::State<'_, RawSocketServiceState>,
) -> Result<RawSocketReplay, RawSocketError> {
    state.get_raw_socket_replay(&session_id).await
}

#[tauri::command]
pub async fn list_raw_socket_sessions(
    state: tauri::State<'_, RawSocketServiceState>,
) -> Result<Vec<RawSocketSession>, RawSocketError> {
    Ok(state.list_raw_socket_sessions().await)
}
