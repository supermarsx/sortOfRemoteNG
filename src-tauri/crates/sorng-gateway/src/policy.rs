//! # Policy Engine
//!
//! Access control policy evaluation engine. Evaluates whether a connection
//! attempt is allowed based on user, target, time, and connection limit rules.

use crate::types::*;
use chrono::Utc;
use std::collections::HashMap;
use std::net::IpAddr;

/// Checks whether an IP address falls within a CIDR range.
fn ip_matches_cidr(ip_str: &str, cidr: &str) -> bool {
    let parts: Vec<&str> = cidr.split('/').collect();
    if parts.len() != 2 {
        return false;
    }
    let network: IpAddr = match parts[0].parse() {
        Ok(ip) => ip,
        Err(_) => return false,
    };
    let prefix_len: u32 = match parts[1].parse() {
        Ok(p) => p,
        Err(_) => return false,
    };
    let ip: IpAddr = match ip_str.parse() {
        Ok(ip) => ip,
        Err(_) => return false,
    };
    match (ip, network) {
        (IpAddr::V4(ip), IpAddr::V4(net)) => {
            if prefix_len > 32 {
                return false;
            }
            let mask = if prefix_len == 0 {
                0u32
            } else {
                !0u32 << (32 - prefix_len)
            };
            u32::from(ip) & mask == u32::from(net) & mask
        }
        (IpAddr::V6(ip), IpAddr::V6(net)) => {
            if prefix_len > 128 {
                return false;
            }
            let mask = if prefix_len == 0 {
                0u128
            } else {
                !0u128 << (128 - prefix_len)
            };
            u128::from(ip) & mask == u128::from(net) & mask
        }
        _ => false,
    }
}

/// Evaluates access policies to determine if a connection is allowed.
pub struct PolicyEngine {
    /// All policies indexed by policy ID, sorted by priority
    policies: HashMap<String, AccessPolicy>,
    /// Persistence directory
    data_dir: String,
}

impl PolicyEngine {
    pub fn new(data_dir: &str) -> Self {
        let mut engine = Self {
            policies: HashMap::new(),
            data_dir: data_dir.to_string(),
        };
        engine.load_from_disk();
        engine
    }

    /// Add a policy.
    pub fn add_policy(&mut self, policy: AccessPolicy) -> Result<(), String> {
        if self.policies.contains_key(&policy.id) {
            return Err("Policy with this ID already exists".to_string());
        }
        self.policies.insert(policy.id.clone(), policy);
        self.persist();
        Ok(())
    }

    /// Remove a policy.
    pub fn remove_policy(&mut self, policy_id: &str) -> Result<(), String> {
        self.policies.remove(policy_id).ok_or("Policy not found")?;
        self.persist();
        Ok(())
    }

    /// Update a policy.
    pub fn update_policy(&mut self, policy: AccessPolicy) -> Result<(), String> {
        if !self.policies.contains_key(&policy.id) {
            return Err("Policy not found".to_string());
        }
        self.policies.insert(policy.id.clone(), policy);
        self.persist();
        Ok(())
    }

    /// List all policies sorted by priority.
    pub fn list_policies(&self) -> Vec<&AccessPolicy> {
        let mut policies: Vec<&AccessPolicy> = self.policies.values().collect();
        policies.sort_by_key(|p| p.priority);
        policies
    }

    /// Evaluate policies for a connection attempt.
    /// Returns the action from the first matching policy, or Deny if no policies match.
    pub fn evaluate(
        &self,
        user_id: &str,
        target_addr: &str,
        protocol: GatewayProtocol,
        source_ip: &str,
    ) -> Result<PolicyAction, String> {
        let mut policies: Vec<&AccessPolicy> =
            self.policies.values().filter(|p| p.enabled).collect();
        policies.sort_by_key(|p| p.priority);

        for policy in policies {
            let user_match =
                self.match_user_conditions(&policy.user_conditions, user_id, source_ip);
            let target_match =
                self.match_target_conditions(&policy.target_conditions, target_addr, protocol);
            let time_match = self.match_time_conditions(&policy.time_conditions);

            if user_match && target_match && time_match {
                log::info!(
                    "[POLICY] Policy '{}' matched for user={} target={} protocol={:?} → {:?}",
                    policy.name,
                    user_id,
                    target_addr,
                    protocol,
                    policy.action
                );
                return Ok(policy.action);
            }
        }

        // Default: deny if no policies match (secure-by-default)
        Ok(PolicyAction::Deny)
    }

