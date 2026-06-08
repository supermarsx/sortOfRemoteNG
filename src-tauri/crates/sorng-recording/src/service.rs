// sorng-recording – Service facade
//
// Thin orchestration layer that coordinates the engine, encoders,
// compression, and storage modules.  All heavy work (encode, compress,
// save) is dispatched onto blocking tokio threads.

use std::path::PathBuf;
use std::sync::Arc;

use chrono::Utc;
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::compression;
use crate::encoders;
use crate::engine::{RecordingEngine, RecordingEngineState};
use crate::error::{RecordingError, RecordingResult};
use crate::storage;
use crate::types::*;
use sorng_encryption::EncryptionState;
use std::sync::atomic::{AtomicBool, Ordering};

/// High-level service.  Wraps engine state + storage root.
#[derive(Clone)]
pub struct RecordingService {
    pub engine: RecordingEngineState,
    pub storage_root: Arc<Mutex<PathBuf>>,
    /// Optional encryption-at-rest handle. When `Some` and unlocked,
    /// all envelope + macro persistence goes through the dispatched
    /// codecs (`<id>.json.enc`). When `None` or locked, the legacy
    /// plaintext path is used. Installed via `with_encryption_state`
    /// after `app.manage(EncryptionState)` has populated the global
    /// state, so the service can be constructed independently of the
    /// Tauri app boot order.
    encryption_state: Arc<Mutex<Option<Arc<EncryptionState>>>>,
    /// Cooperative cancel flag for an in-flight migration. Flipped
    /// by `cancel_migration`, polled by the reporter passed to the
    /// `*_with_progress` helpers. Survives independent service
    /// clones because it's behind an `Arc`.
    migration_cancel: Arc<AtomicBool>,
}

/// Tauri event name emitted as the recording migration walks each
/// file. Payload shape is documented on
/// [`RecordingMigrationProgressEvent`].
pub const REC_MIGRATE_EVENT: &str = "recording-migrate-progress";

/// Payload carried on every `recording-migrate-progress` event. The
/// frontend renders a progress bar from `(index, total)` per stage
/// and a small list of recently-processed names.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingMigrationProgressEvent {
    pub stage: String,
    pub index: usize,
    pub total: usize,
    pub name: String,
    pub skipped: bool,
}

