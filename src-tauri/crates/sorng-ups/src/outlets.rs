// ── sorng-ups – Outlet management ─────────────────────────────────────────────
//! Control switched outlets on UPS devices (outlet.N.* variables).

use crate::client::UpsClient;
use crate::devices::parse_upsc_output;
use crate::error::{UpsError, UpsResult};
use crate::types::*;

pub struct OutletManager;

impl OutletManager {
    /// List all outlets for a device by scanning `outlet.N.*` variables.
    pub async fn list(client: &UpsClient, device: &str) -> UpsResult<Vec<UpsOutlet>> {
        let raw = client.exec_upsc(device, None).await?;
        let vars = parse_upsc_output(&raw);

        // Discover outlet IDs from variable names like outlet.1.status
        let mut ids: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
        for key in vars.keys() {
            if let Some(rest) = key.strip_prefix("outlet.") {
                if let Some(dot_pos) = rest.find('.') {
                    let id = &rest[..dot_pos];
                    // Only numeric outlet IDs
                    if id.chars().all(|c| c.is_ascii_digit()) {
                        ids.insert(id.to_string());
                    }
                }
            }
        }

        let mut outlets = Vec::new();
        for id in ids {
            let prefix = format!("outlet.{}.", id);
            outlets.push(UpsOutlet {
                id: id.clone(),
                name: vars.get(&format!("{prefix}name")).cloned(),
                status: vars.get(&format!("{prefix}status")).cloned(),
                switchable: vars
                    .get(&format!("{prefix}switchable"))
                    .map(|v| v == "yes" || v == "1" || v == "true"),
                delay_shutdown: vars
                    .get(&format!("{prefix}delay.shutdown"))
                    .and_then(|v| v.parse().ok()),
                delay_start: vars
                    .get(&format!("{prefix}delay.start"))
                    .and_then(|v| v.parse().ok()),
                description: vars.get(&format!("{prefix}desc")).cloned(),
                type_name: vars.get(&format!("{prefix}type")).cloned(),
            });
        }
        Ok(outlets)
    }

    /// Get a single outlet by ID.
    pub async fn get(
        client: &UpsClient,
        device: &str,
        outlet_id: &str,
    ) -> UpsResult<UpsOutlet> {
        let outlets = Self::list(client, device).await?;
        outlets
            .into_iter()
            .find(|o| o.id == outlet_id)
            .ok_or_else(|| UpsError::outlet_not_found(outlet_id))
    }

    /// Switch an outlet on via `upscmd outlet.N.load.on`.
    pub async fn switch_on(
        client: &UpsClient,
        device: &str,
        outlet_id: &str,
    ) -> UpsResult<()> {
        let cmd = format!("outlet.{}.load.on", outlet_id);
        client.exec_upscmd(device, &cmd).await?;
        Ok(())
    }

    /// Switch an outlet off via `upscmd outlet.N.load.off`.
    pub async fn switch_off(
        client: &UpsClient,
        device: &str,
        outlet_id: &str,
    ) -> UpsResult<()> {
        let cmd = format!("outlet.{}.load.off", outlet_id);
        client.exec_upscmd(device, &cmd).await?;
        Ok(())
    }

    /// Get shutdown & start delays for an outlet.
    pub async fn get_delay(
        client: &UpsClient,
        device: &str,
        outlet_id: &str,
    ) -> UpsResult<(u64, u64)> {
        let shutdown_var = format!("outlet.{}.delay.shutdown", outlet_id);
        let start_var = format!("outlet.{}.delay.start", outlet_id);
        let sd = client
            .exec_upsc(device, Some(&shutdown_var))
            .await
            .ok()
            .and_then(|v| v.trim().parse::<u64>().ok())
            .unwrap_or(0);
        let st = client
            .exec_upsc(device, Some(&start_var))
            .await
            .ok()
            .and_then(|v| v.trim().parse::<u64>().ok())
            .unwrap_or(0);
        Ok((sd, st))
    }

    /// Set shutdown & start delays for an outlet via `upsrw`.
    pub async fn set_delay(
        client: &UpsClient,
        device: &str,
        outlet_id: &str,
        shutdown_delay: u64,
        start_delay: u64,
    ) -> UpsResult<()> {
        let sd_var = format!("outlet.{}.delay.shutdown", outlet_id);
        let st_var = format!("outlet.{}.delay.start", outlet_id);
        client
            .exec_upsrw(device, &sd_var, &shutdown_delay.to_string())
            .await?;
        client
            .exec_upsrw(device, &st_var, &start_delay.to_string())
            .await?;
        Ok(())
    }
}
