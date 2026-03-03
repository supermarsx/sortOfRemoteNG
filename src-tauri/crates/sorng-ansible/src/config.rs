// ── sorng-ansible/src/config.rs ──────────────────────────────────────────────
//! Ansible configuration — parsing ansible.cfg, environment variables,
//! config dumping, and module documentation.

use std::collections::HashMap;

use regex::Regex;

use crate::client::AnsibleClient;
use crate::error::{AnsibleError, AnsibleResult};
use crate::types::*;

/// Configuration management operations.
pub struct ConfigManager;

impl ConfigManager {
    /// Dump all Ansible configuration settings.
    pub async fn dump(client: &AnsibleClient) -> AnsibleResult<Vec<ConfigSetting>> {
        let output = client
            .run_raw(&client.config_bin, &["dump", "--only-changed"])
            .await;

        let full_output = client
            .run_raw(&client.config_bin, &["dump"])
            .await?;

        let changed_keys: Vec<String> = if let Ok(ref changed) = output {
            changed.stdout.lines()
                .filter_map(|line| {
                    let parts: Vec<&str> = line.splitn(2, '=').collect();
                    if parts.len() == 2 {
                        Some(parts[0].trim().to_string())
                    } else {
                        None
                    }
                })
                .collect()
        } else {
            Vec::new()
        };

        let mut settings = Vec::new();

        for line in full_output.stdout.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                continue;
            }

            let parts: Vec<&str> = trimmed.splitn(2, '=').collect();
            if parts.len() != 2 {
                continue;
            }

            let key = parts[0].trim().to_string();
            let value = parts[1].trim().to_string();

            let origin = if changed_keys.contains(&key) {
                ConfigOrigin::ConfigFile
            } else {
                ConfigOrigin::Default
            };

