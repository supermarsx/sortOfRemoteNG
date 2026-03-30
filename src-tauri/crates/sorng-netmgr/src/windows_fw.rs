//! # windows_fw — Windows Firewall (netsh advfirewall) wrapper
//!
//! Manages Windows Firewall profiles, inbound/outbound rules,
//! program/port rules, and firewall state via `netsh advfirewall`.

use crate::types::*;

/// Build `netsh advfirewall show allprofiles` arguments.
pub fn build_show_all_profiles_args() -> Vec<String> {
    vec![
        "advfirewall".to_string(),
        "show".to_string(),
        "allprofiles".to_string(),
    ]
}

/// Build `netsh advfirewall show <profile>` arguments.
pub fn build_show_profile_args(profile: &str) -> Vec<String> {
    vec![
        "advfirewall".to_string(),
        "show".to_string(),
        profile.to_string(),
    ]
}

/// Build `netsh advfirewall firewall show rule name=all` arguments.
pub fn build_show_all_rules_args() -> Vec<String> {
    vec![
        "advfirewall".to_string(),
        "firewall".to_string(),
        "show".to_string(),
        "rule".to_string(),
        "name=all".to_string(),
    ]
}

/// Build `netsh advfirewall firewall add rule` arguments.
pub fn build_add_rule_args(
    name: &str,
    dir: &str,
    action: &str,
    protocol: Option<&str>,
    localport: Option<&str>,
    remoteip: Option<&str>,
    program: Option<&str>,
) -> Vec<String> {
    let mut args = vec![
        "advfirewall".to_string(),
        "firewall".to_string(),
        "add".to_string(),
        "rule".to_string(),
        format!("name={}", name),
        format!("dir={}", dir),
        format!("action={}", action),
    ];
    if let Some(proto) = protocol {
        args.push(format!("protocol={}", proto));
    }
    if let Some(lp) = localport {
        args.push(format!("localport={}", lp));
    }
    if let Some(rip) = remoteip {
        args.push(format!("remoteip={}", rip));
    }
    if let Some(prog) = program {
        args.push(format!("program={}", prog));
    }
    args
}

/// Build `netsh advfirewall firewall delete rule` arguments.
pub fn build_delete_rule_args(name: &str) -> Vec<String> {
    vec![
        "advfirewall".to_string(),
        "firewall".to_string(),
        "delete".to_string(),
        "rule".to_string(),
        format!("name={}", name),
    ]
}

/// Build `netsh advfirewall set <profile> state on/off`.
pub fn build_set_profile_state_args(profile: &str, enabled: bool) -> Vec<String> {
    vec![
        "advfirewall".to_string(),
        "set".to_string(),
        profile.to_string(),
        "state".to_string(),
        if enabled { "on" } else { "off" }.to_string(),
    ]
}

/// Parse `netsh advfirewall firewall show rule` output.
///
/// Each rule block is separated by blank lines, with key-value pairs:
/// ```text
/// Rule Name:                            Allow HTTP
/// Enabled:                              Yes
/// Direction:                            In
/// Profiles:                             Domain,Private
/// Action:                               Allow
/// Protocol:                             TCP
/// LocalPort:                            80
/// ```
pub fn parse_rules_output(output: &str) -> Vec<WinFwRule> {
    let mut rules = Vec::new();
    let mut current: std::collections::HashMap<String, String> = std::collections::HashMap::new();

    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with("---") {
            if !current.is_empty() {
                if let Some(rule) = build_win_fw_rule(&current) {
                    rules.push(rule);
                }
                current.clear();
            }
            continue;
        }
        if let Some((key, value)) = trimmed.split_once(':') {
            current.insert(
                key.trim().to_lowercase().replace(' ', ""),
                value.trim().to_string(),
            );
        }
    }
    if !current.is_empty() {
        if let Some(rule) = build_win_fw_rule(&current) {
            rules.push(rule);
        }
    }

    rules
}

fn build_win_fw_rule(m: &std::collections::HashMap<String, String>) -> Option<WinFwRule> {
    let name = m.get("rulename")?.clone();
    let direction = match m.get("direction").map(|s| s.to_lowercase()).as_deref() {
        Some("in") => RuleDirection::Inbound,
        Some("out") => RuleDirection::Outbound,
        _ => RuleDirection::Inbound,
    };
    let action = match m.get("action").map(|s| s.to_lowercase()).as_deref() {
        Some("allow") => FirewallVerdict::Accept,
        Some("block") => FirewallVerdict::Drop,
        _ => FirewallVerdict::Drop,
    };
    let enabled = m
        .get("enabled")
        .map(|s| s.to_lowercase() == "yes")
        .unwrap_or(false);
    let profiles: Vec<WinFwProfile> = m
        .get("profiles")
        .map(|s| {
            s.split(',')
                .filter_map(|p| match p.trim().to_lowercase().as_str() {
                    "domain" => Some(WinFwProfile::Domain),
                    "private" => Some(WinFwProfile::Private),
                    "public" => Some(WinFwProfile::Public),
                    _ => None,
                })
                .collect()
        })
        .unwrap_or_default();

    Some(WinFwRule {
        name: name.clone(),
        display_name: m
            .get("displayname")
            .cloned()
            .unwrap_or_else(|| name.clone()),
        description: m.get("description").cloned(),
        direction,
        action,
        enabled,
        profiles,
        program: m.get("program").cloned().filter(|s| s != "Any"),
        service: m.get("service").cloned().filter(|s| s != "Any"),
        protocol: m.get("protocol").cloned().filter(|s| s != "Any"),
        local_port: m.get("localport").cloned().filter(|s| s != "Any"),
        remote_port: m.get("remoteport").cloned().filter(|s| s != "Any"),
        local_address: m.get("localip").cloned().filter(|s| s != "Any"),
        remote_address: m.get("remoteip").cloned().filter(|s| s != "Any"),
        icmp_type: None,
        group: m.get("grouping").cloned().filter(|s| !s.is_empty()),
        interface_types: m
            .get("interfacetypes")
            .map(|s| s.split(',').map(|p| p.trim().to_string()).collect())
            .unwrap_or_default(),
        edge_traversal: m
            .get("edgetraversal")
            .map(|s| s.to_lowercase() == "yes")
            .unwrap_or(false),
    })
}

