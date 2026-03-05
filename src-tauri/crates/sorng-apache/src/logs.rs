// ── apache log management ────────────────────────────────────────────────────

use crate::client::ApacheClient;
use crate::error::ApacheResult;
use crate::types::*;

pub struct ApacheLogManager;

impl ApacheLogManager {
    pub async fn query_access_log(client: &ApacheClient, query: &LogQuery) -> ApacheResult<Vec<ApacheAccessLogEntry>> {
        let path = query.file.as_deref().unwrap_or("/var/log/apache2/access.log");
        let limit = query.limit.unwrap_or(100);
        let cmd = format!("tail -n {} '{}'", limit, path.replace('\'', "'\\''"));
        let out = client.exec_ssh(&cmd).await?;
        let entries = out.stdout.lines().filter_map(parse_access_line).collect();
        Ok(entries)
    }

    pub async fn query_error_log(client: &ApacheClient, query: &LogQuery) -> ApacheResult<Vec<ApacheErrorLogEntry>> {
        let path = query.file.as_deref().unwrap_or("/var/log/apache2/error.log");
        let limit = query.limit.unwrap_or(100);
        let cmd = format!("tail -n {} '{}'", limit, path.replace('\'', "'\\''"));
        let out = client.exec_ssh(&cmd).await?;
        let entries = out.stdout.lines().filter_map(parse_error_line).collect();
        Ok(entries)
    }

    pub async fn list_log_files(client: &ApacheClient, log_dir: Option<&str>) -> ApacheResult<Vec<String>> {
        let dir = log_dir.unwrap_or("/var/log/apache2");
        client.list_remote_dir(dir).await
    }
}

fn parse_access_line(line: &str) -> Option<ApacheAccessLogEntry> {
    if line.is_empty() { return None; }
    Some(ApacheAccessLogEntry {
        raw: line.to_string(),
        remote_addr: line.split_whitespace().next().map(String::from),
        time: None,
        request: None,
        status: None,
        body_bytes: None,
        referer: None,
        user_agent: None,
    })
}

fn parse_error_line(line: &str) -> Option<ApacheErrorLogEntry> {
    if line.is_empty() { return None; }
    Some(ApacheErrorLogEntry {
        raw: line.to_string(),
        time: None,
        level: None,
        module: None,
        message: Some(line.to_string()),
        client: None,
    })
}
