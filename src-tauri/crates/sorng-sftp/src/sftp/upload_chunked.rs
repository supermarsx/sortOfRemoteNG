// ── Chunked-bytes upload (browser File drag-and-drop path) ───────────────────
//
// Tauri exposes `sftp_upload_begin / _chunk / _finish / _abort` so the frontend
// can stream a `File` object (which has no local fs path) as 8 MiB chunks
// without materialising the whole buffer in Rust memory.
//
// Threading contract (t2 plan §3):
//   • ssh2 is blocking; every actual write runs inside `tokio::task::spawn_blocking`.
//   • One writer task per upload. Writer receives `UploadChunkMsg` via a
//     bounded `tokio::sync::mpsc` channel — this serialises writes and
//     provides backpressure so the frontend can't out-run the ssh2 socket.
//   • The writer owns its `ssh2::File` locally. ssh2 0.9.x's `File` / `Sftp`
//     are `'static + Send + Sync` (internal `Arc<Mutex<SessionInner>>`), so
//     we just clone `Session` into the task at begin time.
//   • `SftpService::uploads` holds only metadata + the mpsc sender — no
//     ssh2 handles. This keeps the service mutex cheap.
//   • A single sweeper task (spawned lazily on the first `upload_begin` per
//     service) aborts uploads with >5 min of inactivity.

use crate::sftp::service::SftpService;
use log::{info, warn};
use std::collections::HashMap;
use std::io::{Seek, SeekFrom, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant};
use tokio::sync::{mpsc, oneshot};
use uuid::Uuid;

// ── Configuration ────────────────────────────────────────────────────────────

/// Idle timeout after which a chunk-upload is auto-aborted.
pub(crate) const UPLOAD_IDLE_TIMEOUT: Duration = Duration::from_secs(300); // 5 min

/// How often the sweeper checks for idle uploads.
pub(crate) const UPLOAD_SWEEP_INTERVAL: Duration = Duration::from_secs(30);

/// Backpressure depth for the chunk channel. Small so the frontend can't
/// balloon memory with pending chunks.
const CHUNK_CHANNEL_DEPTH: usize = 4;
const MAX_ACTIVE_UPLOADS: usize = 16;
const MAX_CHUNK_BYTES: usize = 8 * 1024 * 1024;
const MAX_DECLARED_UPLOAD_BYTES: u64 = 1024 * 1024 * 1024 * 1024;
const CHUNK_ACK_TIMEOUT: Duration = Duration::from_secs(120);

// ── Messages to the writer task ──────────────────────────────────────────────

pub(crate) enum UploadChunkMsg {
    Write {
        offset: u64,
        bytes: Vec<u8>,
        ack: oneshot::Sender<Result<u64, String>>,
    },
    Finish {
        ack: oneshot::Sender<Result<String, String>>,
    },
    Abort {
        ack: oneshot::Sender<Result<(), String>>,
    },
}

// ── Upload handle stored in SftpService ──────────────────────────────────────

// NOTE on sweeper / service-mutex asymmetry: when the idle-timeout sweeper
// fires it sets `terminated=true` and removes the entry from
// `UPLOAD_SWEEPER_REGISTRY`, but it cannot also remove from
// `SftpService::uploads` because the sweeper has no access to the service
// mutex. The orphaned `UploadHandle` entry is drained on the next
// `upload_chunk/finish/abort` call for that id (which will see `terminated`
// and early-out). Bounded by in-flight upload count per service; fine for v1.
pub(crate) struct UploadHandle {
    #[allow(dead_code)] // retained for debug/logging contexts
    pub(crate) remote_path: String,
    pub(crate) session_id: String,
    #[allow(dead_code)]
    pub(crate) total_bytes: u64,
    pub(crate) bytes_written: Arc<AtomicU64>,
    pub(crate) next_offset: u64,
    pub(crate) last_activity: Arc<StdMutex<Instant>>,
    pub(crate) chunk_tx: mpsc::Sender<UploadChunkMsg>,
    /// Prevents double-finish / double-abort.
    pub(crate) terminated: Arc<AtomicBool>,
    /// True only after the writer confirms that a partial remote file was removed.
    pub(crate) cleanup_confirmed: Arc<AtomicBool>,
}

impl UploadHandle {
    fn touch(&self) {
        if let Ok(mut t) = self.last_activity.lock() {
            *t = Instant::now();
        }
    }
}

// ── Public service API ───────────────────────────────────────────────────────

