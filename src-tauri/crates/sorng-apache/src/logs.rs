// ── apache log management ────────────────────────────────────────────────────

use crate::client::ApacheClient;
use crate::error::ApacheResult;
use crate::types::*;

pub struct ApacheLogManager;

impl ApacheLogManager {
    pub async fn query_access_log(
        client: &ApacheClient,
        query: &LogQuery,
    ) -> ApacheResult<Vec<ApacheAccessLogEntry>> {
        let path = query
            .path
            .as_deref()
            .unwrap_or("/var/log/apache2/access.log");
        let limit = query.lines.unwrap_or(100);
        let cmd = format!("tail -n {} '{}'", limit, path.replace('\'', "'\\''"));
        let out = client.exec_ssh(&cmd).await?;
        let entries = out.stdout.lines().filter_map(parse_access_line).collect();
        Ok(entries)
    }

    pub async fn query_error_log(
        client: &ApacheClient,
        query: &LogQuery,
    ) -> ApacheResult<Vec<ApacheErrorLogEntry>> {
        let path = query
            .path
            .as_deref()
            .unwrap_or("/var/log/apache2/error.log");
        let limit = query.lines.unwrap_or(100);
        let cmd = format!("tail -n {} '{}'", limit, path.replace('\'', "'\\''"));
        let out = client.exec_ssh(&cmd).await?;
        let entries = out.stdout.lines().filter_map(parse_error_line).collect();
        Ok(entries)
    }

    pub async fn list_log_files(
        client: &ApacheClient,
        log_dir: Option<&str>,
    ) -> ApacheResult<Vec<String>> {
        let dir = log_dir.unwrap_or("/var/log/apache2");
        client.list_remote_dir(dir).await
    }
}

fn parse_access_line(line: &str) -> Option<ApacheAccessLogEntry> {
    if line.is_empty() {
        return None;
    }
    Some(ApacheAccessLogEntry {
        remote_host: line.split_whitespace().next().unwrap_or("").to_string(),
        identity: None,
        user: None,
        timestamp: String::new(),
        request: line.to_string(),
        status: 0,
        bytes: 0,
        referer: None,
        user_agent: None,
    })
}

fn parse_error_line(line: &str) -> Option<ApacheErrorLogEntry> {
    if line.is_empty() {
        return None;
    }
    Some(ApacheErrorLogEntry {
        timestamp: String::new(),
        module: None,
        level: String::new(),
        pid: None,
        tid: None,
        client: None,
        message: line.to_string(),
    })
}
