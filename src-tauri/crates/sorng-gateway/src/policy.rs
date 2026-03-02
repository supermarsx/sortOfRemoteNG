//! # Policy Engine
//!
//! Access control policy evaluation engine. Evaluates whether a connection
//! attempt is allowed based on user, target, time, and connection limit rules.

use crate::types::*;
use chrono::Utc;
use std::collections::HashMap;

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
        self.policies
            .remove(policy_id)
            .ok_or("Policy not found")?;
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
    /// Returns the action from the first matching policy, or Allow if no policies match.
    pub fn evaluate(
        &self,
        user_id: &str,
        target_addr: &str,
        protocol: GatewayProtocol,
        source_ip: &str,
    ) -> Result<PolicyAction, String> {
        let mut policies: Vec<&AccessPolicy> = self
            .policies
            .values()
            .filter(|p| p.enabled)
            .collect();
        policies.sort_by_key(|p| p.priority);

        for policy in policies {
            let user_match = self.match_user_conditions(&policy.user_conditions, user_id, source_ip);
            let target_match = self.match_target_conditions(&policy.target_conditions, target_addr, protocol);
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

        // Default: allow if no policies match
        Ok(PolicyAction::Allow)
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
        conditions.iter().any(|c| match c {
            UserCondition::UserId(id) => id == user_id,
            UserCondition::Group(_group) => {
                // Would integrate with team/group membership
                // For now, no group matching
                false
            }
            UserCondition::AnyAuthenticated => true,
            UserCondition::SourceIp(cidr) => {
                // Simplified CIDR matching — in production, use an IP library
                source_ip.starts_with(cidr.split('/').next().unwrap_or(""))
            }
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
            TargetCondition::HostPort(host, port) => {
                target_addr == format!("{}:{}", host, port)
            }
            TargetCondition::Subnet(cidr) => {
                let target_ip = target_addr.split(':').next().unwrap_or("");
                target_ip.starts_with(cidr.split('/').next().unwrap_or(""))
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
