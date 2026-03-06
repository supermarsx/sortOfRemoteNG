//! Block device listing — lsblk wrapper.
use crate::client;
use crate::error::DiskError;
use crate::types::*;

pub async fn list_block_devices(host: &DiskHost) -> Result<Vec<BlockDevice>, DiskError> {
    let stdout = client::exec_ok(host, "lsblk", &["-b", "-P", "-o", "NAME,TYPE,SIZE,MODEL,SERIAL,VENDOR,TRAN,RO,RM,HOTPLUG,STATE"]).await?;
    let mut devices = Vec::new();
    for line in stdout.lines() {
        if let Some(dev) = parse_lsblk_line(line) { devices.push(dev); }
    }
    Ok(devices)
}

fn parse_lsblk_line(line: &str) -> Option<BlockDevice> {
    let get = |key: &str| -> String {
        let pat = format!("{key}=\"");
        if let Some(start) = line.find(&pat) {
            let rest = &line[start + pat.len()..];
            if let Some(end) = rest.find('"') { return rest[..end].to_string(); }
        }
        String::new()
    };
    let name = get("NAME"); if name.is_empty() { return None; }
    let dtype = match get("TYPE").as_str() {
        "disk" => BlockDeviceType::Disk, "part" => BlockDeviceType::Part, "lvm" => BlockDeviceType::Lvm,
        "raid0" | "raid1" | "raid5" | "raid6" | "raid10" => BlockDeviceType::Raid,
        "loop" => BlockDeviceType::Loop, "crypt" => BlockDeviceType::Crypt, "rom" => BlockDeviceType::Rom,
        other => BlockDeviceType::Other(other.to_string()),
    };
    let size: u64 = get("SIZE").parse().unwrap_or(0);
    Some(BlockDevice {
        path: format!("/dev/{name}"), name, device_type: dtype, size_bytes: size,
        size_human: humanize_bytes(size),
        model: Some(get("MODEL")).filter(|s| !s.is_empty()),
        serial: Some(get("SERIAL")).filter(|s| !s.is_empty()),
        vendor: Some(get("VENDOR")).filter(|s| !s.is_empty()),
        transport: Some(get("TRAN")).filter(|s| !s.is_empty()),
        ro: get("RO") == "1", rm: get("RM") == "1", hotplug: get("HOTPLUG") == "1",
        state: Some(get("STATE")).filter(|s| !s.is_empty()), children: Vec::new(),
    })
}

pub fn humanize_bytes(b: u64) -> String {
    const UNITS: [&str; 6] = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
    let mut val = b as f64;
    for unit in UNITS { if val < 1024.0 { return format!("{val:.1} {unit}"); } val /= 1024.0; }
    format!("{val:.1} EiB")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn test_parse_lsblk() {
        let line = r#"NAME="sda" TYPE="disk" SIZE="500107862016" MODEL="Samsung SSD" SERIAL="S1234" VENDOR="ATA" TRAN="sata" RO="0" RM="0" HOTPLUG="0" STATE="running""#;
        let dev = parse_lsblk_line(line).unwrap();
        assert_eq!(dev.name, "sda");
        assert_eq!(dev.device_type, BlockDeviceType::Disk);
        assert_eq!(dev.size_bytes, 500107862016);
    }
    #[test]
    fn test_humanize() {
        assert_eq!(humanize_bytes(1024), "1.0 KiB");
        assert_eq!(humanize_bytes(1073741824), "1.0 GiB");
    }
}