impl SftpService {
    /// Open a remote file and spawn a dedicated writer task; return the upload id.
    pub async fn upload_begin(
        &mut self,
        session_id: &str,
        remote_path: &str,
        total_bytes: u64,
        overwrite: bool,
    ) -> Result<String, String> {
        if self.uploads.len() >= MAX_ACTIVE_UPLOADS {
            return Err("Too many active SFTP uploads".to_string());
        }
        if total_bytes > MAX_DECLARED_UPLOAD_BYTES {
            return Err("Declared upload size exceeds the supported limit".to_string());
        }
        super::transfer::validate_remote_file_path(remote_path)?;
        // Clone the Session so the writer task owns its own handle.
        // ssh2::Session is Clone (internal Arc<Mutex<SessionInner>>); the clone
        // shares the underlying connection.
        let session_clone = {
            let handle = self
                .sessions
                .get(session_id)
                .ok_or_else(|| format!("Session '{}' not found", session_id))?;
            handle.session.clone()
        };

        let upload_id = Uuid::new_v4().to_string();
        let remote_path_owned = remote_path.to_string();
        let session_id_owned = session_id.to_string();

        // Open the remote file eagerly so begin fails fast on permission / path errors.
        let open_flags = if overwrite {
            ssh2::OpenFlags::WRITE | ssh2::OpenFlags::CREATE | ssh2::OpenFlags::TRUNCATE
        } else {
            ssh2::OpenFlags::WRITE | ssh2::OpenFlags::CREATE | ssh2::OpenFlags::EXCLUSIVE
        };

        // Do the open inside spawn_blocking — ssh2 calls are blocking.
        let open_result = {
            let session = session_clone.clone();
            let rp = remote_path_owned.clone();
            tokio::task::spawn_blocking(move || {
                let sftp = session
                    .sftp()
                    .map_err(|e| format!("SFTP channel error: {}", e))?;
                let file = sftp
                    .open_mode(Path::new(&rp), open_flags, 0o644, ssh2::OpenType::File)
                    .map_err(|e| format!("Failed to open remote '{}': {}", rp, e))?;
                Ok::<(ssh2::Sftp, ssh2::File), String>((sftp, file))
            })
            .await
            .map_err(|e| format!("spawn_blocking join error: {}", e))??
        };

        let (sftp, file) = open_result;

        // Writer mpsc + state shared with the handle.
        let (chunk_tx, chunk_rx) = mpsc::channel::<UploadChunkMsg>(CHUNK_CHANNEL_DEPTH);
        let bytes_written = Arc::new(AtomicU64::new(0));
        let last_activity = Arc::new(StdMutex::new(Instant::now()));
        let terminated = Arc::new(AtomicBool::new(false));
        let cleanup_confirmed = Arc::new(AtomicBool::new(false));

        // Spawn the writer task. All ssh2 I/O inside `spawn_blocking`.
        {
            let bytes_written = bytes_written.clone();
            let terminated = terminated.clone();
            let cleanup_confirmed = cleanup_confirmed.clone();
            let remote_path_writer = remote_path_owned.clone();
            tokio::task::spawn_blocking(move || {
                writer_loop(
                    sftp,
                    file,
                    chunk_rx,
                    bytes_written,
                    terminated,
                    cleanup_confirmed,
                    remote_path_writer,
                );
            });
        }

        let handle = UploadHandle {
            remote_path: remote_path_owned,
            session_id: session_id_owned,
            total_bytes,
            bytes_written,
            next_offset: 0,
            last_activity,
            chunk_tx,
            terminated,
            cleanup_confirmed,
        };

        register_for_sweeper(&upload_id, &handle);
        self.uploads.insert(upload_id.clone(), handle);

        // Spawn sweeper if not already running.
        self.ensure_upload_sweeper();

        info!(
            "sftp_upload_begin id={} remote={} total={} overwrite={}",
            upload_id, remote_path, total_bytes, overwrite
        );
        Ok(upload_id)
    }

