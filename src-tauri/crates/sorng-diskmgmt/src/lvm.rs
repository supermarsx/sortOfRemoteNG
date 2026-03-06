//! LVM management — PV, VG, LV operations.
use crate::client;
use crate::error::DiskError;
use crate::types::*;

pub async fn list_pvs(host: &DiskHost) -> Result<Vec<PhysicalVolume>, DiskError> {
    let stdout = client::exec_ok(host, "pvs", &["--noheadings", "--nosuffix", "--separator", "|", "-o", "pv_name,vg_name,pv_size,pv_free,pv_uuid,pv_fmt"]).await?;
    Ok(stdout.lines().filter_map(parse_pv_line).collect())
}
pub async fn list_vgs(host: &DiskHost) -> Result<Vec<VolumeGroup>, DiskError> {
    let stdout = client::exec_ok(host, "vgs", &["--noheadings", "--nosuffix", "--separator", "|", "-o", "vg_name,vg_size,vg_free,pv_count,lv_count,vg_uuid"]).await?;
    Ok(stdout.lines().filter_map(parse_vg_line).collect())
}
pub async fn list_lvs(host: &DiskHost) -> Result<Vec<LogicalVolume>, DiskError> {
    let stdout = client::exec_ok(host, "lvs", &["--noheadings", "--nosuffix", "--separator", "|", "-o", "lv_name,vg_name,lv_path,lv_size,lv_uuid,lv_attr,origin,snap_percent,pool_lv"]).await?;
    Ok(stdout.lines().filter_map(parse_lv_line).collect())
}
pub async fn create_pv(host: &DiskHost, device: &str) -> Result<(), DiskError> { client::exec_ok(host, "pvcreate", &[device]).await?; Ok(()) }
pub async fn create_vg(host: &DiskHost, name: &str, pvs: &[&str]) -> Result<(), DiskError> {
    let mut args = vec![name]; args.extend_from_slice(pvs);
    client::exec_ok(host, "vgcreate", &args).await?; Ok(())
}
pub async fn create_lv(host: &DiskHost, opts: &CreateLvOpts) -> Result<(), DiskError> {
    let mut args = vec!["-n", &opts.name, "-L", &opts.size, &opts.vg_name];
    let tp;
    if let Some(ref t) = opts.thin_pool { tp = format!("--thinpool {t}"); args.push(&tp); }
    client::exec_ok(host, "lvcreate", &args).await?; Ok(())
}
pub async fn extend_lv(host: &DiskHost, lv_path: &str, size: &str) -> Result<(), DiskError> {
    client::exec_ok(host, "lvextend", &["-L", size, lv_path]).await?; Ok(())
}
pub async fn remove_lv(host: &DiskHost, lv_path: &str) -> Result<(), DiskError> {
    client::exec_ok(host, "lvremove", &["-f", lv_path]).await?; Ok(())
}

fn parse_pv_line(line: &str) -> Option<PhysicalVolume> {
    let cols: Vec<&str> = line.trim().split('|').collect();
    if cols.len() < 6 { return None; }
    Some(PhysicalVolume { pv_name: cols[0].trim().into(), vg_name: Some(cols[1].trim().into()).filter(|s: &String| !s.is_empty()), pv_size: cols[2].trim().into(), pv_free: cols[3].trim().into(), pv_uuid: cols[4].trim().into(), fmt: cols[5].trim().into() })
}
fn parse_vg_line(line: &str) -> Option<VolumeGroup> {
    let cols: Vec<&str> = line.trim().split('|').collect();
    if cols.len() < 6 { return None; }
    Some(VolumeGroup { vg_name: cols[0].trim().into(), vg_size: cols[1].trim().into(), vg_free: cols[2].trim().into(), pv_count: cols[3].trim().parse().unwrap_or(0), lv_count: cols[4].trim().parse().unwrap_or(0), vg_uuid: cols[5].trim().into() })
}
fn parse_lv_line(line: &str) -> Option<LogicalVolume> {
    let cols: Vec<&str> = line.trim().split('|').collect();
    if cols.len() < 6 { return None; }
    Some(LogicalVolume { lv_name: cols[0].trim().into(), vg_name: cols[1].trim().into(), lv_path: cols[2].trim().into(), lv_size: cols[3].trim().into(), lv_uuid: cols[4].trim().into(), lv_attr: cols[5].trim().into(), origin: cols.get(6).map(|s| s.trim().to_string()).filter(|s| !s.is_empty()), snap_percent: cols.get(7).map(|s| s.trim().to_string()).filter(|s| !s.is_empty()), pool_lv: cols.get(8).map(|s| s.trim().to_string()).filter(|s| !s.is_empty()) })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn test_parse_pv() {
        let line = "  /dev/sda1|vg0|500.00g|100.00g|abc-123|lvm2";
        let pv = parse_pv_line(line).unwrap();
        assert_eq!(pv.pv_name, "/dev/sda1");
        assert_eq!(pv.vg_name, Some("vg0".into()));
    }
    #[test]
    fn test_parse_vg() {
        let line = "  vg0|500.00g|100.00g|1|3|def-456";
        let vg = parse_vg_line(line).unwrap();
        assert_eq!(vg.vg_name, "vg0");
        assert_eq!(vg.lv_count, 3);
    }
}
