//! # Constraint Evaluation Engine
//!
//! Evaluates key constraints for sign requests. Supports lifetime expiry,
//! confirm-before-use, max-signatures, host restrictions, user restrictions,
//! forwarding depth limits, and custom extensions.

use crate::types::*;
use log::{debug, warn};

/// Result of evaluating all constraints on a key for a specific request.
#[derive(Debug, Clone)]
pub struct ConstraintResult {
    /// Whether the operation is allowed.
    pub allowed: bool,
    /// Whether user confirmation is required.
    pub needs_confirmation: bool,
    /// Reasons the operation was denied (empty if allowed).
    pub deny_reasons: Vec<String>,
    /// Informational messages about constraints that passed.
    pub info: Vec<String>,
}

/// Context for evaluating constraints.
#[derive(Debug, Clone, Default)]
pub struct EvalContext {
    /// Target host (if known).
    pub host: Option<String>,
    /// Target user (if known).
    pub user: Option<String>,
    /// Current forwarding depth.
    pub forwarding_depth: u32,
    /// How many times the key has been used so far.
    pub current_sign_count: u64,
    /// When the key was added.
    pub added_at: chrono::DateTime<chrono::Utc>,
}

/// Evaluate all constraints on a key against the given context.
pub fn evaluate_constraints(
    constraints: &[KeyConstraint],
    ctx: &EvalContext,
) -> ConstraintResult {
    let mut result = ConstraintResult {
        allowed: true,
        needs_confirmation: false,
        deny_reasons: Vec::new(),
        info: Vec::new(),
    };

    for constraint in constraints {
        match constraint {
            KeyConstraint::Lifetime(secs) => {
                if constraint.is_lifetime_expired(ctx.added_at) {
                    result.allowed = false;
                    result
                        .deny_reasons
                        .push(format!("Key lifetime expired ({}s)", secs));
                } else {
                    let remaining =
                        *secs as i64 - (chrono::Utc::now() - ctx.added_at).num_seconds();
                    result
                        .info
                        .push(format!("Lifetime: {}s remaining", remaining.max(0)));
                }
            }

            KeyConstraint::ConfirmBeforeUse => {
                result.needs_confirmation = true;
                result.info.push("Requires user confirmation".to_string());
            }

            KeyConstraint::MaxSignatures(max) => {
                if ctx.current_sign_count >= *max {
                    result.allowed = false;
                    result.deny_reasons.push(format!(
                        "Max signatures reached ({}/{})",
                        ctx.current_sign_count, max
                    ));
                } else {
                    result.info.push(format!(
                        "Signatures: {}/{}",
                        ctx.current_sign_count, max
                    ));
                }
            }

            KeyConstraint::HostRestriction(hosts) => {
                if let Some(ref target_host) = ctx.host {
                    let allowed = hosts.iter().any(|h| {
                        h == target_host
                            || (h.starts_with("*.") && target_host.ends_with(&h[1..]))
                    });
                    if !allowed {
                        result.allowed = false;
                        result.deny_reasons.push(format!(
                            "Host '{}' not in allowed list",
                            target_host
                        ));
                    }
                } else {
                    result
                        .info
                        .push("Host restriction active (host unknown)".to_string());
                }
            }

            KeyConstraint::UserRestriction(users) => {
                if let Some(ref target_user) = ctx.user {
                    if !users.contains(target_user) {
                        result.allowed = false;
                        result.deny_reasons.push(format!(
                            "User '{}' not in allowed list",
                            target_user
                        ));
                    }
                } else {
                    result
                        .info
                        .push("User restriction active (user unknown)".to_string());
                }
            }

            KeyConstraint::ForwardingDepth(max_depth) => {
                if ctx.forwarding_depth > *max_depth {
                    result.allowed = false;
                    result.deny_reasons.push(format!(
                        "Forwarding depth {} exceeds limit {}",
                        ctx.forwarding_depth, max_depth
                    ));
                }
            }

            KeyConstraint::Extension { name, data } => {
                debug!(
                    "Extension constraint '{}' ({}B data) — allowing",
                    name,
                    data.len()
                );
                result
                    .info
                    .push(format!("Extension constraint: {}", name));
            }
        }
    }

    if !result.allowed {
        warn!(
            "Constraint evaluation denied: {:?}",
            result.deny_reasons
        );
    }

    result
}

