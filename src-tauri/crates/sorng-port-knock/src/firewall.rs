use crate::types::{
    FirewallAction, FirewallBackend, FirewallDirection, FirewallRule, FirewallRuleOptions,
    KnockProtocol, KnockSequence,
};

/// Comprehensive firewall integration for port knocking.
/// Builds command strings for various firewall backends.
pub struct FirewallManager;

impl FirewallManager {
    pub fn new() -> Self {
        Self
    }

    /// Builds a command string that detects which firewall backend is available.
    /// Checks for iptables, nft, pfctl, netsh advfirewall, ufw, firewall-cmd in order.
    pub fn detect_backend() -> String {
        [
            "command -v iptables >/dev/null 2>&1 && echo iptables",
            "command -v nft >/dev/null 2>&1 && echo nftables",
            "command -v pfctl >/dev/null 2>&1 && echo pf",
            "command -v netsh >/dev/null 2>&1 && netsh advfirewall show currentprofile >/dev/null 2>&1 && echo windows_firewall",
            "command -v ufw >/dev/null 2>&1 && echo ufw",
            "command -v firewall-cmd >/dev/null 2>&1 && echo firewalld",
        ]
        .join(" || ")
    }

    /// Returns the command to get firewall state for the given backend.
    pub fn get_state_command(backend: FirewallBackend) -> String {
        match backend {
            FirewallBackend::Iptables => "iptables -L -n -v --line-numbers".to_string(),
            FirewallBackend::Nftables => "nft list ruleset".to_string(),
            FirewallBackend::Pf => "pfctl -sr".to_string(),
            FirewallBackend::WindowsFirewall => {
                "netsh advfirewall firewall show rule name=all".to_string()
            }
            FirewallBackend::Ufw => "ufw status verbose".to_string(),
            FirewallBackend::Firewalld => "firewall-cmd --list-all".to_string(),
        }
    }

    /// Parses `iptables -L -n -v --line-numbers` output into FirewallRule structs.
    pub fn parse_iptables_rules(output: &str) -> Vec<FirewallRule> {
        let mut rules = Vec::new();
        let mut current_chain = String::new();
        let mut current_direction = FirewallDirection::Inbound;

        for line in output.lines() {
            let trimmed = line.trim();

            // Detect chain header: "Chain INPUT (policy DROP)"
            if trimmed.starts_with("Chain ") {
                if let Some(chain_name) = trimmed
                    .strip_prefix("Chain ")
                    .and_then(|s| s.split_whitespace().next())
                {
                    current_chain = chain_name.to_string();
                    current_direction = match chain_name {
                        "INPUT" => FirewallDirection::Inbound,
                        "OUTPUT" => FirewallDirection::Outbound,
                        "FORWARD" => FirewallDirection::Forward,
                        _ => FirewallDirection::Inbound,
                    };
                }
                continue;
            }

            // Skip header/empty lines
            if trimmed.is_empty()
                || trimmed.starts_with("num")
                || trimmed.starts_with("pkts")
                || trimmed.starts_with("target")
            {
                continue;
            }

            // Parse rule lines: "num  pkts bytes target  prot opt in  out  source  destination  extra"
            let parts: Vec<&str> = trimmed.split_whitespace().collect();
            if parts.len() < 9 {
                continue;
            }

            let line_num = parts[0];
            let target = parts[3];
            let prot = parts[4];

            let action = match target {
                "ACCEPT" => FirewallAction::Accept,
                "DROP" => FirewallAction::Drop,
                "REJECT" => FirewallAction::Reject,
                "LOG" => FirewallAction::Log,
                _ => continue,
            };

            let protocol = match prot {
                "tcp" => KnockProtocol::Tcp,
                "udp" => KnockProtocol::Udp,
                _ => continue,
            };

            let source = parts[7];
            let destination = parts[8];
            let source_ip = if source != "0.0.0.0/0" {
                Some(source.to_string())
            } else {
                None
            };
            let destination_ip = if destination != "0.0.0.0/0" {
                Some(destination.to_string())
            } else {
                None
            };

            // Try to extract dport from remaining parts
            let extra = parts[9..].join(" ");
            let port = extra
                .split_whitespace()
                .find_map(|s| s.strip_prefix("dpt:").and_then(|p| p.parse::<u16>().ok()))
                .unwrap_or(0);

            // Extract comment if present
            let comment = extra
                .find("/* ")
                .and_then(|start| {
                    extra[start + 3..]
                        .find(" */")
                        .map(|end| extra[start + 3..start + 3 + end].to_string())
                })
                .unwrap_or_default();

            rules.push(FirewallRule {
                id: format!("{}-{}", current_chain, line_num),
                chain: current_chain.clone(),
                action,
                direction: current_direction,
                protocol,
                source_ip,
                destination_ip,
                port,
                comment,
                expires_at: None,
                created_at: chrono::Utc::now(),
            });
        }

        rules
    }

