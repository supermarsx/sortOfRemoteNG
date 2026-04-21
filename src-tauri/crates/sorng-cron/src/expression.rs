//! Cron expression validation, preview, and human-readable descriptions.

use crate::error::CronError;
use crate::types::{CronNextRun, CronSchedule};
use chrono::{DateTime, Datelike, Duration, Timelike, Utc};

/// Validate a 5-field cron expression and return a parsed `CronSchedule`.
pub fn validate_expression(expr: &str) -> Result<CronSchedule, CronError> {
    let trimmed = expr.trim();

    // Handle special presets
    if trimmed.starts_with('@') {
        return from_preset(trimmed);
    }

    let fields: Vec<&str> = trimmed.split_whitespace().collect();
    if fields.len() != 5 {
        return Err(CronError::InvalidCronExpression(format!(
            "Expected 5 fields, got {}: {expr}",
            fields.len()
        )));
    }

    validate_field(fields[0], 0, 59, "minute")?;
    validate_field(fields[1], 0, 23, "hour")?;
    validate_field(fields[2], 1, 31, "day of month")?;
    validate_field(fields[3], 1, 12, "month")?;
    validate_field(fields[4], 0, 7, "day of week")?;

    Ok(CronSchedule {
        minute: fields[0].to_string(),
        hour: fields[1].to_string(),
        day_of_month: fields[2].to_string(),
        month: fields[3].to_string(),
        day_of_week: fields[4].to_string(),
    })
}

/// Calculate the next N run times for a cron expression.
pub fn next_runs(expr: &str, count: usize) -> Result<CronNextRun, CronError> {
    let schedule = validate_expression(expr)?;

    if schedule.minute == "@reboot" {
        return Ok(CronNextRun {
            expression: expr.to_string(),
            next_times: Vec::new(),
        });
    }

    let minutes = expand_field(&schedule.minute, 0, 59)?;
    let hours = expand_field(&schedule.hour, 0, 23)?;
    let doms = expand_field(&schedule.day_of_month, 1, 31)?;
    let months = expand_field(&schedule.month, 1, 12)?;
    let dows = expand_field(&schedule.day_of_week, 0, 7)?;

    // Normalize day-of-week: 7 means Sunday (same as 0)
    let dows: Vec<u32> = dows
        .into_iter()
        .map(|d| if d == 7 { 0 } else { d })
        .collect();

    let now = Utc::now();
    let mut results = Vec::with_capacity(count);
    let mut candidate = now + Duration::minutes(1);
    // Zero out seconds
    candidate = candidate
        .date_naive()
        .and_hms_opt(candidate.hour(), candidate.minute(), 0)
        .map(|dt| DateTime::<Utc>::from_naive_utc_and_offset(dt, Utc))
        .unwrap_or(candidate);

    // Limit iterations to prevent infinite loops
    let max_iterations = 366 * 24 * 60; // ~1 year of minutes
    let mut iterations = 0;

    while results.len() < count && iterations < max_iterations {
        iterations += 1;

        let m = candidate.minute();
        let h = candidate.hour();
        let dom = candidate.day();
        let mon = candidate.month();
        let dow = candidate.weekday().num_days_from_sunday();

        if months.contains(&mon)
            && (doms.contains(&dom) || dows.contains(&dow))
            && hours.contains(&h)
            && minutes.contains(&m)
        {
            results.push(candidate);
        }

        candidate += Duration::minutes(1);
    }

    Ok(CronNextRun {
        expression: expr.to_string(),
        next_times: results,
    })
}

