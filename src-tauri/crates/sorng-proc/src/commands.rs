//! Tauri commands — async wrappers exposing all process management functionality.

use crate::service::ProcServiceState;
use crate::types::*;
use std::collections::HashMap;
use tauri::State;

type CmdResult<T> = Result<T, String>;

fn map_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// ─── Host CRUD ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn proc_add_host(state: State<'_, ProcServiceState>, host: ProcHost) -> CmdResult<()> {
    state.lock().await.add_host(host).map_err(map_err)
}

#[tauri::command]
pub async fn proc_remove_host(
    state: State<'_, ProcServiceState>,
    host_id: String,
) -> CmdResult<ProcHost> {
    state.lock().await.remove_host(&host_id).map_err(map_err)
}

#[tauri::command]
pub async fn proc_update_host(state: State<'_, ProcServiceState>, host: ProcHost) -> CmdResult<()> {
    state.lock().await.update_host(host).map_err(map_err)
}

#[tauri::command]
pub async fn proc_get_host(
    state: State<'_, ProcServiceState>,
    host_id: String,
) -> CmdResult<ProcHost> {
    state
        .lock()
        .await
        .get_host(&host_id)
        .cloned()
        .map_err(map_err)
}

#[tauri::command]
pub async fn proc_list_hosts(state: State<'_, ProcServiceState>) -> CmdResult<Vec<ProcHost>> {
    Ok(state
        .lock()
        .await
        .list_hosts()
        .into_iter()
        .cloned()
        .collect())
}

// ─── Helpers ────────────────────────────────────────────────────────

/// Lock state, clone host, release lock — avoids holding the mutex across awaits.
async fn resolve_host(state: &State<'_, ProcServiceState>, host_id: &str) -> CmdResult<ProcHost> {
    state
        .lock()
        .await
        .get_host(host_id)
        .cloned()
        .map_err(map_err)
}

// ─── Listing (list.rs) ─────────────────────────────────────────────

#[tauri::command]
pub async fn proc_list_processes(
    state: State<'_, ProcServiceState>,
    host_id: String,
) -> CmdResult<Vec<ProcessInfo>> {
    let host = resolve_host(&state, &host_id).await?;
    crate::list::list_processes(&host).await.map_err(map_err)
}

#[tauri::command]
pub async fn proc_get_process(
    state: State<'_, ProcServiceState>,
    host_id: String,
    pid: u32,
) -> CmdResult<ProcessInfo> {
    let host = resolve_host(&state, &host_id).await?;
    crate::list::get_process(&host, pid).await.map_err(map_err)
}

#[tauri::command]
pub async fn proc_get_process_tree(
    state: State<'_, ProcServiceState>,
    host_id: String,
) -> CmdResult<Vec<ProcessTree>> {
    let host = resolve_host(&state, &host_id).await?;
    crate::list::get_process_tree(&host).await.map_err(map_err)
}

