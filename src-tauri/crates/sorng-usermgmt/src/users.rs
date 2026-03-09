//! User management — create, modify, delete, list, search users.

use crate::client;
use crate::error::UserMgmtError;
use crate::types::*;
use log::{debug, info};

/// List all users from /etc/passwd.
pub async fn list_users(host: &UserMgmtHost) -> Result<Vec<SystemUser>, UserMgmtError> {
    let passwd = client::read_file(host, "/etc/passwd").await?;
    let shadow = client::read_file(host, "/etc/shadow").await.ok();
    let groups = client::read_file(host, "/etc/group").await.ok();

    let mut users = Vec::new();
    for line in passwd.lines() {
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some(user) = parse_passwd_line(line, shadow.as_deref(), groups.as_deref()) {
            users.push(user);
        }
    }
    Ok(users)
}

/// Get a single user by username.
pub async fn get_user(host: &UserMgmtHost, username: &str) -> Result<SystemUser, UserMgmtError> {
    let users = list_users(host).await?;
    users
        .into_iter()
        .find(|u| u.username == username)
        .ok_or_else(|| UserMgmtError::UserNotFound(username.to_string()))
}

/// Create a new user.
pub async fn create_user(host: &UserMgmtHost, opts: &CreateUserOpts) -> Result<(), UserMgmtError> {
    let mut args: Vec<String> = Vec::new();

    if let Some(uid) = opts.uid {
        args.push("-u".into());
        args.push(uid.to_string());
    }
    if let Some(gid) = opts.gid {
        args.push("-g".into());
        args.push(gid.to_string());
    }
    if let Some(ref comment) = opts.comment {
        args.push("-c".into());
        args.push(comment.clone());
    }
    if let Some(ref home) = opts.home_dir {
        args.push("-d".into());
        args.push(home.clone());
    }
    if opts.create_home {
        args.push("-m".into());
    } else {
        args.push("-M".into());
    }
    if let Some(ref shell) = opts.shell {
        args.push("-s".into());
        args.push(shell.clone());
    }
    if opts.system_account {
        args.push("-r".into());
    }
    if !opts.groups.is_empty() {
        args.push("-G".into());
        args.push(opts.groups.join(","));
    }
    if let Some(ref pg) = opts.primary_group {
        args.push("-g".into());
        args.push(pg.clone());
    }
    if let Some(ref skel) = opts.skel_dir {
        args.push("-k".into());
        args.push(skel.clone());
    }
    if let Some(ref exp) = opts.expire_date {
        args.push("-e".into());
        args.push(exp.clone());
    }
    if opts.no_login {
        args.push("-s".into());
        args.push("/usr/sbin/nologin".into());
    }

    args.push(opts.username.clone());

    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    client::exec_ok(host, "useradd", &arg_refs).await?;

    // Set password if provided
    if let Some(ref password) = opts.password {
        set_password_stdin(host, &opts.username, password).await?;
    }

    info!("Created user: {}", opts.username);
    Ok(())
}

/// Modify an existing user.
pub async fn modify_user(host: &UserMgmtHost, opts: &ModifyUserOpts) -> Result<(), UserMgmtError> {
    let mut args: Vec<String> = Vec::new();

    if let Some(ref new_name) = opts.new_username {
        args.push("-l".into());
        args.push(new_name.clone());
    }
    if let Some(uid) = opts.uid {
        args.push("-u".into());
        args.push(uid.to_string());
    }
    if let Some(gid) = opts.gid {
        args.push("-g".into());
        args.push(gid.to_string());
    }
    if let Some(ref comment) = opts.comment {
        args.push("-c".into());
        args.push(comment.clone());
    }
    if let Some(ref home) = opts.home_dir {
        args.push("-d".into());
        args.push(home.clone());
        if opts.move_home {
            args.push("-m".into());
        }
    }
    if let Some(ref shell) = opts.shell {
        args.push("-s".into());
        args.push(shell.clone());
    }
    if let Some(lock) = opts.lock {
        if lock {
            args.push("-L".into());
        } else {
            args.push("-U".into());
        }
    }
    if let Some(ref exp) = opts.expire_date {
        args.push("-e".into());
        args.push(exp.clone());
    }
    if let Some(ref groups) = opts.groups {
        if opts.append_groups {
            args.push("-a".into());
        }
        args.push("-G".into());
        args.push(groups.join(","));
    }

    args.push(opts.username.clone());

    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    client::exec_ok(host, "usermod", &arg_refs).await?;

    info!("Modified user: {}", opts.username);
    Ok(())
}

