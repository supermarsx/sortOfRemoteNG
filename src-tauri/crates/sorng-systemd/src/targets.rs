//! Boot target management.

use crate::client;
use crate::error::SystemdError;
use crate::types::SystemdHost;

/// Get the default boot target.
pub async fn get_default(host: &SystemdHost) -> Result<String, SystemdError> {
    let stdout = client::exec_ok(host, "systemctl", &["get-default"]).await?;
    Ok(stdout.trim().to_string())
}

/// Set the default boot target.
pub async fn set_default(host: &SystemdHost, target: &str) -> Result<(), SystemdError> {
    client::exec_ok(host, "systemctl", &["set-default", target]).await?;
    Ok(())
}

/// List available targets.
pub async fn list_targets(host: &SystemdHost) -> Result<Vec<String>, SystemdError> {
    let stdout = client::exec_ok(
        host,
        "systemctl",
        &[
            "list-units",
            "--type=target",
            "--all",
            "--no-pager",
            "--plain",
            "--no-legend",
        ],
    )
    .await?;
    Ok(stdout
        .lines()
        .filter_map(|l| l.split_whitespace().next().map(|s| s.to_string()))
        .collect())
}

/// Isolate a target (switch to it).
pub async fn isolate(host: &SystemdHost, target: &str) -> Result<(), SystemdError> {
    client::exec_ok(host, "systemctl", &["isolate", target]).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn test_module_loads() {}
}
