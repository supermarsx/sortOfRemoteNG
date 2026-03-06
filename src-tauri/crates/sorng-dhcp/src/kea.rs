//! Kea DHCP configuration management.
use crate::client;
use crate::error::DhcpError;
use crate::types::*;

pub async fn get_config(host: &DhcpHost) -> Result<KeaDhcp4Config, DhcpError> {
    let content = client::read_file(host, "/etc/kea/kea-dhcp4.conf").await?;
    let val: serde_json::Value = serde_json::from_str(&content).map_err(|e| DhcpError::ConfigParseError(e.to_string()))?;
    parse_kea_config(&val)
}
pub async fn restart(host: &DhcpHost) -> Result<(), DhcpError> { client::exec_ok(host, "systemctl", &["restart", "kea-dhcp4-server"]).await?; Ok(()) }
pub async fn check_config(host: &DhcpHost) -> Result<bool, DhcpError> {
    let (_, _, code) = client::exec(host, "kea-dhcp4", &["-t", "/etc/kea/kea-dhcp4.conf"]).await?;
    Ok(code == 0)
}

fn parse_kea_config(val: &serde_json::Value) -> Result<KeaDhcp4Config, DhcpError> {
    let dhcp4 = val.get("Dhcp4").unwrap_or(val);
    let interfaces = dhcp4.get("interfaces-config").and_then(|v| v.get("interfaces")).and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect()).unwrap_or_default();
    let valid_lifetime = dhcp4.get("valid-lifetime").and_then(|v| v.as_u64()).map(|v| v as u32);
    let renew_timer = dhcp4.get("renew-timer").and_then(|v| v.as_u64()).map(|v| v as u32);
    let rebind_timer = dhcp4.get("rebind-timer").and_then(|v| v.as_u64()).map(|v| v as u32);
    Ok(KeaDhcp4Config { interfaces, subnets: Vec::new(), reservations: Vec::new(), lease_database: None, valid_lifetime, renew_timer, rebind_timer })
}

#[cfg(test)]
mod tests { #[test] fn test_module() {} }
