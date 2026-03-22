//! Filesystem device handler for RDPDR drive redirection.
//!
//! Implements IRP dispatch for a single redirected drive, mapping remote
//! file system operations to local `std::fs` calls within a sandboxed root.

use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::PathBuf;
use std::time::SystemTime;

use super::pdu::*;

/// A single redirected filesystem device.
pub struct FileSystemDevice {
    pub device_id: u32,
    root_path: PathBuf,
    read_only: bool,
    open_files: HashMap<u32, OpenFile>,
    next_file_id: u32,
}

struct OpenFile {
    handle: Option<File>,
    path: PathBuf,
    is_directory: bool,
    delete_on_close: bool,
    dir_enum_done: bool,
}

impl FileSystemDevice {
    pub fn new(device_id: u32, root_path: PathBuf, read_only: bool) -> Self {
        Self {
            device_id,
            root_path,
            read_only,
            open_files: HashMap::new(),
            next_file_id: 1,
        }
    }

    /// Dispatch an IRP to the appropriate handler.
    pub fn handle_irp(&mut self, major: u32, minor: u32, completion_id: u32, file_id: u32, data: &[u8]) -> Vec<u8> {
        let (status, output) = match major {
            IRP_MJ_CREATE => self.handle_create(data),
            IRP_MJ_CLOSE => self.handle_close(file_id),
            IRP_MJ_READ => self.handle_read(file_id, data),
            IRP_MJ_WRITE => self.handle_write(file_id, data),
            IRP_MJ_QUERY_INFORMATION => self.handle_query_info(file_id, data),
            IRP_MJ_SET_INFORMATION => self.handle_set_info(file_id, data),
            IRP_MJ_QUERY_VOLUME_INFORMATION => self.handle_query_volume(data),
            IRP_MJ_DIRECTORY_CONTROL => self.handle_directory_control(file_id, minor, data),
            IRP_MJ_LOCK_CONTROL => (STATUS_SUCCESS, Vec::new()),
            _ => {
                log::warn!("RDPDR: unsupported IRP major=0x{:X}", major);
                (STATUS_NOT_SUPPORTED, Vec::new())
            }
        };
        build_io_completion(self.device_id, completion_id, status, &output)
    }

    /// Resolve a remote path to a local path, preventing traversal.
    fn resolve_path(&self, remote_path: &str) -> Option<PathBuf> {
        // Remote paths use backslash, may start with backslash
        let cleaned = remote_path.trim_start_matches('\\').replace('\\', "/");
        if cleaned.is_empty() || cleaned == "." {
            return Some(self.root_path.clone());
        }
        let candidate = self.root_path.join(&cleaned);
        // Canonicalize and verify it's within root
        match candidate.canonicalize() {
            Ok(canonical) => {
                let root_canonical = self.root_path.canonicalize().unwrap_or_else(|_| self.root_path.clone());
                if canonical.starts_with(&root_canonical) {
                    Some(canonical)
                } else {
                    log::warn!("RDPDR: path traversal blocked: {:?}", remote_path);
                    None
                }
            }
            Err(_) => {
                // Path doesn't exist yet — check parent
                if let Some(parent) = candidate.parent() {
                    match parent.canonicalize() {
                        Ok(canonical_parent) => {
                            let root_canonical = self.root_path.canonicalize().unwrap_or_else(|_| self.root_path.clone());
                            if canonical_parent.starts_with(&root_canonical) {
                                Some(candidate)
                            } else {
                                None
                            }
                        }
                        Err(_) => None,
                    }
                } else {
                    None
                }
            }
        }
    }

    // ── IRP Handlers ─────────────────────────────────────────────────

