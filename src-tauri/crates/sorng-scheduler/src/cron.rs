//! Cron expression parser and next-occurrence calculator.
//!
//! Supports the standard five-field format:
//! `minute  hour  day-of-month  month  day-of-week`
//!
//! Field syntax:
//! - `*`           any value
//! - `5`           exact value
//! - `1-5`         inclusive range
//! - `*/15`        step (every 15)
//! - `1,4,7`       list of exact values
//! - `1-5/2`       range with step

use chrono::{DateTime, Datelike, Duration, NaiveTime, Timelike, Utc};

use crate::error::SchedulerError;

// ─── CronField ──────────────────────────────────────────────────────

/// Representation of a single cron field.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CronField {
    /// `*` — matches every value.
    Any,
    /// A single exact value, e.g. `5`.
    Exact(u32),
    /// An inclusive range, e.g. `1-5`.
    Range(u32, u32),
    /// A step from zero (or start), e.g. `*/15` or `5/10`.
    Step { start: u32, step: u32 },
    /// A list of individual values, e.g. `1,4,7`.
    List(Vec<u32>),
}

impl CronField {
    /// Check whether `value` is matched by this field.
    pub fn matches(&self, value: u32) -> bool {
        match self {
            Self::Any => true,
            Self::Exact(v) => value == *v,
            Self::Range(lo, hi) => value >= *lo && value <= *hi,
            Self::Step { start, step } => {
                if *step == 0 {
                    return value == *start;
                }
                if value < *start {
                    return false;
                }
                (value - start).is_multiple_of(*step)
            }
            Self::List(vals) => vals.contains(&value),
        }
    }

    /// Return the smallest matching value >= `from` within `[min, max]`.
    /// Returns `None` if no match exists in the range.
    pub fn next_match(&self, from: u32, min: u32, max: u32) -> Option<u32> {
        let start = from.max(min);
        (start..=max).find(|&v| self.matches(v))
    }
}

// ─── CronExpression ─────────────────────────────────────────────────

/// Parsed five-field cron expression.
#[derive(Debug, Clone)]
pub struct CronExpression {
    pub minute: CronField,
    pub hour: CronField,
    pub day_of_month: CronField,
    pub month: CronField,
    pub day_of_week: CronField,
}

// ─── Parsing helpers ────────────────────────────────────────────────

fn parse_field(token: &str, min: u32, max: u32) -> Result<CronField, SchedulerError> {
    let token = token.trim();

    // Wildcard
    if token == "*" {
        return Ok(CronField::Any);
    }

    // Step with wildcard: */N
    if let Some(rest) = token.strip_prefix("*/") {
        let step: u32 = rest
            .parse()
            .map_err(|_| SchedulerError::CronParseError(format!("invalid step: {token}")))?;
        if step == 0 || step > max {
            return Err(SchedulerError::CronParseError(format!(
                "step out of range: {token}"
            )));
        }
        return Ok(CronField::Step { start: min, step });
    }

    // List: 1,4,7
    if token.contains(',') {
        let vals: Result<Vec<u32>, _> = token.split(',').map(|s| s.trim().parse::<u32>()).collect();
        let vals =
            vals.map_err(|_| SchedulerError::CronParseError(format!("invalid list: {token}")))?;
        for &v in &vals {
            if v < min || v > max {
                return Err(SchedulerError::CronParseError(format!(
                    "value {v} out of range [{min}–{max}]"
                )));
            }
        }
        return Ok(CronField::List(vals));
    }

    // Range with step: 1-5/2
    if token.contains('-') && token.contains('/') {
        let parts: Vec<&str> = token.splitn(2, '/').collect();
        let range_parts: Vec<&str> = parts[0].splitn(2, '-').collect();
        if range_parts.len() != 2 || parts.len() != 2 {
            return Err(SchedulerError::CronParseError(format!(
                "invalid range/step: {token}"
            )));
        }
        let lo: u32 = range_parts[0]
            .parse()
            .map_err(|_| SchedulerError::CronParseError(format!("invalid range: {token}")))?;
        let hi: u32 = range_parts[1]
            .parse()
            .map_err(|_| SchedulerError::CronParseError(format!("invalid range: {token}")))?;
        let step: u32 = parts[1]
            .parse()
            .map_err(|_| SchedulerError::CronParseError(format!("invalid step: {token}")))?;
        if lo < min || hi > max || lo > hi || step == 0 {
            return Err(SchedulerError::CronParseError(format!(
                "range/step out of bounds: {token}"
            )));
        }
        // Expand to a list
        let mut vals = Vec::new();
        let mut v = lo;
        while v <= hi {
            vals.push(v);
            v += step;
        }
        return Ok(CronField::List(vals));
    }

    // Range: 1-5
    if token.contains('-') {
        let parts: Vec<&str> = token.splitn(2, '-').collect();
        let lo: u32 = parts[0]
            .parse()
            .map_err(|_| SchedulerError::CronParseError(format!("invalid range: {token}")))?;
        let hi: u32 = parts[1]
            .parse()
            .map_err(|_| SchedulerError::CronParseError(format!("invalid range: {token}")))?;
        if lo < min || hi > max || lo > hi {
            return Err(SchedulerError::CronParseError(format!(
                "range out of bounds: {token}"
            )));
        }
        return Ok(CronField::Range(lo, hi));
    }

    // Step from value: N/S
    if token.contains('/') {
        let parts: Vec<&str> = token.splitn(2, '/').collect();
        let start: u32 = parts[0]
            .parse()
            .map_err(|_| SchedulerError::CronParseError(format!("invalid step: {token}")))?;
        let step: u32 = parts[1]
            .parse()
            .map_err(|_| SchedulerError::CronParseError(format!("invalid step: {token}")))?;
        if start < min || start > max || step == 0 {
            return Err(SchedulerError::CronParseError(format!(
                "step out of range: {token}"
            )));
        }
        return Ok(CronField::Step { start, step });
    }

    // Exact value
    let val: u32 = token
        .parse()
        .map_err(|_| SchedulerError::CronParseError(format!("invalid value: {token}")))?;
    if val < min || val > max {
        return Err(SchedulerError::CronParseError(format!(
            "value {val} out of range [{min}–{max}]"
        )));
    }
    Ok(CronField::Exact(val))
}

