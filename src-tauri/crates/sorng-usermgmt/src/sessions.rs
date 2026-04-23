//! Login session tracking — last, lastlog, who, w.

use crate::client;
use crate::error::UserMgmtError;
use crate::types::*;
use chrono::{NaiveDateTime, TimeZone, Utc};

/// Get login history via `last`.
pub async fn login_history(
    host: &UserMgmtHost,
    count: Option<u32>,
) -> Result<Vec<LoginSession>, UserMgmtError> {
    let mut args = vec!["-F"];
    let n_str;
    if let Some(n) = count {
        n_str = n.to_string();
        args.push("-n");
        args.push(&n_str);
    }
    let stdout = client::exec_ok(host, "last", &args).await?;
    Ok(parse_last_output(&stdout))
}

/// Get last login times via `lastlog`.
pub async fn last_logins(host: &UserMgmtHost) -> Result<Vec<LastLogin>, UserMgmtError> {
    let stdout = client::exec_ok(host, "lastlog", &[]).await?;
    Ok(parse_lastlog_output(&stdout))
}

/// Get currently active sessions via `who`.
pub async fn active_sessions(host: &UserMgmtHost) -> Result<Vec<ActiveSession>, UserMgmtError> {
    let stdout = client::exec_ok(host, "who", &[]).await?;
    Ok(parse_who_output(&stdout))
}

/// Parse `last -F` output.
///
/// Format: `user  tty   host   Mon Jan  1 12:00:00 2024 - Mon Jan  1 13:00:00 2024  (01:00)`
/// or:     `user  tty   host   Mon Jan  1 12:00:00 2024   still logged in`
/// Reboot lines: `reboot   system boot  5.15.0-91  Mon Jan  1 12:00:00 2024   still running`
/// Blank/summary lines at the end are skipped.
fn parse_last_output(output: &str) -> Vec<LoginSession> {
    let mut sessions = Vec::new();
    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with("wtmp begins") || line.starts_with("btmp begins") {
            continue;
        }

        // Split into whitespace-delimited tokens
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 5 {
            continue;
        }

        let username = parts[0].to_string();

        // Detect reboot/shutdown pseudo-entries
        let (session_type, terminal, host_start_idx) = if username == "reboot" {
            (SessionType::Reboot, parts[1].to_string(), 2)
        } else if username == "shutdown" {
            (SessionType::Shutdown, parts[1].to_string(), 2)
        } else {
            let terminal = parts[1].to_string();
            let stype = classify_session_type(&terminal, parts.get(2).copied());
            (stype, terminal, 2)
        };

        // The host field may or may not be present. Try to find the start of the
        // timestamp by looking for a day-of-week abbreviation (Mon, Tue, ...).
        let (remote_host, ts_start) = find_timestamp_start(&parts, host_start_idx);

        if ts_start >= parts.len() {
            continue;
        }

        // Parse login timestamp: "Mon Jan  1 12:00:00 2024"
        // That's 5 tokens: DOW MON DAY HH:MM:SS YEAR
        let login_time = parse_full_timestamp(&parts, ts_start);
        let login_time = match login_time {
            Some(t) => t,
            None => continue,
        };

        // Check for "still logged in" / "still running" or a logout timestamp after " - "
        let still_active;
        let logout_time;
        let duration_secs;

        // Find the dash separator after the login timestamp
        let after_login = ts_start + 5;
        if after_login < parts.len() && parts[after_login] == "-" {
            still_active = false;
            let logout_ts_start = after_login + 1;
            logout_time = parse_full_timestamp(&parts, logout_ts_start);
            duration_secs = logout_time.map(|lt| (lt - login_time).num_seconds().unsigned_abs());
        } else if parts[after_login..]
            .iter()
            .any(|&p| p == "logged" || p == "running")
        {
            still_active = true;
            logout_time = None;
            duration_secs = None;
        } else {
            still_active = false;
            logout_time = None;
            duration_secs = None;
        }

        sessions.push(LoginSession {
            username,
            terminal,
            remote_host,
            login_time,
            logout_time,
            duration_secs,
            session_type,
            still_active,
        });
    }
    sessions
}

