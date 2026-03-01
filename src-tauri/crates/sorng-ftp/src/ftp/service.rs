//! High-level orchestrator — owns sessions, pool, queue, bookmarks.
//! Exposes the methods that `commands.rs` delegates to.

use crate::ftp::client::FtpClient;
use crate::ftp::pool::FtpPool;
use crate::ftp::queue::TransferQueue;
use crate::ftp::types::*;
use log::info;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Thread-safe state managed by Tauri.
pub type FtpServiceState = Arc<Mutex<FtpService>>;

pub struct FtpService {
    pub pool: FtpPool,
    pub queue: TransferQueue,
    pub bookmarks: Vec<FtpBookmark>,
}

impl FtpService {
    /// Create a new service wrapped in `Arc<Mutex<_>>` for Tauri state.
    pub fn new() -> FtpServiceState {
        Arc::new(Mutex::new(FtpService {
            pool: FtpPool::new(),
            queue: TransferQueue::new(TransferQueueConfig::default()),
            bookmarks: Vec::new(),
        }))
    }

    // ─── Connection lifecycle ────────────────────────────────────

    /// Connect a new FTP session and add it to the pool.
    pub async fn connect(&mut self, config: FtpConnectionConfig) -> Result<FtpSessionInfo, String> {
        info!("FTP connecting to {}:{}", config.host, config.port);
        let client = FtpClient::connect(config)
            .await
            .map_err(|e| e.to_string())?;
        let info = client.info.clone();
        self.pool
            .insert(client)
            .map_err(|e| e.to_string())?;
        Ok(info)
    }

    /// Disconnect a session.
    pub async fn disconnect(&mut self, session_id: &str) -> Result<(), String> {
        if let Some(mut client) = self.pool.remove(session_id) {
            client.quit().await.map_err(|e| e.to_string())?;
            info!("FTP session {} disconnected", session_id);
            Ok(())
        } else {
            Err(format!("Session {} not found", session_id))
        }
    }

    /// Disconnect all sessions.
    pub async fn disconnect_all(&mut self) -> Result<(), String> {
        self.pool.disconnect_all().await;
        Ok(())
    }

    /// Get session info.
    pub async fn get_session_info(&self, session_id: &str) -> Result<FtpSessionInfo, String> {
        let client = self.pool.get(session_id).map_err(|e| e.to_string())?;
        Ok(client.info.clone())
    }

    /// List all sessions.
    pub async fn list_sessions(&self) -> Vec<FtpSessionInfo> {
        self.pool.list_sessions()
    }

    /// Send NOOP to keep alive.
    pub async fn ping(&mut self, session_id: &str) -> Result<bool, String> {
        let client = self.pool.get_mut(session_id).map_err(|e| e.to_string())?;
        match client.noop().await {
            Ok(()) => Ok(true),
            Err(_) => Ok(false),
        }
    }

    // ─── Directory operations ────────────────────────────────────

