//! File transfer over PowerShell Remoting.
//!
//! Implements Copy-Item -ToSession and -FromSession semantics for
//! file and directory transfer through the PS Remoting channel.

use crate::session::PsSessionManager;
use crate::transport::WinRmTransport;
use crate::types::*;
use chrono::Utc;
use log::info;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs::Metadata;
use std::path::Path;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::Mutex;
use uuid::Uuid;
use zeroize::Zeroizing;

const MAX_FILE_TRANSFER_BYTES: u64 = 256 * 1024 * 1024;
const MIN_TRANSFER_CHUNK_BYTES: usize = 4 * 1024;
const MAX_TRANSFER_CHUNK_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
struct RemoteFileSnapshot {
    size: u64,
    last_write_ticks: i64,
    sha256: String,
}

fn validate_remote_transfer_path(path: &str) -> Result<(), String> {
    if path.is_empty()
        || path.len() > 16 * 1024
        || path
            .chars()
            .any(|character| matches!(character, '\0' | '\r' | '\n'))
    {
        return Err("Remote transfer path is outside the safety bounds".to_string());
    }
    Ok(())
}

fn escape_ps_literal(value: &str) -> String {
    value.replace('\'', "''")
}

fn sha256_hex(data: &[u8]) -> String {
    hex::encode(Sha256::digest(data))
}

#[cfg(unix)]
fn same_file_identity(left: &Metadata, right: &Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;
    left.dev() == right.dev() && left.ino() == right.ino()
}

#[cfg(windows)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct WindowsFileIdentity {
    volume_serial_number: u32,
    file_index: u64,
}

#[cfg(windows)]
fn windows_file_identity(file: &tokio::fs::File) -> Result<WindowsFileIdentity, String> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{
        GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION,
    };

    let mut information = unsafe { std::mem::zeroed::<BY_HANDLE_FILE_INFORMATION>() };
    let succeeded = unsafe {
        GetFileInformationByHandle(file.as_raw_handle() as _, &mut information)
    };
    if succeeded == 0 {
        return Err(format!(
            "Failed to obtain stable upload source identity: {}",
            std::io::Error::last_os_error()
        ));
    }
    Ok(WindowsFileIdentity {
        volume_serial_number: information.dwVolumeSerialNumber,
        file_index: ((information.nFileIndexHigh as u64) << 32)
            | information.nFileIndexLow as u64,
    })
}

#[cfg(windows)]
fn windows_regular_non_reparse(metadata: &Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    use windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT;

    metadata.is_file() && metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT == 0
}

#[cfg(not(any(unix, windows)))]
fn same_file_identity(_left: &Metadata, _right: &Metadata) -> bool {
    false
}

#[cfg(not(windows))]
fn stable_metadata(left: &Metadata, right: &Metadata) -> Result<bool, String> {
    let left_modified = left
        .modified()
        .map_err(|_| "Upload source modification time is unavailable".to_string())?;
    let right_modified = right
        .modified()
        .map_err(|_| "Upload source modification time is unavailable".to_string())?;
    Ok(left.len() == right.len()
        && left_modified == right_modified
        && same_file_identity(left, right))
}

#[cfg(windows)]
fn stable_metadata(left: &Metadata, right: &Metadata) -> Result<bool, String> {
    let left_modified = left
        .modified()
        .map_err(|_| "Upload source modification time is unavailable".to_string())?;
    let right_modified = right
        .modified()
        .map_err(|_| "Upload source modification time is unavailable".to_string())?;
    Ok(left.len() == right.len() && left_modified == right_modified)
}

fn upload_source_open_options() -> tokio::fs::OpenOptions {
    let mut options = tokio::fs::OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use windows_sys::Win32::Storage::FileSystem::{
            FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_READ,
        };

        options
            .share_mode(FILE_SHARE_READ)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    options
}

#[cfg(windows)]
async fn windows_path_matches_open_file(
    path: &str,
    expected_identity: WindowsFileIdentity,
    expected_metadata: &Metadata,
) -> Result<bool, String> {
    let current = upload_source_open_options()
        .open(path)
        .await
        .map_err(|error| format!("Failed to verify upload source identity: {error}"))?;
    let current_metadata = current
        .metadata()
        .await
        .map_err(|error| format!("Failed to inspect upload source identity: {error}"))?;
    Ok(windows_regular_non_reparse(&current_metadata)
        && stable_metadata(expected_metadata, &current_metadata)?
        && windows_file_identity(&current)? == expected_identity)
}