/// Generate a human-readable description of a cron expression.
pub fn describe_expression(expr: &str) -> Result<String, CronError> {
    let schedule = validate_expression(expr)?;

    if schedule.minute == "@reboot" {
        return Ok("At system reboot".to_string());
    }

    let minute_desc = describe_field(&schedule.minute, "minute");
    let hour_desc = describe_field(&schedule.hour, "hour");
    let dom_desc = describe_field(&schedule.day_of_month, "day-of-month");
    let month_desc = describe_field(&schedule.month, "month");
    let dow_desc = describe_field(&schedule.day_of_week, "day-of-week");

    // Build natural-language description
    let mut parts = Vec::new();

    // Time part
    if schedule.minute == "*" && schedule.hour == "*" {
        parts.push("Every minute".to_string());
    } else if schedule.minute == "*" {
        parts.push(format!("Every minute past {hour_desc}"));
    } else if schedule.hour == "*" {
        parts.push(format!("At {minute_desc} minutes past every hour"));
    } else {
        parts.push(format!("At {hour_desc}:{minute_desc}"));
    }

    // Day-of-month part
    if schedule.day_of_month != "*" {
        parts.push(format!("on {dom_desc}"));
    }

    // Month part
    if schedule.month != "*" {
        parts.push(format!("in {month_desc}"));
    }

    // Day-of-week part
    if schedule.day_of_week != "*" {
        parts.push(format!("on {dow_desc}"));
    }

    Ok(parts.join(" "))
}

/// Convert a preset alias to a `CronSchedule`.
pub fn from_preset(preset: &str) -> Result<CronSchedule, CronError> {
    match preset.to_lowercase().as_str() {
        "@reboot" => Ok(CronSchedule {
            minute: "@reboot".into(),
            hour: String::new(),
            day_of_month: String::new(),
            month: String::new(),
            day_of_week: String::new(),
        }),
        "@yearly" | "@annually" => Ok(CronSchedule {
            minute: "0".into(),
            hour: "0".into(),
            day_of_month: "1".into(),
            month: "1".into(),
            day_of_week: "*".into(),
        }),
        "@monthly" => Ok(CronSchedule {
            minute: "0".into(),
            hour: "0".into(),
            day_of_month: "1".into(),
            month: "*".into(),
            day_of_week: "*".into(),
        }),
        "@weekly" => Ok(CronSchedule {
            minute: "0".into(),
            hour: "0".into(),
            day_of_month: "*".into(),
            month: "*".into(),
            day_of_week: "0".into(),
        }),
        "@daily" | "@midnight" => Ok(CronSchedule {
            minute: "0".into(),
            hour: "0".into(),
            day_of_month: "*".into(),
            month: "*".into(),
            day_of_week: "*".into(),
        }),
        "@hourly" => Ok(CronSchedule {
            minute: "0".into(),
            hour: "*".into(),
            day_of_month: "*".into(),
            month: "*".into(),
            day_of_week: "*".into(),
        }),
        _ => Err(CronError::InvalidCronExpression(format!(
            "Unknown preset: {preset}"
        ))),
    }
}

// ─── Field validation & expansion ───────────────────────────────────

/// Validate a single cron field.
fn validate_field(field: &str, min: u32, max: u32, name: &str) -> Result<(), CronError> {
    if field == "*" {
        return Ok(());
    }

    // Handle comma-separated values
    for part in field.split(',') {
        validate_field_part(part.trim(), min, max, name)?;
    }

    Ok(())
}

/// Validate a single part of a cron field (may contain step or range).
fn validate_field_part(part: &str, min: u32, max: u32, name: &str) -> Result<(), CronError> {
    // Handle step: */N or M-N/S or M/S
    if let Some((range_part, step_str)) = part.split_once('/') {
        let step: u32 = step_str.parse().map_err(|_| {
            CronError::InvalidCronExpression(format!("Invalid step value '{step_str}' in {name}"))
        })?;
        if step == 0 {
            return Err(CronError::InvalidCronExpression(format!(
                "Step value cannot be 0 in {name}"
            )));
        }
        if range_part != "*" {
            validate_field_part(range_part, min, max, name)?;
        }
        return Ok(());
    }

    // Handle range: M-N
    if let Some((low_str, high_str)) = part.split_once('-') {
        let low = parse_field_value(low_str, name)?;
        let high = parse_field_value(high_str, name)?;
        if low < min || low > max {
            return Err(CronError::InvalidCronExpression(format!(
                "Value {low} out of range {min}-{max} in {name}"
            )));
        }
        if high < min || high > max {
            return Err(CronError::InvalidCronExpression(format!(
                "Value {high} out of range {min}-{max} in {name}"
            )));
        }
        return Ok(());
    }

    // Single value
    let val = parse_field_value(part, name)?;
    if val < min || val > max {
        return Err(CronError::InvalidCronExpression(format!(
            "Value {val} out of range {min}-{max} in {name}"
        )));
    }

    Ok(())
}

