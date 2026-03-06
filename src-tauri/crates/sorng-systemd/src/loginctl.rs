//! loginctl — session and user management.

use crate::client;
use crate::error::SystemdError;
use crate::types::*;

/// List active sessions.
pub async fn list_sessions(host: &SystemdHost) -> Result<Vec<LoginctlSession>, SystemdError> {
    let stdout = client::exec_ok(host, "loginctl", &["list-sessions", "--no-pager", "--no-legend"]).await?;
    Ok(parse_sessions(&stdout))
}

/// List logged-in users.
pub async fn list_users(host: &SystemdHost) -> Result<Vec<LoginctlUser>, SystemdError> {
    let stdout = client::exec_ok(host, "loginctl", &["list-users", "--no-pager", "--no-legend"]).await?;
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

fn parse_sessions(_output: &str) -> Vec<LoginctlSession> {
    // TODO: parse loginctl list-sessions
    Vec::new()
}

fn parse_users(_output: &str) -> Vec<LoginctlUser> {
    // TODO: parse loginctl list-users
    Vec::new()
}

#[cfg(test)]
mod tests {
    #[test]
    fn test_module_loads() {}
}
