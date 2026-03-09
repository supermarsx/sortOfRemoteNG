//! systemd timedatectl wrapper — time status, timezone, NTP toggle, RTC.
use crate::client;
use crate::error::TimeNtpError;
use crate::types::{SystemTime, TimeHost, TimezoneInfo};
use chrono::{DateTime, NaiveDateTime, Utc};

/// Parse `timedatectl status` output into a `SystemTime` struct.
pub async fn get_time_status(host: &TimeHost) -> Result<SystemTime, TimeNtpError> {
    let out = client::exec_ok(host, "timedatectl", &["status"]).await?;
    parse_timedatectl_status(&out)
}

/// Set the system timezone (e.g. "America/New_York").
pub async fn set_timezone(host: &TimeHost, tz: &str) -> Result<(), TimeNtpError> {
    // Validate the timezone first
    let tzs = list_timezones(host).await?;
    if !tzs.iter().any(|t| t.name == tz) {
        return Err(TimeNtpError::InvalidTimezone(tz.into()));
    }
    client::exec_ok(host, "timedatectl", &["set-timezone", tz]).await?;
    Ok(())
}

/// List all available timezones with basic info.
pub async fn list_timezones(host: &TimeHost) -> Result<Vec<TimezoneInfo>, TimeNtpError> {
    let out = client::exec_ok(host, "timedatectl", &["list-timezones"]).await?;
    Ok(out
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|name| TimezoneInfo {
            name: name.trim().to_string(),
            offset: String::new(),
            abbreviation: String::new(),
            is_dst: false,
        })
        .collect())
}

/// Set the system time manually (disables NTP first if needed).
pub async fn set_time(host: &TimeHost, time: DateTime<Utc>) -> Result<(), TimeNtpError> {
    let formatted = time.format("%Y-%m-%d %H:%M:%S").to_string();
    client::exec_ok(host, "timedatectl", &["set-time", &formatted]).await?;
    Ok(())
}

/// Enable or disable NTP synchronization.
pub async fn set_ntp(host: &TimeHost, enabled: bool) -> Result<(), TimeNtpError> {
    let val = if enabled { "true" } else { "false" };
    client::exec_ok(host, "timedatectl", &["set-ntp", val]).await?;
    Ok(())
}

/// Configure whether the RTC is in local time or UTC.
pub async fn set_rtc_local(host: &TimeHost, local: bool) -> Result<(), TimeNtpError> {
    let val = if local { "1" } else { "0" };
    client::exec_ok(host, "timedatectl", &["set-local-rtc", val]).await?;
    Ok(())
}

// ─── Parsing ────────────────────────────────────────────────────────

fn parse_timedatectl_status(output: &str) -> Result<SystemTime, TimeNtpError> {
    let mut current_time: Option<DateTime<Utc>> = None;
    let mut timezone = String::new();
    let mut timezone_offset = String::new();
    let mut utc_time: Option<DateTime<Utc>> = None;
    let mut rtc_time: Option<DateTime<Utc>> = None;
    let mut ntp_enabled = false;
    let mut ntp_synced = false;
    let mut rtc_in_local_tz = false;

    for line in output.lines() {
        let line = line.trim();
        if let Some((key, val)) = line.split_once(':') {
            let key = key.trim();
            let val = val.trim();
            match key {
                "Local time" | "Universal time" | "RTC time" => {
                    // Format: "Fri 2024-01-19 14:30:00 UTC"
                    let dt = parse_timedatectl_datetime(val);
                    match key {
                        "Local time" => current_time = dt,
                        "Universal time" => utc_time = dt,
                        "RTC time" => rtc_time = dt,
                        _ => {}
                    }
                }
                "Time zone" => {
                    // Format: "America/New_York (EST, -0500)"
                    if let Some((tz_name, rest)) = val.split_once(' ') {
                        timezone = tz_name.to_string();
                        timezone_offset = rest.trim_matches(|c| c == '(' || c == ')').to_string();
                    } else {
                        timezone = val.to_string();
                    }
                }
                "System clock synchronized" | "NTP synchronized" => {
                    ntp_synced = val == "yes";
                }
                "NTP enabled" | "NTP service" | "systemd-timesyncd.service active" => {
                    ntp_enabled = val == "yes" || val == "active";
                }
                "RTC in local TZ" => {
                    rtc_in_local_tz = val == "yes";
                }
                _ => {}
            }
        }
    }

    let now = Utc::now();
    Ok(SystemTime {
        current_time: current_time.unwrap_or(now),
        timezone,
        timezone_offset,
        utc_time: utc_time.unwrap_or(now),
        rtc_time,
        ntp_enabled,
        ntp_synced,
        rtc_in_local_tz,
    })
}

/// Parse a timedatectl datetime string — e.g. "Fri 2024-01-19 14:30:00 UTC".
fn parse_timedatectl_datetime(s: &str) -> Option<DateTime<Utc>> {
    // Strip leading day-of-week abbreviation if present (e.g. "Fri ")
    let s = s.trim();
    let s = if s.len() > 4 && s.as_bytes()[3] == b' ' {
        &s[4..]
    } else {
        s
    };
    // Strip trailing timezone abbreviation — keep only "YYYY-MM-DD HH:MM:SS"
    let s = s.trim();
    let date_part = if s.len() >= 19 { &s[..19] } else { s };
    NaiveDateTime::parse_from_str(date_part, "%Y-%m-%d %H:%M:%S")
        .ok()
        .map(|ndt| ndt.and_utc())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_timedatectl_status() {
        let input = "\
               Local time: Fri 2024-01-19 09:30:00 EST
           Universal time: Fri 2024-01-19 14:30:00 UTC
                 RTC time: Fri 2024-01-19 14:30:00
                Time zone: America/New_York (EST, -0500)
System clock synchronized: yes
              NTP service: active
          RTC in local TZ: no
";
        let st = parse_timedatectl_status(input).unwrap();
        assert_eq!(st.timezone, "America/New_York");
        assert!(st.ntp_synced);
        assert!(st.ntp_enabled);
        assert!(!st.rtc_in_local_tz);
        assert!(st.rtc_time.is_some());
    }

    #[test]
    fn test_parse_datetime() {
        let dt = parse_timedatectl_datetime("Fri 2024-01-19 14:30:00 UTC");
        assert!(dt.is_some());
        let dt = dt.unwrap();
        assert_eq!(
            dt.format("%Y-%m-%d %H:%M:%S").to_string(),
            "2024-01-19 14:30:00"
        );
    }

    #[test]
    fn test_parse_datetime_no_dow() {
        let dt = parse_timedatectl_datetime("2024-01-19 14:30:00");
        assert!(dt.is_some());
    }
}
