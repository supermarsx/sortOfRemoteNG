//! Process management — enumerate, filter, terminate processes across sessions.

use crate::types::*;
use crate::wts_ffi;
use log::info;
use windows::Win32::Foundation::HANDLE;

/// List all processes on the server.
pub fn list_processes(server: HANDLE) -> TsResult<Vec<TsProcessInfo>> {
    wts_ffi::enumerate_processes(server)
}

/// List processes for a specific session.
pub fn list_session_processes(
    server: HANDLE,
    session_id: u32,
) -> TsResult<Vec<TsProcessInfo>> {
    let all = wts_ffi::enumerate_processes(server)?;
    Ok(all
        .into_iter()
        .filter(|p| p.session_id == session_id)
        .collect())
}

/// Search processes by name (case-insensitive partial match).
pub fn find_processes_by_name(
    server: HANDLE,
    name_pattern: &str,
) -> TsResult<Vec<TsProcessInfo>> {
    let pattern = name_pattern.to_lowercase();
    let all = wts_ffi::enumerate_processes(server)?;
    Ok(all
        .into_iter()
        .filter(|p| p.process_name.to_lowercase().contains(&pattern))
        .collect())
}

/// Terminate a specific process by PID.
pub fn terminate(server: HANDLE, process_id: u32, exit_code: u32) -> TsResult<()> {
    info!("Terminating process {} with exit code {}", process_id, exit_code);
    wts_ffi::terminate_process(server, process_id, exit_code)
}

/// Terminate all processes matching a name pattern in a specific session.
pub fn terminate_by_name(
    server: HANDLE,
    session_id: u32,
    name_pattern: &str,
    exit_code: u32,
) -> TsResult<u32> {
    let pattern = name_pattern.to_lowercase();
    let procs = wts_ffi::enumerate_processes(server)?;
    let mut killed = 0u32;
    for p in procs {
        if p.session_id == session_id
            && p.process_name.to_lowercase().contains(&pattern)
        {
            if wts_ffi::terminate_process(server, p.process_id, exit_code).is_ok() {
                killed += 1;
            }
        }
    }
    info!(
        "Terminated {} processes matching '{}' in session {}",
        killed, name_pattern, session_id
    );
    Ok(killed)
}

/// Get a count of processes per session.
pub fn process_count_per_session(
    server: HANDLE,
) -> TsResult<Vec<(u32, usize)>> {
    let all = wts_ffi::enumerate_processes(server)?;
    let mut map = std::collections::HashMap::<u32, usize>::new();
    for p in &all {
        *map.entry(p.session_id).or_insert(0) += 1;
    }
    let mut vec: Vec<(u32, usize)> = map.into_iter().collect();
    vec.sort_by_key(|&(sid, _)| sid);
    Ok(vec)
}

/// Find the top N processes by name frequency across all sessions.
pub fn top_process_names(server: HANDLE, n: usize) -> TsResult<Vec<(String, usize)>> {
    let all = wts_ffi::enumerate_processes(server)?;
    let mut map = std::collections::HashMap::<String, usize>::new();
    for p in &all {
        let name = p.process_name.to_lowercase();
        *map.entry(name).or_insert(0) += 1;
    }
    let mut vec: Vec<(String, usize)> = map.into_iter().collect();
    vec.sort_by(|a, b| b.1.cmp(&a.1));
    vec.truncate(n);
    Ok(vec)
}

#[cfg(test)]
mod tests {
    // Process tests require an actual RD Session Host server.
    // Integration tests would go here if we had a test environment.
}