    fn handle_create(&mut self, data: &[u8]) -> (u32, Vec<u8>) {
        if data.len() < 32 {
            return (STATUS_UNSUCCESSFUL, create_response(0, 0));
        }
        let desired_access = read_u32(data, 0);
        let _allocation_size = read_u64(data, 4);
        let _file_attributes = read_u32(data, 12);
        let _shared_access = read_u32(data, 16);
        let create_disposition = read_u32(data, 20);
        let create_options = read_u32(data, 24);
        let path_length = read_u32(data, 28) as usize;

        let path_bytes = &data[32..32 + path_length.min(data.len() - 32)];
        let remote_path = decode_utf16le(path_bytes);

        let local_path = match self.resolve_path(&remote_path) {
            Some(p) => p,
            None => return (STATUS_ACCESS_DENIED, create_response(0, 0)),
        };

        let is_directory = create_options & FILE_DIRECTORY_FILE != 0;
        let delete_on_close = create_options & FILE_DELETE_ON_CLOSE != 0;
        let want_write = desired_access & 0x0002 != 0 // FILE_WRITE_DATA
            || desired_access & 0x0004 != 0 // FILE_APPEND_DATA
            || desired_access & 0x0100 != 0 // FILE_WRITE_ATTRIBUTES
            || desired_access & 0x0040_0000 != 0; // GENERIC_WRITE

        if self.read_only && (want_write || delete_on_close) {
            // Allow read-only open even on read-only drives
            if want_write && create_disposition != FILE_OPEN {
                return (STATUS_ACCESS_DENIED, create_response(0, 0));
            }
        }

        let exists = local_path.exists();
        let file_id = self.next_file_id;
        self.next_file_id += 1;

        let (status, information) = if is_directory {
            if !exists {
                if self.read_only {
                    return (STATUS_ACCESS_DENIED, create_response(0, 0));
                }
                if let Err(e) = fs::create_dir_all(&local_path) {
                    log::error!("RDPDR: mkdir {:?}: {}", local_path, e);
                    return (STATUS_UNSUCCESSFUL, create_response(0, 0));
                }
            }
            self.open_files.insert(file_id, OpenFile {
                handle: None,
                path: local_path,
                is_directory: true,
                delete_on_close,
                dir_enum_done: false,
            });
            (STATUS_SUCCESS, if exists { 1u32 } else { 2u32 }) // FILE_OPENED / FILE_CREATED
        } else {
            let file_result = match create_disposition {
                FILE_OPEN => {
                    if !exists { return (STATUS_NO_SUCH_FILE, create_response(0, 0)); }
                    OpenOptions::new().read(true).write(!self.read_only).open(&local_path)
                }
                FILE_CREATE => {
                    if exists { return (STATUS_OBJECT_NAME_COLLISION, create_response(0, 0)); }
                    if self.read_only { return (STATUS_ACCESS_DENIED, create_response(0, 0)); }
                    OpenOptions::new().read(true).write(true).create_new(true).open(&local_path)
                }
                FILE_OPEN_IF => {
                    if self.read_only && !exists { return (STATUS_ACCESS_DENIED, create_response(0, 0)); }
                    OpenOptions::new().read(true).write(!self.read_only).create(!self.read_only).open(&local_path)
                }
                FILE_OVERWRITE | FILE_OVERWRITE_IF | FILE_SUPERSEDE => {
                    if self.read_only { return (STATUS_ACCESS_DENIED, create_response(0, 0)); }
                    OpenOptions::new().read(true).write(true).create(true).truncate(true).open(&local_path)
                }
                _ => return (STATUS_NOT_SUPPORTED, create_response(0, 0)),
            };

            match file_result {
                Ok(f) => {
                    self.open_files.insert(file_id, OpenFile {
                        handle: Some(f),
                        path: local_path,
                        is_directory: false,
                        delete_on_close,
                        dir_enum_done: false,
                    });
                    (STATUS_SUCCESS, if exists { 1u32 } else { 2u32 })
                }
                Err(e) => {
                    log::error!("RDPDR: open {:?}: {}", local_path, e);
                    (STATUS_UNSUCCESSFUL, 0u32)
                }
            }
        };

        (status, create_response(file_id, information))
    }

    fn handle_close(&mut self, file_id: u32) -> (u32, Vec<u8>) {
        if let Some(entry) = self.open_files.remove(&file_id) {
            drop(entry.handle);
            if entry.delete_on_close && !self.read_only {
                if entry.is_directory {
                    let _ = fs::remove_dir_all(&entry.path);
                } else {
                    let _ = fs::remove_file(&entry.path);
                }
            }
        }
        (STATUS_SUCCESS, vec![0u8; 5]) // padding per spec
    }

