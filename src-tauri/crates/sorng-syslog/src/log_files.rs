//! Log file browsing — list, info, tail files in /var/log.
use crate::client;
use crate::error::SyslogError;
use crate::types::*;

pub async fn list_log_files(host: &SyslogHost) -> Result<Vec<LogFile>, SyslogError> {
    let stdout = client::exec_ok(
        host,
        "find",
        &[
            "/var/log",
            "-maxdepth",
            "2",
            "-type",
            "f",
            "-printf",
            "%p\\t%s\\t%m\\n",
        ],
    )
    .await?;
    let mut files = Vec::new();
    for line in stdout.lines() {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() < 3 {
            continue;
        }
        let path = parts[0].to_string();
        let name = path.rsplit('/').next().unwrap_or(&path).to_string();
        files.push(LogFile {
            path: path.clone(),
            name: name.clone(),
            size_bytes: parts[1].parse().unwrap_or(0),
            modified_at: None,
            permissions: parts[2].to_string(),
            is_compressed: name.ends_with(".gz")
                || name.ends_with(".xz")
                || name.ends_with(".bz2")
                || name.ends_with(".zst"),
        });
    }
    Ok(files)
}

pub async fn tail_file(host: &SyslogHost, path: &str, lines: u32) -> Result<String, SyslogError> {
    let n = lines.to_string();
    client::exec_ok(host, "tail", &["-n", &n, path]).await
}

pub async fn grep_file(
    host: &SyslogHost,
    path: &str,
    pattern: &str,
) -> Result<String, SyslogError> {
    let (stdout, _, _) = client::exec(host, "grep", &["-i", pattern, path]).await?;
    Ok(stdout)
}

#[cfg(test)]
mod tests {
    #[test]
    fn test_module_loads() {}
}
