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
        }
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
    /// encryption state is installed; otherwise fall back to the legacy
    /// plaintext path. Centralised so individual call-sites stay short.
    async fn persist_envelope(
        &self,
        root: PathBuf,
        envelope: SavedRecordingEnvelope,
    ) -> RecordingResult<()> {
        if let Some(enc) = self.enc_handle().await {
            storage::save_envelope_dispatched(&root, &envelope, &enc).await
        } else {
            tokio::task::spawn_blocking(move || storage::save_envelope(&root, &envelope))
                .await
                .map_err(|e| RecordingError::Internal(e.to_string()))?
        }
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
        let enc = self
            .enc_handle()
            .await
            .ok_or_else(|| RecordingError::StorageError(
                "encryption state not installed; cannot migrate".into(),
            ))?;
        let root = self.storage_root.lock().await.clone();
        let (em, es) = storage::migrate_all_envelopes_to_encrypted(&root, &enc).await?;
        let (mm, ms) = storage::migrate_all_macros_to_encrypted(&root, &enc).await?;
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
        {
            let mut eng = self.engine.lock().await;
            eng.save_to_library(envelope.clone());
        }
        self.persist_envelope(root, envelope).await
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
        let envelope = self.engine.lock().await.get_from_library(id);
        if let Some(env) = envelope {
            self.persist_envelope(root, env).await?;
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
            self.persist_envelope(root, env).await?;
        }
        Ok(())
    }

    pub async fn delete_from_library(&self, id: &str) -> RecordingResult<()> {
        let root = self.storage_root.lock().await.clone();
        {
            let mut eng = self.engine.lock().await;
            eng.delete_from_library(id)?;
        }
        // Delete both variants for safety during the migration window.
        let id_owned = id.to_string();
        tokio::task::spawn_blocking(move || storage::delete_envelope_all_variants(&root, &id_owned))
            .await
            .map_err(|e| RecordingError::Internal(e.to_string()))?
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