/// Parse a field value, handling month/day-of-week names.
fn parse_field_value(s: &str, name: &str) -> Result<u32, CronError> {
    // Try numeric first
    if let Ok(n) = s.parse::<u32>() {
        return Ok(n);
    }

    // Month names
    match s.to_lowercase().as_str() {
        "jan" => Ok(1),
        "feb" => Ok(2),
        "mar" => Ok(3),
        "apr" => Ok(4),
        "may" => Ok(5),
        "jun" => Ok(6),
        "jul" => Ok(7),
        "aug" => Ok(8),
        "sep" => Ok(9),
        "oct" => Ok(10),
        "nov" => Ok(11),
        "dec" => Ok(12),
        // Day-of-week names
        "sun" => Ok(0),
        "mon" => Ok(1),
        "tue" => Ok(2),
        "wed" => Ok(3),
        "thu" => Ok(4),
        "fri" => Ok(5),
        "sat" => Ok(6),
        _ => Err(CronError::InvalidCronExpression(format!(
            "Cannot parse '{s}' in {name}"
        ))),
    }
}

/// Expand a cron field into a sorted list of matching values.
fn expand_field(field: &str, min: u32, max: u32) -> Result<Vec<u32>, CronError> {
    if field == "*" {
        return Ok((min..=max).collect());
    }

    let mut values = Vec::new();

    for part in field.split(',') {
        let part = part.trim();

        if let Some((range_part, step_str)) = part.split_once('/') {
            let step: u32 = step_str.parse().unwrap_or(1);
            let (start, end) = if range_part == "*" {
                (min, max)
            } else if let Some((lo, hi)) = range_part.split_once('-') {
                (
                    parse_field_value(lo, "field").unwrap_or(min),
                    parse_field_value(hi, "field").unwrap_or(max),
                )
            } else {
                let v = parse_field_value(range_part, "field").unwrap_or(min);
                (v, max)
            };
            let mut val = start;
            while val <= end {
                values.push(val);
                val += step;
            }
        } else if let Some((lo, hi)) = part.split_once('-') {
            let start = parse_field_value(lo, "field").unwrap_or(min);
            let end = parse_field_value(hi, "field").unwrap_or(max);
            for v in start..=end {
                values.push(v);
            }
        } else if let Ok(v) = parse_field_value(part, "field") {
            values.push(v);
        }
    }

    values.sort();
    values.dedup();
    Ok(values)
}

