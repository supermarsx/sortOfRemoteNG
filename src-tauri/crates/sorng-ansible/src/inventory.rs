// ── sorng-ansible/src/inventory.rs ───────────────────────────────────────────
//! Inventory management — parsing, CRUD, graph, and dynamic inventory support.
//!
//! Uses `ansible-inventory` CLI for reliable parsing (supports INI, YAML,
//! scripts, and inventory plugins) and provides higher-level operations.

use std::collections::HashMap;

use log::debug;

use crate::client::AnsibleClient;
use crate::error::{AnsibleError, AnsibleResult};
use crate::types::*;

/// Inventory management operations.
pub struct InventoryManager;

impl InventoryManager {
    // ── Listing / querying ───────────────────────────────────────────

    /// Parse an inventory source and return the full graph.
    pub async fn parse(client: &AnsibleClient, source: &str) -> AnsibleResult<Inventory> {
        let output = client
            .run_raw(
                &client.inventory_bin,
                &["-i", source, "--list", "--output", "/dev/stdout"],
            )
            .await?;

        if output.exit_code != 0 {
            return Err(AnsibleError::inventory(format!(
                "ansible-inventory --list failed (exit {}): {}",
                output.exit_code, output.stderr
            )));
        }

        Self::parse_list_json(&output.stdout, source)
    }

    /// Get the inventory graph (tree structure).
    pub async fn graph(client: &AnsibleClient, source: &str) -> AnsibleResult<String> {
        let output = client
            .run_raw(&client.inventory_bin, &["-i", source, "--graph"])
            .await?;

        if output.exit_code != 0 {
            return Err(AnsibleError::inventory(format!(
                "ansible-inventory --graph failed: {}",
                output.stderr
            )));
        }

        Ok(output.stdout)
    }

    /// List all hosts for a given pattern (e.g. `"all"`, `"webservers"`).
    pub async fn list_hosts(
        client: &AnsibleClient,
        source: &str,
        pattern: &str,
    ) -> AnsibleResult<Vec<String>> {
        let output = client
            .run_raw(
                &client.ansible_bin,
                &["-i", source, pattern, "--list-hosts"],
            )
            .await?;

        if output.exit_code != 0 {
            return Err(AnsibleError::inventory(format!(
                "ansible --list-hosts failed: {}",
                output.stderr
            )));
        }

        let hosts = output
            .stdout
            .lines()
            .filter_map(|line| {
                let trimmed = line.trim();
                if trimmed.is_empty() || trimmed.starts_with("hosts") {
                    None
                } else {
                    Some(trimmed.to_string())
                }
            })
            .collect();

        Ok(hosts)
    }

    /// Get variables for a specific host.
    pub async fn host_vars(
        client: &AnsibleClient,
        source: &str,
        host: &str,
    ) -> AnsibleResult<HashMap<String, serde_json::Value>> {
        let output = client
            .run_raw(&client.inventory_bin, &["-i", source, "--host", host])
            .await?;

        if output.exit_code != 0 {
            return Err(AnsibleError::inventory(format!(
                "ansible-inventory --host {} failed: {}",
                host, output.stderr
            )));
        }

        let vars: HashMap<String, serde_json::Value> = serde_json::from_str(&output.stdout)?;

        Ok(vars)
    }

    // ── Mutation (write inventory files) ─────────────────────────────

    /// Add a host to a YAML inventory file.
    pub async fn add_host(inventory_path: &str, params: &AddHostParams) -> AnsibleResult<()> {
        let content = tokio::fs::read_to_string(inventory_path)
            .await
            .map_err(|e| AnsibleError::io(format!("Cannot read {}: {}", inventory_path, e)))?;

        let mut doc: serde_yaml::Value = serde_yaml::from_str(&content)
            .unwrap_or(serde_yaml::Value::Mapping(serde_yaml::Mapping::new()));

        let all = doc
            .as_mapping_mut()
            .ok_or_else(|| AnsibleError::inventory("Inventory root is not a mapping"))?
            .entry(serde_yaml::Value::String("all".into()))
            .or_insert(serde_yaml::Value::Mapping(serde_yaml::Mapping::new()));

        let hosts_section = all
            .as_mapping_mut()
            .ok_or_else(|| AnsibleError::inventory("'all' is not a mapping"))?
            .entry(serde_yaml::Value::String("hosts".into()))
            .or_insert(serde_yaml::Value::Mapping(serde_yaml::Mapping::new()));

        let host_vars = {
            let mut m = serde_yaml::Mapping::new();
            if let Some(ref h) = params.ansible_host {
                m.insert("ansible_host".into(), serde_yaml::Value::String(h.clone()));
            }
            if let Some(port) = params.ansible_port {
                m.insert(
                    "ansible_port".into(),
                    serde_yaml::Value::Number(serde_yaml::Number::from(port)),
                );
            }
            if let Some(ref u) = params.ansible_user {
                m.insert("ansible_user".into(), serde_yaml::Value::String(u.clone()));
            }
            if let Some(ref c) = params.ansible_connection {
                m.insert(
                    "ansible_connection".into(),
                    serde_yaml::Value::String(c.clone()),
                );
            }
            serde_yaml::Value::Mapping(m)
        };

        hosts_section
            .as_mapping_mut()
            .ok_or_else(|| AnsibleError::inventory("'hosts' is not a mapping"))?
            .insert(serde_yaml::Value::String(params.name.clone()), host_vars);

        let yaml_str = serde_yaml::to_string(&doc)?;
        tokio::fs::write(inventory_path, yaml_str)
            .await
            .map_err(|e| AnsibleError::io(format!("Cannot write {}: {}", inventory_path, e)))?;

        debug!(
            "Added host '{}' to inventory {}",
            params.name, inventory_path
        );
        Ok(())
    }

