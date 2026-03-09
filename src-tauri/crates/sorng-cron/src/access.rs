//! Cron access control — /etc/cron.allow, /etc/cron.deny.

use crate::client;
use crate::error::CronError;
use crate::types::{CronAccessControl, CronHost};

/// Read cron access control files (/etc/cron.allow, /etc/cron.deny).
pub async fn get_cron_access(host: &CronHost) -> Result<CronAccessControl, CronError> {
    let (allow_out, _, allow_exit) = client::exec(host, "cat", &["/etc/cron.allow"]).await?;
    let (deny_out, _, deny_exit) = client::exec(host, "cat", &["/etc/cron.deny"]).await?;

    let allow_exists = allow_exit == 0;
    let deny_exists = deny_exit == 0;

    let allow_users = if allow_exists {
        parse_access_file(&allow_out)
    } else {
        Vec::new()
    };

    let deny_users = if deny_exists {
        parse_access_file(&deny_out)
    } else {
        Vec::new()
    };

    Ok(CronAccessControl {
        allow_users,
        deny_users,
        allow_file_exists: allow_exists,
        deny_file_exists: deny_exists,
    })
}

/// Set the list of users in /etc/cron.allow.
pub async fn set_cron_allow(host: &CronHost, users: &[String]) -> Result<(), CronError> {
    let content = users.join("\n") + "\n";
    client::exec_with_stdin(host, "tee", &["/etc/cron.allow"], &content).await?;
    Ok(())
}

/// Set the list of users in /etc/cron.deny.
pub async fn set_cron_deny(host: &CronHost, users: &[String]) -> Result<(), CronError> {
    let content = users.join("\n") + "\n";
    client::exec_with_stdin(host, "tee", &["/etc/cron.deny"], &content).await?;
    Ok(())
}

/// Check whether a specific user is allowed to use cron.
///
/// Rules (per crontab(1)):
/// 1. If /etc/cron.allow exists, only users listed in it may use cron.
/// 2. If /etc/cron.allow does not exist but /etc/cron.deny exists,
///    all users except those listed in cron.deny may use cron.
/// 3. If neither file exists, either only root may use cron (some systems)
///    or all users may (depends on distribution). We assume all users allowed.
pub async fn check_user_access(host: &CronHost, user: &str) -> Result<bool, CronError> {
    let access = get_cron_access(host).await?;

    if access.allow_file_exists {
        // Only users in cron.allow may use cron
        return Ok(access.allow_users.iter().any(|u| u == user));
    }

    if access.deny_file_exists {
        // Everyone except users in cron.deny
        return Ok(!access.deny_users.iter().any(|u| u == user));
    }

    // Neither file exists — allow all
    Ok(true)
}

/// Parse an access file (cron.allow/cron.deny) into a list of usernames.
fn parse_access_file(content: &str) -> Vec<String> {
    content
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_access_file_content() {
        let content = "# allowed users\nroot\nadmin\n\ndeploy\n";
        let users = parse_access_file(content);
        assert_eq!(users, vec!["root", "admin", "deploy"]);
    }

    #[test]
    fn parse_empty_access_file() {
        let users = parse_access_file("");
        assert!(users.is_empty());

        let users = parse_access_file("# only comments\n# nothing here\n");
        assert!(users.is_empty());
    }
}