    /// Check if user conditions match.
    fn match_user_conditions(
        &self,
        conditions: &[UserCondition],
        user_id: &str,
        source_ip: &str,
    ) -> bool {
        if conditions.is_empty() {
            return true; // No conditions = match all
        }
        // For group matching, assume we can get user groups from a function (stubbed here)
        fn get_user_groups(_user_id: &str) -> Vec<String> {
            log::warn!("get_user_groups: using placeholder — integrate with real user directory");
            vec!["users".to_string()]
        }
        let user_groups = get_user_groups(user_id);
        conditions.iter().any(|c| match c {
            UserCondition::UserId(id) => id == user_id,
            UserCondition::Group(group_pattern) => {
                // Support wildcard group patterns
                user_groups.iter().any(|g| {
                    if group_pattern.contains('*') {
                        // Simple glob matching: * matches any sequence of chars
                        let parts: Vec<&str> = group_pattern.split('*').collect();
                        if parts.len() == 2 {
                            g.starts_with(parts[0]) && g.ends_with(parts[1])
                        } else {
                            g == group_pattern
                        }
                    } else {
                        g == group_pattern
                    }
                })
            }
            UserCondition::AnyAuthenticated => true,
            UserCondition::SourceIp(cidr) => ip_matches_cidr(source_ip, cidr),
        })
    }

    /// Check if target conditions match.
    fn match_target_conditions(
        &self,
        conditions: &[TargetCondition],
        target_addr: &str,
        protocol: GatewayProtocol,
    ) -> bool {
        if conditions.is_empty() {
            return true;
        }
        conditions.iter().any(|c| match c {
            TargetCondition::Host(host) => target_addr.starts_with(host),
            TargetCondition::HostPort(host, port) => target_addr == format!("{}:{}", host, port),
            TargetCondition::Subnet(cidr) => {
                let target_ip = target_addr.split(':').next().unwrap_or("");
                ip_matches_cidr(target_ip, cidr)
            }
            TargetCondition::Protocol(proto) => *proto == protocol,
            TargetCondition::Any => true,
        })
    }

    /// Check if time conditions match.
    fn match_time_conditions(&self, conditions: &[TimeCondition]) -> bool {
        if conditions.is_empty() {
            return true;
        }
        let now = Utc::now();
        let current_hour = now.format("%H").to_string().parse::<u8>().unwrap_or(0);
        let current_day = now.format("%w").to_string().parse::<u8>().unwrap_or(0);

        conditions.iter().any(|tc| {
            let day_match = tc.days_of_week.is_empty() || tc.days_of_week.contains(&current_day);
            let hour_match = match (tc.start_hour, tc.end_hour) {
                (Some(start), Some(end)) => {
                    if start <= end {
                        current_hour >= start && current_hour <= end
                    } else {
                        // Overnight range (e.g., 22:00 - 06:00)
                        current_hour >= start || current_hour <= end
                    }
                }
                (Some(start), None) => current_hour >= start,
                (None, Some(end)) => current_hour <= end,
                (None, None) => true,
            };
            day_match && hour_match
        })
    }

    /// Get a policy by ID.
    pub fn get_policy(&self, policy_id: &str) -> Option<&AccessPolicy> {
        self.policies.get(policy_id)
    }

    /// Get the count of policies.
    pub fn policy_count(&self) -> usize {
        self.policies.len()
    }

    /// Get the count of enabled policies.
    pub fn enabled_policy_count(&self) -> usize {
        self.policies.values().filter(|p| p.enabled).count()
    }

    // ── Persistence ─────────────────────────────────────────────────

    fn persist(&self) {
        let path = std::path::Path::new(&self.data_dir).join("gateway_policies.json");
        if let Ok(json) = serde_json::to_string_pretty(&self.policies) {
            let _ = std::fs::create_dir_all(&self.data_dir);
            let _ = std::fs::write(path, json);
        }
    }

    fn load_from_disk(&mut self) {
        let path = std::path::Path::new(&self.data_dir).join("gateway_policies.json");
        if let Ok(data) = std::fs::read_to_string(path) {
            if let Ok(policies) = serde_json::from_str(&data) {
                self.policies = policies;
            }
        }
    }
}
