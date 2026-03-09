//! Active Samba connections via smbstatus.
use crate::client;
use crate::error::FileSharingError;
use crate::types::*;

pub async fn list_connections(
    host: &FileSharingHost,
) -> Result<Vec<SambaConnection>, FileSharingError> {
    let stdout = client::exec_ok(host, "smbstatus", &["-b"]).await?;
    Ok(parse_smbstatus(&stdout))
}

fn parse_smbstatus(output: &str) -> Vec<SambaConnection> {
    let mut conns = Vec::new();
    let mut in_table = false;
    for line in output.lines() {
        let line = line.trim();
        if line.starts_with("---") {
            in_table = true;
            continue;
        }
        if !in_table || line.is_empty() {
            continue;
        }
        let cols: Vec<&str> = line.split_whitespace().collect();
        if cols.len() >= 4 {
            conns.push(SambaConnection {
                pid: cols[0].parse().unwrap_or(0),
                username: cols[1].into(),
                group: cols[2].into(),
                machine: cols[3].into(),
                share: None,
            });
        }
    }
    conns
}
