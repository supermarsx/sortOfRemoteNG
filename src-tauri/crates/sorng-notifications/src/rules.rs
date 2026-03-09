//! # Rule Engine
//!
//! Evaluates notification rules against incoming event data. Supports trigger
//! matching, multi-condition evaluation with a rich operator set, and
//! CRUD operations on the rule registry.

use crate::error::NotificationError;
use crate::types::*;
use regex::Regex;
use std::collections::HashMap;

/// The rule engine holds all registered notification rules and templates,
/// and provides methods to evaluate incoming events against them.
pub struct RuleEngine {
    /// Registered rules keyed by rule ID.
    rules: HashMap<String, NotificationRule>,
}

impl Default for RuleEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl RuleEngine {
    /// Create a new, empty rule engine.
    pub fn new() -> Self {
        Self {
            rules: HashMap::new(),
        }
    }

    // ── CRUD ────────────────────────────────────────────────────────

    /// Register a new notification rule.
    pub fn add_rule(&mut self, rule: NotificationRule) -> Result<(), NotificationError> {
        if self.rules.contains_key(&rule.id) {
            return Err(NotificationError::ConfigError(format!(
                "rule with id '{}' already exists",
                rule.id
            )));
        }
        self.rules.insert(rule.id.clone(), rule);
        Ok(())
    }

    /// Remove a rule by ID, returning the removed rule.
    pub fn remove_rule(&mut self, id: &str) -> Result<NotificationRule, NotificationError> {
        self.rules
            .remove(id)
            .ok_or_else(|| NotificationError::RuleNotFound(id.to_string()))
    }

    /// Get a reference to a rule by ID.
    pub fn get_rule(&self, id: &str) -> Result<&NotificationRule, NotificationError> {
        self.rules
            .get(id)
            .ok_or_else(|| NotificationError::RuleNotFound(id.to_string()))
    }

    /// List all registered rules.
    pub fn list_rules(&self) -> Vec<&NotificationRule> {
        self.rules.values().collect()
    }

    /// Enable a rule by ID.
    pub fn enable_rule(&mut self, id: &str) -> Result<(), NotificationError> {
        let rule = self
            .rules
            .get_mut(id)
            .ok_or_else(|| NotificationError::RuleNotFound(id.to_string()))?;
        rule.enabled = true;
        rule.updated_at = chrono::Utc::now();
        Ok(())
    }

    /// Disable a rule by ID.
    pub fn disable_rule(&mut self, id: &str) -> Result<(), NotificationError> {
        let rule = self
            .rules
            .get_mut(id)
            .ok_or_else(|| NotificationError::RuleNotFound(id.to_string()))?;
        rule.enabled = false;
        rule.updated_at = chrono::Utc::now();
        Ok(())
    }

    /// Replace an existing rule with an updated version (same ID).
    pub fn update_rule(&mut self, mut rule: NotificationRule) -> Result<(), NotificationError> {
        if !self.rules.contains_key(&rule.id) {
            return Err(NotificationError::RuleNotFound(rule.id.clone()));
        }
        rule.updated_at = chrono::Utc::now();
        self.rules.insert(rule.id.clone(), rule);
        Ok(())
    }

    // ── Evaluation ──────────────────────────────────────────────────

    /// Return all enabled rules whose trigger list contains the given trigger
    /// and whose conditions all evaluate to `true` against `event_data`.
    pub fn get_matching_rules(
        &self,
        event_data: &serde_json::Value,
        trigger: &NotificationTrigger,
    ) -> Vec<&NotificationRule> {
        self.rules
            .values()
            .filter(|rule| {
                rule.enabled
                    && rule.triggers.contains(trigger)
                    && Self::evaluate_rule(rule, event_data)
            })
            .collect()
    }

    /// Evaluate all conditions on a rule against the given event data.
    /// Returns `true` when every condition is satisfied (logical AND).
    /// A rule with no conditions always matches.
    pub fn evaluate_rule(rule: &NotificationRule, event_data: &serde_json::Value) -> bool {
        rule.conditions
            .iter()
            .all(|cond| Self::evaluate_condition(cond, event_data))
    }

    /// Evaluate a single condition against event data.
    pub fn evaluate_condition(cond: &RuleCondition, data: &serde_json::Value) -> bool {
        let field_value = resolve_field(data, &cond.field);

        match cond.operator {
            ConditionOperator::Exists => field_value.is_some(),
            ConditionOperator::IsEmpty => match field_value {
                None => true,
                Some(v) => match v {
                    serde_json::Value::Null => true,
                    serde_json::Value::String(s) => s.is_empty(),
                    serde_json::Value::Array(a) => a.is_empty(),
                    serde_json::Value::Object(o) => o.is_empty(),
                    _ => false,
                },
            },
            _ => {
                // All remaining operators require the field to exist.
                let Some(field_val) = field_value else {
                    return false;
                };
                match cond.operator {
                    ConditionOperator::Equals => json_eq(field_val, &cond.value),
                    ConditionOperator::NotEquals => !json_eq(field_val, &cond.value),
                    ConditionOperator::Contains => string_contains(field_val, &cond.value),
                    ConditionOperator::NotContains => !string_contains(field_val, &cond.value),
                    ConditionOperator::GreaterThan => {
                        numeric_cmp(field_val, &cond.value, |a, b| a > b)
                    }
                    ConditionOperator::LessThan => {
                        numeric_cmp(field_val, &cond.value, |a, b| a < b)
                    }
                    ConditionOperator::Matches => regex_matches(field_val, &cond.value),
                    ConditionOperator::In => value_in_array(field_val, &cond.value),
                    ConditionOperator::NotIn => !value_in_array(field_val, &cond.value),
                    // Exists / IsEmpty handled above.
                    ConditionOperator::Exists | ConditionOperator::IsEmpty => unreachable!(),
                }
            }
        }
    }
}

