//! Backup job scheduler — schedule evaluation, next-run calculation.
//!
//! Supports interval, daily, weekly, monthly, and cron schedules. Cron
//! expressions are evaluated via the `cron` crate. Standard 5-field cron
//! (`min hour dom mon dow`) is accepted and automatically normalised to the
//! 6-field form (`sec min hour dom mon dow`) the `cron` crate expects by
//! prepending `0` for the seconds field. 6- and 7-field expressions pass
//! through unchanged.

use crate::error::BackupError;
use crate::types::BackupSchedule;
use chrono::{DateTime, Datelike, NaiveTime, TimeZone, Utc, Weekday};
use cron::Schedule as CronSchedule;
use std::str::FromStr;

/// Compute the next run time from "now" given a schedule.
pub fn next_run(
    schedule: &BackupSchedule,
    now: &DateTime<Utc>,
) -> Result<DateTime<Utc>, BackupError> {
    match schedule {
        BackupSchedule::Interval { every_seconds } => {
            let dur = chrono::Duration::seconds(*every_seconds as i64);
            Ok(*now + dur)
        }
        BackupSchedule::Daily { time, timezone: _ } => {
            let t = parse_time(time)?;
            let today = now.date_naive().and_time(t);
            let candidate = Utc.from_utc_datetime(&today);
            if candidate > *now {
                Ok(candidate)
            } else {
                Ok(candidate + chrono::Duration::days(1))
            }
        }
        BackupSchedule::Weekly { day, time } => {
            let t = parse_time(time)?;
            let target_weekday = parse_weekday(day)?;
            let today_weekday = now.weekday();
            let days_ahead = (target_weekday.num_days_from_monday() as i64
                - today_weekday.num_days_from_monday() as i64
                + 7)
                % 7;
            let candidate_date = now.date_naive() + chrono::Duration::days(days_ahead);
            let candidate = Utc.from_utc_datetime(&candidate_date.and_time(t));
            if candidate > *now {
                Ok(candidate)
            } else {
                Ok(candidate + chrono::Duration::weeks(1))
            }
        }
        BackupSchedule::Monthly { day, time } => {
            let t = parse_time(time)?;
            let year = now.year();
            let month = now.month();
            let target_day = (*day).min(28) as u32; // cap at 28 for safety
            if let Some(date) = chrono::NaiveDate::from_ymd_opt(year, month, target_day) {
                let candidate = Utc.from_utc_datetime(&date.and_time(t));
                if candidate > *now {
                    return Ok(candidate);
                }
            }
            // Next month
            let (next_year, next_month) = if month == 12 {
                (year + 1, 1)
            } else {
                (year, month + 1)
            };
            if let Some(date) = chrono::NaiveDate::from_ymd_opt(next_year, next_month, target_day) {
                Ok(Utc.from_utc_datetime(&date.and_time(t)))
            } else {
                Err(BackupError::ScheduleError(format!(
                    "invalid monthly schedule: day={day}"
                )))
            }
        }
        BackupSchedule::Cron { expression } => {
            let schedule = parse_cron(expression)?;
            schedule
                .after(now)
                .next()
                .ok_or_else(|| {
                    BackupError::ScheduleError(format!(
                        "cron expression '{expression}' produced no future fire time"
                    ))
                })
        }
    }
}

/// Parse a cron expression.
///
/// Accepts:
/// * Standard 5-field cron: `min hour dom mon dow` (seconds implicitly `0`)
/// * 6-field cron: `sec min hour dom mon dow`
/// * 7-field cron: `sec min hour dom mon dow year`
///
/// 5-field expressions are normalised by prepending `0 ` (seconds) so the
/// underlying `cron` crate (which requires a seconds field) can parse them.
fn parse_cron(expression: &str) -> Result<CronSchedule, BackupError> {
    let trimmed = expression.trim();
    if trimmed.is_empty() {
        return Err(BackupError::ScheduleError(
            "cron expression is empty".to_string(),
        ));
    }
    let field_count = trimmed.split_whitespace().count();
    let normalised: String = match field_count {
        5 => format!("0 {trimmed}"),
        6 | 7 => trimmed.to_string(),
        n => {
            return Err(BackupError::ScheduleError(format!(
                "cron expression '{expression}' has {n} fields; expected 5, 6, or 7"
            )))
        }
    };
    CronSchedule::from_str(&normalised).map_err(|e| {
        BackupError::ScheduleError(format!("invalid cron expression '{expression}': {e}"))
    })
}

/// Check if a job should run now (within a tolerance window).
pub fn should_run_now(
    schedule: &BackupSchedule,
    now: &DateTime<Utc>,
    last_run: Option<&DateTime<Utc>>,
    tolerance_secs: i64,
) -> bool {
    match schedule {
        BackupSchedule::Interval { every_seconds } => {
            if let Some(lr) = last_run {
                let elapsed = (*now - *lr).num_seconds();
                elapsed >= *every_seconds as i64
            } else {
                true // never run before
            }
        }
        _ => {
            // Compute next_run from last_run (or epoch), check if it's within tolerance of now
            let reference = last_run
                .copied()
                .unwrap_or_else(|| Utc.with_ymd_and_hms(2000, 1, 1, 0, 0, 0).unwrap());
            if let Ok(next) = next_run(schedule, &reference) {
                let diff = (*now - next).num_seconds().abs();
                diff <= tolerance_secs
            } else {
                false
            }
        }
    }
}