    /// List directory contents.
    pub async fn list_directory(
        &mut self,
        session_id: &str,
        path: Option<&str>,
        options: Option<ListOptions>,
    ) -> Result<Vec<FtpEntry>, String> {
        let client = self.pool.get_mut(session_id).map_err(|e| e.to_string())?;
        let opts = options.unwrap_or_default();
        let mut entries = client
            .list(path, opts.prefer_mlsd)
            .await
            .map_err(|e| e.to_string())?;

        // Apply filter
        if let Some(ref filter) = opts.filter {
            let pattern = glob::Pattern::new(filter).map_err(|e| e.to_string())?;
            entries.retain(|e| pattern.matches(&e.name));
        }

        // Apply show_hidden
        if !opts.show_hidden {
            entries.retain(|e| !e.name.starts_with('.'));
        }

        // Apply sort
        if let Some(ref sort_by) = opts.sort_by {
            match sort_by {
                FtpSortField::Name => entries.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase())),
                FtpSortField::Size => entries.sort_by(|a, b| a.size.cmp(&b.size)),
                FtpSortField::Modified => entries.sort_by(|a, b| a.modified.cmp(&b.modified)),
                FtpSortField::Kind => entries.sort_by(|a, b| {
                    format!("{:?}", a.kind).cmp(&format!("{:?}", b.kind))
                }),
            }
        }

        if opts.sort_order == Some(FtpSortOrder::Desc) {
            entries.reverse();
        }

        Ok(entries)
    }

    /// Change working directory.
    pub async fn set_directory(
        &mut self,
        session_id: &str,
        path: &str,
    ) -> Result<String, String> {
        let client = self.pool.get_mut(session_id).map_err(|e| e.to_string())?;
        client.cwd(path).await.map_err(|e| e.to_string())
    }

    /// Get current directory.
    pub async fn get_current_directory(
        &mut self,
        session_id: &str,
    ) -> Result<String, String> {
        let client = self.pool.get_mut(session_id).map_err(|e| e.to_string())?;
        Ok(client.info.current_directory.clone())
    }

    /// Create a directory.
    pub async fn mkdir(&mut self, session_id: &str, path: &str) -> Result<String, String> {
        let client = self.pool.get_mut(session_id).map_err(|e| e.to_string())?;
        client.mkdir(path).await.map_err(|e| e.to_string())
    }

    /// Create directories recursively.
    pub async fn mkdir_all(&mut self, session_id: &str, path: &str) -> Result<(), String> {
        let client = self.pool.get_mut(session_id).map_err(|e| e.to_string())?;
        client.mkdir_all(path).await.map_err(|e| e.to_string())
    }

    /// Remove an empty directory.
    pub async fn rmdir(&mut self, session_id: &str, path: &str) -> Result<(), String> {
        let client = self.pool.get_mut(session_id).map_err(|e| e.to_string())?;
        client.rmdir(path).await.map_err(|e| e.to_string())
    }

    /// Remove a directory recursively.
    pub async fn rmdir_recursive(
        &mut self,
        session_id: &str,
        path: &str,
    ) -> Result<(), String> {
        let client = self.pool.get_mut(session_id).map_err(|e| e.to_string())?;
        client
            .rmdir_recursive(path)
            .await
            .map_err(|e| e.to_string())
    }

    /// Rename a file or directory.
    pub async fn rename(
        &mut self,
        session_id: &str,
        from: &str,
        to: &str,
    ) -> Result<(), String> {
        let client = self.pool.get_mut(session_id).map_err(|e| e.to_string())?;
        client.rename(from, to).await.map_err(|e| e.to_string())
    }

    /// Delete a remote file.
    pub async fn delete_file(
        &mut self,
        session_id: &str,
        path: &str,
    ) -> Result<(), String> {
        let client = self.pool.get_mut(session_id).map_err(|e| e.to_string())?;
        client.delete(path).await.map_err(|e| e.to_string())
    }

    /// Set file permissions (SITE CHMOD).
    pub async fn chmod(
        &mut self,
        session_id: &str,
        path: &str,
        mode: &str,
    ) -> Result<(), String> {
        let client = self.pool.get_mut(session_id).map_err(|e| e.to_string())?;
        client.chmod(path, mode).await.map_err(|e| e.to_string())
    }

    // ─── File info ───────────────────────────────────────────────

    /// Get file size (SIZE).
    pub async fn get_file_size(
        &mut self,
        session_id: &str,
        path: &str,
    ) -> Result<u64, String> {
        let client = self.pool.get_mut(session_id).map_err(|e| e.to_string())?;
        client.size(path).await.map_err(|e| e.to_string())
    }

    /// Get file modification time (MDTM).
    pub async fn get_modified_time(
        &mut self,
        session_id: &str,
        path: &str,
    ) -> Result<String, String> {
        let client = self.pool.get_mut(session_id).map_err(|e| e.to_string())?;
        client.mdtm(path).await.map_err(|e| e.to_string())
    }

    /// Get MLST entry info.
    pub async fn stat_entry(
        &mut self,
        session_id: &str,
        path: &str,
    ) -> Result<FtpEntry, String> {
        let client = self.pool.get_mut(session_id).map_err(|e| e.to_string())?;
        client.stat_entry(path).await.map_err(|e| e.to_string())
    }

    // ─── Transfers ───────────────────────────────────────────────

    /// Upload a file.
    pub async fn upload(
        &mut self,
        session_id: &str,
        local_path: &str,
        remote_path: &str,
    ) -> Result<u64, String> {
        let client = self.pool.get_mut(session_id).map_err(|e| e.to_string())?;
        client
            .upload(local_path, remote_path, None)
            .await
            .map_err(|e| e.to_string())
    }

    /// Download a file.
    pub async fn download(
        &mut self,
        session_id: &str,
        remote_path: &str,
        local_path: &str,
    ) -> Result<u64, String> {
        let client = self.pool.get_mut(session_id).map_err(|e| e.to_string())?;
        client
            .download(remote_path, local_path, None)
            .await
            .map_err(|e| e.to_string())
    }

    /// Append to a remote file.
    pub async fn append(
        &mut self,
        session_id: &str,
        local_path: &str,
        remote_path: &str,
    ) -> Result<u64, String> {
        let client = self.pool.get_mut(session_id).map_err(|e| e.to_string())?;
        client
            .append(local_path, remote_path, None)
            .await
            .map_err(|e| e.to_string())
    }

    /// Resume upload.
    pub async fn resume_upload(
        &mut self,
        session_id: &str,
        local_path: &str,
        remote_path: &str,
    ) -> Result<u64, String> {
        let client = self.pool.get_mut(session_id).map_err(|e| e.to_string())?;
        client
            .resume_upload(local_path, remote_path, None)
            .await
            .map_err(|e| e.to_string())
    }

    /// Resume download.
    pub async fn resume_download(
        &mut self,
        session_id: &str,
        remote_path: &str,
        local_path: &str,
    ) -> Result<u64, String> {
        let client = self.pool.get_mut(session_id).map_err(|e| e.to_string())?;
        client
            .resume_download(remote_path, local_path, None)
            .await
            .map_err(|e| e.to_string())
    }

    // ─── Transfer queue ──────────────────────────────────────────

    /// Enqueue a transfer.
    pub fn enqueue_transfer(
        &mut self,
        session_id: &str,
        direction: TransferDirection,
        local_path: &str,
        remote_path: &str,
    ) -> String {
        self.queue
            .enqueue(session_id, direction, local_path, remote_path)
    }

    /// Cancel a queued transfer.
    pub fn cancel_transfer(&mut self, transfer_id: &str) -> Result<(), String> {
        self.queue
            .cancel(transfer_id)
            .map_err(|e| e.to_string())
    }

    /// List all transfers.
    pub fn list_transfers(&self) -> Vec<TransferItem> {
        self.queue.list().into_iter().cloned().collect()
    }

    /// Get transfer progress.
    pub fn get_transfer_progress(&self, transfer_id: &str) -> Option<TransferProgress> {
        self.queue.get_progress(transfer_id)
    }

    /// Get all active progress.
    pub fn get_all_progress(&self) -> Vec<TransferProgress> {
        self.queue.all_progress()
    }

    // ─── Diagnostics ─────────────────────────────────────────────

    /// Get diagnostics for a session.
    pub fn get_diagnostics(&self, session_id: &str) -> Result<FtpDiagnostics, String> {
        let client = self.pool.get(session_id).map_err(|e| e.to_string())?;
        Ok(client.diagnostics())
    }

    /// Pool statistics.
    pub fn get_pool_stats(&self) -> PoolStats {
        self.pool.stats()
    }

    // ─── Bookmarks ───────────────────────────────────────────────

    /// List all bookmarks.
    pub fn list_bookmarks(&self) -> Vec<FtpBookmark> {
        self.bookmarks.clone()
    }

    /// Add a bookmark.
    pub fn add_bookmark(&mut self, bookmark: FtpBookmark) -> String {
        let id = bookmark.id.clone();
        self.bookmarks.push(bookmark);
        id
    }

    /// Remove a bookmark.
    pub fn remove_bookmark(&mut self, bookmark_id: &str) -> Result<(), String> {
        let len_before = self.bookmarks.len();
        self.bookmarks.retain(|b| b.id != bookmark_id);
        if self.bookmarks.len() == len_before {
            Err(format!("Bookmark {} not found", bookmark_id))
        } else {
            Ok(())
        }
    }

    /// Update a bookmark.
    pub fn update_bookmark(&mut self, bookmark: FtpBookmark) -> Result<(), String> {
        if let Some(b) = self.bookmarks.iter_mut().find(|b| b.id == bookmark.id) {
            *b = bookmark;
            Ok(())
        } else {
            Err(format!("Bookmark {} not found", bookmark.id))
        }
    }

    // ─── SITE command ────────────────────────────────────────────

    /// Execute a raw SITE command.
    pub async fn site_command(
        &mut self,
        session_id: &str,
        args: &str,
    ) -> Result<String, String> {
        let client = self.pool.get_mut(session_id).map_err(|e| e.to_string())?;
        let resp = client.site(args).await.map_err(|e| e.to_string())?;
        Ok(resp.text())
    }

    // ─── Raw command ─────────────────────────────────────────────

    /// Execute a raw FTP command (for advanced users / debugging).
    pub async fn raw_command(
        &mut self,
        session_id: &str,
        command: &str,
    ) -> Result<FtpResponse, String> {
        let client = self.pool.get_mut(session_id).map_err(|e| e.to_string())?;
        client
            .codec
            .execute(command)
            .await
            .map_err(|e| e.to_string())
    }
}
