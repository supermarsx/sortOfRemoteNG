use crate::rdp::{rdp_probe, RdpProbeResult};
use crate::ssh::{ssh_probe, SshProbeResult};
use crate::tcp::{tcp_probe, ProbeResult};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use tokio::sync::Semaphore;
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheckRequest {
    pub connection_id: String,
    pub host: String,
    pub port: u16,
    pub protocol: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PerResult {
    Tcp(ProbeResult),
    Ssh(SshProbeResult),
    Rdp(RdpProbeResult),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProgressEvent {
    pub run_id: String,
    pub connection_id: String,
    pub index: usize,
    pub total: usize,
    pub result: PerResult,
    pub elapsed_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompleteEvent {
    pub run_id: String,
    pub total: usize,
    pub completed: usize,
    pub cancelled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CancelResult {
    pub run_id: String,
    pub cancelled: bool,
}

pub trait EmitProgress: Send + Sync + 'static {
    fn emit_progress(&self, evt: &ProgressEvent);
    fn emit_complete(&self, evt: &CompleteEvent);
}

fn registry() -> &'static Mutex<HashMap<String, CancellationToken>> {
    static REG: OnceLock<Mutex<HashMap<String, CancellationToken>>> = OnceLock::new();
    REG.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn cancel_run(run_id: &str) -> CancelResult {
    let reg = registry().lock().unwrap();
    if let Some(tok) = reg.get(run_id) {
        tok.cancel();
        CancelResult {
            run_id: run_id.to_string(),
            cancelled: true,
        }
    } else {
        CancelResult {
            run_id: run_id.to_string(),
            cancelled: false,
        }
    }
}

pub async fn check_all<E: EmitProgress>(
    emitter: Arc<E>,
    requests: Vec<CheckRequest>,
    concurrency: usize,
    timeout_ms: u64,
) -> String {
    let run_id = uuid::Uuid::new_v4().to_string();
    let cap = if concurrency == 0 { 8 } else { concurrency };
    let sem = Arc::new(Semaphore::new(cap));
    let total = requests.len();
    let token = CancellationToken::new();
    {
        let mut reg = registry().lock().unwrap();
        reg.insert(run_id.clone(), token.clone());
    }

    let mut handles = Vec::with_capacity(total);
    for (index, req) in requests.into_iter().enumerate() {
        let sem = sem.clone();
        let token = token.clone();
        let emitter = emitter.clone();
        let run_id_c = run_id.clone();
        let handle = tokio::spawn(async move {
            if token.is_cancelled() {
                return false;
            }
            let _permit = match sem.acquire_owned().await {
                Ok(p) => p,
                Err(_) => return false,
            };
            if token.is_cancelled() {
                return false;
            }
            let start = std::time::Instant::now();
            let result = tokio::select! {
                _ = token.cancelled() => return false,
                r = probe_one(&req, timeout_ms) => r,
            };
            let evt = ProgressEvent {
                run_id: run_id_c,
                connection_id: req.connection_id.clone(),
                index,
                total,
                result,
                elapsed_ms: start.elapsed().as_millis() as u64,
            };
            emitter.emit_progress(&evt);
            true
        });
        handles.push(handle);
    }

    let mut completed = 0usize;
    for h in handles {
        if let Ok(true) = h.await {
            completed += 1;
        }
    }
    let cancelled = token.is_cancelled();
    {
        let mut reg = registry().lock().unwrap();
        reg.remove(&run_id);
    }
    emitter.emit_complete(&CompleteEvent {
        run_id: run_id.clone(),
        total,
        completed,
        cancelled,
    });
    run_id
}

async fn probe_one(req: &CheckRequest, timeout_ms: u64) -> PerResult {
    match req.protocol.as_str() {
        "ssh" | "sftp" => PerResult::Ssh(ssh_probe(&req.host, req.port, timeout_ms).await),
        "rdp" => PerResult::Rdp(rdp_probe(&req.host, req.port, timeout_ms).await),
        _ => PerResult::Tcp(tcp_probe(&req.host, req.port, timeout_ms).await),
    }
}