async fn read_stable_upload_source(path: &str) -> Result<Zeroizing<Vec<u8>>, String> {
    let before_path = tokio::fs::symlink_metadata(path)
        .await
        .map_err(|error| format!("Failed to inspect upload source: {error}"))?;
    if before_path.file_type().is_symlink() || !before_path.is_file() {
        return Err("Upload source must be a regular non-symlink file".to_string());
    }
    if before_path.len() > MAX_FILE_TRANSFER_BYTES {
        return Err(format!(
            "PowerShell upload exceeds the {} byte safety limit",
            MAX_FILE_TRANSFER_BYTES
        ));
    }

    let file = upload_source_open_options()
        .open(path)
        .await
        .map_err(|error| format!("Failed to open upload source: {error}"))?;
    let handle_before = file
        .metadata()
        .await
        .map_err(|error| format!("Failed to inspect opened upload source: {error}"))?;
    #[cfg(windows)]
    if !windows_regular_non_reparse(&handle_before) {
        return Err("Upload source must be a regular non-reparse-point file".to_string());
    }
    #[cfg(windows)]
    let handle_identity = windows_file_identity(&file)?;
    let after_open_path = tokio::fs::symlink_metadata(path)
        .await
        .map_err(|error| format!("Failed to re-inspect upload source: {error}"))?;
    #[cfg(windows)]
    let after_open_identity_matches =
        windows_path_matches_open_file(path, handle_identity, &handle_before).await?;
    #[cfg(not(windows))]
    let after_open_identity_matches = true;
    if after_open_path.file_type().is_symlink()
        || !after_open_path.is_file()
        || !handle_before.is_file()
        || !stable_metadata(&before_path, &handle_before)?
        || !stable_metadata(&handle_before, &after_open_path)?
        || !after_open_identity_matches
    {
        return Err("Upload source changed while it was being opened".to_string());
    }

    let mut limited = file.take(MAX_FILE_TRANSFER_BYTES.saturating_add(1));
    let mut data = Zeroizing::new(Vec::new());
    limited
        .read_to_end(&mut data)
        .await
        .map_err(|error| format!("Failed to read opened upload source: {error}"))?;
    if data.len() as u64 > MAX_FILE_TRANSFER_BYTES {
        return Err(format!(
            "PowerShell upload exceeds the {} byte safety limit",
            MAX_FILE_TRANSFER_BYTES
        ));
    }
    let handle_after = limited
        .get_ref()
        .metadata()
        .await
        .map_err(|error| format!("Failed to re-inspect opened upload source: {error}"))?;
    let after_read_path = tokio::fs::symlink_metadata(path)
        .await
        .map_err(|error| format!("Failed to re-inspect upload source after reading: {error}"))?;
    #[cfg(windows)]
    let handle_identity_unchanged =
        windows_file_identity(limited.get_ref())? == handle_identity;
    #[cfg(not(windows))]
    let handle_identity_unchanged = true;
    #[cfg(windows)]
    let after_read_identity_matches =
        windows_path_matches_open_file(path, handle_identity, &handle_after).await?;
    #[cfg(not(windows))]
    let after_read_identity_matches = true;
    if after_read_path.file_type().is_symlink()
        || !after_read_path.is_file()
        || !stable_metadata(&handle_before, &handle_after)?
        || !stable_metadata(&handle_after, &after_read_path)?
        || !handle_identity_unchanged
        || !after_read_identity_matches
        || data.len() as u64 != handle_after.len()
    {
        return Err("Upload source changed while it was being read".to_string());
    }
    Ok(data)
}

async fn run_remote_script(
    transport: &Arc<Mutex<WinRmTransport>>,
    shell_id: &str,
    script: &str,
) -> Result<(String, String), String> {
    let mut locked = transport.lock().await;
    let command_id = locked.execute_ps_command(shell_id, script).await?;
    let result = locked.receive_all_output(shell_id, &command_id).await;
    let _ = locked
        .signal_command(shell_id, &command_id, WsManSignal::TERMINATE)
        .await;
    result
}