    /// Parses `nft list ruleset` output into FirewallRule structs.
    pub fn parse_nft_rules(output: &str) -> Vec<FirewallRule> {
        let mut rules = Vec::new();
        let mut current_chain = String::new();
        let mut rule_idx: u32 = 0;

        for line in output.lines() {
            let trimmed = line.trim();

            // Detect chain: "chain input {"
            if trimmed.starts_with("chain ") && trimmed.ends_with('{') {
                current_chain = trimmed
                    .strip_prefix("chain ")
                    .unwrap_or("")
                    .trim_end_matches(|c: char| c == '{' || c.is_whitespace())
                    .to_string();
                rule_idx = 0;
                continue;
            }

            // Skip non-rule lines
            if !trimmed.contains("dport") || trimmed.starts_with('#') || trimmed.starts_with('}') {
                continue;
            }

            rule_idx += 1;

            let action = if trimmed.contains(" accept") {
                FirewallAction::Accept
            } else if trimmed.contains(" drop") {
                FirewallAction::Drop
            } else if trimmed.contains(" reject") {
                FirewallAction::Reject
            } else if trimmed.contains(" log") {
                FirewallAction::Log
            } else {
                continue;
            };

            let protocol = if trimmed.contains("tcp dport") {
                KnockProtocol::Tcp
            } else if trimmed.contains("udp dport") {
                KnockProtocol::Udp
            } else {
                continue;
            };

            let direction = match current_chain.as_str() {
                "input" => FirewallDirection::Inbound,
                "output" => FirewallDirection::Outbound,
                "forward" => FirewallDirection::Forward,
                _ => FirewallDirection::Inbound,
            };

            // Extract source IP: "ip saddr 10.0.0.1"
            let source_ip = trimmed
                .find("ip saddr ")
                .map(|i| {
                    trimmed[i + 9..]
                        .split_whitespace()
                        .next()
                        .unwrap_or("")
                        .to_string()
                })
                .filter(|s| !s.is_empty());

            let destination_ip = trimmed
                .find("ip daddr ")
                .map(|i| {
                    trimmed[i + 9..]
                        .split_whitespace()
                        .next()
                        .unwrap_or("")
                        .to_string()
                })
                .filter(|s| !s.is_empty());

            // Extract dport: "tcp dport 22" or "udp dport 53"
            let port = trimmed
                .find("dport ")
                .and_then(|i| {
                    trimmed[i + 6..]
                        .split_whitespace()
                        .next()
                        .and_then(|p| p.parse::<u16>().ok())
                })
                .unwrap_or(0);

            // Extract comment: comment "..."
            let comment = trimmed
                .find("comment \"")
                .and_then(|i| {
                    trimmed[i + 9..]
                        .find('"')
                        .map(|end| trimmed[i + 9..i + 9 + end].to_string())
                })
                .unwrap_or_default();

            rules.push(FirewallRule {
                id: format!("{}-{}", current_chain, rule_idx),
                chain: current_chain.clone(),
                action,
                direction,
                protocol,
                source_ip,
                destination_ip,
                port,
                comment,
                expires_at: None,
                created_at: chrono::Utc::now(),
            });
        }

        rules
    }

