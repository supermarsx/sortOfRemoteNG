//! Download Station — tasks, RSS feeds, statistics.

use crate::client::SynoClient;
use crate::error::SynologyResult;
use crate::types::*;

pub struct DownloadStationManager;

impl DownloadStationManager {
    /// Get Download Station info.
    pub async fn get_info(client: &SynoClient) -> SynologyResult<DownloadStationInfo> {
        let v = client
            .best_version("SYNO.DownloadStation.Info", 2)
            .unwrap_or(1);
        client
            .api_call("SYNO.DownloadStation.Info", v, "getinfo", &[])
            .await
    }

    /// Get config / settings.
    pub async fn get_config(client: &SynoClient) -> SynologyResult<serde_json::Value> {
        let v = client
            .best_version("SYNO.DownloadStation.Info", 2)
            .unwrap_or(1);
        client
            .api_call("SYNO.DownloadStation.Info", v, "getconfig", &[])
            .await
    }

    /// Get transfer statistics.
    pub async fn get_stats(client: &SynoClient) -> SynologyResult<DownloadStationStats> {
        let v = client
            .best_version("SYNO.DownloadStation.Statistic", 1)
            .unwrap_or(1);
        client
            .api_call("SYNO.DownloadStation.Statistic", v, "getinfo", &[])
            .await
    }

    /// List all download tasks.
    pub async fn list_tasks(client: &SynoClient) -> SynologyResult<Vec<DownloadTask>> {
        let v = client
            .best_version("SYNO.DownloadStation.Task", 3)
            .unwrap_or(1);
        client
            .api_call(
                "SYNO.DownloadStation.Task",
                v,
                "list",
                &[
                    ("additional", "detail,transfer,file"),
                    ("offset", "0"),
                    ("limit", "500"),
                ],
            )
            .await
    }

    /// Get a specific task's info.
    pub async fn get_task(client: &SynoClient, task_id: &str) -> SynologyResult<DownloadTask> {
        let v = client
            .best_version("SYNO.DownloadStation.Task", 3)
            .unwrap_or(1);
        client
            .api_call(
                "SYNO.DownloadStation.Task",
                v,
                "getinfo",
                &[("id", task_id), ("additional", "detail,transfer,file")],
            )
            .await
    }

    /// Create a download task by URL.
    pub async fn create_task(
        client: &SynoClient,
        uri: &str,
        destination: Option<&str>,
    ) -> SynologyResult<()> {
        let v = client
            .best_version("SYNO.DownloadStation.Task", 3)
            .unwrap_or(1);
        let mut params: Vec<(&str, &str)> = vec![("uri", uri)];
        if let Some(dest) = destination {
            params.push(("destination", dest));
        }
        client
            .api_post_void("SYNO.DownloadStation.Task", v, "create", &params)
            .await
    }

    /// Pause a download task.
    pub async fn pause_task(client: &SynoClient, task_id: &str) -> SynologyResult<()> {
        let v = client
            .best_version("SYNO.DownloadStation.Task", 3)
            .unwrap_or(1);
        client
            .api_post_void("SYNO.DownloadStation.Task", v, "pause", &[("id", task_id)])
            .await
    }

    /// Resume a download task.
    pub async fn resume_task(client: &SynoClient, task_id: &str) -> SynologyResult<()> {
        let v = client
            .best_version("SYNO.DownloadStation.Task", 3)
            .unwrap_or(1);
        client
            .api_post_void("SYNO.DownloadStation.Task", v, "resume", &[("id", task_id)])
            .await
    }

    /// Delete download task(s).
    pub async fn delete_task(
        client: &SynoClient,
        task_id: &str,
        force_complete: bool,
    ) -> SynologyResult<()> {
        let v = client
            .best_version("SYNO.DownloadStation.Task", 3)
            .unwrap_or(1);
        let fc = if force_complete { "true" } else { "false" };
        client
            .api_post_void(
                "SYNO.DownloadStation.Task",
                v,
                "delete",
                &[("id", task_id), ("force_complete", fc)],
            )
            .await
    }

    /// List RSS feeds.
    pub async fn list_rss_feeds(client: &SynoClient) -> SynologyResult<serde_json::Value> {
        let v = client
            .best_version("SYNO.DownloadStation.RSS.Site", 1)
            .unwrap_or(1);
        client
            .api_call("SYNO.DownloadStation.RSS.Site", v, "list", &[])
            .await
    }

    /// Set speed limits.
    pub async fn set_speed_limit(
        client: &SynoClient,
        upload_kbps: i64,
        download_kbps: i64,
    ) -> SynologyResult<()> {
        let v = client
            .best_version("SYNO.DownloadStation.Info", 2)
            .unwrap_or(1);
        let up = upload_kbps.to_string();
        let dl = download_kbps.to_string();
        client
            .api_post_void(
                "SYNO.DownloadStation.Info",
                v,
                "setserverconfig",
                &[("bt_max_upload", &up), ("bt_max_download", &dl)],
            )
            .await
    }
}
