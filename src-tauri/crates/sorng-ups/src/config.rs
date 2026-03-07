//! NUT configuration management – nut.conf, ups.conf, upsd.conf, upsmon.conf, upssched.conf.

use crate::client::UpsClient;
use crate::error::{UpsError, UpsResult};
use crate::types::*;
use std::collections::HashMap;

pub struct ConfigManager;

impl ConfigManager {
    // ── nut.conf ─────────────────────────────────────────────────────

    /// Read and parse /etc/nut/nut.conf.
    pub async fn get_nut_config(client: &UpsClient) -> UpsResult<NutConfig> {
        let content = client.read_remote_file("/etc/nut/nut.conf").await?;
        let mut mode = NutMode::None_;
        let mut listen = Vec::new();
        let mut max_retry = None;
        let mut retry_interval = None;
        let mut maxage = None;
        let mut state_path = None;
        let mut run_as_user = None;

        for line in content.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            if let Some((k, v)) = line.split_once('=') {
                let k = k.trim();
                let v = v.trim().trim_matches('"');
                match k {
                    "MODE" => {
                        mode = match v {
                            "standalone" => NutMode::Standalone,
                            "netserver" => NutMode::Netserver,
                            "netclient" => NutMode::Netclient,
                            _ => NutMode::None_,
                        };
                    }
                    "LISTEN" => listen.push(v.to_string()),
                    "MAXRETRY" => max_retry = v.parse().ok(),
                    "RETRYINTERVAL" => retry_interval = v.parse().ok(),
                    "MAXAGE" => maxage = v.parse().ok(),
                    "STATEPATH" => state_path = Some(v.to_string()),
                    "RUN_AS_USER" => run_as_user = Some(v.to_string()),
                    _ => {}
                }
            }
        }