    /// Append a chunk at the given offset. Returns bytes written by *this* call.
    pub async fn upload_chunk(
        &mut self,
        upload_id: &str,
        offset: u64,
        bytes: Vec<u8>,
    ) -> Result<u64, String> {
        if bytes.is_empty() || bytes.len() > MAX_CHUNK_BYTES {
            return Err("Upload chunk size is outside supported bounds".to_string());
        }
        let handle = self
            .uploads
            .get_mut(upload_id)
            .ok_or_else(|| format!("Upload '{}' not found (expired or aborted?)", upload_id))?;

        if handle.terminated.load(Ordering::SeqCst) {
            // Entry was sweeped or finished — drain the stale handle.
            self.uploads.remove(upload_id);
            unregister_from_sweeper(upload_id);
            return Err(format!("Upload '{}' already finished/aborted", upload_id));
        }
        if offset != handle.next_offset {
            return Err(format!(
                "Upload chunk offset {} does not match expected offset {}",
                offset, handle.next_offset
            ));
        }
        let end = offset
            .checked_add(bytes.len() as u64)
            .ok_or_else(|| "Upload offset overflow".to_string())?;
        if end > handle.total_bytes {
            return Err("Upload chunk exceeds the declared upload size".to_string());
        }

        handle.touch();
        let tx = handle.chunk_tx.clone();

        let (ack_tx, ack_rx) = oneshot::channel();
        tokio::time::timeout(
            CHUNK_ACK_TIMEOUT,
            tx.send(UploadChunkMsg::Write {
                offset,
                bytes,
                ack: ack_tx,
            }),
        )
        .await
        .map_err(|_| "Timed out waiting to queue upload chunk".to_string())?
        .map_err(|_| "Writer task closed unexpectedly".to_string())?;

        let written = tokio::time::timeout(CHUNK_ACK_TIMEOUT, ack_rx)
            .await
            .map_err(|_| "Timed out waiting for upload chunk acknowledgement".to_string())?
            .map_err(|_| "Writer task dropped without responding".to_string())??;
        if written != end - offset {
            return Err("Writer acknowledged an unexpected byte count".to_string());
        }
        handle.next_offset = end;
        Ok(written)
    }

    /// Flush, close the remote file, return the final remote path. Removes the handle.
    pub async fn upload_finish(&mut self, upload_id: &str) -> Result<String, String> {
        let handle = self
            .uploads
            .remove(upload_id)
            .ok_or_else(|| format!("Upload '{}' not found", upload_id))?;

        if handle.terminated.load(Ordering::SeqCst) {
            return Err(format!("Upload '{}' already finished/aborted", upload_id));
        }
        if handle.next_offset != handle.total_bytes {
            let _ = self.uploads.insert(upload_id.to_string(), handle);
            return Err(
                "Cannot finish upload before all declared bytes are acknowledged".to_string(),
            );
        }
        if handle.terminated.swap(true, Ordering::SeqCst) {
            return Err(format!("Upload '{}' already finished/aborted", upload_id));
        }

        let (ack_tx, ack_rx) = oneshot::channel();
        tokio::time::timeout(
            CHUNK_ACK_TIMEOUT,
            handle.chunk_tx.send(UploadChunkMsg::Finish { ack: ack_tx }),
        )
        .await
        .map_err(|_| "Timed out queueing upload finish".to_string())?
        .map_err(|_| "Writer task closed unexpectedly".to_string())?;

        let final_path = tokio::time::timeout(CHUNK_ACK_TIMEOUT, ack_rx)
            .await
            .map_err(|_| "Timed out waiting for upload finish acknowledgement".to_string())?
            .map_err(|_| "Writer task dropped without responding".to_string())??;

        unregister_from_sweeper(upload_id);

        // Update session upload stats.
        if let Some(session_handle) = self.sessions.get_mut(&handle.session_id) {
            session_handle.info.bytes_uploaded += handle.bytes_written.load(Ordering::SeqCst);
        }

        info!(
            "sftp_upload_finish id={} remote={} bytes={}",
            upload_id,
            final_path,
            handle.bytes_written.load(Ordering::SeqCst)
        );
        Ok(final_path)
    }

    /// Abort the upload. Writer deletes the partial remote file. Removes the handle.
    pub async fn upload_abort(&mut self, upload_id: &str) -> Result<(), String> {
        let handle = self
            .uploads
            .remove(upload_id)
            .ok_or_else(|| format!("Upload '{}' not found", upload_id))?;

        if handle.terminated.swap(true, Ordering::SeqCst) {
            // Already terminated — nothing to do.
            unregister_from_sweeper(upload_id);
            return if handle.cleanup_confirmed.load(Ordering::SeqCst) {
                Ok(())
            } else {
                Err(
                    "Upload is already terminating, but remote partial-file cleanup is unconfirmed"
                        .to_string(),
                )
            };
        }

        let (ack_tx, ack_rx) = oneshot::channel();
        // If the writer already exited (e.g. after a previous error) the
        // channel is closed; treat that as best-effort success.
        if tokio::time::timeout(
            CHUNK_ACK_TIMEOUT,
            handle.chunk_tx.send(UploadChunkMsg::Abort { ack: ack_tx }),
        )
        .await
        .map_err(|_| "Timed out queueing upload abort".to_string())?
        .is_err()
        {
            warn!("upload_abort id={} writer already gone", upload_id);
            unregister_from_sweeper(upload_id);
            return if handle.cleanup_confirmed.load(Ordering::SeqCst) {
                Ok(())
            } else {
                Err(
                    "Upload writer stopped before remote partial-file cleanup was confirmed"
                        .to_string(),
                )
            };
        }

        let result = tokio::time::timeout(CHUNK_ACK_TIMEOUT, ack_rx)
            .await
            .map_err(|_| "Timed out waiting for upload abort acknowledgement".to_string())?
            .map_err(|_| "Writer task dropped without responding".to_string())?;

        unregister_from_sweeper(upload_id);
        info!("sftp_upload_abort id={}", upload_id);
        result
    }

