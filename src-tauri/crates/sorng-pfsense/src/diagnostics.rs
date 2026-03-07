//! Diagnostic tools for pfSense/OPNsense.

use crate::client::PfsenseClient;
use crate::error::{PfsenseError, PfsenseResult};
use crate::types::*;

pub struct DiagnosticsManager;

impl DiagnosticsManager {
    pub async fn get_arp_table(client: &PfsenseClient) -> PfsenseResult<Vec<ArpEntry>> {
        let output = client.exec_ssh("arp -an --libxo json").await?;
        if output.exit_code != 0 {
            return Err(PfsenseError::api(format!("Failed to get ARP table: {}", output.stderr)));
        }
        let parsed: serde_json::Value = serde_json::from_str(&output.stdout)
            .map_err(|e| PfsenseError::parse(e.to_string()))?;
        let entries = parsed.get("arp")
            .and_then(|a| a.get("arp-cache"))
            .and_then(|c| c.as_array())
            .cloned()
            .unwrap_or_default();
        entries.into_iter()
            .map(|v| {
                Ok(ArpEntry {
                    interface: v.get("interface").and_then(|i| i.as_str()).unwrap_or("").to_string(),
                    ip: v.get("ip-address").and_then(|i| i.as_str()).unwrap_or("").to_string(),
                    mac: v.get("mac-address").and_then(|m| m.as_str()).unwrap_or("").to_string(),
                    hostname: v.get("hostname").and_then(|h| h.as_str()).unwrap_or("").to_string(),
                    expires: v.get("expires").and_then(|e| e.as_str()).unwrap_or("").to_string(),
                    type_: v.get("type").and_then(|t| t.as_str()).unwrap_or("").to_string(),
                })
            })
            .collect()
    }

    pub async fn get_ndp_table(client: &PfsenseClient) -> PfsenseResult<Vec<NdpEntry>> {
        let output = client.exec_ssh("ndp -an --libxo json").await?;
        if output.exit_code != 0 {
            return Err(PfsenseError::api(format!("Failed to get NDP table: {}", output.stderr)));
        }
        let parsed: serde_json::Value = serde_json::from_str(&output.stdout)
            .map_err(|e| PfsenseError::parse(e.to_string()))?;
        let entries = parsed.get("ndp")
            .and_then(|n| n.get("ndp-cache"))
            .and_then(|c| c.as_array())
            .cloned()
            .unwrap_or_default();
        entries.into_iter()
            .map(|v| {
                Ok(NdpEntry {
                    interface: v.get("interface").and_then(|i| i.as_str()).unwrap_or("").to_string(),
                    ip: v.get("ip-address").and_then(|i| i.as_str()).unwrap_or("").to_string(),
                    mac: v.get("mac-address").and_then(|m| m.as_str()).unwrap_or("").to_string(),
                    hostname: v.get("hostname").and_then(|h| h.as_str()).unwrap_or("").to_string(),
                    expires: v.get("expires").and_then(|e| e.as_str()).unwrap_or("").to_string(),
                })
            })
            .collect()
    }

    pub async fn get_system_routes(client: &PfsenseClient) -> PfsenseResult<Vec<SystemRoute>> {
        crate::routing::RoutingManager::get_routing_table(client).await
    }