    /// Remove a host from a YAML inventory file.
    pub async fn remove_host(inventory_path: &str, host_name: &str) -> AnsibleResult<bool> {
        let content = tokio::fs::read_to_string(inventory_path)
            .await
            .map_err(|e| AnsibleError::io(format!("Cannot read {}: {}", inventory_path, e)))?;

        let mut doc: serde_yaml::Value = serde_yaml::from_str(&content)?;

        let removed = if let Some(mapping) = doc.as_mapping_mut() {
            Self::remove_host_recursive(mapping, host_name)
        } else {
            false
        };

        if removed {
            let yaml_str = serde_yaml::to_string(&doc)?;
            tokio::fs::write(inventory_path, yaml_str).await?;
            debug!("Removed host '{}' from {}", host_name, inventory_path);
        }

        Ok(removed)
    }

    /// Add a group to a YAML inventory file.
    pub async fn add_group(inventory_path: &str, params: &AddGroupParams) -> AnsibleResult<()> {
        let content = tokio::fs::read_to_string(inventory_path)
            .await
            .map_err(|e| AnsibleError::io(format!("Cannot read {}: {}", inventory_path, e)))?;

        let mut doc: serde_yaml::Value = serde_yaml::from_str(&content)
            .unwrap_or(serde_yaml::Value::Mapping(serde_yaml::Mapping::new()));

        let all = doc
            .as_mapping_mut()
            .ok_or_else(|| AnsibleError::inventory("Inventory root is not a mapping"))?
            .entry(serde_yaml::Value::String("all".into()))
            .or_insert(serde_yaml::Value::Mapping(serde_yaml::Mapping::new()));

        let children = all
            .as_mapping_mut()
            .ok_or_else(|| AnsibleError::inventory("'all' is not a mapping"))?
            .entry(serde_yaml::Value::String("children".into()))
            .or_insert(serde_yaml::Value::Mapping(serde_yaml::Mapping::new()));

        let group_val = serde_yaml::Value::Mapping(serde_yaml::Mapping::new());
        children
            .as_mapping_mut()
            .ok_or_else(|| AnsibleError::inventory("'children' is not a mapping"))?
            .insert(serde_yaml::Value::String(params.name.clone()), group_val);

        let yaml_str = serde_yaml::to_string(&doc)?;
        tokio::fs::write(inventory_path, yaml_str).await?;

        debug!("Added group '{}' to {}", params.name, inventory_path);
        Ok(())
    }

    /// Remove a group from a YAML inventory file.
    pub async fn remove_group(inventory_path: &str, group_name: &str) -> AnsibleResult<bool> {
        let content = tokio::fs::read_to_string(inventory_path)
            .await
            .map_err(|e| AnsibleError::io(format!("Cannot read {}: {}", inventory_path, e)))?;

        let mut doc: serde_yaml::Value = serde_yaml::from_str(&content)?;

        let removed = if let Some(mapping) = doc.as_mapping_mut() {
            Self::remove_group_recursive(mapping, group_name)
        } else {
            false
        };

        if removed {
            let yaml_str = serde_yaml::to_string(&doc)?;
            tokio::fs::write(inventory_path, yaml_str).await?;
            debug!("Removed group '{}' from {}", group_name, inventory_path);
        }

        Ok(removed)
    }

    // ── Dynamic inventory ────────────────────────────────────────────

    /// Execute a dynamic inventory script and parse results.
    pub async fn run_dynamic(
        client: &AnsibleClient,
        config: &DynamicInventoryConfig,
    ) -> AnsibleResult<Inventory> {
        let output = client
            .run_raw(
                &client.inventory_bin,
                &["-i", &config.script_path, "--list"],
            )
            .await?;

        if output.exit_code != 0 {
            return Err(AnsibleError::inventory(format!(
                "Dynamic inventory script failed (exit {}): {}",
                output.exit_code, output.stderr
            )));
        }

        Self::parse_list_json(&output.stdout, &config.script_path)
    }

    // ── Internal helpers ─────────────────────────────────────────────

