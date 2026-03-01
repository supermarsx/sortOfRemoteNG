// ── File operations (stat, rename, delete, chmod, chown, symlink, …) ────────

use crate::sftp::service::SftpService;
use crate::sftp::types::*;
use chrono::Utc;
use log::info;
use std::path::Path;

/// Convert an ssh2 `FileStat` + path into our richer `SftpFileStat`.
pub(crate) fn stat_to_file_stat(path: &str, stat: &ssh2::FileStat, link_target: Option<String>) -> SftpFileStat {
    let perm = stat.perm.unwrap_or(0);
    SftpFileStat {
        path: path.to_string(),
        size: stat.size.unwrap_or(0),
        permissions: perm,
        permissions_string: format_permissions(perm),
        owner_uid: stat.uid.unwrap_or(0),
        group_gid: stat.gid.unwrap_or(0),
        accessed: stat.atime.map(|v| v as u64),
        modified: stat.mtime.map(|v| v as u64),
        entry_type: entry_type_from_stat(stat),
        link_target,
        is_readonly: perm & 0o200 == 0,
    }
}

/// Compute a human-readable permissions string like "drwxr-xr-x".
pub(crate) fn format_permissions(mode: u32) -> String {
    let mut s = String::with_capacity(10);

    // Type character
    s.push(match mode & 0o170000 {
        0o040000 => 'd',
        0o120000 => 'l',
        0o010000 => 'p',
        0o140000 => 's',
        0o060000 => 'b',
        0o020000 => 'c',
        _ => '-',
    });

    // Owner
    s.push(if mode & 0o400 != 0 { 'r' } else { '-' });
    s.push(if mode & 0o200 != 0 { 'w' } else { '-' });
    s.push(if mode & 0o4000 != 0 {
        if mode & 0o100 != 0 { 's' } else { 'S' }
    } else if mode & 0o100 != 0 {
        'x'
    } else {
        '-'
    });

    // Group
    s.push(if mode & 0o040 != 0 { 'r' } else { '-' });
    s.push(if mode & 0o020 != 0 { 'w' } else { '-' });
    s.push(if mode & 0o2000 != 0 {
        if mode & 0o010 != 0 { 's' } else { 'S' }
    } else if mode & 0o010 != 0 {
        'x'
    } else {
        '-'
    });

    // Others
    s.push(if mode & 0o004 != 0 { 'r' } else { '-' });
    s.push(if mode & 0o002 != 0 { 'w' } else { '-' });
    s.push(if mode & 0o1000 != 0 {
        if mode & 0o001 != 0 { 't' } else { 'T' }
    } else if mode & 0o001 != 0 {
        'x'
    } else {
        '-'
    });

    s
}

/// Determine the entry type from an ssh2 stat.
pub(crate) fn entry_type_from_stat(stat: &ssh2::FileStat) -> SftpEntryType {
    let mode = stat.perm.unwrap_or(0);
    match mode & 0o170000 {
        0o040000 => SftpEntryType::Directory,
        0o120000 => SftpEntryType::Symlink,
        0o060000 => SftpEntryType::BlockDevice,
        0o020000 => SftpEntryType::CharDevice,
        0o010000 => SftpEntryType::NamedPipe,
        0o140000 => SftpEntryType::Socket,
        0o100000 => SftpEntryType::File,
        _ => {
            // Fall back to ssh2 helpers
            if stat.is_dir() {
                SftpEntryType::Directory
            } else if stat.is_file() {
                SftpEntryType::File
            } else {
                SftpEntryType::Unknown
            }
        }
    }
}

// ── SftpService file-ops impl ────────────────────────────────────────────────

impl SftpService {
    // ── stat / lstat ─────────────────────────────────────────────────────────

    pub async fn stat(&mut self, session_id: &str, path: &str) -> Result<SftpFileStat, String> {
        let (sftp, _handle) = self.sftp_channel(session_id)?;
        let stat = sftp
            .stat(Path::new(path))
            .map_err(|e| format!("stat failed for '{}': {}", path, e))?;
        let link_target = sftp
            .readlink(Path::new(path))
            .ok()
            .map(|p| p.to_string_lossy().to_string());
        Ok(stat_to_file_stat(path, &stat, link_target))
    }

    pub async fn lstat(&mut self, session_id: &str, path: &str) -> Result<SftpFileStat, String> {
        let (sftp, _handle) = self.sftp_channel(session_id)?;
        let stat = sftp
            .lstat(Path::new(path))
            .map_err(|e| format!("lstat failed for '{}': {}", path, e))?;
        let link_target = sftp
            .readlink(Path::new(path))
            .ok()
            .map(|p| p.to_string_lossy().to_string());
        Ok(stat_to_file_stat(path, &stat, link_target))
    }

