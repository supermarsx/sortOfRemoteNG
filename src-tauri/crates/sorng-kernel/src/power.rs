//! Power management — thermal zones, CPU governors, power states, profiles.

use crate::client;
use crate::error::KernelError;
use crate::types::{KernelHost, PowerState, ThermalZone, TripPoint};
use std::collections::HashMap;

/// Get the current power state and available states.
pub async fn get_power_state(host: &KernelHost) -> Result<PowerState, KernelError> {
    let states_out = client::exec_shell(host, "cat /sys/power/state 2>/dev/null").await
        .unwrap_or_default();
    let available_states: Vec<String> = states_out
        .trim()
        .split_whitespace()
        .map(|s| s.to_string())
        .collect();

    let mem_sleep = client::exec_shell(host, "cat /sys/power/mem_sleep 2>/dev/null").await
        .unwrap_or_default();
    // Active suspend type is in brackets: s2idle [deep]
    let suspend_type = mem_sleep
        .trim()
        .split_whitespace()
        .find(|s| s.starts_with('['))
        .map(|s| s.trim_matches(|c| c == '[' || c == ']').to_string())
        .unwrap_or_default();

    // If the system is running, current state is "on"
    let current_state = "on".to_string();

    Ok(PowerState { current_state, available_states, suspend_type })
}

/// List all thermal zones from /sys/class/thermal/.
pub async fn list_thermal_zones(host: &KernelHost) -> Result<Vec<ThermalZone>, KernelError> {
    let cmd = "for tz in /sys/class/thermal/thermal_zone*; do \
               [ -d \"$tz\" ] && echo \"$(basename $tz)|$(cat $tz/type 2>/dev/null)|$(cat $tz/temp 2>/dev/null)\"; \
               done";
    let out = client::exec_shell(host, cmd).await?;
    let mut zones = Vec::new();
    for line in out.lines() {
        let parts: Vec<&str> = line.split('|').collect();
        if parts.len() < 3 {
            continue;
        }
        let name = parts[0].trim().to_string();
        let type_str = parts[1].trim().to_string();
        let temp = parts[2].trim().parse::<i64>().unwrap_or(0);

        // Read trip points for this zone
        let trip_cmd = format!(
            "for i in $(seq 0 20); do \
             tp=/sys/class/thermal/{name}/trip_point_${{i}}_temp; \
             tt=/sys/class/thermal/{name}/trip_point_${{i}}_type; \
             [ -f \"$tp\" ] && echo \"$(cat $tp)|$(cat $tt 2>/dev/null)\" || break; \
             done"
        );
        let tp_out = client::exec_shell(host, &trip_cmd).await.unwrap_or_default();
        let trip_points: Vec<TripPoint> = tp_out
            .lines()
            .filter_map(|tl| {
                let tparts: Vec<&str> = tl.split('|').collect();
                if tparts.len() >= 2 {
                    Some(TripPoint {
                        temp_millicelsius: tparts[0].trim().parse().unwrap_or(0),
                        trip_type: tparts[1].trim().to_string(),
                    })
                } else {
                    None
                }
            })
            .collect();

        zones.push(ThermalZone { name, type_str, temp_millicelsius: temp, trip_points });
    }
    Ok(zones)
}

/// Get CPU frequency information for all CPUs.
pub async fn get_cpu_frequency(
    host: &KernelHost,
) -> Result<Vec<HashMap<String, String>>, KernelError> {
    let cmd = "for cpu in /sys/devices/system/cpu/cpu[0-9]*; do \
               [ -d \"$cpu/cpufreq\" ] || continue; \
               echo \"START $(basename $cpu)\"; \
               for f in $cpu/cpufreq/*; do \
                 [ -f \"$f\" ] && echo \"$(basename $f)=$(cat $f 2>/dev/null)\"; \
               done; \
               done";
    let out = client::exec_shell(host, cmd).await?;
    let mut cpus: Vec<HashMap<String, String>> = Vec::new();
    let mut current: Option<HashMap<String, String>> = None;
    for line in out.lines() {
        let trimmed = line.trim();
        if let Some(cpu_name) = trimmed.strip_prefix("START ") {
            if let Some(map) = current.take() {
                cpus.push(map);
            }
            let mut map = HashMap::new();
            map.insert("cpu".to_string(), cpu_name.to_string());
            current = Some(map);
        } else if let Some((key, value)) = trimmed.split_once('=') {
            if let Some(ref mut map) = current {
                map.insert(key.to_string(), value.to_string());
            }
        }
    }
    if let Some(map) = current {
        cpus.push(map);
    }
    Ok(cpus)
}

/// Get the scaling governor for a specific CPU.
pub async fn get_governor(host: &KernelHost, cpu: u32) -> Result<String, KernelError> {
    let cmd = format!(
        "cat /sys/devices/system/cpu/cpu{cpu}/cpufreq/scaling_governor 2>/dev/null"
    );
    let out = client::exec_shell(host, &cmd).await?;
    Ok(out.trim().to_string())
}

/// Set the scaling governor for a specific CPU.
pub async fn set_governor(
    host: &KernelHost,
    cpu: u32,
    governor: &str,
) -> Result<(), KernelError> {
    let cmd = format!(
        "echo '{}' > /sys/devices/system/cpu/cpu{}/cpufreq/scaling_governor",
        governor.replace('\'', "'\\''"),
        cpu
    );
    client::exec_shell(host, &cmd).await?;
    Ok(())
}

/// List available CPU frequency governors.
pub async fn list_governors(host: &KernelHost) -> Result<Vec<String>, KernelError> {
    let cmd = "cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_available_governors 2>/dev/null";
    let out = client::exec_shell(host, cmd).await?;
    Ok(out
        .trim()
        .split_whitespace()
        .map(|s| s.to_string())
        .collect())
}

/// Get the current power profile (power-profiles-daemon or tuned).
pub async fn get_power_profile(host: &KernelHost) -> Result<String, KernelError> {
    // Try power-profiles-daemon first
    let (ppd_out, _, ppd_code) = client::exec_shell_raw(
        host,
        "powerprofilesctl get 2>/dev/null",
    )
    .await?;
    if ppd_code == 0 && !ppd_out.trim().is_empty() {
        return Ok(ppd_out.trim().to_string());
    }

    // Try tuned-adm
    let (tuned_out, _, tuned_code) = client::exec_shell_raw(
        host,
        "tuned-adm active 2>/dev/null",
    )
    .await?;
    if tuned_code == 0 && !tuned_out.trim().is_empty() {
        // "Current active profile: balanced"
        if let Some(profile) = tuned_out.split(':').last() {
            return Ok(profile.trim().to_string());
        }
        return Ok(tuned_out.trim().to_string());
    }

    Ok("unknown".to_string())
}
