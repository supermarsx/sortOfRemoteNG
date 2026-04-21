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
    vec![
        "--force".to_string(),
        "delete".to_string(),
        rule_number.to_string(),
    ]
}

/// Build `ufw default` arguments.
pub fn build_default_policy_args(policy: &str, direction: &str) -> Vec<String> {
    vec![
        "default".to_string(),
        policy.to_string(),
        direction.to_string(),
    ]
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
///
/// Example header:
/// ```text
/// Status: active
/// Logging: on (low)
/// Default: deny (incoming), allow (outgoing), disabled (routed)
/// New profiles: skip
///
/// To                         Action      From
/// --                         ------      ----
/// 22/tcp                     ALLOW IN    Anywhere
/// ```
pub fn parse_status_output(output: &str) -> Option<UfwStatus> {
    if output.trim().is_empty() {
        return None;
    }

    let mut enabled = false;
    let mut default_incoming = FirewallVerdict::Drop;
    let mut default_outgoing = FirewallVerdict::Accept;
    let mut default_routed = FirewallVerdict::Drop;
    let mut logging = UfwLogLevel::Off;
    let mut rules = Vec::new();
    let mut in_rules_section = false;
    let mut rule_number: u32 = 0;

    for line in output.lines() {
        let trimmed = line.trim();
        let lower = trimmed.to_lowercase();

        if lower.starts_with("status:") {
            enabled = lower.contains("active") && !lower.contains("inactive");
        } else if lower.starts_with("logging:") {
            let val = lower
                .split_once(':')
                .map(|(_, v)| v.trim().to_string())
                .unwrap_or_default();
            logging = if val.contains("full") {
                UfwLogLevel::Full
            } else if val.contains("high") {
                UfwLogLevel::High
            } else if val.contains("medium") {
                UfwLogLevel::Medium
            } else if val.contains("low") || val.starts_with("on") {
                UfwLogLevel::Low
            } else {
                UfwLogLevel::Off
            };
        } else if lower.starts_with("default:") {
            let val = lower
                .split_once(':')
                .map(|(_, v)| v.to_string())
                .unwrap_or_default();
            for segment in val.split(',') {
                let seg = segment.trim();
                if seg.contains("incoming") {
                    default_incoming = parse_ufw_verdict(seg);
                } else if seg.contains("outgoing") {
                    default_outgoing = parse_ufw_verdict(seg);
                } else if seg.contains("routed") {
                    default_routed = parse_ufw_verdict(seg);
                }
            }
        } else if trimmed.starts_with("--") {
            in_rules_section = true;
        } else if in_rules_section && !trimmed.is_empty() {
            if let Some(rule) = parse_ufw_rule_line(trimmed, &mut rule_number) {
                rules.push(rule);
            }
        }
    }

    Some(UfwStatus {
        enabled,
        default_incoming,
        default_outgoing,
        default_routed,
        logging,
        rules,
    })
}

fn parse_ufw_verdict(s: &str) -> FirewallVerdict {
    if s.contains("allow") {
        FirewallVerdict::Accept
    } else if s.contains("reject") {
        FirewallVerdict::Reject
    } else if s.contains("limit") {
        FirewallVerdict::Limit
    } else {
        FirewallVerdict::Drop
    }
}

fn parse_ufw_rule_line(line: &str, counter: &mut u32) -> Option<UfwRule> {
    // Format: "22/tcp                     ALLOW IN    Anywhere"
    //     or: "Anywhere                   DENY OUT    22/tcp"
    let parts: Vec<&str> = line.split_whitespace().collect();
    if parts.len() < 3 {
        return None;
    }

    *counter += 1;
    let v6 = line.contains("(v6)");

    // Find action position (ALLOW, DENY, REJECT, LIMIT)
    let (action_idx, action) =
        parts
            .iter()
            .enumerate()
            .find_map(|(i, p)| match p.to_uppercase().as_str() {
                "ALLOW" => Some((i, FirewallVerdict::Accept)),
                "DENY" => Some((i, FirewallVerdict::Drop)),
                "REJECT" => Some((i, FirewallVerdict::Reject)),
                "LIMIT" => Some((i, FirewallVerdict::Limit)),
                _ => None,
            })?;

    // Direction comes after action
    let direction = parts
        .get(action_idx + 1)
        .and_then(|d| match d.to_uppercase().as_str() {
            "IN" => Some(RuleDirection::Inbound),
            "OUT" => Some(RuleDirection::Outbound),
            "FWD" => Some(RuleDirection::Forward),
            _ => None,
        })
        .unwrap_or(RuleDirection::Inbound);

    let to_part = parts[..action_idx].join(" ");
    let from_start = if parts
        .get(action_idx + 1)
        .map(|d| ["IN", "OUT", "FWD"].contains(&d.to_uppercase().as_str()))
        .unwrap_or(false)
    {
        action_idx + 2
    } else {
        action_idx + 1
    };
    let from_part = parts[from_start..]
        .join(" ")
        .replace("(v6)", "")
        .trim()
        .to_string();

    // Extract port/protocol from "to" field
    let (port, protocol) = if to_part.contains('/') {
        let mut sp = to_part.splitn(2, '/');
        let port = sp.next().map(|s| s.to_string());
        let proto = sp.next().map(|s| s.to_string());
        (port, proto)
    } else {
        (None, None)
    };

    Some(UfwRule {
        number: *counter,
        action,
        direction,
        from: from_part,
        to: to_part,
        port,
        protocol,
        interface: None,
        comment: None,
        v6,
    })
}

/// Parse `ufw app list` output.
///
/// Example:
/// ```text
/// Available applications:
///   Apache
///   Apache Full
///   OpenSSH
/// ```
pub fn parse_app_list_output(output: &str) -> Vec<UfwAppProfile> {
    output
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.to_lowercase().starts_with("available") {
                return None;
            }
            Some(UfwAppProfile {
                name: trimmed.to_string(),
                title: trimmed.to_string(),
                description: String::new(),
                ports: String::new(),
            })
        })
        .collect()
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
