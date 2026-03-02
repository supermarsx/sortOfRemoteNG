//! # ZeroTier Flow Rules
//!
//! Build, validate, and manage ZeroTier network flow rules.
//! Supports the full flow rule language.

use crate::types::*;
use serde::{Deserialize, Serialize};

/// Rule builder for constructing flow rules.
#[derive(Debug, Clone)]
pub struct RuleBuilder {
    rules: Vec<ZtFlowRule>,
}

impl RuleBuilder {
    pub fn new() -> Self {
        Self { rules: Vec::new() }
    }

    /// Accept matching traffic.
    pub fn accept(mut self) -> Self {
        self.rules.push(ZtFlowRule {
            rule_type: "ACTION_ACCEPT".to_string(),
            not: None,
            or: None,
            zt: None,
            ethertype: None,
            mac: None,
            ip_protocol: None,
            ip_tos: None,
            port_range: None,
            id: None,
            value: None,
        });
        self
    }

    /// Drop matching traffic.
    pub fn drop(mut self) -> Self {
        self.rules.push(ZtFlowRule {
            rule_type: "ACTION_DROP".to_string(),
            not: None,
            or: None,
            zt: None,
            ethertype: None,
            mac: None,
            ip_protocol: None,
            ip_tos: None,
            port_range: None,
            id: None,
            value: None,
        });
        self
    }

    /// Match by ethertype (e.g., 0x0800 for IPv4, 0x86DD for IPv6).
    pub fn match_ethertype(mut self, ethertype: u16, negate: bool) -> Self {
        self.rules.push(ZtFlowRule {
            rule_type: "MATCH_ETHERTYPE".to_string(),
            not: if negate { Some(true) } else { None },
            or: None,
            zt: None,
            ethertype: Some(ethertype),
            mac: None,
            ip_protocol: None,
            ip_tos: None,
            port_range: None,
            id: None,
            value: None,
        });
        self
    }

    /// Match by IP protocol (e.g., 6=TCP, 17=UDP, 1=ICMP).
    pub fn match_ip_protocol(mut self, protocol: u8, negate: bool) -> Self {
        self.rules.push(ZtFlowRule {
            rule_type: "MATCH_IP_PROTOCOL".to_string(),
            not: if negate { Some(true) } else { None },
            or: None,
            zt: None,
            ethertype: None,
            mac: None,
            ip_protocol: Some(protocol),
            ip_tos: None,
            port_range: None,
            id: None,
            value: None,
        });
        self
    }

    /// Match source or destination port range.
    pub fn match_ip_dest_port_range(mut self, start: u16, end: u16) -> Self {
        self.rules.push(ZtFlowRule {
            rule_type: "MATCH_IP_DEST_PORT_RANGE".to_string(),
            not: None,
            or: None,
            zt: None,
            ethertype: None,
            mac: None,
            ip_protocol: None,
            ip_tos: None,
            port_range: Some(PortRange { start, end }),
            id: None,
            value: None,
        });
        self
    }

    /// Match source port range.
    pub fn match_ip_source_port_range(mut self, start: u16, end: u16) -> Self {
        self.rules.push(ZtFlowRule {
            rule_type: "MATCH_IP_SOURCE_PORT_RANGE".to_string(),
            not: None,
            or: None,
            zt: None,
            ethertype: None,
            mac: None,
            ip_protocol: None,
            ip_tos: None,
            port_range: Some(PortRange { start, end }),
            id: None,
            value: None,
        });
        self
    }

    /// Match source ZeroTier address.
    pub fn match_zt_source(mut self, address: &str) -> Self {
        self.rules.push(ZtFlowRule {
            rule_type: "MATCH_CHARACTERISTICS".to_string(),
            not: None,
            or: None,
            zt: Some(address.to_string()),
            ethertype: None,
            mac: None,
            ip_protocol: None,
            ip_tos: None,
            port_range: None,
            id: None,
            value: None,
        });
        self
    }

    /// Match by IP TOS (DSCP + ECN) with mask.
    pub fn match_ip_tos(mut self, mask: u8, value: u8) -> Self {
        self.rules.push(ZtFlowRule {
            rule_type: "MATCH_IP_TOS".to_string(),
            not: None,
            or: None,
            zt: None,
            ethertype: None,
            mac: None,
            ip_protocol: None,
            ip_tos: Some(IpTosMask { mask, value }),
            port_range: None,
            id: None,
            value: None,
        });
        self
    }

    /// Match by tag.
    pub fn match_tags_difference(mut self, tag_id: u32, max_diff: u32) -> Self {
        self.rules.push(ZtFlowRule {
            rule_type: "MATCH_TAGS_DIFFERENCE".to_string(),
            not: None,
            or: None,
            zt: None,
            ethertype: None,
            mac: None,
            ip_protocol: None,
            ip_tos: None,
            port_range: None,
            id: Some(tag_id),
            value: Some(max_diff),
        });
        self
    }

