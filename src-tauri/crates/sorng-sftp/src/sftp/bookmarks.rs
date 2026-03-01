// ── Bookmark / favourite-path management ─────────────────────────────────────

use crate::sftp::service::SftpService;
use crate::sftp::types::*;
use chrono::Utc;
use log::info;
use uuid::Uuid;

impl SftpService {
    /// Add a new bookmark.
    pub async fn bookmark_add(&mut self, mut bookmark: SftpBookmark) -> Result<String, String> {
        if bookmark.id.is_empty() {
            bookmark.id = Uuid::new_v4().to_string();
        }
        bookmark.created_at = Utc::now();
        let id = bookmark.id.clone();
        self.bookmarks.push(bookmark);
        info!("SFTP bookmark added: {}", id);
        Ok(id)
    }

    /// Remove a bookmark by ID.
    pub async fn bookmark_remove(&mut self, bookmark_id: &str) -> Result<(), String> {
        let idx = self
            .bookmarks
            .iter()
            .position(|b| b.id == bookmark_id)
            .ok_or_else(|| format!("Bookmark '{}' not found", bookmark_id))?;
        self.bookmarks.remove(idx);
        Ok(())
    }

    /// Update an existing bookmark.
    pub async fn bookmark_update(&mut self, updated: SftpBookmark) -> Result<(), String> {
        let existing = self
            .bookmarks
            .iter_mut()
            .find(|b| b.id == updated.id)
            .ok_or_else(|| format!("Bookmark '{}' not found", updated.id))?;

        existing.label = updated.label;
        existing.host = updated.host;
        existing.port = updated.port;
        existing.username = updated.username;
        existing.remote_path = updated.remote_path;
        existing.local_path = updated.local_path;
        existing.color_tag = updated.color_tag;
        existing.group = updated.group;
        Ok(())
    }

    /// List all bookmarks, optionally filtered by group.
    pub async fn bookmark_list(&self, group: Option<String>) -> Vec<SftpBookmark> {
        match group {
            Some(g) => self
                .bookmarks
                .iter()
                .filter(|b| b.group.as_deref() == Some(&g))
                .cloned()
                .collect(),
            None => self.bookmarks.clone(),
        }
    }

    /// Record a bookmark usage (increment counter + update timestamp).
    pub async fn bookmark_touch(&mut self, bookmark_id: &str) -> Result<(), String> {
        let bm = self
            .bookmarks
            .iter_mut()
            .find(|b| b.id == bookmark_id)
            .ok_or_else(|| format!("Bookmark '{}' not found", bookmark_id))?;
        bm.use_count += 1;
        bm.last_used = Some(Utc::now());
        Ok(())
    }

    /// Import bookmarks from a JSON string (merge, skip duplicates by host+path).
    pub async fn bookmark_import(&mut self, json: &str) -> Result<usize, String> {
        let incoming: Vec<SftpBookmark> =
            serde_json::from_str(json).map_err(|e| format!("Invalid bookmark JSON: {}", e))?;

        let mut added = 0;
        for mut bm in incoming {
            let dupe = self.bookmarks.iter().any(|existing| {
                existing.host == bm.host
                    && existing.port == bm.port
                    && existing.username == bm.username
                    && existing.remote_path == bm.remote_path
            });
            if !dupe {
                if bm.id.is_empty() {
                    bm.id = Uuid::new_v4().to_string();
                }
                self.bookmarks.push(bm);
                added += 1;
            }
        }
        Ok(added)
    }

    /// Export all bookmarks as a JSON string.
    pub async fn bookmark_export(&self) -> Result<String, String> {
        serde_json::to_string_pretty(&self.bookmarks)
            .map_err(|e| format!("Serialisation error: {}", e))
    }
}
