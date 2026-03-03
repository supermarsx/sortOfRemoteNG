// ── sorng-ansible/src/facts.rs ───────────────────────────────────────────────
//! Fact gathering, caching, and querying per host using the `setup` module.

use std::collections::HashMap;


use crate::client::AnsibleClient;
use crate::error::{AnsibleError, AnsibleResult};
use crate::types::*;

/// Fact management operations.
pub struct FactManager;

impl FactManager {
    /// Gather facts from a host or host pattern.
    pub async fn gather(
        client: &AnsibleClient,
        pattern: &str,
        inventory: Option<&str>,
        subset: Option<&str>,
    ) -> AnsibleResult<HashMap<String, HostFacts>> {
        let mut args = vec![
            pattern.to_string(),
            "-m".to_string(),
            "setup".to_string(),
        ];

        if let Some(inv) = inventory {
            args.push("-i".to_string());
            args.push(inv.to_string());
        }

        if let Some(sub) = subset {
            args.push("-a".to_string());
            args.push(format!("filter={}", sub));
        }

        // Use JSON stdout callback for structured output
        let mut env = client.env_vars.clone();
        env.insert("ANSIBLE_STDOUT_CALLBACK".to_string(), "json".to_string());

        let output = client.run_ansible(&args).await?;

        if output.exit_code != 0 && output.exit_code != 2 {
            return Err(AnsibleError::facts(format!(
                "Fact gathering failed (exit {}): {}", output.exit_code, output.stderr
            )));
        }

        Self::parse_facts_output(&output.stdout)
    }

    /// Gather a specific subset of facts (e.g., "network", "hardware", "virtual").
    pub async fn gather_subset(
        client: &AnsibleClient,
        pattern: &str,
        inventory: Option<&str>,
        gather_subset: &[&str],
    ) -> AnsibleResult<HashMap<String, HostFacts>> {
        let subset_arg = gather_subset.join(",");
        let mut args = vec![
            pattern.to_string(),
            "-m".to_string(),
            "setup".to_string(),
            "-a".to_string(),
            format!("gather_subset={}", subset_arg),
        ];

        if let Some(inv) = inventory {
            args.push("-i".to_string());
            args.push(inv.to_string());
        }

        let output = client.run_ansible(&args).await?;

        if output.exit_code != 0 && output.exit_code != 2 {
            return Err(AnsibleError::facts(format!(
                "Fact gathering failed (exit {}): {}", output.exit_code, output.stderr
            )));
        }

        Self::parse_facts_output(&output.stdout)
    }

    /// Gather minimal facts (just hostname, fqdn, os_family).
    pub async fn gather_min(
        client: &AnsibleClient,
        pattern: &str,
        inventory: Option<&str>,
    ) -> AnsibleResult<HashMap<String, HostFacts>> {
        Self::gather_subset(client, pattern, inventory, &["min"]).await
    }

    /// List all available fact modules / plugins.
    pub async fn list_fact_modules(client: &AnsibleClient) -> AnsibleResult<Vec<String>> {
        let output = client
            .run_raw(&client.doc_bin, &["-t", "module", "-l", "--json"])
            .await;

        match output {
            Ok(out) if out.exit_code == 0 => {
                // Try parsing JSON listing
                if let Ok(data) = serde_json::from_str::<HashMap<String, serde_json::Value>>(&out.stdout) {
                    let modules: Vec<String> = data.keys()
                        .filter(|k| k.contains("facts") || k.contains("setup"))
                        .cloned()
                        .collect();
                    return Ok(modules);
                }
                Ok(Vec::new())
            }
            _ => Ok(Vec::new()),
        }
    }

    // ── Internal parsing helpers ─────────────────────────────────────

