//! Backup job scheduler — schedule evaluation, next-run calculation. 
//!
//! Note: This is a simple evaluator; for real cron scheduling integration
//! the caller should use the sorng-scheduler crate alongside this one.

use crate::error::BackupError;
use crate::types::BackupSchedule;
use chrono::{DateTime, Datelike, NaiveTime, TimeZone, Utc, Weekday};
use log::debug;

/// Compute the next run time from "now" given a schedule.
pub fn next_run(schedule: &BackupSchedule, now: &DateTime<Utc>) -> Result<DateTime<Utc>, BackupError> {
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
            let candidate = Utc
                .from_utc_datetime(&candidate_date.and_time(t));
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
            // Simplified cron evaluation — parse "min hour dom mon dow"
            // For production, integrate with a proper cron library.
            debug!("Cron scheduling not fully implemented; using interval fallback for: {expression}");
            // Fallback: run in 1 hour
            Ok(*now + chrono::Duration::hours(1))
        }
    }
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
            let reference = last_run.copied().unwrap_or_else(|| {
                Utc.with_ymd_and_hms(2000, 1, 1, 0, 0, 0).unwrap()
            });
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
