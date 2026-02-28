//! Apple Remote Desktop file-transfer extension.
//!
//! Uses the Apple file-transfer pseudo-encoding (`0x574D5602`) to transfer
//! files and browse remote directories. Messages are tunnelled inside
//! `ClientCutText` (type 6) with a `0xFE, 0xFE, 0xFE` marker in the padding.

use serde::{Deserialize, Serialize};

use super::errors::ArdError;
use super::rfb::{self, RfbConnection};

/// Apple file-transfer pseudo-encoding.
pub const FILE_TRANSFER_ENCODING: i32 = rfb::encoding::APPLE_FILE_TRANSFER;

/// File-transfer sub-command identifiers.
pub mod subcmd {
    pub const LIST_DIR: u8 = 0x01;
    pub const UPLOAD: u8 = 0x02;
    pub const DOWNLOAD: u8 = 0x03;
    pub const DELETE: u8 = 0x04;
    pub const MKDIR: u8 = 0x05;
    pub const RENAME: u8 = 0x06;
    /// Generic response from server.
    pub const RESPONSE: u8 = 0x80;
}

/// Status codes returned by the server.
pub mod status {
    pub const OK: u8 = 0x00;
    pub const NOT_FOUND: u8 = 0x01;
    pub const PERMISSION_DENIED: u8 = 0x02;
    pub const DISK_FULL: u8 = 0x03;
    pub const ALREADY_EXISTS: u8 = 0x04;
    pub const IO_ERROR: u8 = 0x10;
    pub const INVALID_PATH: u8 = 0x11;
    pub const TRANSFER_CANCELLED: u8 = 0x21;
}

/// A single entry in a remote directory listing.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteFileEntry {
    pub name: String,
    pub is_directory: bool,
    pub size: u64,
    pub permissions: u32,
    pub modified: i64,
    pub owner: String,
}

