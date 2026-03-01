// sorng-recording – Tauri commands
//
// Every `#[tauri::command]` function lives here.
// All are async, take `tauri::State<RecordingServiceState>`, and return
// `Result<T, String>` for Tauri bridge compatibility.

use crate::service::RecordingServiceState;
use crate::types::*;

// ═══════════════════════════════════════════════════════════════════════
//  Config
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn rec_get_config(
    state: tauri::State<'_, RecordingServiceState>,
) -> Result<RecordingGlobalConfig, String> {
    let svc = state.lock().await;
    Ok(svc.get_config().await)
}

#[tauri::command]
pub async fn rec_update_config(
    state: tauri::State<'_, RecordingServiceState>,
    config: RecordingGlobalConfig,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.update_config(config).await.map_err(|e| e.to_string())
}

// ═══════════════════════════════════════════════════════════════════════
//  Terminal recording  (SSH, Telnet-as-terminal, etc.)
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn rec_start_terminal(
    state: tauri::State<'_, RecordingServiceState>,
    session_id: String,
    protocol: RecordingProtocol,
    host: String,
    username: String,
    cols: Option<u32>,
    rows: Option<u32>,
    record_input: Option<bool>,
    tags: Option<Vec<String>>,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.start_terminal_recording(
        session_id,
        protocol,
        host,
        username,
        cols.unwrap_or(80),
        rows.unwrap_or(24),
        record_input.unwrap_or(false),
        tags.unwrap_or_default(),
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rec_stop_terminal(
    state: tauri::State<'_, RecordingServiceState>,
    session_id: String,
) -> Result<TerminalRecording, String> {
    let svc = state.lock().await;
    svc.stop_terminal_recording(&session_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rec_terminal_status(
    state: tauri::State<'_, RecordingServiceState>,
    session_id: String,
) -> Result<Option<TerminalRecordingMetadata>, String> {
    let svc = state.lock().await;
    Ok(svc.get_terminal_recording_status(&session_id).await)
}

#[tauri::command]
pub async fn rec_is_terminal_recording(
    state: tauri::State<'_, RecordingServiceState>,
    session_id: String,
) -> Result<bool, String> {
    let svc = state.lock().await;
    Ok(svc.is_terminal_recording(&session_id).await)
}

#[tauri::command]
pub async fn rec_append_terminal_output(
    state: tauri::State<'_, RecordingServiceState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.append_terminal_output(&session_id, &data).await;
    Ok(())
}

#[tauri::command]
pub async fn rec_append_terminal_input(
    state: tauri::State<'_, RecordingServiceState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.append_terminal_input(&session_id, &data).await;
    Ok(())
}

#[tauri::command]
pub async fn rec_append_terminal_resize(
    state: tauri::State<'_, RecordingServiceState>,
    session_id: String,
    cols: u32,
    rows: u32,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.append_terminal_resize(&session_id, cols, rows).await;
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════
//  Screen recording  (RDP, VNC)
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn rec_start_screen(
    state: tauri::State<'_, RecordingServiceState>,
    session_id: String,
    protocol: RecordingProtocol,
    host: String,
    connection_name: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    fps: Option<u32>,
    tags: Option<Vec<String>>,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.start_screen_recording(
        session_id,
        protocol,
        host,
        connection_name.unwrap_or_default(),
        width.unwrap_or(1920),
        height.unwrap_or(1080),
        fps.unwrap_or(30),
        tags.unwrap_or_default(),
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rec_stop_screen(
    state: tauri::State<'_, RecordingServiceState>,
    session_id: String,
) -> Result<RdpRecording, String> {
    let svc = state.lock().await;
    svc.stop_screen_recording(&session_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rec_screen_status(
    state: tauri::State<'_, RecordingServiceState>,
    session_id: String,
) -> Result<Option<RdpRecordingMetadata>, String> {
    let svc = state.lock().await;
    Ok(svc.get_screen_recording_status(&session_id).await)
}

#[tauri::command]
pub async fn rec_is_screen_recording(
    state: tauri::State<'_, RecordingServiceState>,
    session_id: String,
) -> Result<bool, String> {
    let svc = state.lock().await;
    Ok(svc.is_screen_recording(&session_id).await)
}

#[tauri::command]
pub async fn rec_append_screen_frame(
    state: tauri::State<'_, RecordingServiceState>,
    session_id: String,
    width: u32,
    height: u32,
    data_b64: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.append_screen_frame(&session_id, width, height, data_b64)
        .await;
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════
//  HTTP / HAR recording
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn rec_start_http(
    state: tauri::State<'_, RecordingServiceState>,
    session_id: String,
    host: String,
    target_url: String,
    record_headers: Option<bool>,
    tags: Option<Vec<String>>,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.start_http_recording(
        session_id,
        host,
        target_url,
        record_headers.unwrap_or(true),
        tags.unwrap_or_default(),
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rec_stop_http(
    state: tauri::State<'_, RecordingServiceState>,
    session_id: String,
) -> Result<HttpRecording, String> {
    let svc = state.lock().await;
    svc.stop_http_recording(&session_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rec_http_status(
    state: tauri::State<'_, RecordingServiceState>,
    session_id: String,
) -> Result<Option<HttpRecordingMetadata>, String> {
    let svc = state.lock().await;
    Ok(svc.get_http_recording_status(&session_id).await)
}

#[tauri::command]
pub async fn rec_is_http_recording(
    state: tauri::State<'_, RecordingServiceState>,
    session_id: String,
) -> Result<bool, String> {
    let svc = state.lock().await;
    Ok(svc.is_http_recording(&session_id).await)
}

#[tauri::command]
pub async fn rec_append_http_entry(
    state: tauri::State<'_, RecordingServiceState>,
    session_id: String,
    entry: HttpRecordingEntry,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.append_http_entry(&session_id, entry).await;
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════
//  Telnet recording
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn rec_start_telnet(
    state: tauri::State<'_, RecordingServiceState>,
    session_id: String,
    host: String,
    port: Option<u16>,
    tags: Option<Vec<String>>,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.start_telnet_recording(
        session_id,
        host,
        port.unwrap_or(23),
        tags.unwrap_or_default(),
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rec_stop_telnet(
    state: tauri::State<'_, RecordingServiceState>,
    session_id: String,
) -> Result<TelnetRecording, String> {
    let svc = state.lock().await;
    svc.stop_telnet_recording(&session_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rec_telnet_status(
    state: tauri::State<'_, RecordingServiceState>,
    session_id: String,
) -> Result<Option<TelnetRecordingMetadata>, String> {
    let svc = state.lock().await;
    Ok(svc.get_telnet_recording_status(&session_id).await)
}

#[tauri::command]
pub async fn rec_is_telnet_recording(
    state: tauri::State<'_, RecordingServiceState>,
    session_id: String,
) -> Result<bool, String> {
    let svc = state.lock().await;
    Ok(svc.is_telnet_recording(&session_id).await)
}

#[tauri::command]
pub async fn rec_append_telnet_entry(
    state: tauri::State<'_, RecordingServiceState>,
    session_id: String,
    entry: TelnetRecordingEntry,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.append_telnet_entry(&session_id, entry).await;
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════
//  Serial recording
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn rec_start_serial(
    state: tauri::State<'_, RecordingServiceState>,
    session_id: String,
    port_name: String,
    baud_rate: Option<u32>,
    tags: Option<Vec<String>>,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.start_serial_recording(
        session_id,
        port_name,
        baud_rate.unwrap_or(9600),
        tags.unwrap_or_default(),
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rec_stop_serial(
    state: tauri::State<'_, RecordingServiceState>,
    session_id: String,
) -> Result<SerialRecording, String> {
    let svc = state.lock().await;
    svc.stop_serial_recording(&session_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rec_serial_status(
    state: tauri::State<'_, RecordingServiceState>,
    session_id: String,
) -> Result<Option<SerialRecordingMetadata>, String> {
    let svc = state.lock().await;
    Ok(svc.get_serial_recording_status(&session_id).await)
}

#[tauri::command]
pub async fn rec_is_serial_recording(
    state: tauri::State<'_, RecordingServiceState>,
    session_id: String,
) -> Result<bool, String> {
    let svc = state.lock().await;
    Ok(svc.is_serial_recording(&session_id).await)
}

#[tauri::command]
pub async fn rec_append_serial_entry(
    state: tauri::State<'_, RecordingServiceState>,
    session_id: String,
    entry: SerialRecordingEntry,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.append_serial_entry(&session_id, entry).await;
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════
//  Database query recording
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn rec_start_db(
    state: tauri::State<'_, RecordingServiceState>,
    session_id: String,
    host: String,
    database_type: String,
    database_name: String,
    tags: Option<Vec<String>>,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.start_db_recording(
        session_id,
        host,
        database_type,
        database_name,
        tags.unwrap_or_default(),
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rec_stop_db(
    state: tauri::State<'_, RecordingServiceState>,
    session_id: String,
) -> Result<DbQueryRecording, String> {
    let svc = state.lock().await;
    svc.stop_db_recording(&session_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rec_db_status(
    state: tauri::State<'_, RecordingServiceState>,
    session_id: String,
) -> Result<Option<DbQueryRecordingMetadata>, String> {
    let svc = state.lock().await;
    Ok(svc.get_db_recording_status(&session_id).await)
}

#[tauri::command]
pub async fn rec_is_db_recording(
    state: tauri::State<'_, RecordingServiceState>,
    session_id: String,
) -> Result<bool, String> {
    let svc = state.lock().await;
    Ok(svc.is_db_recording(&session_id).await)
}

#[tauri::command]
pub async fn rec_append_db_entry(
    state: tauri::State<'_, RecordingServiceState>,
    session_id: String,
    entry: DbQueryEntry,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.append_db_entry(&session_id, entry).await;
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════
//  Macro recording & CRUD
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn rec_start_macro(
    state: tauri::State<'_, RecordingServiceState>,
    session_id: String,
    target_protocol: RecordingProtocol,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.start_macro_recording(session_id, target_protocol)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rec_macro_input(
    state: tauri::State<'_, RecordingServiceState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.macro_record_input(&session_id, &data).await;
    Ok(())
}

#[tauri::command]
pub async fn rec_stop_macro(
    state: tauri::State<'_, RecordingServiceState>,
    session_id: String,
    name: String,
    description: Option<String>,
    category: Option<String>,
    tags: Option<Vec<String>>,
) -> Result<MacroRecording, String> {
    let svc = state.lock().await;
    svc.stop_macro_recording(&session_id, name, description, category, tags.unwrap_or_default())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rec_is_macro_recording(
    state: tauri::State<'_, RecordingServiceState>,
    session_id: String,
) -> Result<bool, String> {
    let svc = state.lock().await;
    Ok(svc.is_macro_recording(&session_id).await)
}

#[tauri::command]
pub async fn rec_list_macros(
    state: tauri::State<'_, RecordingServiceState>,
) -> Result<Vec<MacroRecording>, String> {
    let svc = state.lock().await;
    Ok(svc.list_macros().await)
}

#[tauri::command]
pub async fn rec_get_macro(
    state: tauri::State<'_, RecordingServiceState>,
    macro_id: String,
) -> Result<Option<MacroRecording>, String> {
    let svc = state.lock().await;
    Ok(svc.get_macro(&macro_id).await)
}

#[tauri::command]
pub async fn rec_update_macro(
    state: tauri::State<'_, RecordingServiceState>,
    macro_rec: MacroRecording,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.update_macro(macro_rec).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rec_delete_macro(
    state: tauri::State<'_, RecordingServiceState>,
    macro_id: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.delete_macro(&macro_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rec_import_macro(
    state: tauri::State<'_, RecordingServiceState>,
    macro_rec: MacroRecording,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.import_macro(macro_rec).await.map_err(|e| e.to_string())
}

// ═══════════════════════════════════════════════════════════════════════
//  Encoding commands
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn rec_encode_asciicast(
    state: tauri::State<'_, RecordingServiceState>,
    recording: TerminalRecording,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.encode_terminal_asciicast(recording)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rec_encode_script(
    state: tauri::State<'_, RecordingServiceState>,
    recording: TerminalRecording,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.encode_terminal_script(recording)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rec_encode_har(
    state: tauri::State<'_, RecordingServiceState>,
    recording: HttpRecording,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.encode_http_har(recording)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rec_encode_db_csv(
    state: tauri::State<'_, RecordingServiceState>,
    recording: DbQueryRecording,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.encode_db_csv(recording)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rec_encode_http_csv(
    state: tauri::State<'_, RecordingServiceState>,
    recording: HttpRecording,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.encode_http_csv(recording)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rec_encode_telnet_asciicast(
    state: tauri::State<'_, RecordingServiceState>,
    recording: TelnetRecording,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.encode_telnet_asciicast(recording)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rec_encode_serial_raw(
    state: tauri::State<'_, RecordingServiceState>,
    recording: SerialRecording,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.encode_serial_raw(recording)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rec_encode_frame_manifest(
    state: tauri::State<'_, RecordingServiceState>,
    recording: RdpRecording,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.encode_frame_manifest(recording)
        .await
        .map_err(|e| e.to_string())
}

// ═══════════════════════════════════════════════════════════════════════
//  Compression commands
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn rec_compress(
    state: tauri::State<'_, RecordingServiceState>,
    data: String,
    algorithm: CompressionAlgorithm,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.compress_data(data, algorithm)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rec_decompress(
    state: tauri::State<'_, RecordingServiceState>,
    data: String,
    algorithm: CompressionAlgorithm,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.decompress_data(data, algorithm)
        .await
        .map_err(|e| e.to_string())
}

// ═══════════════════════════════════════════════════════════════════════
//  Combined encode + compress + save workflows
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn rec_save_terminal(
    state: tauri::State<'_, RecordingServiceState>,
    recording: TerminalRecording,
    name: String,
    description: Option<String>,
    format: Option<ExportFormat>,
    compression: Option<CompressionAlgorithm>,
    connection_id: Option<String>,
    tags: Option<Vec<String>>,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.encode_compress_save_terminal(
        recording,
        name,
        description,
        format.unwrap_or(ExportFormat::Asciicast),
        compression.unwrap_or(CompressionAlgorithm::Zstd),
        connection_id,
        tags.unwrap_or_default(),
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rec_save_http(
    state: tauri::State<'_, RecordingServiceState>,
    recording: HttpRecording,
    name: String,
    description: Option<String>,
    format: Option<ExportFormat>,
    compression: Option<CompressionAlgorithm>,
    connection_id: Option<String>,
    tags: Option<Vec<String>>,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.encode_compress_save_http(
        recording,
        name,
        description,
        format.unwrap_or(ExportFormat::Har),
        compression.unwrap_or(CompressionAlgorithm::Zstd),
        connection_id,
        tags.unwrap_or_default(),
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rec_save_screen(
    state: tauri::State<'_, RecordingServiceState>,
    recording: RdpRecording,
    name: String,
    description: Option<String>,
    format: Option<ExportFormat>,
    compression: Option<CompressionAlgorithm>,
    connection_id: Option<String>,
    tags: Option<Vec<String>>,
) -> Result<String, String> {
    let svc = state.lock().await;
    svc.encode_compress_save_screen(
        recording,
        name,
        description,
        format.unwrap_or(ExportFormat::FrameSequence),
        compression.unwrap_or(CompressionAlgorithm::Zstd),
        connection_id,
        tags.unwrap_or_default(),
    )
    .await
    .map_err(|e| e.to_string())
}

// ═══════════════════════════════════════════════════════════════════════
//  Library commands
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn rec_library_list(
    state: tauri::State<'_, RecordingServiceState>,
) -> Result<Vec<SavedRecordingEnvelope>, String> {
    let svc = state.lock().await;
    Ok(svc.list_library().await)
}

#[tauri::command]
pub async fn rec_library_get(
    state: tauri::State<'_, RecordingServiceState>,
    id: String,
) -> Result<Option<SavedRecordingEnvelope>, String> {
    let svc = state.lock().await;
    Ok(svc.get_from_library(&id).await)
}

#[tauri::command]
pub async fn rec_library_by_protocol(
    state: tauri::State<'_, RecordingServiceState>,
    protocol: RecordingProtocol,
) -> Result<Vec<SavedRecordingEnvelope>, String> {
    let svc = state.lock().await;
    Ok(svc.list_library_by_protocol(protocol).await)
}

#[tauri::command]
pub async fn rec_library_search(
    state: tauri::State<'_, RecordingServiceState>,
    query: String,
) -> Result<Vec<SavedRecordingEnvelope>, String> {
    let svc = state.lock().await;
    Ok(svc.search_library(&query).await)
}

#[tauri::command]
pub async fn rec_library_rename(
    state: tauri::State<'_, RecordingServiceState>,
    id: String,
    name: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.rename_in_library(&id, name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rec_library_update_tags(
    state: tauri::State<'_, RecordingServiceState>,
    id: String,
    tags: Vec<String>,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.update_library_tags(&id, tags)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rec_library_delete(
    state: tauri::State<'_, RecordingServiceState>,
    id: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    svc.delete_from_library(&id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rec_library_clear(
    state: tauri::State<'_, RecordingServiceState>,
) -> Result<usize, String> {
    let svc = state.lock().await;
    svc.clear_library().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rec_library_summary(
    state: tauri::State<'_, RecordingServiceState>,
) -> Result<RecordingLibrarySummary, String> {
    let svc = state.lock().await;
    Ok(svc.library_summary().await)
}

// ═══════════════════════════════════════════════════════════════════════
//  Aggregate / status commands
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn rec_list_active(
    state: tauri::State<'_, RecordingServiceState>,
) -> Result<Vec<ActiveRecordingInfo>, String> {
    let svc = state.lock().await;
    Ok(svc.list_active_recordings().await)
}

#[tauri::command]
pub async fn rec_active_count(
    state: tauri::State<'_, RecordingServiceState>,
) -> Result<usize, String> {
    let svc = state.lock().await;
    Ok(svc.active_count().await)
}

#[tauri::command]
pub async fn rec_stop_all(
    state: tauri::State<'_, RecordingServiceState>,
) -> Result<Vec<String>, String> {
    let svc = state.lock().await;
    Ok(svc.stop_all().await)
}

// ═══════════════════════════════════════════════════════════════════════
//  Jobs
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn rec_list_jobs(
    state: tauri::State<'_, RecordingServiceState>,
) -> Result<Vec<JobInfo>, String> {
    let svc = state.lock().await;
    Ok(svc.list_jobs().await)
}

#[tauri::command]
pub async fn rec_get_job(
    state: tauri::State<'_, RecordingServiceState>,
    job_id: String,
) -> Result<Option<JobInfo>, String> {
    let svc = state.lock().await;
    Ok(svc.get_job(&job_id).await)
}

#[tauri::command]
pub async fn rec_clear_jobs(
    state: tauri::State<'_, RecordingServiceState>,
) -> Result<usize, String> {
    let svc = state.lock().await;
    Ok(svc.clear_completed_jobs().await)
}

// ═══════════════════════════════════════════════════════════════════════
//  Cleanup & storage info
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn rec_run_cleanup(
    state: tauri::State<'_, RecordingServiceState>,
) -> Result<usize, String> {
    let svc = state.lock().await;
    svc.run_auto_cleanup().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rec_storage_size(
    state: tauri::State<'_, RecordingServiceState>,
) -> Result<u64, String> {
    let svc = state.lock().await;
    svc.storage_size().await.map_err(|e| e.to_string())
}
