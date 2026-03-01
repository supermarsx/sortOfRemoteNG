//! Session management — enumerate, query, disconnect, logoff, connect.
//!
//! This module provides higher-level session management functions that
//! build on the raw WTS FFI layer. It adds filtering, sorting, and
//! aggregation capabilities.

use crate::types::*;
use crate::wts_ffi;
use log::info;
use windows::Win32::Foundation::HANDLE;

/// List all sessions on a server, optionally filtering by state.
pub fn list_sessions(
    server: HANDLE,
    state_filter: Option<SessionState>,
) -> TsResult<Vec<SessionEntry>> {
    let all = wts_ffi::enumerate_sessions(server)?;
    match state_filter {
        Some(filter) => Ok(all.into_iter().filter(|s| s.state == filter).collect()),
        None => Ok(all),
    }
}

/// List only sessions that have a logged-on user (i.e. Active or Disconnected).
pub fn list_user_sessions(server: HANDLE) -> TsResult<Vec<SessionEntry>> {
    let all = wts_ffi::enumerate_sessions(server)?;
    Ok(all
        .into_iter()
        .filter(|s| matches!(s.state, SessionState::Active | SessionState::Disconnected))
        .collect())
}

/// Get full detail for a specific session.
pub fn get_session_detail(server: HANDLE, session_id: u32) -> TsResult<SessionDetail> {
    wts_ffi::query_session_detail(server, session_id)
}

/// Get full detail for all sessions on the server.
pub fn get_all_session_details(server: HANDLE) -> TsResult<Vec<SessionDetail>> {
    let entries = wts_ffi::enumerate_sessions(server)?;
    let mut details = Vec::with_capacity(entries.len());
    for entry in &entries {
        match wts_ffi::query_session_detail(server, entry.session_id) {
            Ok(d) => details.push(d),
            Err(e) => {
                log::warn!("Failed to query session {}: {}", entry.session_id, e);
            }
        }
    }
    Ok(details)
}

/// Disconnect a session (the user stays logged on; session moves to Disconnected).
pub fn disconnect(server: HANDLE, session_id: u32, wait: bool) -> TsResult<()> {
    info!("Disconnecting session {}", session_id);
    wts_ffi::disconnect_session(server, session_id, wait)
}

/// Log off a session (terminates user processes, closes session).
pub fn logoff(server: HANDLE, session_id: u32, wait: bool) -> TsResult<()> {
    info!("Logging off session {}", session_id);
    wts_ffi::logoff_session(server, session_id, wait)
}

/// Connect (transfer) a disconnected session to another session.
pub fn connect(
    logon_id: u32,
    target_logon_id: u32,
    password: &str,
    wait: bool,
) -> TsResult<()> {
    info!("Connecting session {} to target {}", logon_id, target_logon_id);
    wts_ffi::connect_session(logon_id, target_logon_id, password, wait)
}

/// Log off all disconnected sessions on the server (housekeeping).
pub fn logoff_disconnected(server: HANDLE) -> TsResult<u32> {
    let sessions = wts_ffi::enumerate_sessions(server)?;
    let mut count = 0u32;
    for s in sessions {
        if s.state == SessionState::Disconnected {
            if wts_ffi::logoff_session(server, s.session_id, false).is_ok() {
                count += 1;
            }
        }
    }
    info!("Logged off {} disconnected sessions", count);
    Ok(count)
}

/// Find sessions by user name (case-insensitive partial match).
pub fn find_sessions_by_user(
    server: HANDLE,
    user_pattern: &str,
) -> TsResult<Vec<SessionDetail>> {
    let pattern = user_pattern.to_lowercase();
    let all = get_all_session_details(server)?;
    Ok(all
        .into_iter()
        .filter(|d| d.user_name.to_lowercase().contains(&pattern))
        .collect())
}

/// Get a summary of the server's session state.
pub fn server_summary(server: HANDLE) -> TsResult<TsServerSummary> {
    let sessions = wts_ffi::enumerate_sessions(server)?;
    let processes = wts_ffi::enumerate_processes(server).unwrap_or_default();

    let mut summary = TsServerSummary {
        server_name: String::from("(local)"),
        total_sessions: sessions.len(),
        active_sessions: 0,
        disconnected_sessions: 0,
        idle_sessions: 0,
        listen_sessions: 0,
        total_processes: processes.len(),
    };

    for s in &sessions {
        match s.state {
            SessionState::Active => summary.active_sessions += 1,
            SessionState::Disconnected => summary.disconnected_sessions += 1,
            SessionState::Idle => summary.idle_sessions += 1,
            SessionState::Listen => summary.listen_sessions += 1,
            _ => {}
        }
    }

    Ok(summary)
}

/// Get the session ID of the physical console.
pub fn get_console_session_id() -> u32 {
    wts_ffi::get_console_session_id()
}

/// Get the session ID of the current process.
pub fn get_current_session_id() -> u32 {
    wts_ffi::get_current_session_id()
}

/// Check whether a specific session is a remote RDP session.
pub fn is_remote_session(server: HANDLE, session_id: u32) -> TsResult<bool> {
    let detail = wts_ffi::query_session_detail(server, session_id)?;
    Ok(detail.is_remote_session)
}

/// Get idle time for a session in seconds. Returns None if not determinable.
pub fn get_idle_seconds(server: HANDLE, session_id: u32) -> TsResult<Option<i64>> {
    let detail = wts_ffi::query_session_detail(server, session_id)?;
    match (detail.last_input_time, detail.current_time) {
        (Some(last), Some(now)) => {
            let diff = now.signed_duration_since(last);
            Ok(Some(diff.num_seconds()))
        }
        _ => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn console_session_id_is_some() {
        // This should return a valid session ID on any Windows machine.
        let id = get_console_session_id();
        // 0 or 1 are typical for the console session.
        assert!(id <= 65535, "Console session ID should be reasonable: {}", id);
    }

    #[test]
    fn current_session_id_valid() {
        let id = get_current_session_id();
        assert!(id <= 65535, "Current session ID should be reasonable: {}", id);
    }
}
