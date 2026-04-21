//! # pf — BSD/macOS Packet Filter wrapper
//!
//! Manages pf rulesets, tables, anchors, state tables, and statistics
//! via `pfctl` and `/etc/pf.conf`.

use crate::types::*;

/// Build `pfctl -sr` (show rules) arguments.
pub fn build_show_rules_args() -> Vec<String> {
    vec!["-sr".to_string()]
}

/// Build `pfctl -ss` (show state) arguments.
pub fn build_show_state_args() -> Vec<String> {
    vec!["-ss".to_string()]
}

/// Build `pfctl -si` (show info/stats) arguments.
pub fn build_show_info_args() -> Vec<String> {
    vec!["-si".to_string()]
}

/// Build `pfctl -t <table> -T show` arguments.
pub fn build_show_table_args(table: &str) -> Vec<String> {
    vec![
        "-t".to_string(),
        table.to_string(),
        "-T".to_string(),
        "show".to_string(),
    ]
}

/// Build `pfctl -t <table> -T add <addr>` arguments.
pub fn build_table_add_args(table: &str, address: &str) -> Vec<String> {
    vec![
        "-t".to_string(),
        table.to_string(),
        "-T".to_string(),
        "add".to_string(),
        address.to_string(),
    ]
}

/// Build `pfctl -t <table> -T delete <addr>` arguments.
pub fn build_table_delete_args(table: &str, address: &str) -> Vec<String> {
    vec![
        "-t".to_string(),
        table.to_string(),
        "-T".to_string(),
        "delete".to_string(),
        address.to_string(),
    ]
}

/// Build `pfctl -f /etc/pf.conf` (reload) arguments.
pub fn build_reload_args(conf_path: &str) -> Vec<String> {
    vec!["-f".to_string(), conf_path.to_string()]
}

/// Build `pfctl -e` (enable) arguments.
pub fn build_enable_args() -> Vec<String> {
    vec!["-e".to_string()]
}

/// Build `pfctl -d` (disable) arguments.
pub fn build_disable_args() -> Vec<String> {
    vec!["-d".to_string()]
}

/// Build `pfctl -a <anchor> -sr` arguments.
pub fn build_show_anchor_rules_args(anchor: &str) -> Vec<String> {
    vec!["-a".to_string(), anchor.to_string(), "-sr".to_string()]
}

/// Parse `pfctl -si` output into PfStatus.
///
/// `pfctl -si` outputs key-value pairs like:
///   Status: Enabled for 3 days
///   State Table     Total     Rate
///     current entries        42
///     searches           123456   100.0/s
///   Counters
///     match                  ...
pub fn parse_info_output(output: &str) -> Option<PfStatus> {
    if output.trim().is_empty() {
        return None;
    }

    let mut enabled = false;
    let mut states_current: u64 = 0;
    let mut states_searches: u64 = 0;
    let mut states_inserts: u64 = 0;
    let mut states_removals: u64 = 0;
    let mut debug_level = String::from("none");
    let mut passed_ipv4: u64 = 0;
    let mut passed_ipv6: u64 = 0;
    let mut blocked_ipv4: u64 = 0;
    let mut blocked_ipv6: u64 = 0;

    for line in output.lines() {
        let trimmed = line.trim();
        let lower = trimmed.to_lowercase();

        if lower.starts_with("status:") {
            enabled = lower.contains("enabled");
        } else if lower.starts_with("debug:") {
            debug_level = trimmed
                .split_once(':')
                .map(|(_, v)| v.trim().to_string())
                .unwrap_or_default();
        } else if lower.contains("current entries") {
            states_current = extract_first_number(trimmed);
        } else if lower.contains("searches") && !lower.contains("state") {
            states_searches = extract_first_number(trimmed);
        } else if lower.contains("inserts") {
            states_inserts = extract_first_number(trimmed);
        } else if lower.contains("removals") {
            states_removals = extract_first_number(trimmed);
        } else if lower.contains("passed") && lower.contains("ipv4") {
            passed_ipv4 = extract_first_number(trimmed);
        } else if lower.contains("passed") && lower.contains("ipv6") {
            passed_ipv6 = extract_first_number(trimmed);
        } else if lower.contains("blocked") && lower.contains("ipv4") {
            blocked_ipv4 = extract_first_number(trimmed);
        } else if lower.contains("blocked") && lower.contains("ipv6") {
            blocked_ipv6 = extract_first_number(trimmed);
        }
    }

    Some(PfStatus {
        enabled,
        running_since: None,
        states_current,
        states_searches,
        states_inserts,
        states_removals,
        debug_level,
        counters: PfCounters {
            passed_ipv4,
            passed_ipv6,
            blocked_ipv4,
            blocked_ipv6,
        },
    })
}

fn extract_first_number(s: &str) -> u64 {
    s.split_whitespace()
        .filter_map(|w| w.parse::<u64>().ok())
        .next()
        .unwrap_or(0)
}

/// Parse `pfctl -t <table> -T show` output into addresses.
///
/// Each line is an IP address or CIDR, possibly with leading whitespace.
pub fn parse_table_entries(output: &str) -> Vec<String> {
    output
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn show_rules() {
        let args = build_show_rules_args();
        assert_eq!(args, vec!["-sr"]);
    }

    #[test]
    fn table_add() {
        let args = build_table_add_args("bruteforce", "10.0.0.5");
        assert!(args.contains(&"add".to_string()));
        assert!(args.contains(&"10.0.0.5".to_string()));
    }

    #[test]
    fn enable_disable() {
        assert_eq!(build_enable_args(), vec!["-e"]);
        assert_eq!(build_disable_args(), vec!["-d"]);
    }
}
