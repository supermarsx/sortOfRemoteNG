//! /etc/fstab parser and editor.
use crate::client;
use crate::error::DiskError;
use crate::types::*;

pub async fn read_fstab(host: &DiskHost) -> Result<Vec<MountEntry>, DiskError> {
    let content = client::read_file(host, "/etc/fstab").await?;
    Ok(parse_fstab(&content))
}

pub async fn add_entry(host: &DiskHost, entry: &MountEntry) -> Result<(), DiskError> {
    let line = format!(
        "{} {} {} {} {} {}",
        entry.device,
        entry.mount_point,
        entry.fs_type,
        entry.options.join(","),
        entry.dump,
        entry.pass
    );
    let escaped = line.replace('\'', "'\\''");
    client::exec_ok(
        host,
        "sh",
        &["-c", &format!("echo '{escaped}' >> /etc/fstab")],
    )
    .await?;
    Ok(())
}

pub fn parse_fstab(content: &str) -> Vec<MountEntry> {
    content
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                return None;
            }
            let cols: Vec<&str> = line.split_whitespace().collect();
            if cols.len() < 4 {
                return None;
            }
            Some(MountEntry {
                device: cols[0].to_string(),
                mount_point: cols[1].to_string(),
                fs_type: cols[2].to_string(),
                options: cols[3].split(',').map(|s| s.to_string()).collect(),
                dump: cols.get(4).and_then(|v| v.parse().ok()).unwrap_or(0),
                pass: cols.get(5).and_then(|v| v.parse().ok()).unwrap_or(0),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn test_parse_fstab() {
        let content = "# /etc/fstab\nUUID=abc-123 / ext4 defaults 0 1\nUUID=def-456 /home ext4 defaults 0 2\n/dev/sda2 none swap sw 0 0\n";
        let entries = parse_fstab(content);
        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].mount_point, "/");
        assert_eq!(entries[2].fs_type, "swap");
    }
}
