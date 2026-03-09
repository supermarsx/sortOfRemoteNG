//! # profile — Network profile / location management
//!
//! Manages network profiles that bundle firewall rules, DNS configuration,
//! proxy settings, and interface configs for different locations
//! (office, home, coffee shop, VPN, etc.).

use crate::types::*;

/// Evaluate which profile should be active based on detection rules.
pub fn detect_profile(
    profiles: &[NetworkProfile],
    current_ssid: Option<&str>,
    current_subnet: Option<&str>,
) -> Option<String> {
    for profile in profiles {
        for rule in &profile.detect_rules {
            match rule.rule_type {
                DetectRuleType::Ssid => {
                    if current_ssid == Some(rule.value.as_str()) {
                        return Some(profile.id.clone());
                    }
                }
                DetectRuleType::Subnet => {
                    if current_subnet == Some(rule.value.as_str()) {
                        return Some(profile.id.clone());
                    }
                }
                _ => {}
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn make_profile(id: &str, ssid: Option<&str>, subnet: Option<&str>) -> NetworkProfile {
        let mut detect_rules = Vec::new();
        if let Some(s) = ssid {
            detect_rules.push(ProfileDetectRule {
                rule_type: DetectRuleType::Ssid,
                value: s.to_string(),
            });
        }
        if let Some(s) = subnet {
            detect_rules.push(ProfileDetectRule {
                rule_type: DetectRuleType::Subnet,
                value: s.to_string(),
            });
        }
        NetworkProfile {
            id: id.to_string(),
            name: id.to_string(),
            description: String::new(),
            detect_rules,
            firewall_zone: None,
            dns_servers: Vec::new(),
            proxy: None,
            auto_vpn: None,
            auto_connections: Vec::new(),
            active: false,
            priority: 0,
            created_at: Utc::now(),
        }
    }

    #[test]
    fn detect_by_ssid() {
        let profiles = vec![
            make_profile("home", Some("HomeWiFi"), None),
            make_profile("office", Some("CorpNet"), None),
        ];
        let result = detect_profile(&profiles, Some("CorpNet"), None);
        assert_eq!(result, Some("office".to_string()));
    }

    #[test]
    fn detect_by_subnet() {
        let profiles = vec![make_profile("vpn", None, Some("10.0.0.0/8"))];
        let result = detect_profile(&profiles, None, Some("10.0.0.0/8"));
        assert_eq!(result, Some("vpn".to_string()));
    }

    #[test]
    fn detect_none() {
        let profiles = vec![make_profile("home", Some("HomeWiFi"), None)];
        let result = detect_profile(&profiles, Some("Unknown"), None);
        assert!(result.is_none());
    }
}