    pub async fn get_pf_states(client: &PfsenseClient) -> PfsenseResult<Vec<PfState>> {
        let output = client.exec_ssh("pfctl -ss").await?;
        if output.exit_code != 0 {
            return Err(PfsenseError::api(format!("Failed to get PF states: {}", output.stderr)));
        }
        let mut states = Vec::new();
        for (idx, line) in output.stdout.lines().enumerate() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 5 {
                states.push(PfState {
                    id: idx.to_string(),
                    interface: parts.first().unwrap_or(&"").to_string(),
                    protocol: parts.get(1).unwrap_or(&"").to_string(),
                    source: parts.get(2).unwrap_or(&"").to_string(),
                    destination: parts.get(4).unwrap_or(&"").to_string(),
                    state: parts.get(5).unwrap_or(&"").to_string(),
                    age: String::new(),
                    expires: String::new(),
                    bytes: 0,
                    packets: 0,
                });
            }
        }
        Ok(states)
    }

    pub async fn dns_lookup(client: &PfsenseClient, host: &str, server: Option<&str>) -> PfsenseResult<DnsLookupResult> {
        let cmd = match server {
            Some(srv) => format!("drill {} @{}", client.shell_escape(host), client.shell_escape(srv)),
            None => format!("drill {}", client.shell_escape(host)),
        };
        let output = client.exec_ssh(&cmd).await?;
        let mut results = Vec::new();
        for line in output.stdout.lines() {
            let trimmed = line.trim();
            if trimmed.contains("IN") && (trimmed.contains("A\t") || trimmed.contains("AAAA\t")) {
                if let Some(ip) = trimmed.split_whitespace().last() {
                    results.push(ip.to_string());
                }
            }
        }
        let query_time = output.stdout.lines()
            .find(|l| l.contains("Query time"))
            .unwrap_or("")
            .to_string();
        Ok(DnsLookupResult {
            query: host.to_string(),
            server: server.unwrap_or("default").to_string(),
            results,
            query_time,
        })
    }

    pub async fn ping(client: &PfsenseClient, host: &str, count: u32) -> PfsenseResult<PingResult> {
        let output = client.exec_ssh(&format!(
            "ping -c {} {}",
            count,
            client.shell_escape(host)
        )).await?;
        let mut transmitted = 0u32;
        let mut received = 0u32;
        let mut loss = 0.0f64;
        let mut min = 0.0f64;
        let mut avg = 0.0f64;
        let mut max = 0.0f64;
        for line in output.stdout.lines() {
            if line.contains("packets transmitted") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                transmitted = parts.first().and_then(|s| s.parse().ok()).unwrap_or(0);
                received = parts.get(3).and_then(|s| s.parse().ok()).unwrap_or(0);
                if let Some(pct) = parts.iter().find(|s| s.ends_with('%')) {
                    loss = pct.trim_end_matches('%').parse().unwrap_or(0.0);
                }
            }
            if line.contains("min/avg/max") {
                if let Some(vals) = line.split('=').nth(1) {
                    let nums: Vec<f64> = vals.split('/')
                        .filter_map(|s| s.trim().trim_end_matches(" ms").parse().ok())
                        .collect();
                    if nums.len() >= 3 {
                        min = nums[0];
                        avg = nums[1];
                        max = nums[2];
                    }
                }
            }
        }
        Ok(PingResult {
            host: host.to_string(),
            transmitted,
            received,
            loss_percent: loss,
            min_ms: min,
            avg_ms: avg,
            max_ms: max,
            output: output.stdout,
        })
    }

    pub async fn traceroute(client: &PfsenseClient, host: &str) -> PfsenseResult<TracerouteResult> {
        let output = client.exec_ssh(&format!(
            "traceroute {}",
            client.shell_escape(host)
        )).await?;
        let mut hops = Vec::new();
        for line in output.stdout.lines().skip(1) {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if let Some(hop_num) = parts.first().and_then(|s| s.parse::<u32>().ok()) {
                let ip = parts.get(1).unwrap_or(&"*").to_string();
                let hostname_str = if ip.contains('(') {
                    parts.get(1).unwrap_or(&"").to_string()
                } else {
                    String::new()
                };
                hops.push(TracerouteHop {
                    hop: hop_num,
                    ip: ip.trim_start_matches('(').trim_end_matches(')').to_string(),
                    hostname: hostname_str,
                    rtt1: parts.get(2).unwrap_or(&"").to_string(),
                    rtt2: parts.get(4).unwrap_or(&"").to_string(),
                    rtt3: parts.get(6).unwrap_or(&"").to_string(),
                });
            }
        }
        Ok(TracerouteResult {
            host: host.to_string(),
            hops,
            output: output.stdout,
        })
    }

    pub async fn get_packet_capture(
        client: &PfsenseClient,
        interface: &str,
        count: u32,
        filter: Option<&str>,
    ) -> PfsenseResult<String> {
        let filter_arg = filter.map(|f| format!(" {}", client.shell_escape(f))).unwrap_or_default();
        let output = client.exec_ssh(&format!(
            "tcpdump -i {} -c {}{} -n",
            client.shell_escape(interface),
            count,
            filter_arg
        )).await?;
        if output.exit_code != 0 && !output.stderr.is_empty() {
            return Err(PfsenseError::api(format!("Packet capture failed: {}", output.stderr)));
        }
        Ok(output.stdout)
    }

    pub async fn get_pf_info(client: &PfsenseClient) -> PfsenseResult<PfInfo> {
        let output = client.exec_ssh("pfctl -si").await?;
        if output.exit_code != 0 {
            return Err(PfsenseError::api(format!("Failed to get PF info: {}", output.stderr)));
        }
        let mut states = 0u64;
        let mut state_limit = 0u64;
        let mut src_tracking = 0u64;
        let mut running_since = String::new();
        for line in output.stdout.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("current entries") {
                states = trimmed.split_whitespace().last().and_then(|s| s.parse().ok()).unwrap_or(0);
            } else if trimmed.starts_with("limit") {
                state_limit = trimmed.split_whitespace().last().and_then(|s| s.parse().ok()).unwrap_or(0);
            } else if trimmed.starts_with("source tracking") {
                src_tracking = trimmed.split_whitespace().last().and_then(|s| s.parse().ok()).unwrap_or(0);
            } else if trimmed.starts_with("Status:") && trimmed.contains("since") {
                running_since = trimmed.split("since").nth(1).unwrap_or("").trim().to_string();
            }
        }
        Ok(PfInfo {
            states,
            state_limit,
            src_tracking,
            running_since,
            if_stats: Vec::new(),
        })
    }

    pub async fn get_mbuf_stats(client: &PfsenseClient) -> PfsenseResult<serde_json::Value> {
        let output = client.exec_ssh("netstat -m").await?;
        Ok(serde_json::json!({ "output": output.stdout }))
    }

    pub async fn get_memory_stats(client: &PfsenseClient) -> PfsenseResult<serde_json::Value> {
        let output = client.exec_ssh("sysctl hw.physmem hw.usermem vm.stats.vm.v_page_count vm.stats.vm.v_free_count").await?;
        Ok(serde_json::json!({ "output": output.stdout }))
    }

    pub async fn test_port(client: &PfsenseClient, host: &str, port: u16) -> PfsenseResult<bool> {
        let output = client.exec_ssh(&format!(
            "nc -z -w5 {} {}",
            client.shell_escape(host),
            port
        )).await?;
        Ok(output.exit_code == 0)
    }
}
