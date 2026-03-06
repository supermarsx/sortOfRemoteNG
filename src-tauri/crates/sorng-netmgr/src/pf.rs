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
    vec!["-t".to_string(), table.to_string(), "-T".to_string(), "show".to_string()]
}

/// Build `pfctl -t <table> -T add <addr>` arguments.
pub fn build_table_add_args(table: &str, address: &str) -> Vec<String> {
    vec!["-t".to_string(), table.to_string(), "-T".to_string(), "add".to_string(), address.to_string()]
}

/// Build `pfctl -t <table> -T delete <addr>` arguments.
pub fn build_table_delete_args(table: &str, address: &str) -> Vec<String> {
    vec!["-t".to_string(), table.to_string(), "-T".to_string(), "delete".to_string(), address.to_string()]
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
pub fn parse_info_output(_output: &str) -> Option<PfStatus> {
    // TODO: implement
    None
}

/// Parse `pfctl -t <table> -T show` output into addresses.
pub fn parse_table_entries(_output: &str) -> Vec<String> {
    // TODO: implement
    Vec::new()
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