    /// Generates the command to add an ACCEPT rule for the given backend.
    pub fn generate_accept_rule(
        backend: FirewallBackend,
        source_ip: &str,
        port: u16,
        protocol: KnockProtocol,
        options: &FirewallRuleOptions,
    ) -> String {
        let proto = protocol_str(protocol);
        let chain = options
            .chain
            .as_deref()
            .unwrap_or("INPUT");
        let table = options.table.as_deref().unwrap_or("filter");
        let comment = options
            .log_prefix
            .as_deref()
            .unwrap_or("sorng-knock");

        match backend {
            FirewallBackend::Iptables => {
                format!(
                    "iptables -A {} -s {} -p {} --dport {} -j ACCEPT -m comment --comment \"{}\"",
                    chain, source_ip, proto, port, comment
                )
            }
            FirewallBackend::Nftables => {
                format!(
                    "nft add rule inet {} {} ip saddr {} {} dport {} accept comment \"{}\"",
                    table, chain.to_lowercase(), source_ip, proto, port, comment
                )
            }
            FirewallBackend::Pf => {
                format!(
                    "echo 'pass in on egress proto {} from {} to any port {}' | pfctl -a sorng-knock -f -",
                    proto, source_ip, port
                )
            }
            FirewallBackend::WindowsFirewall => {
                format!(
                    "netsh advfirewall firewall add rule name=\"{}\" dir=in action=allow protocol={} localport={} remoteip={}",
                    comment, proto, port, source_ip
                )
            }
            FirewallBackend::Ufw => {
                format!("ufw allow from {} to any port {} proto {}", source_ip, port, proto)
            }
            FirewallBackend::Firewalld => {
                let zone = options.chain.as_deref().unwrap_or("public");
                format!(
                    "firewall-cmd --zone={} --add-rich-rule='rule family=\"ipv4\" source address=\"{}\" port port=\"{}\" protocol=\"{}\" accept'",
                    zone, source_ip, port, proto
                )
            }
        }
    }

    /// Generates a DROP rule command for the given backend.
    pub fn generate_drop_rule(
        backend: FirewallBackend,
        port: u16,
        protocol: KnockProtocol,
        options: &FirewallRuleOptions,
    ) -> String {
        let proto = protocol_str(protocol);
        let chain = options.chain.as_deref().unwrap_or("INPUT");
        let table = options.table.as_deref().unwrap_or("filter");
        let comment = options.log_prefix.as_deref().unwrap_or("sorng-knock");

        match backend {
            FirewallBackend::Iptables => {
                format!(
                    "iptables -A {} -p {} --dport {} -j DROP -m comment --comment \"{}\"",
                    chain, proto, port, comment
                )
            }
            FirewallBackend::Nftables => {
                format!(
                    "nft add rule inet {} {} {} dport {} drop comment \"{}\"",
                    table, chain.to_lowercase(), proto, port, comment
                )
            }
            FirewallBackend::Pf => {
                format!(
                    "echo 'block in on egress proto {} from any to any port {}' | pfctl -a sorng-knock -f -",
                    proto, port
                )
            }
            FirewallBackend::WindowsFirewall => {
                format!(
                    "netsh advfirewall firewall add rule name=\"{}\" dir=in action=block protocol={} localport={}",
                    comment, proto, port
                )
            }
            FirewallBackend::Ufw => {
                format!("ufw deny proto {} to any port {}", proto, port)
            }
            FirewallBackend::Firewalld => {
                let zone = options.chain.as_deref().unwrap_or("public");
                format!(
                    "firewall-cmd --zone={} --add-rich-rule='rule family=\"ipv4\" port port=\"{}\" protocol=\"{}\" drop'",
                    zone, port, proto
                )
            }
        }
    }

