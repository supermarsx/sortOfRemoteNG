// sorng-replay – Tauri commands
//
// Every `#[tauri::command]` function lives here.
// All are async, take `tauri::State<ReplayServiceState>`, and return
// `Result<T, String>` for Tauri bridge compatibility.

use crate::service::ReplayServiceState;
use crate::types::*;
use crate::{export, har_replay, search, terminal_replay, timeline};

// ═══════════════════════════════════════════════════════════════════════
//  Loading recordings
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn replay_load_terminal(
    state: tauri::State<'_, ReplayServiceState>,
    data: String,
    format: Option<String>,
) -> Result<String, String> {
    let frames = match format.as_deref() {
        Some("script") => {
            terminal_replay::parse_script_recording(&data).map_err(|e| e.to_string())?
        }
        _ => terminal_replay::parse_asciicast(&data).map_err(|e| e.to_string())?,
    };
    let mut svc = state.lock().await;
    svc.load_terminal(frames);
    let id = svc
        .player_ref()
        .map_err(|e| e.to_string())?
        .session
        .id
        .clone();
    log::info!("replay_load_terminal: loaded session {id}");
    Ok(id)
}

#[tauri::command]
pub async fn replay_load_video(
    state: tauri::State<'_, ReplayServiceState>,
    frames: Vec<VideoFrame>,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    svc.load_video(frames);
    let id = svc
        .player_ref()
        .map_err(|e| e.to_string())?
        .session
        .id
        .clone();
    log::info!("replay_load_video: loaded session {id}");
    Ok(id)
}

#[tauri::command]
pub async fn replay_load_har(
    state: tauri::State<'_, ReplayServiceState>,
    data: String,
) -> Result<String, String> {
    let entries = har_replay::parse_har(&data).map_err(|e| e.to_string())?;
    let mut svc = state.lock().await;
    svc.load_har(entries);
    let id = svc
        .player_ref()
        .map_err(|e| e.to_string())?
        .session
        .id
        .clone();
    log::info!("replay_load_har: loaded session {id}");
    Ok(id)
}

// ═══════════════════════════════════════════════════════════════════════
//  Transport controls
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn replay_play(state: tauri::State<'_, ReplayServiceState>) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.player_mut().map_err(|e| e.to_string())?.play();
    Ok(())
}

#[tauri::command]
pub async fn replay_pause(state: tauri::State<'_, ReplayServiceState>) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.player_mut().map_err(|e| e.to_string())?.pause();
    Ok(())
}

#[tauri::command]
pub async fn replay_stop(state: tauri::State<'_, ReplayServiceState>) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.player_mut().map_err(|e| e.to_string())?.stop();
    Ok(())
}