    // ── Internal: sweeper for idle uploads ───────────────────────────────────

    fn ensure_upload_sweeper(&mut self) {
        if self.upload_sweeper_started {
            return;
        }
        self.upload_sweeper_started = true;

        // Weak-ref the service via a captured `UploadSweeperHandle` pattern is
        // overkill here: the sweeper just needs a way to call `upload_abort`
        // on idle entries. We achieve that through a dedicated mpsc channel
        // that the sweeper uses to signal "please abort these ids", processed
        // by the Tauri runtime with the normal service mutex. Spawned once
        // per service — it lives for the life of the process.
        //
        // We're inside `SftpService` but the spawned task needs the service
        // state. Since `SftpServiceState = Arc<tokio::sync::Mutex<SftpService>>`
        // is held by the Tauri managed-state layer, we can't get at it from
        // here. Instead, the sweeper snapshots the `last_activity` timestamps
        // via a weak view: we expose a shared `Arc<StdMutex<HashMap<...>>>`
        // of last_activity pointers. Simpler path: each UploadHandle
        // already owns an `Arc<StdMutex<Instant>>`; we also stash an
        // `Arc<AtomicBool>` (terminated) and an `mpsc::Sender<UploadChunkMsg>`
        // — those are exactly what the sweeper needs to send `Abort`.
        //
        // So we clone (sender, last_activity, terminated) into a parallel
        // `UPLOAD_SWEEPER_REGISTRY` global that the sweeper walks.

        tokio::spawn(async move {
            let mut ticker = tokio::time::interval(UPLOAD_SWEEP_INTERVAL);
            ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            loop {
                ticker.tick().await;
                let now = Instant::now();
                let candidates: Vec<_> = {
                    let Ok(reg) = UPLOAD_SWEEPER_REGISTRY.lock() else {
                        continue;
                    };
                    reg.iter()
                        .filter_map(|(id, entry)| {
                            if entry.terminated.load(Ordering::SeqCst) {
                                Some((id.clone(), entry.clone(), /* stale */ true))
                            } else {
                                let idle = entry
                                    .last_activity
                                    .lock()
                                    .ok()
                                    .map(|t| now.saturating_duration_since(*t))
                                    .unwrap_or_default();
                                if idle >= UPLOAD_IDLE_TIMEOUT {
                                    Some((id.clone(), entry.clone(), false))
                                } else {
                                    None
                                }
                            }
                        })
                        .collect()
                };

                for (id, entry, already_dead) in candidates {
                    if already_dead {
                        // Entry's writer has exited; just drop from registry.
                        if let Ok(mut reg) = UPLOAD_SWEEPER_REGISTRY.lock() {
                            reg.remove(&id);
                        }
                        continue;
                    }
                    warn!("sftp upload id={} idle >5min — auto-aborting", id);
                    if entry.terminated.load(Ordering::SeqCst) {
                        continue;
                    }
                    let (ack_tx, ack_rx) = oneshot::channel();
                    let queued = tokio::time::timeout(
                        CHUNK_ACK_TIMEOUT,
                        entry.chunk_tx.send(UploadChunkMsg::Abort { ack: ack_tx }),
                    )
                    .await;
                    match queued {
                        Ok(Ok(())) => match tokio::time::timeout(CHUNK_ACK_TIMEOUT, ack_rx).await {
                            Ok(Ok(Ok(()))) => {
                                entry.cleanup_confirmed.store(true, Ordering::SeqCst);
                                entry.terminated.store(true, Ordering::SeqCst);
                            }
                            Ok(Ok(Err(error))) => {
                                warn!("sftp upload id={} idle abort cleanup failed: {}", id, error);
                                entry.terminated.store(true, Ordering::SeqCst);
                            }
                            Ok(Err(_)) => {
                                warn!(
                                    "sftp upload id={} idle abort acknowledgement was dropped",
                                    id
                                );
                            }
                            Err(_) => {
                                warn!("sftp upload id={} idle abort acknowledgement timed out", id);
                            }
                        },
                        Ok(Err(_)) => {
                            warn!("sftp upload id={} idle abort writer is unavailable", id);
                        }
                        Err(_) => {
                            warn!("sftp upload id={} idle abort queueing timed out", id);
                        }
                    }
                    if entry.terminated.load(Ordering::SeqCst) {
                        if let Ok(mut reg) = UPLOAD_SWEEPER_REGISTRY.lock() {
                            reg.remove(&id);
                        }
                    }
                }
            }
        });
    }
}