/// Parse a time string "HH:MM" or "HH:MM:SS" into NaiveTime.
fn parse_time(s: &str) -> Result<NaiveTime, BackupError> {
    NaiveTime::parse_from_str(s, "%H:%M:%S")
        .or_else(|_| NaiveTime::parse_from_str(s, "%H:%M"))
        .map_err(|e| BackupError::ScheduleError(format!("invalid time '{s}': {e}")))
}

/// Parse a weekday name.
fn parse_weekday(s: &str) -> Result<Weekday, BackupError> {
    match s.to_lowercase().as_str() {
        "monday" | "mon" => Ok(Weekday::Mon),
        "tuesday" | "tue" => Ok(Weekday::Tue),
        "wednesday" | "wed" => Ok(Weekday::Wed),
        "thursday" | "thu" => Ok(Weekday::Thu),
        "friday" | "fri" => Ok(Weekday::Fri),
        "saturday" | "sat" => Ok(Weekday::Sat),
        "sunday" | "sun" => Ok(Weekday::Sun),
        _ => Err(BackupError::ScheduleError(format!(
            "invalid weekday: '{s}'"
        ))),
    }
}

// ─── Tests ──────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn at(y: i32, m: u32, d: u32, h: u32, min: u32, s: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(y, m, d, h, min, s).unwrap()
    }

    #[test]
    fn cron_5_field_daily_at_9am() {
        // Every day at 09:00 (5-field: min hour dom mon dow)
        let schedule = BackupSchedule::Cron {
            expression: "0 9 * * *".to_string(),
        };
        // Now is 2025-01-01 08:00:00 UTC -> next fire 09:00 the same day.
        let now = at(2025, 1, 1, 8, 0, 0);
        let next = next_run(&schedule, &now).expect("cron should parse");
        assert_eq!(next, at(2025, 1, 1, 9, 0, 0));

        // Now is 10:00 -> next fire is tomorrow 09:00.
        let now = at(2025, 1, 1, 10, 0, 0);
        let next = next_run(&schedule, &now).unwrap();
        assert_eq!(next, at(2025, 1, 2, 9, 0, 0));
    }

    #[test]
    fn cron_6_field_with_seconds() {
        // 30 seconds past every minute.
        let schedule = BackupSchedule::Cron {
            expression: "30 * * * * *".to_string(),
        };
        let now = at(2025, 1, 1, 12, 0, 0);
        let next = next_run(&schedule, &now).unwrap();
        assert_eq!(next, at(2025, 1, 1, 12, 0, 30));
    }

    #[test]
    fn cron_invalid_expression_errors() {
        let schedule = BackupSchedule::Cron {
            expression: "not a cron".to_string(),
        };
        let now = at(2025, 1, 1, 0, 0, 0);
        let err = next_run(&schedule, &now).unwrap_err();
        assert!(matches!(err, BackupError::ScheduleError(_)));
    }

    #[test]
    fn cron_wrong_field_count_errors() {
        let schedule = BackupSchedule::Cron {
            expression: "* *".to_string(),
        };
        let now = at(2025, 1, 1, 0, 0, 0);
        let err = next_run(&schedule, &now).unwrap_err();
        let BackupError::ScheduleError(msg) = &err else {
            unreachable!("expected ScheduleError, got {err:?}")
        };
        assert!(msg.contains("fields"));
    }

    #[test]
    fn cron_empty_expression_errors() {
        let schedule = BackupSchedule::Cron {
            expression: "   ".to_string(),
        };
        let now = at(2025, 1, 1, 0, 0, 0);
        assert!(next_run(&schedule, &now).is_err());
    }

    #[test]
    fn should_run_now_cron_within_tolerance() {
        // Every hour on the hour.
        let schedule = BackupSchedule::Cron {
            expression: "0 * * * *".to_string(),
        };
        let last_run = at(2025, 1, 1, 9, 0, 0);
        // It's 10:00:05 — within a 60s tolerance of the 10:00 fire.
        let now = at(2025, 1, 1, 10, 0, 5);
        assert!(should_run_now(&schedule, &now, Some(&last_run), 60));

        // It's 10:30 — well past the tolerance.
        let now = at(2025, 1, 1, 10, 30, 0);
        assert!(!should_run_now(&schedule, &now, Some(&last_run), 60));
    }

    #[test]
    fn interval_schedule_unchanged() {
        let schedule = BackupSchedule::Interval { every_seconds: 60 };
        let now = at(2025, 1, 1, 0, 0, 0);
        let next = next_run(&schedule, &now).unwrap();
        assert_eq!(next, at(2025, 1, 1, 0, 1, 0));
    }
}
