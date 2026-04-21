// ── sorng-ups – Device management ─────────────────────────────────────────────
//! Discover and interact with UPS devices via NUT.

use crate::client::UpsClient;
use crate::error::UpsResult;
use crate::types::*;

pub struct DeviceManager;

impl DeviceManager {
    /// List all UPS devices known to the NUT server (`upsc -l`).
    pub async fn list(client: &UpsClient) -> UpsResult<Vec<UpsDevice>> {
        let addr = format!(
            "{}:{}",
            client.config.nut_host.as_deref().unwrap_or("localhost"),
            client.config.nut_port.unwrap_or(3493),
        );
        let out = client
            .exec_ssh(&format!("{} -l {}", client.upsc_bin(), addr))
            .await?;
        let mut devices = Vec::new();
        for line in out.stdout.lines() {
            let name = line.trim();
            if name.is_empty() {
                continue;
            }
            // Fetch basic info for each device
            let dev = Self::get(client, name).await.unwrap_or(UpsDevice {
                name: name.to_string(),
                driver: None,
                port: None,
                description: None,
                manufacturer: None,
                model: None,
                serial: None,
                firmware: None,
                status: None,
            });
            devices.push(dev);
        }
        Ok(devices)
    }

    /// Get detailed info for a single UPS device.
    pub async fn get(client: &UpsClient, name: &str) -> UpsResult<UpsDevice> {
        let raw = client.exec_upsc(name, None).await?;
        let vars = parse_upsc_output(&raw);
        Ok(UpsDevice {
            name: name.to_string(),
            driver: vars.get("driver.name").cloned(),
            port: vars.get("driver.parameter.port").cloned(),
            description: vars
                .get("ups.description")
                .or(vars.get("device.description"))
                .cloned(),
            manufacturer: vars.get("device.mfr").or(vars.get("ups.mfr")).cloned(),
            model: vars.get("device.model").or(vars.get("ups.model")).cloned(),
            serial: vars
                .get("device.serial")
                .or(vars.get("ups.serial"))
                .cloned(),
            firmware: vars.get("ups.firmware").cloned(),
            status: vars.get("ups.status").cloned(),
        })
    }

    /// List all variables for a device (`upsc <name>@host`).
    pub async fn list_variables(client: &UpsClient, name: &str) -> UpsResult<Vec<UpsVariable>> {
        let raw = client.exec_upsc(name, None).await?;
        let vars = parse_upsc_output(&raw);

        // Get writable variables via `upsrw <name>@host`
        let rw_out = client
            .exec_ssh(&format!(
                "{} {}",
                client.upsrw_bin(),
                client
                    .upsc_cmd(name)
                    .split_whitespace()
                    .last()
                    .unwrap_or(name)
            ))
            .await
            .ok();
        let writable_set: std::collections::HashSet<String> = rw_out
            .map(|o| {
                o.stdout
                    .lines()
                    .filter_map(|l| {
                        let l = l.trim();
                        if l.starts_with('[') && l.ends_with(']') {
                            Some(l.trim_start_matches('[').trim_end_matches(']').to_string())
                        } else {
                            None
                        }
                    })
                    .collect()
            })
            .unwrap_or_default();

        let result: Vec<UpsVariable> = vars
            .into_iter()
            .map(|(k, v)| UpsVariable {
                writable: writable_set.contains(&k),
                name: k,
                value: Some(v),
                description: None,
                data_type: None,
                minimum: None,
                maximum: None,
                enum_values: Vec::new(),
            })
            .collect();
        Ok(result)
    }

    /// Get a single variable value.
    pub async fn get_variable(client: &UpsClient, name: &str, var: &str) -> UpsResult<UpsVariable> {
        let raw = client.exec_upsc(name, Some(var)).await?;
        let value = raw.trim().to_string();
        Ok(UpsVariable {
            name: var.to_string(),
            value: Some(value),
            writable: false,
            description: None,
            data_type: None,
            minimum: None,
            maximum: None,
            enum_values: Vec::new(),
        })
    }

    /// Set a writable variable via `upsrw`.
    pub async fn set_variable(
        client: &UpsClient,
        name: &str,
        var: &str,
        value: &str,
    ) -> UpsResult<()> {
        client.exec_upsrw(name, var, value).await?;
        Ok(())
    }

    /// List available instant commands for a device (`upscmd -l`).
    pub async fn list_commands(client: &UpsClient, name: &str) -> UpsResult<Vec<UpsCommand>> {
        let addr = format!(
            "{}@{}:{}",
            name,
            client.config.nut_host.as_deref().unwrap_or("localhost"),
            client.config.nut_port.unwrap_or(3493),
        );
        let out = client
            .exec_ssh(&format!("{} -l {}", client.upscmd_bin(), addr))
            .await?;
        let mut commands = Vec::new();
        for line in out.stdout.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with("Instant commands") {
                continue;
            }
            // Format: "command - description"
            if let Some((cmd, desc)) = line.split_once(" - ") {
                commands.push(UpsCommand {
                    name: cmd.trim().to_string(),
                    description: Some(desc.trim().to_string()),
                });
            } else {
                commands.push(UpsCommand {
                    name: line.to_string(),
                    description: None,
                });
            }
        }
        Ok(commands)
    }

    /// Run an instant command via `upscmd`.
    pub async fn run_command(client: &UpsClient, name: &str, cmd: &str) -> UpsResult<String> {
        client.exec_upscmd(name, cmd).await
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/// Parse `upsc` output lines of the form `key: value` into a map.
pub fn parse_upsc_output(raw: &str) -> std::collections::HashMap<String, String> {
    let mut map = std::collections::HashMap::new();
    for line in raw.lines() {
        if let Some((key, value)) = line.split_once(':') {
            map.insert(key.trim().to_string(), value.trim().to_string());
        }
    }
    map
}
