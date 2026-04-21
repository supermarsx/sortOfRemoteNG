//! loginctl — session and user management.

use crate::client;
use crate::error::SystemdError;
use crate::types::*;

/// List active sessions.
pub async fn list_sessions(host: &SystemdHost) -> Result<Vec<LoginctlSession>, SystemdError> {
    let stdout = client::exec_ok(
        host,
        "loginctl",
        &["list-sessions", "--no-pager", "--no-legend"],
    )
    .await?;
    Ok(parse_sessions(&stdout))
}

/// List logged-in users.
pub async fn list_users(host: &SystemdHost) -> Result<Vec<LoginctlUser>, SystemdError> {
    let stdout = client::exec_ok(
        host,
        "loginctl",
        &["list-users", "--no-pager", "--no-legend"],
    )
    .await?;
    Ok(parse_users(&stdout))
}

/// Terminate a session.
pub async fn terminate_session(host: &SystemdHost, session_id: &str) -> Result<(), SystemdError> {
    client::exec_ok(host, "loginctl", &["terminate-session", session_id]).await?;
    Ok(())
}

/// Terminate all sessions for a user.
pub async fn terminate_user(host: &SystemdHost, user: &str) -> Result<(), SystemdError> {
    client::exec_ok(host, "loginctl", &["terminate-user", user]).await?;
    Ok(())
}

/// Enable lingering for a user.
pub async fn enable_linger(host: &SystemdHost, user: &str) -> Result<(), SystemdError> {
    client::exec_ok(host, "loginctl", &["enable-linger", user]).await?;
    Ok(())
}

/// Disable lingering.
pub async fn disable_linger(host: &SystemdHost, user: &str) -> Result<(), SystemdError> {
    client::exec_ok(host, "loginctl", &["disable-linger", user]).await?;
    Ok(())
}

fn parse_sessions(output: &str) -> Vec<LoginctlSession> {
    // loginctl list-sessions --no-legend columns: SESSION UID USER SEAT TTY
    let mut entries = Vec::new();
    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 3 {
            continue;
        }

        let session_id = parts[0].to_string();
        let uid: u32 = parts[1].parse().unwrap_or(0);
        let user = parts[2].to_string();
        let seat = parts.get(3).and_then(|s| {
            if s.is_empty() || *s == "-" {
                None
            } else {
                Some(s.to_string())
            }
        });
        let tty = parts.get(4).and_then(|s| {
            if s.is_empty() || *s == "-" {
                None
            } else {
                Some(s.to_string())
            }
        });

        entries.push(LoginctlSession {
            session_id,
            uid,
            user,
            seat,
            tty,
            state: "active".to_string(),
            idle: false,
            since: None,
            class: "user".to_string(),
            scope: String::new(),
            service: None,
            remote: false,
            remote_host: None,
        });
    }
    entries
}

fn parse_users(output: &str) -> Vec<LoginctlUser> {
    // loginctl list-users --no-legend columns: UID USER
    let mut entries = Vec::new();
    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 2 {
            continue;
        }

        let uid: u32 = parts[0].parse().unwrap_or(0);
        let name = parts[1].to_string();

        entries.push(LoginctlUser {
            uid,
            name,
            state: "active".to_string(),
            linger: false,
            sessions: Vec::new(),
        });
    }
    entries
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_sessions() {
        let output = "  c1 1000 user1 seat0 tty1\n  42 1000 user1 - pts/0\n";
        let sessions = parse_sessions(output);
        assert_eq!(sessions.len(), 2);
        assert_eq!(sessions[0].session_id, "c1");
        assert_eq!(sessions[0].uid, 1000);
        assert_eq!(sessions[0].user, "user1");
        assert_eq!(sessions[0].seat.as_deref(), Some("seat0"));
        assert_eq!(sessions[1].seat, None);
        assert_eq!(sessions[1].tty.as_deref(), Some("pts/0"));
    }

    #[test]
    fn test_parse_users() {
        let output = " 1000 user1\n 1001 user2\n";
        let users = parse_users(output);
        assert_eq!(users.len(), 2);
        assert_eq!(users[0].uid, 1000);
        assert_eq!(users[0].name, "user1");
        assert_eq!(users[1].uid, 1001);
    }
}