#[tauri::command]
pub async fn replay_seek(
    state: tauri::State<'_, ReplayServiceState>,
    target: SeekTarget,
) -> Result<u64, String> {
    let mut svc = state.lock().await;
    svc.player_mut()
        .map_err(|e| e.to_string())?
        .seek(target)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn replay_set_speed(
    state: tauri::State<'_, ReplayServiceState>,
    speed: f64,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.player_mut()
        .map_err(|e| e.to_string())?
        .set_speed(speed);
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════
//  State / position queries
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn replay_get_state(
    state: tauri::State<'_, ReplayServiceState>,
) -> Result<PlaybackState, String> {
    let svc = state.lock().await;
    Ok(svc.player_ref().map_err(|e| e.to_string())?.get_state())
}

#[tauri::command]
pub async fn replay_get_position(
    state: tauri::State<'_, ReplayServiceState>,
) -> Result<u64, String> {
    let svc = state.lock().await;
    Ok(svc
        .player_ref()
        .map_err(|e| e.to_string())?
        .get_current_position())
}

#[tauri::command]
pub async fn replay_get_frame_at(
    state: tauri::State<'_, ReplayServiceState>,
    position_ms: u64,
) -> Result<serde_json::Value, String> {
    let svc = state.lock().await;
    svc.player_ref()
        .map_err(|e| e.to_string())?
        .get_frame_at(position_ms)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn replay_get_terminal_state_at(
    state: tauri::State<'_, ReplayServiceState>,
    position_ms: u64,
) -> Result<String, String> {
    let svc = state.lock().await;
    let player = svc.player_ref().map_err(|e| e.to_string())?;
    match &player.frames {
        FrameData::Terminal(frames) => Ok(terminal_replay::render_terminal_at(frames, position_ms)),
        _ => Err("not a terminal recording".into()),
    }
}

#[tauri::command]
pub async fn replay_advance_frame(
    state: tauri::State<'_, ReplayServiceState>,
) -> Result<Option<u64>, String> {
    let mut svc = state.lock().await;
    let ts = svc.player_mut().map_err(|e| e.to_string())?.advance_frame();
    Ok(ts)
}

// ═══════════════════════════════════════════════════════════════════════
//  Timeline
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn replay_get_timeline(
    state: tauri::State<'_, ReplayServiceState>,
    segment_count: Option<usize>,
) -> Result<Vec<TimelineSegment>, String> {
    let svc = state.lock().await;
    let player = svc.player_ref().map_err(|e| e.to_string())?;
    let timestamps = player.timestamps();
    let count = segment_count.unwrap_or(100);
    Ok(timeline::generate_timeline(
        &timestamps,
        player.session.total_duration_ms,
        count,
    ))
}

#[tauri::command]
pub async fn replay_get_markers(
    state: tauri::State<'_, ReplayServiceState>,
) -> Result<Vec<TimelineMarker>, String> {
    let svc = state.lock().await;
    let player = svc.player_ref().map_err(|e| e.to_string())?;
    Ok(timeline::generate_markers(player))
}

#[tauri::command]
pub async fn replay_get_heatmap(
    state: tauri::State<'_, ReplayServiceState>,
    bucket_count: Option<usize>,
) -> Result<Vec<f64>, String> {
    let svc = state.lock().await;
    let player = svc.player_ref().map_err(|e| e.to_string())?;
    let timestamps = player.timestamps();
    let buckets = bucket_count.unwrap_or(50);
    Ok(timeline::get_activity_heatmap(&timestamps, buckets))
}

// ═══════════════════════════════════════════════════════════════════════
//  Search
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn replay_search(
    state: tauri::State<'_, ReplayServiceState>,
    query: String,
    case_sensitive: Option<bool>,
) -> Result<Vec<SearchResult>, String> {
    let svc = state.lock().await;
    let player = svc.player_ref().map_err(|e| e.to_string())?;
    let sensitive = case_sensitive.unwrap_or(false);

    let mut results = Vec::new();

    match &player.frames {
        FrameData::Terminal(frames) => {
            results.extend(search::search_terminal(frames, &query, sensitive));
        }
        FrameData::Har(entries) => {
            results.extend(search::search_har(entries, &query));
        }
        _ => {}
    }

    // Always search annotations too
    results.extend(search::search_annotations(
        &player.session.annotations,
        &query,
    ));

    results.sort_by_key(|r| r.position_ms);
    Ok(results)
}

// ═══════════════════════════════════════════════════════════════════════
//  Annotations
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn replay_add_annotation(
    state: tauri::State<'_, ReplayServiceState>,
    position_ms: u64,
    text: String,
    author: Option<String>,
    color: Option<String>,
    icon: Option<String>,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    let id = svc
        .annotation_mgr
        .add_annotation(position_ms, text, author, color, icon);
    svc.sync_annotations_to_player();
    Ok(id)
}

#[tauri::command]
pub async fn replay_remove_annotation(
    state: tauri::State<'_, ReplayServiceState>,
    id: String,
) -> Result<bool, String> {
    let mut svc = state.lock().await;
    let removed = svc.annotation_mgr.remove_annotation(&id);
    svc.sync_annotations_to_player();
    Ok(removed)
}

#[tauri::command]
pub async fn replay_list_annotations(
    state: tauri::State<'_, ReplayServiceState>,
) -> Result<Vec<Annotation>, String> {
    let svc = state.lock().await;
    Ok(svc.annotation_mgr.list_all().to_vec())
}

// ═══════════════════════════════════════════════════════════════════════
//  Bookmarks
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn replay_add_bookmark(
    state: tauri::State<'_, ReplayServiceState>,
    position_ms: u64,
    label: String,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    let id = svc.annotation_mgr.add_bookmark(position_ms, label);
    svc.sync_annotations_to_player();
    Ok(id)
}

#[tauri::command]
pub async fn replay_remove_bookmark(
    state: tauri::State<'_, ReplayServiceState>,
    id: String,
) -> Result<bool, String> {
    let mut svc = state.lock().await;
    let removed = svc.annotation_mgr.remove_bookmark(&id);
    svc.sync_annotations_to_player();
    Ok(removed)
}

#[tauri::command]
pub async fn replay_list_bookmarks(
    state: tauri::State<'_, ReplayServiceState>,
) -> Result<Vec<Bookmark>, String> {
    let svc = state.lock().await;
    Ok(svc.annotation_mgr.get_bookmarks().to_vec())
}

// ═══════════════════════════════════════════════════════════════════════
//  Export
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn replay_export(
    state: tauri::State<'_, ReplayServiceState>,
    options: ExportOptions,
) -> Result<Vec<u8>, String> {
    let svc = state.lock().await;
    let player = svc.player_ref().map_err(|e| e.to_string())?;
    export::export_session(player, options).map_err(|e| e.to_string())
}

// ═══════════════════════════════════════════════════════════════════════
//  Stats
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn replay_get_stats(
    state: tauri::State<'_, ReplayServiceState>,
) -> Result<PlaybackStats, String> {
    let svc = state.lock().await;
    Ok(svc.player_ref().map_err(|e| e.to_string())?.get_stats())
}

// ═══════════════════════════════════════════════════════════════════════
//  Config
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn replay_get_config(
    state: tauri::State<'_, ReplayServiceState>,
) -> Result<ReplayConfig, String> {
    let svc = state.lock().await;
    Ok(svc.config.clone())
}

#[tauri::command]
pub async fn replay_update_config(
    state: tauri::State<'_, ReplayServiceState>,
    config: ReplayConfig,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.config = config.clone();
    if let Some(ref mut p) = svc.player {
        p.config = config;
    }
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════
//  HAR-specific
// ═══════════════════════════════════════════════════════════════════════

#[tauri::command]
pub async fn replay_get_har_waterfall(
    state: tauri::State<'_, ReplayServiceState>,
) -> Result<Vec<WaterfallBar>, String> {
    let svc = state.lock().await;
    let player = svc.player_ref().map_err(|e| e.to_string())?;
    match &player.frames {
        FrameData::Har(entries) => Ok(har_replay::build_waterfall(entries)),
        _ => Err("not an HAR recording".into()),
    }
}

#[tauri::command]
pub async fn replay_get_har_stats(
    state: tauri::State<'_, ReplayServiceState>,
) -> Result<HarStats, String> {
    let svc = state.lock().await;
    let player = svc.player_ref().map_err(|e| e.to_string())?;
    match &player.frames {
        FrameData::Har(entries) => Ok(har_replay::get_stats(entries)),
        _ => Err("not an HAR recording".into()),
    }
}
