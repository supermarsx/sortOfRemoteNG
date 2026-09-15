//! Download Station — tasks, RSS feeds, statistics.

use crate::client::SynoClient;
use crate::error::{SynologyError, SynologyResult};
use crate::types::*;
use crate::wire;
use serde::Deserialize;

/// One `SYNO.DownloadStation.Task` `list`/`getinfo` row. The Download Station
/// guide sends sizes and times as strings (`"9427312332"`); devices send
/// numbers (py-synologydsm-api). `additional` parts are present only when
/// requested and reported.
#[derive(Deserialize)]
struct TaskWire {
    id: String,
    title: String,
    status: String,
    #[serde(deserialize_with = "wire::u64_lenient")]
    size: u64,
    #[serde(rename = "type")]
    kind: String,
    username: Option<String>,
    #[serde(default)]
    additional: TaskAdditional,
}
#[derive(Default, Deserialize)]
struct TaskAdditional {
    #[serde(default)]
    transfer: Option<TaskTransfer>,
    detail: Option<TaskDetail>,
}
#[derive(Deserialize)]
struct TaskTransfer {
    #[serde(deserialize_with = "wire::u64_lenient")]
    size_downloaded: u64,
    #[serde(default, deserialize_with = "wire::opt_u64_lenient")]
    size_uploaded: Option<u64>,
    #[serde(default, deserialize_with = "wire::opt_u64_lenient")]
    speed_download: Option<u64>,
    #[serde(default, deserialize_with = "wire::opt_u64_lenient")]
    speed_upload: Option<u64>,
}
#[derive(Deserialize)]
struct TaskDetail {
    destination: Option<String>,
    uri: Option<String>,
    #[serde(default, deserialize_with = "wire::opt_i64_lenient")]
    create_time: Option<i64>,
}
impl TryFrom<TaskWire> for DownloadTask {
    type Error = SynologyError;
    fn try_from(task: TaskWire) -> Result<Self, Self::Error> {
        // Without a transfer report nothing is known to be downloaded, and no
        // progress is invented.
        let transfer = task.additional.transfer;
        let size_downloaded = transfer.as_ref().map_or(0, |t| t.size_downloaded);
        let percent_dn = transfer
            .as_ref()
            .filter(|_| task.size > 0)
            .map(|t| (t.size_downloaded as f64 / task.size as f64 * 100.0).min(100.0));
        let (destination, uri, created_time) = if let Some(detail) = task.additional.detail {
            let created = detail
                .create_time
                .map(|seconds| {
                    chrono::DateTime::from_timestamp(seconds, 0)
                        .map(|time| time.to_rfc3339())
                        .ok_or_else(|| {
                            SynologyError::parse("NAS returned an invalid download creation time")
                        })
                })
                .transpose()?;
            (detail.destination, detail.uri, created)
        } else {
            (None, None, None)
        };
        Ok(Self {
            id: task.id,
            title: task.title,
            status: task.status,
            size: task.size,
            size_downloaded,
            size_uploaded: transfer.as_ref().and_then(|t| t.size_uploaded),
            speed_download: transfer.as_ref().and_then(|t| t.speed_download),
            speed_upload: transfer.as_ref().and_then(|t| t.speed_upload),
            percent_dn,
            r#type: task.kind,
            destination,
            uri,
            username: task.username,
            created_time,
        })
    }
}
#[derive(Deserialize)]
struct TaskOperationResult {
    id: String,
    error: i32,
}
async fn task_operation(
    client: &SynoClient,
    version: u32,
    method: &str,
    task_id: &str,
    params: &[(&str, &str)],
) -> SynologyResult<()> {
    if task_id.is_empty()
        || task_id.len() > 256
        || task_id.chars().any(|c| c.is_control() || c == ',')
    {
        return Err(SynologyError::parse(
            "Select one valid Download Station task",
        ));
    }
    let results: Vec<TaskOperationResult> = client
        .api_call("SYNO.DownloadStation.Task", version, method, params)
        .await?;
    if results.len() != 1 || results[0].id != task_id {
        return Err(SynologyError::parse(
            "NAS did not confirm the selected download task",
        ));
    }
    if results[0].error != 0 {
        return Err(SynologyError::api(
            results[0].error,
            format!(
                "Download Station refused the task operation (code {})",
                results[0].error
            ),
        ));
    }
    Ok(())
}

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
        let tasks: Vec<TaskWire> = client
            .api_list(
                "SYNO.DownloadStation.Task",
                v,
                "list",
                &[
                    ("additional", "detail,transfer,file"),
                    ("offset", "0"),
                    ("limit", "500"),
                ],
                &["tasks"],
            )
            .await?;
        tasks.into_iter().map(TryInto::try_into).collect()
    }

    /// Get a specific task's info.
    pub async fn get_task(client: &SynoClient, task_id: &str) -> SynologyResult<DownloadTask> {
        let v = client
            .best_version("SYNO.DownloadStation.Task", 3)
            .unwrap_or(1);
        let tasks: Vec<TaskWire> = client
            .api_list(
                "SYNO.DownloadStation.Task",
                v,
                "getinfo",
                &[("id", task_id), ("additional", "detail,transfer,file")],
                &["tasks"],
            )
            .await?;
        if tasks.len() != 1 || tasks[0].id != task_id {
            return Err(SynologyError::parse(
                "NAS did not return the selected download task",
            ));
        }
        tasks
            .into_iter()
            .next()
            .ok_or_else(|| SynologyError::parse("Missing download task"))?
            .try_into()
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
        task_operation(client, v, "pause", task_id, &[("id", task_id)]).await
    }

    /// Resume a download task.
    pub async fn resume_task(client: &SynoClient, task_id: &str) -> SynologyResult<()> {
        let v = client
            .best_version("SYNO.DownloadStation.Task", 3)
            .unwrap_or(1);
        task_operation(client, v, "resume", task_id, &[("id", task_id)]).await
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
        task_operation(
            client,
            v,
            "delete",
            task_id,
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
