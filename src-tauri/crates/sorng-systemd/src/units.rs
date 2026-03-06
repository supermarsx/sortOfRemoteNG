//! Unit management — start, stop, restart, reload, enable, disable, mask, status.

use crate::client;
use crate::error::SystemdError;
use crate::types::*;

/// List all units, optionally filtered by type.
pub async fn list_units(host: &SystemdHost, unit_type: Option<&UnitType>) -> Result<Vec<SystemdUnit>, SystemdError> {
    let mut args = vec!["list-units", "--all", "--no-pager", "--plain", "--no-legend"];
    let type_str;
    if let Some(ut) = unit_type {
        type_str = format!("--type={}", unit_type_str(ut));
        args.push(&type_str);
    }
    let stdout = client::exec_ok(host, "systemctl", &args).await?;
    Ok(parse_list_units(&stdout))
}

/// Get detailed status of a unit.
pub async fn unit_status(host: &SystemdHost, unit: &str) -> Result<SystemdUnit, SystemdError> {
    let stdout = client::exec_ok(host, "systemctl", &["show", "--no-pager", unit]).await?;
    parse_unit_show(&stdout, unit)
}

/// Start a unit.
pub async fn start(host: &SystemdHost, unit: &str) -> Result<(), SystemdError> {
    client::exec_ok(host, "systemctl", &["start", unit]).await?;
    Ok(())
}

/// Stop a unit.
pub async fn stop(host: &SystemdHost, unit: &str) -> Result<(), SystemdError> {
    client::exec_ok(host, "systemctl", &["stop", unit]).await?;
    Ok(())
}

/// Restart a unit.
pub async fn restart(host: &SystemdHost, unit: &str) -> Result<(), SystemdError> {
    client::exec_ok(host, "systemctl", &["restart", unit]).await?;
    Ok(())
}

/// Reload a unit.
pub async fn reload(host: &SystemdHost, unit: &str) -> Result<(), SystemdError> {
    client::exec_ok(host, "systemctl", &["reload", unit]).await?;
    Ok(())
}

/// Enable a unit.
pub async fn enable(host: &SystemdHost, unit: &str) -> Result<(), SystemdError> {
    client::exec_ok(host, "systemctl", &["enable", unit]).await?;
    Ok(())
}

/// Disable a unit.
pub async fn disable(host: &SystemdHost, unit: &str) -> Result<(), SystemdError> {
    client::exec_ok(host, "systemctl", &["disable", unit]).await?;
    Ok(())
}

/// Mask a unit.
pub async fn mask(host: &SystemdHost, unit: &str) -> Result<(), SystemdError> {
    client::exec_ok(host, "systemctl", &["mask", unit]).await?;
    Ok(())
}

/// Unmask a unit.
pub async fn unmask(host: &SystemdHost, unit: &str) -> Result<(), SystemdError> {
    client::exec_ok(host, "systemctl", &["unmask", unit]).await?;
    Ok(())
}

/// Daemon reload.
pub async fn daemon_reload(host: &SystemdHost) -> Result<(), SystemdError> {
    client::exec_ok(host, "systemctl", &["daemon-reload"]).await?;
    Ok(())
}

/// List failed units.
pub async fn list_failed(host: &SystemdHost) -> Result<Vec<SystemdUnit>, SystemdError> {
    let stdout = client::exec_ok(host, "systemctl", &["list-units", "--failed", "--no-pager", "--plain", "--no-legend"]).await?;
    Ok(parse_list_units(&stdout))
}

/// Reset failed state for a unit.
pub async fn reset_failed(host: &SystemdHost, unit: Option<&str>) -> Result<(), SystemdError> {
    let mut args = vec!["reset-failed"];
    if let Some(u) = unit {
        args.push(u);
    }
    client::exec_ok(host, "systemctl", &args).await?;
    Ok(())
}

fn unit_type_str(ut: &UnitType) -> &'static str {
    match ut {
        UnitType::Service => "service",
        UnitType::Socket => "socket",
        UnitType::Target => "target",
        UnitType::Timer => "timer",
        UnitType::Mount => "mount",
        UnitType::Automount => "automount",
        UnitType::Swap => "swap",
        UnitType::Path => "path",
        UnitType::Slice => "slice",
        UnitType::Scope => "scope",
        UnitType::Device => "device",
    }
}

