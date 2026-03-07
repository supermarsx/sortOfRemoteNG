//! NUT server management – server info, device listing, direct NUT protocol interaction.

use crate::client::UpsClient;
use crate::error::UpsResult;
use crate::types::*;

pub struct NutManager;

impl NutManager {
    /// Get NUT server information (version, device count, etc.).
    pub async fn get_server_info(client: &UpsClient) -> UpsResult<NutServerInfo> {
        let ver_out = client
            .exec_ssh("upsd -V 2>/dev/null || echo ''")
            .await
            .ok()
            .map(|o| o.stdout.trim().to_string())
            .filter(|s| !s.is_empty());

        let list_out = client.exec_ssh("upsc -l 2>/dev/null || echo ''").await?;
        let num_devices = list_out
            .stdout
            .lines()
            .filter(|l| !l.trim().is_empty())
            .count() as u32;

        let clients_out = client
            .exec_ssh("upsc -c 2>/dev/null || echo '0'")
            .await
            .ok()
            .map(|o| o.stdout.trim().to_string());
        let num_clients = clients_out
            .and_then(|s| s.lines().count().checked_sub(0).map(|c| c as u32))
            .unwrap_or(0);

        Ok(NutServerInfo {
            version: ver_out,
            num_ups_devices: num_devices,
            num_clients,
            num_connections: 0,
            server_actions: vec![
                "FSD".to_string(),
                "RELOAD".to_string(),
            ],
        })
    }

    /// List all UPS device names known to the NUT server.
    pub async fn list_ups_devices(client: &UpsClient) -> UpsResult<Vec<String>> {
        let out = client.exec_ssh("upsc -l 2>/dev/null").await?;
        let names: Vec<String> = out
            .stdout
            .lines()
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty())
            .collect();
        Ok(names)
    }

    /// Get all variable data for a UPS device (raw key-value pairs).
    pub async fn get_ups_data(client: &UpsClient, name: &str) -> UpsResult<serde_json::Value> {
        let raw = client.upsc(name, None).await?;
        let mut map = serde_json::Map::new();
        for line in raw.lines() {
            if let Some((k, v)) = line.split_once(": ") {
                map.insert(k.to_string(), serde_json::Value::String(v.to_string()));
            }
        }
        Ok(serde_json::Value::Object(map))
    }

    /// Run an instant command on a UPS device.
    pub async fn run_ups_command(client: &UpsClient, name: &str, command: &str) -> UpsResult<CommandResult> {
        let output = client.upscmd(name, command).await?;
        Ok(CommandResult {
            success: true,
            message: output,
        })
    }

    /// List writable variables for a UPS device.
    pub async fn list_writable_vars(client: &UpsClient, name: &str) -> UpsResult<Vec<UpsVariable>> {
        let target = format!("{}@{}:{}", name, client.nut_host(), client.nut_port());
        let out = client.exec_ssh(&format!("upsrw {}", target)).await?;

        let mut vars = Vec::new();
        let mut current_name = String::new();
        let mut current_type = None;
        let mut current_value = String::new();
        let mut current_desc = None;

        for line in out.stdout.lines() {
            let line = line.trim();
            if line.starts_with('[') {
                if !current_name.is_empty() {
                    vars.push(UpsVariable {
                        name: current_name.clone(),
                        value: current_value.clone(),
                        type_: current_type.take(),
                        description: current_desc.take(),
                        writable: true,
                    });
                }
                current_name = line
                    .trim_start_matches('[')
                    .split(']')
                    .next()
                    .unwrap_or("")
                    .to_string();
                current_value.clear();
                current_desc = None;
                current_type = None;
            } else if line.starts_with("Type:") {
                let t = line.trim_start_matches("Type:").trim();
                current_type = Some(match t {
                    "STRING" => VarType::String,
                    "ENUM" => VarType::Enum,
                    "RANGE" => VarType::Range,
                    _ => VarType::String,
                });
            } else if line.starts_with("Value:") {
                current_value = line.trim_start_matches("Value:").trim().to_string();
            } else if line.starts_with("Description:") {
                current_desc = Some(line.trim_start_matches("Description:").trim().to_string());
            }
        }
        if !current_name.is_empty() {
            vars.push(UpsVariable {
                name: current_name,
                value: current_value,
                type_: current_type,
                description: current_desc,
                writable: true,
            });
        }

        Ok(vars)
    }

    /// Set a variable via NUT.
    pub async fn set_variable(client: &UpsClient, name: &str, var: &str, val: &str) -> UpsResult<CommandResult> {
        client.upsrw(name, var, val).await?;
        Ok(CommandResult {
            success: true,
            message: format!("Variable {} set to {}", var, val),
        })
    }

    /// Login to the NUT server for a UPS (acquire monitoring).
    pub async fn login(client: &UpsClient, name: &str) -> UpsResult<CommandResult> {
        let target = format!("{}@{}:{}", name, client.nut_host(), client.nut_port());
        let auth = match (&client.config.nut_user, &client.config.nut_password) {
            (Some(u), Some(p)) => format!("-u {} -p {}", u, p),
            _ => String::new(),
        };
        client.exec_ssh(&format!("upscmd {} {} login", auth, target)).await?;
        Ok(CommandResult {
            success: true,
            message: format!("Logged in to {}", name),
        })
    }

    /// Logout from the NUT server for a UPS.
    pub async fn logout(client: &UpsClient, name: &str) -> UpsResult<CommandResult> {
        let target = format!("{}@{}:{}", name, client.nut_host(), client.nut_port());
        client.exec_ssh(&format!("upscmd {} logout", target)).await?;
        Ok(CommandResult {
            success: true,
            message: format!("Logged out from {}", name),
        })
    }

    /// Get the number of active logins for a UPS device.
    pub async fn get_num_logins(client: &UpsClient, name: &str) -> UpsResult<u32> {
        let val = client.upsc(name, Some("ups.numlogins")).await.unwrap_or_default();
        Ok(val.trim().parse().unwrap_or(0))
    }
}
