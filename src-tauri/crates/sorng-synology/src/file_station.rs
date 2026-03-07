//! File Station — browse, upload, download, search, sharing links.

use crate::client::SynoClient;
use crate::error::{SynologyError, SynologyResult};
use crate::types::*;

pub struct FileStationManager;

impl FileStationManager {
    /// Get File Station info (hostname, is_manager, etc.).
    pub async fn get_info(client: &SynoClient) -> SynologyResult<FileStationInfo> {
        let v = client.best_version("SYNO.FileStation.Info", 2).unwrap_or(1);
        client.api_call("SYNO.FileStation.Info", v, "get", &[]).await
    }

    /// List files in a folder.
    pub async fn list_files(
        client: &SynoClient,
        folder_path: &str,
        offset: u64,
        limit: u64,
        sort_by: &str,
        sort_direction: &str,
    ) -> SynologyResult<FileListResult> {
        let v = client.best_version("SYNO.FileStation.List", 2).unwrap_or(1);
        let off = offset.to_string();
        let lim = limit.to_string();
        client.api_call(
            "SYNO.FileStation.List",
            v,
            "list",
            &[
                ("folder_path", folder_path),
                ("offset", &off),
                ("limit", &lim),
                ("sort_by", sort_by),
                ("sort_direction", sort_direction),
                ("additional", "[\"size\",\"time\",\"type\",\"perm\",\"owner\",\"real_path\"]"),
            ],
        )
        .await
    }

    /// List shared root folders.
    pub async fn list_shared_folders(client: &SynoClient) -> SynologyResult<FileListResult> {
        let v = client.best_version("SYNO.FileStation.List", 2).unwrap_or(1);
        client.api_call(
            "SYNO.FileStation.List",
            v,
            "list_share",
            &[("additional", "[\"volume_status\",\"time\",\"perm\",\"owner\",\"real_path\"]")],
        )
        .await
    }

    /// Search for files.
    pub async fn search(
        client: &SynoClient,
        folder_path: &str,
        pattern: &str,
    ) -> SynologyResult<serde_json::Value> {
        let v = client.best_version("SYNO.FileStation.Search", 2).unwrap_or(1);
        // Start the search task
        let start_result: serde_json::Value = client
            .api_call(
                "SYNO.FileStation.Search",
                v,
                "start",
                &[
                    ("folder_path", folder_path),
                    ("pattern", pattern),
                    ("recursive", "true"),
                ],
            )
            .await?;

        let task_id = start_result
            .get("taskid")
            .and_then(|v| v.as_str())
            .ok_or_else(|| SynologyError::parse("No taskid in search start response"))?;

        // Poll for results
        for _ in 0..30 {
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
            let result: serde_json::Value = client
                .api_call(
                    "SYNO.FileStation.Search",
                    v,
                    "list",
                    &[("taskid", task_id), ("offset", "0"), ("limit", "500")],
                )
                .await?;

            let finished = result
                .get("finished")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);

            if finished {
                // Cleanup
                let _ = client.api_call_void(
                    "SYNO.FileStation.Search",
                    v,
                    "stop",
                    &[("taskid", task_id)],
                ).await;
                let _ = client.api_call_void(
                    "SYNO.FileStation.Search",
                    v,
                    "clean",
                    &[("taskid", task_id)],
                ).await;
                return Ok(result);
            }
        }