// ── Helper functions ────────────────────────────────────────────────

/// Resolve a dot-separated JSON path into the given value.
///
/// Supports simple dot-notation (e.g. `"host.status"`) and numeric array
/// indices (e.g. `"results.0.code"`).
fn resolve_field<'a>(data: &'a serde_json::Value, path: &str) -> Option<&'a serde_json::Value> {
    let mut current = data;
    for segment in path.split('.') {
        match current {
            serde_json::Value::Object(map) => {
                current = map.get(segment)?;
            }
            serde_json::Value::Array(arr) => {
                let idx: usize = segment.parse().ok()?;
                current = arr.get(idx)?;
            }
            _ => return None,
        }
    }
    Some(current)
}

/// Compare two JSON values for equality. Numeric types are compared as f64.
fn json_eq(a: &serde_json::Value, b: &serde_json::Value) -> bool {
    // Fast path: identical representation.
    if a == b {
        return true;
    }
    // Cross-type numeric comparison.
    if let (Some(na), Some(nb)) = (as_f64(a), as_f64(b)) {
        return (na - nb).abs() < f64::EPSILON;
    }
    false
}

/// Check whether the string representation of `field` contains the string
/// representation of `pattern`.
fn string_contains(field: &serde_json::Value, pattern: &serde_json::Value) -> bool {
    let field_str = json_as_str(field);
    let pattern_str = json_as_str(pattern);
    field_str.contains(&pattern_str)
}

/// Numeric comparison with a caller-supplied predicate.
fn numeric_cmp(
    field: &serde_json::Value,
    target: &serde_json::Value,
    pred: fn(f64, f64) -> bool,
) -> bool {
    match (as_f64(field), as_f64(target)) {
        (Some(a), Some(b)) => pred(a, b),
        _ => false,
    }
}

/// Check whether `field` value matches the regex in `pattern`.
fn regex_matches(field: &serde_json::Value, pattern: &serde_json::Value) -> bool {
    let field_str = json_as_str(field);
    let pattern_str = json_as_str(pattern);
    match Regex::new(&pattern_str) {
        Ok(re) => re.is_match(&field_str),
        Err(_) => false,
    }
}

/// Check whether `field` value is present in the JSON array `arr`.
fn value_in_array(field: &serde_json::Value, arr: &serde_json::Value) -> bool {
    match arr {
        serde_json::Value::Array(items) => items.iter().any(|item| json_eq(field, item)),
        _ => false,
    }
}

/// Attempt to extract a f64 from a JSON value.
fn as_f64(v: &serde_json::Value) -> Option<f64> {
    match v {
        serde_json::Value::Number(n) => n.as_f64(),
        serde_json::Value::String(s) => s.parse::<f64>().ok(),
        serde_json::Value::Bool(b) => Some(if *b { 1.0 } else { 0.0 }),
        _ => None,
    }
}

/// Convert a JSON value to its string representation for text comparisons.
fn json_as_str(v: &serde_json::Value) -> String {
    match v {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Null => String::new(),
        other => other.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn resolve_nested_field() {
        let data = json!({"host": {"status": "down", "code": 503}});
        assert_eq!(resolve_field(&data, "host.status"), Some(&json!("down")));
        assert_eq!(resolve_field(&data, "host.code"), Some(&json!(503)));
        assert_eq!(resolve_field(&data, "host.missing"), None);
    }

    #[test]
    fn condition_equals() {
        let data = json!({"status": "error"});
        let cond = RuleCondition {
            field: "status".into(),
            operator: ConditionOperator::Equals,
            value: json!("error"),
        };
        assert!(RuleEngine::evaluate_condition(&cond, &data));
    }

    #[test]
    fn condition_greater_than() {
        let data = json!({"cpu": 95.2});
        let cond = RuleCondition {
            field: "cpu".into(),
            operator: ConditionOperator::GreaterThan,
            value: json!(90),
        };
        assert!(RuleEngine::evaluate_condition(&cond, &data));
    }

    #[test]
    fn condition_in_array() {
        let data = json!({"level": "critical"});
        let cond = RuleCondition {
            field: "level".into(),
            operator: ConditionOperator::In,
            value: json!(["critical", "warning"]),
        };
        assert!(RuleEngine::evaluate_condition(&cond, &data));
    }

    #[test]
    fn condition_regex_matches() {
        let data = json!({"message": "Server rebooted at 14:32"});
        let cond = RuleCondition {
            field: "message".into(),
            operator: ConditionOperator::Matches,
            value: json!("rebooted at \\d{2}:\\d{2}"),
        };
        assert!(RuleEngine::evaluate_condition(&cond, &data));
    }

    #[test]
    fn condition_exists_and_is_empty() {
        let data = json!({"name": "", "tags": []});
        let exists_cond = RuleCondition {
            field: "name".into(),
            operator: ConditionOperator::Exists,
            value: json!(null),
        };
        assert!(RuleEngine::evaluate_condition(&exists_cond, &data));

        let empty_cond = RuleCondition {
            field: "name".into(),
            operator: ConditionOperator::IsEmpty,
            value: json!(null),
        };
        assert!(RuleEngine::evaluate_condition(&empty_cond, &data));

        let tags_empty = RuleCondition {
            field: "tags".into(),
            operator: ConditionOperator::IsEmpty,
            value: json!(null),
        };
        assert!(RuleEngine::evaluate_condition(&tags_empty, &data));
    }
}
