use chrono::Utc;
use regex::Regex;
use serde_json::Value;
use std::cmp::Ordering;

use crate::error::{FilterError, Result};
use crate::types::*;

// ═══════════════════════════════════════════════════════════════════
// Public entry point
// ═══════════════════════════════════════════════════════════════════

/// Evaluate a [`SmartFilter`] against a slice of connection JSON objects.
pub fn evaluate_filter(filter: &SmartFilter, connections: &[Value]) -> Result<FilterResult> {
    let start = std::time::Instant::now();

    let mut matching_ids: Vec<String> = Vec::new();
    let mut matched: Vec<Value> = Vec::new();

    for conn in connections {
        let condition_results: Vec<bool> = filter
            .conditions
            .iter()
            .map(|c| evaluate_condition(c, conn))
            .collect::<Result<Vec<bool>>>()?;

        let passes = if condition_results.is_empty() {
            true // no conditions → match everything
        } else {
            evaluate_logic(&filter.logic, &condition_results)?
        };

        if passes {
            if let Some(id) = conn.get("id").and_then(|v| v.as_str()) {
                matching_ids.push(id.to_string());
            }
            matched.push(conn.clone());
        }
    }

    // Sort
    if let Some(ref sort_field) = filter.sort_by {
        apply_sort(&mut matched, sort_field, &filter.sort_order);
        // Re-derive matching_ids after sort
        matching_ids = matched
            .iter()
            .filter_map(|c| c.get("id").and_then(|v| v.as_str()).map(|s| s.to_string()))
            .collect();
    }

    // Limit
    if let Some(limit) = filter.limit {
        matching_ids.truncate(limit);
    }

    let match_count = matching_ids.len();
    let duration_ms = start.elapsed().as_secs_f64() * 1000.0;

    Ok(FilterResult {
        matching_ids,
        total_evaluated: connections.len(),
        match_count,
        duration_ms,
    })
}

// ═══════════════════════════════════════════════════════════════════
// Condition evaluation
// ═══════════════════════════════════════════════════════════════════

/// Evaluate a single condition against one connection JSON object.
pub fn evaluate_condition(condition: &FilterCondition, connection: &Value) -> Result<bool> {
    let field_value = extract_field_value(&condition.field, connection);

    let result = match field_value {
        Some(ref fv) => compare_values(&condition.operator, fv, &condition.value)?,
        None => match condition.operator {
            FilterOperator::IsEmpty | FilterOperator::Exists => {
                compare_values(&condition.operator, &Value::Null, &condition.value)?
            }
            _ => false,
        },
    };

    Ok(if condition.negate { !result } else { result })
}

// ═══════════════════════════════════════════════════════════════════
// Field extraction
// ═══════════════════════════════════════════════════════════════════

/// Extract a field value from the JSON connection object.
pub fn extract_field_value(field: &FilterField, connection: &Value) -> Option<Value> {
    let key = field.json_key();
    connection.get(key).cloned()
}

// ═══════════════════════════════════════════════════════════════════
// Value comparison
// ═══════════════════════════════════════════════════════════════════