/// Progress information for an active file transfer.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferProgress {
    pub bytes_transferred: u64,
    pub total_bytes: u64,
    pub direction: TransferDirection,
    pub state: TransferState,
    pub path: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TransferDirection {
    Upload,
    Download,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TransferState {
    InProgress,
    Complete,
    Failed,
    Cancelled,
}

// ── Outbound protocol messages ───────────────────────────────────────────

/// Build and send a file-transfer sub-command message.
fn send_ft_message(
    conn: &mut RfbConnection,
    subcmd: u8,
    payload: &[u8],
) -> Result<(), ArdError> {
    // Total inner payload: 1 byte subcmd + payload
    let inner_len = 1 + payload.len();

    let mut msg = Vec::with_capacity(8 + inner_len);
    // ClientCutText type
    msg.push(rfb::client_msg::CLIENT_CUT_TEXT);
    // File-transfer marker: 0xFE, 0xFE, 0xFE
    msg.extend_from_slice(&[0xFE, 0xFE, 0xFE]);
    // Length
    msg.extend_from_slice(&(inner_len as u32).to_be_bytes());
    // Sub-command
    msg.push(subcmd);
    // Payload
    msg.extend_from_slice(payload);

    conn.write_all(&msg)?;
    Ok(())
}

/// Request a directory listing from the server.
pub fn request_list_dir(conn: &mut RfbConnection, path: &str) -> Result<(), ArdError> {
    let path_bytes = path.as_bytes();
    let mut payload = Vec::with_capacity(4 + path_bytes.len());
    payload.extend_from_slice(&(path_bytes.len() as u32).to_be_bytes());
    payload.extend_from_slice(path_bytes);

    send_ft_message(conn, subcmd::LIST_DIR, &payload)
}

/// Read a directory-listing response from the server.
pub fn read_list_dir_response(conn: &mut RfbConnection) -> Result<Vec<RemoteFileEntry>, ArdError> {
    // Read response status
    let resp_status = conn.read_u8()?;
    if resp_status != status::OK {
        return Err(ArdError::FileTransfer(format!(
            "List dir failed with status: 0x{:02X}",
            resp_status
        )));
    }

    let entry_count = conn.read_u32()? as usize;
    let mut entries = Vec::with_capacity(entry_count);

    for _ in 0..entry_count {
        let flags = conn.read_u8()?;
        let is_directory = flags & 0x01 != 0;

        let name_len = conn.read_u16()? as usize;
        let mut name_bytes = vec![0u8; name_len];
        conn.read_exact(&mut name_bytes)?;
        let name = String::from_utf8_lossy(&name_bytes).into_owned();

        let size = conn.read_u64()?;
        let permissions = conn.read_u32()?;
        let modified = conn.read_u64()? as i64;

        let owner_len = conn.read_u16()? as usize;
        let mut owner_bytes = vec![0u8; owner_len];
        conn.read_exact(&mut owner_bytes)?;
        let owner = String::from_utf8_lossy(&owner_bytes).into_owned();

        entries.push(RemoteFileEntry {
            name,
            is_directory,
            size,
            permissions,
            modified,
            owner,
        });
    }

    Ok(entries)
}

/// Initiate a file download from the server.
pub fn request_download(conn: &mut RfbConnection, remote_path: &str) -> Result<(), ArdError> {
    let path_bytes = remote_path.as_bytes();
    let mut payload = Vec::with_capacity(4 + path_bytes.len());
    payload.extend_from_slice(&(path_bytes.len() as u32).to_be_bytes());
    payload.extend_from_slice(path_bytes);

    send_ft_message(conn, subcmd::DOWNLOAD, &payload)
}

/// A chunk of downloaded data or completion.
pub enum DownloadChunk {
    /// A data chunk with the total file size and chunk data.
    Data { total_size: u64, data: Vec<u8> },
    /// Download is complete.
    Complete,
}

/// Read a single download data chunk or completion marker.
pub fn read_download_chunk(conn: &mut RfbConnection) -> Result<DownloadChunk, ArdError> {
    let chunk_type = conn.read_u8()?;

    match chunk_type {
        0x00 => {
            // Completion marker
            Ok(DownloadChunk::Complete)
        }
        0x01 => {
            // Data chunk
            let total_size = conn.read_u64()?;
            let chunk_len = conn.read_u32()? as usize;
            let mut data = vec![0u8; chunk_len];
            conn.read_exact(&mut data)?;
            Ok(DownloadChunk::Data { total_size, data })
        }
        other => Err(ArdError::FileTransfer(format!(
            "Unknown download chunk type: 0x{:02X}",
            other
        ))),
    }
}

/// Initiate a file upload to the server.
pub fn request_upload(
    conn: &mut RfbConnection,
    remote_path: &str,
    total_size: u64,
) -> Result<(), ArdError> {
    let path_bytes = remote_path.as_bytes();
    let mut payload = Vec::with_capacity(4 + path_bytes.len() + 8);
    payload.extend_from_slice(&(path_bytes.len() as u32).to_be_bytes());
    payload.extend_from_slice(path_bytes);
    payload.extend_from_slice(&total_size.to_be_bytes());

    send_ft_message(conn, subcmd::UPLOAD, &payload)
}

/// Send a chunk of upload data.
pub fn send_upload_chunk(conn: &mut RfbConnection, data: &[u8]) -> Result<(), ArdError> {
    let mut payload = Vec::with_capacity(4 + data.len());
    payload.extend_from_slice(&(data.len() as u32).to_be_bytes());
    payload.extend_from_slice(data);

    send_ft_message(conn, subcmd::UPLOAD, &payload)
}

/// Read the server's response after an upload operation.
pub fn read_upload_response(conn: &mut RfbConnection) -> Result<(), ArdError> {
    let resp_status = conn.read_u8()?;
    if resp_status != status::OK {
        return Err(ArdError::FileTransfer(format!(
            "Upload failed with status: 0x{:02X}",
            resp_status
        )));
    }
    Ok(())
}

/// Request deletion of a remote file or directory.
pub fn request_delete(conn: &mut RfbConnection, remote_path: &str) -> Result<(), ArdError> {
    let path_bytes = remote_path.as_bytes();
    let mut payload = Vec::with_capacity(4 + path_bytes.len());
    payload.extend_from_slice(&(path_bytes.len() as u32).to_be_bytes());
    payload.extend_from_slice(path_bytes);

    send_ft_message(conn, subcmd::DELETE, &payload)
}

/// Request creation of a remote directory.
pub fn request_mkdir(conn: &mut RfbConnection, remote_path: &str) -> Result<(), ArdError> {
    let path_bytes = remote_path.as_bytes();
    let mut payload = Vec::with_capacity(4 + path_bytes.len());
    payload.extend_from_slice(&(path_bytes.len() as u32).to_be_bytes());
    payload.extend_from_slice(path_bytes);

    send_ft_message(conn, subcmd::MKDIR, &payload)
}

/// Check whether the negotiated encoding list includes Apple file transfer.
pub fn supports_file_transfer(encodings: &[i32]) -> bool {
    encodings.contains(&FILE_TRANSFER_ENCODING)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn subcmd_values() {
        assert_eq!(subcmd::LIST_DIR, 0x01);
        assert_eq!(subcmd::UPLOAD, 0x02);
        assert_eq!(subcmd::DOWNLOAD, 0x03);
        assert_eq!(subcmd::DELETE, 0x04);
        assert_eq!(subcmd::MKDIR, 0x05);
        assert_eq!(subcmd::RESPONSE, 0x80);
    }

    #[test]
    fn status_values() {
        assert_eq!(status::OK, 0x00);
        assert_eq!(status::NOT_FOUND, 0x01);
        assert_eq!(status::PERMISSION_DENIED, 0x02);
    }

    #[test]
    fn transfer_progress_serialization() {
        let progress = TransferProgress {
            bytes_transferred: 1024,
            total_bytes: 4096,
            direction: TransferDirection::Upload,
            state: TransferState::InProgress,
            path: "/tmp/test.txt".to_string(),
        };
        let json = serde_json::to_string(&progress).unwrap();
        assert!(json.contains("bytesTransferred"));
        assert!(json.contains("upload"));
    }

    #[test]
    fn supports_ft_detection() {
        let with = vec![0, FILE_TRANSFER_ENCODING, 16];
        assert!(supports_file_transfer(&with));

        let without = vec![0, 1, 16];
        assert!(!supports_file_transfer(&without));
    }

    #[test]
    fn remote_file_entry_serialization() {
        let entry = RemoteFileEntry {
            name: "readme.txt".to_string(),
            is_directory: false,
            size: 1234,
            permissions: 0o644,
            modified: 1700000000,
            owner: "admin".to_string(),
        };
        let json = serde_json::to_string(&entry).unwrap();
        assert!(json.contains("isDirectory"));
        assert!(json.contains("readme.txt"));
    }
}
