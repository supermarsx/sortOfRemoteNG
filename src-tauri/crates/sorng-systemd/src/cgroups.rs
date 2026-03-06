//! cgroup resource control — CPU, memory, IO limits and monitoring.

use crate::client;
use crate::error::SystemdError;
use crate::types::*;

/// Get resource usage for top units (like systemd-cgtop).
pub async fn cgtop(host: &SystemdHost, count: Option<u32>) -> Result<Vec<CgroupStats>, SystemdError> {
    let n = count.unwrap_or(20).to_string();
    let stdout = client::exec_ok(host, "systemd-cgtop", &["-b", "-n", "1", "--depth=1"]).await?;
    Ok(parse_cgtop(&stdout))
}

/// Set resource limits for a unit at runtime.
pub async fn set_property(host: &SystemdHost, unit: &str, property: &str, value: &str) -> Result<(), SystemdError> {
    client::exec_ok(host, "systemctl", &["set-property", unit, &format!("{property}={value}")]).await?;
    Ok(())
}

fn parse_cgtop(_output: &str) -> Vec<CgroupStats> {
    // TODO: parse systemd-cgtop output
    Vec::new()
}

#[cfg(test)]
mod tests {
    #[test]
    fn test_module_loads() {}
}
