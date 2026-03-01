//! File transfer over PowerShell Remoting.
//!
//! Implements Copy-Item -ToSession and -FromSession semantics for
//! file and directory transfer through the PS Remoting channel.

use crate::session::PsSessionManager;
use crate::types::*;
use chrono::Utc;
use log::{debug, info, warn};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;

// ─── File Transfer Manager ───────────────────────────────────────────────────

/// Manages file transfers over PowerShell Remoting sessions.
pub struct PsFileTransferManager {
    /// Active transfers by transfer ID
    transfers: HashMap<String, PsFileTransferProgress>,
}

impl PsFileTransferManager {
    pub fn new() -> Self {
        Self {
            transfers: HashMap::new(),
        }
    }

    /// Copy a file or directory to a remote session (Copy-Item -ToSession).
    pub async fn copy_to_session(
        &mut self,
        manager: &PsSessionManager,
        params: &PsFileCopyParams,
    ) -> Result<PsFileTransferProgress, String> {
        let transfer_id = Uuid::new_v4().to_string();
        let session = manager.get_session(&params.session_id)?;

        if session.state != PsSessionState::Opened {
            return Err("Session is not in Opened state".to_string());
        }

        info!(
            "Starting file transfer {} -> {} (session: {})",
            params.local_path, params.remote_path, params.session_id
        );

        // Read the local file
        let file_data = tokio::fs::read(&params.local_path)
            .await
            .map_err(|e| format!("Failed to read local file '{}': {}", params.local_path, e))?;

        let total_bytes = file_data.len() as u64;

        // Initialize progress
        let mut progress = PsFileTransferProgress {
            transfer_id: transfer_id.clone(),
            session_id: params.session_id.clone(),
            direction: PsFileCopyDirection::ToSession,
            source_path: params.local_path.clone(),
            destination_path: params.remote_path.clone(),
            total_bytes,
            transferred_bytes: 0,
            percent_complete: 0.0,
            bytes_per_second: 0.0,
            started_at: Utc::now(),
            estimated_completion: None,
            state: PsTransferState::Transferring,
            current_file: Some(params.local_path.clone()),
            files_total: 1,
            files_transferred: 0,
        };

        self.transfers.insert(transfer_id.clone(), progress.clone());

        // Transfer in chunks using PowerShell script
        let chunk_size = params.chunk_size;
        let remote_path_escaped = params.remote_path.replace('\'', "''");
        let transport = manager.get_transport(&params.session_id)?;
        let shell_id = manager.get_shell_id(&params.session_id)?;

        // Create/clear the target file
        let init_script = format!(
            "if (Test-Path '{}') {{ Remove-Item '{}' -Force }}; New-Item -ItemType File -Path '{}' -Force | Out-Null",
            remote_path_escaped, remote_path_escaped, remote_path_escaped
        );

        {
            let mut t = transport.lock().await;
            let cmd_id = t.execute_ps_command(&shell_id, &init_script).await?;
            let _ = t.receive_all_output(&shell_id, &cmd_id).await?;
            let _ = t
                .signal_command(&shell_id, &cmd_id, WsManSignal::TERMINATE)
                .await;
        }

        let start_time = std::time::Instant::now();

        // Send chunks
        for (chunk_idx, chunk) in file_data.chunks(chunk_size).enumerate() {
            let encoded = base64::Engine::encode(
                &base64::engine::general_purpose::STANDARD,
                chunk,
            );

            let append_script = format!(
                "$bytes = [System.Convert]::FromBase64String('{}'); \
                 [System.IO.File]::AppendAllBytes('{}', $bytes)",
                encoded, remote_path_escaped
            );

            {
                let mut t = transport.lock().await;
                let cmd_id = t.execute_ps_command(&shell_id, &append_script).await?;
                let (_, stderr) = t.receive_all_output(&shell_id, &cmd_id).await?;
                let _ = t
                    .signal_command(&shell_id, &cmd_id, WsManSignal::TERMINATE)
                    .await;

                if !stderr.trim().is_empty() {
                    warn!("File transfer chunk {} error: {}", chunk_idx, stderr.trim());
                }
            }

            // Update progress
            let transferred = ((chunk_idx + 1) * chunk_size).min(total_bytes as usize) as u64;
            let elapsed = start_time.elapsed().as_secs_f64();
            let bps = if elapsed > 0.0 {
                transferred as f64 / elapsed
            } else {
                0.0
            };

            if let Some(p) = self.transfers.get_mut(&transfer_id) {
                p.transferred_bytes = transferred;
                p.percent_complete = (transferred as f64 / total_bytes as f64) * 100.0;
                p.bytes_per_second = bps;
                if bps > 0.0 {
                    let remaining_bytes = total_bytes - transferred;
                    let remaining_secs = remaining_bytes as f64 / bps;
                    p.estimated_completion = Some(
                        Utc::now()
                            + chrono::Duration::seconds(remaining_secs as i64),
                    );
                }
            }
        }

        // Verify the transfer
        let verify_script = format!(
            "(Get-Item '{}').Length",
            remote_path_escaped
        );
        let remote_size = {
            let mut t = transport.lock().await;
            let cmd_id = t.execute_ps_command(&shell_id, &verify_script).await?;
            let (stdout, _) = t.receive_all_output(&shell_id, &cmd_id).await?;
            let _ = t
                .signal_command(&shell_id, &cmd_id, WsManSignal::TERMINATE)
                .await;
            stdout.trim().parse::<u64>().unwrap_or(0)
        };

        if remote_size != total_bytes {
            warn!(
                "File size mismatch: local={} remote={}",
                total_bytes, remote_size
            );
        }

        // Finalize progress
        if let Some(p) = self.transfers.get_mut(&transfer_id) {
            p.state = PsTransferState::Completed;
            p.transferred_bytes = total_bytes;
            p.percent_complete = 100.0;
            p.files_transferred = 1;
        }

        let final_progress = self.transfers.get(&transfer_id).cloned().unwrap();
        info!(
            "File transfer {} completed: {} -> {} ({} bytes in {:.1}s)",
            transfer_id,
            params.local_path,
            params.remote_path,
            total_bytes,
            start_time.elapsed().as_secs_f64()
        );

        Ok(final_progress)
    }