            settings.push(ConfigSetting {
                key: key.clone(),
                value,
                section: "defaults".to_string(),
                origin,
                default: None,
                description: None,
            });
        }

        Ok(settings)
    }

    /// Get a specific config value.
    pub async fn get(client: &AnsibleClient, key: &str) -> AnsibleResult<Option<ConfigSetting>> {
        let all = Self::dump(client).await?;
        Ok(all.into_iter().find(|s| s.key == key))
    }

    /// Parse an ansible.cfg file from disk.
    pub async fn parse_config_file(path: &str) -> AnsibleResult<AnsibleConfig> {
        let content = tokio::fs::read_to_string(path)
            .await
            .map_err(|e| AnsibleError::config(format!("Cannot read {}: {}", path, e)))?;

        Self::parse_ini(&content, path)
    }

    /// Detect the active configuration file path.
    pub async fn detect_config_path(client: &AnsibleClient) -> AnsibleResult<Option<String>> {
        let info = client.detect_info().await?;
        Ok(info.config_file)
    }

    // ── Module docs ──────────────────────────────────────────────────

    /// List all available modules.
    pub async fn list_modules(client: &AnsibleClient) -> AnsibleResult<Vec<String>> {
        let output = client
            .run_raw(&client.doc_bin, &["-l", "--json"])
            .await;

        match output {
            Ok(out) if out.exit_code == 0 => {
                if let Ok(data) = serde_json::from_str::<HashMap<String, serde_json::Value>>(&out.stdout) {
                    let mut modules: Vec<String> = data.keys().cloned().collect();
                    modules.sort();
                    return Ok(modules);
                }
                // Fallback: parse line-based output
                let modules: Vec<String> = out.stdout.lines()
                    .filter_map(|line| {
                        let trimmed = line.trim();
                        if trimmed.is_empty() {
                            return None;
                        }
                        let parts: Vec<&str> = trimmed.splitn(2, char::is_whitespace).collect();
                        Some(parts[0].to_string())
                    })
                    .collect();
                Ok(modules)
            }
            Ok(out) => {
                // Non-JSON fallback
                let modules: Vec<String> = out.stdout.lines()
                    .filter_map(|line| {
                        let trimmed = line.trim();
                        if trimmed.is_empty() {
                            return None;
                        }
                        let parts: Vec<&str> = trimmed.splitn(2, char::is_whitespace).collect();
                        Some(parts[0].to_string())
                    })
                    .collect();
                Ok(modules)
            }
            Err(_) => Ok(Vec::new()),
        }
    }

    /// Get documentation for a specific module.
    pub async fn module_doc(client: &AnsibleClient, module_name: &str) -> AnsibleResult<ModuleInfo> {
        let output = client
            .run_raw(&client.doc_bin, &[module_name, "--json"])
            .await?;

        if output.exit_code != 0 {
            return Err(AnsibleError::parse(format!(
                "ansible-doc {} failed: {}", module_name, output.stderr
            )));
        }

        Self::parse_module_doc(&output.stdout, module_name)
    }

    /// Get module examples.
    pub async fn module_examples(client: &AnsibleClient, module_name: &str) -> AnsibleResult<String> {
        let output = client
            .run_raw(&client.doc_bin, &[module_name, "-s"])
            .await?;

        if output.exit_code != 0 {
            return Err(AnsibleError::parse(format!(
                "ansible-doc -s {} failed: {}", module_name, output.stderr
            )));
        }

        Ok(output.stdout)
    }

    /// List available plugins of a given type.
    pub async fn list_plugins(
        client: &AnsibleClient,
        plugin_type: &str,
    ) -> AnsibleResult<Vec<String>> {
        let output = client
            .run_raw(&client.doc_bin, &["-t", plugin_type, "-l"])
            .await?;

        if output.exit_code != 0 {
            return Ok(Vec::new());
        }

        let plugins: Vec<String> = output.stdout.lines()
            .filter_map(|line| {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    return None;
                }
                let parts: Vec<&str> = trimmed.splitn(2, char::is_whitespace).collect();
                Some(parts[0].to_string())
            })
            .collect();

        Ok(plugins)
    }

    // ── Internal helpers ─────────────────────────────────────────────

    fn parse_ini(content: &str, source: &str) -> AnsibleResult<AnsibleConfig> {
        let section_re = Regex::new(r"^\[(.+)\]$").unwrap();
        let kv_re = Regex::new(r"^(\w+)\s*=\s*(.*)$").unwrap();

        let mut sections: HashMap<String, HashMap<String, String>> = HashMap::new();
        let mut current_section = "defaults".to_string();

        for line in content.lines() {
            let trimmed = line.trim();

            if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with(';') {
                continue;
            }

            if let Some(caps) = section_re.captures(trimmed) {
                current_section = caps[1].to_string();
                continue;
            }

            if let Some(caps) = kv_re.captures(trimmed) {
                let key = caps[1].to_string();
                let value = caps[2].trim().to_string();
                sections
                    .entry(current_section.clone())
                    .or_default()
                    .insert(key, value);
            }
        }

        Ok(AnsibleConfig {
            source: Some(source.to_string()),
            sections,
        })
    }

    fn parse_module_doc(json_str: &str, module_name: &str) -> AnsibleResult<ModuleInfo> {
        let data: serde_json::Value = serde_json::from_str(json_str)?;

        // ansible-doc --json returns {module_name: {doc: {...}}}
        let module_data = data.get(module_name)
            .or_else(|| {
                // Sometimes the key has a namespace prefix
                data.as_object().and_then(|obj| obj.values().next())
            })
            .ok_or_else(|| AnsibleError::parse("Module not found in ansible-doc output"))?;

        let doc = module_data.get("doc").unwrap_or(module_data);

        let description = doc.get("description")
            .and_then(|v| {
                if let Some(arr) = v.as_array() {
                    Some(arr.iter()
                        .filter_map(|item| item.as_str())
                        .collect::<Vec<_>>()
                        .join(" "))
                } else {
                    v.as_str().map(|s| s.to_string())
                }
            });

        let short_description = doc.get("short_description")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let namespace = doc.get("collection")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let parameters = doc.get("options")
            .and_then(|v| v.as_object())
            .map(|opts| {
                opts.iter().map(|(name, opt)| {
                    let opt_obj = opt.as_object();
                    ModuleParameter {
                        name: name.clone(),
                        description: opt_obj
                            .and_then(|o| o.get("description"))
                            .and_then(|v| {
                                if let Some(arr) = v.as_array() {
                                    Some(arr.iter().filter_map(|i| i.as_str()).collect::<Vec<_>>().join(" "))
                                } else {
                                    v.as_str().map(|s| s.to_string())
                                }
                            }),
                        param_type: opt_obj
                            .and_then(|o| o.get("type"))
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string()),
                        required: opt_obj
                            .and_then(|o| o.get("required"))
                            .and_then(|v| v.as_bool())
                            .unwrap_or(false),
                        default: opt_obj.and_then(|o| o.get("default")).cloned(),
                        choices: opt_obj
                            .and_then(|o| o.get("choices"))
                            .and_then(|v| v.as_array())
                            .map(|arr| arr.clone())
                            .unwrap_or_default(),
                        aliases: opt_obj
                            .and_then(|o| o.get("aliases"))
                            .and_then(|v| v.as_array())
                            .map(|arr| arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
                            .unwrap_or_default(),
                    }
                }).collect()
            })
            .unwrap_or_default();

        let examples = module_data.get("examples")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let return_values = module_data.get("return")
            .and_then(|v| v.as_object())
            .map(|rets| {
                rets.iter().map(|(name, ret)| {
                    let ret_obj = ret.as_object();
                    ModuleReturnValue {
                        name: name.clone(),
                        description: ret_obj
                            .and_then(|o| o.get("description"))
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string()),
                        returned: ret_obj
                            .and_then(|o| o.get("returned"))
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string()),
                        return_type: ret_obj
                            .and_then(|o| o.get("type"))
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string()),
                        sample: ret_obj.and_then(|o| o.get("sample")).cloned(),
                    }
                }).collect()
            })
            .unwrap_or_default();

        Ok(ModuleInfo {
            name: module_name.to_string(),
            namespace,
            short_description,
            description,
            parameters,
            examples,
            return_values,
        })
    }
}