    /// Generates command to remove a specific rule.
    pub fn generate_remove_rule(
        backend: FirewallBackend,
        source_ip: &str,
        port: u16,
        protocol: KnockProtocol,
        options: &FirewallRuleOptions,
    ) -> String {
        let proto = protocol_str(protocol);
        let chain = options.chain.as_deref().unwrap_or("INPUT");
        let table = options.table.as_deref().unwrap_or("filter");
        let comment = options.log_prefix.as_deref().unwrap_or("sorng-knock");

        match backend {
            FirewallBackend::Iptables => {
                format!(
                    "iptables -D {} -s {} -p {} --dport {} -j ACCEPT -m comment --comment \"{}\"",
                    chain, source_ip, proto, port, comment
                )
            }
            FirewallBackend::Nftables => {
                // nft requires handle; use a grep+delete approach
                format!(
                    "nft -a list chain inet {} {} | grep 'dport {}' | grep '{}' | awk '{{print $NF}}' | xargs -I{{}} nft delete rule inet {} {} handle {{}}",
                    table, chain.to_lowercase(), port, source_ip, table, chain.to_lowercase()
                )
            }
            FirewallBackend::Pf => {
                format!("pfctl -a sorng-knock -F rules")
            }
            FirewallBackend::WindowsFirewall => {
                format!(
                    "netsh advfirewall firewall delete rule name=\"{}\" protocol={} localport={} remoteip={}",
                    comment, proto, port, source_ip
                )
            }
            FirewallBackend::Ufw => {
                format!("ufw delete allow from {} to any port {} proto {}", source_ip, port, proto)
            }
            FirewallBackend::Firewalld => {
                let zone = options.chain.as_deref().unwrap_or("public");
                format!(
                    "firewall-cmd --zone={} --remove-rich-rule='rule family=\"ipv4\" source address=\"{}\" port port=\"{}\" protocol=\"{}\" accept'",
                    zone, source_ip, port, proto
                )
            }
        }
    }

    /// Generates command + sleep + remove command for timed access.
    pub fn generate_timed_rule(
        backend: FirewallBackend,
        source_ip: &str,
        port: u16,
        protocol: KnockProtocol,
        expire_seconds: u64,
        options: &FirewallRuleOptions,
    ) -> String {
        let add_cmd = Self::generate_accept_rule(backend, source_ip, port, protocol, options);
        let rm_cmd = Self::generate_remove_rule(backend, source_ip, port, protocol, options);
        format!("{} && sleep {} && {}", add_cmd, expire_seconds, rm_cmd)
    }

