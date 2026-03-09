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
pub fn parse_rules_output(_output: &str) -> Vec<WinFwRule> {
    // TODO: implement
    Vec::new()
}

/// Parse `netsh advfirewall show allprofiles` output.
pub fn parse_profiles_output(_output: &str) -> Vec<WinFwProfileStatus> {
    // TODO: implement
    Vec::new()
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