/// Describe a single cron field in human-readable form.
fn describe_field(field: &str, kind: &str) -> String {
    if field == "*" {
        return format!("every {kind}");
    }

    match kind {
        "minute" => {
            if let Ok(n) = field.parse::<u32>() {
                return format!("{n:02}");
            }
        }
        "hour" => {
            if let Ok(n) = field.parse::<u32>() {
                return format!("{n:02}");
            }
        }
        "day-of-month" => {
            if let Ok(n) = field.parse::<u32>() {
                return format!("day {n}");
            }
        }
        "month" => {
            let name = match field {
                "1" => "January",
                "2" => "February",
                "3" => "March",
                "4" => "April",
                "5" => "May",
                "6" => "June",
                "7" => "July",
                "8" => "August",
                "9" => "September",
                "10" => "October",
                "11" => "November",
                "12" => "December",
                _ => field,
            };
            return name.to_string();
        }
        "day-of-week" => {
            let name = match field {
                "0" | "7" => "Sunday",
                "1" => "Monday",
                "2" => "Tuesday",
                "3" => "Wednesday",
                "4" => "Thursday",
                "5" => "Friday",
                "6" => "Saturday",
                _ => field,
            };
            return name.to_string();
        }
        _ => {}
    }

    // Fallback: step, range, or list
    if field.contains('/') {
        if let Some((_, step)) = field.split_once('/') {
            return format!("every {step} {kind}s");
        }
    }
    if field.contains('-') {
        return format!("{kind}s {field}");
    }
    if field.contains(',') {
        return format!("{kind}s {field}");
    }

    field.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_standard_expressions() {
        assert!(validate_expression("* * * * *").is_ok());
        assert!(validate_expression("0 2 * * *").is_ok());
        assert!(validate_expression("*/5 * * * *").is_ok());
        assert!(validate_expression("0 0 1 1 *").is_ok());
        assert!(validate_expression("0 0 * * 1-5").is_ok());
        assert!(validate_expression("0,30 * * * *").is_ok());
    }

    #[test]
    fn validate_invalid_expressions() {
        assert!(validate_expression("").is_err());
        assert!(validate_expression("* *").is_err());
        assert!(validate_expression("60 * * * *").is_err());
        assert!(validate_expression("* 25 * * *").is_err());
        assert!(validate_expression("* * 32 * *").is_err());
        assert!(validate_expression("* * * 13 *").is_err());
        assert!(validate_expression("* * * * 8").is_err());
    }

    #[test]
    fn validate_presets() {
        let s = from_preset("@hourly").unwrap();
        assert_eq!(s.minute, "0");
        assert_eq!(s.hour, "*");

        let s = from_preset("@daily").unwrap();
        assert_eq!(s.minute, "0");
        assert_eq!(s.hour, "0");

        let s = from_preset("@weekly").unwrap();
        assert_eq!(s.day_of_week, "0");

        let s = from_preset("@monthly").unwrap();
        assert_eq!(s.day_of_month, "1");

        let s = from_preset("@yearly").unwrap();
        assert_eq!(s.month, "1");

        assert!(from_preset("@invalid").is_err());
    }

    #[test]
    fn expand_fields() {
        assert_eq!(expand_field("*", 0, 5).unwrap(), vec![0, 1, 2, 3, 4, 5]);
        assert_eq!(expand_field("1,3,5", 0, 6).unwrap(), vec![1, 3, 5]);
        assert_eq!(expand_field("1-4", 0, 6).unwrap(), vec![1, 2, 3, 4]);
        assert_eq!(expand_field("*/2", 0, 6).unwrap(), vec![0, 2, 4, 6]);
        assert_eq!(expand_field("1-5/2", 0, 6).unwrap(), vec![1, 3, 5]);
    }

    #[test]
    fn describe_common_expressions() {
        let desc = describe_expression("0 2 * * *").unwrap();
        assert!(desc.contains("02"), "Expected hour in description: {desc}");

        let desc = describe_expression("*/5 * * * *").unwrap();
        assert!(
            desc.contains("5") && desc.contains("minute"),
            "Expected step description: {desc}"
        );

        let desc = describe_expression("@reboot").unwrap();
        assert_eq!(desc, "At system reboot");
    }

    #[test]
    fn next_runs_generates_times() {
        let result = next_runs("* * * * *", 5).unwrap();
        assert_eq!(result.next_times.len(), 5);

        // Each successive time should be 1 minute apart
        for i in 1..result.next_times.len() {
            let diff = result.next_times[i] - result.next_times[i - 1];
            assert_eq!(diff.num_minutes(), 1);
        }
    }

    #[test]
    fn next_runs_reboot_is_empty() {
        let result = next_runs("@reboot", 5).unwrap();
        assert!(result.next_times.is_empty());
    }

    #[test]
    fn field_value_names() {
        assert_eq!(parse_field_value("jan", "month").unwrap(), 1);
        assert_eq!(parse_field_value("dec", "month").unwrap(), 12);
        assert_eq!(parse_field_value("sun", "dow").unwrap(), 0);
        assert_eq!(parse_field_value("sat", "dow").unwrap(), 6);
    }
}
