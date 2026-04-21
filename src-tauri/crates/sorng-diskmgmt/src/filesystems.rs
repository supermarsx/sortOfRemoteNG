//! Filesystem management — mkfs, fsck, blkid.
use crate::client;
use crate::error::DiskError;
use crate::types::*;

pub async fn list_filesystems(host: &DiskHost) -> Result<Vec<Filesystem>, DiskError> {
    let stdout = client::exec_ok(
        host,
        "df",
        &["-B1", "--output=source,target,fstype,size,used,avail,pcent"],
    )
    .await?;
    let mut fss = Vec::new();
    for line in stdout.lines().skip(1) {
        let cols: Vec<&str> = line.split_whitespace().collect();
        if cols.len() < 7 {
            continue;
        }
        fss.push(Filesystem {
            device: cols[0].to_string(),
            mount_point: Some(cols[1].to_string()),
            fs_type: cols[2].to_string(),
            label: None,
            uuid: None,
            total_bytes: cols[3].parse().unwrap_or(0),
            used_bytes: cols[4].parse().unwrap_or(0),
            avail_bytes: cols[5].parse().unwrap_or(0),
            use_percent: cols[6].trim_end_matches('%').parse().unwrap_or(0.0),
        });
    }
    Ok(fss)
}

pub async fn mkfs(host: &DiskHost, opts: &MkfsOpts) -> Result<(), DiskError> {
    let mut args: Vec<String> = vec![format!("-t{}", opts.fs_type)];
    if let Some(ref label) = opts.label {
        args.push("-L".into());
        args.push(label.clone());
    }
    for o in &opts.options {
        args.push(o.clone());
    }
    args.push(opts.device.clone());
    let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    client::exec_ok(host, "mkfs", &refs).await?;
    Ok(())
}

pub async fn fsck(host: &DiskHost, device: &str, auto_fix: bool) -> Result<String, DiskError> {
    let mut args = vec!["-n", device];
    if auto_fix {
        args = vec!["-y", device];
    }
    let (stdout, stderr, code) = client::exec(host, "fsck", &args).await?;
    if code > 1 {
        return Err(DiskError::FilesystemError(stderr));
    }
    Ok(stdout)
}

pub async fn blkid(host: &DiskHost) -> Result<Vec<Filesystem>, DiskError> {
    let stdout = client::exec_ok(host, "blkid", &["-o", "full"]).await?;
    let mut fss = Vec::new();
    for line in stdout.lines() {
        let dev = line.split(':').next().unwrap_or("").to_string();
        let get = |key: &str| -> Option<String> {
            let pat = format!("{key}=\"");
            line.find(&pat).and_then(|s| {
                let r = &line[s + pat.len()..];
                r.find('"').map(|e| r[..e].to_string())
            })
        };
        fss.push(Filesystem {
            device: dev,
            mount_point: None,
            fs_type: get("TYPE").unwrap_or_default(),
            label: get("LABEL"),
            uuid: get("UUID"),
            total_bytes: 0,
            used_bytes: 0,
            avail_bytes: 0,
            use_percent: 0.0,
        });
    }
    Ok(fss)
}

#[cfg(test)]
mod tests {
    #[test]
    fn test_module_loads() {}
}
