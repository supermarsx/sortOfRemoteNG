//! Socket unit management.

use crate::client;
use crate::error::SystemdError;
use crate::types::*;

/// List all sockets.
pub async fn list_sockets(host: &SystemdHost) -> Result<Vec<SystemdSocket>, SystemdError> {
    let stdout = client::exec_ok(
        host,
        "systemctl",
        &[
            "list-sockets",
            "--all",
            "--no-pager",
            "--plain",
            "--no-legend",
        ],
    )
    .await?;
    Ok(parse_sockets(&stdout))
}

fn parse_sockets(_output: &str) -> Vec<SystemdSocket> {
    // TODO: parse list-sockets output
    Vec::new()
}

#[cfg(test)]
mod tests {
    #[test]
    fn test_module_loads() {}
}
