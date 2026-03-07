//! UPS device management – list, add, remove, inspect UPS devices.

use crate::client::UpsClient;
use crate::error::{UpsError, UpsResult};
use crate::types::*;

pub struct DeviceManager;

impl DeviceManager {
    /// List all UPS devices known to the NUT server.
    pub async fn list(client: &UpsClient) -> UpsResult<Vec<UpsDevice>> {
        let out = client.exec_ssh("upsc -l 2>/dev/null").await?;
        let mut devices = Vec::new();
        for name in out.stdout.lines() {
            let name = name.trim();
            if name.is_empty() {
                continue;
            }
            match Self::get(client, name).await {
                Ok(d) => devices.push(d),
                Err(_) => {
                    devices.push(UpsDevice {
                        name: name.to_string(),
                        description: None,
                        driver: String::new(),
                        port: String::new(),
                        manufacturer: None,
                        model: None,
                        serial: None,
                        firmware_version: None,
                        ups_status: None,
                        battery_charge: None,
                        battery_runtime: None,
                        input_voltage: None,
                        output_voltage: None,
                        output_power: None,
                        ups_load: None,
                        ups_temperature: None,
                        beeper_status: None,
                    });
                }
            }
        }
        Ok(devices)
    }

    /// Get details for a single UPS device.
    pub async fn get(client: &UpsClient, name: &str) -> UpsResult<UpsDevice> {
        let raw = client.upsc(name, None).await?;
        let vars = parse_upsc_output(&raw);
        Ok(UpsDevice {
            name: name.to_string(),
            description: vars.get("ups.description").cloned().or_else(|| vars.get("ups.id").cloned()),
            driver: vars.get("driver.name").cloned().unwrap_or_default(),
            port: vars.get("driver.port").cloned().unwrap_or_default(),
            manufacturer: vars.get("ups.mfr").cloned().or_else(|| vars.get("device.mfr").cloned()),
            model: vars.get("ups.model").cloned().or_else(|| vars.get("device.model").cloned()),
            serial: vars.get("ups.serial").cloned().or_else(|| vars.get("device.serial").cloned()),
            firmware_version: vars.get("ups.firmware").cloned(),
            ups_status: vars.get("ups.status").cloned(),
            battery_charge: vars.get("battery.charge").and_then(|v| v.parse().ok()),
            battery_runtime: vars.get("battery.runtime").and_then(|v| v.parse().ok()),
            input_voltage: vars.get("input.voltage").and_then(|v| v.parse().ok()),
            output_voltage: vars.get("output.voltage").and_then(|v| v.parse().ok()),
            output_power: vars.get("ups.power").and_then(|v| v.parse().ok()),
            ups_load: vars.get("ups.load").and_then(|v| v.parse().ok()),
            ups_temperature: vars.get("ups.temperature").and_then(|v| v.parse().ok()),
            beeper_status: vars.get("ups.beeper.status").cloned(),
        })
    }

    /// Add a new UPS device to the NUT configuration.
    pub async fn add(client: &UpsClient, req: &CreateDeviceRequest) -> UpsResult<CommandResult> {
        let mut block = format!("[{}]\n  driver = {}\n  port = {}\n", req.name, req.driver, req.port);
        if let Some(desc) = &req.description {
            block.push_str(&format!("  desc = \"{}\"\n", desc));
        }
        if let Some(extra) = &req.extra_config {
            for (k, v) in extra {
                block.push_str(&format!("  {} = {}\n", k, v));
            }
        }
        let existing = client.read_remote_file("/etc/nut/ups.conf").await.unwrap_or_default();
        let new_content = format!("{}\n{}", existing.trim_end(), block);
        client.write_remote_file("/etc/nut/ups.conf", &new_content).await?;
        Ok(CommandResult { success: true, message: format!("Device '{}' added", req.name) })
    }

    /// Remove a UPS device from the NUT configuration.
    pub async fn remove(client: &UpsClient, name: &str) -> UpsResult<CommandResult> {
        let content = client.read_remote_file("/etc/nut/ups.conf").await?;
        let mut result = String::new();
        let mut skip = false;
        for line in content.lines() {
            if line.starts_with('[') {
                let section = line.trim_start_matches('[').split(']').next().unwrap_or("");
                skip = section == name;
            }
            if !skip {
                result.push_str(line);
                result.push('\n');
            }
        }
        client.write_remote_file("/etc/nut/ups.conf", &result).await?;
        Ok(CommandResult { success: true, message: format!("Device '{}' removed", name) })
    }

