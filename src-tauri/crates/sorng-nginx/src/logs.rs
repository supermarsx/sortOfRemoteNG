// ── nginx log management ─────────────────────────────────────────────────────

use crate::client::NginxClient;
use crate::error::NginxResult;
use crate::types::*;

pub struct LogManager;

impl LogManager {
    pub async fn query_access_log(client: &NginxClient, query: &LogQuery) -> NginxResult<Vec<AccessLogEntry>> {
        let path = query.file.as_deref().unwrap_or("/var/log/nginx/access.log");
        let limit = query.limit.unwrap_or(100);
        let cmd = format!("tail -n {} '{}'", limit, path.replace('\'', "'\\''"));
        let out = client.exec_ssh(&cmd).await?;
        let entries = out.stdout.lines().filter_map(|l| parse_access_log_line(l)).collect();
        Ok(entries)
    }

    pub async fn query_error_log(client: &NginxClient, query: &LogQuery) -> NginxResult<Vec<ErrorLogEntry>> {
        let path = query.file.as_deref().unwrap_or("/var/log/nginx/error.log");
        let limit = query.limit.unwrap_or(100);
        let cmd = format!("tail -n {} '{}'", limit, path.replace('\'', "'\\''"));
        let out = client.exec_ssh(&cmd).await?;
        let entries = out.stdout.lines().filter_map(|l| parse_error_log_line(l)).collect();
        Ok(entries)
    }

    pub async fn list_log_files(client: &NginxClient, log_dir: Option<&str>) -> NginxResult<Vec<String>> {
        let dir = log_dir.unwrap_or("/var/log/nginx");
        client.list_remote_dir(dir).await
    }
}

fn parse_access_log_line(line: &str) -> Option<AccessLogEntry> {
    // Combined log format: ip - - [date] "method path proto" status bytes "ref" "ua"
    if line.is_empty() { return None; }
    Some(AccessLogEntry {
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

fn parse_error_log_line(line: &str) -> Option<ErrorLogEntry> {
    if line.is_empty() { return None; }
    Some(ErrorLogEntry {
        raw: line.to_string(),
        time: None,
        level: None,
        message: Some(line.to_string()),
        client: None,
    })
}
