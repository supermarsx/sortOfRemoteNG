//! Power management — power actions, wake-on-LAN, AMT power control.

use crate::meshcentral::api_client::McApiClient;
use crate::meshcentral::error::MeshCentralResult;
use crate::meshcentral::types::*;
use serde_json::json;

impl McApiClient {
    /// Perform a power action on one or more devices.
    ///
    /// Power action types:
    /// - `McPowerAction::PowerOff` (2) — Power off
    /// - `McPowerAction::Reset` (3) — Reset / reboot
    /// - `McPowerAction::Sleep` (4) — Sleep mode
    /// - `McPowerAction::AmtPowerOn` (302) — Intel AMT power on
    /// - `McPowerAction::AmtPowerOff` (308) — Intel AMT power off
    /// - `McPowerAction::AmtReset` (310) — Intel AMT reset
    pub async fn power_action(
        &self,
        node_ids: &[String],
        action: McPowerAction,
    ) -> MeshCentralResult<String> {
        let mut payload = serde_json::Map::new();
        payload.insert("nodeids".to_string(), json!(node_ids));
        payload.insert("actiontype".to_string(), json!(action.action_type()));

        let resp = self.send_action("poweraction", payload).await?;
        let result = McApiClient::extract_result(&resp)
            .unwrap_or_else(|| format!("Power action {} sent", action.action_type()));
        Ok(result)
    }

    /// Wake one or more devices via Wake-on-LAN.
    pub async fn wake_devices(
        &self,
        node_ids: &[String],
    ) -> MeshCentralResult<String> {
        let mut payload = serde_json::Map::new();
        payload.insert("nodeids".to_string(), json!(node_ids));

        let resp = self.send_action("wakedevices", payload).await?;
        let result = McApiClient::extract_result(&resp)
            .unwrap_or_else(|| format!("Wake sent to {} device(s)", node_ids.len()));
        Ok(result)
    }

    /// Power off a single device.
    pub async fn power_off_device(
        &self,
        node_id: &str,
    ) -> MeshCentralResult<String> {
        self.power_action(
            &[node_id.to_string()],
            McPowerAction::PowerOff,
        )
        .await
    }

    /// Reboot/reset a single device.
    pub async fn reset_device(
        &self,
        node_id: &str,
    ) -> MeshCentralResult<String> {
        self.power_action(
            &[node_id.to_string()],
            McPowerAction::Reset,
        )
        .await
    }

    /// Put a single device to sleep.
    pub async fn sleep_device(
        &self,
        node_id: &str,
    ) -> MeshCentralResult<String> {
        self.power_action(
            &[node_id.to_string()],
            McPowerAction::Sleep,
        )
        .await
    }

    /// Power on a device using Intel AMT.
    pub async fn amt_power_on(
        &self,
        node_id: &str,
    ) -> MeshCentralResult<String> {
        self.power_action(
            &[node_id.to_string()],
            McPowerAction::AmtPowerOn,
        )
        .await
    }

    /// Power off a device using Intel AMT.
    pub async fn amt_power_off(
        &self,
        node_id: &str,
    ) -> MeshCentralResult<String> {
        self.power_action(
            &[node_id.to_string()],
            McPowerAction::AmtPowerOff,
        )
        .await
    }

    /// Reset a device using Intel AMT.
    pub async fn amt_reset(
        &self,
        node_id: &str,
    ) -> MeshCentralResult<String> {
        self.power_action(
            &[node_id.to_string()],
            McPowerAction::AmtReset,
        )
        .await
    }

    /// Batch power action on multiple devices with the same action.
    pub async fn batch_power_action(
        &self,
        node_ids: &[String],
        action: McPowerAction,
    ) -> MeshCentralResult<Vec<(String, bool, String)>> {
        let mut results = Vec::new();

        // MeshCentral supports batch power actions natively
        match self.power_action(node_ids, action).await {
            Ok(msg) => {
                for nid in node_ids {
                    results.push((nid.clone(), true, msg.clone()));
                }
            }
            Err(e) => {
                for nid in node_ids {
                    results.push((nid.clone(), false, e.to_string()));
                }
            }
        }

        Ok(results)
    }

    /// Get the current power state of a device.
    ///
    /// Returns the connection state flags from `McConnState`.
    /// Bits: 1=agent, 2=CIRA, 4=AMT, 8=relay, 16=MQTT
    pub async fn get_device_power_state(
        &self,
        node_id: &str,
    ) -> MeshCentralResult<u32> {
        let info = self.get_device_info(node_id).await?;
        Ok(info.device.as_ref().and_then(|d| d.conn).unwrap_or(0))
    }
}
