//! Hardware clock (RTC) management — hwclock, /etc/adjtime.
use crate::client;
use crate::error::TimeNtpError;
use crate::types::TimeHost;
use chrono::{DateTime, NaiveDateTime, Utc};

/// Read the hardware clock time (`hwclock --show`).
pub async fn get_hwclock(host: &TimeHost) -> Result<DateTime<Utc>, TimeNtpError> {
    let out = client::exec_ok(host, "hwclock", &["--show", "--utc"]).await?;
    parse_hwclock_output(&out)
}

/// Set the hardware clock from the current system time (`hwclock --systohc`).
pub async fn set_hwclock_from_system(host: &TimeHost) -> Result<(), TimeNtpError> {
    client::exec_ok(host, "hwclock", &["--systohc", "--utc"]).await?;
    Ok(())
}

/// Set the system clock from the hardware clock (`hwclock --hctosys`).
pub async fn set_system_from_hwclock(host: &TimeHost) -> Result<(), TimeNtpError> {
    client::exec_ok(host, "hwclock", &["--hctosys", "--utc"]).await?;
    Ok(())
}

/// Set the hardware clock to a specific time (`hwclock --set --date`).
pub async fn set_hwclock(host: &TimeHost, time: DateTime<Utc>) -> Result<(), TimeNtpError> {
    let formatted = time.format("%Y-%m-%d %H:%M:%S").to_string();
    client::exec_ok(host, "hwclock", &["--set", "--date", &formatted, "--utc"]).await?;
    Ok(())
}

/// Read the hardware clock drift factor from `/etc/adjtime`.
///
/// `/etc/adjtime` format (3 lines):
/// ```text
/// <drift_factor> <last_adjust_time> <adjust_status>
/// <last_calibration_time>
/// UTC|LOCAL
/// ```
pub async fn get_hwclock_drift(host: &TimeHost) -> Result<f64, TimeNtpError> {
    let content = client::read_file(host, "/etc/adjtime").await?;
    parse_adjtime_drift(&content)
}

// ─── Parsing helpers ────────────────────────────────────────────────

/// Parse `hwclock --show` output.
/// Common formats:
///   - "2024-01-19 14:30:00.123456+00:00"
///   - "Fri 19 Jan 2024 02:30:00 PM UTC  .123456 seconds"
fn parse_hwclock_output(output: &str) -> Result<DateTime<Utc>, TimeNtpError> {
    let line = output.lines().next().unwrap_or("").trim();
    if line.is_empty() {
        return Err(TimeNtpError::ParseError("Empty hwclock output".into()));
    }

    // Try ISO-ish format first: "2024-01-19 14:30:00.123456+00:00"
    if let Some(dt) = try_parse_iso_hwclock(line) {
        return Ok(dt);
    }

    // Try verbose format: "Fri 19 Jan 2024 02:30:00 PM UTC  .123456 seconds"
    // Strip the fractional seconds part at the end
    let cleaned = if let Some(pos) = line.find("  .") {
        &line[..pos]
    } else {
        line
    };
    // Strip trailing timezone abbreviation for NaiveDateTime parsing
    let cleaned = cleaned.trim();

    // Try several common patterns
    for fmt in &[
        "%a %d %b %Y %I:%M:%S %p %Z",
        "%a %d %b %Y %H:%M:%S %Z",
        "%Y-%m-%d %H:%M:%S",
        "%a %b %d %H:%M:%S %Y",
    ] {
        if let Ok(ndt) = NaiveDateTime::parse_from_str(cleaned, fmt) {
            return Ok(ndt.and_utc());
        }
    }

    // Last resort: just try to pull YYYY-MM-DD HH:MM:SS from anywhere in the string
    if line.len() >= 19 {
        for i in 0..line.len().saturating_sub(18) {
            let sub = &line[i..i + 19];
            if let Ok(ndt) = NaiveDateTime::parse_from_str(sub, "%Y-%m-%d %H:%M:%S") {
                return Ok(ndt.and_utc());
            }
        }
    }

    Err(TimeNtpError::ParseError(format!(
        "Cannot parse hwclock output: {line}"
    )))
}

fn try_parse_iso_hwclock(s: &str) -> Option<DateTime<Utc>> {
    // "2024-01-19 14:30:00.123456+00:00" (or without fractional seconds)
    // chrono's DateTime::parse_from_str with fixed offset then convert
    if let Ok(dt) = chrono::DateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S%.f%:z") {
        return Some(dt.with_timezone(&Utc));
    }
    if let Ok(dt) = chrono::DateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S%:z") {
        return Some(dt.with_timezone(&Utc));
    }
    None
}

/// Parse drift factor from /etc/adjtime first line.
fn parse_adjtime_drift(content: &str) -> Result<f64, TimeNtpError> {
    let first_line = content.lines().next().unwrap_or("").trim();
    if first_line.is_empty() {
        return Err(TimeNtpError::ParseError("Empty /etc/adjtime".into()));
    }
    let drift_str = first_line.split_whitespace().next().unwrap_or("0");
    drift_str.parse::<f64>().map_err(|e| {
        TimeNtpError::ParseError(format!("Cannot parse drift factor '{drift_str}': {e}"))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_hwclock_iso() {
        let out = "2024-01-19 14:30:00.123456+00:00\n";
        let dt = parse_hwclock_output(out).unwrap();
        assert_eq!(
            dt.format("%Y-%m-%d %H:%M:%S").to_string(),
            "2024-01-19 14:30:00"
        );
    }

    #[test]
    fn test_parse_hwclock_verbose() {
        let out = "Fri 19 Jan 2024 02:30:00 PM UTC  .123456 seconds\n";
        let dt = parse_hwclock_output(out).unwrap();
        assert_eq!(dt.format("%Y-%m-%d").to_string(), "2024-01-19");
    }

    #[test]
    fn test_parse_hwclock_plain() {
        let out = "2024-01-19 14:30:00\n";
        let dt = parse_hwclock_output(out).unwrap();
        assert_eq!(dt.format("%H:%M:%S").to_string(), "14:30:00");
    }

    #[test]
    fn test_parse_adjtime_drift() {
        let content = "0.000123 1705672200 0\n1705672200\nUTC\n";
        let drift = parse_adjtime_drift(content).unwrap();
        assert!((drift - 0.000123).abs() < 1e-9);
    }

    #[test]
    fn test_parse_adjtime_zero() {
        let content = "0.0 0 0\n0\nUTC\n";
        let drift = parse_adjtime_drift(content).unwrap();
        assert!((drift).abs() < 1e-9);
    }

    #[test]
    fn test_parse_adjtime_negative() {
        let content = "-1.234567 1705672200 0\n1705672200\nLOCAL\n";
        let drift = parse_adjtime_drift(content).unwrap();
        assert!((drift - (-1.234567)).abs() < 1e-9);
    }
}
