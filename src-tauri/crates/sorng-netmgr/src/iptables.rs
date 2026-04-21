//! # iptables — iptables / ip6tables wrapper
//!
//! Manages iptables tables, chains, and rules. Supports filter, nat,
//! mangle, raw, and security tables. Handles both IPv4 (iptables) and
//! IPv6 (ip6tables) through a unified interface.

use crate::types::*;

/// The iptables binary name for a given IP family.
pub fn binary_name(family: IpFamily) -> &'static str {
    match family {
        IpFamily::IPv4 => "iptables",
        IpFamily::IPv6 => "ip6tables",
        IpFamily::Both => "iptables",
    }
}

/// Build args for `iptables -L` (list all chains in a table).
pub fn build_list_args(table: &str, family: IpFamily) -> (String, Vec<String>) {
    (
        binary_name(family).to_string(),
        vec![
            "-t".to_string(),
            table.to_string(),
            "-L".to_string(),
            "-n".to_string(),
            "-v".to_string(),
            "--line-numbers".to_string(),
        ],
    )
}

/// Build args for `iptables -A` (append rule to chain).
pub fn build_append_rule_args(
    table: &str,
    chain: &str,
    rule_spec: &[String],
    family: IpFamily,
) -> (String, Vec<String>) {
    let mut args = vec![
        "-t".to_string(),
        table.to_string(),
        "-A".to_string(),
        chain.to_string(),
    ];
    args.extend_from_slice(rule_spec);
    (binary_name(family).to_string(), args)
}

/// Build args for `iptables -D` (delete rule).
pub fn build_delete_rule_args(
    table: &str,
    chain: &str,
    rule_num: u32,
    family: IpFamily,
) -> (String, Vec<String>) {
    (
        binary_name(family).to_string(),
        vec![
            "-t".to_string(),
            table.to_string(),
            "-D".to_string(),
            chain.to_string(),
            rule_num.to_string(),
        ],
    )
}

/// Build args for `iptables -N` (new chain).
pub fn build_new_chain_args(table: &str, chain: &str, family: IpFamily) -> (String, Vec<String>) {
    (
        binary_name(family).to_string(),
        vec![
            "-t".to_string(),
            table.to_string(),
            "-N".to_string(),
            chain.to_string(),
        ],
    )
}

/// Build args for `iptables -F` (flush chain / all).
pub fn build_flush_args(
    table: &str,
    chain: Option<&str>,
    family: IpFamily,
) -> (String, Vec<String>) {
    let mut args = vec!["-t".to_string(), table.to_string(), "-F".to_string()];
    if let Some(c) = chain {
        args.push(c.to_string());
    }
    (binary_name(family).to_string(), args)
}

/// Build args for `iptables-save`.
pub fn build_save_args(family: IpFamily) -> (String, Vec<String>) {
    let bin = match family {
        IpFamily::IPv4 => "iptables-save",
        IpFamily::IPv6 => "ip6tables-save",
        IpFamily::Both => "iptables-save",
    };
    (bin.to_string(), Vec::new())
}

