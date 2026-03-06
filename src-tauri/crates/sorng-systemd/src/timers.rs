//! Timer unit management.

use crate::client;
use crate::error::SystemdError;
use crate::types::*;

/// List all active timers.
pub async fn list_timers(host: &SystemdHost) -> Result<Vec<SystemdTimer>, SystemdError> {
    let stdout = client::exec_ok(host, "systemctl", &["list-timers", "--all", "--no-pager", "--plain", "--no-legend"]).await?;
    Ok(parse_timers(&stdout))
}

fn parse_timers(_output: &str) -> Vec<SystemdTimer> {
    // TODO: parse list-timers output
    Vec::new()
}

#[cfg(test)]
mod tests {
    #[test]
    fn test_module_loads() {}
}