/// Check whether a specific key's constraints allow a sign operation
/// (convenience wrapper).
pub fn can_sign(
    key: &AgentKey,
    host: Option<&str>,
    user: Option<&str>,
    forwarding_depth: u32,
) -> ConstraintResult {
    let ctx = EvalContext {
        host: host.map(String::from),
        user: user.map(String::from),
        forwarding_depth,
        current_sign_count: key.sign_count,
        added_at: key.added_at,
    };
    evaluate_constraints(&key.constraints, &ctx)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use std::collections::HashMap;

    fn make_key(constraints: Vec<KeyConstraint>) -> AgentKey {
        AgentKey {
            id: "test".to_string(),
            comment: "test".to_string(),
            algorithm: KeyAlgorithm::Ed25519,
            bits: 256,
            fingerprint_sha256: "SHA256:test".to_string(),
            fingerprint_md5: String::new(),
            public_key_blob: vec![1],
            public_key_openssh: String::new(),
            source: KeySource::Generated,
            constraints,
            certificate: None,
            added_at: Utc::now(),
            last_used_at: None,
            sign_count: 0,
            metadata: HashMap::new(),
        }
    }

    #[test]
    fn test_no_constraints() {
        let key = make_key(vec![]);
        let result = can_sign(&key, Some("host.com"), Some("user"), 0);
        assert!(result.allowed);
        assert!(!result.needs_confirmation);
    }

    #[test]
    fn test_lifetime_ok() {
        let key = make_key(vec![KeyConstraint::Lifetime(3600)]);
        let result = can_sign(&key, None, None, 0);
        assert!(result.allowed);
    }

    #[test]
    fn test_lifetime_expired() {
        let mut key = make_key(vec![KeyConstraint::Lifetime(60)]);
        key.added_at = Utc::now() - chrono::Duration::seconds(120);
        let result = can_sign(&key, None, None, 0);
        assert!(!result.allowed);
    }

    #[test]
    fn test_confirm() {
        let key = make_key(vec![KeyConstraint::ConfirmBeforeUse]);
        let result = can_sign(&key, None, None, 0);
        assert!(result.allowed);
        assert!(result.needs_confirmation);
    }

    #[test]
    fn test_max_signatures() {
        let mut key = make_key(vec![KeyConstraint::MaxSignatures(5)]);
        key.sign_count = 5;
        let result = can_sign(&key, None, None, 0);
        assert!(!result.allowed);
    }

    #[test]
    fn test_host_allowed() {
        let key = make_key(vec![KeyConstraint::HostRestriction(vec![
            "*.example.com".to_string(),
        ])]);
        let result = can_sign(&key, Some("a.example.com"), None, 0);
        assert!(result.allowed);
    }

    #[test]
    fn test_host_denied() {
        let key = make_key(vec![KeyConstraint::HostRestriction(vec![
            "safe.com".to_string(),
        ])]);
        let result = can_sign(&key, Some("evil.com"), None, 0);
        assert!(!result.allowed);
    }

    #[test]
    fn test_user_restriction() {
        let key = make_key(vec![KeyConstraint::UserRestriction(vec![
            "alice".to_string(),
        ])]);
        let r1 = can_sign(&key, None, Some("alice"), 0);
        assert!(r1.allowed);

        let r2 = can_sign(&key, None, Some("bob"), 0);
        assert!(!r2.allowed);
    }

    #[test]
    fn test_forwarding_depth() {
        let key = make_key(vec![KeyConstraint::ForwardingDepth(2)]);
        let r1 = can_sign(&key, None, None, 2);
        assert!(r1.allowed);

        let r2 = can_sign(&key, None, None, 3);
        assert!(!r2.allowed);
    }

    #[test]
    fn test_multiple_constraints() {
        let key = make_key(vec![
            KeyConstraint::Lifetime(3600),
            KeyConstraint::HostRestriction(vec!["*.ok.com".to_string()]),
            KeyConstraint::MaxSignatures(10),
        ]);
        let result = can_sign(&key, Some("foo.ok.com"), None, 0);
        assert!(result.allowed);
    }
}