    /// Match by tag bitwise AND.
    pub fn match_tags_bitwise_and(mut self, tag_id: u32, value: u32) -> Self {
        self.rules.push(ZtFlowRule {
            rule_type: "MATCH_TAGS_BITWISE_AND".to_string(),
            not: None,
            or: None,
            zt: None,
            ethertype: None,
            mac: None,
            ip_protocol: None,
            ip_tos: None,
            port_range: None,
            id: Some(tag_id),
            value: Some(value),
        });
        self
    }

    /// Set OR flag on the last rule.
    pub fn or(mut self) -> Self {
        if let Some(last) = self.rules.last_mut() {
            last.or = Some(true);
        }
        self
    }

    /// Build the final rules list.
    pub fn build(self) -> Vec<ZtFlowRule> {
        self.rules
    }
}

/// Generate a default "allow all" rule set.
pub fn default_allow_all() -> Vec<ZtFlowRule> {
    RuleBuilder::new().accept().build()
}

/// Generate rules that allow only IPv4 and IPv6 traffic.
pub fn allow_ip_only() -> Vec<ZtFlowRule> {
    RuleBuilder::new()
        .match_ethertype(0x0800, true) // NOT IPv4
        .match_ethertype(0x86DD, true) // NOT IPv6
        .or()
        .drop()
        .accept()
        .build()
}

/// Generate rules that block specific ports.
pub fn block_ports(ports: &[u16]) -> Vec<ZtFlowRule> {
    let mut builder = RuleBuilder::new();

    for (i, port) in ports.iter().enumerate() {
        builder = builder.match_ip_dest_port_range(*port, *port);
        if i < ports.len() - 1 {
            builder = builder.or();
        }
    }

    builder = builder.drop().accept();
    builder.build()
}

/// Generate rules that allow only specific ports.
pub fn allow_only_ports(ports: &[u16]) -> Vec<ZtFlowRule> {
    let mut builder = RuleBuilder::new();

    for (i, port) in ports.iter().enumerate() {
        builder = builder.match_ip_dest_port_range(*port, *port);
        if i < ports.len() - 1 {
            builder = builder.or();
        }
    }

    builder = builder.accept().drop();
    builder.build()
}

/// Validate a set of flow rules.
pub fn validate_rules(rules: &[ZtFlowRule]) -> Vec<String> {
    let mut issues = Vec::new();

    let valid_types = [
        "ACTION_DROP",
        "ACTION_ACCEPT",
        "ACTION_TEE",
        "ACTION_WATCH",
        "ACTION_REDIRECT",
        "ACTION_BREAK",
        "MATCH_SOURCE_ZEROTIER_ADDRESS",
        "MATCH_DEST_ZEROTIER_ADDRESS",
        "MATCH_ETHERTYPE",
        "MATCH_MAC_SOURCE",
        "MATCH_MAC_DEST",
        "MATCH_IPV4_SOURCE",
        "MATCH_IPV4_DEST",
        "MATCH_IPV6_SOURCE",
        "MATCH_IPV6_DEST",
        "MATCH_IP_TOS",
        "MATCH_IP_PROTOCOL",
        "MATCH_IP_SOURCE_PORT_RANGE",
        "MATCH_IP_DEST_PORT_RANGE",
        "MATCH_CHARACTERISTICS",
        "MATCH_FRAME_SIZE_RANGE",
        "MATCH_RANDOM",
        "MATCH_TAGS_DIFFERENCE",
        "MATCH_TAGS_BITWISE_AND",
        "MATCH_TAGS_BITWISE_OR",
        "MATCH_TAGS_BITWISE_XOR",
        "MATCH_TAGS_EQUAL",
        "MATCH_TAG_SENDER",
        "MATCH_TAG_RECEIVER",
    ];

    for (i, rule) in rules.iter().enumerate() {
        if !valid_types.contains(&rule.rule_type.as_str()) {
            issues.push(format!("Rule {}: unknown type '{}'", i, rule.rule_type));
        }

        if let Some(ref pr) = rule.port_range {
            if pr.start > pr.end {
                issues.push(format!(
                    "Rule {}: port range start ({}) > end ({})",
                    i, pr.start, pr.end
                ));
            }
        }
    }

    // Check for rules that can never be reached
    let mut after_accept = false;
    for (i, rule) in rules.iter().enumerate() {
        if after_accept && !rule.rule_type.starts_with("MATCH_") {
            issues.push(format!(
                "Rule {}: action after unconditional ACCEPT may never execute",
                i
            ));
        }
        if rule.rule_type == "ACTION_ACCEPT"
            && (i == 0
                || !rules[..i]
                    .iter()
                    .any(|r| r.rule_type.starts_with("MATCH_")))
        {
            after_accept = true;
        }
    }

    issues
}

/// Serialize rules to the JSON format expected by the controller API.
pub fn serialize_rules(rules: &[ZtFlowRule]) -> Result<String, String> {
    serde_json::to_string_pretty(rules).map_err(|e| format!("Failed to serialize rules: {}", e))
}