        Ok(NutConfig {
            mode,
            listen_addresses: listen,
            max_retry,
            retry_interval,
            maxage,
            state_path,
            run_as_user,
        })
    }

    /// Write updated nut.conf.
    pub async fn update_nut_config(client: &UpsClient, config: &NutConfig) -> UpsResult<()> {
        let mode_str = match config.mode {
            NutMode::None_ => "none",
            NutMode::Standalone => "standalone",
            NutMode::Netserver => "netserver",
            NutMode::Netclient => "netclient",
        };
        let mut lines = vec![format!("MODE={}", mode_str)];
        for addr in &config.listen_addresses {
            lines.push(format!("LISTEN={}", addr));
        }
        if let Some(v) = config.max_retry {
            lines.push(format!("MAXRETRY={}", v));
        }
        if let Some(v) = config.retry_interval {
            lines.push(format!("RETRYINTERVAL={}", v));
        }
        if let Some(v) = config.maxage {
            lines.push(format!("MAXAGE={}", v));
        }
        if let Some(ref v) = config.state_path {
            lines.push(format!("STATEPATH={}", v));
        }
        if let Some(ref v) = config.run_as_user {
            lines.push(format!("RUN_AS_USER={}", v));
        }
        client.write_remote_file("/etc/nut/nut.conf", &lines.join("\n")).await
    }

    // ── ups.conf ─────────────────────────────────────────────────────

    /// Read and parse /etc/nut/ups.conf.
    pub async fn get_ups_config(client: &UpsClient) -> UpsResult<Vec<NutUpsConfig>> {
        let content = client.read_remote_file("/etc/nut/ups.conf").await?;
        let mut configs = Vec::new();
        let mut current: Option<NutUpsConfig> = None;

        for line in content.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            if line.starts_with('[') && line.ends_with(']') {
                if let Some(c) = current.take() {
                    configs.push(c);
                }
                let name = line.trim_start_matches('[').trim_end_matches(']');
                current = Some(NutUpsConfig {
                    name: name.to_string(),
                    driver: String::new(),
                    port: String::new(),
                    desc: None,
                    extra: None,
                });
            } else if let Some(ref mut c) = current {
                if let Some((k, v)) = line.split_once('=') {
                    let k = k.trim();
                    let v = v.trim().trim_matches('"');
                    match k {
                        "driver" => c.driver = v.to_string(),
                        "port" => c.port = v.to_string(),
                        "desc" => c.desc = Some(v.to_string()),
                        _ => {
                            c.extra
                                .get_or_insert_with(HashMap::new)
                                .insert(k.to_string(), v.to_string());
                        }
                    }
                }
            }
        }
        if let Some(c) = current {
            configs.push(c);
        }
        Ok(configs)
    }

    /// Write updated ups.conf.
    pub async fn update_ups_config(client: &UpsClient, configs: &[NutUpsConfig]) -> UpsResult<()> {
        let mut content = String::new();
        for c in configs {
            content.push_str(&format!("[{}]\n", c.name));
            content.push_str(&format!("  driver = {}\n", c.driver));
            content.push_str(&format!("  port = {}\n", c.port));
            if let Some(ref desc) = c.desc {
                content.push_str(&format!("  desc = \"{}\"\n", desc));
            }
            if let Some(ref extra) = c.extra {
                for (k, v) in extra {
                    content.push_str(&format!("  {} = {}\n", k, v));
                }
            }
            content.push('\n');
        }
        client.write_remote_file("/etc/nut/ups.conf", &content).await
    }

    // ── upsd.conf ────────────────────────────────────────────────────

    /// Read and parse /etc/nut/upsd.conf.
    pub async fn get_upsd_config(client: &UpsClient) -> UpsResult<NutUpsdConfig> {
        let content = client.read_remote_file("/etc/nut/upsd.conf").await?;
        let mut listen = Vec::new();
        let mut maxage = None;
        let mut statepath = None;
        let mut certfile = None;
        let mut maxconn = None;

        for line in content.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            let parts: Vec<&str> = line.splitn(2, char::is_whitespace).collect();
            if parts.len() < 2 {
                continue;
            }
            match parts[0] {
                "LISTEN" => {
                    let addr_parts: Vec<&str> = parts[1].split_whitespace().collect();
                    listen.push(NutListen {
                        address: addr_parts.first().unwrap_or(&"").to_string(),
                        port: addr_parts.get(1).and_then(|p| p.parse().ok()),
                    });
                }
                "MAXAGE" => maxage = parts[1].trim().parse().ok(),
                "STATEPATH" => statepath = Some(parts[1].trim().to_string()),
                "CERTFILE" => certfile = Some(parts[1].trim().to_string()),
                "MAXCONN" => maxconn = parts[1].trim().parse().ok(),
                _ => {}
            }
        }

        Ok(NutUpsdConfig {
            listen,
            maxage,
            statepath,
            certfile,
            maxconn,
        })
    }

    /// Write updated upsd.conf.
    pub async fn update_upsd_config(client: &UpsClient, config: &NutUpsdConfig) -> UpsResult<()> {
        let mut lines = Vec::new();
        for l in &config.listen {
            match l.port {
                Some(p) => lines.push(format!("LISTEN {} {}", l.address, p)),
                None => lines.push(format!("LISTEN {}", l.address)),
            }
        }
        if let Some(v) = config.maxage {
            lines.push(format!("MAXAGE {}", v));
        }
        if let Some(ref v) = config.statepath {
            lines.push(format!("STATEPATH {}", v));
        }
        if let Some(ref v) = config.certfile {
            lines.push(format!("CERTFILE {}", v));
        }
        if let Some(v) = config.maxconn {
            lines.push(format!("MAXCONN {}", v));
        }
        client.write_remote_file("/etc/nut/upsd.conf", &lines.join("\n")).await
    }

    // ── upsmon.conf ──────────────────────────────────────────────────

    /// Read and parse /etc/nut/upsmon.conf.
    pub async fn get_upsmon_config(client: &UpsClient) -> UpsResult<UpsmonConfig> {
        let content = client.read_remote_file("/etc/nut/upsmon.conf").await?;
        let mut entries = Vec::new();
        let mut notify_cmd = None;
        let mut shutdown_cmd = None;
        let mut min_supplies = None;
        let mut power_down_flag = None;
        let mut polling_freq = None;
        let mut dead_time = None;

        for line in content.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            let parts: Vec<&str> = line.splitn(2, char::is_whitespace).collect();
            if parts.len() < 2 {
                continue;
            }
            match parts[0] {
                "MONITOR" => {
                    if let Some(entry) = parse_monitor_line(parts[1]) {
                        entries.push(entry);
                    }
                }
                "NOTIFYCMD" => notify_cmd = Some(parts[1].trim().to_string()),
                "SHUTDOWNCMD" => shutdown_cmd = Some(parts[1].trim().to_string()),
                "MINSUPPLIES" => min_supplies = parts[1].trim().parse().ok(),
                "POWERDOWNFLAG" => power_down_flag = Some(parts[1].trim().to_string()),
                "POLLFREQ" => polling_freq = parts[1].trim().parse().ok(),
                "DEADTIME" => dead_time = parts[1].trim().parse().ok(),
                _ => {}
            }
        }

        Ok(UpsmonConfig {
            monitor_entries: entries,
            notify_cmd,
            shutdown_cmd,
            min_supplies,
            power_down_flag,
            polling_freq,
            dead_time,
        })
    }

    /// Write updated upsmon.conf.
    pub async fn update_upsmon_config(client: &UpsClient, config: &UpsmonConfig) -> UpsResult<()> {
        let mut lines = Vec::new();
        for e in &config.monitor_entries {
            let type_str = match e.type_ {
                UpsmonType::Primary => "primary",
                UpsmonType::Secondary => "secondary",
            };
            lines.push(format!(
                "MONITOR {} {} {} {} {}",
                e.system,
                e.power_value.unwrap_or(1),
                e.username,
                e.password,
                type_str
            ));
        }
        if let Some(ref v) = config.notify_cmd {
            lines.push(format!("NOTIFYCMD {}", v));
        }
        if let Some(ref v) = config.shutdown_cmd {
            lines.push(format!("SHUTDOWNCMD {}", v));
        }
        if let Some(v) = config.min_supplies {
            lines.push(format!("MINSUPPLIES {}", v));
        }
        if let Some(ref v) = config.power_down_flag {
            lines.push(format!("POWERDOWNFLAG {}", v));
        }
        if let Some(v) = config.polling_freq {
            lines.push(format!("POLLFREQ {}", v));
        }
        if let Some(v) = config.dead_time {
            lines.push(format!("DEADTIME {}", v));
        }
        client.write_remote_file("/etc/nut/upsmon.conf", &lines.join("\n")).await
    }

    // ── upssched.conf ────────────────────────────────────────────────

    /// Read and parse /etc/nut/upssched.conf.
    pub async fn get_upssched_config(client: &UpsClient) -> UpsResult<UpsSched> {
        let content = client.read_remote_file("/etc/nut/upssched.conf").await?;
        let mut entries = Vec::new();

        for line in content.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            if line.starts_with("AT ") {
                let parts: Vec<&str> = line.splitn(4, char::is_whitespace).collect();
                if parts.len() >= 4 {
                    entries.push(UpsSchedEntry {
                        ups_name: parts[1].to_string(),
                        event: parts[2].to_string(),
                        command: parts[3].to_string(),
                    });
                }
            }
        }

        Ok(UpsSched { at_entries: entries })
    }

    /// Write updated upssched.conf.
    pub async fn update_upssched_config(client: &UpsClient, config: &UpsSched) -> UpsResult<()> {
        let mut lines = Vec::new();
        for e in &config.at_entries {
            lines.push(format!("AT {} {} {}", e.ups_name, e.event, e.command));
        }
        client.write_remote_file("/etc/nut/upssched.conf", &lines.join("\n")).await
    }

    // ── Validation & Reload ──────────────────────────────────────────

    /// Validate all NUT configuration files.
    pub async fn validate_config(client: &UpsClient) -> UpsResult<ConfigValidationResult> {
        let mut errors = Vec::new();
        let mut warnings = Vec::new();

        // Check nut.conf
        match client.read_remote_file("/etc/nut/nut.conf").await {
            Ok(content) => {
                if !content.contains("MODE=") {
                    errors.push("nut.conf: MODE directive missing".to_string());
                }
            }
            Err(_) => errors.push("nut.conf: file not readable".to_string()),
        }

        // Check ups.conf
        match Self::get_ups_config(client).await {
            Ok(configs) => {
                for c in &configs {
                    if c.driver.is_empty() {
                        errors.push(format!("ups.conf: [{}] missing driver", c.name));
                    }
                    if c.port.is_empty() {
                        errors.push(format!("ups.conf: [{}] missing port", c.name));
                    }
                }
                if configs.is_empty() {
                    warnings.push("ups.conf: no UPS devices configured".to_string());
                }
            }
            Err(_) => errors.push("ups.conf: file not readable".to_string()),
        }

        // Check upsd.conf
        match Self::get_upsd_config(client).await {
            Ok(c) => {
                if c.listen.is_empty() {
                    warnings.push("upsd.conf: no LISTEN directives".to_string());
                }
            }
            Err(_) => errors.push("upsd.conf: file not readable".to_string()),
        }

        // Check upsmon.conf
        match Self::get_upsmon_config(client).await {
            Ok(c) => {
                if c.monitor_entries.is_empty() {
                    warnings.push("upsmon.conf: no MONITOR entries".to_string());
                }
            }
            Err(_) => errors.push("upsmon.conf: file not readable".to_string()),
        }

        Ok(ConfigValidationResult {
            valid: errors.is_empty(),
            errors,
            warnings,
        })
    }

    /// Reload NUT configuration (upsd -c reload + upsmon -c reload).
    pub async fn reload_config(client: &UpsClient) -> UpsResult<CommandResult> {
        let upsd = client.exec_ssh("sudo upsd -c reload 2>&1").await;
        let upsmon = client.exec_ssh("sudo upsmon -c reload 2>&1").await;

        let mut messages = Vec::new();
        match upsd {
            Ok(o) => messages.push(format!("upsd: {}", o.stdout.trim())),
            Err(e) => messages.push(format!("upsd reload failed: {}", e)),
        }
        match upsmon {
            Ok(o) => messages.push(format!("upsmon: {}", o.stdout.trim())),
            Err(e) => messages.push(format!("upsmon reload failed: {}", e)),
        }

        Ok(CommandResult {
            success: true,
            message: messages.join("; "),
        })
    }
}

// ── Helpers ──────────────────────────────────────────────────────────

fn parse_monitor_line(line: &str) -> Option<UpsmonEntry> {
    // MONITOR system power_value username password type
    let parts: Vec<&str> = line.split_whitespace().collect();
    if parts.len() < 5 {
        return None;
    }
    let type_ = match parts[4] {
        "primary" | "master" => UpsmonType::Primary,
        _ => UpsmonType::Secondary,
    };
    Some(UpsmonEntry {
        system: parts[0].to_string(),
        power_value: parts[1].parse().ok(),
        username: parts[2].to_string(),
        password: parts[3].to_string(),
        type_,
    })
}
