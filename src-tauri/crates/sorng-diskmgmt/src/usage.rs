//! Disk usage — df, du wrappers.
use crate::client;
use crate::error::DiskError;
use crate::types::*;

pub async fn disk_usage(host: &DiskHost) -> Result<Vec<DiskUsage>, DiskError> {
    let stdout = client::exec_ok(host, "df", &["-B1", "--output=target,size,used,avail,pcent"]).await?;
    Ok(stdout.lines().skip(1).filter_map(|line| {
        let cols: Vec<&str> = line.split_whitespace().collect();
        if cols.len() < 5 { return None; }
        Some(DiskUsage {
            path: cols[0].into(), total_bytes: cols[1].parse().unwrap_or(0),
            used_bytes: cols[2].parse().unwrap_or(0), avail_bytes: cols[3].parse().unwrap_or(0),
            use_percent: cols[4].trim_end_matches('%').parse().unwrap_or(0.0),
        })
    }).collect())
}

pub async fn dir_size(host: &DiskHost, path: &str) -> Result<DirectorySize, DiskError> {
    let stdout = client::exec_ok(host, "du", &["-sb", path]).await?;
    let cols: Vec<&str> = stdout.split_whitespace().collect();
    let bytes: u64 = cols.first().and_then(|v| v.parse().ok()).unwrap_or(0);
    Ok(DirectorySize { path: path.into(), size_bytes: bytes, size_human: crate::blocks::humanize_bytes(bytes) })
}

#[cfg(test)]
mod tests { #[test] fn test_module() {} }