/// Parse `lastlog` output.
///
/// Format (header then data):
/// ```text
/// Username         Port     From             Latest
/// root             pts/0    192.168.1.1      Mon Jan  1 12:00:00 +0000 2024
/// daemon                                     **Never logged in**
/// ```
fn parse_lastlog_output(output: &str) -> Vec<LastLogin> {
    let mut logins = Vec::new();
    let mut lines = output.lines();

    // Skip the header line
    if lines.next().is_none() {
        return logins;
    }

    for line in lines {
        if line.trim().is_empty() {
            continue;
        }

        // lastlog uses fixed-width columns. Username is left-aligned in first ~24 chars,
        // but widths vary. Parse by detecting "**Never logged in**" first.
        if line.contains("**Never logged in**") {
            let username = line.split_whitespace().next().unwrap_or("").to_string();
            if !username.is_empty() {
                logins.push(LastLogin {
                    username,
                    port: None,
                    from_host: None,
                    time: None,
                    never_logged_in: true,
                });
            }
            continue;
        }

        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 5 {
            continue;
        }

        let username = parts[0].to_string();

        // Try to find timestamp start (day-of-week abbreviation)
        let (port, from_host, ts_start) = {
            let mut ts_idx = 1;
            let mut port = None;
            let mut from = None;

            // Parts 1 and 2 may be port and from_host, or the timestamp may start
            // at position 1, 2, or 3 depending on column contents.
            for (i, part) in parts
                .iter()
                .enumerate()
                .take(parts.len().min(4))
                .skip(1)
            {
                if is_day_of_week(part) {
                    ts_idx = i;
                    break;
                }
                if port.is_none() {
                    port = Some(part.to_string());
                } else if from.is_none() {
                    from = Some(part.to_string());
                }
                ts_idx = i + 1;
            }
            (port, from, ts_idx)
        };

        // Parse timestamp: "Mon Jan  1 12:00:00 +0000 2024" or "Mon Jan  1 12:00:00 2024"
        let time = parse_lastlog_timestamp(&parts, ts_start);

        logins.push(LastLogin {
            username,
            port,
            from_host,
            time,
            never_logged_in: false,
        });
    }
    logins
}

/// Parse `who` output.
///
/// Format: `user  tty   YYYY-MM-DD HH:MM (host)`
/// or:     `user  tty   Mon  1 12:00 (host)`
fn parse_who_output(output: &str) -> Vec<ActiveSession> {
    let mut sessions = Vec::new();
    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 3 {
            continue;
        }

        let username = parts[0].to_string();
        let terminal = parts[1].to_string();

        // Extract remote host from parenthesized field at the end
        let remote_host = line
            .rfind('(')
            .and_then(|start| {
                line[start..].rfind(')').map(|end| {
                    let h = line[start + 1..start + end].trim().to_string();
                    if h.is_empty() || h == ":0" {
                        None
                    } else {
                        Some(h)
                    }
                })
            })
            .flatten();

        // Parse login time. `who` outputs either "YYYY-MM-DD HH:MM" or abbreviated.
        let login_time = parse_who_timestamp(&parts[2..]);
        let login_time = match login_time {
            Some(t) => t,
            None => continue,
        };

        sessions.push(ActiveSession {
            username,
            terminal,
            remote_host,
            login_time,
            idle_time: None,
            current_process: None,
            cpu_time: None,
        });
    }
    sessions
}

// ─── Helpers ────────────────────────────────────────────────────────

fn is_day_of_week(s: &str) -> bool {
    matches!(s, "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun")
}

fn classify_session_type(terminal: &str, host_hint: Option<&str>) -> SessionType {
    if terminal.starts_with("pts/") {
        if host_hint.is_some_and(|h| !h.is_empty() && h != ":0") {
            SessionType::Ssh
        } else {
            SessionType::Console
        }
    } else if terminal.starts_with("tty") {
        SessionType::Console
    } else if terminal.starts_with(":") {
        SessionType::Gui
    } else {
        SessionType::Unknown
    }
}

/// Scan parts starting at `from_idx` for the first day-of-week token.
/// Returns (remote_host if any tokens before the DOW, index of DOW token).
fn find_timestamp_start(parts: &[&str], from_idx: usize) -> (Option<String>, usize) {
    for i in from_idx..parts.len() {
        if is_day_of_week(parts[i]) {
            let host = if i > from_idx {
                Some(parts[from_idx].to_string())
            } else {
                None
            };
            return (host, i);
        }
    }
    (None, parts.len())
}

/// Parse "Mon Jan  1 12:00:00 2024" from 5 consecutive tokens.
fn parse_full_timestamp(parts: &[&str], start: usize) -> Option<chrono::DateTime<Utc>> {
    if start + 5 > parts.len() {
        return None;
    }
    // DOW Mon Day HH:MM:SS Year
    let s = format!(
        "{} {} {} {} {}",
        parts[start],
        parts[start + 1],
        parts[start + 2],
        parts[start + 3],
        parts[start + 4]
    );
    NaiveDateTime::parse_from_str(&s, "%a %b %e %H:%M:%S %Y")
        .ok()
        .map(|ndt| Utc.from_utc_datetime(&ndt))
}

