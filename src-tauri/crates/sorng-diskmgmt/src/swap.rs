//! Swap management.
use crate::client;
use crate::error::DiskError;
use crate::types::*;

pub async fn list_swap(host: &DiskHost) -> Result<Vec<SwapEntry>, DiskError> {
    let content = client::read_file(host, "/proc/swaps").await?;
    Ok(parse_swaps(&content))
}

pub async fn swapon(host: &DiskHost, device: &str) -> Result<(), DiskError> {
    client::exec_ok(host, "swapon", &[device]).await?; Ok(())
}

pub async fn swapoff(host: &DiskHost, device: &str) -> Result<(), DiskError> {
    client::exec_ok(host, "swapoff", &[device]).await?; Ok(())
}

pub async fn mkswap(host: &DiskHost, device: &str, label: Option<&str>) -> Result<(), DiskError> {
    let mut args = vec![device];
    if let Some(l) = label { args.insert(0, "-L"); args.insert(1, l); }
    client::exec_ok(host, "mkswap", &args).await?; Ok(())
}

fn parse_swaps(content: &str) -> Vec<SwapEntry> {
    content.lines().skip(1).filter_map(|line| {
        let cols: Vec<&str> = line.split_whitespace().collect();
        if cols.len() < 5 { return None; }
        Some(SwapEntry {
            filename: cols[0].into(), swap_type: cols[1].into(),
            size_kb: cols[2].parse().unwrap_or(0), used_kb: cols[3].parse().unwrap_or(0),
            priority: cols[4].parse().unwrap_or(-1),
        })
    }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn test_parse_swaps() {
        let content = "Filename\t\t\t\tType\t\tSize\t\tUsed\t\tPriority\n/dev/sda2                               partition\t8388604\t\t0\t\t-2\n";
        let swaps = parse_swaps(content);
        assert_eq!(swaps.len(), 1);
        assert_eq!(swaps[0].filename, "/dev/sda2");
        assert_eq!(swaps[0].size_kb, 8388604);
    }
}