    /// Generates a series of commands that create iptables/nft chains for multi-stage knock detection.
    pub fn generate_knock_chain(
        backend: FirewallBackend,
        sequence: &KnockSequence,
        options: &FirewallRuleOptions,
    ) -> Vec<String> {
        let mut cmds = Vec::new();
        let table = options.table.as_deref().unwrap_or("filter");
        let base_name = sequence
            .name
            .replace(|c: char| !c.is_alphanumeric() && c != '_', "_");

        match backend {
            FirewallBackend::Iptables => {
                // Create chains for each knock stage
                for (i, _step) in sequence.steps.iter().enumerate() {
                    let chain_name = format!("KNOCK_{}_{}", base_name, i + 1);
                    cmds.push(format!("iptables -N {}", chain_name));
                }

                // Gate 1: first knock port -> add to recent list, jump to stage 2
                for (i, step) in sequence.steps.iter().enumerate() {
                    let chain_name = format!("KNOCK_{}_{}", base_name, i + 1);
                    let proto = protocol_str(step.protocol);

                    if i == 0 {
                        // Entry: match first port in INPUT, mark with recent module
                        cmds.push(format!(
                            "iptables -A INPUT -p {} --dport {} -m recent --name KNOCK_{}_1 --set -j {}",
                            proto, step.port, base_name, chain_name
                        ));
                    } else {
                        // Subsequent stages: check previous stage was seen, then mark current
                        let prev_name = format!("KNOCK_{}_{}", base_name, i);
                        cmds.push(format!(
                            "iptables -A {} -m recent --name {} --rcheck --seconds {} -p {} --dport {} -m recent --name {} --set -j {}",
                            prev_name,
                            format!("KNOCK_{}_{}", base_name, i),
                            sequence.timeout_ms / 1000,
                            proto,
                            step.port,
                            format!("KNOCK_{}_{}", base_name, i + 1),
                            chain_name
                        ));
                    }
                }

                // Final rule: if all stages completed, ACCEPT on target port
                let final_chain = format!(
                    "KNOCK_{}_{}",
                    base_name,
                    sequence.steps.len()
                );
                let target_proto = protocol_str(sequence.target_protocol);
                cmds.push(format!(
                    "iptables -A {} -m recent --name {} --rcheck --seconds {} -p {} --dport {} -j ACCEPT",
                    final_chain,
                    format!("KNOCK_{}_{}", base_name, sequence.steps.len()),
                    sequence.timeout_ms / 1000,
                    target_proto,
                    sequence.target_port
                ));
            }
            FirewallBackend::Nftables => {
                // Create a named set and chain for the knock sequence
                cmds.push(format!(
                    "nft add chain inet {} knock_{}",
                    table, base_name
                ));

                for (i, step) in sequence.steps.iter().enumerate() {
                    let proto = protocol_str(step.protocol);
                    let stage = i + 1;
                    // Create a set to track IPs at each stage
                    cmds.push(format!(
                        "nft add set inet {} knock_{}_stage{} {{ type ipv4_addr; flags timeout; timeout {}s; }}",
                        table, base_name, stage, sequence.timeout_ms / 1000
                    ));

                    if i == 0 {
                        cmds.push(format!(
                            "nft add rule inet {} knock_{} {} dport {} add @knock_{}_stage{} {{ ip saddr }}",
                            table, base_name, proto, step.port, base_name, stage
                        ));
                    } else {
                        cmds.push(format!(
                            "nft add rule inet {} knock_{} ip saddr @knock_{}_stage{} {} dport {} add @knock_{}_stage{} {{ ip saddr }}",
                            table, base_name, base_name, i, proto, step.port, base_name, stage
                        ));
                    }
                }

                // Final accept rule
                let target_proto = protocol_str(sequence.target_protocol);
                cmds.push(format!(
                    "nft add rule inet {} knock_{} ip saddr @knock_{}_stage{} {} dport {} accept",
                    table, base_name, base_name, sequence.steps.len(), target_proto, sequence.target_port
                ));
            }
            _ => {
                // For other backends, generate sequential accept rules as a simpler approach
                for step in &sequence.steps {
                    let proto = protocol_str(step.protocol);
                    cmds.push(format!(
                        "# knock stage: port {}/{}",
                        step.port, proto
                    ));
                }
                let target_proto = protocol_str(sequence.target_protocol);
                cmds.push(format!(
                    "# final: accept port {}/{}",
                    sequence.target_port, target_proto
                ));
            }
        }

        cmds
    }