    /// List all variables for a UPS device.
    pub async fn list_variables(client: &UpsClient, name: &str) -> UpsResult<Vec<UpsVariable>> {
        let raw = client.upsc(name, None).await?;
        let rw_raw = client.exec_ssh(&format!(
            "upsrw {}@{}:{} 2>/dev/null",
            name,
            client.nut_host(),
            client.nut_port()
        )).await.ok();
        let rw_vars: Vec<String> = rw_raw
            .map(|o| {
                o.stdout
                    .lines()
                    .filter(|l| l.starts_with('['))
                    .map(|l| l.trim_start_matches('[').split(']').next().unwrap_or("").to_string())
                    .collect()
            })
            .unwrap_or_default();

        let mut vars = Vec::new();
        for line in raw.lines() {
            if let Some((k, v)) = line.split_once(": ") {
                vars.push(UpsVariable {
                    name: k.to_string(),
                    value: v.to_string(),
                    type_: None,
                    description: None,
                    writable: rw_vars.contains(&k.to_string()),
                });
            }
        }
        Ok(vars)
    }

    /// Get a single variable value.
    pub async fn get_variable(client: &UpsClient, name: &str, var: &str) -> UpsResult<String> {
        let val = client.upsc(name, Some(var)).await?;
        Ok(val.trim().to_string())
    }

    /// Set a writable variable.
    pub async fn set_variable(client: &UpsClient, name: &str, var: &str, val: &str) -> UpsResult<CommandResult> {
        client.upsrw(name, var, val).await?;
        Ok(CommandResult { success: true, message: format!("Variable {var} set to {val}") })
    }

    /// List instant commands supported by a UPS device.
    pub async fn list_commands(client: &UpsClient, name: &str) -> UpsResult<Vec<String>> {
        let target = format!("{}@{}:{}", name, client.nut_host(), client.nut_port());
        let out = client.exec_ssh(&format!("upscmd -l {}", target)).await?;
        let cmds: Vec<String> = out
            .stdout
            .lines()
            .filter(|l| !l.is_empty() && !l.starts_with("Instant"))
            .map(|l| l.split_whitespace().next().unwrap_or("").to_string())
            .filter(|s| !s.is_empty())
            .collect();
        Ok(cmds)
    }

    /// List clients connected to a UPS device.
    pub async fn list_clients(client: &UpsClient, name: &str) -> UpsResult<Vec<String>> {
        let out = client
            .exec_ssh(&format!(
                "upsc -c {}@{}:{}",
                name,
                client.nut_host(),
                client.nut_port()
            ))
            .await?;
        let clients: Vec<String> = out.stdout.lines().map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect();
        Ok(clients)
    }

    /// List available NUT drivers.
    pub async fn list_drivers(client: &UpsClient) -> UpsResult<Vec<UpsDriver>> {
        let out = client.exec_ssh("ls /lib/nut/ 2>/dev/null || ls /usr/lib/nut/ 2>/dev/null || echo ''").await?;
        let drivers: Vec<UpsDriver> = out
            .stdout
            .lines()
            .filter(|l| !l.is_empty())
            .map(|l| UpsDriver {
                name: l.trim().to_string(),
                version: None,
                description: None,
                supported_models: Vec::new(),
            })
            .collect();
        Ok(drivers)
    }

    /// Get the device type (online, offline, line-interactive, etc.).
    pub async fn get_device_type(client: &UpsClient, name: &str) -> UpsResult<String> {
        let val = client.upsc(name, Some("ups.type")).await.unwrap_or_default();
        Ok(val.trim().to_string())
    }
}

// ── Helpers ──────────────────────────────────────────────────────────

fn parse_upsc_output(raw: &str) -> std::collections::HashMap<String, String> {
    let mut map = std::collections::HashMap::new();
    for line in raw.lines() {
        if let Some((k, v)) = line.split_once(": ") {
            map.insert(k.to_string(), v.to_string());
        }
    }
    map
}
