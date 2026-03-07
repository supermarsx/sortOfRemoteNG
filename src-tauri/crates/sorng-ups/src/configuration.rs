// ── sorng-ups – NUT configuration management ─────────────────────────────────
//! Read / write NUT config files: nut.conf, ups.conf, upsd.conf, upsd.users,
//! upsmon.conf. Also restart/reload NUT daemons.

use crate::client::UpsClient;
use crate::error::UpsResult;
use crate::types::*;
use std::collections::HashMap;

const NUT_CONF: &str = "/etc/nut/nut.conf";
const UPS_CONF: &str = "/etc/nut/ups.conf";
const UPSD_CONF: &str = "/etc/nut/upsd.conf";
const UPSD_USERS: &str = "/etc/nut/upsd.users";
const UPSMON_CONF: &str = "/etc/nut/upsmon.conf";

pub struct ConfigManager;

impl ConfigManager {
    /// Parse the main NUT configuration files into a unified struct.
    pub async fn get_nut_config(client: &UpsClient) -> UpsResult<NutConfig> {
        let nut_raw = client.read_remote_file(NUT_CONF).await.unwrap_or_default();
        let ups_raw = client.read_remote_file(UPS_CONF).await.unwrap_or_default();
        let users_raw = client.read_remote_file(UPSD_USERS).await.unwrap_or_default();
        let upsmon_raw = client.read_remote_file(UPSMON_CONF).await.unwrap_or_default();

        let mode = Self::parse_nut_mode(&nut_raw);
        let ups_configs = Self::parse_ups_conf(&ups_raw);
        let users = Self::parse_upsd_users(&users_raw);
        let monitors = Self::parse_upsmon_monitors(&upsmon_raw);

        Ok(NutConfig {
            mode,
            monitors,
            users,
            ups_configs,
        })
    }

    // ── Raw file access ──────────────────────────────────────────

    pub async fn get_ups_conf(client: &UpsClient) -> UpsResult<String> {
        client.read_remote_file(UPS_CONF).await
    }

    pub async fn set_ups_conf(client: &UpsClient, content: &str) -> UpsResult<()> {
        client.write_remote_file(UPS_CONF, content).await
    }

    pub async fn get_upsd_conf(client: &UpsClient) -> UpsResult<String> {
        client.read_remote_file(UPSD_CONF).await
    }

    pub async fn set_upsd_conf(client: &UpsClient, content: &str) -> UpsResult<()> {
        client.write_remote_file(UPSD_CONF, content).await
    }

    pub async fn get_upsd_users(client: &UpsClient) -> UpsResult<String> {
        client.read_remote_file(UPSD_USERS).await
    }

    pub async fn set_upsd_users(client: &UpsClient, content: &str) -> UpsResult<()> {
        client.write_remote_file(UPSD_USERS, content).await
    }

    pub async fn get_upsmon_conf(client: &UpsClient) -> UpsResult<String> {
        client.read_remote_file(UPSMON_CONF).await
    }

    pub async fn set_upsmon_conf(client: &UpsClient, content: &str) -> UpsResult<()> {
        client.write_remote_file(UPSMON_CONF, content).await
    }

    // ── Daemon control ───────────────────────────────────────────

    pub async fn reload_upsd(client: &UpsClient) -> UpsResult<()> {
        client
            .exec_ssh(&format!("sudo {} -c reload", client.upsd_bin()))
            .await?;
        Ok(())
    }

    pub async fn reload_upsmon(client: &UpsClient) -> UpsResult<()> {
        client
            .exec_ssh(&format!("sudo {} -c reload", client.upsmon_bin()))
            .await?;
        Ok(())
    }

    pub async fn restart_nut(client: &UpsClient) -> UpsResult<()> {
        client
            .exec_ssh("sudo systemctl restart nut-server nut-monitor 2>/dev/null || sudo service nut-server restart")
            .await?;
        Ok(())
    }

    /// Read the NUT MODE from nut.conf.
    pub async fn get_nut_mode(client: &UpsClient) -> UpsResult<String> {
        let raw = client.read_remote_file(NUT_CONF).await.unwrap_or_default();
        Ok(Self::parse_nut_mode(&raw).unwrap_or_else(|| "none".to_string()))
    }

