// ── dovecot config management ────────────────────────────────────────────────

use crate::client::{shell_escape, DovecotClient};
use crate::error::{DovecotError, DovecotResult};
use crate::types::*;
use std::collections::HashMap;

pub struct DovecotConfigManager;

impl DovecotConfigManager {
    /// Get all configuration parameters via `doveconf -n`.
    pub async fn get_all(client: &DovecotClient) -> DovecotResult<Vec<DovecotConfigParam>> {
        let out = client
            .exec_ssh(&format!("sudo {} -n", client.dovecot_bin()))
            .await?;
        let mut params = Vec::new();
        let mut current_section = String::new();

        for line in out.stdout.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                continue;
            }
            // Track section context
            if trimmed.ends_with('{') {
                let section_name = trimmed.trim_end_matches('{').trim();
                if current_section.is_empty() {
                    current_section = section_name.to_string();
                } else {
                    current_section = format!("{}/{}", current_section, section_name);
                }
                continue;
            }
            if trimmed == "}" {
                if let Some(pos) = current_section.rfind('/') {
                    current_section = current_section[..pos].to_string();
                } else {
                    current_section.clear();
                }
                continue;
            }
            // Parse key = value
            if let Some((key, value)) = trimmed.split_once('=') {
                let key = key.trim();
                let value = value.trim();
                params.push(DovecotConfigParam {
                    name: key.to_string(),
                    value: value.to_string(),
                    section: if current_section.is_empty() {
                        None
                    } else {
                        Some(current_section.clone())
                    },
                    filename: None,
                });
            }
        }
        Ok(params)
    }

    /// Get a specific config parameter via `doveconf`.
    pub async fn get_param(client: &DovecotClient, name: &str) -> DovecotResult<String> {
        let out = client
            .exec_ssh(&format!(
                "sudo {} -h {}",
                client.dovecot_bin(),
                shell_escape(name)
            ))
            .await?;
        if out.exit_code != 0 {
            return Err(DovecotError::config_not_found(name));
        }
        Ok(out.stdout.trim().to_string())
    }

    /// Set a config parameter by writing to the appropriate config file.
    pub async fn set_param(
        client: &DovecotClient,
        name: &str,
        value: &str,
    ) -> DovecotResult<()> {
        // Write to local.conf override file
        let local_conf = format!("{}/local.conf", client.config_dir());
        let content = client.read_remote_file(&local_conf).await.unwrap_or_default();

        let new_line = format!("{} = {}", name, value);
        let mut new_content = String::new();
        let mut found = false;

        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with(name) && trimmed.contains('=') {
                new_content.push_str(&new_line);
                new_content.push('\n');
                found = true;
            } else {
                new_content.push_str(line);
                new_content.push('\n');
            }
        }

        if !found {
            new_content.push_str(&new_line);
            new_content.push('\n');
        }

        client.write_remote_file(&local_conf, &new_content).await?;
        Ok(())
    }

    /// List namespaces from config.
    pub async fn list_namespaces(
        client: &DovecotClient,
    ) -> DovecotResult<Vec<DovecotNamespace>> {
        let out = client
            .exec_ssh(&format!("sudo {} -n | grep -A 20 'namespace'", client.dovecot_bin()))
            .await?;
        let mut namespaces = Vec::new();
        let mut current: Option<DovecotNamespace> = None;

        for line in out.stdout.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("namespace ") && trimmed.ends_with('{') {
                // Save any previous namespace
                if let Some(ns) = current.take() {
                    namespaces.push(ns);
                }
                let name = trimmed
                    .trim_start_matches("namespace ")
                    .trim_end_matches('{')
                    .trim()
                    .to_string();
                current = Some(DovecotNamespace {
                    name,
                    namespace_type: "private".to_string(),
                    prefix: None,
                    separator: None,
                    inbox: false,
                    hidden: false,
                    list: true,
                    subscriptions: true,
                    location: None,
                });
            } else if trimmed == "}" {
                if let Some(ns) = current.take() {
                    namespaces.push(ns);
                }
            } else if let Some(ref mut ns) = current {
                if let Some((key, value)) = trimmed.split_once('=') {
                    let key = key.trim();
                    let value = value.trim();
                    match key {
                        "type" => ns.namespace_type = value.to_string(),
                        "prefix" => ns.prefix = Some(value.to_string()),
                        "separator" => ns.separator = Some(value.to_string()),
                        "inbox" => ns.inbox = value == "yes",
                        "hidden" => ns.hidden = value == "yes",
                        "list" => ns.list = value != "no",
                        "subscriptions" => ns.subscriptions = value != "no",
                        "location" => ns.location = Some(value.to_string()),
                        _ => {}
                    }
                }
            }
        }

        // Save final namespace if any
        if let Some(ns) = current.take() {
            namespaces.push(ns);
        }

        Ok(namespaces)
    }

    /// Get a specific namespace by name.
    pub async fn get_namespace(
        client: &DovecotClient,
        name: &str,
    ) -> DovecotResult<DovecotNamespace> {
        let namespaces = Self::list_namespaces(client).await?;
        namespaces
            .into_iter()
            .find(|ns| ns.name == name)
            .ok_or_else(|| DovecotError::namespace_not_found(name))
    }

    /// List plugins via config inspection.
    pub async fn list_plugins(client: &DovecotClient) -> DovecotResult<Vec<DovecotPlugin>> {
        let out = client
            .doveadm("config -f tabescaped mail_plugins")
            .await;
        let plugins_str = match out {
            Ok(ref o) => o.stdout.trim().to_string(),
            Err(_) => {
                // Fallback: read from config
                let param = Self::get_param(client, "mail_plugins").await.unwrap_or_default();
                param
            }
        };

        let mut plugins = Vec::new();
        for name in plugins_str.split_whitespace() {
            if name.is_empty() {
                continue;
            }
            let settings = Self::get_plugin_settings(client, name).await.unwrap_or_default();
            plugins.push(DovecotPlugin {
                name: name.to_string(),
                enabled: true,
                settings,
            });
        }
        Ok(plugins)
    }

    /// Read plugin-specific settings.
    async fn get_plugin_settings(
        client: &DovecotClient,
        plugin_name: &str,
    ) -> DovecotResult<HashMap<String, String>> {
        let out = client
            .exec_ssh(&format!(
                "sudo {} -n | grep -i '{}'",
                client.dovecot_bin(),
                plugin_name
            ))
            .await?;
        let mut settings = HashMap::new();
        for line in out.stdout.lines() {
            let trimmed = line.trim();
            if let Some((key, value)) = trimmed.split_once('=') {
                settings.insert(key.trim().to_string(), value.trim().to_string());
            }
        }
        Ok(settings)
    }

    /// Enable a plugin by adding it to mail_plugins.
    pub async fn enable_plugin(
        client: &DovecotClient,
        name: &str,
    ) -> DovecotResult<()> {
        let current = Self::get_param(client, "mail_plugins").await.unwrap_or_default();
        let plugins: Vec<&str> = current.split_whitespace().collect();
        if plugins.contains(&name) {
            return Ok(()); // Already enabled
        }
        let new_value = if current.is_empty() {
            name.to_string()
        } else {
            format!("{} {}", current.trim(), name)
        };
        Self::set_param(client, "mail_plugins", &new_value).await
    }

    /// Disable a plugin by removing it from mail_plugins.
    pub async fn disable_plugin(
        client: &DovecotClient,
        name: &str,
    ) -> DovecotResult<()> {
        let current = Self::get_param(client, "mail_plugins").await.unwrap_or_default();
        let new_value: Vec<&str> = current
            .split_whitespace()
            .filter(|p| *p != name)
            .collect();
        Self::set_param(client, "mail_plugins", &new_value.join(" ")).await
    }

    /// Configure plugin-specific settings.
    pub async fn configure_plugin(
        client: &DovecotClient,
        name: &str,
        settings: &HashMap<String, String>,
    ) -> DovecotResult<()> {
        let plugin_conf = format!("{}/conf.d/90-plugin.conf", client.config_dir());
        let mut content = client.read_remote_file(&plugin_conf).await.unwrap_or_else(|_| {
            "plugin {\n}\n".to_string()
        });

        for (key, value) in settings {
            let setting_key = format!("{}_{}", name, key);
            let new_line = format!("  {} = {}", setting_key, value);

            if content.contains(&setting_key) {
                // Replace existing
                let mut new_content = String::new();
                for line in content.lines() {
                    if line.trim().starts_with(&setting_key) {
                        new_content.push_str(&new_line);
                    } else {
                        new_content.push_str(line);
                    }
                    new_content.push('\n');
                }
                content = new_content;
            } else {
                // Insert before closing brace
                content = content.replacen("}", &format!("{}\n}}", new_line), 1);
            }
        }

        client.write_remote_file(&plugin_conf, &content).await?;
        Ok(())
    }

    /// Get authentication config details.
    pub async fn list_auth_config(
        client: &DovecotClient,
    ) -> DovecotResult<DovecotAuthConfig> {
        let auth_conf = format!("{}/conf.d/10-auth.conf", client.config_dir());
        let content = client.read_remote_file(&auth_conf).await.unwrap_or_default();

        let mut mechanisms = Vec::new();
        let mut passdb_drivers = Vec::new();
        let mut userdb_drivers = Vec::new();
        let mut auth_verbose = false;
        let mut auth_debug = false;

        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with('#') {
                continue;
            }
            if let Some(val) = trimmed.strip_prefix("auth_mechanisms") {
                let val = val.trim_start_matches('=').trim();
                mechanisms.extend(val.split_whitespace().map(String::from));
            } else if let Some(val) = trimmed.strip_prefix("auth_verbose") {
                auth_verbose = val.trim_start_matches('=').trim() == "yes";
            } else if let Some(val) = trimmed.strip_prefix("auth_debug") {
                auth_debug = val.trim_start_matches('=').trim() == "yes";
            }
        }

        // Parse passdb/userdb entries
        let passdb_conf = client
            .exec_ssh(&format!(
                "sudo {} -n | grep -A 5 'passdb'",
                client.dovecot_bin()
            ))
            .await;
        if let Ok(ref o) = passdb_conf {
            for line in o.stdout.lines() {
                let trimmed = line.trim();
                if let Some(driver) = trimmed.strip_prefix("driver") {
                    let driver = driver.trim_start_matches('=').trim().to_string();
                    if !driver.is_empty() {
                        passdb_drivers.push(driver);
                    }
                }
            }
        }

        let userdb_conf = client
            .exec_ssh(&format!(
                "sudo {} -n | grep -A 5 'userdb'",
                client.dovecot_bin()
            ))
            .await;
        if let Ok(ref o) = userdb_conf {
            for line in o.stdout.lines() {
                let trimmed = line.trim();
                if let Some(driver) = trimmed.strip_prefix("driver") {
                    let driver = driver.trim_start_matches('=').trim().to_string();
                    if !driver.is_empty() {
                        userdb_drivers.push(driver);
                    }
                }
            }
        }

        if mechanisms.is_empty() {
            mechanisms.push("plain".to_string());
        }

        Ok(DovecotAuthConfig {
            mechanisms,
            passdb_drivers,
            userdb_drivers,
            auth_verbose,
            auth_debug,
        })
    }

    /// List service definitions from dovecot config.
    pub async fn list_services(
        client: &DovecotClient,
    ) -> DovecotResult<Vec<DovecotService>> {
        let out = client
            .exec_ssh(&format!(
                "sudo {} -n | grep -A 30 'service '",
                client.dovecot_bin()
            ))
            .await?;

        let mut services = Vec::new();
        let mut current: Option<DovecotService> = None;
        let mut in_listener = false;
        let mut current_listener: Option<DovecotListener> = None;
        let mut listener_type = String::new();

        for line in out.stdout.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("service ") && trimmed.ends_with('{') {
                if let Some(svc) = current.take() {
                    services.push(svc);
                }
                let name = trimmed
                    .trim_start_matches("service ")
                    .trim_end_matches('{')
                    .trim()
                    .to_string();
                current = Some(DovecotService {
                    name,
                    listeners: Vec::new(),
                    process_min_avail: None,
                    process_limit: None,
                    vsz_limit: None,
                });
            } else if (trimmed.starts_with("unix_listener")
                || trimmed.starts_with("inet_listener")
                || trimmed.starts_with("fifo_listener"))
                && trimmed.ends_with('{')
            {
                in_listener = true;
                let parts: Vec<&str> = trimmed.splitn(2, ' ').collect();
                listener_type = if trimmed.starts_with("unix") {
                    "unix".to_string()
                } else if trimmed.starts_with("inet") {
                    "inet".to_string()
                } else {
                    "fifo".to_string()
                };
                let path = parts
                    .get(1)
                    .unwrap_or(&"")
                    .trim_end_matches('{')
                    .trim()
                    .to_string();
                current_listener = Some(DovecotListener {
                    listener_type: listener_type.clone(),
                    path_or_address: path,
                    port: None,
                    mode: None,
                    user: None,
                    group: None,
                });
            } else if trimmed == "}" {
                if in_listener {
                    if let (Some(ref mut svc), Some(listener)) =
                        (&mut current, current_listener.take())
                    {
                        svc.listeners.push(listener);
                    }
                    in_listener = false;
                } else if let Some(svc) = current.take() {
                    services.push(svc);
                }
            } else if in_listener {
                if let Some(ref mut listener) = current_listener {
                    if let Some((key, value)) = trimmed.split_once('=') {
                        let key = key.trim();
                        let value = value.trim();
                        match key {
                            "port" => listener.port = value.parse().ok(),
                            "mode" => listener.mode = Some(value.to_string()),
                            "user" => listener.user = Some(value.to_string()),
                            "group" => listener.group = Some(value.to_string()),
                            _ => {}
                        }
                    }
                }
            } else if let Some(ref mut svc) = current {
                if let Some((key, value)) = trimmed.split_once('=') {
                    let key = key.trim();
                    let value = value.trim();
                    match key {
                        "process_min_avail" => svc.process_min_avail = value.parse().ok(),
                        "process_limit" => svc.process_limit = value.parse().ok(),
                        "vsz_limit" => svc.vsz_limit = Some(value.to_string()),
                        _ => {}
                    }
                }
            }
        }

        if let Some(svc) = current.take() {
            services.push(svc);
        }

        Ok(services)
    }

    /// Test configuration via `dovecot -n` (or `doveconf -n`).
    pub async fn test_config(client: &DovecotClient) -> DovecotResult<ConfigTestResult> {
        let out = client
            .exec_ssh(&format!("sudo {} -n 2>&1; echo EXIT:$?", client.dovecot_bin()))
            .await;
        match out {
            Ok(o) => {
                let success = o.stdout.contains("EXIT:0") && !o.stderr.contains("Error");
                let output = o.stdout.replace("EXIT:0", "").replace("EXIT:1", "").trim().to_string();
                let errors: Vec<String> = o
                    .stderr
                    .lines()
                    .filter(|l| l.contains("Error") || l.contains("Warning"))
                    .map(|l| l.to_string())
                    .collect();
                Ok(ConfigTestResult {
                    success,
                    output,
                    errors,
                })
            }
            Err(_) => Ok(ConfigTestResult {
                success: false,
                output: String::new(),
                errors: vec!["Failed to execute dovecot config test".into()],
            }),
        }
    }
}
