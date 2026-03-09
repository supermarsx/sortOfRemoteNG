//! ZFS pool and dataset management.
use crate::client;
use crate::error::DiskError;
use crate::types::*;
use std::collections::HashMap;

pub async fn list_pools(host: &DiskHost) -> Result<Vec<ZfsPool>, DiskError> {
    let stdout = client::exec_ok(
        host,
        "zpool",
        &["list", "-H", "-o", "name,size,alloc,free,health,dedup,frag"],
    )
    .await?;
    Ok(stdout.lines().filter_map(parse_pool_line).collect())
}
pub async fn list_datasets(
    host: &DiskHost,
    pool: Option<&str>,
) -> Result<Vec<ZfsDataset>, DiskError> {
    let mut args = vec![
        "list",
        "-H",
        "-o",
        "name,used,avail,refer,mountpoint,compression,type",
    ];
    if let Some(p) = pool {
        args.push(p);
    }
    let stdout = client::exec_ok(host, "zfs", &args).await?;
    Ok(stdout.lines().filter_map(parse_dataset_line).collect())
}
pub async fn create_pool(
    host: &DiskHost,
    name: &str,
    vdev_type: &str,
    devices: &[&str],
) -> Result<(), DiskError> {
    let mut args = vec!["create", name, vdev_type];
    args.extend_from_slice(devices);
    client::exec_ok(host, "zpool", &args).await?;
    Ok(())
}
pub async fn create_dataset(
    host: &DiskHost,
    name: &str,
    options: &[(&str, &str)],
) -> Result<(), DiskError> {
    let mut args = vec!["create".to_string()];
    for (k, v) in options {
        args.push("-o".into());
        args.push(format!("{k}={v}"));
    }
    args.push(name.to_string());
    let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    client::exec_ok(host, "zfs", &refs).await?;
    Ok(())
}
pub async fn create_snapshot(
    host: &DiskHost,
    dataset: &str,
    snap_name: &str,
) -> Result<(), DiskError> {
    client::exec_ok(
        host,
        "zfs",
        &["snapshot", &format!("{dataset}@{snap_name}")],
    )
    .await?;
    Ok(())
}
pub async fn list_snapshots(
    host: &DiskHost,
    dataset: Option<&str>,
) -> Result<Vec<ZfsSnapshot>, DiskError> {
    let mut args = vec![
        "list",
        "-t",
        "snapshot",
        "-H",
        "-o",
        "name,used,refer,creation",
    ];
    if let Some(d) = dataset {
        args.push(d);
    }
    let stdout = client::exec_ok(host, "zfs", &args).await?;
    Ok(stdout.lines().filter_map(parse_snapshot_line).collect())
}
pub async fn destroy(host: &DiskHost, name: &str, recursive: bool) -> Result<(), DiskError> {
    let mut args = vec!["destroy"];
    if recursive {
        args.push("-r");
    }
    args.push(name);
    client::exec_ok(host, "zfs", &args).await?;
    Ok(())
}
pub async fn scrub(host: &DiskHost, pool: &str) -> Result<(), DiskError> {
    client::exec_ok(host, "zpool", &["scrub", pool]).await?;
    Ok(())
}
pub async fn pool_status(host: &DiskHost, pool: &str) -> Result<String, DiskError> {
    client::exec_ok(host, "zpool", &["status", pool]).await
}

fn parse_pool_line(line: &str) -> Option<ZfsPool> {
    let cols: Vec<&str> = line.split('\t').collect();
    if cols.len() < 5 {
        return None;
    }
    Some(ZfsPool {
        name: cols[0].into(),
        size: cols[1].into(),
        alloc: cols[2].into(),
        free: cols[3].into(),
        health: cols[4].into(),
        dedup_ratio: cols.get(5).map(|s| s.to_string()),
        fragmentation: cols.get(6).map(|s| s.to_string()),
    })
}
fn parse_dataset_line(line: &str) -> Option<ZfsDataset> {
    let cols: Vec<&str> = line.split('\t').collect();
    if cols.len() < 7 {
        return None;
    }
    let dt = match cols[6] {
        "filesystem" => ZfsDatasetType::Filesystem,
        "volume" => ZfsDatasetType::Volume,
        "snapshot" => ZfsDatasetType::Snapshot,
        _ => ZfsDatasetType::Filesystem,
    };
    Some(ZfsDataset {
        name: cols[0].into(),
        used: cols[1].into(),
        avail: cols[2].into(),
        refer: cols[3].into(),
        mount_point: Some(cols[4].into()).filter(|s: &String| s != "-"),
        compression: Some(cols[5].into()).filter(|s: &String| s != "-"),
        dataset_type: dt,
        properties: HashMap::new(),
    })
}
fn parse_snapshot_line(line: &str) -> Option<ZfsSnapshot> {
    let cols: Vec<&str> = line.split('\t').collect();
    if cols.len() < 3 {
        return None;
    }
    let (ds, _snap) = cols[0].split_once('@').unwrap_or((cols[0], ""));
    Some(ZfsSnapshot {
        name: cols[0].into(),
        dataset: ds.into(),
        used: cols[1].into(),
        refer: cols[2].into(),
        creation: cols.get(3).map(|s| s.to_string()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn test_parse_pool() {
        let line = "rpool\t928G\t440G\t488G\tONLINE\t1.00x\t10%";
        let pool = parse_pool_line(line).unwrap();
        assert_eq!(pool.name, "rpool");
        assert_eq!(pool.health, "ONLINE");
    }
}
