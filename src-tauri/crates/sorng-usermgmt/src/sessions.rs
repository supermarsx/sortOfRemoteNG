//! Login session tracking — last, lastlog, who, w.

use crate::client;
use crate::error::UserMgmtError;
use crate::types::*;

/// Get login history via `last`.
pub async fn login_history(host: &UserMgmtHost, count: Option<u32>) -> Result<Vec<LoginSession>, UserMgmtError> {
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

fn parse_last_output(_output: &str) -> Vec<LoginSession> {
    // TODO: implement full `last -F` parser
    Vec::new()
}

fn parse_lastlog_output(_output: &str) -> Vec<LastLogin> {
    // TODO: implement lastlog parser
    Vec::new()
}

fn parse_who_output(_output: &str) -> Vec<ActiveSession> {
    // TODO: implement who parser
    Vec::new()
}

#[cfg(test)]
mod tests {
    #[test]
    fn test_module_loads() {}
}