    // ── rename ───────────────────────────────────────────────────────────────

    pub async fn rename(
        &mut self,
        session_id: &str,
        old_path: &str,
        new_path: &str,
        overwrite: bool,
    ) -> Result<(), String> {
        let (sftp, _handle) = self.sftp_channel(session_id)?;

        if overwrite {
            // Remove target first if it exists (SFTP rename does not overwrite)
            let _ = sftp.unlink(Path::new(new_path));
        }

        sftp.rename(
            Path::new(old_path),
            Path::new(new_path),
            Some(ssh2::RenameFlags::OVERWRITE | ssh2::RenameFlags::ATOMIC | ssh2::RenameFlags::NATIVE),
        )
        .map_err(|e| format!("rename '{}' → '{}' failed: {}", old_path, new_path, e))?;

        info!("SFTP rename: {} → {}", old_path, new_path);
        Ok(())
    }

    // ── unlink (delete file) ─────────────────────────────────────────────────

    pub async fn delete_file(
        &mut self,
        session_id: &str,
        path: &str,
    ) -> Result<(), String> {
        let (sftp, _handle) = self.sftp_channel(session_id)?;
        sftp.unlink(Path::new(path))
            .map_err(|e| format!("delete '{}' failed: {}", path, e))?;
        info!("SFTP deleted file: {}", path);
        Ok(())
    }

    // ── Delete directory tree recursively ────────────────────────────────────

    pub async fn delete_recursive(
        &mut self,
        session_id: &str,
        path: &str,
    ) -> Result<u64, String> {
        // We need to collect all entries first, then delete bottom-up
        let entries = self.collect_tree(session_id, path)?;
        let mut count: u64 = 0;

        let (sftp, _handle) = self.sftp_channel(session_id)?;

        // Delete files first, then directories (reverse order preserves bottom-up)
        for entry in entries.iter().rev() {
            if entry.entry_type == SftpEntryType::Directory {
                sftp.rmdir(Path::new(&entry.path))
                    .map_err(|e| format!("rmdir '{}' failed: {}", entry.path, e))?;
            } else {
                sftp.unlink(Path::new(&entry.path))
                    .map_err(|e| format!("delete '{}' failed: {}", entry.path, e))?;
            }
            count += 1;
        }

        // Finally remove the root directory itself
        sftp.rmdir(Path::new(path))
            .map_err(|e| format!("rmdir '{}' failed: {}", path, e))?;
        count += 1;

        info!("SFTP recursive delete: {} ({} items)", path, count);
        Ok(count)
    }

    /// Internal helper to collect a directory tree for recursive operations.
    fn collect_tree(
        &mut self,
        session_id: &str,
        path: &str,
    ) -> Result<Vec<SftpDirEntry>, String> {
        let (sftp, _handle) = self.sftp_channel(session_id)?;
        let mut result = Vec::new();
        let mut stack: Vec<String> = vec![path.to_string()];

        while let Some(dir) = stack.pop() {
            let entries = sftp
                .readdir(Path::new(&dir))
                .map_err(|e| format!("readdir '{}' failed: {}", dir, e))?;

            for (entry_path, stat) in entries {
                let name = entry_path
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default();

                if name == "." || name == ".." {
                    continue;
                }

                let full = entry_path.to_string_lossy().to_string();
                let etype = entry_type_from_stat(&stat);

                if etype == SftpEntryType::Directory {
                    stack.push(full.clone());
                }

                result.push(SftpDirEntry {
                    name: name.clone(),
                    path: full,
                    entry_type: etype,
                    size: stat.size.unwrap_or(0),
                    permissions: stat.perm.unwrap_or(0),
                    permissions_string: format_permissions(stat.perm.unwrap_or(0)),
                    owner_uid: stat.uid.unwrap_or(0),
                    group_gid: stat.gid.unwrap_or(0),
                    accessed: stat.atime.map(|v| v as u64),
                    modified: stat.mtime.map(|v| v as u64),
                    is_hidden: name.starts_with('.'),
                    link_target: None,
                });
            }
        }

        Ok(result)
    }

    // ── chmod ────────────────────────────────────────────────────────────────

    pub async fn chmod(
        &mut self,
        session_id: &str,
        request: SftpChmodRequest,
    ) -> Result<u64, String> {
        if request.recursive {
            return self.chmod_recursive(session_id, &request.path, request.mode).await;
        }

        let (sftp, _handle) = self.sftp_channel(session_id)?;
        let mut stat = sftp
            .stat(Path::new(&request.path))
            .map_err(|e| format!("stat '{}' failed: {}", request.path, e))?;
        stat.perm = Some(request.mode);
        sftp.setstat(Path::new(&request.path), stat)
            .map_err(|e| format!("chmod '{}' failed: {}", request.path, e))?;

        info!("SFTP chmod {} → {:o}", request.path, request.mode);
        Ok(1)
    }

