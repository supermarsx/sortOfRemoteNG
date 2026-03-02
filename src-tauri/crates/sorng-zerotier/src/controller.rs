//! # ZeroTier Controller API
//!
//! Self-hosted controller operations: create/manage networks,
//! authorize members, manage IP pools, configure DNS.

use crate::types::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Controller API configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ControllerConfig {
    pub base_url: String,
    pub authtoken: String,
    pub controller_address: String,
}

impl ControllerConfig {
    /// Create config for local controller.
    pub fn local(authtoken: String, port: u16) -> Self {
        Self {
            base_url: format!("http://127.0.0.1:{}", port),
            authtoken,
            controller_address: String::new(),
        }
    }
}

/// Build API path for controller network list.
pub fn networks_path(controller_address: &str) -> String {
    format!("controller/network")
}

/// Build API path for specific network.
pub fn network_path(network_id: &str) -> String {
    format!("controller/network/{}", network_id)
}

/// Build API path for network member list.
pub fn members_path(network_id: &str) -> String {
    format!("controller/network/{}/member", network_id)
}

/// Build API path for specific member.
pub fn member_path(network_id: &str, member_id: &str) -> String {
    format!("controller/network/{}/member/{}", network_id, member_id)
}

/// Network creation payload.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateNetworkPayload {
    pub name: String,
    pub private: bool,
    pub enable_broadcast: bool,
    pub multicast_limit: u32,
    pub v4_assign_mode: V4AssignMode,
    pub v6_assign_mode: V6AssignMode,
    pub routes: Vec<ZtRoute>,
    pub ip_assignment_pools: Vec<IpAssignmentPool>,
    pub dns: Option<ZtDnsConfig>,
    pub rules: Vec<ZtFlowRule>,
}

impl Default for CreateNetworkPayload {
    fn default() -> Self {
        Self {
            name: "New Network".to_string(),
            private: true,
            enable_broadcast: true,
            multicast_limit: 32,
            v4_assign_mode: V4AssignMode { zt: true },
            v6_assign_mode: V6AssignMode {
                zt: false,
                rfc4193: true,
                six_plane: false,
            },
            routes: vec![ZtRoute {
                target: "10.147.17.0/24".to_string(),
                via: None,
                flags: 0,
                metric: 0,
            }],
            ip_assignment_pools: vec![IpAssignmentPool {
                ip_range_start: "10.147.17.1".to_string(),
                ip_range_end: "10.147.17.254".to_string(),
            }],
            dns: None,
            rules: super::rules::default_allow_all(),
        }
    }
}

/// Serialize network creation payload.
pub fn serialize_create_network(payload: &CreateNetworkPayload) -> Result<String, String> {
    serde_json::to_string_pretty(payload)
        .map_err(|e| format!("Failed to serialize network payload: {}", e))
}

/// Member authorization payload.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthorizeMemberPayload {
    pub authorized: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ip_assignments: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub no_auto_assign_ips: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<Vec<u32>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<Vec<u32>>>,
}

impl AuthorizeMemberPayload {
    /// Simple authorize.
    pub fn authorize() -> Self {
        Self {
            authorized: true,
            name: None,
            description: None,
            ip_assignments: None,
            no_auto_assign_ips: None,
            capabilities: None,
            tags: None,
        }
    }

    /// Simple deauthorize.
    pub fn deauthorize() -> Self {
        Self {
            authorized: false,
            name: None,
            description: None,
            ip_assignments: None,
            no_auto_assign_ips: None,
            capabilities: None,
            tags: None,
        }
    }

    /// Authorize with static IP.
    pub fn authorize_with_ip(ip: &str) -> Self {
        Self {
            authorized: true,
            name: None,
            description: None,
            ip_assignments: Some(vec![ip.to_string()]),
            no_auto_assign_ips: Some(true),
            capabilities: None,
            tags: None,
        }
    }
}

