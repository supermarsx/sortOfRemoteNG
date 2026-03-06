//! # ufw — Uncomplicated Firewall wrapper
//!
//! Manages UFW enable/disable, rules (allow/deny/reject/limit),
//! application profiles, default policies, and logging levels.

use crate::types::*;

/// Build `ufw status verbose` arguments.
pub fn build_status_args() -> Vec<String> {
    vec!["status".to_string(), "verbose".to_string()]
}

/// Build `ufw status numbered` for rule listing.
pub fn build_numbered_status_args() -> Vec<String> {
    vec!["status".to_string(), "numbered".to_string()]
}

/// Build `ufw allow` arguments.
pub fn build_allow_args(port: &str, protocol: Option<&str>, from: Option<&str>) -> Vec<String> {
    let mut args = vec!["allow".to_string()];
    if let Some(src) = from {
        args.push("from".to_string());
        args.push(src.to_string());
        args.push("to".to_string());
        args.push("any".to_string());
        args.push("port".to_string());
        args.push(port.to_string());
    } else {
        args.push(port.to_string());
    }
    if let Some(proto) = protocol {
        args.push(format!("proto {}", proto));
    }
    args
}

/// Build `ufw deny` arguments.
pub fn build_deny_args(port: &str) -> Vec<String> {
    vec!["deny".to_string(), port.to_string()]
}

/// Build `ufw delete` arguments (by rule number).
pub fn build_delete_rule_args(rule_number: u32) -> Vec<String> {
    vec!["--force".to_string(), "delete".to_string(), rule_number.to_string()]
}

/// Build `ufw default` arguments.
pub fn build_default_policy_args(policy: &str, direction: &str) -> Vec<String> {
    vec!["default".to_string(), policy.to_string(), direction.to_string()]
}

/// Build `ufw app list` arguments.
pub fn build_app_list_args() -> Vec<String> {
    vec!["app".to_string(), "list".to_string()]
}

/// Build `ufw enable/disable/reset` arguments.
pub fn build_toggle_args(action: &str) -> Vec<String> {
    vec!["--force".to_string(), action.to_string()]
}

/// Parse `ufw status verbose` output.
pub fn parse_status_output(_output: &str) -> Option<UfwStatus> {
    // TODO: implement
    None
}

/// Parse `ufw app list` output.
pub fn parse_app_list_output(_output: &str) -> Vec<UfwAppProfile> {
    // TODO: implement
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_args() {
        let args = build_status_args();
        assert_eq!(args, vec!["status", "verbose"]);
    }

    #[test]
    fn allow_simple() {
        let args = build_allow_args("22", None, None);
        assert!(args.contains(&"allow".to_string()));
        assert!(args.contains(&"22".to_string()));
    }

    #[test]
    fn allow_from_source() {
        let args = build_allow_args("80", None, Some("192.168.1.0/24"));
        assert!(args.contains(&"from".to_string()));
        assert!(args.contains(&"192.168.1.0/24".to_string()));
    }

    #[test]
    fn delete_with_force() {
        let args = build_delete_rule_args(3);
        assert!(args.contains(&"--force".to_string()));
        assert!(args.contains(&"3".to_string()));
    }
}
