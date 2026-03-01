// ── sorng-keepass / attachments ────────────────────────────────────────────────
//
// Binary attachment CRUD, pool management with deduplication, hash verification,
// and import/export of attachment data.

use sha2::{Sha256, Digest};

use super::types::*;
use super::service::{KeePassService, AttachmentData};

impl KeePassService {
    // ─── Attachment CRUD ─────────────────────────────────────────────

    /// Add an attachment to an entry (binary data as base64).
    pub fn add_attachment(
        &mut self,
        db_id: &str,
        req: AddAttachmentRequest,
    ) -> Result<KeePassAttachment, String> {
        // Decode the attachment data
        let data = base64::Engine::decode(
            &base64::engine::general_purpose::STANDARD,
            &req.data_base64,
        ).map_err(|e| format!("Invalid base64 attachment data: {}", e))?;

        // Compute hash for deduplication
        let mut hasher = Sha256::new();
        hasher.update(&data);
        let hash = hex::encode(hasher.finalize());

        let db = self.get_database_mut(db_id)?;

        // Check if entry exists
        if !db.entries.contains_key(&req.entry_uuid) {
            return Err("Entry not found".to_string());
        }

        // Check if identical attachment already exists in pool (deduplication)
        let ref_id = if let Some((existing_ref, existing_att)) = db.attachment_pool.iter_mut()
            .find(|(_, att)| att.hash == hash)
        {
            existing_att.ref_count += 1;
            existing_ref.clone()
        } else {
            // Add to pool
            let ref_id = db.next_attachment_ref_id();
            db.attachment_pool.insert(ref_id.clone(), AttachmentData {
                data: data.clone(),
                hash: hash.clone(),
                ref_count: 1,
            });
            ref_id
        };

        let attachment = KeePassAttachment {
            ref_id: ref_id.clone(),
            filename: req.filename.clone(),
            size: data.len() as u64,
            hash: hash.clone(),
            mime_type: req.mime_type.unwrap_or_else(|| Self::guess_mime_type(&req.filename)),
        };

        // Add reference to entry
        let entry = db.entries.get_mut(&req.entry_uuid)
            .ok_or("Entry not found")?;
        entry.attachments.push(EntryAttachmentRef {
            ref_id: ref_id.clone(),
            filename: req.filename,
        });

        db.mark_modified();

        Ok(attachment)
    }

    /// Get attachment metadata for an entry.
    pub fn get_entry_attachments(
        &self,
        db_id: &str,
        entry_uuid: &str,
    ) -> Result<Vec<KeePassAttachment>, String> {
        let db = self.get_database(db_id)?;
        let entry = db.entries.get(entry_uuid)
            .ok_or("Entry not found")?;

        let mut attachments = Vec::new();
        for att_ref in &entry.attachments {
            if let Some(pool_data) = db.attachment_pool.get(&att_ref.ref_id) {
                attachments.push(KeePassAttachment {
                    ref_id: att_ref.ref_id.clone(),
                    filename: att_ref.filename.clone(),
                    size: pool_data.data.len() as u64,
                    hash: pool_data.hash.clone(),
                    mime_type: Self::guess_mime_type(&att_ref.filename),
                });
            }
        }

        Ok(attachments)
    }