    /// Set the NUT MODE in nut.conf.
    pub async fn set_nut_mode(client: &UpsClient, mode: &str) -> UpsResult<()> {
        let raw = client.read_remote_file(NUT_CONF).await.unwrap_or_default();
        let mut found = false;
        let new_content: String = raw
            .lines()
            .map(|line| {
                if line.trim_start().starts_with("MODE=") {
                    found = true;
                    format!("MODE={}", mode)
                } else {
                    line.to_string()
                }
            })
            .collect::<Vec<_>>()
            .join("\n");
        let final_content = if found {
            new_content
        } else {
            format!("{}\nMODE={}\n", new_content, mode)
        };
        client.write_remote_file(NUT_CONF, &final_content).await
    }

    // ── Parsing helpers ──────────────────────────────────────────

    fn parse_nut_mode(raw: &str) -> Option<String> {
        for line in raw.lines() {
            let line = line.trim();
            if line.starts_with('#') || line.is_empty() {
                continue;
            }
            if let Some(val) = line.strip_prefix("MODE=") {
                return Some(val.trim().trim_matches('"').to_string());
            }
        }
        None
    }

    fn parse_ups_conf(raw: &str) -> Vec<NutUpsConfig> {
        let mut configs = Vec::new();
        let mut current_name: Option<String> = None;
        let mut driver = String::new();
        let mut port = String::new();
        let mut desc: Option<String> = None;
        let mut extra: HashMap<String, String> = HashMap::new();

        for line in raw.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            // Section header [upsname]
            if line.starts_with('[') && line.ends_with(']') {
                // Flush previous
                if let Some(name) = current_name.take() {
                    configs.push(NutUpsConfig {
                        name,
                        driver: driver.clone(),
                        port: port.clone(),
                        description: desc.take(),
                        extra: extra.clone(),
                    });
                }
                current_name = Some(line[1..line.len() - 1].to_string());
                driver.clear();
                port.clear();
                desc = None;
                extra.clear();
                continue;
            }
            if let Some((key, value)) = line.split_once('=') {
                let key = key.trim();
                let value = value.trim().trim_matches('"').to_string();
                match key {
                    "driver" => driver = value,
                    "port" => port = value,
                    "desc" => desc = Some(value),
                    _ => { extra.insert(key.to_string(), value); }
                }
            }
        }
        // Flush last
        if let Some(name) = current_name {
            configs.push(NutUpsConfig {
                name,
                driver,
                port,
                description: desc,
                extra,
            });
        }
        configs
    }

    fn parse_upsd_users(raw: &str) -> Vec<NutUser> {
        let mut users = Vec::new();
        let mut current_user: Option<String> = None;
        let mut password: Option<String> = None;
        let mut actions: Vec<String> = Vec::new();
        let mut instcmds: Vec<String> = Vec::new();
        let mut upsmon_role: Option<String> = None;

        for line in raw.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            if line.starts_with('[') && line.ends_with(']') {
                if let Some(username) = current_user.take() {
                    users.push(NutUser {
                        username,
                        password: password.take(),
                        actions: actions.clone(),
                        instcmds: instcmds.clone(),
                        upsmon_role: upsmon_role.take(),
                    });
                }
                current_user = Some(line[1..line.len() - 1].to_string());
                password = None;
                actions.clear();
                instcmds.clear();
                upsmon_role = None;
                continue;
            }
            if let Some((key, value)) = line.split_once('=') {
                let key = key.trim();
                let value = value.trim().trim_matches('"').to_string();
                match key {
                    "password" => password = Some(value),
                    "actions" => actions.push(value),
                    "instcmds" => instcmds.push(value),
                    "upsmon" => upsmon_role = Some(value),
                    _ => {}
                }
            }
        }
        if let Some(username) = current_user {
            users.push(NutUser {
                username,
                password,
                actions,
                instcmds,
                upsmon_role,
            });
        }
        users
    }

    fn parse_upsmon_monitors(raw: &str) -> Vec<NutMonitor> {
        let mut monitors = Vec::new();
        for line in raw.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            // MONITOR <system> <power_value> <username> <password> <type>
            if line.starts_with("MONITOR ") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 6 {
                    monitors.push(NutMonitor {
                        system: parts[1].to_string(),
                        power_value: parts[2].parse().unwrap_or(1),
                        username: parts[3].to_string(),
                        password: parts[4].to_string(),
                        monitor_type: parts[5].to_string(),
                    });
                }
            }
        }
        monitors
    }
}
