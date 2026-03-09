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
pub fn parse_save_output(_output: &str) -> Vec<IptablesChain> {
    // TODO: implement
    Vec::new()
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
