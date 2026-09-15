//! Hardware monitoring — fans, temperatures, UPS, power schedule, LEDs.

use crate::client::SynoClient;
use crate::error::SynologyResult;
use crate::types::*;
use serde::{de::Error as _, Deserialize, Deserializer};

pub struct HardwareManager;

/// `SYNO.Core.ExternalDevice.UPS get` (vcf-content-factory `synology-ups.md`,
/// DSM 7.3.2; pmilano1 probed `core-externaldevice.md`, DSM 7.4).
#[derive(Deserialize)]
struct UpsWire {
    enable: bool,
    model: Option<String>,
    status: String,
    charge: Option<f64>,
    /// NUT `battery.runtime`, in seconds. Signed and lenient so an idle
    /// placeholder never fails the whole read.
    #[serde(default, deserialize_with = "crate::wire::opt_i64_lenient")]
    runtime: Option<i64>,
    mode: Option<String>,
    usb_ups_connect: Option<bool>,
}

impl From<UpsWire> for UpsInfo {
    fn from(wire: UpsWire) -> Self {
        // Without an enabled or connected UPS, DSM reports `charge: 0` and
        // `runtime: 0` as placeholders, not as battery readings.
        let reporting = wire.enable || wire.usb_ups_connect == Some(true);
        Self {
            enabled: wire.enable,
            model: wire.model.filter(|model| !model.is_empty()),
            status: wire.status,
            battery_charge: wire.charge.filter(|_| reporting),
            load_percent: None,
            // DSM's UPS support is NUT, whose `battery.runtime` is in seconds.
            runtime_minutes: wire
                .runtime
                .filter(|seconds| reporting && *seconds >= 0)
                .and_then(|seconds| u32::try_from(seconds / 60).ok()),
            server_type: wire.mode.filter(|mode| !mode.is_empty()),
        }
    }
}

/// `SYNO.Core.Hardware.PowerSchedule load` (N4S4/synology-api
/// `event_scheduler.py::load_power_schedule`; dsm_helper `power.dart`).
#[derive(Deserialize)]
struct PowerScheduleWire {
    #[serde(default)]
    poweron_tasks: Vec<PowerTaskWire>,
    #[serde(default)]
    poweroff_tasks: Vec<PowerTaskWire>,
}

#[derive(Deserialize)]
struct PowerTaskWire {
    enabled: bool,
    hour: u32,
    min: u32,
    #[serde(default, deserialize_with = "weekday_list")]
    weekdays: Vec<u32>,
}

/// DSM's `weekdays` CSV (`"1,2,3,4,5"`). Any token that is not a number fails
/// the decode rather than silently dropping a day.
fn weekday_list<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Vec<u32>, D::Error> {
    String::deserialize(deserializer)?
        .split(',')
        .map(str::trim)
        .filter(|day| !day.is_empty())
        .map(|day| {
            day.parse()
                .map_err(|_| D::Error::custom("expected a comma-separated weekday list"))
        })
        .collect()
}

impl PowerTaskWire {
    fn into_entry(self, action: &str) -> PowerScheduleEntry {
        PowerScheduleEntry {
            action: action.to_owned(),
            hour: self.hour,
            minute: self.min,
            weekday: self.weekdays,
            enabled: self.enabled,
        }
    }
}

impl From<PowerScheduleWire> for PowerSchedule {
    fn from(wire: PowerScheduleWire) -> Self {
        let entries: Vec<_> = wire
            .poweron_tasks
            .into_iter()
            .map(|task| task.into_entry("poweron"))
            .chain(
                wire.poweroff_tasks
                    .into_iter()
                    .map(|task| task.into_entry("poweroff")),
            )
            .collect();
        Self {
            enabled: entries.iter().any(|entry| entry.enabled),
            entries,
        }
    }
}

impl HardwareManager {
    /// Get hardware overview (model, ram, fans, temps).
    pub async fn get_info(client: &SynoClient) -> SynologyResult<HardwareInfo> {
        let v = client
            .best_version("SYNO.Core.Hardware.Info", 1)
            .unwrap_or(1);
        if client.has_api("SYNO.Core.Hardware.Info") {
            return client
                .api_call("SYNO.Core.Hardware.Info", v, "get", &[])
                .await;
        }
        // Fallback: build HardwareInfo from DSM.Info
        let _info: DsmInfo = client
            .api_call(
                "SYNO.DSM.Info",
                client.best_version("SYNO.DSM.Info", 2).unwrap_or(1),
                "getinfo",
                &[],
            )
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
        let v = client
            .best_version("SYNO.Core.ExternalDevice.UPS", 1)
            .unwrap_or(1);
        let wire: UpsWire = client
            .api_call("SYNO.Core.ExternalDevice.UPS", v, "get", &[])
            .await?;
        Ok(wire.into())
    }

    /// Set UPS configuration.
    pub async fn set_ups_config(
        client: &SynoClient,
        enable_ups: bool,
        mode: &str, // "usb" or "snmp"
    ) -> SynologyResult<()> {
        let v = client
            .best_version("SYNO.Core.ExternalDevice.UPS", 1)
            .unwrap_or(1);
        let en = if enable_ups { "true" } else { "false" };
        client
            .api_post_void(
                "SYNO.Core.ExternalDevice.UPS",
                v,
                "set",
                &[("ups_enable", en), ("ups_mode", mode)],
            )
            .await
    }

    // ─── Power Schedule ──────────────────────────────────────────

    /// Get power schedule rules: power-on tasks first, then power-off tasks.
    /// The schedule counts as enabled when any task is.
    pub async fn get_power_schedule(client: &SynoClient) -> SynologyResult<PowerSchedule> {
        let v = client
            .best_version("SYNO.Core.Hardware.PowerSchedule", 1)
            .unwrap_or(1);
        let wire: PowerScheduleWire = client
            .api_call("SYNO.Core.Hardware.PowerSchedule", v, "load", &[])
            .await?;
        Ok(wire.into())
    }

    /// Set power schedule enabled.
    pub async fn set_power_schedule_enabled(
        client: &SynoClient,
        enabled: bool,
    ) -> SynologyResult<()> {
        let v = client
            .best_version("SYNO.Core.Hardware.PowerSchedule", 1)
            .unwrap_or(1);
        let en = if enabled { "true" } else { "false" };
        client
            .api_post_void(
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
        let v = client
            .best_version("SYNO.Core.Hardware.Led.Brightness", 1)
            .unwrap_or(1);
        client
            .api_call("SYNO.Core.Hardware.Led.Brightness", v, "get", &[])
            .await
    }

    /// Set LED brightness (0 = off, 1 = dim, 2 = normal).
    pub async fn set_led_brightness(client: &SynoClient, level: u8) -> SynologyResult<()> {
        let v = client
            .best_version("SYNO.Core.Hardware.Led.Brightness", 1)
            .unwrap_or(1);
        let l = level.to_string();
        client
            .api_post_void(
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
        let v = client
            .best_version("SYNO.Core.Hardware.BeepControl", 1)
            .unwrap_or(1);
        client
            .api_post_void("SYNO.Core.Hardware.BeepControl", v, "start", &[])
            .await
    }

    /// Stop beep.
    pub async fn stop_beep(client: &SynoClient) -> SynologyResult<()> {
        let v = client
            .best_version("SYNO.Core.Hardware.BeepControl", 1)
            .unwrap_or(1);
        client
            .api_post_void("SYNO.Core.Hardware.BeepControl", v, "stop", &[])
            .await
    }
}
