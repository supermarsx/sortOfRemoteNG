//! Profile-owned VPN routing policy validation.
//!
//! Session targets never synthesize host routes. Providers receive either the
//! canonical full-tunnel prefixes or the explicit split-tunnel CIDRs stored on
//! the VPN profile itself.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::net::IpAddr;

const FULL_TUNNEL_SUBNETS: [&str; 2] = ["0.0.0.0/0", "::/0"];

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VpnRoutingMode {
    #[default]
    Full,
    Split,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct VpnRoutingPolicy {
    #[serde(default)]
    pub routing_mode: VpnRoutingMode,
    #[serde(default)]
    pub remote_subnets: Vec<String>,
}

impl VpnRoutingPolicy {
    /// Return the exact provider prefixes after validating the profile-owned
    /// policy. Error text identifies only the field/index and never echoes
    /// profile input.
    pub fn validated_remote_subnets(&self) -> Result<Vec<String>, String> {
        match self.routing_mode {
            VpnRoutingMode::Full => {
                if self.remote_subnets.iter().any(|value| {
                    let value = value.trim();
                    !value.is_empty() && !FULL_TUNNEL_SUBNETS.contains(&value)
                }) {
                    return Err(
                        "Full-tunnel VPN profiles cannot define custom remote_subnets; select split routing instead"
                            .to_string(),
                    );
                }
                Ok(FULL_TUNNEL_SUBNETS
                    .iter()
                    .map(|value| (*value).to_string())
                    .collect())
            }
            VpnRoutingMode::Split => {
                let mut result = Vec::new();
                let mut seen = HashSet::new();
                for (index, raw) in self.remote_subnets.iter().enumerate() {
                    let subnet = raw.trim();
                    validate_cidr(subnet).map_err(|reason| {
                        format!("remote_subnets item {} is invalid: {reason}", index + 1)
                    })?;
                    if is_default_route(subnet) {
                        return Err(format!(
                            "remote_subnets item {} is a default route; select full routing instead",
                            index + 1
                        ));
                    }
                    if seen.insert(subnet.to_string()) {
                        result.push(subnet.to_string());
                    }
                }
                if result.is_empty() {
                    return Err(
                        "Split-tunnel VPN profiles require at least one remote_subnets CIDR"
                            .to_string(),
                    );
                }
                Ok(result)
            }
        }
    }
}

fn validate_cidr(value: &str) -> Result<(), &'static str> {
    let (address, prefix) = value.split_once('/').ok_or("CIDR prefix is required")?;
    if address.is_empty() || prefix.is_empty() || prefix.contains('/') {
        return Err("CIDR syntax is malformed");
    }
    let address = address
        .parse::<IpAddr>()
        .map_err(|_| "address is not valid IPv4 or IPv6")?;
    let prefix = prefix.parse::<u8>().map_err(|_| "prefix is not a number")?;
    let maximum = if address.is_ipv4() { 32 } else { 128 };
    if prefix > maximum {
        return Err("prefix exceeds the address-family width");
    }
    Ok(())
}

fn is_default_route(value: &str) -> bool {
    matches!(value, "0.0.0.0/0" | "::/0")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn full_tunnel_uses_canonical_dual_stack_defaults() {
        let policy = VpnRoutingPolicy::default();
        assert_eq!(
            policy.validated_remote_subnets().unwrap(),
            ["0.0.0.0/0", "::/0"]
        );
    }

    #[test]
    fn split_tunnel_requires_valid_non_default_profile_cidrs() {
        let policy = VpnRoutingPolicy {
            routing_mode: VpnRoutingMode::Split,
            remote_subnets: vec![
                "10.20.0.0/16".to_string(),
                "2001:db8:42::/48".to_string(),
                "10.20.0.0/16".to_string(),
            ],
        };
        assert_eq!(
            policy.validated_remote_subnets().unwrap(),
            ["10.20.0.0/16", "2001:db8:42::/48"]
        );

        for remote_subnets in [
            vec![],
            vec!["10.0.0.0".to_string()],
            vec!["10.0.0.0/33".to_string()],
            vec!["0.0.0.0/0".to_string()],
        ] {
            assert!(VpnRoutingPolicy {
                routing_mode: VpnRoutingMode::Split,
                remote_subnets,
            }
            .validated_remote_subnets()
            .is_err());
        }
    }

    #[test]
    fn routing_validation_never_echoes_invalid_profile_input() {
        let secret_marker = "secret-hostname.example/24";
        let error = VpnRoutingPolicy {
            routing_mode: VpnRoutingMode::Split,
            remote_subnets: vec![secret_marker.to_string()],
        }
        .validated_remote_subnets()
        .unwrap_err();
        assert!(!error.contains(secret_marker));
    }
}