    async fn chmod_recursive(
        &mut self,
        session_id: &str,
        path: &str,
        mode: u32,
    ) -> Result<u64, String> {
        let entries = self.collect_tree(session_id, path)?;
        let (sftp, _handle) = self.sftp_channel(session_id)?;
        let mut count: u64 = 0;

        // Set on root
        let mut root_stat = sftp
            .stat(Path::new(path))
            .map_err(|e| format!("stat '{}' failed: {}", path, e))?;
        root_stat.perm = Some(mode);
        sftp.setstat(Path::new(path), root_stat)
            .map_err(|e| format!("chmod '{}' failed: {}", path, e))?;
        count += 1;

        for entry in &entries {
            let mut st = sftp
                .stat(Path::new(&entry.path))
                .map_err(|e| format!("stat '{}' failed: {}", entry.path, e))?;
            st.perm = Some(mode);
            sftp.setstat(Path::new(&entry.path), st)
                .map_err(|e| format!("chmod '{}' failed: {}", entry.path, e))?;
            count += 1;
        }

        info!("SFTP recursive chmod {} → {:o} ({} items)", path, mode, count);
        Ok(count)
    }

    // ── chown ────────────────────────────────────────────────────────────────

    pub async fn chown(
        &mut self,
        session_id: &str,
        request: SftpChownRequest,
    ) -> Result<u64, String> {
        if request.recursive {
            return self.chown_recursive(session_id, &request).await;
        }

        let (sftp, _handle) = self.sftp_channel(session_id)?;
        let mut stat = sftp
            .stat(Path::new(&request.path))
            .map_err(|e| format!("stat '{}' failed: {}", request.path, e))?;

        if let Some(uid) = request.uid {
            stat.uid = Some(uid);
        }
        if let Some(gid) = request.gid {
            stat.gid = Some(gid);
        }
        sftp.setstat(Path::new(&request.path), stat)
            .map_err(|e| format!("chown '{}' failed: {}", request.path, e))?;

        info!("SFTP chown {}: uid={:?} gid={:?}", request.path, request.uid, request.gid);
        Ok(1)
    }

    async fn chown_recursive(
        &mut self,
        session_id: &str,
        request: &SftpChownRequest,
    ) -> Result<u64, String> {
        let entries = self.collect_tree(session_id, &request.path)?;
        let (sftp, _handle) = self.sftp_channel(session_id)?;
        let mut count: u64 = 0;

        // Root entry
        let mut root_stat = sftp
            .stat(Path::new(&request.path))
            .map_err(|e| e.to_string())?;
        if let Some(uid) = request.uid {
            root_stat.uid = Some(uid);
        }
        if let Some(gid) = request.gid {
            root_stat.gid = Some(gid);
        }
        sftp.setstat(Path::new(&request.path), root_stat)
            .map_err(|e| e.to_string())?;
        count += 1;

        for entry in &entries {
            let mut st = sftp
                .stat(Path::new(&entry.path))
                .map_err(|e| e.to_string())?;
            if let Some(uid) = request.uid {
                st.uid = Some(uid);
            }
            if let Some(gid) = request.gid {
                st.gid = Some(gid);
            }
            sftp.setstat(Path::new(&entry.path), st)
                .map_err(|e| e.to_string())?;
            count += 1;
        }

        Ok(count)
    }

    // ── Symlink / readlink ───────────────────────────────────────────────────

    pub async fn create_symlink(
        &mut self,
        session_id: &str,
        target: &str,
        link_path: &str,
    ) -> Result<(), String> {
        let (sftp, _handle) = self.sftp_channel(session_id)?;
        sftp.symlink(Path::new(target), Path::new(link_path))
            .map_err(|e| format!("symlink '{}' → '{}' failed: {}", link_path, target, e))?;
        info!("SFTP symlink: {} → {}", link_path, target);
        Ok(())
    }

    pub async fn read_link(
        &mut self,
        session_id: &str,
        path: &str,
    ) -> Result<String, String> {
        let (sftp, _handle) = self.sftp_channel(session_id)?;
        let target = sftp
            .readlink(Path::new(path))
            .map_err(|e| format!("readlink '{}' failed: {}", path, e))?;
        Ok(target.to_string_lossy().to_string())
    }

    // ── Touch (update mtime) ─────────────────────────────────────────────────

