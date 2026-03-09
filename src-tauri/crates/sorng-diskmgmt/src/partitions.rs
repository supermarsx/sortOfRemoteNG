//! Partition management — fdisk, parted.
use crate::client;
use crate::error::DiskError;
use crate::types::*;

pub async fn get_partitions(host: &DiskHost, device: &str) -> Result<DiskPartitionInfo, DiskError> {
    let stdout = client::exec_ok(host, "parted", &["-s", device, "unit", "s", "print"]).await?;
    parse_parted_output(device, &stdout)
}

pub async fn create_partition(
    host: &DiskHost,
    opts: &CreatePartitionOpts,
) -> Result<(), DiskError> {
    client::exec_ok(
        host,
        "parted",
        &["-s", &opts.device, "mkpart", "primary", &opts.size],
    )
    .await?;
    Ok(())
}

pub async fn delete_partition(host: &DiskHost, device: &str, number: u32) -> Result<(), DiskError> {
    client::exec_ok(host, "parted", &["-s", device, "rm", &number.to_string()]).await?;
    Ok(())
}

fn parse_parted_output(device: &str, output: &str) -> Result<DiskPartitionInfo, DiskError> {
    let mut table_type = PartitionTable::Unknown;
    let mut partitions = Vec::new();
    let mut size_bytes = 0u64;
    let mut in_table = false;

    for line in output.lines() {
        let line = line.trim();
        if line.starts_with("Partition Table:") {
            let t = line.split(':').nth(1).unwrap_or("").trim();
            table_type = match t {
                "gpt" => PartitionTable::Gpt,
                "msdos" => PartitionTable::Mbr,
                _ => PartitionTable::Unknown,
            };
        } else if line.starts_with("Disk ") && line.contains("s") {
            // Disk /dev/sda: 976773168s
            if let Some(sz) = line.rsplit(':').next() {
                let sz = sz.trim().trim_end_matches('s');
                size_bytes = sz.parse().unwrap_or(0) * 512;
            }
        } else if line.starts_with("Number") {
            in_table = true;
            continue;
        } else if in_table && !line.is_empty() {
            let cols: Vec<&str> = line.split_whitespace().collect();
            if cols.len() >= 4 {
                let num: u32 = cols[0].parse().unwrap_or(0);
                let start: u64 = cols[1].trim_end_matches('s').parse().unwrap_or(0);
                let end: u64 = cols[2].trim_end_matches('s').parse().unwrap_or(0);
                let sz: u64 = cols[3].trim_end_matches('s').parse().unwrap_or(0);
                partitions.push(Partition {
                    device: format!("{device}{num}"),
                    number: num,
                    start_sector: start,
                    end_sector: end,
                    size_bytes: sz * 512,
                    size_human: crate::blocks::humanize_bytes(sz * 512),
                    partition_type: cols.get(4).unwrap_or(&"").to_string(),
                    fs_type: cols.get(5).map(|s| s.to_string()),
                    label: None,
                    uuid: None,
                    flags: Vec::new(),
                });
            }
        }
    }
    Ok(DiskPartitionInfo {
        device: device.to_string(),
        table_type,
        size_bytes,
        partitions,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn test_parse_parted() {
        let output = "Disk /dev/sda: 976773168s\nPartition Table: gpt\n\nNumber  Start    End         Size        Type     File system\n 1      2048s    1050623s    1048576s    primary  fat32\n 2      1050624s 976773134s  975722511s  primary  ext4\n";
        let info = parse_parted_output("/dev/sda", output).unwrap();
        assert_eq!(info.table_type, PartitionTable::Gpt);
        assert_eq!(info.partitions.len(), 2);
        assert_eq!(info.partitions[0].number, 1);
    }
}
