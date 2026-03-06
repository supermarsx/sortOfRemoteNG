// ── Cyrus SASL per-application config management ─────────────────────────────

use crate::client::{shell_escape, CyrusSaslClient};
use crate::error::{CyrusSaslError, CyrusSaslResult};
use crate::types::*;
use std::collections::HashMap;

pub struct AppConfigManager;

impl AppConfigManager {
    /// List all application configs in the SASL config directory.
    pub async fn list_apps(client: &CyrusSaslClient) -> CyrusSaslResult<Vec<String>> {
        let config_dir = client.config_dir();
        let out = client
            .exec_ssh(&format!(
                "ls -1 {} 2>/dev/null | grep '\\.conf$'",
                shell_escape(config_dir)
            ))
            .await?;

        let apps: Vec<String> = out
            .stdout
            .lines()
            .filter(|l| !l.is_empty())
            .map(|l| l.trim_end_matches(".conf").to_string())
            .collect();
        Ok(apps)
    }

    /// Get the SASL config for a specific application.
    pub async fn get_app_config(
        client: &CyrusSaslClient,
        app_name: &str,
    ) -> CyrusSaslResult<SaslAppConfig> {
        let path = format!("{}/{}.conf", client.config_dir(), app_name);
        let content = client.read_remote_file(&path).await.map_err(|_| {
            CyrusSaslError::config_not_found(&path)
        })?;
        Ok(parse_app_config(app_name, &content))
    }

    /// Write the SASL config for a specific application.
    pub async fn set_app_config(
        client: &CyrusSaslClient,
        app_name: &str,
        config: &SaslAppConfig,
    ) -> CyrusSaslResult<()> {
        let path = format!("{}/{}.conf", client.config_dir(), app_name);
        let content = generate_app_config(config);
        client.write_remote_file(&path, &content).await?;
        Ok(())
    }

    /// Delete an application's SASL config.
    pub async fn delete_app_config(
        client: &CyrusSaslClient,
        app_name: &str,
    ) -> CyrusSaslResult<()> {
        let path = format!("{}/{}.conf", client.config_dir(), app_name);
        let out = client
            .exec_ssh(&format!("sudo rm -f {}", shell_escape(&path)))
            .await?;
        if out.exit_code != 0 {
            return Err(CyrusSaslError::process_error(format!(
                "Failed to delete config for {}: {}",
                app_name, out.stderr
            )));
        }
        Ok(())
    }

    /// Get a single parameter from an application config.
    pub async fn get_param(
        client: &CyrusSaslClient,
        app_name: &str,
        key: &str,
    ) -> CyrusSaslResult<String> {
        let config = Self::get_app_config(client, app_name).await?;
        // Check known fields first
        let value = match key {
            "pwcheck_method" => config.pwcheck_method.clone(),
            "mech_list" => config.mech_list.clone(),
            "log_level" => config.log_level.clone(),
            "auxprop_plugin" => config.auxprop_plugin.clone(),
            "sql_engine" => config.sql_engine.clone(),
            "sql_hostnames" => config.sql_hostnames.clone(),
            "sql_database" => config.sql_database.clone(),
            "sql_user" => config.sql_user.clone(),
            "sql_passw" => config.sql_passw.clone(),
            "ldapdb_uri" => config.ldapdb_uri.clone(),
            "ldapdb_id" => config.ldapdb_id.clone(),
            "ldapdb_pw" => config.ldapdb_pw.clone(),
            _ => config.extra.get(key).cloned(),
        };
        value.ok_or_else(|| {
            CyrusSaslError::new(
                crate::error::CyrusSaslErrorKind::ConfigNotFound,
                format!("Parameter '{}' not found in {} config", key, app_name),
            )
        })
    }

    /// Set a single parameter in an application config.
    pub async fn set_param(
        client: &CyrusSaslClient,
        app_name: &str,
        key: &str,
        value: &str,
    ) -> CyrusSaslResult<()> {
        let mut config = Self::get_app_config(client, app_name)
            .await
            .unwrap_or_else(|_| SaslAppConfig {
                app_name: app_name.to_string(),
                pwcheck_method: None,
                mech_list: None,
                log_level: None,
                auxprop_plugin: None,
                sql_engine: None,
                sql_hostnames: None,
                sql_database: None,
                sql_user: None,
                sql_passw: None,
                ldapdb_uri: None,
                ldapdb_id: None,
                ldapdb_pw: None,
                extra: HashMap::new(),
            });

        let val = Some(value.to_string());
        match key {
            "pwcheck_method" => config.pwcheck_method = val,
            "mech_list" => config.mech_list = val,
            "log_level" => config.log_level = val,
            "auxprop_plugin" => config.auxprop_plugin = val,
            "sql_engine" => config.sql_engine = val,
            "sql_hostnames" => config.sql_hostnames = val,
            "sql_database" => config.sql_database = val,
            "sql_user" => config.sql_user = val,
            "sql_passw" => config.sql_passw = val,
            "ldapdb_uri" => config.ldapdb_uri = val,
            "ldapdb_id" => config.ldapdb_id = val,
            "ldapdb_pw" => config.ldapdb_pw = val,
            _ => {
                config.extra.insert(key.to_string(), value.to_string());
            }
        }

        Self::set_app_config(client, app_name, &config).await
    }

