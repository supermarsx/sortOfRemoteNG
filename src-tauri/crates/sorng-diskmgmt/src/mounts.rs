//! Mount/unmount operations.
use crate::client;
use crate::error::DiskError;
use crate::types::*;

pub async fn list_mounts(host: &DiskHost) -> Result<Vec<MountEntry>, DiskError> {
    let content = client::read_file(host, "/proc/mounts").await?;
    Ok(parse_mounts(&content))
}

pub async fn mount(host: &DiskHost, opts: &MountOpts) -> Result<(), DiskError> {
    let mut args: Vec<String> = Vec::new();
    if let Some(ref ft) = opts.fs_type {
        args.push("-t".into());
        args.push(ft.clone());
    }
    if opts.read_only {
        args.push("-r".into());
    }
    if !opts.options.is_empty() {
        args.push("-o".into());
        args.push(opts.options.join(","));
    }
    args.push(opts.device.clone());
    args.push(opts.mount_point.clone());
    let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    client::exec_ok(host, "mount", &refs).await?;
    Ok(())
}

pub async fn umount(host: &DiskHost, path: &str, force: bool, lazy: bool) -> Result<(), DiskError> {
    let mut args = vec![];
    if force {
        args.push("-f");
    }
    if lazy {
        args.push("-l");
    }
    args.push(path);
    client::exec_ok(host, "umount", &args).await?;
    Ok(())
}

pub async fn remount(host: &DiskHost, path: &str, options: &[&str]) -> Result<(), DiskError> {
    let mut opts = vec!["remount".to_string()];
    opts.extend(options.iter().map(|s| s.to_string()));
    client::exec_ok(host, "mount", &["-o", &opts.join(","), path]).await?;
    Ok(())
}

pub fn parse_mounts(content: &str) -> Vec<MountEntry> {
    content
        .lines()
        .filter_map(|line| {
            let cols: Vec<&str> = line.split_whitespace().collect();
            if cols.len() < 6 {
                return None;
            }
            Some(MountEntry {
                device: cols[0].to_string(),
                mount_point: cols[1].to_string(),
                fs_type: cols[2].to_string(),
                options: cols[3].split(',').map(|s| s.to_string()).collect(),
                dump: cols[4].parse().unwrap_or(0),
                pass: cols[5].parse().unwrap_or(0),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn test_parse_mounts() {
        let content = "/dev/sda1 / ext4 rw,relatime 0 0\ntmpfs /tmp tmpfs rw,nosuid 0 0\n";
        let mounts = parse_mounts(content);
        assert_eq!(mounts.len(), 2);
        assert_eq!(mounts[0].device, "/dev/sda1");
        assert_eq!(mounts[0].fs_type, "ext4");
    }
}
