//! SMART disk health via smartctl.
use crate::client;
use crate::error::DiskError;
use crate::types::*;

pub async fn get_info(host: &DiskHost, device: &str) -> Result<SmartInfo, DiskError> {
    let stdout = client::exec_ok(host, "smartctl", &["-a", device]).await?;
    Ok(parse_smartctl(&stdout, device))
}

pub async fn run_test(host: &DiskHost, device: &str, test_type: &str) -> Result<String, DiskError> {
    client::exec_ok(host, "smartctl", &["-t", test_type, device]).await
}

fn parse_smartctl(output: &str, device: &str) -> SmartInfo {
    let mut info = SmartInfo {
        device: device.into(),
        model: None,
        serial: None,
        firmware: None,
        passed: true,
        temperature_c: None,
        power_on_hours: None,
        reallocated_sectors: None,
        pending_sectors: None,
        offline_uncorrectable: None,
        attributes: Vec::new(),
    };
    let mut in_attrs = false;
    for line in output.lines() {
        let line = line.trim();
        if line.starts_with("Device Model:") || line.starts_with("Model Number:") {
            info.model = Some(line.split(':').nth(1).unwrap_or("").trim().into());
        } else if line.starts_with("Serial Number:") {
            info.serial = Some(line.split(':').nth(1).unwrap_or("").trim().into());
        } else if line.starts_with("Firmware Version:") {
            info.firmware = Some(line.split(':').nth(1).unwrap_or("").trim().into());
        } else if line.contains("PASSED") {
            info.passed = true;
        } else if line.contains("FAILED") {
            info.passed = false;
        } else if line.starts_with("ID#") {
            in_attrs = true;
            continue;
        } else if in_attrs && !line.is_empty() {
            if let Some(attr) = parse_smart_attr(line) {
                match attr.id {
                    5 => info.reallocated_sectors = Some(attr.raw.trim().parse().unwrap_or(0)),
                    9 => info.power_on_hours = Some(attr.raw.trim().parse().unwrap_or(0)),
                    194 | 190 => {
                        info.temperature_c = Some(
                            attr.raw
                                .trim()
                                .split_whitespace()
                                .next()
                                .and_then(|v| v.parse().ok())
                                .unwrap_or(0),
                        )
                    }
                    197 => info.pending_sectors = Some(attr.raw.trim().parse().unwrap_or(0)),
                    198 => info.offline_uncorrectable = Some(attr.raw.trim().parse().unwrap_or(0)),
                    _ => {}
                }
                info.attributes.push(attr);
            }
        }
    }
    info
}

fn parse_smart_attr(line: &str) -> Option<SmartAttribute> {
    let cols: Vec<&str> = line.split_whitespace().collect();
    if cols.len() < 10 {
        return None;
    }
    Some(SmartAttribute {
        id: cols[0].parse().ok()?,
        name: cols[1].into(),
        value: cols[3].parse().unwrap_or(0),
        worst: cols[4].parse().unwrap_or(0),
        threshold: cols[5].parse().unwrap_or(0),
        raw: cols[9..].join(" "),
        failing: cols[8] == "FAILING_NOW",
    })
}

#[cfg(test)]
mod tests {
    #[test]
    fn test_module() {}
}