    pub async fn touch(
        &mut self,
        session_id: &str,
        path: &str,
    ) -> Result<(), String> {
        let (sftp, _handle) = self.sftp_channel(session_id)?;
        let now = Utc::now().timestamp() as u64;

        // Try to stat first – if it exists, update mtime; if not, create empty file
        match sftp.stat(Path::new(path)) {
            Ok(mut stat) => {
                stat.mtime = Some(now);
                sftp.setstat(Path::new(path), stat)
                    .map_err(|e| format!("touch '{}' setstat failed: {}", path, e))?;
            }
            Err(_) => {
                // Create empty file
                let _file = sftp
                    .create(Path::new(path))
                    .map_err(|e| format!("touch '{}' create failed: {}", path, e))?;
            }
        }

        Ok(())
    }

    // ── Truncate ─────────────────────────────────────────────────────────────

    pub async fn truncate(
        &mut self,
        session_id: &str,
        path: &str,
        size: u64,
    ) -> Result<(), String> {
        let (sftp, _handle) = self.sftp_channel(session_id)?;
        let mut stat = sftp
            .stat(Path::new(path))
            .map_err(|e| format!("stat '{}' failed: {}", path, e))?;
        stat.size = Some(size);
        sftp.setstat(Path::new(path), stat)
            .map_err(|e| format!("truncate '{}' failed: {}", path, e))?;
        Ok(())
    }

    // ── Read small text file ─────────────────────────────────────────────────

    pub async fn read_text_file(
        &mut self,
        session_id: &str,
        path: &str,
        max_bytes: Option<u64>,
    ) -> Result<String, String> {
        let (sftp, handle) = self.sftp_channel(session_id)?;
        let mut file = sftp
            .open(Path::new(path))
            .map_err(|e| format!("open '{}' failed: {}", path, e))?;

        let limit = max_bytes.unwrap_or(10 * 1024 * 1024) as usize; // default 10 MiB
        let mut buf = Vec::with_capacity(std::cmp::min(limit, 1024 * 64));
        let mut total = 0usize;

        loop {
            let mut chunk = vec![0u8; 32768];
            let n = std::io::Read::read(&mut file, &mut chunk)
                .map_err(|e| format!("read '{}' failed: {}", path, e))?;
            if n == 0 {
                break;
            }
            total += n;
            if total > limit {
                return Err(format!(
                    "File '{}' exceeds max read size ({} bytes)",
                    path, limit
                ));
            }
            buf.extend_from_slice(&chunk[..n]);
        }

        handle.info.bytes_downloaded += total as u64;

        String::from_utf8(buf).map_err(|_| format!("File '{}' is not valid UTF-8", path))
    }

    // ── Write small text file ────────────────────────────────────────────────

    pub async fn write_text_file(
        &mut self,
        session_id: &str,
        path: &str,
        content: &str,
    ) -> Result<u64, String> {
        let (sftp, handle) = self.sftp_channel(session_id)?;
        let mut file = sftp
            .create(Path::new(path))
            .map_err(|e| format!("create '{}' failed: {}", path, e))?;

        let bytes = content.as_bytes();
        std::io::Write::write_all(&mut file, bytes)
            .map_err(|e| format!("write '{}' failed: {}", path, e))?;

        handle.info.bytes_uploaded += bytes.len() as u64;

        Ok(bytes.len() as u64)
    }

    // ── Checksum (SHA-256) ───────────────────────────────────────────────────

    pub async fn checksum(
        &mut self,
        session_id: &str,
        path: &str,
    ) -> Result<String, String> {
        use sha2::{Digest, Sha256};

        let (sftp, handle) = self.sftp_channel(session_id)?;
        let mut file = sftp
            .open(Path::new(path))
            .map_err(|e| format!("open '{}' failed: {}", path, e))?;

        let mut hasher = Sha256::new();
        let mut total = 0u64;
        loop {
            let mut chunk = vec![0u8; 65536];
            let n = std::io::Read::read(&mut file, &mut chunk)
                .map_err(|e| format!("read '{}' failed: {}", path, e))?;
            if n == 0 {
                break;
            }
            hasher.update(&chunk[..n]);
            total += n as u64;
        }

        handle.info.bytes_downloaded += total;

        let hash = hasher.finalize();
        Ok(hex::encode(hash))
    }

    // ── Exists ───────────────────────────────────────────────────────────────

    pub async fn exists(
        &mut self,
        session_id: &str,
        path: &str,
    ) -> Result<bool, String> {
        let (sftp, _handle) = self.sftp_channel(session_id)?;
        Ok(sftp.stat(Path::new(path)).is_ok())
    }
}