fn parse_list_units(output: &str) -> Vec<SystemdUnit> {
    let mut units = Vec::new();
    for line in output.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 4 {
            continue;
        }
        let name = parts[0].to_string();
        let unit_type = if name.ends_with(".service") { UnitType::Service }
            else if name.ends_with(".socket") { UnitType::Socket }
            else if name.ends_with(".timer") { UnitType::Timer }
            else if name.ends_with(".target") { UnitType::Target }
            else if name.ends_with(".mount") { UnitType::Mount }
            else { UnitType::Service };

        units.push(SystemdUnit {
            name,
            unit_type,
            description: parts[4..].join(" "),
            load_state: parse_load_state(parts[1]),
            active_state: parse_active_state(parts[2]),
            sub_state: parse_sub_state(parts[3]),
            enable_state: UnitEnableState::Unknown,
            fragment_path: None,
            main_pid: None,
            memory_current: None,
            cpu_usage_nsec: None,
            tasks_current: None,
            active_enter_timestamp: None,
            inactive_enter_timestamp: None,
            triggered_by: Vec::new(),
            triggers: Vec::new(),
            wants: Vec::new(),
            required_by: Vec::new(),
            after: Vec::new(),
            before: Vec::new(),
        });
    }
    units
}

fn parse_unit_show(output: &str, unit_name: &str) -> Result<SystemdUnit, SystemdError> {
    let mut props: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    for line in output.lines() {
        if let Some((k, v)) = line.split_once('=') {
            props.insert(k.to_string(), v.to_string());
        }
    }

    let name = props.get("Id").cloned().unwrap_or_else(|| unit_name.to_string());

    Ok(SystemdUnit {
        name: name.clone(),
        unit_type: if name.ends_with(".service") { UnitType::Service } else { UnitType::Service },
        description: props.get("Description").cloned().unwrap_or_default(),
        load_state: parse_load_state(props.get("LoadState").map(|s| s.as_str()).unwrap_or("unknown")),
        active_state: parse_active_state(props.get("ActiveState").map(|s| s.as_str()).unwrap_or("unknown")),
        sub_state: parse_sub_state(props.get("SubState").map(|s| s.as_str()).unwrap_or("unknown")),
        enable_state: UnitEnableState::Unknown,
        fragment_path: props.get("FragmentPath").cloned(),
        main_pid: props.get("MainPID").and_then(|v| v.parse().ok()),
        memory_current: props.get("MemoryCurrent").and_then(|v| v.parse().ok()),
        cpu_usage_nsec: props.get("CPUUsageNSec").and_then(|v| v.parse().ok()),
        tasks_current: props.get("TasksCurrent").and_then(|v| v.parse().ok()),
        active_enter_timestamp: None,
        inactive_enter_timestamp: None,
        triggered_by: Vec::new(),
        triggers: Vec::new(),
        wants: Vec::new(),
        required_by: Vec::new(),
        after: Vec::new(),
        before: Vec::new(),
    })
}

fn parse_load_state(s: &str) -> UnitLoadState {
    match s.to_lowercase().as_str() {
        "loaded" => UnitLoadState::Loaded,
        "not-found" => UnitLoadState::NotFound,
        "bad-setting" => UnitLoadState::BadSetting,
        "error" => UnitLoadState::Error,
        "masked" => UnitLoadState::Masked,
        _ => UnitLoadState::Unknown,
    }
}

fn parse_active_state(s: &str) -> UnitActiveState {
    match s.to_lowercase().as_str() {
        "active" => UnitActiveState::Active,
        "inactive" => UnitActiveState::Inactive,
        "activating" => UnitActiveState::Activating,
        "deactivating" => UnitActiveState::Deactivating,
        "failed" => UnitActiveState::Failed,
        "reloading" => UnitActiveState::Reloading,
        _ => UnitActiveState::Unknown,
    }
}

fn parse_sub_state(s: &str) -> UnitSubState {
    match s.to_lowercase().as_str() {
        "running" => UnitSubState::Running,
        "dead" => UnitSubState::Dead,
        "exited" => UnitSubState::Exited,
        "waiting" => UnitSubState::Waiting,
        "listening" => UnitSubState::Listening,
        "mounted" => UnitSubState::Mounted,
        "plugged" => UnitSubState::Plugged,
        "elapsed" => UnitSubState::Elapsed,
        "auto-restart" => UnitSubState::AutoRestart,
        "failed" => UnitSubState::Failed,
        _ => UnitSubState::Unknown,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_load_states() {
        assert_eq!(parse_load_state("loaded"), UnitLoadState::Loaded);
        assert_eq!(parse_load_state("masked"), UnitLoadState::Masked);
        assert_eq!(parse_load_state("xyz"), UnitLoadState::Unknown);
    }

    #[test]
    fn test_parse_active_states() {
        assert_eq!(parse_active_state("active"), UnitActiveState::Active);
        assert_eq!(parse_active_state("failed"), UnitActiveState::Failed);
    }

    #[test]
    fn test_parse_list_units() {
        let output = "sshd.service loaded active running OpenBSD Secure Shell server\n\
                       cron.service loaded active running Regular cron jobs\n";
        let units = parse_list_units(output);
        assert_eq!(units.len(), 2);
        assert_eq!(units[0].name, "sshd.service");
        assert_eq!(units[0].active_state, UnitActiveState::Active);
        assert_eq!(units[0].sub_state, UnitSubState::Running);
    }
}
