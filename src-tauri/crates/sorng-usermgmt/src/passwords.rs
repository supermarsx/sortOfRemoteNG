//! Password management — passwd, chpasswd, password policy.

use crate::client;
use crate::error::UserMgmtError;
use crate::types::*;
use log::info;

/// Force a user to change password at next login.
pub async fn expire_password(host: &UserMgmtHost, username: &str) -> Result<(), UserMgmtError> {
    client::exec_ok(host, "passwd", &["-e", username]).await?;
    info!("Expired password for {username}");
    Ok(())
}

/// Check password status for a user.
pub async fn password_status(host: &UserMgmtHost, username: &str) -> Result<String, UserMgmtError> {
    client::exec_ok(host, "passwd", &["-S", username]).await
}

/// Set password aging policy via chage.
pub async fn set_aging(host: &UserMgmtHost, opts: &ChangeAgingOpts) -> Result<(), UserMgmtError> {
    let mut args: Vec<String> = Vec::new();
    if let Some(min) = opts.min_days {
        args.push("-m".into());
        args.push(min.to_string());
    }
    if let Some(max) = opts.max_days {
        args.push("-M".into());
        args.push(max.to_string());
    }
    if let Some(warn) = opts.warn_days {
        args.push("-W".into());
        args.push(warn.to_string());
    }
    if let Some(inactive) = opts.inactive_days {
        args.push("-I".into());
        args.push(inactive.to_string());
    }
    if let Some(ref exp) = opts.expire_date {
        args.push("-E".into());
        args.push(exp.clone());
    }
    if let Some(last) = opts.last_day {
        args.push("-d".into());
        args.push(last.to_string());
    }
    args.push(opts.username.clone());

    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    client::exec_ok(host, "chage", &arg_refs).await?;
    info!("Updated aging for {}", opts.username);
    Ok(())
}

/// Get password aging info via chage -l.
pub async fn get_aging(host: &UserMgmtHost, username: &str) -> Result<PasswordAging, UserMgmtError> {
    let out = client::exec_ok(host, "chage", &["-l", username]).await?;
    parse_chage_output(&out)
}

fn parse_chage_output(output: &str) -> Result<PasswordAging, UserMgmtError> {
    let mut aging = PasswordAging {
        last_change: None,
        min_days: None,
        max_days: None,
        warn_days: None,
        inactive_days: None,
        expire_date: None,
        is_expired: false,
        days_until_expiry: None,
    };

    for line in output.lines() {
        let parts: Vec<&str> = line.splitn(2, ':').collect();
        if parts.len() != 2 {
            continue;
        }
        let key = parts[0].trim().to_lowercase();
        let val = parts[1].trim();

        if key.contains("minimum") {
            aging.min_days = val.parse().ok();
        } else if key.contains("maximum") {
            aging.max_days = val.parse().ok();
        } else if key.contains("warning") {
            aging.warn_days = val.parse().ok();
        } else if key.contains("inactive") && !key.contains("account") {
            aging.inactive_days = val.parse().ok();
        } else if key.contains("password must be changed") {
            aging.is_expired = true;
        }
    }
    Ok(aging)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_chage() {
        let output = "Minimum number of days between password change\t\t: 0\n\
                       Maximum number of days between password change\t\t: 99999\n\
                       Number of days of warning before password expires\t: 7\n";
        let aging = parse_chage_output(output).unwrap();
        assert_eq!(aging.min_days, Some(0));
        assert_eq!(aging.max_days, Some(99999));
        assert_eq!(aging.warn_days, Some(7));
    }
}