    fn parse_facts_output(output: &str) -> AnsibleResult<HashMap<String, HostFacts>> {
        let mut results = HashMap::new();

        // Try JSON callback output first
        if let Ok(json_data) = serde_json::from_str::<serde_json::Value>(output) {
            if let Some(plays) = json_data.get("plays").and_then(|v| v.as_array()) {
                for play in plays {
                    if let Some(tasks) = play.get("tasks").and_then(|v| v.as_array()) {
                        for task in tasks {
                            if let Some(hosts) = task.get("hosts").and_then(|v| v.as_object()) {
                                for (host, host_data) in hosts {
                                    if let Some(facts) = host_data.get("ansible_facts").and_then(|v| v.as_object()) {
                                        let host_facts = Self::extract_host_facts(host, facts);
                                        results.insert(host.clone(), host_facts);
                                    }
                                }
                            }
                        }
                    }
                }
            }

            return Ok(results);
        }

        // Fallback: parse line-based output
        // Host-level JSON blocks like:  hostname | SUCCESS => { "ansible_facts": {...} }
        let host_re = regex::Regex::new(r"^(\S+)\s*\|\s*SUCCESS\s*=>\s*$").unwrap();
        let mut current_host: Option<String> = None;
        let mut json_buf = String::new();
        let mut brace_depth = 0;

        for line in output.lines() {
            if let Some(caps) = host_re.captures(line) {
                // Flush previous
                if let Some(ref host) = current_host {
                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&json_buf) {
                        if let Some(facts) = parsed.get("ansible_facts").and_then(|v| v.as_object()) {
                            let hf = Self::extract_host_facts(host, facts);
                            results.insert(host.clone(), hf);
                        }
                    }
                }
                current_host = Some(caps[1].to_string());
                json_buf.clear();
                brace_depth = 0;
                continue;
            }

            if current_host.is_some() {
                json_buf.push_str(line);
                json_buf.push('\n');
                brace_depth += line.matches('{').count() as i32;
                brace_depth -= line.matches('}').count() as i32;

                if brace_depth <= 0 && !json_buf.trim().is_empty() {
                    if let Some(ref host) = current_host {
                        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&json_buf) {
                            if let Some(facts) = parsed.get("ansible_facts").and_then(|v| v.as_object()) {
                                let hf = Self::extract_host_facts(host, facts);
                                results.insert(host.clone(), hf);
                            }
                        }
                    }
                    current_host = None;
                    json_buf.clear();
                }
            }
        }

        Ok(results)
    }

    fn extract_host_facts(
        hostname: &str,
        facts: &serde_json::Map<String, serde_json::Value>,
    ) -> HostFacts {
        let get_str = |key: &str| facts.get(key).and_then(|v| v.as_str()).map(|s| s.to_string());
        let get_u64 = |key: &str| facts.get(key).and_then(|v| v.as_u64());
        let get_u32 = |key: &str| facts.get(key).and_then(|v| v.as_u64()).map(|n| n as u32);

        let processor = facts.get("ansible_processor")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
            .unwrap_or_default();

        let memory_mb = facts.get("ansible_memory_mb")
            .and_then(|v| v.as_object())
            .and_then(|m| {
                let real = m.get("real")?.as_object()?;
                let swap = m.get("swap")?.as_object()?;
                Some(MemoryFacts {
                    total: real.get("total").and_then(|v| v.as_u64()).unwrap_or(0),
                    free: real.get("free").and_then(|v| v.as_u64()).unwrap_or(0),
                    used: real.get("used").and_then(|v| v.as_u64()).unwrap_or(0),
                    swap_total: swap.get("total").and_then(|v| v.as_u64()).unwrap_or(0),
                    swap_free: swap.get("free").and_then(|v| v.as_u64()).unwrap_or(0),
                })
            });

        let interfaces = facts.get("ansible_interfaces")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|iface_name| {
                        let name = iface_name.as_str()?;
                        let iface_key = format!("ansible_{}", name.replace('-', "_"));
                        let iface_data = facts.get(&iface_key)?.as_object()?;

                        Some(NetworkInterfaceFacts {
                            name: name.to_string(),
                            ipv4: iface_data.get("ipv4")
                                .and_then(|v| v.get("address"))
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string()),
                            ipv6: iface_data.get("ipv6")
                                .and_then(|v| v.as_array())
                                .and_then(|arr| arr.first())
                                .and_then(|v| v.get("address"))
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string()),
                            mac_address: iface_data.get("macaddress")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string()),
                            mtu: iface_data.get("mtu").and_then(|v| v.as_u64()).map(|n| n as u32),
                            active: iface_data.get("active").and_then(|v| v.as_bool()).unwrap_or(false),
                            speed: iface_data.get("speed").and_then(|v| v.as_u64()).map(|n| n as u32),
                            interface_type: iface_data.get("type").and_then(|v| v.as_str()).map(|s| s.to_string()),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        let mounts = facts.get("ansible_mounts")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|m| {
                        let mount = m.as_object()?;
                        Some(MountFacts {
                            mount: mount.get("mount")?.as_str()?.to_string(),
                            device: mount.get("device")?.as_str()?.to_string(),
                            fstype: mount.get("fstype")?.as_str()?.to_string(),
                            options: mount.get("options").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                            size_total: mount.get("size_total").and_then(|v| v.as_u64()),
                            size_available: mount.get("size_available").and_then(|v| v.as_u64()),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        let ipv4_addresses = facts.get("ansible_all_ipv4_addresses")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
            .unwrap_or_default();

        let ipv6_addresses = facts.get("ansible_all_ipv6_addresses")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
            .unwrap_or_default();

        let selinux = facts.get("ansible_selinux")
            .and_then(|v| v.as_object())
            .map(|se| SelinuxFacts {
                status: se.get("status").and_then(|v| v.as_str()).unwrap_or("unknown").to_string(),
                mode: se.get("mode").and_then(|v| v.as_str()).map(|s| s.to_string()),
                policy_version: se.get("policyvers").and_then(|v| v.as_str()).map(|s| s.to_string()),
                config_mode: se.get("config_mode").and_then(|v| v.as_str()).map(|s| s.to_string()),
            });

        let all_facts: HashMap<String, serde_json::Value> = facts.iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();

        HostFacts {
            hostname: hostname.to_string(),
            fqdn: get_str("ansible_fqdn"),
            os_family: get_str("ansible_os_family"),
            distribution: get_str("ansible_distribution"),
            distribution_version: get_str("ansible_distribution_version"),
            distribution_release: get_str("ansible_distribution_release"),
            kernel: get_str("ansible_kernel"),
            architecture: get_str("ansible_architecture"),
            processor,
            processor_count: get_u32("ansible_processor_count"),
            memory_mb,
            interfaces,
            mounts,
            ipv4_addresses,
            ipv6_addresses,
            uptime_seconds: get_u64("ansible_uptime_seconds"),
            python_version: get_str("ansible_python_version"),
            selinux,
            virtualization_type: get_str("ansible_virtualization_type"),
            virtualization_role: get_str("ansible_virtualization_role"),
            all_facts,
        }
    }
}
