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
    dir_entries: Vec<std::fs::DirEntry>,
    dir_index: usize,
}

/// Encode a string as UTF-16LE WITHOUT null terminator (for FileName fields in dir info structs).
fn encode_utf16le_no_null(s: &str) -> Vec<u8> {
    s.encode_utf16().flat_map(|ch| ch.to_le_bytes()).collect()
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
    /// Returns None for IRPs that should be discarded (no response sent).
    pub fn handle_irp(&mut self, major: u32, minor: u32, completion_id: u32, file_id: u32, data: &[u8]) -> Option<Vec<u8>> {
        // IRP_MN_NOTIFY_CHANGE_DIRECTORY: discard, don't respond (matches FreeRDP)
        if major == IRP_MJ_DIRECTORY_CONTROL && minor == IRP_MN_NOTIFY_CHANGE_DIRECTORY {
            log::debug!("RDPDR: discarding IRP_MN_NOTIFY_CHANGE_DIRECTORY (no response, per FreeRDP)");
            return None;
        }

        let (status, output) = match major {
            IRP_MJ_CREATE => self.handle_create(data),
            IRP_MJ_CLOSE => self.handle_close(file_id),
            IRP_MJ_READ => self.handle_read(file_id, data),
            IRP_MJ_WRITE => self.handle_write(file_id, data),
            IRP_MJ_QUERY_INFORMATION => self.handle_query_info(file_id, data),
            IRP_MJ_SET_INFORMATION => self.handle_set_info(file_id, data),
            IRP_MJ_QUERY_VOLUME_INFORMATION => self.handle_query_volume(data),
            IRP_MJ_DIRECTORY_CONTROL => self.handle_directory_control(file_id, minor, data),
            IRP_MJ_DEVICE_CONTROL => self.handle_device_control(data),
            IRP_MJ_LOCK_CONTROL => (STATUS_SUCCESS, Vec::new()),
            _ => {
                log::warn!("RDPDR: unsupported IRP major=0x{:X}", major);
                (STATUS_NOT_SUPPORTED, Vec::new())
            }
        };
        Some(build_io_completion(self.device_id, completion_id, status, &output))
    }

    /// Resolve a remote path to a local path, preventing traversal.
    fn resolve_path(&self, remote_path: &str) -> Option<PathBuf> {
        // Remote paths use backslash, may start with backslash
        let cleaned = remote_path.trim_start_matches('\\').replace('\\', std::path::MAIN_SEPARATOR_STR);
        if cleaned.is_empty() || cleaned == "." {
            return Some(self.root_path.clone());
        }

        // Block obvious traversal attempts
        if cleaned.contains("..") {
            log::warn!("RDPDR: path traversal blocked: {:?}", remote_path);
            return None;
        }

        let candidate = self.root_path.join(&cleaned);

        // Verify the joined path is still under root by comparing canonical forms.
        // For existing paths we can canonicalize; for non-existing we check the parent.
        let check_path = if candidate.exists() {
            candidate.clone()
        } else if let Some(parent) = candidate.parent() {
            if parent.exists() { parent.to_path_buf() } else { return Some(candidate); }
        } else {
            return Some(candidate);
        };

        match (check_path.canonicalize(), self.root_path.canonicalize()) {
            (Ok(canonical), Ok(root_canonical)) => {
                if canonical.starts_with(&root_canonical) {
                    Some(candidate) // Return the original joined path, not the \\?\ canonical
                } else {
                    log::warn!("RDPDR: path traversal blocked: {:?} -> {:?}", remote_path, canonical);
                    None
                }
            }
            _ => Some(candidate), // Can't canonicalize — allow (best effort)
        }
    }

    // ── IRP Handlers ─────────────────────────────────────────────────

    fn handle_create(&mut self, data: &[u8]) -> (u32, Vec<u8>) {
        if data.len() < 32 {
            log::warn!("RDPDR CREATE: data too short ({} bytes)", data.len());
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
        log::info!(
            "RDPDR CREATE: path='{}' access=0x{:X} disposition={} options=0x{:X} path_len={}",
            remote_path, desired_access, create_disposition, create_options, path_length
        );

        let local_path = match self.resolve_path(&remote_path) {
            Some(p) => {
                log::info!("RDPDR CREATE: resolved '{}' -> {:?}", remote_path, p);
                p
            }
            None => {
                log::warn!("RDPDR CREATE: resolve_path FAILED for '{}'", remote_path);
                return (STATUS_ACCESS_DENIED, create_response(0, 0));
            }
        };

        // Check if target is a directory — either by create_options flag OR by
        // inspecting the filesystem. Explorer often opens directories without
        // FILE_DIRECTORY_FILE for attribute queries. But respect FILE_NON_DIRECTORY_FILE.
        let target_is_dir = local_path.is_dir();
        let non_dir_requested = create_options & FILE_NON_DIRECTORY_FILE != 0;
        let is_directory = if non_dir_requested { false } else { (create_options & FILE_DIRECTORY_FILE != 0) || target_is_dir };
        let delete_on_close = create_options & FILE_DELETE_ON_CLOSE != 0;
        let want_write = desired_access & 0x0002 != 0 // FILE_WRITE_DATA
            || desired_access & 0x0004 != 0 // FILE_APPEND_DATA
            || desired_access & 0x0100 != 0 // FILE_WRITE_ATTRIBUTES
            || desired_access & 0x0040_0000 != 0; // GENERIC_WRITE

        if self.read_only && delete_on_close {
            return (STATUS_ACCESS_DENIED, create_response(0, 0));
        }
        if self.read_only && want_write {
            // On read-only drives, reject creates/overwrites but allow opening
            // existing files (server may request write access for attribute queries)
            if create_disposition != FILE_OPEN && create_disposition != FILE_OPEN_IF {
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
                    dir_entries: Vec::new(),
                    dir_index: 0,
            });
            (STATUS_SUCCESS, if exists { 1u32 } else { 2u32 }) // FILE_OPENED / FILE_CREATED
        } else {
            // Trying to open a directory as a file — return error
            if target_is_dir && non_dir_requested {
                return (STATUS_ACCESS_DENIED, create_response(0, 0));
            }
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
                    dir_entries: Vec::new(),
                    dir_index: 0,
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
        log::info!("RDPDR QUERY_INFO: file_id={} info_class={}", file_id, read_u32(data, 0));
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
                let mut out = Vec::with_capacity(36);
                let ft_created = system_time_to_filetime(created);
                let ft_accessed = system_time_to_filetime(accessed);
                let ft_modified = system_time_to_filetime(modified);
                out.extend_from_slice(&ft_created.to_le_bytes());  // CreationTime (8)
                out.extend_from_slice(&ft_accessed.to_le_bytes()); // LastAccessTime (8)
                out.extend_from_slice(&ft_modified.to_le_bytes()); // LastWriteTime (8)
                out.extend_from_slice(&ft_modified.to_le_bytes()); // ChangeTime (8)
                out.extend_from_slice(&attrs.to_le_bytes());       // FileAttributes (4)
                (STATUS_SUCCESS, wrap_buffer(&out))
            }
            FILE_STANDARD_INFORMATION => {
                let mut out = Vec::with_capacity(22);
                out.extend_from_slice(&size.to_le_bytes());        // AllocationSize (8)
                out.extend_from_slice(&size.to_le_bytes());        // EndOfFile (8)
                out.extend_from_slice(&1u32.to_le_bytes());        // NumberOfLinks (4)
                out.push(0);                                       // DeletePending (1)
                out.push(if metadata.is_dir() { 1 } else { 0 });  // Directory (1)
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
        log::info!("RDPDR QUERY_VOLUME: info_class={}", info_class);

        match info_class {
            FILE_FS_VOLUME_INFORMATION => {
                let label = encode_utf16le("SORNG"); // FreeRDP includes null terminator
                let mut out = Vec::with_capacity(17 + label.len());
                out.extend_from_slice(&0u64.to_le_bytes()); // VolumeCreationTime (8)
                out.extend_from_slice(&0u32.to_le_bytes()); // VolumeSerialNumber (4)
                out.extend_from_slice(&(label.len() as u32).to_le_bytes()); // VolumeLabelLength (4)
                out.push(0); // SupportsObjects (1)
                // No Reserved byte — packed wire format (17 bytes fixed, matching FreeRDP)
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
                let fs_name = encode_utf16le("FAT32"); // FreeRDP includes null terminator
                let mut out = Vec::with_capacity(12 + fs_name.len());
                out.extend_from_slice(&0x0000_001Fu32.to_le_bytes()); // FileSystemAttributes
                out.extend_from_slice(&255u32.to_le_bytes());         // MaximumComponentNameLength
                out.extend_from_slice(&(fs_name.len() as u32).to_le_bytes()); // FileSystemNameLength (no null)
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

    fn handle_device_control(&self, data: &[u8]) -> (u32, Vec<u8>) {
        if data.len() < 4 {
            return (STATUS_NOT_SUPPORTED, Vec::new());
        }
        let output_buffer_length = read_u32(data, 0);
        let input_buffer_length = if data.len() >= 8 { read_u32(data, 4) } else { 0 };
        let ioctl_code = if data.len() >= 12 { read_u32(data, 8) } else { 0 };
        log::info!("RDPDR IOCTL: code=0x{:08X} in_len={} out_len={}", ioctl_code, input_buffer_length, output_buffer_length);

        // Return empty success for common IOCTLs that check drive readiness
        let mut out = Vec::with_capacity(4);
        out.extend_from_slice(&0u32.to_le_bytes()); // OutputBufferLength = 0
        (STATUS_SUCCESS, out)
    }

    fn handle_directory_control(&mut self, file_id: u32, minor: u32, data: &[u8]) -> (u32, Vec<u8>) {
        // IRP_MN_NOTIFY_CHANGE_DIRECTORY is handled (discarded) in handle_irp
        if minor != IRP_MN_QUERY_DIRECTORY || data.len() < 32 {
            return (STATUS_NOT_SUPPORTED, Vec::new());
        }

        let info_class = read_u32(data, 0);
        let initial_query = data[4] != 0;
        // PathLength at offset 5, path data at offset 32 (after 23 bytes padding)
        let path_length = read_u32(data, 5) as usize;
        let pattern = if path_length > 0 && data.len() >= 32 + path_length {
            decode_utf16le(&data[32..32 + path_length])
        } else {
            "*".to_string()
        };
        log::info!(
            "RDPDR DIR_QUERY: file_id={} info_class={} initial={} pattern='{}' data_len={}",
            file_id, info_class, initial_query, pattern, data.len()
        );

        let entry = match self.open_files.get_mut(&file_id) {
            Some(e) if e.is_directory => e,
            _ => return (STATUS_UNSUCCESSFUL, Vec::new()),
        };

        // On initial query, read directory and reset index
        if initial_query {
            log::info!("RDPDR DIR_QUERY: reading directory {:?}", entry.path);
            entry.dir_entries = match fs::read_dir(&entry.path) {
                Ok(rd) => {
                    let entries: Vec<_> = rd.filter_map(|e| e.ok()).collect();
                    log::info!("RDPDR DIR_QUERY: found {} entries in {:?}", entries.len(), entry.path);
                    entries
                }
                Err(e) => {
                    log::error!("RDPDR DIR_QUERY: read_dir FAILED for {:?}: {}", entry.path, e);
                    return (STATUS_UNSUCCESSFUL, vec![0u8; 5]);
                }
            };
            entry.dir_index = 0;
            entry.dir_enum_done = false;
        } else {
            log::info!("RDPDR DIR_QUERY: continuation query, index={} of {} entries", entry.dir_index, entry.dir_entries.len());
        }

        if entry.dir_enum_done {
            return (STATUS_NO_MORE_FILES, vec![0u8; 5]);
        }

        // Find the next matching entry (one per IRP, matching FreeRDP behavior)
        loop {
            if entry.dir_index >= entry.dir_entries.len() {
                entry.dir_enum_done = true;
                return (STATUS_NO_MORE_FILES, vec![0u8; 5]);
            }

            let dir_entry = &entry.dir_entries[entry.dir_index];
            entry.dir_index += 1;

            let name = dir_entry.file_name().to_string_lossy().to_string();

            // Extract just the filename portion from the pattern (server sends full path like \src\*)
            let file_pattern = pattern.rsplit('\\').next().unwrap_or(&pattern);
            if file_pattern != "*" && !file_pattern.is_empty() {
                let pat = file_pattern.replace('*', "");
                if !pat.is_empty() && !name.to_lowercase().contains(&pat.to_lowercase()) {
                    continue;
                }
            }

            let meta = match dir_entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };

            // Encode filename WITHOUT null terminator (MS-FSCC requirement)
            let name_bytes = encode_utf16le_no_null(&name);
            let attrs = metadata_to_attrs(&meta);
            let size = meta.len();
            let created = meta.created().unwrap_or(SystemTime::UNIX_EPOCH);
            let modified = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);

            let mut result_buf = Vec::new();

            match info_class {
                FILE_BOTH_DIR_INFORMATION | FILE_FULL_DIR_INFORMATION | FILE_DIRECTORY_INFORMATION => {
                    result_buf.extend_from_slice(&0u32.to_le_bytes()); // NextEntryOffset = 0 (single entry)
                    result_buf.extend_from_slice(&0u32.to_le_bytes()); // FileIndex
                    result_buf.extend_from_slice(&system_time_to_filetime(created).to_le_bytes());
                    result_buf.extend_from_slice(&system_time_to_filetime(modified).to_le_bytes()); // LastAccessTime
                    result_buf.extend_from_slice(&system_time_to_filetime(modified).to_le_bytes()); // LastWriteTime
                    result_buf.extend_from_slice(&system_time_to_filetime(modified).to_le_bytes()); // ChangeTime
                    result_buf.extend_from_slice(&size.to_le_bytes()); // EndOfFile
                    result_buf.extend_from_slice(&size.to_le_bytes()); // AllocationSize
                    result_buf.extend_from_slice(&attrs.to_le_bytes()); // FileAttributes
                    result_buf.extend_from_slice(&(name_bytes.len() as u32).to_le_bytes()); // FileNameLength
                    if info_class == FILE_BOTH_DIR_INFORMATION || info_class == FILE_FULL_DIR_INFORMATION {
                        result_buf.extend_from_slice(&0u32.to_le_bytes()); // EaSize
                    }
                    if info_class == FILE_BOTH_DIR_INFORMATION {
                        result_buf.push(0); // ShortNameLength (1)
                        // Note: RDPDR uses packed layout (93 bytes fixed), NOT the
                        // native Windows aligned struct (94 bytes). No Reserved1 byte.
                        result_buf.extend_from_slice(&[0u8; 24]); // ShortName[12] (24)
                    }
                    result_buf.extend_from_slice(&name_bytes); // FileName (no null terminator)
                }
                FILE_NAMES_INFORMATION => {
                    result_buf.extend_from_slice(&0u32.to_le_bytes()); // NextEntryOffset = 0
                    result_buf.extend_from_slice(&0u32.to_le_bytes()); // FileIndex
                    result_buf.extend_from_slice(&(name_bytes.len() as u32).to_le_bytes());
                    result_buf.extend_from_slice(&name_bytes);
                }
                _ => {
                    return (STATUS_NOT_SUPPORTED, Vec::new());
                }
            }

            return (STATUS_SUCCESS, wrap_buffer(&result_buf));
        }
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
