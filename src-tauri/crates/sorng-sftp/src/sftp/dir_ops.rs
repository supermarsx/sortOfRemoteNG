// ── Directory operations ─────────────────────────────────────────────────────

use crate::sftp::file_ops::{entry_type_from_stat, format_permissions};
use crate::sftp::service::SftpService;
use crate::sftp::types::*;
use glob::Pattern;
use log::info;
use std::path::Path;

impl SftpService {
    // ── List directory ───────────────────────────────────────────────────────

    pub async fn list_directory(
        &mut self,
        session_id: &str,
        path: &str,
        options: SftpListOptions,
    ) -> Result<Vec<SftpDirEntry>, String> {
        if options.recursive {
            return self.list_directory_recursive(session_id, path, &options, 0).await;
        }
        self.list_directory_flat(session_id, path, &options)
    }

    fn list_directory_flat(
        &mut self,
        session_id: &str,
        path: &str,
        options: &SftpListOptions,
    ) -> Result<Vec<SftpDirEntry>, String> {
        let (sftp, _handle) = self.sftp_channel(session_id)?;

        let raw_entries = sftp
            .readdir(Path::new(path))
            .map_err(|e| format!("readdir '{}' failed: {}", path, e))?;

        let glob_pattern = options
            .filter_glob
            .as_deref()
            .and_then(|g| Pattern::new(g).ok());

        let mut entries: Vec<SftpDirEntry> = raw_entries
            .into_iter()
            .filter_map(|(entry_path, stat)| {
                let name = entry_path
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default();

                if name == "." || name == ".." {
                    return None;
                }

                let is_hidden = name.starts_with('.');
                if !options.include_hidden && is_hidden {
                    return None;
                }

                let etype = entry_type_from_stat(&stat);

                // Type filter
                if let Some(ref ft) = options.filter_type {
                    if &etype != ft {
                        return None;
                    }
                }

                // Glob filter
                if let Some(ref pat) = glob_pattern {
                    if !pat.matches(&name) {
                        return None;
                    }
                }

                let perm = stat.perm.unwrap_or(0);

                // Resolve symlink target
                let link_target = if etype == SftpEntryType::Symlink {
                    sftp.readlink(&entry_path)
                        .ok()
                        .map(|p| p.to_string_lossy().to_string())
                } else {
                    None
                };

                Some(SftpDirEntry {
                    name,
                    path: entry_path.to_string_lossy().to_string(),
                    entry_type: etype,
                    size: stat.size.unwrap_or(0),
                    permissions: perm,
                    permissions_string: format_permissions(perm),
                    owner_uid: stat.uid.unwrap_or(0),
                    group_gid: stat.gid.unwrap_or(0),
                    accessed: stat.atime.map(|v| v as u64),
                    modified: stat.mtime.map(|v| v as u64),
                    is_hidden,
                    link_target,
                })
            })
            .collect();

        // Sort
        sort_entries(&mut entries, &options.sort_by, options.ascending);

        Ok(entries)
    }

    async fn list_directory_recursive(
        &mut self,
        session_id: &str,
        path: &str,
        options: &SftpListOptions,
        depth: u32,
    ) -> Result<Vec<SftpDirEntry>, String> {
        if let Some(max_depth) = options.max_depth {
            if depth > max_depth {
                return Ok(Vec::new());
            }
        }

        let mut flat = self.list_directory_flat(session_id, path, options)?;
        let subdirs: Vec<String> = flat
            .iter()
            .filter(|e| e.entry_type == SftpEntryType::Directory)
            .map(|e| e.path.clone())
            .collect();

        for subdir in subdirs {
            let sub_entries = Box::pin(self.list_directory_recursive(
                session_id,
                &subdir,
                options,
                depth + 1,
            ))
            .await?;
            flat.extend(sub_entries);
        }

        Ok(flat)
    }

    // ── mkdir ────────────────────────────────────────────────────────────────

    pub async fn mkdir(
        &mut self,
        session_id: &str,
        path: &str,
        mode: Option<u32>,
    ) -> Result<(), String> {
        let (sftp, _handle) = self.sftp_channel(session_id)?;
        let file_mode = mode.unwrap_or(0o755) as i32;
        sftp.mkdir(Path::new(path), file_mode)
            .map_err(|e| format!("mkdir '{}' failed: {}", path, e))?;
        info!("SFTP mkdir: {}", path);
        Ok(())
    }