    /// Copy a file or directory from a remote session (Copy-Item -FromSession).
    pub async fn copy_from_session(
        &mut self,
        manager: &PsSessionManager,
        params: &PsFileCopyParams,
    ) -> Result<PsFileTransferProgress, String> {
        let transfer_id = Uuid::new_v4().to_string();
        let session = manager.get_session(&params.session_id)?;

        if session.state != PsSessionState::Opened {
            return Err("Session is not in Opened state".to_string());
        }

        info!(
            "Starting file download {} <- {} (session: {})",
            params.local_path, params.remote_path, params.session_id
        );

        let transport = manager.get_transport(&params.session_id)?;
        let shell_id = manager.get_shell_id(&params.session_id)?;
        let remote_path_escaped = params.remote_path.replace('\'', "''");

        // Get remote file size
        let size_script = format!(
            "(Get-Item '{}' -ErrorAction Stop).Length",
            remote_path_escaped
        );
        let total_bytes = {
            let mut t = transport.lock().await;
            let cmd_id = t.execute_ps_command(&shell_id, &size_script).await?;
            let (stdout, stderr) = t.receive_all_output(&shell_id, &cmd_id).await?;
            let _ = t
                .signal_command(&shell_id, &cmd_id, WsManSignal::TERMINATE)
                .await;

            if !stderr.trim().is_empty() {
                return Err(format!(
                    "Failed to get remote file size: {}",
                    stderr.trim()
                ));
            }
            stdout
                .trim()
                .parse::<u64>()
                .map_err(|_| "Failed to parse remote file size".to_string())?
        };

        // Initialize progress
        let mut progress = PsFileTransferProgress {
            transfer_id: transfer_id.clone(),
            session_id: params.session_id.clone(),
            direction: PsFileCopyDirection::FromSession,
            source_path: params.remote_path.clone(),
            destination_path: params.local_path.clone(),
            total_bytes,
            transferred_bytes: 0,
            percent_complete: 0.0,
            bytes_per_second: 0.0,
            started_at: Utc::now(),
            estimated_completion: None,
            state: PsTransferState::Transferring,
            current_file: Some(params.remote_path.clone()),
            files_total: 1,
            files_transferred: 0,
        };
        self.transfers.insert(transfer_id.clone(), progress.clone());

        let start_time = std::time::Instant::now();
        let chunk_size = params.chunk_size;
        let mut file_data = Vec::with_capacity(total_bytes as usize);
        let mut offset: u64 = 0;

        // Download in chunks
        while offset < total_bytes {
            let read_len = chunk_size.min((total_bytes - offset) as usize);

            let read_script = format!(
                "$bytes = [System.IO.File]::ReadAllBytes('{}')[{}..{}]; [System.Convert]::ToBase64String($bytes)",
                remote_path_escaped,
                offset,
                offset + read_len as u64 - 1
            );

            let chunk_data = {
                let mut t = transport.lock().await;
                let cmd_id = t.execute_ps_command(&shell_id, &read_script).await?;
                let (stdout, stderr) = t.receive_all_output(&shell_id, &cmd_id).await?;
                let _ = t
                    .signal_command(&shell_id, &cmd_id, WsManSignal::TERMINATE)
                    .await;

                if !stderr.trim().is_empty() {
                    warn!("Download chunk error at offset {}: {}", offset, stderr.trim());
                }

                base64::Engine::decode(
                    &base64::engine::general_purpose::STANDARD,
                    stdout.trim(),
                )
                .map_err(|e| format!("Failed to decode chunk at offset {}: {}", offset, e))?
            };

            file_data.extend_from_slice(&chunk_data);
            offset += chunk_data.len() as u64;

            // Update progress
            let elapsed = start_time.elapsed().as_secs_f64();
            let bps = if elapsed > 0.0 {
                offset as f64 / elapsed
            } else {
                0.0
            };

            if let Some(p) = self.transfers.get_mut(&transfer_id) {
                p.transferred_bytes = offset;
                p.percent_complete = (offset as f64 / total_bytes as f64) * 100.0;
                p.bytes_per_second = bps;
            }
        }

        // Write local file
        tokio::fs::write(&params.local_path, &file_data)
            .await
            .map_err(|e| format!("Failed to write local file '{}': {}", params.local_path, e))?;

        // Finalize
        if let Some(p) = self.transfers.get_mut(&transfer_id) {
            p.state = PsTransferState::Completed;
            p.percent_complete = 100.0;
            p.files_transferred = 1;
        }

        let final_progress = self.transfers.get(&transfer_id).cloned().unwrap();
        info!(
            "File download {} completed: {} <- {} ({} bytes in {:.1}s)",
            transfer_id,
            params.local_path,
            params.remote_path,
            total_bytes,
            start_time.elapsed().as_secs_f64()
        );

        Ok(final_progress)
    }

    /// Cancel an active transfer.
    pub fn cancel_transfer(&mut self, transfer_id: &str) -> Result<(), String> {
        if let Some(progress) = self.transfers.get_mut(transfer_id) {
            progress.state = PsTransferState::Cancelled;
            info!("File transfer {} cancelled", transfer_id);
            Ok(())
        } else {
            Err(format!("Transfer '{}' not found", transfer_id))
        }
    }

    /// Get transfer progress.
    pub fn get_progress(&self, transfer_id: &str) -> Option<PsFileTransferProgress> {
        self.transfers.get(transfer_id).cloned()
    }

    /// List all transfers.
    pub fn list_transfers(&self) -> Vec<PsFileTransferProgress> {
        self.transfers.values().cloned().collect()
    }

    /// Clean up completed/cancelled transfers.
    pub fn cleanup(&mut self) {
        self.transfers.retain(|_, p| {
            p.state == PsTransferState::Pending || p.state == PsTransferState::Transferring
        });
    }
}