/// Parse lastlog timestamp which may include a timezone offset.
fn parse_lastlog_timestamp(parts: &[&str], start: usize) -> Option<chrono::DateTime<Utc>> {
    // Try "DOW Mon Day HH:MM:SS +ZZZZ Year" (7 tokens) first
    if start + 6 <= parts.len() {
        let s = format!(
            "{} {} {} {} {} {}",
            parts[start],
            parts[start + 1],
            parts[start + 2],
            parts[start + 3],
            parts[start + 4],
            parts[start + 5]
        );
        if let Ok(dt) = chrono::DateTime::parse_from_str(&s, "%a %b %e %H:%M:%S %z %Y") {
            return Some(dt.with_timezone(&Utc));
        }
    }
    // Fall back to 5-token format without timezone
    parse_full_timestamp(parts, start)
}

/// Parse `who`-style timestamp: either "YYYY-MM-DD HH:MM" or "Mon Day HH:MM".
fn parse_who_timestamp(parts: &[&str]) -> Option<chrono::DateTime<Utc>> {
    if parts.is_empty() {
        return None;
    }
    // Try "YYYY-MM-DD HH:MM"
    if parts.len() >= 2 && parts[0].contains('-') {
        let s = format!("{} {}", parts[0], parts[1]);
        if let Ok(ndt) = NaiveDateTime::parse_from_str(&s, "%Y-%m-%d %H:%M") {
            return Some(Utc.from_utc_datetime(&ndt));
        }
    }
    // Try "Mon Day HH:MM" (no year — assume current year)
    if parts.len() >= 3 && is_day_of_week(parts[0]) {
        let year = Utc::now().format("%Y");
        let s = format!("{} {} {} {}", parts[0], parts[1], parts[2], year);
        if let Ok(ndt) = NaiveDateTime::parse_from_str(&s, "%a %b %e %H:%M %Y") {
            return Some(Utc.from_utc_datetime(&ndt));
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_last_output() {
        let input = "\
root     pts/0        192.168.1.1      Mon Jan  1 12:00:00 2024 - Mon Jan  1 13:00:00 2024  (01:00)
admin    tty1                          Tue Jan  2 08:30:00 2024   still logged in
reboot   system boot  5.15.0-91        Wed Jan  3 00:00:00 2024   still running

wtmp begins Mon Jan  1 00:00:00 2024";

        let sessions = parse_last_output(input);
        assert_eq!(sessions.len(), 3);

        assert_eq!(sessions[0].username, "root");
        assert_eq!(sessions[0].terminal, "pts/0");
        assert_eq!(sessions[0].remote_host, Some("192.168.1.1".into()));
        assert!(!sessions[0].still_active);
        assert_eq!(sessions[0].session_type, SessionType::Ssh);
        assert_eq!(sessions[0].duration_secs, Some(3600));

        assert_eq!(sessions[1].username, "admin");
        assert!(sessions[1].still_active);
        assert_eq!(sessions[1].session_type, SessionType::Console);

        assert_eq!(sessions[2].username, "reboot");
        assert_eq!(sessions[2].session_type, SessionType::Reboot);
    }

    #[test]
    fn test_parse_lastlog_output() {
        let input = "\
Username         Port     From             Latest
root             pts/0    192.168.1.1      Mon Jan  1 12:00:00 2024
daemon                                     **Never logged in**";

        let logins = parse_lastlog_output(input);
        assert_eq!(logins.len(), 2);

        assert_eq!(logins[0].username, "root");
        assert_eq!(logins[0].port, Some("pts/0".into()));
        assert!(!logins[0].never_logged_in);
        assert!(logins[0].time.is_some());

        assert_eq!(logins[1].username, "daemon");
        assert!(logins[1].never_logged_in);
        assert!(logins[1].time.is_none());
    }

    #[test]
    fn test_parse_who_output() {
        let input = "\
root     pts/0        2024-01-01 12:00 (192.168.1.1)
admin    tty1         2024-01-02 08:30";

        let sessions = parse_who_output(input);
        assert_eq!(sessions.len(), 2);

        assert_eq!(sessions[0].username, "root");
        assert_eq!(sessions[0].terminal, "pts/0");
        assert_eq!(sessions[0].remote_host, Some("192.168.1.1".into()));

        assert_eq!(sessions[1].username, "admin");
        assert_eq!(sessions[1].terminal, "tty1");
        assert!(sessions[1].remote_host.is_none());
    }

    // ── Edge cases ───────────────────────────────────────────

    #[test]
    fn parse_last_empty_input() {
        assert!(parse_last_output("").is_empty());
    }

    #[test]
    fn parse_last_only_wtmp_line() {
        assert!(parse_last_output("wtmp begins Mon Jan  1 00:00:00 2024").is_empty());
    }

    #[test]
    fn parse_last_shutdown_entry() {
        let input = "shutdown system down  5.15.0-91  Mon Jan  1 14:00:00 2024 - Mon Jan  1 14:05:00 2024  (00:05)";
        let sessions = parse_last_output(input);
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].session_type, SessionType::Shutdown);
        assert!(!sessions[0].still_active);
    }

    #[test]
    fn parse_last_duration_calculated() {
        let input = "alice    pts/1        10.0.0.5         Mon Jan  1 10:00:00 2024 - Mon Jan  1 12:30:00 2024  (02:30)";
        let sessions = parse_last_output(input);
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].duration_secs, Some(9000)); // 2.5 hours
    }

    #[test]
    fn parse_last_ssh_vs_console_classification() {
        let input = "\
remote   pts/0        10.0.0.1         Mon Jan  1 10:00:00 2024   still logged in
local    tty1                          Mon Jan  1 10:00:00 2024   still logged in";
        let sessions = parse_last_output(input);
        assert_eq!(sessions[0].session_type, SessionType::Ssh);
        assert_eq!(sessions[1].session_type, SessionType::Console);
    }

    #[test]
    fn parse_last_malformed_line_skipped() {
        let input = "short";
        assert!(parse_last_output(input).is_empty());
    }

    #[test]
    fn parse_lastlog_empty_input() {
        assert!(parse_lastlog_output("").is_empty());
    }

    #[test]
    fn parse_lastlog_header_only() {
        assert!(
            parse_lastlog_output("Username         Port     From             Latest").is_empty()
        );
    }

    #[test]
    fn parse_lastlog_with_timezone_offset() {
        let input = "\
Username         Port     From             Latest
root             pts/0    10.0.0.1         Mon Jan  1 12:00:00 +0000 2024";
        let logins = parse_lastlog_output(input);
        assert_eq!(logins.len(), 1);
        assert!(logins[0].time.is_some());
        assert!(!logins[0].never_logged_in);
    }

    #[test]
    fn parse_lastlog_all_never_logged_in() {
        let input = "\
Username         Port     From             Latest
nobody                                     **Never logged in**
daemon                                     **Never logged in**";
        let logins = parse_lastlog_output(input);
        assert_eq!(logins.len(), 2);
        assert!(logins.iter().all(|l| l.never_logged_in));
    }

    #[test]
    fn parse_who_empty_input() {
        assert!(parse_who_output("").is_empty());
    }

    #[test]
    fn parse_who_local_display_excluded() {
        // :0 should not be treated as a remote host
        let input = "user     tty7         2024-01-01 10:00 (:0)";
        let sessions = parse_who_output(input);
        assert_eq!(sessions.len(), 1);
        assert!(sessions[0].remote_host.is_none());
    }

    #[test]
    fn parse_who_multiple_sessions() {
        let input = "\
root     pts/0        2024-06-15 09:00 (10.0.0.1)
root     pts/1        2024-06-15 09:30 (10.0.0.2)
admin    pts/2        2024-06-15 10:00 (10.0.0.3)";
        let sessions = parse_who_output(input);
        assert_eq!(sessions.len(), 3);
        assert_eq!(sessions[2].remote_host, Some("10.0.0.3".into()));
    }

    // ── Helper unit tests ────────────────────────────────────

    #[test]
    fn is_day_of_week_valid() {
        for d in ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] {
            assert!(is_day_of_week(d), "{} should be recognized", d);
        }
    }

    #[test]
    fn is_day_of_week_invalid() {
        assert!(!is_day_of_week("Monday"));
        assert!(!is_day_of_week("mon"));
        assert!(!is_day_of_week(""));
    }

    #[test]
    fn classify_pts_with_host_is_ssh() {
        assert_eq!(
            classify_session_type("pts/0", Some("10.0.0.1")),
            SessionType::Ssh
        );
    }

    #[test]
    fn classify_pts_without_host_is_console() {
        assert_eq!(classify_session_type("pts/0", None), SessionType::Console);
        assert_eq!(
            classify_session_type("pts/0", Some(":0")),
            SessionType::Console
        );
    }

    #[test]
    fn classify_tty_is_console() {
        assert_eq!(classify_session_type("tty1", None), SessionType::Console);
    }

    #[test]
    fn classify_display_is_gui() {
        assert_eq!(classify_session_type(":0", None), SessionType::Gui);
    }

    #[test]
    fn parse_full_timestamp_valid() {
        let parts = vec!["Mon", "Jan", "1", "12:00:00", "2024"];
        let ts = parse_full_timestamp(&parts, 0);
        assert!(ts.is_some());
    }

    #[test]
    fn parse_full_timestamp_insufficient_parts() {
        let parts = vec!["Mon", "Jan"];
        assert!(parse_full_timestamp(&parts, 0).is_none());
    }
}