impl RecordingService {
    pub fn new(app_data_dir: &str) -> Self {
        let root = storage::storage_root(None, app_data_dir);
        // best-effort dir creation
        let _ = storage::ensure_dirs(&root);
        Self {
            engine: Arc::new(Mutex::new(RecordingEngine::new())),
            storage_root: Arc::new(Mutex::new(root)),
            encryption_state: Arc::new(Mutex::new(None)),
            migration_cancel: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Flip the cooperative cancel flag for an in-flight migration.
    /// The migrator polls this before each file and stops as soon as
    /// the current file is fully committed (or skipped) — partial
    /// envelopes are never left on disk. Idempotent.
    pub fn cancel_migration(&self) {
        self.migration_cancel.store(true, Ordering::Release);
    }

    /// Reset the cancel flag — the migrator calls this on entry so a
    /// previously-cancelled run doesn't carry over.
    fn reset_migration_cancel(&self) {
        self.migration_cancel.store(false, Ordering::Release);
    }

    /// Hand the cancel flag to a Tauri-aware reporter so the command
    /// handler doesn't need access to the private field. Returns the
    /// same `Arc` the service holds — both ends see flips on either
    /// side.
    pub fn migration_cancel_flag(&self) -> Arc<AtomicBool> {
        self.migration_cancel.clone()
    }

    /// Storage root the service is configured against. Exposed so
    /// the master-key rotation orchestrator (in the `app` crate)
    /// can enumerate every encrypted artifact under the recordings
    /// tree without re-implementing the path-resolution rules.
    pub async fn storage_root_snapshot(&self) -> PathBuf {
        self.storage_root.lock().await.clone()
    }

    /// Inject the global `EncryptionState` so subsequent saves/loads
    /// dispatch to the encrypted codec while unlocked. Safe to call
    /// multiple times; later calls replace the handle.
    pub async fn set_encryption_state(&self, state: Arc<EncryptionState>) {
        *self.encryption_state.lock().await = Some(state);
    }

    /// Borrow the installed encryption state, if any.
    async fn enc_handle(&self) -> Option<Arc<EncryptionState>> {
        self.encryption_state.lock().await.clone()
    }

    /// Persist an envelope through the dispatched codec when an
    /// encryption state is installed; otherwise fall back to the
    /// legacy plaintext path.
    ///
    /// Phase 2c — when the envelope's `format` + `size_bytes` cross
    /// the [`should_use_media_sidecar`] threshold, the payload is
    /// written to a sidecar file via
    /// [`storage::save_media_blob_dispatched`] before the metadata
    /// envelope is persisted. The envelope itself is rewritten with
    /// `data` cleared and `media_blob_basename = Some(<id>.media)`
    /// so the load path can lazy-restore the bytes.
    /// Returns the envelope as it now exists on disk after persist —
    /// in particular, with `media_blob_basename` populated and `data`
    /// cleared if the payload was peeled into a sidecar. Callers
    /// (`save_to_library` + the `encode_compress_save_*` chain) use
    /// this to keep the in-memory library cache consistent with disk.
    async fn persist_envelope(
        &self,
        root: PathBuf,
        envelope: SavedRecordingEnvelope,
    ) -> RecordingResult<SavedRecordingEnvelope> {
        let mut env = envelope;

        // Decide whether to peel the payload into a sidecar. Skip the
        // check entirely when the envelope already has one — that path
        // is taken by `update_library_tags` / `rename_in_library`,
        // which re-save metadata only; we mustn't double-write a
        // sidecar for the same blob on every metadata edit.
        if !env.has_media_sidecar()
            && !env.data.is_empty()
            && crate::types::should_use_media_sidecar(&env.format, env.size_bytes)
        {
            let basename = format!("{}.media", env.id);
            let bytes = std::mem::take(&mut env.data).into_bytes();
            if let Some(enc) = self.enc_handle().await {
                storage::save_media_blob_dispatched(&root, &basename, &bytes, &enc).await?;
            } else {
                // No master state — store the sidecar as plaintext so
                // the layout stays consistent (the loader will not
                // expect inline `data`).
                let dir = root.join("recordings");
                std::fs::create_dir_all(&dir).map_err(|e| {
                    RecordingError::StorageError(format!("mkdir media: {}", e))
                })?;
                std::fs::write(dir.join(&basename), &bytes).map_err(|e| {
                    RecordingError::StorageError(format!("write media: {}", e))
                })?;
            }
            env.media_blob_basename = Some(basename);
        }

        if let Some(enc) = self.enc_handle().await {
            storage::save_envelope_dispatched(&root, &env, &enc).await?;
        } else {
            let to_save = env.clone();
            tokio::task::spawn_blocking(move || storage::save_envelope(&root, &to_save))
                .await
                .map_err(|e| RecordingError::Internal(e.to_string()))??;
        }
        Ok(env)
    }

    /// Lazy-load the media payload of an envelope that was persisted
    /// with a sidecar. Pre-2c envelopes (`media_blob_basename.is_none()`)
    /// already carry their bytes inline, so the caller can short-
    /// circuit on `envelope.data` directly — this method only does
    /// work for the sidecar case.
    ///
    /// Returns the raw payload bytes; the caller decodes / decompresses
    /// per the envelope's `compression` + `format` fields.
    pub async fn read_envelope_media(
        &self,
        envelope: &SavedRecordingEnvelope,
    ) -> RecordingResult<Vec<u8>> {
        if !envelope.has_media_sidecar() {
            // Backward-compat path: inline payload, return it directly.
            return Ok(envelope.data.clone().into_bytes());
        }
        let root = self.storage_root.lock().await.clone();
        let basename = envelope.media_blob_basename.as_deref().unwrap();
        if let Some(enc) = self.enc_handle().await {
            storage::load_media_blob_dispatched(&root, basename, &enc).await
        } else {
            let path = root.join("recordings").join(basename);
            std::fs::read(&path).map_err(|e| {
                RecordingError::StorageError(format!("read media {}: {}", path.display(), e))
            })
        }
    }

    /// Random-access chunk read for a sidecar payload — surfaces the
    /// chunked-stream codec to the playback path. Falls back to a
    /// sliced inline read for legacy envelopes so callers don't
    /// branch on the format.
    pub async fn read_envelope_media_chunk(
        &self,
        envelope: &SavedRecordingEnvelope,
        chunk_index: u32,
        chunk_size_hint: usize,
    ) -> RecordingResult<Vec<u8>> {
        if !envelope.has_media_sidecar() {
            let bytes = envelope.data.as_bytes();
            let start = (chunk_index as usize)
                .checked_mul(chunk_size_hint)
                .ok_or_else(|| RecordingError::StorageError("chunk overflow".into()))?;
            if start >= bytes.len() {
                return Err(RecordingError::StorageError(format!(
                    "chunk {} past end of inline payload",
                    chunk_index
                )));
            }
            let end = (start + chunk_size_hint).min(bytes.len());
            return Ok(bytes[start..end].to_vec());
        }
        let root = self.storage_root.lock().await.clone();
        let basename = envelope.media_blob_basename.as_deref().unwrap();
        let enc = self.enc_handle().await.ok_or_else(|| {
            RecordingError::StorageError(
                "encryption state not installed; cannot read media chunk".into(),
            )
        })?;
        storage::read_media_chunk_dispatched(
            &root,
            basename,
            chunk_index,
            chunk_size_hint,
            &enc,
        )
        .await
    }

    async fn persist_macro(
        &self,
        root: PathBuf,
        m: MacroRecording,
    ) -> RecordingResult<()> {
        if let Some(enc) = self.enc_handle().await {
            storage::save_macro_dispatched(&root, &m, &enc).await
        } else {
            tokio::task::spawn_blocking(move || storage::save_macro(&root, &m))
                .await
                .map_err(|e| RecordingError::Internal(e.to_string()))?
        }
    }

    async fn list_envelopes_dispatched(&self, root: PathBuf) -> RecordingResult<Vec<SavedRecordingEnvelope>> {
        if let Some(enc) = self.enc_handle().await {
            storage::load_all_envelopes_dispatched(&root, &enc).await
        } else {
            tokio::task::spawn_blocking(move || storage::load_all_envelopes(&root))
                .await
                .map_err(|e| RecordingError::Internal(e.to_string()))?
        }
    }

    async fn list_macros_dispatched(&self, root: PathBuf) -> RecordingResult<Vec<MacroRecording>> {
        if let Some(enc) = self.enc_handle().await {
            storage::load_all_macros_dispatched(&root, &enc).await
        } else {
            tokio::task::spawn_blocking(move || storage::load_all_macros(&root))
                .await
                .map_err(|e| RecordingError::Internal(e.to_string()))?
        }
    }

    /// One-shot migration of any plaintext recordings + macros on disk
    /// into their encrypted variants. Requires an installed and
    /// unlocked encryption state. Returns `(envelopes_migrated,
    /// envelopes_skipped, macros_migrated, macros_skipped)`.
    pub async fn migrate_to_encrypted(
        &self,
    ) -> RecordingResult<(usize, usize, usize, usize)> {
        self.migrate_to_encrypted_with_progress(&storage::NoopProgress).await
    }

    /// Progress-aware variant of [`migrate_to_encrypted`]. Resets the
    /// cooperative cancel flag on entry and propagates partial counts
    /// when the reporter requests a cancel mid-walk.
    pub async fn migrate_to_encrypted_with_progress(
        &self,
        progress: &dyn storage::MigrationProgress,
    ) -> RecordingResult<(usize, usize, usize, usize)> {
        self.reset_migration_cancel();
        let enc = self
            .enc_handle()
            .await
            .ok_or_else(|| RecordingError::StorageError(
                "encryption state not installed; cannot migrate".into(),
            ))?;
        let root = self.storage_root.lock().await.clone();
        let (em, es) =
            storage::migrate_all_envelopes_to_encrypted_with_progress(&root, &enc, progress)
                .await?;
        let (mm, ms) =
            storage::migrate_all_macros_to_encrypted_with_progress(&root, &enc, progress).await?;
        // Refresh in-memory caches from disk so the UI reflects the
        // post-migration filenames immediately (no restart required).
        let envelopes = storage::load_all_envelopes_dispatched(&root, &enc).await?;
        let macros = storage::load_all_macros_dispatched(&root, &enc).await?;
        {
            let mut eng = self.engine.lock().await;
            eng.library = envelopes;
            eng.macro_library = macros;
        }
        Ok((em, es, mm, ms))
    }

    /// Initialise from disk: load config, library, macros.
    pub async fn init(&self) -> RecordingResult<()> {
        let root = self.storage_root.lock().await.clone();
        let config = tokio::task::spawn_blocking({
            let r = root.clone();
            move || storage::load_config(&r)
        })
        .await
        .map_err(|e| RecordingError::Internal(e.to_string()))??;

        // Dispatch through the encryption-aware listers so that, once
        // the user has migrated, the library + macros loaded at startup
        // already reflect `.json.enc` entries. When no encryption state
        // has been installed yet (boot-order race with state_registry)
        // these fall back to the legacy plaintext path.
        let envelopes = self.list_envelopes_dispatched(root.clone()).await?;
        let macros = self.list_macros_dispatched(root.clone()).await?;

        {
            let mut eng = self.engine.lock().await;
            // Apply loaded config; update storage root if custom dir is set
            if let Some(ref dir) = config.storage_directory {
                if !dir.is_empty() {
                    let mut sr = self.storage_root.lock().await;
                    *sr = PathBuf::from(dir);
                }
            }
            eng.config = config;
            eng.library = envelopes;
            eng.macro_library = macros;
        }

        log::info!("Recording service initialised from {}", root.display());
        Ok(())
    }

    // ──────────────────────────────────────────────────────────────────
    //  Config
    // ──────────────────────────────────────────────────────────────────

    pub async fn get_config(&self) -> RecordingGlobalConfig {
        self.engine.lock().await.get_config()
    }

    pub async fn update_config(&self, config: RecordingGlobalConfig) -> RecordingResult<()> {
        let root = self.storage_root.lock().await.clone();
        {
            let mut eng = self.engine.lock().await;
            eng.update_config(config.clone());
        }
        tokio::task::spawn_blocking(move || storage::save_config(&root, &config))
            .await
            .map_err(|e| RecordingError::Internal(e.to_string()))?
    }

    // ──────────────────────────────────────────────────────────────────
    //  Terminal recording  (SSH, Telnet, etc.)
    // ──────────────────────────────────────────────────────────────────

    #[allow(clippy::too_many_arguments)]
    pub async fn start_terminal_recording(
        &self,
        session_id: String,
        protocol: RecordingProtocol,
        host: String,
        username: String,
        cols: u32,
        rows: u32,
        record_input: bool,
        tags: Vec<String>,
    ) -> RecordingResult<String> {
        let mut eng = self.engine.lock().await;
        eng.start_terminal_recording(
            session_id,
            protocol,
            host,
            username,
            cols,
            rows,
            record_input,
            tags,
        )
    }

    pub async fn append_terminal_output(&self, session_id: &str, data: &str) {
        let mut eng = self.engine.lock().await;
        eng.append_terminal_output(session_id, data);
    }

    pub async fn append_terminal_input(&self, session_id: &str, data: &str) {
        let mut eng = self.engine.lock().await;
        eng.append_terminal_input(session_id, data);
    }

    pub async fn append_terminal_resize(&self, session_id: &str, cols: u32, rows: u32) {
        let mut eng = self.engine.lock().await;
        eng.append_terminal_resize(session_id, cols, rows);
    }

    pub async fn stop_terminal_recording(
        &self,
        session_id: &str,
    ) -> RecordingResult<TerminalRecording> {
        let mut eng = self.engine.lock().await;
        eng.stop_terminal_recording(session_id)
    }

    pub async fn get_terminal_recording_status(
        &self,
        session_id: &str,
    ) -> Option<TerminalRecordingMetadata> {
        self.engine
            .lock()
            .await
            .get_terminal_recording_status(session_id)
    }

    pub async fn is_terminal_recording(&self, session_id: &str) -> bool {
        self.engine.lock().await.is_terminal_recording(session_id)
    }

    // ──────────────────────────────────────────────────────────────────
    //  Screen recording (RDP, VNC)
    // ──────────────────────────────────────────────────────────────────

    #[allow(clippy::too_many_arguments)]
    pub async fn start_screen_recording(
        &self,
        session_id: String,
        protocol: RecordingProtocol,
        host: String,
        connection_name: String,
        width: u32,
        height: u32,
        fps: u32,
        tags: Vec<String>,
    ) -> RecordingResult<String> {
        let mut eng = self.engine.lock().await;
        eng.start_screen_recording(
            session_id,
            protocol,
            host,
            connection_name,
            width,
            height,
            fps,
            tags,
        )
    }

    pub async fn append_screen_frame(
        &self,
        session_id: &str,
        width: u32,
        height: u32,
        data_b64: String,
    ) {
        let mut eng = self.engine.lock().await;
        eng.append_screen_frame(session_id, width, height, data_b64);
    }

    pub async fn stop_screen_recording(&self, session_id: &str) -> RecordingResult<RdpRecording> {
        let mut eng = self.engine.lock().await;
        eng.stop_screen_recording(session_id)
    }

    pub async fn get_screen_recording_status(
        &self,
        session_id: &str,
    ) -> Option<RdpRecordingMetadata> {
        self.engine
            .lock()
            .await
            .get_screen_recording_status(session_id)
    }

    pub async fn is_screen_recording(&self, session_id: &str) -> bool {
        self.engine.lock().await.is_screen_recording(session_id)
    }

    // ──────────────────────────────────────────────────────────────────
    //  HTTP recording
    // ──────────────────────────────────────────────────────────────────

    pub async fn start_http_recording(
        &self,
        session_id: String,
        host: String,
        target_url: String,
        record_headers: bool,
        tags: Vec<String>,
    ) -> RecordingResult<String> {
        let mut eng = self.engine.lock().await;
        eng.start_http_recording(session_id, host, target_url, record_headers, tags)
    }

    pub async fn append_http_entry(&self, session_id: &str, entry: HttpRecordingEntry) {
        let mut eng = self.engine.lock().await;
        eng.append_http_entry(session_id, entry);
    }

    pub async fn stop_http_recording(&self, session_id: &str) -> RecordingResult<HttpRecording> {
        let mut eng = self.engine.lock().await;
        eng.stop_http_recording(session_id)
    }

    pub async fn get_http_recording_status(
        &self,
        session_id: &str,
    ) -> Option<HttpRecordingMetadata> {
        self.engine
            .lock()
            .await
            .get_http_recording_status(session_id)
    }

    pub async fn is_http_recording(&self, session_id: &str) -> bool {
        self.engine.lock().await.is_http_recording(session_id)
    }

    // ──────────────────────────────────────────────────────────────────
    //  Telnet recording
    // ──────────────────────────────────────────────────────────────────

    pub async fn start_telnet_recording(
        &self,
        session_id: String,
        host: String,
        port: u16,
        tags: Vec<String>,
    ) -> RecordingResult<String> {
        let mut eng = self.engine.lock().await;
        eng.start_telnet_recording(session_id, host, port, tags)
    }

    pub async fn append_telnet_entry(&self, session_id: &str, entry: TelnetRecordingEntry) {
        let mut eng = self.engine.lock().await;
        eng.append_telnet_entry(session_id, entry);
    }

    pub async fn stop_telnet_recording(
        &self,
        session_id: &str,
    ) -> RecordingResult<TelnetRecording> {
        let mut eng = self.engine.lock().await;
        eng.stop_telnet_recording(session_id)
    }

    pub async fn get_telnet_recording_status(
        &self,
        session_id: &str,
    ) -> Option<TelnetRecordingMetadata> {
        self.engine
            .lock()
            .await
            .get_telnet_recording_status(session_id)
    }

    pub async fn is_telnet_recording(&self, session_id: &str) -> bool {
        self.engine.lock().await.is_telnet_recording(session_id)
    }

    // ──────────────────────────────────────────────────────────────────
    //  Serial recording
    // ──────────────────────────────────────────────────────────────────

    pub async fn start_serial_recording(
        &self,
        session_id: String,
        port_name: String,
        baud_rate: u32,
        tags: Vec<String>,
    ) -> RecordingResult<String> {
        let mut eng = self.engine.lock().await;
        eng.start_serial_recording(session_id, port_name, baud_rate, tags)
    }

    pub async fn append_serial_entry(&self, session_id: &str, entry: SerialRecordingEntry) {
        let mut eng = self.engine.lock().await;
        eng.append_serial_entry(session_id, entry);
    }

    pub async fn stop_serial_recording(
        &self,
        session_id: &str,
    ) -> RecordingResult<SerialRecording> {
        let mut eng = self.engine.lock().await;
        eng.stop_serial_recording(session_id)
    }

    pub async fn get_serial_recording_status(
        &self,
        session_id: &str,
    ) -> Option<SerialRecordingMetadata> {
        self.engine
            .lock()
            .await
            .get_serial_recording_status(session_id)
    }

    pub async fn is_serial_recording(&self, session_id: &str) -> bool {
        self.engine.lock().await.is_serial_recording(session_id)
    }

    // ──────────────────────────────────────────────────────────────────
    //  DB query recording
    // ──────────────────────────────────────────────────────────────────

    pub async fn start_db_recording(
        &self,
        session_id: String,
        host: String,
        database_type: String,
        database_name: String,
        tags: Vec<String>,
    ) -> RecordingResult<String> {
        let mut eng = self.engine.lock().await;
        eng.start_db_recording(session_id, host, database_type, database_name, tags)
    }

    pub async fn append_db_entry(&self, session_id: &str, entry: DbQueryEntry) {
        let mut eng = self.engine.lock().await;
        eng.append_db_entry(session_id, entry);
    }

    pub async fn stop_db_recording(&self, session_id: &str) -> RecordingResult<DbQueryRecording> {
        let mut eng = self.engine.lock().await;
        eng.stop_db_recording(session_id)
    }

    pub async fn get_db_recording_status(
        &self,
        session_id: &str,
    ) -> Option<DbQueryRecordingMetadata> {
        self.engine.lock().await.get_db_recording_status(session_id)
    }

    pub async fn is_db_recording(&self, session_id: &str) -> bool {
        self.engine.lock().await.is_db_recording(session_id)
    }

    // ──────────────────────────────────────────────────────────────────
    //  Macro recording
    // ──────────────────────────────────────────────────────────────────

    pub async fn start_macro_recording(
        &self,
        session_id: String,
        target_protocol: RecordingProtocol,
    ) -> RecordingResult<String> {
        let mut eng = self.engine.lock().await;
        eng.start_macro_recording(session_id, target_protocol)
    }

    pub async fn macro_record_input(&self, session_id: &str, data: &str) {
        let mut eng = self.engine.lock().await;
        eng.macro_record_input(session_id, data);
    }

    pub async fn stop_macro_recording(
        &self,
        session_id: &str,
        name: String,
        description: Option<String>,
        category: Option<String>,
        tags: Vec<String>,
    ) -> RecordingResult<MacroRecording> {
        let macro_rec;
        {
            let mut eng = self.engine.lock().await;
            macro_rec = eng.stop_macro_recording(session_id, name, description, category, tags)?;
        }
        // Persist to disk — dispatched so a freshly stopped macro lands
        // in the encrypted file when the user is unlocked.
        let root = self.storage_root.lock().await.clone();
        self.persist_macro(root, macro_rec.clone()).await?;
        Ok(macro_rec)
    }

    pub async fn is_macro_recording(&self, session_id: &str) -> bool {
        self.engine.lock().await.is_macro_recording(session_id)
    }

    // ──────────────────────────────────────────────────────────────────
    //  Macro CRUD
    // ──────────────────────────────────────────────────────────────────

    pub async fn list_macros(&self) -> Vec<MacroRecording> {
        self.engine.lock().await.list_macros()
    }

    pub async fn get_macro(&self, macro_id: &str) -> Option<MacroRecording> {
        self.engine.lock().await.get_macro(macro_id)
    }

    pub async fn update_macro(&self, updated: MacroRecording) -> RecordingResult<()> {
        let root = self.storage_root.lock().await.clone();
        {
            let mut eng = self.engine.lock().await;
            eng.update_macro(updated.clone())?;
        }
        self.persist_macro(root, updated).await
    }

    pub async fn delete_macro(&self, macro_id: &str) -> RecordingResult<()> {
        let root = self.storage_root.lock().await.clone();
        {
            let mut eng = self.engine.lock().await;
            eng.delete_macro(macro_id)?;
        }
        // Delete both v0 plaintext and v2 encrypted variants — during
        // migration both may exist briefly for the same id.
        let id = macro_id.to_string();
        tokio::task::spawn_blocking(move || storage::delete_macro_all_variants(&root, &id))
            .await
            .map_err(|e| RecordingError::Internal(e.to_string()))?
    }

    pub async fn import_macro(&self, macro_rec: MacroRecording) -> RecordingResult<()> {
        let root = self.storage_root.lock().await.clone();
        {
            let mut eng = self.engine.lock().await;
            eng.import_macro(macro_rec.clone());
        }
        self.persist_macro(root, macro_rec).await
    }

    // ──────────────────────────────────────────────────────────────────
    //  Encoding  (threaded)
    // ──────────────────────────────────────────────────────────────────

    pub async fn encode_terminal_asciicast(
        &self,
        recording: TerminalRecording,
    ) -> RecordingResult<String> {
        tokio::task::spawn_blocking(move || encoders::encode_asciicast(&recording))
            .await
            .map_err(|e| RecordingError::Internal(e.to_string()))?
    }

    pub async fn encode_terminal_script(
        &self,
        recording: TerminalRecording,
    ) -> RecordingResult<String> {
        tokio::task::spawn_blocking(move || encoders::encode_script(&recording))
            .await
            .map_err(|e| RecordingError::Internal(e.to_string()))?
    }

    pub async fn encode_http_har(&self, recording: HttpRecording) -> RecordingResult<String> {
        tokio::task::spawn_blocking(move || encoders::encode_har(&recording))
            .await
            .map_err(|e| RecordingError::Internal(e.to_string()))?
    }

    pub async fn encode_db_csv(&self, recording: DbQueryRecording) -> RecordingResult<String> {
        tokio::task::spawn_blocking(move || encoders::encode_db_queries_csv(&recording))
            .await
            .map_err(|e| RecordingError::Internal(e.to_string()))?
    }

    pub async fn encode_http_csv(&self, recording: HttpRecording) -> RecordingResult<String> {
        tokio::task::spawn_blocking(move || encoders::encode_http_csv(&recording))
            .await
            .map_err(|e| RecordingError::Internal(e.to_string()))?
    }

    pub async fn encode_telnet_asciicast(
        &self,
        recording: TelnetRecording,
    ) -> RecordingResult<String> {
        tokio::task::spawn_blocking(move || encoders::encode_telnet_asciicast(&recording))
            .await
            .map_err(|e| RecordingError::Internal(e.to_string()))?
    }

    pub async fn encode_serial_raw(&self, recording: SerialRecording) -> RecordingResult<String> {
        tokio::task::spawn_blocking(move || encoders::encode_serial_raw(&recording))
            .await
            .map_err(|e| RecordingError::Internal(e.to_string()))?
    }

    pub async fn encode_frame_manifest(&self, recording: RdpRecording) -> RecordingResult<String> {
        tokio::task::spawn_blocking(move || encoders::encode_frame_sequence_manifest(&recording))
            .await
            .map_err(|e| RecordingError::Internal(e.to_string()))?
    }

    // ──────────────────────────────────────────────────────────────────
    //  Compression  (threaded)
    // ──────────────────────────────────────────────────────────────────

    pub async fn compress_data(
        &self,
        data: String,
        algo: CompressionAlgorithm,
    ) -> RecordingResult<String> {
        tokio::task::spawn_blocking(move || compression::compress_to_b64(&data, &algo))
            .await
            .map_err(|e| RecordingError::Internal(e.to_string()))?
    }

    pub async fn decompress_data(
        &self,
        b64: String,
        algo: CompressionAlgorithm,
    ) -> RecordingResult<String> {
        tokio::task::spawn_blocking(move || compression::decompress_from_b64(&b64, &algo))
            .await
            .map_err(|e| RecordingError::Internal(e.to_string()))?
    }

    // ──────────────────────────────────────────────────────────────────
    //  Library operations  (threaded I/O)
    // ──────────────────────────────────────────────────────────────────

    pub async fn save_to_library(&self, envelope: SavedRecordingEnvelope) -> RecordingResult<()> {
        let root = self.storage_root.lock().await.clone();
        // Persist first so we have the post-peel envelope shape (with
        // `data` cleared and `media_blob_basename` populated when the
        // sidecar codec ran). Caching the pre-peel envelope in the
        // engine would leave the in-memory library diverging from
        // disk — every subsequent `get_from_library` would hand the
        // UI inline bytes the next process restart can't reproduce.
        let persisted = self.persist_envelope(root, envelope).await?;
        let mut eng = self.engine.lock().await;
        eng.save_to_library(persisted);
        Ok(())
    }

    pub async fn get_from_library(&self, id: &str) -> Option<SavedRecordingEnvelope> {
        self.engine.lock().await.get_from_library(id)
    }

    pub async fn list_library(&self) -> Vec<SavedRecordingEnvelope> {
        self.engine.lock().await.list_library()
    }

    pub async fn list_library_by_protocol(
        &self,
        protocol: RecordingProtocol,
    ) -> Vec<SavedRecordingEnvelope> {
        self.engine.lock().await.list_library_by_protocol(&protocol)
    }

    pub async fn search_library(&self, query: &str) -> Vec<SavedRecordingEnvelope> {
        self.engine.lock().await.search_library(query)
    }

    pub async fn rename_in_library(&self, id: &str, name: String) -> RecordingResult<()> {
        let root = self.storage_root.lock().await.clone();
        {
            let mut eng = self.engine.lock().await;
            eng.rename_in_library(id, name)?;
        }
        // Re-save updated envelope to disk through the dispatched path.
        // Metadata-only edit: the envelope already carries
        // `media_blob_basename` from the original save, and `data` is
        // empty, so `persist_envelope` short-circuits the sidecar
        // peel and only rewrites the metadata file.
        let envelope = self.engine.lock().await.get_from_library(id);
        if let Some(env) = envelope {
            let _ = self.persist_envelope(root, env).await?;
        }
        Ok(())
    }

    pub async fn update_library_tags(&self, id: &str, tags: Vec<String>) -> RecordingResult<()> {
        let root = self.storage_root.lock().await.clone();
        {
            let mut eng = self.engine.lock().await;
            eng.update_library_tags(id, tags)?;
        }
        let envelope = self.engine.lock().await.get_from_library(id);
        if let Some(env) = envelope {
            let _ = self.persist_envelope(root, env).await?;
        }
        Ok(())
    }

    pub async fn delete_from_library(&self, id: &str) -> RecordingResult<()> {
        let root = self.storage_root.lock().await.clone();
        // Capture the media sidecar name (if any) before the engine
        // drops the in-memory entry — we need it to delete the
        // payload file alongside the metadata.
        let sidecar = {
            let eng = self.engine.lock().await;
            eng.get_from_library(id)
                .and_then(|env| env.media_blob_basename.clone())
        };
        {
            let mut eng = self.engine.lock().await;
            eng.delete_from_library(id)?;
        }
        // Delete both metadata variants for safety during the
        // v0/v2 migration window.
        let id_owned = id.to_string();
        let root_for_meta = root.clone();
        tokio::task::spawn_blocking(move || {
            storage::delete_envelope_all_variants(&root_for_meta, &id_owned)
        })
        .await
        .map_err(|e| RecordingError::Internal(e.to_string()))??;
        // Then the media sidecar — same both-variants policy so a
        // post-migration stale plaintext is also swept.
        if let Some(basename) = sidecar {
            let root_for_media = root.clone();
            tokio::task::spawn_blocking(move || {
                storage::delete_media_all_variants(&root_for_media, &basename)
            })
            .await
            .map_err(|e| RecordingError::Internal(e.to_string()))??;
        }
        Ok(())
    }

    pub async fn clear_library(&self) -> RecordingResult<usize> {
        let root = self.storage_root.lock().await.clone();
        let count;
        {
            let mut eng = self.engine.lock().await;
            count = eng.clear_library();
        }
        tokio::task::spawn_blocking(move || storage::clear_envelopes(&root))
            .await
            .map_err(|e| RecordingError::Internal(e.to_string()))??;
        Ok(count)
    }

    pub async fn library_summary(&self) -> RecordingLibrarySummary {
        self.engine.lock().await.library_summary()
    }

    // ──────────────────────────────────────────────────────────────────
    //  Aggregate helpers
    // ──────────────────────────────────────────────────────────────────

    pub async fn list_active_recordings(&self) -> Vec<ActiveRecordingInfo> {
        self.engine.lock().await.list_active_recordings()
    }

    pub async fn active_count(&self) -> usize {
        self.engine.lock().await.active_count()
    }

    pub async fn stop_all(&self) -> Vec<String> {
        let mut eng = self.engine.lock().await;
        eng.stop_all()
    }

    // ──────────────────────────────────────────────────────────────────
    //  Jobs
    // ──────────────────────────────────────────────────────────────────

    pub async fn list_jobs(&self) -> Vec<JobInfo> {
        self.engine.lock().await.list_jobs()
    }

    pub async fn get_job(&self, job_id: &str) -> Option<JobInfo> {
        self.engine.lock().await.get_job(job_id)
    }

    pub async fn clear_completed_jobs(&self) -> usize {
        let mut eng = self.engine.lock().await;
        eng.clear_completed_jobs()
    }

    // ──────────────────────────────────────────────────────────────────
    //  Auto-cleanup  (threaded)
    // ──────────────────────────────────────────────────────────────────

    pub async fn run_auto_cleanup(&self) -> RecordingResult<usize> {
        let root = self.storage_root.lock().await.clone();
        let config = self.get_config().await;
        if !config.auto_cleanup_enabled {
            return Ok(0);
        }
        let days = config.auto_cleanup_older_than_days;
        let max_bytes = config.max_storage_bytes;

        let deleted_age = tokio::task::spawn_blocking({
            let r = root.clone();
            move || storage::cleanup_old_envelopes(&r, days)
        })
        .await
        .map_err(|e| RecordingError::Internal(e.to_string()))??;

        let deleted_size =
            tokio::task::spawn_blocking(move || storage::enforce_storage_limit(&root, max_bytes))
                .await
                .map_err(|e| RecordingError::Internal(e.to_string()))??;

        // Also clean from in-memory library
        {
            let mut eng = self.engine.lock().await;
            eng.auto_cleanup();
        }

        let total = deleted_age + deleted_size;
        if total > 0 {
            log::info!("Auto-cleanup removed {} recordings", total);
        }
        Ok(total)
    }

    // ──────────────────────────────────────────────────────────────────
    //  Storage info
    // ──────────────────────────────────────────────────────────────────

    pub async fn storage_size(&self) -> RecordingResult<u64> {
        let root = self.storage_root.lock().await.clone();
        tokio::task::spawn_blocking(move || storage::storage_size(&root))
            .await
            .map_err(|e| RecordingError::Internal(e.to_string()))?
    }

    // ──────────────────────────────────────────────────────────────────
    //  Combined encode + compress + save workflow
    // ──────────────────────────────────────────────────────────────────

    /// One-shot: encode a terminal recording, compress, and save to library.
    #[allow(clippy::too_many_arguments)]
    pub async fn encode_compress_save_terminal(
        &self,
        recording: TerminalRecording,
        name: String,
        description: Option<String>,
        format: ExportFormat,
        algo: CompressionAlgorithm,
        connection_id: Option<String>,
        tags: Vec<String>,
    ) -> RecordingResult<String> {
        let id = Uuid::new_v4().to_string();
        let rec = recording.clone();
        let fmt = format.clone();

        // Encode on a blocking thread
        let encoded = tokio::task::spawn_blocking(move || match fmt {
            ExportFormat::Asciicast => encoders::encode_asciicast(&rec),
            ExportFormat::Script => encoders::encode_script(&rec),
            ExportFormat::Json => encoders::encode_terminal_json(&rec),
            _ => encoders::encode_terminal_json(&rec),
        })
        .await
        .map_err(|e| RecordingError::Internal(e.to_string()))??;

        // Compress on a blocking thread
        let algo2 = algo.clone();
        let data =
            tokio::task::spawn_blocking(move || compression::compress_to_b64(&encoded, &algo2))
                .await
                .map_err(|e| RecordingError::Internal(e.to_string()))??;

        let envelope = SavedRecordingEnvelope {
            id: id.clone(),
            name,
            description,
            protocol: recording.metadata.protocol.clone(),
            saved_at: Utc::now(),
            duration_ms: recording.metadata.duration_ms,
            size_bytes: data.len() as u64,
            compression: algo,
            format,
            tags,
            connection_id,
            connection_name: None,
            host: Some(recording.metadata.host.clone()),
            data,
            // Phase 2c — `persist_envelope` decides whether to peel
            // the payload into a sidecar; constructors always start
            // with the inline form so the routing logic stays in one
            // place.
            media_blob_basename: None,
        };

        self.save_to_library(envelope).await?;
        Ok(id)
    }

    /// One-shot: encode an HTTP recording, compress, and save to library.
    #[allow(clippy::too_many_arguments)]
    pub async fn encode_compress_save_http(
        &self,
        recording: HttpRecording,
        name: String,
        description: Option<String>,
        format: ExportFormat,
        algo: CompressionAlgorithm,
        connection_id: Option<String>,
        tags: Vec<String>,
    ) -> RecordingResult<String> {
        let id = Uuid::new_v4().to_string();
        let rec = recording.clone();
        let fmt = format.clone();

        let encoded = tokio::task::spawn_blocking(move || match fmt {
            ExportFormat::Har => encoders::encode_har(&rec),
            ExportFormat::Csv => encoders::encode_http_csv(&rec),
            ExportFormat::Json => encoders::encode_http_json(&rec),
            _ => encoders::encode_http_json(&rec),
        })
        .await
        .map_err(|e| RecordingError::Internal(e.to_string()))??;

        let algo2 = algo.clone();
        let data =
            tokio::task::spawn_blocking(move || compression::compress_to_b64(&encoded, &algo2))
                .await
                .map_err(|e| RecordingError::Internal(e.to_string()))??;

        let envelope = SavedRecordingEnvelope {
            id: id.clone(),
            name,
            description,
            protocol: RecordingProtocol::Http,
            saved_at: Utc::now(),
            duration_ms: recording.metadata.duration_ms,
            size_bytes: data.len() as u64,
            compression: algo,
            format,
            tags,
            connection_id,
            connection_name: None,
            host: Some(recording.metadata.host.clone()),
            data,
            // Phase 2c — `persist_envelope` decides whether to peel
            // the payload into a sidecar; constructors always start
            // with the inline form so the routing logic stays in one
            // place.
            media_blob_basename: None,
        };

        self.save_to_library(envelope).await?;
        Ok(id)
    }

    /// One-shot: encode a screen recording, compress, and save to library.
    #[allow(clippy::too_many_arguments)]
    pub async fn encode_compress_save_screen(
        &self,
        recording: RdpRecording,
        name: String,
        description: Option<String>,
        format: ExportFormat,
        algo: CompressionAlgorithm,
        connection_id: Option<String>,
        tags: Vec<String>,
    ) -> RecordingResult<String> {
        let id = Uuid::new_v4().to_string();
        let rec = recording.clone();
        let fmt = format.clone();

        let encoded = tokio::task::spawn_blocking(move || match fmt {
            ExportFormat::FrameSequence => encoders::encode_frame_sequence_manifest(&rec),
            ExportFormat::Json => encoders::encode_screen_json(&rec),
            _ => encoders::encode_screen_json(&rec),
        })
        .await
        .map_err(|e| RecordingError::Internal(e.to_string()))??;

        let algo2 = algo.clone();
        let data =
            tokio::task::spawn_blocking(move || compression::compress_to_b64(&encoded, &algo2))
                .await
                .map_err(|e| RecordingError::Internal(e.to_string()))??;

        let envelope = SavedRecordingEnvelope {
            id: id.clone(),
            name,
            description,
            protocol: RecordingProtocol::Rdp,
            saved_at: Utc::now(),
            duration_ms: recording.metadata.duration_ms,
            size_bytes: data.len() as u64,
            compression: algo,
            format,
            tags,
            connection_id,
            connection_name: Some(recording.metadata.connection_name.clone()),
            host: Some(recording.metadata.host.clone()),
            data,
            // Phase 2c — `persist_envelope` decides whether to peel
            // the payload into a sidecar; constructors always start
            // with the inline form so the routing logic stays in one
            // place.
            media_blob_basename: None,
        };

        self.save_to_library(envelope).await?;
        Ok(id)
    }
}

/// Type alias for Tauri managed state.
pub type RecordingServiceState = std::sync::Arc<tokio::sync::Mutex<RecordingService>>;

/// Create a new service state ready for `app.manage()`.
pub fn new_service_state(app_data_dir: &str) -> RecordingServiceState {
    std::sync::Arc::new(tokio::sync::Mutex::new(RecordingService::new(app_data_dir)))
}

#[cfg(test)]
mod phase_2c_split_tests {
    //! Phase 2c — media sidecar split-out, exercised via the live
    //! `RecordingService`. Covers the discriminating cases:
    //!   - large binary formats peel into a sidecar
    //!   - text formats stay inline regardless of size
    //!   - metadata-only edits (rename / retag) don't double-write
    //!   - delete sweeps both metadata and sidecar
    //!   - `read_envelope_media` round-trips both inline and sidecar
    //!     envelopes through the same caller-facing API
    //!   - legacy envelopes (no sidecar field on disk) keep loading
    //!     after the schema change
    use super::*;
    use sorng_encryption::{EncryptionState, MasterDek};
    use tempfile::tempdir;

    fn fixture_envelope(
        id: &str,
        format: ExportFormat,
        size: u64,
        payload: String,
    ) -> SavedRecordingEnvelope {
        SavedRecordingEnvelope {
            id: id.to_string(),
            name: format!("rec-{}", id),
            description: None,
            protocol: RecordingProtocol::Ssh,
            saved_at: chrono::Utc::now(),
            duration_ms: 0,
            size_bytes: size,
            compression: CompressionAlgorithm::None,
            format,
            tags: vec![],
            connection_id: None,
            connection_name: Some("t".to_string()),
            host: Some("h".to_string()),
            data: payload,
            media_blob_basename: None,
        }
    }

    async fn fresh_service(root: &std::path::Path, unlocked: bool) -> RecordingService {
        let svc = RecordingService::new(root.to_string_lossy().as_ref());
        if unlocked {
            let state = EncryptionState::new();
            state
                .install(MasterDek::from_bytes(&[5u8; 32]).unwrap())
                .await;
            svc.set_encryption_state(std::sync::Arc::new(state)).await;
        }
        svc
    }

    #[tokio::test]
    async fn large_binary_format_peels_into_sidecar() {
        let tmp = tempdir().unwrap();
        let svc = fresh_service(tmp.path(), true).await;
        // FrameSequence is binary-shaped: triggers the sidecar even
        // below the size threshold (sidecar predicate ORs format +
        // size).
        let env = fixture_envelope(
            "f1",
            ExportFormat::FrameSequence,
            2048,
            "binary-blob-bytes".to_string(),
        );
        svc.save_to_library(env).await.unwrap();
        let stored = svc.get_from_library("f1").await.unwrap();
        assert!(stored.has_media_sidecar());
        assert!(stored.data.is_empty(), "inline data must be cleared");
        assert_eq!(stored.media_blob_basename.as_deref(), Some("f1.media"));
    }

    #[tokio::test]
    async fn text_format_under_threshold_stays_inline() {
        let tmp = tempdir().unwrap();
        let svc = fresh_service(tmp.path(), true).await;
        // Asciicast is text-shaped + small: stays inline so a single
        // metadata read still recovers the recording without a second
        // file open.
        let env = fixture_envelope(
            "t1",
            ExportFormat::Asciicast,
            500,
            "asciicast-body".to_string(),
        );
        svc.save_to_library(env).await.unwrap();
        let stored = svc.get_from_library("t1").await.unwrap();
        assert!(!stored.has_media_sidecar());
        assert_eq!(stored.data, "asciicast-body");
    }

    #[tokio::test]
    async fn text_format_over_threshold_promotes_to_sidecar() {
        let tmp = tempdir().unwrap();
        let svc = fresh_service(tmp.path(), true).await;
        // Asciicast that's larger than the threshold still pages out:
        // the chunked-stream codec wins on seek and on metadata scan
        // bloat regardless of the textual nature.
        let big = "x".repeat((crate::types::MEDIA_SIDECAR_THRESHOLD_BYTES + 1) as usize);
        let env = fixture_envelope(
            "big",
            ExportFormat::Asciicast,
            big.len() as u64,
            big,
        );
        svc.save_to_library(env).await.unwrap();
        let stored = svc.get_from_library("big").await.unwrap();
        assert!(stored.has_media_sidecar());
        assert!(stored.data.is_empty());
    }

    #[tokio::test]
    async fn metadata_only_edits_do_not_double_write_sidecar() {
        let tmp = tempdir().unwrap();
        let svc = fresh_service(tmp.path(), true).await;
        let env = fixture_envelope(
            "m1",
            ExportFormat::FrameSequence,
            1024,
            "original".to_string(),
        );
        svc.save_to_library(env).await.unwrap();
        // Rename → metadata re-save without touching the payload.
        // The sidecar file must keep its original byte count; the
        // persistor must not interpret an empty `data` as "write a
        // new empty media blob".
        svc.rename_in_library("m1", "renamed".to_string())
            .await
            .unwrap();
        let after = svc.get_from_library("m1").await.unwrap();
        assert_eq!(after.name, "renamed");
        assert!(after.has_media_sidecar());
        // Payload still round-trips intact.
        let bytes = svc.read_envelope_media(&after).await.unwrap();
        assert_eq!(bytes, b"original");
    }

    #[tokio::test]
    async fn delete_sweeps_both_metadata_and_sidecar() {
        let tmp = tempdir().unwrap();
        let svc = fresh_service(tmp.path(), true).await;
        let env = fixture_envelope(
            "d1",
            ExportFormat::FrameSequence,
            1024,
            "payload".to_string(),
        );
        svc.save_to_library(env).await.unwrap();
        // Confirm the sidecar file is actually on disk before delete.
        let sidecar_enc = tmp.path().join("recording/recordings/d1.media.enc");
        assert!(sidecar_enc.exists(), "sidecar must exist pre-delete");
        svc.delete_from_library("d1").await.unwrap();
        assert!(!sidecar_enc.exists(), "sidecar must be swept on delete");
    }

    #[tokio::test]
    async fn read_envelope_media_handles_inline_and_sidecar() {
        let tmp = tempdir().unwrap();
        let svc = fresh_service(tmp.path(), true).await;

        let inline = fixture_envelope(
            "i1",
            ExportFormat::Asciicast,
            10,
            "inline-body".to_string(),
        );
        svc.save_to_library(inline).await.unwrap();
        let i = svc.get_from_library("i1").await.unwrap();
        let i_bytes = svc.read_envelope_media(&i).await.unwrap();
        assert_eq!(i_bytes, b"inline-body");

        let sidecar = fixture_envelope(
            "s1",
            ExportFormat::FrameSequence,
            1024,
            "sidecar-body".to_string(),
        );
        svc.save_to_library(sidecar).await.unwrap();
        let s = svc.get_from_library("s1").await.unwrap();
        let s_bytes = svc.read_envelope_media(&s).await.unwrap();
        assert_eq!(s_bytes, b"sidecar-body");
    }

    #[tokio::test]
    async fn locked_state_writes_plaintext_sidecar() {
        let tmp = tempdir().unwrap();
        // Encryption state installed but never unlocked → media falls
        // back to plain `<basename>` per Phase 2b policy, mirroring
        // the metadata side.
        let svc = RecordingService::new(tmp.path().to_string_lossy().as_ref());
        svc.set_encryption_state(std::sync::Arc::new(EncryptionState::new()))
            .await;
        let env = fixture_envelope(
            "L1",
            ExportFormat::FrameSequence,
            1024,
            "locked-payload".to_string(),
        );
        svc.save_to_library(env).await.unwrap();
        let plain = tmp.path().join("recording/recordings/L1.media");
        let enc = tmp.path().join("recording/recordings/L1.media.enc");
        assert!(plain.exists());
        assert!(!enc.exists());
    }

    #[tokio::test]
    async fn legacy_envelope_without_sidecar_field_still_loads() {
        // Forward-compat: an envelope persisted before this commit
        // has no `media_blob_basename` on disk. `serde(default,
        // skip_serializing_if)` means it deserialises as `None` and
        // the load path treats it as inline-data.
        let tmp = tempdir().unwrap();
        let svc = fresh_service(tmp.path(), false).await;
        // Hand-write a legacy envelope JSON shape.
        let recordings_dir = tmp.path().join("recording/recordings");
        std::fs::create_dir_all(&recordings_dir).unwrap();
        let legacy = serde_json::json!({
            "id": "legacy",
            "name": "rec-legacy",
            "description": null,
            "protocol": "ssh",
            "saved_at": chrono::Utc::now(),
            "duration_ms": 0,
            "size_bytes": 9,
            "compression": "none",
            "format": "asciicast",
            "tags": [],
            "connection_id": null,
            "connection_name": "t",
            "host": "h",
            "data": "asciicast"
        });
        std::fs::write(
            recordings_dir.join("legacy.json"),
            serde_json::to_string_pretty(&legacy).unwrap(),
        )
        .unwrap();
        svc.init().await.unwrap();
        let loaded = svc.get_from_library("legacy").await.unwrap();
        assert!(!loaded.has_media_sidecar());
        assert_eq!(loaded.data, "asciicast");
    }
}

#[cfg(test)]
mod phase_2c_engine_e2e_tests {
    //! Phase 2c — end-to-end through the public `encode_compress_save_*`
    //! entry points. The sibling `phase_2c_split_tests` module covers
    //! the split-out via hand-built envelopes; these tests pin the
    //! engine pipeline (encode → compress → save → load) so a future
    //! refactor of the entry-point constructors can't silently regress
    //! the routing decision.
    use super::*;
    use sorng_encryption::{EncryptionState, MasterDek};
    use tempfile::tempdir;

    /// Match the helper from `phase_2c_split_tests` — duplicated so
    /// the modules don't grow a cross-module dependency.
    async fn fresh_service(root: &std::path::Path, unlocked: bool) -> RecordingService {
        let svc = RecordingService::new(root.to_string_lossy().as_ref());
        if unlocked {
            let state = EncryptionState::new();
            state
                .install(MasterDek::from_bytes(&[5u8; 32]).unwrap())
                .await;
            svc.set_encryption_state(std::sync::Arc::new(state)).await;
        }
        svc
    }

    /// Build a synthetic RDP recording with `frame_count` frames; each
    /// carries a small base64 payload so the encoded manifest stays
    /// modest. The split routing for FrameSequence is driven by the
    /// format discriminant, not the size — a handful of frames is
    /// enough to exercise the engine path.
    fn rdp_fixture(id: &str, frame_count: u64) -> RdpRecording {
        let now = chrono::Utc::now();
        let frames: Vec<RdpFrame> = (0..frame_count)
            .map(|i| RdpFrame {
                timestamp_ms: i * 33,
                width: 320,
                height: 240,
                data_b64: "AAAA".repeat(64),
                frame_index: i,
            })
            .collect();
        RdpRecording {
            metadata: RdpRecordingMetadata {
                recording_id: id.to_string(),
                session_id: format!("sess-{}", id),
                start_time: now,
                end_time: Some(now),
                host: "host.example".to_string(),
                connection_name: "conn".to_string(),
                width: 320,
                height: 240,
                fps: 30,
                duration_ms: frame_count * 33,
                frame_count,
                format: VideoFormat::PngSequence,
                size_bytes: 0,
                tags: vec![],
            },
            frames,
        }
    }

    /// Build a TerminalRecording with one entry of `size` bytes of `x`.
    /// Used both for the "stays inline" case (small size) and the
    /// "promotes via threshold" case (size large enough that the
    /// base64-encoded asciicast output exceeds the 4 MiB threshold).
    fn terminal_fixture(id: &str, payload_size: usize) -> TerminalRecording {
        let now = chrono::Utc::now();
        TerminalRecording {
            metadata: TerminalRecordingMetadata {
                recording_id: id.to_string(),
                session_id: format!("sess-{}", id),
                protocol: RecordingProtocol::Ssh,
                start_time: now,
                end_time: Some(now),
                host: "host.example".to_string(),
                username: "user".to_string(),
                cols: 80,
                rows: 24,
                duration_ms: 1000,
                entry_count: 1,
                record_input: false,
                tags: vec![],
            },
            entries: vec![TerminalRecordingEntry {
                timestamp_ms: 100,
                data: "x".repeat(payload_size),
                entry_type: TerminalEntryType::Output,
            }],
        }
    }

    #[tokio::test]
    async fn engine_screen_recording_with_frame_sequence_format_peels_into_sidecar() {
        // Exercises: RecordingService::encode_compress_save_screen
        // FrameSequence is binary-shaped — `should_use_media_sidecar`
        // returns true regardless of compressed size — so any non-empty
        // screen recording encoded via the FrameSequence path must
        // emerge from the engine with a sidecar attached.
        let tmp = tempdir().unwrap();
        let svc = fresh_service(tmp.path(), true).await;
        let rec = rdp_fixture("eng-fs", 8);

        let id = svc
            .encode_compress_save_screen(
                rec,
                "screen-rec".to_string(),
                None,
                ExportFormat::FrameSequence,
                CompressionAlgorithm::None,
                None,
                vec!["e2e".to_string()],
            )
            .await
            .unwrap();

        let env = svc.get_from_library(&id).await.unwrap();
        // Sidecar marker present, inline data cleared — invariants the
        // load path relies on to short-circuit to `read_envelope_media`.
        assert!(
            env.has_media_sidecar(),
            "FrameSequence engine save must peel into sidecar"
        );
        assert!(env.data.is_empty(), "inline data must be cleared");
        assert_eq!(env.media_blob_basename.as_deref(), Some(&*format!("{}.media", id)));

        // Disk shape: metadata + sidecar both encrypted on the unlocked
        // path. Pin both names so a future codec rename surfaces here.
        let meta = tmp
            .path()
            .join(format!("recording/recordings/{}.json.enc", id));
        let media = tmp
            .path()
            .join(format!("recording/recordings/{}.media.enc", id));
        assert!(meta.exists(), "metadata file missing at {}", meta.display());
        assert!(media.exists(), "sidecar file missing at {}", media.display());

        // Round-trip the bytes through the lazy-load helper; the
        // returned payload must be exactly the encoder+compressor
        // output the engine handed to the storage layer.
        let expected_encoded = encoders::encode_frame_sequence_manifest(&rdp_fixture("eng-fs", 8))
            .unwrap();
        let expected_b64 =
            compression::compress_to_b64(&expected_encoded, &CompressionAlgorithm::None).unwrap();
        let got = svc.read_envelope_media(&env).await.unwrap();
        assert_eq!(got, expected_b64.into_bytes(), "sidecar round-trip mismatch");
    }

    #[tokio::test]
    async fn engine_large_text_recording_promotes_to_sidecar_via_threshold() {
        // Exercises: RecordingService::encode_compress_save_terminal
        // Asciicast is text-shaped, so the only way it peels is when
        // `size_bytes > MEDIA_SIDECAR_THRESHOLD_BYTES`. We feed one
        // entry of 4 MiB `x` with `CompressionAlgorithm::None`; the
        // asciicast line is ~4 MiB + JSON quoting, base64 expands by
        // 4/3 → final compressed-base64 size comfortably > 4 MiB.
        // (`None` is critical — gzip would crush 4 MiB of repeating
        // 'x' to a few KB and the threshold branch would never fire.)
        let tmp = tempdir().unwrap();
        let svc = fresh_service(tmp.path(), true).await;
        // 4 MiB raw → ~5.59 MiB after base64; comfortably over threshold.
        let rec = terminal_fixture("eng-big", 4 * 1024 * 1024);

        let id = svc
            .encode_compress_save_terminal(
                rec,
                "big-asciicast".to_string(),
                None,
                ExportFormat::Asciicast,
                CompressionAlgorithm::None,
                None,
                vec![],
            )
            .await
            .unwrap();

        let env = svc.get_from_library(&id).await.unwrap();
        // The whole point of this test: asciicast (text-shaped) only
        // peels via the size branch, so this asserts the engine
        // pipeline propagates `size_bytes` through to the predicate.
        assert!(
            env.size_bytes > crate::types::MEDIA_SIDECAR_THRESHOLD_BYTES,
            "fixture must exceed the 4 MiB threshold; got {}",
            env.size_bytes
        );
        assert!(
            env.has_media_sidecar(),
            "asciicast over threshold must promote to sidecar"
        );
        assert!(env.data.is_empty(), "inline data must be cleared after peel");
        assert_eq!(env.media_blob_basename.as_deref(), Some(&*format!("{}.media", id)));

        let media = tmp
            .path()
            .join(format!("recording/recordings/{}.media.enc", id));
        assert!(media.exists(), "sidecar must land on disk at {}", media.display());
    }

    #[tokio::test]
    async fn engine_short_text_recording_stays_inline() {
        // Exercises: RecordingService::encode_compress_save_terminal
        // Negative case: a tiny asciicast recording must not be split.
        // This pins that the engine doesn't gratuitously peel small
        // text payloads — every short SSH session would otherwise
        // double its file count on disk.
        let tmp = tempdir().unwrap();
        let svc = fresh_service(tmp.path(), true).await;
        let rec = terminal_fixture("eng-small", 32);

        let id = svc
            .encode_compress_save_terminal(
                rec,
                "small-asciicast".to_string(),
                None,
                ExportFormat::Asciicast,
                CompressionAlgorithm::None,
                None,
                vec![],
            )
            .await
            .unwrap();

        let env = svc.get_from_library(&id).await.unwrap();
        assert!(
            !env.has_media_sidecar(),
            "small asciicast must stay inline"
        );
        assert!(env.media_blob_basename.is_none());
        assert!(
            !env.data.is_empty(),
            "inline data must survive when no sidecar is written"
        );

        // Disk confirms: no .media.enc sibling was created.
        let media = tmp
            .path()
            .join(format!("recording/recordings/{}.media.enc", id));
        assert!(
            !media.exists(),
            "no sidecar file expected for inline recording at {}",
            media.display()
        );
    }

    #[tokio::test]
    async fn engine_round_trip_through_save_then_read_envelope_media() {
        // Exercises: RecordingService::encode_compress_save_screen
        //          + RecordingService::read_envelope_media
        // The contract: whatever the encoder+compressor produced and
        // the persistor peeled into a sidecar must come back byte-for-
        // byte from `read_envelope_media`. This is the load-path
        // mirror of the persist-path assertion in test 1, but kept
        // separate to read as a single "save then read" story.
        let tmp = tempdir().unwrap();
        let svc = fresh_service(tmp.path(), true).await;
        // Build the recording once, clone before the move so we can
        // re-derive the expected encoder output without recomputing
        // the synthetic frames.
        let rec = rdp_fixture("eng-rt", 4);
        let rec_clone = rec.clone();

        let id = svc
            .encode_compress_save_screen(
                rec,
                "round-trip".to_string(),
                None,
                ExportFormat::FrameSequence,
                CompressionAlgorithm::Gzip,
                None,
                vec![],
            )
            .await
            .unwrap();

        let env = svc.get_from_library(&id).await.unwrap();
        assert!(env.has_media_sidecar(), "round-trip needs a sidecar to exercise");

        let bytes = svc.read_envelope_media(&env).await.unwrap();

        // Re-derive what the engine should have stored: encode the
        // same fixture, compress with the same algo, base64 — those
        // are the bytes the persistor peeled into the sidecar.
        let expected_encoded = encoders::encode_frame_sequence_manifest(&rec_clone).unwrap();
        let expected_b64 =
            compression::compress_to_b64(&expected_encoded, &CompressionAlgorithm::Gzip).unwrap();
        assert_eq!(
            bytes,
            expected_b64.into_bytes(),
            "read_envelope_media must round-trip the engine's encoded+compressed bytes"
        );
    }

    #[tokio::test]
    async fn engine_delete_sweeps_metadata_and_media_files() {
        // Exercises: RecordingService::encode_compress_save_screen
        //          + RecordingService::delete_from_library
        // End-to-end delete: after a sidecar-producing engine save,
        // both `<id>.json.enc` AND `<id>.media.enc` must be swept.
        // The unit-test sibling (`delete_sweeps_both_metadata_and_sidecar`)
        // already pins this against `persist_envelope` directly; this
        // version drives the real entry point so the
        // `media_blob_basename` capture inside `delete_from_library`
        // (around lines 908-912 of service.rs) is exercised on a
        // basename the engine produced, not one a test wrote by hand.
        let tmp = tempdir().unwrap();
        let svc = fresh_service(tmp.path(), true).await;
        let rec = rdp_fixture("eng-del", 4);

        let id = svc
            .encode_compress_save_screen(
                rec,
                "to-delete".to_string(),
                None,
                ExportFormat::FrameSequence,
                CompressionAlgorithm::None,
                None,
                vec![],
            )
            .await
            .unwrap();

        let meta = tmp
            .path()
            .join(format!("recording/recordings/{}.json.enc", id));
        let media = tmp
            .path()
            .join(format!("recording/recordings/{}.media.enc", id));
        assert!(meta.exists(), "metadata must exist pre-delete");
        assert!(media.exists(), "sidecar must exist pre-delete");

        svc.delete_from_library(&id).await.unwrap();

        assert!(!meta.exists(), "metadata must be swept post-delete");
        assert!(!media.exists(), "sidecar must be swept post-delete");
        assert!(
            svc.get_from_library(&id).await.is_none(),
            "in-memory cache must drop the entry too"
        );
    }
}