        Err(SynologyError::api(0, "Search timed out"))
    }

    /// Upload a file to a destination folder via multipart POST.
    pub async fn upload(
        client: &SynoClient,
        dest_folder_path: &str,
        file_name: &str,
        content: Vec<u8>,
        overwrite: bool,
    ) -> SynologyResult<()> {
        let v = client.best_version("SYNO.FileStation.Upload", 3).unwrap_or(2);
        let url = client.resolve_url("SYNO.FileStation.Upload", v, "upload")?;

        let overwrite_str = if overwrite { "true" } else { "false" };

        let part = reqwest::multipart::Part::bytes(content)
            .file_name(file_name.to_string())
            .mime_str("application/octet-stream")
            .map_err(|e| SynologyError::api(0, &format!("Multipart error: {}", e)))?;

        let form = reqwest::multipart::Form::new()
            .text("api", "SYNO.FileStation.Upload")
            .text("version", v.to_string())
            .text("method", "upload")
            .text("path", dest_folder_path.to_string())
            .text("create_parents", "true")
            .text("overwrite", overwrite_str.to_string())
            .part("file", part);

        let mut req = client.http_client().post(&url).multipart(form);
        if let Some(ref token) = client.syno_token {
            req = req.header("X-SYNO-TOKEN", token);
        }

        let resp = req.send().await?;
        let body: SynoResponse<serde_json::Value> = resp.json().await?;

        if body.success {
            Ok(())
        } else {
            let code = body.error.map(|e| e.code).unwrap_or(100);
            Err(SynologyError::from_dsm_code(code, "File upload"))
        }
    }

    /// Download a file as raw bytes.
    pub async fn download(
        client: &SynoClient,
        file_path: &str,
    ) -> SynologyResult<Vec<u8>> {
        let v = client.best_version("SYNO.FileStation.Download", 2).unwrap_or(1);
        client.raw_download(
            "SYNO.FileStation.Download",
            v,
            "download",
            &[("path", file_path), ("mode", "download")],
        ).await
    }

    /// Create a folder.
    pub async fn create_folder(
        client: &SynoClient,
        folder_path: &str,
        name: &str,
        force_parent: bool,
    ) -> SynologyResult<serde_json::Value> {
        let v = client.best_version("SYNO.FileStation.CreateFolder", 2).unwrap_or(1);
        let fp = if force_parent { "true" } else { "false" };
        client.api_call(
            "SYNO.FileStation.CreateFolder",
            v,
            "create",
            &[
                ("folder_path", folder_path),
                ("name", name),
                ("force_parent", fp),
            ],
        )
        .await
    }

    /// Delete file(s) or folder(s).
    pub async fn delete(
        client: &SynoClient,
        paths: &[&str],
        recursive: bool,
    ) -> SynologyResult<()> {
        let v = client.best_version("SYNO.FileStation.Delete", 2).unwrap_or(1);
        let path_str = format!("[{}]", paths.iter().map(|p| format!("\"{}\"", p)).collect::<Vec<_>>().join(","));
        let rec = if recursive { "true" } else { "false" };
        client.api_call_void(
            "SYNO.FileStation.Delete",
            v,
            "start",
            &[("path", &path_str), ("recursive", rec)],
        )
        .await
    }

    /// Rename a file or folder.
    pub async fn rename(
        client: &SynoClient,
        path: &str,
        new_name: &str,
    ) -> SynologyResult<serde_json::Value> {
        let v = client.best_version("SYNO.FileStation.Rename", 2).unwrap_or(1);
        client.api_call(
            "SYNO.FileStation.Rename",
            v,
            "rename",
            &[("path", path), ("name", new_name)],
        )
        .await
    }

    /// Create a sharing link for a file/folder.
    pub async fn create_share_link(
        client: &SynoClient,
        path: &str,
        password: Option<&str>,
        expire_days: Option<u32>,
    ) -> SynologyResult<ShareLinkInfo> {
        let v = client.best_version("SYNO.FileStation.Sharing", 3).unwrap_or(1);
        let mut params: Vec<(&str, String)> = vec![("path", path.to_string())];
        if let Some(pw) = password {
            params.push(("password", pw.to_string()));
        }
        if let Some(days) = expire_days {
            params.push(("date_expired", days.to_string()));
        }
        let param_refs: Vec<(&str, &str)> = params.iter().map(|(k, v)| (*k, v.as_str())).collect();
        client.api_call("SYNO.FileStation.Sharing", v, "create", &param_refs).await
    }

    /// List active sharing links.
    pub async fn list_share_links(client: &SynoClient) -> SynologyResult<Vec<ShareLinkInfo>> {
        let v = client.best_version("SYNO.FileStation.Sharing", 3).unwrap_or(1);
        client.api_call("SYNO.FileStation.Sharing", v, "list", &[("offset", "0"), ("limit", "100")]).await
    }

    /// Get background task status.
    pub async fn get_task_status(
        client: &SynoClient,
        task_id: &str,
    ) -> SynologyResult<BackgroundTask> {
        let v = client.best_version("SYNO.FileStation.BackgroundTask", 3).unwrap_or(1);
        client.api_call("SYNO.FileStation.BackgroundTask", v, "list", &[("taskid", task_id)]).await
    }
}