    /// Retrieve an attachment's binary data as base64.
    pub fn get_attachment_data(
        &self,
        db_id: &str,
        entry_uuid: &str,
        ref_id: &str,
    ) -> Result<String, String> {
        let db = self.get_database(db_id)?;

        // Verify entry has this attachment
        let entry = db.entries.get(entry_uuid)
            .ok_or("Entry not found")?;

        let _att_ref = entry.attachments.iter()
            .find(|a| a.ref_id == ref_id)
            .ok_or("Attachment reference not found on entry")?;

        // Get data from pool
        let pool_data = db.attachment_pool.get(ref_id)
            .ok_or("Attachment data not found in pool")?;

        Ok(base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            &pool_data.data,
        ))
    }

    /// Remove an attachment from an entry.
    pub fn remove_attachment(
        &mut self,
        db_id: &str,
        entry_uuid: &str,
        ref_id: &str,
    ) -> Result<(), String> {
        let db = self.get_database_mut(db_id)?;

        // Remove reference from entry
        let entry = db.entries.get_mut(entry_uuid)
            .ok_or("Entry not found")?;

        let initial_len = entry.attachments.len();
        entry.attachments.retain(|a| a.ref_id != ref_id);

        if entry.attachments.len() == initial_len {
            return Err("Attachment reference not found on entry".to_string());
        }

        // Decrement pool reference count
        let should_remove = if let Some(pool_data) = db.attachment_pool.get_mut(ref_id) {
            pool_data.ref_count = pool_data.ref_count.saturating_sub(1);
            pool_data.ref_count == 0
        } else {
            false
        };

        // Remove from pool if no more references
        if should_remove {
            db.attachment_pool.remove(ref_id);
        }

        db.mark_modified();
        Ok(())
    }

    /// Rename an attachment on an entry.
    pub fn rename_attachment(
        &mut self,
        db_id: &str,
        entry_uuid: &str,
        ref_id: &str,
        new_filename: String,
    ) -> Result<(), String> {
        if new_filename.trim().is_empty() {
            return Err("Filename cannot be empty".to_string());
        }

        let db = self.get_database_mut(db_id)?;
        let entry = db.entries.get_mut(entry_uuid)
            .ok_or("Entry not found")?;

        let att_ref = entry.attachments.iter_mut()
            .find(|a| a.ref_id == ref_id)
            .ok_or("Attachment reference not found")?;

        att_ref.filename = new_filename;
        db.mark_modified();
        Ok(())
    }

    /// Save an attachment to disk.
    pub fn save_attachment_to_file(
        &self,
        db_id: &str,
        entry_uuid: &str,
        ref_id: &str,
        output_path: &str,
    ) -> Result<u64, String> {
        let db = self.get_database(db_id)?;

        // Verify entry has this attachment
        let entry = db.entries.get(entry_uuid)
            .ok_or("Entry not found")?;

        let _att_ref = entry.attachments.iter()
            .find(|a| a.ref_id == ref_id)
            .ok_or("Attachment reference not found on entry")?;

        // Get data from pool
        let pool_data = db.attachment_pool.get(ref_id)
            .ok_or("Attachment data not found in pool")?;

        std::fs::write(output_path, &pool_data.data)
            .map_err(|e| format!("Failed to write attachment: {}", e))?;

        Ok(pool_data.data.len() as u64)
    }

    /// Import a file from disk as an attachment to an entry.
    pub fn import_attachment_from_file(
        &mut self,
        db_id: &str,
        entry_uuid: &str,
        file_path: &str,
    ) -> Result<KeePassAttachment, String> {
        let data = std::fs::read(file_path)
            .map_err(|e| format!("Cannot read file: {}", e))?;

        let filename = std::path::Path::new(file_path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("attachment")
            .to_string();

        let data_base64 = base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            &data,
        );

        self.add_attachment(db_id, AddAttachmentRequest {
            entry_uuid: entry_uuid.to_string(),
            filename,
            data_base64,
            mime_type: None,
        })
    }

    // ─── Pool Management ─────────────────────────────────────────────

    /// Get total attachment pool size in bytes for a database.
    pub fn get_attachment_pool_size(
        &self,
        db_id: &str,
    ) -> Result<(usize, u64), String> {
        let db = self.get_database(db_id)?;
        let count = db.attachment_pool.len();
        let total_bytes: u64 = db.attachment_pool.values()
            .map(|att| att.data.len() as u64)
            .sum();
        Ok((count, total_bytes))
    }

    /// Compact the attachment pool by removing unreferenced entries.
    pub fn compact_attachment_pool(
        &mut self,
        db_id: &str,
    ) -> Result<usize, String> {
        let db = self.get_database_mut(db_id)?;

        // Collect all referenced ref_ids
        let mut referenced: std::collections::HashSet<String> = std::collections::HashSet::new();
        for entry in db.entries.values() {
            for att_ref in &entry.attachments {
                referenced.insert(att_ref.ref_id.clone());
            }
        }

        // Remove unreferenced
        let before = db.attachment_pool.len();
        db.attachment_pool.retain(|ref_id, _| referenced.contains(ref_id));
        let removed = before - db.attachment_pool.len();

        if removed > 0 {
            db.mark_modified();
        }

        Ok(removed)
    }

    /// Verify integrity of all attachments in the pool.
    pub fn verify_attachment_integrity(
        &self,
        db_id: &str,
    ) -> Result<Vec<String>, String> {
        let db = self.get_database(db_id)?;
        let mut issues = Vec::new();

        // Check pool entries
        for (ref_id, att_data) in &db.attachment_pool {
            // Verify hash
            let mut hasher = Sha256::new();
            hasher.update(&att_data.data);
            let actual_hash = hex::encode(hasher.finalize());

            if actual_hash != att_data.hash {
                issues.push(format!(
                    "Attachment {} hash mismatch: expected {}, got {}",
                    ref_id, att_data.hash, actual_hash
                ));
            }
        }

        // Check for dangling references
        for entry in db.entries.values() {
            for att_ref in &entry.attachments {
                if !db.attachment_pool.contains_key(&att_ref.ref_id) {
                    issues.push(format!(
                        "Entry '{}' references missing attachment pool entry '{}'",
                        entry.title, att_ref.ref_id
                    ));
                }
            }
        }

        // Check ref counts
        let mut actual_counts: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
        for entry in db.entries.values() {
            for att_ref in &entry.attachments {
                *actual_counts.entry(att_ref.ref_id.clone()).or_default() += 1;
            }
        }

        for (ref_id, att_data) in &db.attachment_pool {
            let actual = actual_counts.get(ref_id).copied().unwrap_or(0);
            if actual != att_data.ref_count {
                issues.push(format!(
                    "Attachment {} ref_count mismatch: stored {}, actual {}",
                    ref_id, att_data.ref_count, actual
                ));
            }
        }

        Ok(issues)
    }

    // ─── MIME Type Detection ─────────────────────────────────────────

    fn guess_mime_type(filename: &str) -> String {
        let ext = filename.rsplit('.').next().unwrap_or("").to_lowercase();
        match ext.as_str() {
            "txt" => "text/plain",
            "html" | "htm" => "text/html",
            "css" => "text/css",
            "js" => "application/javascript",
            "json" => "application/json",
            "xml" => "application/xml",
            "pdf" => "application/pdf",
            "zip" => "application/zip",
            "gz" | "gzip" => "application/gzip",
            "tar" => "application/x-tar",
            "7z" => "application/x-7z-compressed",
            "rar" => "application/vnd.rar",
            "doc" => "application/msword",
            "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "xls" => "application/vnd.ms-excel",
            "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "ppt" => "application/vnd.ms-powerpoint",
            "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "gif" => "image/gif",
            "svg" => "image/svg+xml",
            "bmp" => "image/bmp",
            "ico" => "image/x-icon",
            "webp" => "image/webp",
            "mp3" => "audio/mpeg",
            "wav" => "audio/wav",
            "ogg" => "audio/ogg",
            "mp4" => "video/mp4",
            "avi" => "video/x-msvideo",
            "mkv" => "video/x-matroska",
            "webm" => "video/webm",
            "csv" => "text/csv",
            "rtf" => "application/rtf",
            "key" | "pem" | "crt" | "cer" => "application/x-pem-file",
            "p12" | "pfx" => "application/x-pkcs12",
            _ => "application/octet-stream",
        }.to_string()
    }
}