    /// Generates a LOG rule for the given backend.
    pub fn generate_log_rule(
        backend: FirewallBackend,
        port: u16,
        protocol: KnockProtocol,
        prefix: &str,
    ) -> String {
        let proto = protocol_str(protocol);
        match backend {
            FirewallBackend::Iptables => {
                format!(
                    "iptables -A INPUT -p {} --dport {} -j LOG --log-prefix \"{}\"",
                    proto, port, prefix
                )
            }
            FirewallBackend::Nftables => {
                format!(
                    "nft add rule inet filter input {} dport {} log prefix \"{}\" accept",
                    proto, port, prefix
                )
            }
            FirewallBackend::Pf => {
                format!(
                    "echo 'pass in log on egress proto {} from any to any port {}' | pfctl -a sorng-knock -f -",
                    proto, port
                )
            }
            FirewallBackend::WindowsFirewall => {
                format!(
                    "netsh advfirewall set currentprofile logging droppedconnections enable && netsh advfirewall firewall add rule name=\"{}\" dir=in action=allow protocol={} localport={} enable=yes",
                    prefix, proto, port
                )
            }
            FirewallBackend::Ufw => {
                format!("ufw allow log proto {} to any port {}", proto, port)
            }
            FirewallBackend::Firewalld => {
                format!(
                    "firewall-cmd --add-rich-rule='rule family=\"ipv4\" port port=\"{}\" protocol=\"{}\" log prefix=\"{}\" level=\"info\" accept'",
                    port, proto, prefix
                )
            }
        }
    }

    /// Generates a backup command: iptables-save, nft list ruleset, etc.
    pub fn generate_backup_command(backend: FirewallBackend) -> String {
        match backend {
            FirewallBackend::Iptables => "iptables-save".to_string(),
            FirewallBackend::Nftables => "nft list ruleset".to_string(),
            FirewallBackend::Pf => "pfctl -sr".to_string(),
            FirewallBackend::WindowsFirewall => {
                "netsh advfirewall export \"firewall-backup.wfw\"".to_string()
            }
            FirewallBackend::Ufw => "ufw status verbose".to_string(),
            FirewallBackend::Firewalld => "firewall-cmd --runtime-to-permanent && firewall-cmd --list-all-zones".to_string(),
        }
    }

    /// Generates a restore command: iptables-restore, nft -f, etc.
    pub fn generate_restore_command(backend: FirewallBackend, backup_file: &str) -> String {
        match backend {
            FirewallBackend::Iptables => format!("iptables-restore < {}", backup_file),
            FirewallBackend::Nftables => format!("nft -f {}", backup_file),
            FirewallBackend::Pf => format!("pfctl -f {}", backup_file),
            FirewallBackend::WindowsFirewall => {
                format!("netsh advfirewall import \"{}\"", backup_file)
            }
            FirewallBackend::Ufw => {
                // ufw doesn't have a direct restore; reload from backup files
                format!("cp {} /etc/ufw/user.rules && ufw reload", backup_file)
            }
            FirewallBackend::Firewalld => {
                format!(
                    "cp {} /etc/firewalld/zones/public.xml && firewall-cmd --reload",
                    backup_file
                )
            }
        }
    }

    /// Flushes only knock-related rules in the given chain.
    pub fn generate_flush_knock_rules(backend: FirewallBackend, chain: &str) -> String {
        match backend {
            FirewallBackend::Iptables => {
                format!(
                    "iptables -L {} --line-numbers -n | grep 'sorng-knock' | awk '{{print $1}}' | sort -rn | xargs -I{{}} iptables -D {} {{}}",
                    chain, chain
                )
            }
            FirewallBackend::Nftables => {
                format!("nft flush chain inet filter {}", chain)
            }
            FirewallBackend::Pf => {
                "pfctl -a sorng-knock -F rules".to_string()
            }
            FirewallBackend::WindowsFirewall => {
                "netsh advfirewall firewall delete rule name=all dir=in remoteip=any | findstr \"sorng-knock\"".to_string()
            }
            FirewallBackend::Ufw => {
                format!("ufw status numbered | grep 'sorng-knock' | awk -F'[][]' '{{print $2}}' | sort -rn | xargs -I{{}} ufw --force delete {{}}")
            }
            FirewallBackend::Firewalld => {
                format!(
                    "firewall-cmd --list-rich-rules | grep 'sorng-knock' | while read rule; do firewall-cmd --remove-rich-rule=\"$rule\"; done"
                )
            }
        }
    }