/// Parse iptables-save output into chain/rule structures.
pub fn parse_save_output(output: &str) -> Vec<IptablesChain> {
    let mut chains: Vec<IptablesChain> = Vec::new();
    let mut current_table = IptablesTable::Filter;
    // Map chain name -> index in chains vec for the current table
    let mut chain_map: std::collections::HashMap<String, usize> = std::collections::HashMap::new();

    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        // Table declaration: *filter, *nat, etc.
        if let Some(table_name) = trimmed.strip_prefix('*') {
            current_table = match table_name {
                "filter" => IptablesTable::Filter,
                "nat" => IptablesTable::Nat,
                "mangle" => IptablesTable::Mangle,
                "raw" => IptablesTable::Raw,
                "security" => IptablesTable::Security,
                _ => IptablesTable::Filter,
            };
            chain_map.clear();
            continue;
        }

        // COMMIT line
        if trimmed == "COMMIT" {
            continue;
        }

        // Chain declaration: :INPUT ACCEPT [123:456]
        if let Some(rest) = trimmed.strip_prefix(':') {
            let parts: Vec<&str> = rest.splitn(3, ' ').collect();
            if parts.len() >= 2 {
                let chain_name = parts[0].to_string();
                let policy = match parts[1] {
                    "ACCEPT" => Some(FirewallVerdict::Accept),
                    "DROP" => Some(FirewallVerdict::Drop),
                    "REJECT" => Some(FirewallVerdict::Reject),
                    "-" => None,
                    _ => None,
                };
                let (packets, bytes) = if parts.len() > 2 {
                    parse_iptables_counters(parts[2])
                } else {
                    (0, 0)
                };
                let is_builtin = matches!(
                    chain_name.as_str(),
                    "INPUT" | "OUTPUT" | "FORWARD" | "PREROUTING" | "POSTROUTING"
                );
                let idx = chains.len();
                chain_map.insert(chain_name.clone(), idx);
                chains.push(IptablesChain {
                    name: chain_name,
                    table: current_table,
                    policy,
                    packets,
                    bytes,
                    is_builtin,
                    rules: Vec::new(),
                });
            }
            continue;
        }

        // Rule line: -A CHAIN ... or [packets:bytes] -A CHAIN ...
        let rule_line = trimmed;
        let (rule_pkts, rule_bytes, rest) = if rule_line.starts_with('[') {
            if let Some(bracket_end) = rule_line.find(']') {
                let counters = &rule_line[1..bracket_end];
                let (p, b) = parse_iptables_counters(&format!("[{}]", counters));
                (p, b, rule_line[bracket_end + 1..].trim())
            } else {
                (0, 0, rule_line)
            }
        } else {
            (0, 0, rule_line)
        };

        if let Some(after_a) = rest.strip_prefix("-A ") {
            let parts: Vec<&str> = after_a.splitn(2, ' ').collect();
            let chain_name = parts[0];
            let rule_spec = parts.get(1).unwrap_or(&"");

            if let Some(&idx) = chain_map.get(chain_name) {
                let rule_num = chains[idx].rules.len() as u32 + 1;
                let (target, protocol, source, destination, extra) =
                    parse_iptables_rule_spec(rule_spec);
                chains[idx].rules.push(IptablesRule {
                    num: rule_num,
                    target,
                    protocol,
                    opt: "--".to_string(),
                    source,
                    destination,
                    extra,
                    packets: rule_pkts,
                    bytes: rule_bytes,
                });
            }
        }
    }

    chains
}

/// Parse `[packets:bytes]` counter notation.
fn parse_iptables_counters(s: &str) -> (u64, u64) {
    let s = s.trim_start_matches('[').trim_end_matches(']');
    let mut parts = s.splitn(2, ':');
    let packets = parts.next().and_then(|p| p.parse().ok()).unwrap_or(0);
    let bytes = parts.next().and_then(|b| b.parse().ok()).unwrap_or(0);
    (packets, bytes)
}

/// Extract target, protocol, source, destination, extra from a rule spec string.
fn parse_iptables_rule_spec(spec: &str) -> (String, String, String, String, String) {
    let args: Vec<&str> = spec.split_whitespace().collect();
    let mut target = String::new();
    let mut protocol = "all".to_string();
    let mut source = "0.0.0.0/0".to_string();
    let mut destination = "0.0.0.0/0".to_string();
    let mut extra_parts: Vec<String> = Vec::new();
    let mut i = 0;

    while i < args.len() {
        match args[i] {
            "-j" | "--jump" => {
                if i + 1 < args.len() {
                    target = args[i + 1].to_string();
                    i += 2;
                } else {
                    i += 1;
                }
            }
            "-p" | "--protocol" => {
                if i + 1 < args.len() {
                    protocol = args[i + 1].to_string();
                    i += 2;
                } else {
                    i += 1;
                }
            }
            "-s" | "--source" => {
                if i + 1 < args.len() {
                    source = args[i + 1].to_string();
                    i += 2;
                } else {
                    i += 1;
                }
            }
            "-d" | "--destination" => {
                if i + 1 < args.len() {
                    destination = args[i + 1].to_string();
                    i += 2;
                } else {
                    i += 1;
                }
            }
            other => {
                extra_parts.push(other.to_string());
                i += 1;
            }
        }
    }

    (target, protocol, source, destination, extra_parts.join(" "))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn binary_names() {
        assert_eq!(binary_name(IpFamily::IPv4), "iptables");
        assert_eq!(binary_name(IpFamily::IPv6), "ip6tables");
    }

    #[test]
    fn list_args() {
        let (bin, args) = build_list_args("filter", IpFamily::IPv4);
        assert_eq!(bin, "iptables");
        assert!(args.contains(&"-L".to_string()));
        assert!(args.contains(&"filter".to_string()));
    }

    #[test]
    fn new_chain() {
        let (bin, args) = build_new_chain_args("filter", "MY_CHAIN", IpFamily::IPv6);
        assert_eq!(bin, "ip6tables");
        assert!(args.contains(&"-N".to_string()));
        assert!(args.contains(&"MY_CHAIN".to_string()));
    }
}