    /// Delete a single parameter from an application config.
    pub async fn delete_param(
        client: &CyrusSaslClient,
        app_name: &str,
        key: &str,
    ) -> CyrusSaslResult<()> {
        let mut config = Self::get_app_config(client, app_name).await?;

        match key {
            "pwcheck_method" => config.pwcheck_method = None,
            "mech_list" => config.mech_list = None,
            "log_level" => config.log_level = None,
            "auxprop_plugin" => config.auxprop_plugin = None,
            "sql_engine" => config.sql_engine = None,
            "sql_hostnames" => config.sql_hostnames = None,
            "sql_database" => config.sql_database = None,
            "sql_user" => config.sql_user = None,
            "sql_passw" => config.sql_passw = None,
            "ldapdb_uri" => config.ldapdb_uri = None,
            "ldapdb_id" => config.ldapdb_id = None,
            "ldapdb_pw" => config.ldapdb_pw = None,
            _ => {
                config.extra.remove(key);
            }
        }

        Self::set_app_config(client, app_name, &config).await
    }
}

// ─── Parsing ─────────────────────────────────────────────────────────────────

fn parse_app_config(app_name: &str, content: &str) -> SaslAppConfig {
    let mut pwcheck_method = None;
    let mut mech_list = None;
    let mut log_level = None;
    let mut auxprop_plugin = None;
    let mut sql_engine = None;
    let mut sql_hostnames = None;
    let mut sql_database = None;
    let mut sql_user = None;
    let mut sql_passw = None;
    let mut ldapdb_uri = None;
    let mut ldapdb_id = None;
    let mut ldapdb_pw = None;
    let mut extra = HashMap::new();

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('#') || trimmed.is_empty() {
            continue;
        }

        if let Some((key, value)) = trimmed.split_once(':') {
            let key = key.trim();
            let value = value.trim().to_string();

            match key {
                "pwcheck_method" => pwcheck_method = Some(value),
                "mech_list" => mech_list = Some(value),
                "log_level" => log_level = Some(value),
                "auxprop_plugin" => auxprop_plugin = Some(value),
                "sql_engine" => sql_engine = Some(value),
                "sql_hostnames" => sql_hostnames = Some(value),
                "sql_database" => sql_database = Some(value),
                "sql_user" => sql_user = Some(value),
                "sql_passw" => sql_passw = Some(value),
                "ldapdb_uri" => ldapdb_uri = Some(value),
                "ldapdb_id" => ldapdb_id = Some(value),
                "ldapdb_pw" => ldapdb_pw = Some(value),
                _ => {
                    extra.insert(key.to_string(), value);
                }
            }
        }
    }

    SaslAppConfig {
        app_name: app_name.to_string(),
        pwcheck_method,
        mech_list,
        log_level,
        auxprop_plugin,
        sql_engine,
        sql_hostnames,
        sql_database,
        sql_user,
        sql_passw,
        ldapdb_uri,
        ldapdb_id,
        ldapdb_pw,
        extra,
    }
}

fn generate_app_config(config: &SaslAppConfig) -> String {
    let mut out = String::new();
    out.push_str(&format!("# SASL config for {}\n", config.app_name));
    out.push_str("# Managed by sorng-cyrus-sasl\n\n");

    if let Some(ref v) = config.pwcheck_method {
        out.push_str(&format!("pwcheck_method: {}\n", v));
    }
    if let Some(ref v) = config.mech_list {
        out.push_str(&format!("mech_list: {}\n", v));
    }
    if let Some(ref v) = config.log_level {
        out.push_str(&format!("log_level: {}\n", v));
    }
    if let Some(ref v) = config.auxprop_plugin {
        out.push_str(&format!("auxprop_plugin: {}\n", v));
    }
    if let Some(ref v) = config.sql_engine {
        out.push_str(&format!("sql_engine: {}\n", v));
    }
    if let Some(ref v) = config.sql_hostnames {
        out.push_str(&format!("sql_hostnames: {}\n", v));
    }
    if let Some(ref v) = config.sql_database {
        out.push_str(&format!("sql_database: {}\n", v));
    }
    if let Some(ref v) = config.sql_user {
        out.push_str(&format!("sql_user: {}\n", v));
    }
    if let Some(ref v) = config.sql_passw {
        out.push_str(&format!("sql_passw: {}\n", v));
    }
    if let Some(ref v) = config.ldapdb_uri {
        out.push_str(&format!("ldapdb_uri: {}\n", v));
    }
    if let Some(ref v) = config.ldapdb_id {
        out.push_str(&format!("ldapdb_id: {}\n", v));
    }
    if let Some(ref v) = config.ldapdb_pw {
        out.push_str(&format!("ldapdb_pw: {}\n", v));
    }

    for (key, value) in &config.extra {
        out.push_str(&format!("{}: {}\n", key, value));
    }

    out
}