    /// Create directory and all parent directories (like `mkdir -p`).
    pub async fn mkdir_p(
        &mut self,
        session_id: &str,
        path: &str,
        mode: Option<u32>,
    ) -> Result<(), String> {
        let (sftp, _handle) = self.sftp_channel(session_id)?;
        let file_mode = mode.unwrap_or(0o755) as i32;

        // Collect path components and create from root
        let parts: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
        let mut current = String::new();

        for part in parts {
            current.push('/');
            current.push_str(part);

            // Check if it already exists
            if sftp.stat(Path::new(&current)).is_ok() {
                continue;
            }

            sftp.mkdir(Path::new(&current), file_mode)
                .map_err(|e| format!("mkdir_p '{}' failed at '{}': {}", path, current, e))?;
        }

        info!("SFTP mkdir -p: {}", path);
        Ok(())
    }

    // ── rmdir ────────────────────────────────────────────────────────────────

    pub async fn rmdir(
        &mut self,
        session_id: &str,
        path: &str,
    ) -> Result<(), String> {
        let (sftp, _handle) = self.sftp_channel(session_id)?;
        sftp.rmdir(Path::new(path))
            .map_err(|e| format!("rmdir '{}' failed: {}", path, e))?;
        info!("SFTP rmdir: {}", path);
        Ok(())
    }

    // ── Disk-usage (recursive size) ──────────────────────────────────────────

    pub async fn disk_usage(
        &mut self,
        session_id: &str,
        path: &str,
    ) -> Result<DiskUsageResult, String> {
        let options = SftpListOptions {
            include_hidden: true,
            sort_by: SftpSortField::Name,
            ascending: true,
            filter_glob: None,
            filter_type: None,
            recursive: true,
            max_depth: None,
        };

        let entries = self.list_directory(session_id, path, options).await?;

        let file_count = entries
            .iter()
            .filter(|e| e.entry_type == SftpEntryType::File)
            .count() as u64;
        let dir_count = entries
            .iter()
            .filter(|e| e.entry_type == SftpEntryType::Directory)
            .count() as u64;
        let total_bytes: u64 = entries.iter().map(|e| e.size).sum();

        Ok(DiskUsageResult {
            path: path.to_string(),
            total_bytes,
            file_count,
            directory_count: dir_count,
        })
    }

    // ── Search ───────────────────────────────────────────────────────────────

    pub async fn search(
        &mut self,
        session_id: &str,
        root: &str,
        pattern: &str,
        max_results: Option<usize>,
    ) -> Result<Vec<SftpDirEntry>, String> {
        let glob = Pattern::new(pattern)
            .map_err(|e| format!("Invalid search pattern '{}': {}", pattern, e))?;

        let options = SftpListOptions {
            include_hidden: true,
            sort_by: SftpSortField::Name,
            ascending: true,
            filter_glob: None,
            filter_type: None,
            recursive: true,
            max_depth: Some(20),
        };

        let all = self.list_directory(session_id, root, options).await?;
        let limit = max_results.unwrap_or(500);

        let matched: Vec<SftpDirEntry> = all
            .into_iter()
            .filter(|e| glob.matches(&e.name))
            .take(limit)
            .collect();

        Ok(matched)
    }
}

// ── Sorting helper ───────────────────────────────────────────────────────────

fn sort_entries(entries: &mut Vec<SftpDirEntry>, field: &SftpSortField, ascending: bool) {
    entries.sort_by(|a, b| {
        // Directories first, always
        let dir_cmp = b
            .entry_type
            .eq(&SftpEntryType::Directory)
            .cmp(&a.entry_type.eq(&SftpEntryType::Directory));
        if dir_cmp != std::cmp::Ordering::Equal {
            return dir_cmp;
        }

        let cmp = match field {
            SftpSortField::Name => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
            SftpSortField::Size => a.size.cmp(&b.size),
            SftpSortField::Modified => a.modified.cmp(&b.modified),
            SftpSortField::Type => format!("{:?}", a.entry_type).cmp(&format!("{:?}", b.entry_type)),
            SftpSortField::Permissions => a.permissions.cmp(&b.permissions),
        };

        if ascending {
            cmp
        } else {
            cmp.reverse()
        }
    });
}

// ── Extra result types (not in types.rs to avoid circular ref) ───────────────

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskUsageResult {
    pub path: String,
    pub total_bytes: u64,
    pub file_count: u64,
    pub directory_count: u64,
}