    /// Parse the JSON output of `ansible-inventory --list`.
    fn parse_list_json(json_str: &str, source: &str) -> AnsibleResult<Inventory> {
        let data: serde_json::Value = serde_json::from_str(json_str)?;

        let mut hosts: Vec<InventoryHost> = Vec::new();
        let mut groups: Vec<InventoryGroup> = Vec::new();
        let mut host_group_map: HashMap<String, Vec<String>> = HashMap::new();

        let obj = data
            .as_object()
            .ok_or_else(|| AnsibleError::parse("Inventory JSON is not an object"))?;

        // hostvars
        let hostvars = obj
            .get("_meta")
            .and_then(|m| m.get("hostvars"))
            .and_then(|h| h.as_object());

        // Groups (everything except _meta)
        for (group_name, group_data) in obj {
            if group_name == "_meta" {
                continue;
            }

            let mut group_hosts: Vec<String> = Vec::new();
            let mut children: Vec<String> = Vec::new();
            let mut vars: HashMap<String, serde_json::Value> = HashMap::new();

            if let Some(gobj) = group_data.as_object() {
                if let Some(h) = gobj.get("hosts").and_then(|v| v.as_array()) {
                    for host in h {
                        if let Some(name) = host.as_str() {
                            group_hosts.push(name.to_string());
                            host_group_map
                                .entry(name.to_string())
                                .or_default()
                                .push(group_name.clone());
                        }
                    }
                }
                if let Some(c) = gobj.get("children").and_then(|v| v.as_array()) {
                    for child in c {
                        if let Some(name) = child.as_str() {
                            children.push(name.to_string());
                        }
                    }
                }
                if let Some(v) = gobj.get("vars").and_then(|v| v.as_object()) {
                    for (k, val) in v {
                        vars.insert(k.clone(), val.clone());
                    }
                }
            }

            groups.push(InventoryGroup {
                name: group_name.clone(),
                hosts: group_hosts,
                children,
                variables: vars,
            });
        }

        // Build host entries
        if let Some(hv) = hostvars {
            for (host_name, host_vars) in hv {
                let vars_map: HashMap<String, serde_json::Value> = host_vars
                    .as_object()
                    .map(|o| o.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
                    .unwrap_or_default();

                let host_groups = host_group_map.remove(host_name).unwrap_or_default();

                hosts.push(InventoryHost {
                    name: host_name.clone(),
                    ansible_host: vars_map
                        .get("ansible_host")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                    ansible_port: vars_map
                        .get("ansible_port")
                        .and_then(|v| v.as_u64())
                        .map(|p| p as u16),
                    ansible_user: vars_map
                        .get("ansible_user")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                    ansible_connection: vars_map
                        .get("ansible_connection")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                    ansible_python_interpreter: vars_map
                        .get("ansible_python_interpreter")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                    groups: host_groups,
                    variables: vars_map,
                    enabled: true,
                });
            }
        }

        // Hosts that appeared in group lists but not in _meta.hostvars
        for (host_name, host_groups) in host_group_map {
            hosts.push(InventoryHost {
                name: host_name,
                ansible_host: None,
                ansible_port: None,
                ansible_user: None,
                ansible_connection: None,
                ansible_python_interpreter: None,
                groups: host_groups,
                variables: HashMap::new(),
                enabled: true,
            });
        }

        let inv_source = if source.ends_with(".yml") || source.ends_with(".yaml") {
            InventorySource::YamlFile(source.to_string())
        } else if source.ends_with(".ini") || source.ends_with(".cfg") {
            InventorySource::IniFile(source.to_string())
        } else if source.contains(',') {
            InventorySource::Inline(source.to_string())
        } else {
            InventorySource::IniFile(source.to_string())
        };

        Ok(Inventory {
            source: inv_source,
            hosts,
            groups,
            last_refreshed: Some(chrono::Utc::now()),
        })
    }

    fn remove_host_recursive(mapping: &mut serde_yaml::Mapping, host_name: &str) -> bool {
        let mut removed = false;

        if let Some(hosts) = mapping.get_mut(serde_yaml::Value::String("hosts".into())) {
            if let Some(hosts_map) = hosts.as_mapping_mut() {
                let key = serde_yaml::Value::String(host_name.into());
                if hosts_map.remove(&key).is_some() {
                    removed = true;
                }
            }
        }

        // Recurse into children/groups
        let keys: Vec<serde_yaml::Value> = mapping.keys().cloned().collect();
        for key in keys {
            if let Some(val) = mapping.get_mut(&key) {
                if let Some(sub) = val.as_mapping_mut() {
                    if Self::remove_host_recursive(sub, host_name) {
                        removed = true;
                    }
                }
            }
        }

        removed
    }

    fn remove_group_recursive(mapping: &mut serde_yaml::Mapping, group_name: &str) -> bool {
        let mut removed = false;

        if let Some(children) = mapping.get_mut(serde_yaml::Value::String("children".into())) {
            if let Some(children_map) = children.as_mapping_mut() {
                let key = serde_yaml::Value::String(group_name.into());
                if children_map.remove(&key).is_some() {
                    removed = true;
                }
            }
        }

        let keys: Vec<serde_yaml::Value> = mapping.keys().cloned().collect();
        for key in keys {
            if let Some(val) = mapping.get_mut(&key) {
                if let Some(sub) = val.as_mapping_mut() {
                    if Self::remove_group_recursive(sub, group_name) {
                        removed = true;
                    }
                }
            }
        }

        removed
    }
}
