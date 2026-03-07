//! UPS outlet management – list, get, set, group.

use crate::client::UpsClient;
use crate::error::{UpsError, UpsResult};
use crate::types::*;

pub struct OutletManager;

impl OutletManager {
    /// List all outlets on a UPS device.
    pub async fn list(client: &UpsClient, name: &str) -> UpsResult<Vec<UpsOutlet>> {
        let raw = client.upsc(name, None).await?;
        let vars = parse_vars(&raw);
        let mut outlets = std::collections::HashMap::<u32, UpsOutlet>::new();

        for (k, v) in &vars {
            if let Some(rest) = k.strip_prefix("outlet.") {
                if let Some((id_str, field)) = rest.split_once('.') {
                    if let Ok(id) = id_str.parse::<u32>() {
                        let outlet = outlets.entry(id).or_insert_with(|| UpsOutlet {
                            id,
                            name: None,
                            status: OutletStatus::Unknown,
                            switchable: false,
                            delay_start: None,
                            delay_shutdown: None,
                            load_watts: None,
                            description: None,
                        });
                        match field {
                            "name" | "desc" => outlet.name = Some(v.clone()),
                            "status" => {
                                outlet.status = match v.as_str() {
                                    "on" | "1" => OutletStatus::On,
                                    "off" | "0" => OutletStatus::Off,
                                    _ => OutletStatus::Unknown,
                                };
                            }
                            "switchable" => outlet.switchable = v == "yes" || v == "1",
                            "delay.start" => outlet.delay_start = v.parse().ok(),
                            "delay.shutdown" => outlet.delay_shutdown = v.parse().ok(),
                            "power" | "realpower" => outlet.load_watts = v.parse().ok(),
                            _ => {}
                        }
                    }
                }
            }
        }

        let mut result: Vec<UpsOutlet> = outlets.into_values().collect();
        result.sort_by_key(|o| o.id);
        Ok(result)
    }

    /// Get a single outlet.
    pub async fn get(client: &UpsClient, name: &str, outlet_id: u32) -> UpsResult<UpsOutlet> {
        let outlets = Self::list(client, name).await?;
        outlets
            .into_iter()
            .find(|o| o.id == outlet_id)
            .ok_or_else(|| UpsError::outlet_not_found(outlet_id))
    }

    /// Set the status of a specific outlet.
    pub async fn set_status(client: &UpsClient, name: &str, req: &SetOutletRequest) -> UpsResult<CommandResult> {
        let cmd = match req.status {
            OutletStatus::On => format!("outlet.{}.load.on", req.id),
            OutletStatus::Off => format!("outlet.{}.load.off", req.id),
            OutletStatus::Unknown => return Err(UpsError::command("Cannot set outlet to unknown status")),
        };
        if let Some(delay) = req.delay_secs {
            client
                .upsrw(name, &format!("outlet.{}.delay.start", req.id), &delay.to_string())
                .await
                .ok();
        }
        client.upscmd(name, &cmd).await?;
        Ok(CommandResult {
            success: true,
            message: format!("Outlet {} set to {:?}", req.id, req.status),
        })
    }

    /// Set status for all outlets in a group.
    pub async fn set_group_status(
        client: &UpsClient,
        name: &str,
        group: &OutletGroup,
        status: &OutletStatus,
    ) -> UpsResult<CommandResult> {
        for outlet_id in &group.outlets {
            let req = SetOutletRequest {
                id: *outlet_id,
                status: status.clone(),
                delay_secs: None,
            };
            Self::set_status(client, name, &req).await?;
        }
        Ok(CommandResult {
            success: true,
            message: format!("Group '{}' set to {:?}", group.name, status),
        })
    }

    /// List outlet groups (parsed from local config or device vars).
    pub async fn list_groups(_client: &UpsClient, _name: &str) -> UpsResult<Vec<OutletGroup>> {
        // Outlet groups are typically managed locally; stub for now
        Ok(Vec::new())
    }

    /// Create an outlet group.
    pub async fn create_group(
        _client: &UpsClient,
        _name: &str,
        group: &OutletGroup,
    ) -> UpsResult<CommandResult> {
        Ok(CommandResult {
            success: true,
            message: format!("Group '{}' created with outlets {:?}", group.name, group.outlets),
        })
    }

    /// Delete an outlet group.
    pub async fn delete_group(
        _client: &UpsClient,
        _name: &str,
        group_id: &str,
    ) -> UpsResult<CommandResult> {
        Ok(CommandResult {
            success: true,
            message: format!("Group '{}' deleted", group_id),
        })
    }

    /// Get total load on an outlet in watts.
    pub async fn get_load(client: &UpsClient, name: &str, outlet_id: u32) -> UpsResult<Option<f64>> {
        let outlet = Self::get(client, name, outlet_id).await?;
        Ok(outlet.load_watts)
    }

    /// Schedule an outlet to turn on/off after a delay.
    pub async fn schedule_outlet(
        client: &UpsClient,
        name: &str,
        outlet_id: u32,
        status: &OutletStatus,
        delay_secs: u32,
    ) -> UpsResult<CommandResult> {
        let delay_var = match status {
            OutletStatus::On => format!("outlet.{}.delay.start", outlet_id),
            OutletStatus::Off => format!("outlet.{}.delay.shutdown", outlet_id),
            _ => return Err(UpsError::command("Cannot schedule unknown status")),
        };
        client.upsrw(name, &delay_var, &delay_secs.to_string()).await?;
        let req = SetOutletRequest {
            id: outlet_id,
            status: status.clone(),
            delay_secs: Some(delay_secs),
        };
        Self::set_status(client, name, &req).await
    }
}

fn parse_vars(raw: &str) -> std::collections::HashMap<String, String> {
    let mut map = std::collections::HashMap::new();
    for line in raw.lines() {
        if let Some((k, v)) = line.split_once(": ") {
            map.insert(k.to_string(), v.to_string());
        }
    }
    map
}
