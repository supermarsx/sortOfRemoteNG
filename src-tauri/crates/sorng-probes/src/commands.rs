use crate::bulk::{
    cancel_run, check_all, CancelResult, CheckRequest, CompleteEvent, EmitProgress, ProgressEvent,
};
use crate::rdp::{rdp_probe as rdp_probe_inner, RdpProbeResult};
use crate::ssh::{ssh_probe as ssh_probe_inner, SshProbeResult};
use crate::tcp::{tcp_probe as tcp_probe_inner, ProbeResult};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

struct TauriEmitter {
    app: AppHandle,
}

impl EmitProgress for TauriEmitter {
    fn emit_progress(&self, evt: &ProgressEvent) {
        let _ = self.app.emit("connection-check-progress", evt);
    }
    fn emit_complete(&self, evt: &CompleteEvent) {
        let _ = self.app.emit("connection-check-complete", evt);
    }
}

#[tauri::command]
pub async fn tcp_probe(host: String, port: u16, timeout_ms: u64) -> ProbeResult {
    tcp_probe_inner(&host, port, timeout_ms).await
}

#[tauri::command]
pub async fn ssh_probe(host: String, port: u16, timeout_ms: u64) -> SshProbeResult {
    ssh_probe_inner(&host, port, timeout_ms).await
}

#[tauri::command]
pub async fn rdp_probe(host: String, port: u16, timeout_ms: u64) -> RdpProbeResult {
    rdp_probe_inner(&host, port, timeout_ms).await
}

#[tauri::command]
pub async fn check_all_connections(
    app: AppHandle,
    connection_ids: Vec<CheckRequest>,
    concurrency: Option<usize>,
    timeout_ms: Option<u64>,
) -> String {
    let emitter = Arc::new(TauriEmitter { app });
    tracing::info!(target = "audit", total = connection_ids.len(), "check_all_connections start");
    check_all(
        emitter,
        connection_ids,
        concurrency.unwrap_or(8),
        timeout_ms.unwrap_or(5000),
    )
    .await
}

#[tauri::command]
pub async fn cancel_check_run(run_id: String) -> CancelResult {
    cancel_run(&run_id)
}
