//! Hardware monitoring — fans, temperatures, UPS, power schedule, LEDs.

use crate::client::SynoClient;
use crate::error::SynologyResult;
use crate::types::*;

pub struct HardwareManager;

impl HardwareManager {
    /// Get hardware overview (model, ram, fans, temps).
    pub async fn get_info(client: &SynoClient) -> SynologyResult<HardwareInfo> {
        let v = client.best_version("SYNO.Core.Hardware.Info", 1).unwrap_or(1);
        if client.has_api("SYNO.Core.Hardware.Info") {
            return client.api_call("SYNO.Core.Hardware.Info", v, "get", &[]).await;
        }
        // Fallback: build HardwareInfo from DSM.Info
        let _info: DsmInfo = client
            .api_call("SYNO.DSM.Info", client.best_version("SYNO.DSM.Info", 2).unwrap_or(1), "getinfo", &[])
            .await?;
        Ok(HardwareInfo {
            fan_speed: None,
            fan_speeds: vec![],
            temperatures: vec![],
            ups: None,
            beep_enabled: None,
            led_brightness: None,
            power_schedule: None,
        })
    }

    /// Get fan information.
    pub async fn get_fans(client: &SynoClient) -> SynologyResult<Vec<FanInfo>> {
        let hw = Self::get_info(client).await?;
        Ok(hw.fan_speeds)
    }

    /// Get temperature sensors.
    pub async fn get_temperatures(client: &SynoClient) -> SynologyResult<Vec<TempSensor>> {
        let hw = Self::get_info(client).await?;
        Ok(hw.temperatures)
    }

    // ─── UPS ─────────────────────────────────────────────────────

    /// Get UPS information.
    pub async fn get_ups(client: &SynoClient) -> SynologyResult<UpsInfo> {
        let v = client.best_version("SYNO.Core.ExternalDevice.UPS", 1).unwrap_or(1);
        client.api_call("SYNO.Core.ExternalDevice.UPS", v, "get", &[]).await
    }

    /// Set UPS configuration.
    pub async fn set_ups_config(
        client: &SynoClient,
        enable_ups: bool,
        mode: &str,  // "usb" or "snmp"
    ) -> SynologyResult<()> {
        let v = client.best_version("SYNO.Core.ExternalDevice.UPS", 1).unwrap_or(1);
        let en = if enable_ups { "true" } else { "false" };
        client.api_post_void(
            "SYNO.Core.ExternalDevice.UPS",
            v,
            "set",
            &[("ups_enable", en), ("ups_mode", mode)],
        )
        .await
    }

    // ─── Power Schedule ──────────────────────────────────────────

    /// Get power schedule rules.
    pub async fn get_power_schedule(client: &SynoClient) -> SynologyResult<PowerSchedule> {
        let v = client.best_version("SYNO.Core.Hardware.PowerSchedule", 1).unwrap_or(1);
        client.api_call("SYNO.Core.Hardware.PowerSchedule", v, "load", &[]).await
    }

    /// Set power schedule enabled.
    pub async fn set_power_schedule_enabled(
        client: &SynoClient,
        enabled: bool,
    ) -> SynologyResult<()> {
        let v = client.best_version("SYNO.Core.Hardware.PowerSchedule", 1).unwrap_or(1);
        let en = if enabled { "true" } else { "false" };
        client.api_post_void(
            "SYNO.Core.Hardware.PowerSchedule",
            v,
            "save",
            &[("schedule_enable", en)],
        )
        .await
    }

    // ─── LED ─────────────────────────────────────────────────────

    /// Get LED brightness settings.
    pub async fn get_led_brightness(client: &SynoClient) -> SynologyResult<serde_json::Value> {
        let v = client.best_version("SYNO.Core.Hardware.Led.Brightness", 1).unwrap_or(1);
        client.api_call("SYNO.Core.Hardware.Led.Brightness", v, "get", &[]).await
    }

    /// Set LED brightness (0 = off, 1 = dim, 2 = normal).
    pub async fn set_led_brightness(
        client: &SynoClient,
        level: u8,
    ) -> SynologyResult<()> {
        let v = client.best_version("SYNO.Core.Hardware.Led.Brightness", 1).unwrap_or(1);
        let l = level.to_string();
        client.api_post_void(
            "SYNO.Core.Hardware.Led.Brightness",
            v,
            "set",
            &[("brightness", &l)],
        )
        .await
    }

    // ─── Beep ────────────────────────────────────────────────────

    /// Trigger beep (locate NAS).
    pub async fn beep(client: &SynoClient) -> SynologyResult<()> {
        let v = client.best_version("SYNO.Core.Hardware.BeepControl", 1).unwrap_or(1);
        client.api_post_void("SYNO.Core.Hardware.BeepControl", v, "start", &[]).await
    }

    /// Stop beep.
    pub async fn stop_beep(client: &SynoClient) -> SynologyResult<()> {
        let v = client.best_version("SYNO.Core.Hardware.BeepControl", 1).unwrap_or(1);
        client.api_post_void("SYNO.Core.Hardware.BeepControl", v, "stop", &[]).await
    }
}
