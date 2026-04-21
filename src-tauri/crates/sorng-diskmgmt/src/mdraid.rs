//! MD RAID management — mdadm.
use crate::client;
use crate::error::DiskError;
use crate::types::*;

pub async fn list_arrays(host: &DiskHost) -> Result<Vec<MdArray>, DiskError> {
    let content = client::read_file(host, "/proc/mdstat").await?;
    Ok(parse_mdstat(&content))
}

pub async fn detail(host: &DiskHost, device: &str) -> Result<String, DiskError> {
    client::exec_ok(host, "mdadm", &["--detail", device]).await
}

pub async fn create_array(host: &DiskHost, opts: &CreateArrayOpts) -> Result<(), DiskError> {
    let mut args = vec![
        "--create".to_string(),
        opts.device.clone(),
        "--level".into(),
        opts.level.clone(),
        "--raid-devices".into(),
        opts.members.len().to_string(),
    ];
    for m in &opts.members {
        args.push(m.clone());
    }
    if !opts.spare.is_empty() {
        args.push("--spare-devices".into());
        args.push(opts.spare.len().to_string());
        for s in &opts.spare {
            args.push(s.clone());
        }
    }
    let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    client::exec_ok(host, "mdadm", &refs).await?;
    Ok(())
}

pub async fn add_member(host: &DiskHost, array: &str, device: &str) -> Result<(), DiskError> {
    client::exec_ok(host, "mdadm", &[array, "--add", device]).await?;
    Ok(())
}

pub async fn remove_member(host: &DiskHost, array: &str, device: &str) -> Result<(), DiskError> {
    client::exec_ok(host, "mdadm", &[array, "--fail", device]).await?;
    client::exec_ok(host, "mdadm", &[array, "--remove", device]).await?;
    Ok(())
}

pub async fn stop_array(host: &DiskHost, device: &str) -> Result<(), DiskError> {
    client::exec_ok(host, "mdadm", &["--stop", device]).await?;
    Ok(())
}

fn parse_mdstat(content: &str) -> Vec<MdArray> {
    let mut arrays = Vec::new();
    let mut lines = content.lines().peekable();
    while let Some(line) = lines.next() {
        if line.starts_with("md") && line.contains(" : ") {
            let dev = line.split_whitespace().next().unwrap_or("").to_string();
            let rest = line.split(" : ").nth(1).unwrap_or("");
            let level = rest.split_whitespace().nth(1).unwrap_or("").to_string();
            let state = if rest.contains("active") {
                "active"
            } else {
                "inactive"
            }
            .to_string();
            let members: Vec<MdMember> = rest
                .split_whitespace()
                .skip(2)
                .filter(|s| s.contains('['))
                .map(|s| {
                    let d = s.split('[').next().unwrap_or(s);
                    MdMember {
                        device: format!("/dev/{d}"),
                        number: 0,
                        state: "active".into(),
                    }
                })
                .collect();
            let count = members.len() as u32;
            arrays.push(MdArray {
                device: format!("/dev/{dev}"),
                level,
                state,
                member_count: count,
                active_count: count,
                failed_count: 0,
                spare_count: 0,
                size: String::new(),
                members,
                rebuild_percent: None,
                uuid: None,
            });
        }
    }
    arrays
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn test_parse_mdstat() {
        let content = "Personalities : [raid1]\nmd0 : active raid1 sdb1[1] sda1[0]\n      104320 blocks [2/2] [UU]\n\nunused devices: <none>\n";
        let arrays = parse_mdstat(content);
        assert_eq!(arrays.len(), 1);
        assert_eq!(arrays[0].device, "/dev/md0");
        assert_eq!(arrays[0].level, "raid1");
    }
}