async fn remote_file_snapshot(
    transport: &Arc<Mutex<WinRmTransport>>,
    shell_id: &str,
    path: &str,
) -> Result<RemoteFileSnapshot, String> {
    let escaped = escape_ps_literal(path);
    let script = format!(
        "$item = Get-Item -LiteralPath '{}' -ErrorAction Stop; if (-not $item.PSIsContainer -and $item.Length -le {}) {{ $hash = (Get-FileHash -LiteralPath '{}' -Algorithm SHA256 -ErrorAction Stop).Hash.ToLowerInvariant(); Write-Output \"$($item.Length)|$($item.LastWriteTimeUtc.Ticks)|$hash\" }} else {{ throw 'Remote transfer source is invalid or too large' }}",
        escaped, MAX_FILE_TRANSFER_BYTES, escaped
    );
    let (stdout, stderr) = run_remote_script(transport, shell_id, &script).await?;
    if !stderr.trim().is_empty() {
        return Err(format!(
            "Remote file snapshot failed (remote error output omitted; {} bytes)",
            stderr.len()
        ));
    }
    let mut fields = stdout.trim().split('|');
    let size = fields
        .next()
        .ok_or_else(|| "Remote file snapshot omitted size".to_string())?
        .parse::<u64>()
        .map_err(|_| "Remote file snapshot size is invalid".to_string())?;
    let last_write_ticks = fields
        .next()
        .ok_or_else(|| "Remote file snapshot omitted modification time".to_string())?
        .parse::<i64>()
        .map_err(|_| "Remote file snapshot modification time is invalid".to_string())?;
    let sha256 = fields
        .next()
        .ok_or_else(|| "Remote file snapshot omitted hash".to_string())?
        .to_ascii_lowercase();
    if fields.next().is_some()
        || size > MAX_FILE_TRANSFER_BYTES
        || sha256.len() != 64
        || !sha256
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        return Err("Remote file snapshot is outside the safety bounds".to_string());
    }
    Ok(RemoteFileSnapshot {
        size,
        last_write_ticks,
        sha256,
    })
}

async fn cleanup_remote_stage(
    transport: &Arc<Mutex<WinRmTransport>>,
    shell_id: &str,
    path: &str,
) -> bool {
    let escaped = escape_ps_literal(path);
    let script = format!(
        "if (Test-Path -LiteralPath '{}') {{ Remove-Item -LiteralPath '{}' -Force -ErrorAction Stop }}; if (Test-Path -LiteralPath '{}') {{ throw 'Remote staging cleanup failed' }}; Write-Output 'SORNG_CLEAN'",
        escaped, escaped, escaped
    );
    matches!(
        run_remote_script(transport, shell_id, &script).await,
        Ok((stdout, stderr)) if stderr.trim().is_empty() && stdout.trim() == "SORNG_CLEAN"
    )
}

fn upload_failure(message: String, cleanup_confirmed: bool) -> String {
    if cleanup_confirmed {
        message
    } else {
        format!("{message}; remote staging cleanup could not be confirmed")
    }
}

async fn publish_download_exclusively(path: &str, data: &[u8]) -> Result<(), String> {
    let destination = Path::new(path);
    match tokio::fs::symlink_metadata(destination).await {
        Ok(_) => {
            return Err(
                "PowerShell download refuses to overwrite an existing destination".to_string(),
            )
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(format!(
                "Failed to inspect local download destination: {error}"
            ))
        }
    }
    let parent = destination.parent().unwrap_or_else(|| Path::new("."));
    let staging_path = parent.join(format!(".sorng-download-{}.part", Uuid::new_v4()));
    let mut staging_file = tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&staging_path)
        .await
        .map_err(|error| format!("Failed to create exclusive download staging file: {error}"))?;
    if let Err(error) = staging_file.write_all(data).await {
        let _ = tokio::fs::remove_file(&staging_path).await;
        return Err(format!("Failed to write download staging file: {error}"));
    }
    if let Err(error) = staging_file.sync_all().await {
        drop(staging_file);
        let _ = tokio::fs::remove_file(&staging_path).await;
        return Err(format!("Failed to sync download staging file: {error}"));
    }
    drop(staging_file);
    if let Err(error) = tokio::fs::hard_link(&staging_path, destination).await {
        let _ = tokio::fs::remove_file(&staging_path).await;
        return Err(format!(
            "Failed to publish download without overwriting the destination: {error}"
        ));
    }
    let _ = tokio::fs::remove_file(&staging_path).await;
    Ok(())
}