    fn handle_read(&mut self, file_id: u32, data: &[u8]) -> (u32, Vec<u8>) {
        if data.len() < 12 {
            return (STATUS_UNSUCCESSFUL, Vec::new());
        }
        let length = read_u32(data, 0) as usize;
        let offset = read_u64(data, 4);

        let entry = match self.open_files.get_mut(&file_id) {
            Some(e) => e,
            None => return (STATUS_UNSUCCESSFUL, Vec::new()),
        };
        let file = match entry.handle.as_mut() {
            Some(f) => f,
            None => return (STATUS_UNSUCCESSFUL, Vec::new()),
        };

        if let Err(e) = file.seek(SeekFrom::Start(offset)) {
            log::error!("RDPDR: seek error: {}", e);
            return (STATUS_UNSUCCESSFUL, Vec::new());
        }

        let mut buf = vec![0u8; length];
        let n = match file.read(&mut buf) {
            Ok(n) => n,
            Err(e) => {
                log::error!("RDPDR: read error: {}", e);
                return (STATUS_UNSUCCESSFUL, Vec::new());
            }
        };
        buf.truncate(n);

        let mut out = Vec::with_capacity(4 + n);
        out.extend_from_slice(&(n as u32).to_le_bytes());
        out.extend_from_slice(&buf);
        (STATUS_SUCCESS, out)
    }

    fn handle_write(&mut self, file_id: u32, data: &[u8]) -> (u32, Vec<u8>) {
        if self.read_only {
            return (STATUS_ACCESS_DENIED, vec![0u8; 5]);
        }
        if data.len() < 32 {
            return (STATUS_UNSUCCESSFUL, Vec::new());
        }
        let length = read_u32(data, 0) as usize;
        let offset = read_u64(data, 4);
        let write_data = &data[32..32 + length.min(data.len() - 32)];

        let entry = match self.open_files.get_mut(&file_id) {
            Some(e) => e,
            None => return (STATUS_UNSUCCESSFUL, Vec::new()),
        };
        let file = match entry.handle.as_mut() {
            Some(f) => f,
            None => return (STATUS_UNSUCCESSFUL, Vec::new()),
        };

        if file.seek(SeekFrom::Start(offset)).is_err() {
            return (STATUS_UNSUCCESSFUL, Vec::new());
        }
        match file.write_all(write_data) {
            Ok(_) => {
                let mut out = Vec::with_capacity(5);
                out.extend_from_slice(&(write_data.len() as u32).to_le_bytes());
                out.push(0); // padding
                (STATUS_SUCCESS, out)
            }
            Err(e) => {
                log::error!("RDPDR: write error: {}", e);
                (STATUS_UNSUCCESSFUL, Vec::new())
            }
        }
    }

    fn handle_query_info(&self, file_id: u32, data: &[u8]) -> (u32, Vec<u8>) {
        if data.len() < 4 {
            return (STATUS_UNSUCCESSFUL, Vec::new());
        }
        let info_class = read_u32(data, 0);

        let entry = match self.open_files.get(&file_id) {
            Some(e) => e,
            None => return (STATUS_UNSUCCESSFUL, Vec::new()),
        };

        let metadata = match fs::metadata(&entry.path) {
            Ok(m) => m,
            Err(_) => return (STATUS_NO_SUCH_FILE, Vec::new()),
        };

        let attrs = metadata_to_attrs(&metadata);
        let size = metadata.len();
        let created = metadata.created().unwrap_or(SystemTime::UNIX_EPOCH);
        let modified = metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH);
        let accessed = modified; // Windows has separate access time