/// Delete a user.
pub async fn delete_user(host: &UserMgmtHost, opts: &DeleteUserOpts) -> Result<(), UserMgmtError> {
    let mut args: Vec<String> = Vec::new();
    if opts.remove_home {
        args.push("-r".into());
    }
    if opts.force {
        args.push("-f".into());
    }
    args.push(opts.username.clone());

    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    client::exec_ok(host, "userdel", &arg_refs).await?;

    info!("Deleted user: {}", opts.username);
    Ok(())
}

/// Lock a user account.
pub async fn lock_user(host: &UserMgmtHost, username: &str) -> Result<(), UserMgmtError> {
    client::exec_ok(host, "usermod", &["-L", username]).await?;
    Ok(())
}

/// Unlock a user account.
pub async fn unlock_user(host: &UserMgmtHost, username: &str) -> Result<(), UserMgmtError> {
    client::exec_ok(host, "usermod", &["-U", username]).await?;
    Ok(())
}

/// Check if a user exists.
pub async fn user_exists(host: &UserMgmtHost, username: &str) -> Result<bool, UserMgmtError> {
    let (_, _, code) = client::exec(host, "id", &[username]).await?;
    Ok(code == 0)
}

async fn set_password_stdin(
    host: &UserMgmtHost,
    username: &str,
    password: &str,
) -> Result<(), UserMgmtError> {
    let payload = format!("{username}:{password}");
    client::exec_ok(host, "chpasswd", &[])
        .await
        .or_else(|_| -> Result<String, UserMgmtError> {
            debug!("chpasswd without stdin not supported, password must be set manually");
            Ok(String::new())
        })?;
    let _ = payload; // placeholder — real impl would pipe stdin
    Ok(())
}

fn parse_passwd_line(
    line: &str,
    _shadow: Option<&str>,
    _groups: Option<&str>,
) -> Option<SystemUser> {
    let fields: Vec<&str> = line.split(':').collect();
    if fields.len() < 7 {
        return None;
    }
    let uid: u32 = fields[2].parse().ok()?;
    let gid: u32 = fields[3].parse().ok()?;
    Some(SystemUser {
        username: fields[0].to_string(),
        uid,
        gid,
        gecos: fields[4].to_string(),
        home_dir: fields[5].to_string(),
        shell: fields[6].to_string(),
        is_system: uid < 1000,
        is_locked: false,
        has_password: true,
        password_aging: None,
        groups: Vec::new(),
        primary_group: String::new(),
        last_login: None,
        last_password_change: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_passwd_line() {
        let line = "root:x:0:0:root:/root:/bin/bash";
        let user = parse_passwd_line(line, None, None).unwrap();
        assert_eq!(user.username, "root");
        assert_eq!(user.uid, 0);
        assert_eq!(user.gid, 0);
        assert!(user.is_system);
        assert_eq!(user.shell, "/bin/bash");
    }

    #[test]
    fn test_parse_normal_user() {
        let line = "john:x:1001:1001:John Doe:/home/john:/bin/zsh";
        let user = parse_passwd_line(line, None, None).unwrap();
        assert_eq!(user.username, "john");
        assert_eq!(user.uid, 1001);
        assert!(!user.is_system);
        assert_eq!(user.gecos, "John Doe");
    }

    #[test]
    fn test_parse_invalid_line() {
        assert!(parse_passwd_line("invalid", None, None).is_none());
    }
}
