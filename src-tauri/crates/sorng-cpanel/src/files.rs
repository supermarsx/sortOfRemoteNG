// ── cPanel file management ───────────────────────────────────────────────────

use crate::client::CpanelClient;
use crate::error::{CpanelError, CpanelResult};
use crate::types::*;

pub struct FileManager;

impl FileManager {
    /// List files/directories in a given path.
    pub async fn list_files(client: &CpanelClient, user: &str, dir: &str) -> CpanelResult<Vec<FileItem>> {
        let raw: serde_json::Value = client
            .whm_uapi(user, "Fileman", "list_files", &[("dir", dir)])
            .await?;
        let data = extract_data(&raw)?;
        serde_json::from_value(data).map_err(|e| CpanelError::parse(e.to_string()))
    }

    /// Get file/directory info.
    pub async fn get_file_info(client: &CpanelClient, user: &str, path: &str) -> CpanelResult<FileItem> {
        let raw: serde_json::Value = client
            .whm_uapi(user, "Fileman", "get_file_information", &[("path", path)])
            .await?;
        let data = extract_data(&raw)?;
        serde_json::from_value(data).map_err(|e| CpanelError::parse(e.to_string()))
    }

    /// Create a directory.
    pub async fn create_directory(client: &CpanelClient, user: &str, path: &str, name: &str) -> CpanelResult<String> {
        let raw: serde_json::Value = client
            .whm_uapi(
                user,
                "Fileman",
                "mkdir",
                &[("path", path), ("name", name)],
            )
            .await?;
        check_uapi(&raw)?;
        Ok(format!("Directory {name} created"))
    }

    /// Delete a file or directory.
    pub async fn delete(client: &CpanelClient, user: &str, path: &str) -> CpanelResult<String> {
        let raw: serde_json::Value = client
            .whm_uapi(user, "Fileman", "trash", &[("path", path)])
            .await?;
        check_uapi(&raw)?;
        Ok(format!("File/directory trashed: {path}"))
    }

    /// Copy a file.
    pub async fn copy(client: &CpanelClient, user: &str, source: &str, dest: &str) -> CpanelResult<String> {
        let raw: serde_json::Value = client
            .whm_uapi(
                user,
                "Fileman",
                "file_copy",
                &[("source", source), ("dest", dest)],
            )
            .await?;
        check_uapi(&raw)?;
        Ok(format!("Copied {source} → {dest}"))
    }

    /// Move/rename a file.
    pub async fn rename(client: &CpanelClient, user: &str, source: &str, dest: &str) -> CpanelResult<String> {
        let raw: serde_json::Value = client
            .whm_uapi(
                user,
                "Fileman",
                "file_move",
                &[("source", source), ("dest", dest)],
            )
            .await?;
        check_uapi(&raw)?;
        Ok(format!("Moved {source} → {dest}"))
    }

    /// Change file/directory permissions.
    pub async fn chmod(client: &CpanelClient, user: &str, path: &str, permissions: &str) -> CpanelResult<String> {
        let raw: serde_json::Value = client
            .whm_uapi(
                user,
                "Fileman",
                "set_file_permissions",
                &[("path", path), ("permissions", permissions)],
            )
            .await?;
        check_uapi(&raw)?;
        Ok(format!("Permissions set to {permissions} for {path}"))
    }

    /// Get disk usage info for a user.
    pub async fn get_disk_usage(client: &CpanelClient, user: &str) -> CpanelResult<DiskUsageInfo> {
        let raw: serde_json::Value = client
            .whm_uapi(user, "Quota", "get_quota_info", &[])
            .await?;
        let data = extract_data(&raw)?;
        serde_json::from_value(data).map_err(|e| CpanelError::parse(e.to_string()))
    }

    /// Compress files/directories.
    pub async fn compress(client: &CpanelClient, user: &str, path: &str, format: &str) -> CpanelResult<String> {
        let raw: serde_json::Value = client
            .whm_uapi(
                user,
                "Fileman",
                "file_and_dir_compress",
                &[("path", path), ("type", format)],
            )
            .await?;
        check_uapi(&raw)?;
        Ok(format!("Compressed {path}"))
    }

    /// Extract an archive.
    pub async fn extract(client: &CpanelClient, user: &str, path: &str, dest: &str) -> CpanelResult<String> {
        let raw: serde_json::Value = client
            .whm_uapi(
                user,
                "Fileman",
                "file_extract",
                &[("path", path), ("dest", dest)],
            )
            .await?;
        check_uapi(&raw)?;
        Ok(format!("Extracted {path} to {dest}"))
    }

    /// Empty the trash.
    pub async fn empty_trash(client: &CpanelClient, user: &str) -> CpanelResult<String> {
        let raw: serde_json::Value = client
            .whm_uapi(user, "Fileman", "empty_trash", &[])
            .await?;
        check_uapi(&raw)?;
        Ok("Trash emptied".into())
    }
}

fn extract_data(raw: &serde_json::Value) -> CpanelResult<serde_json::Value> {
    check_uapi(raw)?;
    Ok(raw
        .get("result")
        .and_then(|r| r.get("data"))
        .cloned()
        .unwrap_or(serde_json::Value::Array(vec![])))
}

fn check_uapi(raw: &serde_json::Value) -> CpanelResult<()> {
    let status = raw
        .get("result")
        .and_then(|r| r.get("status"))
        .and_then(|s| s.as_u64())
        .unwrap_or(1);
    if status == 0 {
        let errors = raw
            .get("result")
            .and_then(|r| r.get("errors"))
            .and_then(|e| e.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str())
                    .collect::<Vec<_>>()
                    .join("; ")
            })
            .unwrap_or_else(|| "UAPI call failed".into());
        return Err(CpanelError::api(errors));
    }
    Ok(())
}