// ─── File Transfer Manager ───────────────────────────────────────────────────

/// Manages file transfers over PowerShell Remoting sessions.
pub struct PsFileTransferManager {
    /// Active transfers by transfer ID
    transfers: HashMap<String, PsFileTransferProgress>,
}

impl Default for PsFileTransferManager {
    fn default() -> Self {
        Self::new()
    }
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
        if params.direction != PsFileCopyDirection::ToSession {
            return Err(
                "PowerShell upload direction does not match the requested operation".to_string(),
            );
        }
        if !(MIN_TRANSFER_CHUNK_BYTES..=MAX_TRANSFER_CHUNK_BYTES).contains(&params.chunk_size) {
            return Err("PowerShell transfer chunk size is outside the safety bounds".to_string());
        }
        validate_remote_transfer_path(&params.remote_path)?;
        let session = manager.get_session(&params.session_id)?;
        if session.state != PsSessionState::Opened {
            return Err("Session is not in Opened state".to_string());
        }
        let file_data = read_stable_upload_source(&params.local_path).await?;
        let total_bytes = file_data.len() as u64;
        let local_hash = sha256_hex(file_data.as_slice());
        let transfer_id = Uuid::new_v4().to_string();
        let staging_path = format!("{}.sorng-upload-{}.tmp", params.remote_path, Uuid::new_v4());
        validate_remote_transfer_path(&staging_path)?;
        let transport = manager.get_transport(&params.session_id)?;
        let shell_id = manager.get_shell_id(&params.session_id)?;
        self.transfers.insert(
            transfer_id.clone(),
            PsFileTransferProgress {
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
                current_file: None,
                files_total: 1,
                files_transferred: 0,
            },
        );
        info!(
            "Starting PowerShell upload {} on session {} ({} bytes)",
            transfer_id, params.session_id, total_bytes
        );
        macro_rules! fail_upload {
            ($message:expr) => {{
                let cleaned = cleanup_remote_stage(&transport, &shell_id, &staging_path).await;
                return Err(upload_failure($message, cleaned));
            }};
        }
        let staging = escape_ps_literal(&staging_path);
        let destination = escape_ps_literal(&params.remote_path);
        let init = format!(
            "if (Test-Path -LiteralPath '{}') {{ throw 'Remote upload destination already exists' }}; if (Test-Path -LiteralPath '{}') {{ throw 'Remote upload staging collision' }}; $stream = [System.IO.File]::Open('{}', [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None); $stream.Dispose()",
            destination, staging, staging
        );
        let (_, stderr) = match run_remote_script(&transport, &shell_id, &init).await {
            Ok(result) => result,
            Err(error) => fail_upload!(format!(
                "Failed to initialize remote upload staging: {error}"
            )),
        };
        if !stderr.trim().is_empty() {
            fail_upload!(format!("Failed to initialize remote upload staging (remote error output omitted; {} bytes)", stderr.len()));
        }
        let started = std::time::Instant::now();
        for (index, chunk) in file_data.chunks(params.chunk_size).enumerate() {
            let encoded = Zeroizing::new(base64::Engine::encode(
                &base64::engine::general_purpose::STANDARD,
                chunk,
            ));
            let script = Zeroizing::new(format!(
                "$bytes = [System.Convert]::FromBase64String('{}'); $stream = [System.IO.File]::Open('{}', [System.IO.FileMode]::Append, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None); try {{ $stream.Write($bytes, 0, $bytes.Length); $stream.Flush($true) }} finally {{ $stream.Dispose() }}",
                encoded.as_str(), staging
            ));
            let (_, stderr) = match run_remote_script(&transport, &shell_id, script.as_str()).await
            {
                Ok(result) => result,
                Err(error) => fail_upload!(format!("Remote upload chunk {index} failed: {error}")),
            };
            if !stderr.trim().is_empty() {
                fail_upload!(format!(
                    "Remote upload chunk {index} failed (remote error output omitted; {} bytes)",
                    stderr.len()
                ));
            }
            let transferred = ((index + 1) * params.chunk_size).min(file_data.len()) as u64;
            if let Some(current) = self.transfers.get_mut(&transfer_id) {
                current.transferred_bytes = transferred;
                current.percent_complete = if total_bytes == 0 {
                    100.0
                } else {
                    transferred as f64 / total_bytes as f64 * 100.0
                };
                let elapsed = started.elapsed().as_secs_f64();
                current.bytes_per_second = if elapsed > 0.0 {
                    transferred as f64 / elapsed
                } else {
                    0.0
                };
            }
        }
        let staged = match remote_file_snapshot(&transport, &shell_id, &staging_path).await {
            Ok(snapshot) => snapshot,
            Err(error) => fail_upload!(error),
        };
        if staged.size != total_bytes || staged.sha256 != local_hash {
            fail_upload!("Remote upload staging verification failed".to_string());
        }
        let publish = format!(
            "if (Test-Path -LiteralPath '{}') {{ throw 'Remote upload destination already exists' }}; [System.IO.File]::Move('{}', '{}')",
            destination, staging, destination
        );
        let publish_result = run_remote_script(&transport, &shell_id, &publish).await;
        let published = remote_file_snapshot(&transport, &shell_id, &params.remote_path).await;
        let verified = (matches!(&publish_result, Ok((_, stderr)) if stderr.trim().is_empty())
            && matches!(&published, Ok(snapshot) if snapshot.size == total_bytes && snapshot.sha256 == local_hash))
            || matches!((&publish_result, &published), (Err(_), Ok(snapshot)) if snapshot.size == total_bytes && snapshot.sha256 == local_hash);
        if !verified {
            let cleaned = cleanup_remote_stage(&transport, &shell_id, &staging_path).await;
            return Err(upload_failure(
                "Remote upload publish or verification failed".to_string(),
                cleaned,
            ));
        }
        if let Some(current) = self.transfers.get_mut(&transfer_id) {
            current.state = PsTransferState::Completed;
            current.transferred_bytes = total_bytes;
            current.percent_complete = 100.0;
            current.files_transferred = 1;
        }
        info!(
            "PowerShell upload {} completed on session {} ({} bytes)",
            transfer_id, params.session_id, total_bytes
        );
        self.transfers
            .get(&transfer_id)
            .cloned()
            .ok_or_else(|| "PowerShell upload progress record was lost".to_string())
    }

    /// Copy a file or directory from a remote session (Copy-Item -FromSession).
    pub async fn copy_from_session(
        &mut self,
        manager: &PsSessionManager,
        params: &PsFileCopyParams,
    ) -> Result<PsFileTransferProgress, String> {
        if params.direction != PsFileCopyDirection::FromSession {
            return Err(
                "PowerShell download direction does not match the requested operation".to_string(),
            );
        }
        if !(MIN_TRANSFER_CHUNK_BYTES..=MAX_TRANSFER_CHUNK_BYTES).contains(&params.chunk_size) {
            return Err("PowerShell transfer chunk size is outside the safety bounds".to_string());
        }
        validate_remote_transfer_path(&params.remote_path)?;
        let session = manager.get_session(&params.session_id)?;
        if session.state != PsSessionState::Opened {
            return Err("Session is not in Opened state".to_string());
        }
        let transport = manager.get_transport(&params.session_id)?;
        let shell_id = manager.get_shell_id(&params.session_id)?;
        let before = remote_file_snapshot(&transport, &shell_id, &params.remote_path).await?;
        let transfer_id = Uuid::new_v4().to_string();
        self.transfers.insert(
            transfer_id.clone(),
            PsFileTransferProgress {
                transfer_id: transfer_id.clone(),
                session_id: params.session_id.clone(),
                direction: PsFileCopyDirection::FromSession,
                source_path: params.remote_path.clone(),
                destination_path: params.local_path.clone(),
                total_bytes: before.size,
                transferred_bytes: 0,
                percent_complete: 0.0,
                bytes_per_second: 0.0,
                started_at: Utc::now(),
                estimated_completion: None,
                state: PsTransferState::Transferring,
                current_file: None,
                files_total: 1,
                files_transferred: 0,
            },
        );
        info!(
            "Starting PowerShell download {} on session {} ({} bytes)",
            transfer_id, params.session_id, before.size
        );
        let remote = escape_ps_literal(&params.remote_path);
        let mut file_data = Zeroizing::new(Vec::new());
        let mut offset = 0u64;
        let started = std::time::Instant::now();
        while offset < before.size {
            let read_len = params.chunk_size.min((before.size - offset) as usize);
            let script = format!(
                "$stream = [System.IO.File]::Open('{}', [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite); try {{ [void]$stream.Seek({}, [System.IO.SeekOrigin]::Begin); $bytes = New-Object byte[] {}; $count = $stream.Read($bytes, 0, {}); if ($count -le 0) {{ throw 'Remote file ended before advertised size' }}; if ($count -ne $bytes.Length) {{ [Array]::Resize([ref]$bytes, $count) }}; [System.Convert]::ToBase64String($bytes) }} finally {{ $stream.Dispose() }}",
                remote, offset, read_len, read_len
            );
            let (stdout, stderr) = run_remote_script(&transport, &shell_id, &script).await?;
            if !stderr.trim().is_empty() {
                return Err(format!(
                    "Remote download chunk failed (remote error output omitted; {} bytes)",
                    stderr.len()
                ));
            }
            let max_encoded = read_len
                .checked_add(2)
                .and_then(|v| v.checked_div(3))
                .and_then(|v| v.checked_mul(4))
                .ok_or_else(|| "PowerShell download chunk size overflow".to_string())?;
            let encoded = stdout.trim();
            if encoded.len() > max_encoded {
                return Err("Remote download chunk exceeds the encoded safety limit".to_string());
            }
            let chunk = Zeroizing::new(
                base64::Engine::decode(&base64::engine::general_purpose::STANDARD, encoded)
                    .map_err(|_| "Remote download chunk is not valid base64".to_string())?,
            );
            if chunk.is_empty() || chunk.len() > read_len {
                return Err("Remote download returned an invalid chunk length".to_string());
            }
            let next_offset = offset
                .checked_add(chunk.len() as u64)
                .ok_or_else(|| "PowerShell download offset overflow".to_string())?;
            let next_buffer = file_data
                .len()
                .checked_add(chunk.len())
                .ok_or_else(|| "PowerShell download buffer size overflow".to_string())?;
            if next_offset > before.size
                || next_offset > MAX_FILE_TRANSFER_BYTES
                || next_buffer as u64 > MAX_FILE_TRANSFER_BYTES
            {
                return Err("Remote download exceeded its advertised safety bounds".to_string());
            }
            file_data.extend_from_slice(chunk.as_slice());
            offset = next_offset;
            if let Some(current) = self.transfers.get_mut(&transfer_id) {
                current.transferred_bytes = offset;
                current.percent_complete = if before.size == 0 {
                    100.0
                } else {
                    offset as f64 / before.size as f64 * 100.0
                };
                let elapsed = started.elapsed().as_secs_f64();
                current.bytes_per_second = if elapsed > 0.0 {
                    offset as f64 / elapsed
                } else {
                    0.0
                };
            }
        }
        let local_hash = sha256_hex(file_data.as_slice());
        let after = remote_file_snapshot(&transport, &shell_id, &params.remote_path).await?;
        if before != after || file_data.len() as u64 != before.size || local_hash != before.sha256 {
            return Err(
                "Remote file changed during download; mixed content was rejected".to_string(),
            );
        }
        publish_download_exclusively(&params.local_path, file_data.as_slice()).await?;
        if let Some(current) = self.transfers.get_mut(&transfer_id) {
            current.state = PsTransferState::Completed;
            current.transferred_bytes = before.size;
            current.percent_complete = 100.0;
            current.files_transferred = 1;
        }
        info!(
            "PowerShell download {} completed on session {} ({} bytes)",
            transfer_id, params.session_id, before.size
        );
        self.transfers
            .get(&transfer_id)
            .cloned()
            .ok_or_else(|| "PowerShell download progress record was lost".to_string())
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