// ─── Public API ─────────────────────────────────────────────────────

/// Parse a five-field cron expression string into a [`CronExpression`].
///
/// Fields: `minute(0-59) hour(0-23) day-of-month(1-31) month(1-12) day-of-week(0-6)`
pub fn parse(expr: &str) -> Result<CronExpression, SchedulerError> {
    let fields: Vec<&str> = expr.split_whitespace().collect();
    if fields.len() != 5 {
        return Err(SchedulerError::CronParseError(format!(
            "expected 5 fields, got {}",
            fields.len()
        )));
    }

    Ok(CronExpression {
        minute: parse_field(fields[0], 0, 59)?,
        hour: parse_field(fields[1], 0, 23)?,
        day_of_month: parse_field(fields[2], 1, 31)?,
        month: parse_field(fields[3], 1, 12)?,
        day_of_week: parse_field(fields[4], 0, 6)?,
    })
}

/// Validate a cron expression string without returning the parsed form.
pub fn validate(expr: &str) -> Result<(), SchedulerError> {
    parse(expr).map(|_| ())
}

/// Check whether `dt` matches the given cron expression.
pub fn matches(expr: &CronExpression, dt: &DateTime<Utc>) -> bool {
    let dow_chrono = dt.weekday().num_days_from_sunday(); // 0=Sun

    expr.minute.matches(dt.minute())
        && expr.hour.matches(dt.hour())
        && expr.day_of_month.matches(dt.day())
        && expr.month.matches(dt.month())
        && expr.day_of_week.matches(dow_chrono)
}