        match info_class {
            FILE_BASIC_INFORMATION => {
                let mut out = Vec::with_capacity(40);
                let ft_created = system_time_to_filetime(created);
                let ft_accessed = system_time_to_filetime(accessed);
                let ft_modified = system_time_to_filetime(modified);
                out.extend_from_slice(&ft_created.to_le_bytes());  // CreationTime
                out.extend_from_slice(&ft_accessed.to_le_bytes()); // LastAccessTime
                out.extend_from_slice(&ft_modified.to_le_bytes()); // LastWriteTime
                out.extend_from_slice(&ft_modified.to_le_bytes()); // ChangeTime
                out.extend_from_slice(&attrs.to_le_bytes());       // FileAttributes
                out.extend_from_slice(&0u32.to_le_bytes());        // Reserved
                (STATUS_SUCCESS, wrap_buffer(&out))
            }
            FILE_STANDARD_INFORMATION => {
                let mut out = Vec::with_capacity(24);
                out.extend_from_slice(&size.to_le_bytes());        // AllocationSize
                out.extend_from_slice(&size.to_le_bytes());        // EndOfFile
                out.extend_from_slice(&1u32.to_le_bytes());        // NumberOfLinks
                out.push(0);                                       // DeletePending
                out.push(if metadata.is_dir() { 1 } else { 0 });  // Directory
                out.extend_from_slice(&0u16.to_le_bytes());        // Reserved
                (STATUS_SUCCESS, wrap_buffer(&out))
            }
            FILE_ATTRIBUTE_TAG_INFORMATION => {
                let mut out = Vec::with_capacity(8);
                out.extend_from_slice(&attrs.to_le_bytes());
                out.extend_from_slice(&0u32.to_le_bytes()); // ReparseTag
                (STATUS_SUCCESS, wrap_buffer(&out))
            }
            _ => {
                log::warn!("RDPDR: unsupported info class {}", info_class);
                (STATUS_NOT_SUPPORTED, Vec::new())
            }
        }
    }

    fn handle_set_info(&mut self, file_id: u32, data: &[u8]) -> (u32, Vec<u8>) {
        if self.read_only {
            return (STATUS_ACCESS_DENIED, Vec::new());
        }
        if data.len() < 4 {
            return (STATUS_UNSUCCESSFUL, Vec::new());
        }
        let info_class = read_u32(data, 0);

        match info_class {
            FILE_DISPOSITION_INFORMATION => {
                // Mark for delete-on-close
                if data.len() >= 5 {
                    let delete = data[4] != 0;
                    if let Some(entry) = self.open_files.get_mut(&file_id) {
                        entry.delete_on_close = delete;
                    }
                }
                (STATUS_SUCCESS, Vec::new())
            }
            FILE_END_OF_FILE_INFORMATION | FILE_ALLOCATION_INFORMATION => {
                // Truncate/extend file
                if data.len() >= 12 {
                    let new_size = read_u64(data, 4);
                    if let Some(entry) = self.open_files.get(&file_id) {
                        if let Some(ref f) = entry.handle {
                            let _ = f.set_len(new_size);
                        }
                    }
                }
                (STATUS_SUCCESS, Vec::new())
            }
            FILE_RENAME_INFORMATION => {
                // Rename file
                if data.len() >= 10 {
                    let name_len = read_u32(data, 6) as usize;
                    if data.len() >= 10 + name_len {
                        let new_name = decode_utf16le(&data[10..10 + name_len]);
                        if let Some(new_path) = self.resolve_path(&new_name) {
                            if let Some(entry) = self.open_files.get_mut(&file_id) {
                                let old_path = entry.path.clone();
                                match fs::rename(&old_path, &new_path) {
                                    Ok(_) => { entry.path = new_path; }
                                    Err(e) => {
                                        log::error!("RDPDR: rename error: {}", e);
                                        return (STATUS_UNSUCCESSFUL, Vec::new());
                                    }
                                }
                            }
                        } else {
                            return (STATUS_ACCESS_DENIED, Vec::new());
                        }
                    }
                }
                (STATUS_SUCCESS, Vec::new())
            }
            _ => (STATUS_NOT_SUPPORTED, Vec::new()),
        }
    }

    fn handle_query_volume(&self, data: &[u8]) -> (u32, Vec<u8>) {
        if data.len() < 4 {
            return (STATUS_UNSUCCESSFUL, Vec::new());
        }
        let info_class = read_u32(data, 0);

        match info_class {
            FILE_FS_VOLUME_INFORMATION => {
                let label = encode_utf16le("SORNG");
                let mut out = Vec::with_capacity(18 + label.len());
                out.extend_from_slice(&0u64.to_le_bytes()); // VolumeCreationTime
                out.extend_from_slice(&0u32.to_le_bytes()); // VolumeSerialNumber
                out.extend_from_slice(&(label.len() as u32).to_le_bytes()); // VolumeLabelLength
                out.push(0); // SupportsObjects
                out.push(0); // Reserved
                out.extend_from_slice(&label);
                (STATUS_SUCCESS, wrap_buffer(&out))
            }
            FILE_FS_SIZE_INFORMATION => {
                // Report generous capacity
                let mut out = Vec::with_capacity(24);
                out.extend_from_slice(&(1024u64 * 1024 * 1024).to_le_bytes()); // TotalAllocationUnits
                out.extend_from_slice(&(512u64 * 1024 * 1024).to_le_bytes());  // AvailableAllocationUnits
                out.extend_from_slice(&8u32.to_le_bytes());                     // SectorsPerAllocationUnit
                out.extend_from_slice(&512u32.to_le_bytes());                   // BytesPerSector
                (STATUS_SUCCESS, wrap_buffer(&out))
            }
            FILE_FS_FULL_SIZE_INFORMATION => {
                let mut out = Vec::with_capacity(32);
                out.extend_from_slice(&(1024u64 * 1024 * 1024).to_le_bytes()); // TotalAllocationUnits
                out.extend_from_slice(&(512u64 * 1024 * 1024).to_le_bytes());  // CallerAvailableAllocationUnits
                out.extend_from_slice(&(512u64 * 1024 * 1024).to_le_bytes());  // ActualAvailableAllocationUnits
                out.extend_from_slice(&8u32.to_le_bytes());
                out.extend_from_slice(&512u32.to_le_bytes());
                (STATUS_SUCCESS, wrap_buffer(&out))
            }
            FILE_FS_ATTRIBUTE_INFORMATION => {
                let fs_name = encode_utf16le("FAT32");
                let mut out = Vec::with_capacity(12 + fs_name.len());
                out.extend_from_slice(&0x0000_001Fu32.to_le_bytes()); // FileSystemAttributes (case-sensitive, unicode)
                out.extend_from_slice(&255u32.to_le_bytes());         // MaximumComponentNameLength
                out.extend_from_slice(&(fs_name.len() as u32).to_le_bytes());
                out.extend_from_slice(&fs_name);
                (STATUS_SUCCESS, wrap_buffer(&out))
            }
            FILE_FS_DEVICE_INFORMATION => {
                let mut out = Vec::with_capacity(8);
                out.extend_from_slice(&0x00000007u32.to_le_bytes()); // DeviceType = FILE_DEVICE_DISK
                out.extend_from_slice(&0x00000020u32.to_le_bytes()); // Characteristics = FILE_REMOTE_DEVICE
                (STATUS_SUCCESS, wrap_buffer(&out))
            }
            _ => {
                log::warn!("RDPDR: unsupported volume info class {}", info_class);
                (STATUS_NOT_SUPPORTED, Vec::new())
            }
        }
    }

    fn handle_directory_control(&mut self, file_id: u32, minor: u32, data: &[u8]) -> (u32, Vec<u8>) {
        if minor == IRP_MN_NOTIFY_CHANGE_DIRECTORY {
            // We don't support change notifications — just return success
            // (server will retry periodically)
            return (STATUS_NOT_SUPPORTED, Vec::new());
        }

        if minor != IRP_MN_QUERY_DIRECTORY || data.len() < 25 {
            return (STATUS_NOT_SUPPORTED, Vec::new());
        }

        let info_class = read_u32(data, 0);
        let initial_query = data[4] != 0;
        let path_length = read_u32(data, 21) as usize;
        let pattern = if path_length > 0 && data.len() >= 25 + path_length {
            decode_utf16le(&data[25..25 + path_length])
        } else {
            "*".to_string()
        };

        let entry = match self.open_files.get_mut(&file_id) {
            Some(e) if e.is_directory => e,
            _ => return (STATUS_UNSUCCESSFUL, Vec::new()),
        };

        if initial_query {
            entry.dir_enum_done = false;
        }

        if entry.dir_enum_done {
            return (STATUS_NO_MORE_FILES, Vec::new());
        }

        // Read all entries from the directory
        let dir_entries = match fs::read_dir(&entry.path) {
            Ok(rd) => rd.filter_map(|e| e.ok()).collect::<Vec<_>>(),
            Err(_) => return (STATUS_UNSUCCESSFUL, Vec::new()),
        };

        let mut result_buf = Vec::new();

        for (i, dir_entry) in dir_entries.iter().enumerate() {
            let name = dir_entry.file_name().to_string_lossy().to_string();

            // Simple wildcard matching
            if pattern != "*" && !pattern.is_empty() {
                let pat = pattern.trim_start_matches('\\').replace('*', "");
                if !pat.is_empty() && !name.to_lowercase().contains(&pat.to_lowercase()) {
                    continue;
                }
            }

            let meta = match dir_entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };

            let name_bytes = encode_utf16le(&name);
            let attrs = metadata_to_attrs(&meta);
            let size = meta.len();
            let created = meta.created().unwrap_or(SystemTime::UNIX_EPOCH);
            let modified = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);

            match info_class {
                FILE_BOTH_DIR_INFORMATION | FILE_FULL_DIR_INFORMATION | FILE_DIRECTORY_INFORMATION => {
                    let _entry_size = 64 + name_bytes.len();

                    let offset_pos = result_buf.len();
                    result_buf.extend_from_slice(&0u32.to_le_bytes()); // NextEntryOffset (fill later)
                    result_buf.extend_from_slice(&(i as u32).to_le_bytes()); // FileIndex
                    result_buf.extend_from_slice(&system_time_to_filetime(created).to_le_bytes());
                    result_buf.extend_from_slice(&system_time_to_filetime(modified).to_le_bytes()); // LastAccessTime
                    result_buf.extend_from_slice(&system_time_to_filetime(modified).to_le_bytes()); // LastWriteTime
                    result_buf.extend_from_slice(&system_time_to_filetime(modified).to_le_bytes()); // ChangeTime
                    result_buf.extend_from_slice(&size.to_le_bytes()); // EndOfFile
                    result_buf.extend_from_slice(&size.to_le_bytes()); // AllocationSize
                    result_buf.extend_from_slice(&attrs.to_le_bytes());
                    result_buf.extend_from_slice(&(name_bytes.len() as u32).to_le_bytes()); // FileNameLength
                    if info_class == FILE_BOTH_DIR_INFORMATION || info_class == FILE_FULL_DIR_INFORMATION {
                        result_buf.extend_from_slice(&0u32.to_le_bytes()); // EaSize
                    }
                    if info_class == FILE_BOTH_DIR_INFORMATION {
                        result_buf.push(0); // ShortNameLength
                        result_buf.extend_from_slice(&[0u8; 24]); // ShortName (empty)
                    }
                    result_buf.extend_from_slice(&name_bytes);

                    // Pad to 8-byte alignment
                    while result_buf.len() % 8 != 0 {
                        result_buf.push(0);
                    }

                    // Set NextEntryOffset for previous entry
                    if i + 1 < dir_entries.len() {
                        let current_end = result_buf.len();
                        let entry_len = current_end - offset_pos;
                        let bytes = (entry_len as u32).to_le_bytes();
                        result_buf[offset_pos..offset_pos + 4].copy_from_slice(&bytes);
                    }
                }
                FILE_NAMES_INFORMATION => {
                    result_buf.extend_from_slice(&0u32.to_le_bytes()); // NextEntryOffset
                    result_buf.extend_from_slice(&(i as u32).to_le_bytes());
                    result_buf.extend_from_slice(&(name_bytes.len() as u32).to_le_bytes());
                    result_buf.extend_from_slice(&name_bytes);
                    while result_buf.len() % 8 != 0 { result_buf.push(0); }
                }
                _ => {
                    return (STATUS_NOT_SUPPORTED, Vec::new());
                }
            }
        }

        entry.dir_enum_done = true;

        if result_buf.is_empty() {
            return (STATUS_NO_MORE_FILES, Vec::new());
        }

        (STATUS_SUCCESS, wrap_buffer(&result_buf))
    }
}

// ── Helpers ──────────────────────────────────────────────────────────

fn metadata_to_attrs(meta: &fs::Metadata) -> u32 {
    let mut attrs = 0u32;
    if meta.is_dir() {
        attrs |= FILE_ATTRIBUTE_DIRECTORY;
    }
    if meta.permissions().readonly() {
        attrs |= FILE_ATTRIBUTE_READONLY;
    }
    if attrs == 0 {
        attrs = FILE_ATTRIBUTE_ARCHIVE;
    }
    attrs
}

/// Wrap output data with a 4-byte length prefix (required by some IRP responses).
fn wrap_buffer(data: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(4 + data.len());
    out.extend_from_slice(&(data.len() as u32).to_le_bytes());
    out.extend_from_slice(data);
    out
}

/// Build the output buffer for IRP_MJ_CREATE response.
fn create_response(file_id: u32, information: u32) -> Vec<u8> {
    let mut out = Vec::with_capacity(9);
    out.extend_from_slice(&file_id.to_le_bytes());
    out.push(information as u8); // Information (FILE_OPENED=1, FILE_CREATED=2, etc.)
    out
}