/// Parse `netsh advfirewall show allprofiles` output.
///
/// Output contains blocks per profile:
/// ```text
/// Domain Profile Settings:
/// State                                 ON
/// Firewall Policy                       BlockInbound,AllowOutbound
/// ...
/// Private Profile Settings:
/// ...
/// Public Profile Settings:
/// ...
/// ```
pub fn parse_profiles_output(output: &str) -> Vec<WinFwProfileStatus> {
    let mut profiles = Vec::new();
    let mut current_profile: Option<WinFwProfile> = None;
    let mut fields: std::collections::HashMap<String, String> = std::collections::HashMap::new();

    for line in output.lines() {
        let trimmed = line.trim();
        let lower = trimmed.to_lowercase();

        // Detect profile header
        if lower.contains("profile settings") {
            // Flush previous profile
            if let Some(profile) = current_profile.take() {
                profiles.push(build_win_fw_profile(profile, &fields));
                fields.clear();
            }
            if lower.starts_with("domain") {
                current_profile = Some(WinFwProfile::Domain);
            } else if lower.starts_with("private") {
                current_profile = Some(WinFwProfile::Private);
            } else if lower.starts_with("public") {
                current_profile = Some(WinFwProfile::Public);
            }
            continue;
        }

        if trimmed.is_empty() || trimmed.starts_with("---") {
            continue;
        }

        if current_profile.is_some() {
            // Fields are often aligned with spaces: "State                ON"
            let parts: Vec<&str> = trimmed.splitn(2, char::is_whitespace).collect();
            if parts.len() == 2 {
                fields.insert(parts[0].trim().to_lowercase(), parts[1].trim().to_string());
            } else if let Some((k, v)) = trimmed.split_once(':') {
                fields.insert(k.trim().to_lowercase(), v.trim().to_string());
            }
        }
    }

    if let Some(profile) = current_profile {
        profiles.push(build_win_fw_profile(profile, &fields));
    }

    profiles
}

fn build_win_fw_profile(
    profile: WinFwProfile,
    fields: &std::collections::HashMap<String, String>,
) -> WinFwProfileStatus {
    let enabled = fields
        .get("state")
        .map(|s| s.to_lowercase().contains("on"))
        .unwrap_or(false);

    let policy = fields
        .get("firewallpolicy")
        .or_else(|| fields.get("firewall"))
        .cloned()
        .unwrap_or_default()
        .to_lowercase();

    let default_inbound = if policy.contains("allowinbound") {
        FirewallVerdict::Accept
    } else {
        FirewallVerdict::Drop
    };
    let default_outbound = if policy.contains("blockoutbound") {
        FirewallVerdict::Drop
    } else {
        FirewallVerdict::Accept
    };

    let log_allowed = fields
        .get("logallowedconnections")
        .map(|s| s.to_lowercase().contains("enable"))
        .unwrap_or(false);
    let log_dropped = fields
        .get("logdroppedconnections")
        .map(|s| s.to_lowercase().contains("enable"))
        .unwrap_or(false);
    let log_file = fields.get("filename").cloned();
    let log_max_size_kb = fields
        .get("maxfilesize")
        .and_then(|s| s.parse::<u32>().ok());
    let notification = fields
        .get("inboundusernotification")
        .map(|s| s.to_lowercase().contains("enable"))
        .unwrap_or(false);
    let unicast_response = fields
        .get("unicastresponsetomulticast")
        .map(|s| s.to_lowercase().contains("enable"))
        .unwrap_or(true);

    WinFwProfileStatus {
        profile,
        enabled,
        default_inbound,
        default_outbound,
        log_allowed,
        log_dropped,
        log_file,
        log_max_size_kb,
        notification,
        unicast_response,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn show_all_profiles() {
        let args = build_show_all_profiles_args();
        assert!(args.contains(&"allprofiles".to_string()));
    }

    #[test]
    fn add_rule_with_port() {
        let args = build_add_rule_args(
            "Allow HTTP",
            "in",
            "allow",
            Some("tcp"),
            Some("80"),
            None,
            None,
        );
        assert!(args.contains(&"name=Allow HTTP".to_string()));
        assert!(args.contains(&"protocol=tcp".to_string()));
        assert!(args.contains(&"localport=80".to_string()));
    }

    #[test]
    fn set_profile_state() {
        let on = build_set_profile_state_args("domainprofile", true);
        assert!(on.contains(&"on".to_string()));
        let off = build_set_profile_state_args("publicprofile", false);
        assert!(off.contains(&"off".to_string()));
    }
}