/// Find the next `DateTime<Utc>` **after** `after` that satisfies `expr`.
///
/// Walks forward minute-by-minute up to a maximum of ~4 years.
/// Returns `None` if no match is found within that window.
pub fn next_occurrence(expr: &CronExpression, after: &DateTime<Utc>) -> Option<DateTime<Utc>> {
    // Start from the next whole minute after `after`.
    let mut candidate = *after + Duration::minutes(1);
    // Zero out seconds & nanos.
    candidate = candidate
        .date_naive()
        .and_time(
            NaiveTime::from_hms_opt(candidate.hour(), candidate.minute(), 0)
                .unwrap_or_else(|| NaiveTime::from_hms_opt(0, 0, 0).unwrap()),
        )
        .and_utc();

    let limit = *after + Duration::days(366 * 4);

    while candidate < limit {
        // Month
        if !expr.month.matches(candidate.month()) {
            // Fast-forward to next month
            let next_month = expr.month.next_match(candidate.month() + 1, 1, 12);
            match next_month {
                Some(m) if m > candidate.month() => {
                    // jump to day 1, 00:00 of month m, same year
                    if let Some(d) = candidate
                        .date_naive()
                        .with_month(m)
                        .and_then(|d| d.with_day(1))
                    {
                        candidate = d.and_hms_opt(0, 0, 0).expect("midnight is always valid").and_utc();
                        continue;
                    }
                }
                _ => {
                    // Roll to next year, Jan 1
                    if let Some(d) = candidate
                        .date_naive()
                        .with_year(candidate.year() + 1)
                        .and_then(|d| d.with_month(1))
                        .and_then(|d| d.with_day(1))
                    {
                        candidate = d.and_hms_opt(0, 0, 0).expect("midnight is always valid").and_utc();
                        continue;
                    }
                }
            }
            candidate += Duration::minutes(1);
            continue;
        }

        // Day-of-month
        if !expr.day_of_month.matches(candidate.day()) {
            // (also check day_of_week later — both must match for traditional cron)
            candidate = (candidate.date_naive() + Duration::days(1))
                .and_hms_opt(0, 0, 0)
                .expect("midnight is always valid")
                .and_utc();
            continue;
        }

        // Day-of-week
        let dow = candidate.weekday().num_days_from_sunday();
        if !expr.day_of_week.matches(dow) {
            candidate = (candidate.date_naive() + Duration::days(1))
                .and_hms_opt(0, 0, 0)
                .expect("midnight is always valid")
                .and_utc();
            continue;
        }

        // Hour
        if !expr.hour.matches(candidate.hour()) {
            candidate += Duration::hours(1);
            // zero out minutes
            candidate = candidate
                .date_naive()
                .and_time(
                    NaiveTime::from_hms_opt(candidate.hour(), 0, 0)
                        .unwrap_or_else(|| NaiveTime::from_hms_opt(0, 0, 0).unwrap()),
                )
                .and_utc();
            continue;
        }

        // Minute
        if !expr.minute.matches(candidate.minute()) {
            candidate += Duration::minutes(1);
            continue;
        }

        return Some(candidate);
    }

    None
}

/// Compute the next N occurrences after `after`.
pub fn next_occurrences(
    expr: &CronExpression,
    after: &DateTime<Utc>,
    count: usize,
) -> Vec<DateTime<Utc>> {
    let mut results = Vec::with_capacity(count);
    let mut cursor = *after;
    for _ in 0..count {
        match next_occurrence(expr, &cursor) {
            Some(dt) => {
                results.push(dt);
                cursor = dt;
            }
            None => break,
        }
    }
    results
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn parse_every_5_minutes() {
        let expr = parse("*/5 * * * *").unwrap();
        assert_eq!(expr.minute, CronField::Step { start: 0, step: 5 });
        assert_eq!(expr.hour, CronField::Any);
    }

    #[test]
    fn parse_specific_time() {
        let expr = parse("30 9 * * 1-5").unwrap();
        assert_eq!(expr.minute, CronField::Exact(30));
        assert_eq!(expr.hour, CronField::Exact(9));
        assert_eq!(expr.day_of_week, CronField::Range(1, 5));
    }

    #[test]
    fn matches_every_minute() {
        let expr = parse("* * * * *").unwrap();
        let dt = Utc::now();
        assert!(matches(&expr, &dt));
    }

    #[test]
    fn next_occurrence_every_5_min() {
        let expr = parse("*/5 * * * *").unwrap();
        let after = Utc.with_ymd_and_hms(2025, 6, 15, 10, 3, 0).unwrap();
        let next = next_occurrence(&expr, &after).unwrap();
        assert_eq!(next.minute(), 5);
        assert_eq!(next.hour(), 10);
    }

    #[test]
    fn invalid_field_count() {
        assert!(parse("* * *").is_err());
    }

    #[test]
    fn validate_ok() {
        assert!(validate("0 12 * * *").is_ok());
    }

    #[test]
    fn validate_bad() {
        assert!(validate("60 * * * *").is_err());
    }

    #[test]
    fn next_occurrences_list() {
        let expr = parse("0 * * * *").unwrap();
        let after = Utc.with_ymd_and_hms(2025, 1, 1, 0, 0, 0).unwrap();
        let occ = next_occurrences(&expr, &after, 3);
        assert_eq!(occ.len(), 3);
        assert_eq!(occ[0].hour(), 1);
        assert_eq!(occ[1].hour(), 2);
        assert_eq!(occ[2].hour(), 3);
    }
}
