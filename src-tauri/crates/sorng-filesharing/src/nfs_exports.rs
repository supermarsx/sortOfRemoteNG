//! /etc/exports parser and management.
use crate::client;
use crate::error::FileSharingError;
use crate::types::*;

pub async fn list_exports(host: &FileSharingHost) -> Result<Vec<NfsExport>, FileSharingError> {
    let content = client::read_file(host, "/etc/exports").await?;
    Ok(parse_exports(&content))
}
pub async fn refresh_exports(host: &FileSharingHost) -> Result<(), FileSharingError> {
    client::exec_ok(host, "exportfs", &["-ra"]).await?; Ok(())
}
pub async fn show_active_exports(host: &FileSharingHost) -> Result<String, FileSharingError> {
    client::exec_ok(host, "exportfs", &["-v"]).await
}

pub fn parse_exports(content: &str) -> Vec<NfsExport> {
    content.lines().filter_map(|line| {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') { return None; }
        let mut parts = line.split_whitespace();
        let path = parts.next()?.to_string();
        let clients: Vec<NfsClient> = parts.map(|entry| {
            if let Some((host, opts)) = entry.split_once('(') {
                NfsClient { host: host.into(), options: opts.trim_end_matches(')').split(',').map(|s| s.to_string()).collect() }
            } else {
                NfsClient { host: entry.into(), options: Vec::new() }
            }
        }).collect();
        Some(NfsExport { path, clients })
    }).collect()
}

pub fn export_to_line(export: &NfsExport) -> String {
    let clients: Vec<String> = export.clients.iter().map(|c| {
        if c.options.is_empty() { c.host.clone() } else { format!("{}({})", c.host, c.options.join(",")) }
    }).collect();
    format!("{} {}", export.path, clients.join(" "))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn test_parse_exports() {
        let content = "/srv/nfs 192.168.1.0/24(rw,sync,no_subtree_check)\n/home *(ro,sync)\n";
        let exports = parse_exports(content);
        assert_eq!(exports.len(), 2);
        assert_eq!(exports[0].path, "/srv/nfs");
        assert_eq!(exports[0].clients[0].host, "192.168.1.0/24");
        assert!(exports[0].clients[0].options.contains(&"rw".to_string()));
    }
}
