//! # nftables — nft wrapper
//!
//! Manages nftables tables, chains, sets, maps, and rules. Supports
//! atomic ruleset replacement and the JSON API.

use crate::types::*;

/// Build `nft list ruleset` arguments.
pub fn build_list_ruleset_args(family: Option<&str>) -> Vec<String> {
    let mut args = vec!["list".to_string(), "ruleset".to_string()];
    if let Some(f) = family {
        args.insert(0, f.to_string());
    }
    args
}

/// Build `nft list tables` arguments.
pub fn build_list_tables_args() -> Vec<String> {
    vec!["list".to_string(), "tables".to_string()]
}

/// Build `nft add table` arguments.
pub fn build_add_table_args(family: &str, name: &str) -> Vec<String> {
    vec![
        "add".to_string(),
        "table".to_string(),
        family.to_string(),
        name.to_string(),
    ]
}

/// Build `nft add chain` arguments.
pub fn build_add_chain_args(
    family: &str,
    table: &str,
    chain: &str,
    chain_type: Option<&str>,
    hook: Option<&str>,
    priority: Option<i32>,
) -> Vec<String> {
    let mut args = vec![
        "add".to_string(),
        "chain".to_string(),
        family.to_string(),
        table.to_string(),
        chain.to_string(),
    ];
    if let (Some(ct), Some(h), Some(p)) = (chain_type, hook, priority) {
        args.push(format!("{{ type {} hook {} priority {}; }}", ct, h, p));
    }
    args
}

/// Build `nft add rule` arguments.
pub fn build_add_rule_args(family: &str, table: &str, chain: &str, rule_expr: &str) -> Vec<String> {
    vec![
        "add".to_string(),
        "rule".to_string(),
        family.to_string(),
        table.to_string(),
        chain.to_string(),
        rule_expr.to_string(),
    ]
}

/// Build `nft -j list ruleset` for JSON output.
pub fn build_json_list_args() -> Vec<String> {
    vec!["-j".to_string(), "list".to_string(), "ruleset".to_string()]
}

/// Build `nft flush ruleset` arguments.
pub fn build_flush_ruleset_args() -> Vec<String> {
    vec!["flush".to_string(), "ruleset".to_string()]
}

/// Parse nft list tables output.
///
/// Each line of `nft list tables` looks like:
///   table inet filter
///   table ip nat
pub fn parse_tables_output(output: &str) -> Vec<NftTable> {
    output
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            let rest = trimmed.strip_prefix("table ")?;
            let parts: Vec<&str> = rest.splitn(2, ' ').collect();
            if parts.len() < 2 {
                return None;
            }
            let family = match parts[0] {
                "ip" => NftFamily::Ip,
                "ip6" => NftFamily::Ip6,
                "inet" => NftFamily::Inet,
                "arp" => NftFamily::Arp,
                "bridge" => NftFamily::Bridge,
                "netdev" => NftFamily::Netdev,
                _ => return None,
            };
            let name = parts[1].to_string();
            Some(NftTable {
                name,
                family,
                handle: 0,
                chains: Vec::new(),
                sets: Vec::new(),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn list_tables_args() {
        let args = build_list_tables_args();
        assert_eq!(args, vec!["list", "tables"]);
    }

    #[test]
    fn add_table() {
        let args = build_add_table_args("inet", "my_filter");
        assert!(args.contains(&"inet".to_string()));
        assert!(args.contains(&"my_filter".to_string()));
    }

    #[test]
    fn json_output() {
        let args = build_json_list_args();
        assert!(args.contains(&"-j".to_string()));
    }
}
