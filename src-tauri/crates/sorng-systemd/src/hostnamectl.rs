//! hostnamectl — hostname and machine identity management.

use crate::client;
use crate::error::SystemdError;
use crate::types::*;

/// Get hostname info.
pub async fn get_info(host: &SystemdHost) -> Result<HostnameInfo, SystemdError> {
    let stdout = client::exec_ok(host, "hostnamectl", &["status", "--no-pager"]).await?;
    parse_hostnamectl(&stdout)
}

/// Set static hostname.
pub async fn set_hostname(host: &SystemdHost, hostname: &str) -> Result<(), SystemdError> {
    client::exec_ok(host, "hostnamectl", &["set-hostname", hostname]).await?;
    Ok(())
}

/// Set pretty hostname.
pub async fn set_pretty_hostname(host: &SystemdHost, pretty: &str) -> Result<(), SystemdError> {
    client::exec_ok(host, "hostnamectl", &["set-hostname", "--pretty", pretty]).await?;
    Ok(())
}

/// Set chassis type.
pub async fn set_chassis(host: &SystemdHost, chassis: &str) -> Result<(), SystemdError> {
    client::exec_ok(host, "hostnamectl", &["set-chassis", chassis]).await?;
    Ok(())
}

fn parse_hostnamectl(output: &str) -> Result<HostnameInfo, SystemdError> {
    let get = |key: &str| -> Option<String> {
        output
            .lines()
            .find(|l| l.trim_start().starts_with(key))
            .and_then(|l| l.split_once(':'))
            .map(|(_, v)| v.trim().to_string())
    };

    Ok(HostnameInfo {
        static_hostname: get("Static hostname").unwrap_or_default(),
        transient_hostname: get("Transient hostname"),
        pretty_hostname: get("Pretty hostname"),
        icon_name: get("Icon name"),
        chassis: get("Chassis"),
        deployment: get("Deployment"),
        location: get("Location"),
        kernel_name: get("Kernel").unwrap_or_default(),
        kernel_release: get("Kernel").unwrap_or_default(),
        os_pretty_name: get("Operating System").unwrap_or_default(),
        os_id: None,
        cpe_name: None,
        machine_id: get("Machine ID").unwrap_or_default(),
        boot_id: get("Boot ID").unwrap_or_default(),
        virtualization: get("Virtualization"),
        architecture: get("Architecture").unwrap_or_default(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_hostnamectl() {
        let output = "   Static hostname: myserver\n         Icon name: computer-vm\n           Chassis: vm\n        Machine ID: abc123\n           Boot ID: def456\n    Virtualization: kvm\n  Operating System: Ubuntu 24.04\n            Kernel: Linux 6.5.0\n      Architecture: x86-64\n";
        let info = parse_hostnamectl(output).unwrap();
        assert_eq!(info.static_hostname, "myserver");
        assert_eq!(info.chassis, Some("vm".to_string()));
        assert_eq!(info.virtualization, Some("kvm".to_string()));
    }
}