// ── Sweeper registry ─────────────────────────────────────────────────────────
//
// Parallel view of "live uploads" for the sweeper. Registered from
// `upload_begin` (below) and cleaned in the sweeper / on finish+abort.

#[derive(Clone)]
pub(crate) struct SweeperEntry {
    pub(crate) chunk_tx: mpsc::Sender<UploadChunkMsg>,
    pub(crate) last_activity: Arc<StdMutex<Instant>>,
    pub(crate) terminated: Arc<AtomicBool>,
    pub(crate) cleanup_confirmed: Arc<AtomicBool>,
}

lazy_static::lazy_static! {
    pub(crate) static ref UPLOAD_SWEEPER_REGISTRY: StdMutex<HashMap<String, SweeperEntry>> =
        StdMutex::new(HashMap::new());
}

pub(crate) fn register_for_sweeper(upload_id: &str, handle: &UploadHandle) {
    if let Ok(mut reg) = UPLOAD_SWEEPER_REGISTRY.lock() {
        reg.insert(
            upload_id.to_string(),
            SweeperEntry {
                chunk_tx: handle.chunk_tx.clone(),
                last_activity: handle.last_activity.clone(),
                terminated: handle.terminated.clone(),
                cleanup_confirmed: handle.cleanup_confirmed.clone(),
            },
        );
    }
}

pub(crate) fn unregister_from_sweeper(upload_id: &str) {
    if let Ok(mut reg) = UPLOAD_SWEEPER_REGISTRY.lock() {
        reg.remove(upload_id);
    }
}

// ── Writer task ──────────────────────────────────────────────────────────────

fn writer_loop(
    sftp: ssh2::Sftp,
    mut file: ssh2::File,
    mut chunk_rx: mpsc::Receiver<UploadChunkMsg>,
    bytes_written: Arc<AtomicU64>,
    terminated: Arc<AtomicBool>,
    cleanup_confirmed: Arc<AtomicBool>,
    remote_path: String,
) {
    // Blocking loop — we're already on a spawn_blocking thread. Using
    // `blocking_recv()` lets us stay fully synchronous here.
    while let Some(msg) = chunk_rx.blocking_recv() {
        match msg {
            UploadChunkMsg::Write { offset, bytes, ack } => {
                let len = bytes.len() as u64;
                let result: Result<u64, String> = (|| {
                    file.seek(SeekFrom::Start(offset))
                        .map_err(|e| format!("Seek to {} failed: {}", offset, e))?;
                    file.write_all(&bytes).map_err(|e| {
                        format!("Write of {} bytes at {} failed: {}", len, offset, e)
                    })?;
                    Ok(len)
                })();
                if let Ok(n) = &result {
                    bytes_written.fetch_add(*n, Ordering::SeqCst);
                }
                let _ = ack.send(result);
            }
            UploadChunkMsg::Finish { ack } => {
                let result: Result<String, String> = (|| {
                    file.flush().map_err(|e| format!("Flush failed: {}", e))?;
                    // Drop closes the remote file.
                    drop(file);
                    drop(sftp);
                    Ok(remote_path.clone())
                })();
                terminated.store(true, Ordering::SeqCst);
                let _ = ack.send(result);
                return;
            }
            UploadChunkMsg::Abort { ack } => {
                // Best-effort: drop the file handle then unlink the partial.
                drop(file);
                let unlink_result = sftp
                    .unlink(Path::new(&remote_path))
                    .map_err(|e| format!("unlink '{}' failed: {}", remote_path, e));
                if unlink_result.is_ok() {
                    cleanup_confirmed.store(true, Ordering::SeqCst);
                }
                if let Err(ref e) = unlink_result {
                    warn!("abort: {}", e);
                }
                terminated.store(true, Ordering::SeqCst);
                let _ = ack.send(unlink_result);
                return;
            }
        }
    }
    // Channel closed without finish/abort — treat as abort.
    terminated.store(true, Ordering::SeqCst);
    drop(file);
    if sftp.unlink(Path::new(&remote_path)).is_ok() {
        cleanup_confirmed.store(true, Ordering::SeqCst);
    }
    warn!(
        "sftp upload writer: channel closed without finish/abort for '{}'",
        remote_path
    );
}