/// Network update payload (partial update).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateNetworkPayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub private: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enable_broadcast: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub multicast_limit: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub v4_assign_mode: Option<V4AssignMode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub v6_assign_mode: Option<V6AssignMode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub routes: Option<Vec<ZtRoute>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ip_assignment_pools: Option<Vec<IpAssignmentPool>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dns: Option<ZtDnsConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rules: Option<Vec<ZtFlowRule>>,
}

/// Validate a network creation payload.
pub fn validate_create_network(payload: &CreateNetworkPayload) -> Vec<String> {
    let mut issues = Vec::new();

    if payload.name.is_empty() {
        issues.push("Network name cannot be empty".to_string());
    }

    if payload.multicast_limit == 0 {
        issues.push("Multicast limit should be > 0".to_string());
    }

    // Validate IP pools
    for pool in &payload.ip_assignment_pools {
        if pool.ip_range_start.is_empty() || pool.ip_range_end.is_empty() {
            issues.push("IP pool start and end cannot be empty".to_string());
        }
        // Basic validation: start should be <= end
        if pool.ip_range_start.parse::<std::net::Ipv4Addr>().is_err() {
            issues.push(format!("Invalid pool start IP: {}", pool.ip_range_start));
        }
        if pool.ip_range_end.parse::<std::net::Ipv4Addr>().is_err() {
            issues.push(format!("Invalid pool end IP: {}", pool.ip_range_end));
        }
    }

    // Validate routes
    for route in &payload.routes {
        if !route.target.contains('/') {
            issues.push(format!("Route target must be CIDR notation: {}", route.target));
        }
    }

    // Validate rules
    let rule_issues = super::rules::validate_rules(&payload.rules);
    issues.extend(rule_issues);

    issues
}

/// Generate common network presets.
pub fn preset_home_network() -> CreateNetworkPayload {
    CreateNetworkPayload {
        name: "Home Network".to_string(),
        private: true,
        enable_broadcast: true,
        multicast_limit: 32,
        v4_assign_mode: V4AssignMode { zt: true },
        v6_assign_mode: V6AssignMode {
            zt: false,
            rfc4193: true,
            six_plane: false,
        },
        routes: vec![ZtRoute {
            target: "10.147.17.0/24".to_string(),
            via: None,
            flags: 0,
            metric: 0,
        }],
        ip_assignment_pools: vec![IpAssignmentPool {
            ip_range_start: "10.147.17.1".to_string(),
            ip_range_end: "10.147.17.254".to_string(),
        }],
        dns: None,
        rules: super::rules::default_allow_all(),
    }
}

/// Generate business network preset with segmentation.
pub fn preset_business_network() -> CreateNetworkPayload {
    CreateNetworkPayload {
        name: "Business Network".to_string(),
        private: true,
        enable_broadcast: true,
        multicast_limit: 128,
        v4_assign_mode: V4AssignMode { zt: true },
        v6_assign_mode: V6AssignMode {
            zt: false,
            rfc4193: true,
            six_plane: false,
        },
        routes: vec![ZtRoute {
            target: "172.27.0.0/16".to_string(),
            via: None,
            flags: 0,
            metric: 0,
        }],
        ip_assignment_pools: vec![IpAssignmentPool {
            ip_range_start: "172.27.0.1".to_string(),
            ip_range_end: "172.27.255.254".to_string(),
        }],
        dns: None,
        rules: super::rules::allow_ip_only(),
    }
}

/// Parse controller network list response.
pub fn parse_network_ids(json: &str) -> Result<Vec<String>, String> {
    let ids: Vec<String> =
        serde_json::from_str(json).map_err(|e| format!("Failed to parse network list: {}", e))?;
    Ok(ids)
}

/// Parse controller network detail.
pub fn parse_controller_network(json: &str) -> Result<ZtControllerNetwork, String> {
    serde_json::from_str(json)
        .map_err(|e| format!("Failed to parse controller network: {}", e))
}

/// Parse controller member.
pub fn parse_controller_member(json: &str) -> Result<ZtControllerMember, String> {
    serde_json::from_str(json).map_err(|e| format!("Failed to parse controller member: {}", e))
}
