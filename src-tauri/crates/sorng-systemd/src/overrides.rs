//! Unit override / drop-in management.

use crate::client;
use crate::error::SystemdError;
use crate::types::*;

/// List drop-in overrides for a unit.
pub async fn list_overrides(
    host: &SystemdHost,
    unit: &str,
) -> Result<Vec<UnitOverride>, SystemdError> {
    let dir = format!("/etc/systemd/system/{unit}.d/");
    let (stdout, _, code) = client::exec(host, "ls", &["-1", &dir]).await?;
    if code != 0 {
        return Ok(Vec::new());
    }

    let mut overrides = Vec::new();
    for file in stdout.lines() {
        let file = file.trim();
        if file.is_empty() || !file.ends_with(".conf") {
            continue;
        }
        let path = format!("{dir}{file}");
        let content = client::exec_ok(host, "cat", &[&path])
            .await
            .unwrap_or_default();
        overrides.push(UnitOverride {
            unit_name: unit.to_string(),
            override_name: file.to_string(),
            path,
            content,
        });
    }

    Ok(overrides)
}

/// Create or update a drop-in override.
pub async fn set_override(
    host: &SystemdHost,
    unit: &str,
    name: &str,
    content: &str,
) -> Result<(), SystemdError> {
    let dir = format!("/etc/systemd/system/{unit}.d");
    client::exec_ok(host, "mkdir", &["-p", &dir]).await?;
    let path = format!("{dir}/{name}");
    let escaped = content.replace('\'', "'\\''");
    client::exec_ok(
        host,
        "sh",
        &["-c", &format!("printf '%s' '{escaped}' > {path}")],
    )
    .await?;
    Ok(())
}

/// Remove a drop-in override.
pub async fn remove_override(
    host: &SystemdHost,
    unit: &str,
    name: &str,
) -> Result<(), SystemdError> {
    let path = format!("/etc/systemd/system/{unit}.d/{name}");
    client::exec_ok(host, "rm", &["-f", &path]).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn test_module_loads() {}
}