/// Core comparison: apply `operator` between a JSON field value and a filter value.
pub fn compare_values(
    operator: &FilterOperator,
    field_value: &Value,
    filter_value: &FilterValue,
) -> Result<bool> {
    match operator {
        FilterOperator::Equals => Ok(values_equal(field_value, filter_value)),
        FilterOperator::NotEquals => Ok(!values_equal(field_value, filter_value)),

        FilterOperator::Contains => {
            let haystack = value_to_string(field_value)
                .unwrap_or_default()
                .to_lowercase();
            let needle = filter_value_to_string(filter_value).to_lowercase();
            Ok(haystack.contains(&needle))
        }
        FilterOperator::NotContains => {
            let haystack = value_to_string(field_value)
                .unwrap_or_default()
                .to_lowercase();
            let needle = filter_value_to_string(filter_value).to_lowercase();
            Ok(!haystack.contains(&needle))
        }

        FilterOperator::StartsWith => {
            let haystack = value_to_string(field_value)
                .unwrap_or_default()
                .to_lowercase();
            let prefix = filter_value_to_string(filter_value).to_lowercase();
            Ok(haystack.starts_with(&prefix))
        }
        FilterOperator::EndsWith => {
            let haystack = value_to_string(field_value)
                .unwrap_or_default()
                .to_lowercase();
            let suffix = filter_value_to_string(filter_value).to_lowercase();
            Ok(haystack.ends_with(&suffix))
        }

        FilterOperator::GreaterThan => {
            Ok(compare_numeric(field_value, filter_value) == Some(Ordering::Greater))
        }
        FilterOperator::LessThan => {
            Ok(compare_numeric(field_value, filter_value) == Some(Ordering::Less))
        }
        FilterOperator::GreaterOrEqual => {
            let ord = compare_numeric(field_value, filter_value);
            Ok(ord == Some(Ordering::Greater) || ord == Some(Ordering::Equal))
        }
        FilterOperator::LessOrEqual => {
            let ord = compare_numeric(field_value, filter_value);
            Ok(ord == Some(Ordering::Less) || ord == Some(Ordering::Equal))
        }

        FilterOperator::In => {
            let list = filter_value_to_string_list(filter_value);
            let val = value_to_string(field_value)
                .unwrap_or_default()
                .to_lowercase();
            Ok(list.iter().any(|s| s.to_lowercase() == val))
        }
        FilterOperator::NotIn => {
            let list = filter_value_to_string_list(filter_value);
            let val = value_to_string(field_value)
                .unwrap_or_default()
                .to_lowercase();
            Ok(!list.iter().any(|s| s.to_lowercase() == val))
        }

        FilterOperator::Matches => {
            let pattern = filter_value_to_string(filter_value);
            let re = Regex::new(&pattern).map_err(FilterError::from)?;
            let text = value_to_string(field_value).unwrap_or_default();
            Ok(re.is_match(&text))
        }

        FilterOperator::Exists => Ok(!field_value.is_null()),
        FilterOperator::IsEmpty => Ok(field_value.is_null()
            || field_value.as_str().is_some_and(|s| s.is_empty())
            || field_value.as_array().is_some_and(|a| a.is_empty())),

        FilterOperator::Between => {
            // Expects FilterValue::StringList with exactly two elements (low, high)
            let list = filter_value_to_string_list(filter_value);
            if list.len() != 2 {
                return Err(FilterError::InvalidCondition(
                    "Between operator requires exactly two values".into(),
                ));
            }
            let fv_num = value_to_f64(field_value);
            let low: Option<f64> = list[0].parse().ok();
            let high: Option<f64> = list[1].parse().ok();
            match (fv_num, low, high) {
                (Some(v), Some(lo), Some(hi)) => Ok(v >= lo && v <= hi),
                _ => {
                    // Fall back to string comparison for dates
                    let val = value_to_string(field_value).unwrap_or_default();
                    Ok(val >= list[0] && val <= list[1])
                }
            }
        }

        FilterOperator::OlderThan => {
            let duration = match filter_value {
                FilterValue::Duration(d) => d.to_chrono_duration(),
                _ => {
                    return Err(FilterError::InvalidCondition(
                        "OlderThan requires a Duration value".into(),
                    ))
                }
            };
            let date_str = value_to_string(field_value).unwrap_or_default();
            let parsed = chrono::DateTime::parse_from_rfc3339(&date_str)
                .map(|d| d.with_timezone(&Utc))
                .ok();
            match parsed {
                Some(dt) => {
                    let threshold = Utc::now() - duration;
                    Ok(dt < threshold)
                }
                None => Ok(false),
            }
        }

        FilterOperator::NewerThan => {
            let duration = match filter_value {
                FilterValue::Duration(d) => d.to_chrono_duration(),
                _ => {
                    return Err(FilterError::InvalidCondition(
                        "NewerThan requires a Duration value".into(),
                    ))
                }
            };
            let date_str = value_to_string(field_value).unwrap_or_default();
            let parsed = chrono::DateTime::parse_from_rfc3339(&date_str)
                .map(|d| d.with_timezone(&Utc))
                .ok();
            match parsed {
                Some(dt) => {
                    let threshold = Utc::now() - duration;
                    Ok(dt >= threshold)
                }
                None => Ok(false),
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════════
// Logic evaluation
// ═══════════════════════════════════════════════════════════════════

/// Apply filter logic (AND / OR / Custom expression) to the per-condition results.
pub fn evaluate_logic(logic: &FilterLogic, results: &[bool]) -> Result<bool> {
    match logic {
        FilterLogic::And => Ok(results.iter().all(|&r| r)),
        FilterLogic::Or => Ok(results.iter().any(|&r| r)),
        FilterLogic::Custom(expr) => parse_custom_expression(expr, results),
    }
}

// ═══════════════════════════════════════════════════════════════════
// Custom expression parser  –  "(0 AND 1) OR 2"
// ═══════════════════════════════════════════════════════════════════

/// Parse and evaluate a custom boolean expression like `"(0 AND 1) OR 2"`.
///
/// Grammar (recursive descent):
/// ```text
/// expr     → term (OR term)*
/// term     → factor (AND factor)*
/// factor   → NOT factor | '(' expr ')' | INDEX
/// ```
pub fn parse_custom_expression(expr: &str, results: &[bool]) -> Result<bool> {
    let tokens = tokenize(expr)?;
    let mut pos = 0;
    let value = parse_expr(&tokens, &mut pos, results)?;
    if pos != tokens.len() {
        return Err(FilterError::InvalidExpression(format!(
            "Unexpected token at position {pos}: {:?}",
            tokens.get(pos)
        )));
    }
    Ok(value)
}

#[derive(Debug, Clone, PartialEq)]
enum Token {
    Index(usize),
    And,
    Or,
    Not,
    LParen,
    RParen,
}

fn tokenize(expr: &str) -> Result<Vec<Token>> {
    let mut tokens = Vec::new();
    let mut chars = expr.chars().peekable();

    while let Some(&ch) = chars.peek() {
        match ch {
            ' ' | '\t' | '\n' | '\r' => {
                chars.next();
            }
            '(' => {
                tokens.push(Token::LParen);
                chars.next();
            }
            ')' => {
                tokens.push(Token::RParen);
                chars.next();
            }
            '0'..='9' => {
                let mut num = String::new();
                while let Some(&c) = chars.peek() {
                    if c.is_ascii_digit() {
                        num.push(c);
                        chars.next();
                    } else {
                        break;
                    }
                }
                let idx: usize = num
                    .parse()
                    .map_err(|_| FilterError::InvalidExpression(format!("Invalid index: {num}")))?;
                tokens.push(Token::Index(idx));
            }
            'A' | 'a' => {
                // AND
                let word: String = take_alpha(&mut chars);
                if word.to_uppercase() == "AND" {
                    tokens.push(Token::And);
                } else {
                    return Err(FilterError::InvalidExpression(format!(
                        "Unknown keyword: {word}"
                    )));
                }
            }
            'O' | 'o' => {
                let word = take_alpha(&mut chars);
                if word.to_uppercase() == "OR" {
                    tokens.push(Token::Or);
                } else {
                    return Err(FilterError::InvalidExpression(format!(
                        "Unknown keyword: {word}"
                    )));
                }
            }
            'N' | 'n' => {
                let word = take_alpha(&mut chars);
                if word.to_uppercase() == "NOT" {
                    tokens.push(Token::Not);
                } else {
                    return Err(FilterError::InvalidExpression(format!(
                        "Unknown keyword: {word}"
                    )));
                }
            }
            _ => {
                return Err(FilterError::InvalidExpression(format!(
                    "Unexpected character: {ch}"
                )));
            }
        }
    }
    Ok(tokens)
}

fn take_alpha(chars: &mut std::iter::Peekable<std::str::Chars<'_>>) -> String {
    let mut word = String::new();
    while let Some(&c) = chars.peek() {
        if c.is_ascii_alphabetic() {
            word.push(c);
            chars.next();
        } else {
            break;
        }
    }
    word
}

fn parse_expr(tokens: &[Token], pos: &mut usize, results: &[bool]) -> Result<bool> {
    let mut left = parse_term(tokens, pos, results)?;
    while *pos < tokens.len() && tokens[*pos] == Token::Or {
        *pos += 1;
        let right = parse_term(tokens, pos, results)?;
        left = left || right;
    }
    Ok(left)
}

fn parse_term(tokens: &[Token], pos: &mut usize, results: &[bool]) -> Result<bool> {
    let mut left = parse_factor(tokens, pos, results)?;
    while *pos < tokens.len() && tokens[*pos] == Token::And {
        *pos += 1;
        let right = parse_factor(tokens, pos, results)?;
        left = left && right;
    }
    Ok(left)
}

fn parse_factor(tokens: &[Token], pos: &mut usize, results: &[bool]) -> Result<bool> {
    if *pos >= tokens.len() {
        return Err(FilterError::InvalidExpression(
            "Unexpected end of expression".into(),
        ));
    }
    match &tokens[*pos] {
        Token::Not => {
            *pos += 1;
            let val = parse_factor(tokens, pos, results)?;
            Ok(!val)
        }
        Token::LParen => {
            *pos += 1;
            let val = parse_expr(tokens, pos, results)?;
            if *pos >= tokens.len() || tokens[*pos] != Token::RParen {
                return Err(FilterError::InvalidExpression(
                    "Missing closing parenthesis".into(),
                ));
            }
            *pos += 1;
            Ok(val)
        }
        Token::Index(idx) => {
            let idx = *idx;
            *pos += 1;
            if idx >= results.len() {
                return Err(FilterError::InvalidExpression(format!(
                    "Condition index {idx} out of range (max {})",
                    results.len().saturating_sub(1)
                )));
            }
            Ok(results[idx])
        }
        other => Err(FilterError::InvalidExpression(format!(
            "Unexpected token: {other:?}"
        ))),
    }
}

// ═══════════════════════════════════════════════════════════════════
// Sorting
// ═══════════════════════════════════════════════════════════════════

/// Sort a mutable slice of connection JSON objects by the given field and order.
pub fn apply_sort(connections: &mut [Value], sort_by: &SortField, order: &SortOrder) {
    let key = sort_by.json_key();
    connections.sort_by(|a, b| {
        let va = a.get(key);
        let vb = b.get(key);
        let cmp = compare_json_vals(va, vb);
        match order {
            SortOrder::Ascending => cmp,
            SortOrder::Descending => cmp.reverse(),
        }
    });
}

fn compare_json_vals(a: Option<&Value>, b: Option<&Value>) -> Ordering {
    match (a, b) {
        (None, None) => Ordering::Equal,
        (None, Some(_)) => Ordering::Greater,
        (Some(_), None) => Ordering::Less,
        (Some(va), Some(vb)) => {
            // Try numeric first
            if let (Some(na), Some(nb)) = (va.as_f64(), vb.as_f64()) {
                return na.partial_cmp(&nb).unwrap_or(Ordering::Equal);
            }
            // Try boolean
            if let (Some(ba), Some(bb)) = (va.as_bool(), vb.as_bool()) {
                return ba.cmp(&bb);
            }
            // Fall back to string
            let sa = value_to_string(va).unwrap_or_default();
            let sb = value_to_string(vb).unwrap_or_default();
            sa.to_lowercase().cmp(&sb.to_lowercase())
        }
    }
}

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

fn values_equal(field_value: &Value, filter_value: &FilterValue) -> bool {
    match filter_value {
        FilterValue::String(s) => value_to_string(field_value)
            .map(|fv| fv.to_lowercase() == s.to_lowercase())
            .unwrap_or(false),
        FilterValue::Number(n) => value_to_f64(field_value)
            .map(|fv| (fv - n).abs() < f64::EPSILON)
            .unwrap_or(false),
        FilterValue::Boolean(b) => field_value.as_bool().map(|fv| fv == *b).unwrap_or(false),
        FilterValue::Null => field_value.is_null(),
        FilterValue::Date(d) => value_to_string(field_value)
            .map(|fv| fv == *d)
            .unwrap_or(false),
        FilterValue::StringList(list) => {
            // Equal if field is an array with the same elements
            if let Some(arr) = field_value.as_array() {
                let field_strings: Vec<String> = arr
                    .iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_lowercase()))
                    .collect();
                let filter_strings: Vec<String> = list.iter().map(|s| s.to_lowercase()).collect();
                field_strings == filter_strings
            } else {
                false
            }
        }
        FilterValue::Duration(_) => false,
    }
}

fn value_to_string(v: &Value) -> Option<String> {
    match v {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        Value::Bool(b) => Some(b.to_string()),
        Value::Array(arr) => {
            let parts: Vec<String> = arr.iter().filter_map(value_to_string).collect();
            Some(parts.join(","))
        }
        Value::Null => None,
        _ => Some(v.to_string()),
    }
}

fn value_to_f64(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.parse::<f64>().ok(),
        Value::Bool(b) => Some(if *b { 1.0 } else { 0.0 }),
        _ => None,
    }
}

fn filter_value_to_string(fv: &FilterValue) -> String {
    match fv {
        FilterValue::String(s) => s.clone(),
        FilterValue::Number(n) => n.to_string(),
        FilterValue::Boolean(b) => b.to_string(),
        FilterValue::Date(d) => d.clone(),
        FilterValue::Null => String::new(),
        FilterValue::StringList(list) => list.join(","),
        FilterValue::Duration(d) => format!("{}{:?}", d.amount, d.unit),
    }
}

fn filter_value_to_string_list(fv: &FilterValue) -> Vec<String> {
    match fv {
        FilterValue::StringList(list) => list.clone(),
        FilterValue::String(s) => s.split(',').map(|x| x.trim().to_string()).collect(),
        other => vec![filter_value_to_string(other)],
    }
}

fn compare_numeric(field_value: &Value, filter_value: &FilterValue) -> Option<Ordering> {
    let fv_num = value_to_f64(field_value)?;
    let cv_num = match filter_value {
        FilterValue::Number(n) => Some(*n),
        FilterValue::String(s) => s.parse::<f64>().ok(),
        _ => None,
    }?;
    fv_num.partial_cmp(&cv_num)
}

// ═══════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn make_conn(id: &str, name: &str, protocol: &str, hostname: &str) -> Value {
        json!({
            "id": id,
            "name": name,
            "protocol": protocol,
            "hostname": hostname,
            "port": 22,
            "favorite": false,
            "status": "online",
            "connectionCount": 5,
            "lastConnected": "2025-12-01T10:00:00Z",
            "createdAt": "2024-01-01T00:00:00Z",
            "tags": ["prod", "linux"],
        })
    }

    #[test]
    fn test_equals_string() {
        let conn = make_conn("1", "Server A", "ssh", "10.0.0.1");
        let cond = FilterCondition {
            field: FilterField::Protocol,
            operator: FilterOperator::Equals,
            value: FilterValue::String("ssh".into()),
            negate: false,
        };
        assert!(evaluate_condition(&cond, &conn).unwrap());
    }

    #[test]
    fn test_equals_negated() {
        let conn = make_conn("1", "Server A", "ssh", "10.0.0.1");
        let cond = FilterCondition {
            field: FilterField::Protocol,
            operator: FilterOperator::Equals,
            value: FilterValue::String("rdp".into()),
            negate: true,
        };
        // protocol is ssh, not rdp → Equals returns false → negate → true
        assert!(evaluate_condition(&cond, &conn).unwrap());
    }

    #[test]
    fn test_contains() {
        let conn = make_conn("1", "Production DB", "ssh", "db01.example.com");
        let cond = FilterCondition {
            field: FilterField::Name,
            operator: FilterOperator::Contains,
            value: FilterValue::String("prod".into()),
            negate: false,
        };
        assert!(evaluate_condition(&cond, &conn).unwrap());
    }

    #[test]
    fn test_greater_than() {
        let conn = make_conn("1", "Server A", "ssh", "10.0.0.1");
        let cond = FilterCondition {
            field: FilterField::ConnectionCount,
            operator: FilterOperator::GreaterThan,
            value: FilterValue::Number(3.0),
            negate: false,
        };
        assert!(evaluate_condition(&cond, &conn).unwrap());
    }

    #[test]
    fn test_in_operator() {
        let conn = make_conn("1", "Server A", "rdp", "10.0.0.1");
        let cond = FilterCondition {
            field: FilterField::Protocol,
            operator: FilterOperator::In,
            value: FilterValue::StringList(vec!["ssh".into(), "rdp".into(), "vnc".into()]),
            negate: false,
        };
        assert!(evaluate_condition(&cond, &conn).unwrap());
    }

    #[test]
    fn test_is_empty() {
        let conn = json!({"id": "1", "name": "Test", "description": ""});
        let cond = FilterCondition {
            field: FilterField::Description,
            operator: FilterOperator::IsEmpty,
            value: FilterValue::Null,
            negate: false,
        };
        assert!(evaluate_condition(&cond, &conn).unwrap());
    }

    #[test]
    fn test_regex_matches() {
        let conn = make_conn("1", "Server A", "ssh", "web-01.prod.example.com");
        let cond = FilterCondition {
            field: FilterField::Hostname,
            operator: FilterOperator::Matches,
            value: FilterValue::String(r"^web-\d+\.prod".into()),
            negate: false,
        };
        assert!(evaluate_condition(&cond, &conn).unwrap());
    }

    #[test]
    fn test_filter_and_logic() {
        let connections = vec![
            make_conn("1", "Linux SSH", "ssh", "10.0.0.1"),
            make_conn("2", "Windows RDP", "rdp", "10.0.0.2"),
            make_conn("3", "Linux VNC", "vnc", "10.0.0.3"),
        ];
        let mut filter = SmartFilter::new("SSH only", "Only SSH connections");
        filter.conditions.push(FilterCondition {
            field: FilterField::Protocol,
            operator: FilterOperator::Equals,
            value: FilterValue::String("ssh".into()),
            negate: false,
        });
        filter.logic = FilterLogic::And;

        let result = evaluate_filter(&filter, &connections).unwrap();
        assert_eq!(result.match_count, 1);
        assert_eq!(result.matching_ids, vec!["1"]);
    }

    #[test]
    fn test_custom_expression() {
        let results = vec![true, false, true];
        // (0 AND 1) OR 2 → (true AND false) OR true → false OR true → true
        assert!(parse_custom_expression("(0 AND 1) OR 2", &results).unwrap());
        // 0 AND 1 AND 2 → true AND false AND true → false
        assert!(!parse_custom_expression("0 AND 1 AND 2", &results).unwrap());
        // NOT 1 → NOT false → true
        assert!(parse_custom_expression("NOT 1", &results).unwrap());
    }

    #[test]
    fn test_sort_ascending() {
        let mut conns = vec![
            json!({"id": "1", "name": "Charlie"}),
            json!({"id": "2", "name": "Alice"}),
            json!({"id": "3", "name": "Bob"}),
        ];
        apply_sort(&mut conns, &SortField::Name, &SortOrder::Ascending);
        assert_eq!(conns[0]["name"], "Alice");
        assert_eq!(conns[1]["name"], "Bob");
        assert_eq!(conns[2]["name"], "Charlie");
    }

    #[test]
    fn test_sort_descending() {
        let mut conns = vec![
            json!({"id": "1", "name": "Alice"}),
            json!({"id": "2", "name": "Charlie"}),
            json!({"id": "3", "name": "Bob"}),
        ];
        apply_sort(&mut conns, &SortField::Name, &SortOrder::Descending);
        assert_eq!(conns[0]["name"], "Charlie");
        assert_eq!(conns[1]["name"], "Bob");
        assert_eq!(conns[2]["name"], "Alice");
    }

    #[test]
    fn test_between_numeric() {
        let conn = json!({"id":"1", "port": 443});
        let cond = FilterCondition {
            field: FilterField::Port,
            operator: FilterOperator::Between,
            value: FilterValue::StringList(vec!["80".into(), "8080".into()]),
            negate: false,
        };
        assert!(evaluate_condition(&cond, &conn).unwrap());
    }

    #[test]
    fn test_starts_with() {
        let conn = make_conn("1", "Server A", "ssh", "192.168.1.100");
        let cond = FilterCondition {
            field: FilterField::Hostname,
            operator: FilterOperator::StartsWith,
            value: FilterValue::String("192.168".into()),
            negate: false,
        };
        assert!(evaluate_condition(&cond, &conn).unwrap());
    }

    #[test]
    fn test_empty_conditions_match_all() {
        let connections = vec![
            make_conn("1", "A", "ssh", "h1"),
            make_conn("2", "B", "rdp", "h2"),
        ];
        let filter = SmartFilter::new("All", "Match everything");
        let result = evaluate_filter(&filter, &connections).unwrap();
        assert_eq!(result.match_count, 2);
    }

    #[test]
    fn test_filter_with_limit() {
        let connections = vec![
            make_conn("1", "A", "ssh", "h1"),
            make_conn("2", "B", "ssh", "h2"),
            make_conn("3", "C", "ssh", "h3"),
        ];
        let mut filter = SmartFilter::new("Limited", "Max 2");
        filter.limit = Some(2);
        let result = evaluate_filter(&filter, &connections).unwrap();
        assert_eq!(result.match_count, 2);
    }
}
