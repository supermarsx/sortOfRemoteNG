// ── nginx log management ─────────────────────────────────────────────────────

use crate::client::NginxClient;
use crate::error::NginxResult;
use crate::types::*;

pub struct LogManager;

impl LogManager {
    pub async fn query_access_log(
        client: &NginxClient,
        query: &LogQuery,
    ) -> NginxResult<Vec<AccessLogEntry>> {
        let path = query.path.as_deref().unwrap_or("/var/log/nginx/access.log");
        let limit = query.lines.unwrap_or(100);
        let cmd = format!("tail -n {} '{}'", limit, path.replace('\'', "'\\''"));
        let out = client.exec_ssh(&cmd).await?;
        let entries = out
            .stdout
            .lines()
            .filter_map(parse_access_log_line)
            .collect();
        Ok(entries)
    }

    pub async fn query_error_log(
        client: &NginxClient,
        query: &LogQuery,
    ) -> NginxResult<Vec<ErrorLogEntry>> {
        let path = query.path.as_deref().unwrap_or("/var/log/nginx/error.log");
        let limit = query.lines.unwrap_or(100);
        let cmd = format!("tail -n {} '{}'", limit, path.replace('\'', "'\\''"));
        let out = client.exec_ssh(&cmd).await?;
        let entries = out
            .stdout
            .lines()
            .filter_map(parse_error_log_line)
            .collect();
        Ok(entries)
    }

    pub async fn list_log_files(
        client: &NginxClient,
        log_dir: Option<&str>,
    ) -> NginxResult<Vec<String>> {
        let dir = log_dir.unwrap_or("/var/log/nginx");
        client.list_remote_dir(dir).await
    }
}

fn parse_access_log_line(line: &str) -> Option<AccessLogEntry> {
    // Combined log format: ip - - [date] "method path proto" status bytes "ref" "ua"
    if line.is_empty() {
        return None;
    }
    Some(AccessLogEntry {
        remote_addr: line.split_whitespace().next().unwrap_or("").to_string(),
        remote_user: None,
        time_local: String::new(),
        request: line.to_string(),
        status: 0,
        body_bytes_sent: 0,
        http_referer: None,
        http_user_agent: None,
        request_time: None,
        upstream_response_time: None,
    })
}

fn parse_error_log_line(line: &str) -> Option<ErrorLogEntry> {
    if line.is_empty() {
        return None;
    }
    Some(ErrorLogEntry {
        timestamp: String::new(),
        level: String::new(),
        pid: None,
        tid: None,
        connection: None,
        message: line.to_string(),
        client: None,
        server: None,
        request: None,
    })
}