#[tauri::command]
pub async fn proc_get_process_children(
    state: State<'_, ProcServiceState>,
    host_id: String,
    pid: u32,
) -> CmdResult<Vec<ProcessInfo>> {
    let host = resolve_host(&state, &host_id).await?;
    crate::list::get_process_children(&host, pid)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn proc_search_processes(
    state: State<'_, ProcServiceState>,
    host_id: String,
    pattern: String,
) -> CmdResult<Vec<ProcessInfo>> {
    let host = resolve_host(&state, &host_id).await?;
    crate::list::search_processes(&host, &pattern)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn proc_top_processes(
    state: State<'_, ProcServiceState>,
    host_id: String,
    sort_by: String,
    count: usize,
) -> CmdResult<Vec<TopProcess>> {
    let host = resolve_host(&state, &host_id).await?;
    crate::list::top_processes(&host, &sort_by, count)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn proc_count_processes(
    state: State<'_, ProcServiceState>,
    host_id: String,
) -> CmdResult<HashMap<String, usize>> {
    let host = resolve_host(&state, &host_id).await?;
    let counts = crate::list::count_processes(&host).await.map_err(map_err)?;
    Ok(counts
        .into_iter()
        .map(|(state, n)| (format!("{state:?}").to_lowercase(), n))
        .collect())
}

// ─── Signals (signals.rs) ───────────────────────────────────────────

#[tauri::command]
pub async fn proc_kill_process(
    state: State<'_, ProcServiceState>,
    host_id: String,
    pid: u32,
    signal: Signal,
) -> CmdResult<()> {
    let host = resolve_host(&state, &host_id).await?;
    crate::signals::kill_process(&host, pid, signal)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn proc_kill_processes(
    state: State<'_, ProcServiceState>,
    host_id: String,
    pids: Vec<u32>,
    signal: Signal,
) -> CmdResult<()> {
    let host = resolve_host(&state, &host_id).await?;
    crate::signals::kill_processes(&host, &pids, signal)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn proc_killall(
    state: State<'_, ProcServiceState>,
    host_id: String,
    name: String,
    signal: Signal,
) -> CmdResult<()> {
    let host = resolve_host(&state, &host_id).await?;
    crate::signals::killall(&host, &name, signal)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn proc_renice(
    state: State<'_, ProcServiceState>,
    host_id: String,
    pid: u32,
    niceness: i32,
) -> CmdResult<()> {
    let host = resolve_host(&state, &host_id).await?;
    crate::signals::renice(&host, pid, niceness)
        .await
        .map_err(map_err)
}

// ─── Open Files (files.rs) ──────────────────────────────────────────

#[tauri::command]
pub async fn proc_list_open_files(
    state: State<'_, ProcServiceState>,
    host_id: String,
    pid: u32,
) -> CmdResult<Vec<OpenFile>> {
    let host = resolve_host(&state, &host_id).await?;
    crate::files::list_open_files(&host, pid)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn proc_list_sockets(
    state: State<'_, ProcServiceState>,
    host_id: String,
) -> CmdResult<Vec<SocketInfo>> {
    let host = resolve_host(&state, &host_id).await?;
    crate::files::list_sockets(&host).await.map_err(map_err)
}

#[tauri::command]
pub async fn proc_list_process_sockets(
    state: State<'_, ProcServiceState>,
    host_id: String,
    pid: u32,
) -> CmdResult<Vec<SocketInfo>> {
    let host = resolve_host(&state, &host_id).await?;
    crate::files::list_process_sockets(&host, pid)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn proc_list_listening_ports(
    state: State<'_, ProcServiceState>,
    host_id: String,
) -> CmdResult<Vec<SocketInfo>> {
    let host = resolve_host(&state, &host_id).await?;
    crate::files::list_listening_ports(&host)
        .await
        .map_err(map_err)
}

// ─── Proc Filesystem (proc_fs.rs) ───────────────────────────────────

#[tauri::command]
pub async fn proc_get_status(
    state: State<'_, ProcServiceState>,
    host_id: String,
    pid: u32,
) -> CmdResult<HashMap<String, String>> {
    let host = resolve_host(&state, &host_id).await?;
    crate::proc_fs::get_proc_status(&host, pid)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn proc_get_cmdline(
    state: State<'_, ProcServiceState>,
    host_id: String,
    pid: u32,
) -> CmdResult<String> {
    let host = resolve_host(&state, &host_id).await?;
    crate::proc_fs::get_proc_cmdline(&host, pid)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn proc_get_environ(
    state: State<'_, ProcServiceState>,
    host_id: String,
    pid: u32,
) -> CmdResult<ProcessEnvironment> {
    let host = resolve_host(&state, &host_id).await?;
    crate::proc_fs::get_proc_environ(&host, pid)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn proc_get_limits(
    state: State<'_, ProcServiceState>,
    host_id: String,
    pid: u32,
) -> CmdResult<ProcessLimits> {
    let host = resolve_host(&state, &host_id).await?;
    crate::proc_fs::get_proc_limits(&host, pid)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn proc_get_maps(
    state: State<'_, ProcServiceState>,
    host_id: String,
    pid: u32,
) -> CmdResult<Vec<MemoryMap>> {
    let host = resolve_host(&state, &host_id).await?;
    crate::proc_fs::get_proc_maps(&host, pid)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn proc_get_io(
    state: State<'_, ProcServiceState>,
    host_id: String,
    pid: u32,
) -> CmdResult<ProcessIo> {
    let host = resolve_host(&state, &host_id).await?;
    crate::proc_fs::get_proc_io(&host, pid)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn proc_get_namespaces(
    state: State<'_, ProcServiceState>,
    host_id: String,
    pid: u32,
) -> CmdResult<ProcessNamespace> {
    let host = resolve_host(&state, &host_id).await?;
    crate::proc_fs::get_proc_namespaces(&host, pid)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn proc_get_cgroup(
    state: State<'_, ProcServiceState>,
    host_id: String,
    pid: u32,
) -> CmdResult<CgroupInfo> {
    let host = resolve_host(&state, &host_id).await?;
    crate::proc_fs::get_proc_cgroup(&host, pid)
        .await
        .map_err(map_err)
}

// ─── System (system.rs) ─────────────────────────────────────────────

#[tauri::command]
pub async fn proc_get_load_average(
    state: State<'_, ProcServiceState>,
    host_id: String,
) -> CmdResult<SystemLoad> {
    let host = resolve_host(&state, &host_id).await?;
    crate::system::get_load_average(&host)
        .await
        .map_err(map_err)
}

#[tauri::command]
pub async fn proc_get_uptime(
    state: State<'_, ProcServiceState>,
    host_id: String,
) -> CmdResult<UptimeInfo> {
    let host = resolve_host(&state, &host_id).await?;
    crate::system::get_uptime(&host).await.map_err(map_err)
}

#[tauri::command]
pub async fn proc_get_meminfo(
    state: State<'_, ProcServiceState>,
    host_id: String,
) -> CmdResult<HashMap<String, String>> {
    let host = resolve_host(&state, &host_id).await?;
    crate::system::get_meminfo(&host).await.map_err(map_err)
}

#[tauri::command]
pub async fn proc_get_cpu_stats(
    state: State<'_, ProcServiceState>,
    host_id: String,
) -> CmdResult<HashMap<String, String>> {
    let host = resolve_host(&state, &host_id).await?;
    crate::system::get_cpu_stats(&host).await.map_err(map_err)
}