    /// Generates a ufw allow/deny rule.
    pub fn generate_ufw_rule(
        action: &str,
        port: u16,
        protocol: KnockProtocol,
        source_ip: Option<&str>,
    ) -> String {
        let proto = protocol_str(protocol);
        match source_ip {
            Some(ip) => format!("ufw {} from {} to any port {} proto {}", action, ip, port, proto),
            None => format!("ufw {} proto {} to any port {}", action, proto, port),
        }
    }

    /// Generates a firewall-cmd rule for a given zone.
    pub fn generate_firewalld_rule(
        action: &str,
        port: u16,
        protocol: KnockProtocol,
        zone: &str,
    ) -> String {
        let proto = protocol_str(protocol);
        match action {
            "accept" | "allow" => {
                format!(
                    "firewall-cmd --zone={} --add-port={}/{}",
                    zone, port, proto
                )
            }
            "drop" | "deny" | "reject" => {
                format!(
                    "firewall-cmd --zone={} --add-rich-rule='rule family=\"ipv4\" port port=\"{}\" protocol=\"{}\" {}'",
                    zone, port, proto, action
                )
            }
            _ => {
                format!(
                    "firewall-cmd --zone={} --add-rich-rule='rule family=\"ipv4\" port port=\"{}\" protocol=\"{}\" {}'",
                    zone, port, proto, action
                )
            }
        }
    }

    /// Generates a netsh advfirewall command for Windows Firewall.
    pub fn generate_windows_rule(
        action: &str,
        name: &str,
        port: u16,
        protocol: KnockProtocol,
        direction: FirewallDirection,
        source_ip: Option<&str>,
    ) -> String {
        let proto = protocol_str(protocol);
        let dir = match direction {
            FirewallDirection::Inbound => "in",
            FirewallDirection::Outbound => "out",
            FirewallDirection::Forward => "in",
        };
        let fw_action = match action {
            "accept" | "allow" => "allow",
            "drop" | "block" => "block",
            _ => action,
        };

        let mut cmd = format!(
            "netsh advfirewall firewall add rule name=\"{}\" dir={} action={} protocol={} localport={}",
            name, dir, fw_action, proto, port
        );
        if let Some(ip) = source_ip {
            cmd.push_str(&format!(" remoteip={}", ip));
        }
        cmd
    }

    /// Generates pf anchor content from a list of firewall rules.
    pub fn generate_pf_anchor(name: &str, rules: &[FirewallRule]) -> String {
        let mut lines = Vec::new();
        lines.push(format!("# Anchor: {}", name));

        for rule in rules {
            let proto = protocol_str(rule.protocol);
            let action = match rule.action {
                FirewallAction::Accept => "pass",
                FirewallAction::Drop => "block drop",
                FirewallAction::Reject => "block return",
                FirewallAction::Log => "pass log",
            };
            let direction = match rule.direction {
                FirewallDirection::Inbound => "in",
                FirewallDirection::Outbound => "out",
                FirewallDirection::Forward => "in",
            };

            let from = rule
                .source_ip
                .as_deref()
                .unwrap_or("any");
            let to_ip = rule
                .destination_ip
                .as_deref()
                .unwrap_or("any");

            let port_clause = if rule.port > 0 {
                format!(" port {}", rule.port)
            } else {
                String::new()
            };

            lines.push(format!(
                "{} {} on egress proto {} from {} to {}{}",
                action, direction, proto, from, to_ip, port_clause
            ));
        }

        lines.join("\n")
    }
}

/// Helper: converts KnockProtocol to lowercase string for commands.
fn protocol_str(protocol: KnockProtocol) -> &'static str {
    match protocol {
        KnockProtocol::Tcp => "tcp",
        KnockProtocol::Udp => "udp",
    }
}
