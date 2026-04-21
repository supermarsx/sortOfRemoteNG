// ── SmbService ───────────────────────────────────────────────────────────────
//
// The stateful service held as Tauri managed state. Owns a map of
// session_id → `SmbSession` and delegates the actual I/O to the
// platform-specific `OpsBackend` implementation.
//
// Threading: all methods are `async` and internally delegate blocking
// subprocess / UNC calls to `tokio::task::spawn_blocking` inside the
// backend. The service itself holds only lightweight per-session
// metadata; no long-running I/O takes the service mutex.

use super::file_ops::{backend_name, default_backend, OpsBackend};
use super::session::SmbSession;
use super::types::*;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;

pub struct SmbService {
    sessions: HashMap<String, SmbSession>,
    backend: Box<dyn OpsBackend>,
}

impl Default for SmbService {
    fn default() -> Self {
        Self::new()
    }
}

impl SmbService {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
            backend: default_backend(),
        }
    }

    // ── Session management ─────────────────────────────────────────────

    pub async fn connect(&mut self, config: SmbConnectionConfig) -> SmbResult<SmbSessionInfo> {
        let id = Uuid::new_v4().to_string();
        let session = SmbSession::new(id.clone(), config, backend_name());
        // Probe once so bad creds surface immediately.
        self.backend.probe(&session).await?;
        let info = session.info.clone();
        self.sessions.insert(id, session);
        Ok(info)
    }

    pub async fn disconnect(&mut self, session_id: &str) -> SmbResult<()> {
        self.sessions
            .remove(session_id)
            .ok_or_else(|| SmbError::SessionNotFound(session_id.to_string()))?;
        Ok(())
    }

    pub async fn disconnect_all(&mut self) -> SmbResult<()> {
        self.sessions.clear();
        Ok(())
    }

    pub async fn list_sessions(&self) -> Vec<SmbSessionInfo> {
        self.sessions.values().map(|s| s.info.clone()).collect()
    }

    pub async fn get_session_info(&self, session_id: &str) -> SmbResult<SmbSessionInfo> {
        self.sessions
            .get(session_id)
            .map(|s| s.info.clone())
            .ok_or_else(|| SmbError::SessionNotFound(session_id.to_string()))
    }

    // ── Share enumeration ──────────────────────────────────────────────

    pub async fn list_shares(&mut self, session_id: &str) -> SmbResult<Vec<SmbShareInfo>> {
        let session = self.session_cloned(session_id)?;
        let shares = self.backend.list_shares(&session).await?;
        self.touch(session_id);
        Ok(shares)
    }

    // ── Directory / file ops ───────────────────────────────────────────

    pub async fn list_directory(
        &mut self,
        session_id: &str,
        share: &str,
        path: &str,
    ) -> SmbResult<Vec<SmbDirEntry>> {
        let session = self.session_cloned(session_id)?;
        let res = self.backend.list_dir(&session, share, path).await?;
        self.touch(session_id);
        Ok(res)
    }

    pub async fn stat(
        &mut self,
        session_id: &str,
        share: &str,
        path: &str,
    ) -> SmbResult<SmbStat> {
        let session = self.session_cloned(session_id)?;
        let res = self.backend.stat(&session, share, path).await?;
        self.touch(session_id);
        Ok(res)
    }

    pub async fn read_file(
        &mut self,
        session_id: &str,
        share: &str,
        path: &str,
        max_bytes: Option<u64>,
    ) -> SmbResult<SmbReadResult> {
        let session = self.session_cloned(session_id)?;
        let res = self.backend.read_file(&session, share, path, max_bytes).await?;
        self.touch(session_id);
        Ok(res)
    }

    pub async fn write_file(
        &mut self,
        session_id: &str,
        share: &str,
        path: &str,
        content_b64: &str,
        overwrite: bool,
    ) -> SmbResult<SmbWriteResult> {
        let session = self.session_cloned(session_id)?;
        let res = self
            .backend
            .write_file(&session, share, path, content_b64, overwrite)
            .await?;
        self.touch(session_id);
        Ok(res)
    }

    pub async fn download_file(
        &mut self,
        session_id: &str,
        share: &str,
        remote_path: &str,
        local_path: &str,
    ) -> SmbResult<SmbTransferResult> {
        let session = self.session_cloned(session_id)?;
        let res = self
            .backend
            .download_file(&session, share, remote_path, local_path)
            .await?;
        self.touch(session_id);
        Ok(res)
    }

    pub async fn upload_file(
        &mut self,
        session_id: &str,
        share: &str,
        local_path: &str,
        remote_path: &str,
    ) -> SmbResult<SmbTransferResult> {
        let session = self.session_cloned(session_id)?;
        let res = self
            .backend
            .upload_file(&session, share, local_path, remote_path)
            .await?;
        self.touch(session_id);
        Ok(res)
    }

    pub async fn mkdir(
        &mut self,
        session_id: &str,
        share: &str,
        path: &str,
    ) -> SmbResult<()> {
        let session = self.session_cloned(session_id)?;
        self.backend.mkdir(&session, share, path).await?;
        self.touch(session_id);
        Ok(())
    }

    pub async fn rmdir(
        &mut self,
        session_id: &str,
        share: &str,
        path: &str,
        recursive: bool,
    ) -> SmbResult<()> {
        let session = self.session_cloned(session_id)?;
        self.backend.rmdir(&session, share, path, recursive).await?;
        self.touch(session_id);
        Ok(())
    }

    pub async fn delete_file(
        &mut self,
        session_id: &str,
        share: &str,
        path: &str,
    ) -> SmbResult<()> {
        let session = self.session_cloned(session_id)?;
        self.backend.delete_file(&session, share, path).await?;
        self.touch(session_id);
        Ok(())
    }

    pub async fn rename(
        &mut self,
        session_id: &str,
        share: &str,
        from: &str,
        to: &str,
    ) -> SmbResult<()> {
        let session = self.session_cloned(session_id)?;
        self.backend.rename(&session, share, from, to).await?;
        self.touch(session_id);
        Ok(())
    }

    // ── helpers ────────────────────────────────────────────────────────

    fn session_cloned(&self, session_id: &str) -> SmbResult<SmbSession> {
        self.sessions
            .get(session_id)
            .cloned()
            .ok_or_else(|| SmbError::SessionNotFound(session_id.to_string()))
    }

    fn touch(&mut self, session_id: &str) {
        if let Some(s) = self.sessions.get_mut(session_id) {
            s.touch();
        }
    }
}

/// Tauri managed-state alias. The frontend sees this via
/// `state: tauri::State<'_, SmbServiceState>` in command handlers.
pub type SmbServiceState = Arc<Mutex<SmbService>>;

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn service_starts_empty() {
        let svc = SmbService::new();
        assert!(svc.list_sessions().await.is_empty());
    }

    #[tokio::test]
    async fn get_session_missing_errors() {
        let svc = SmbService::new();
        assert!(svc.get_session_info("nope").await.is_err());
    }
}
