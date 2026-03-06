//! Samba user management.
use crate::client;
use crate::error::FileSharingError;
use crate::types::*;

pub async fn list_users(host: &FileSharingHost) -> Result<Vec<SambaUser>, FileSharingError> {
    let stdout = client::exec_ok(host, "pdbedit", &["-L", "-v"]).await?;
    Ok(parse_pdbedit(&stdout))
}
pub async fn add_user(host: &FileSharingHost, username: &str, password: &str) -> Result<(), FileSharingError> {
    let cmd = format!("echo -e '{password}\\n{password}' | smbpasswd -a {username} -s");
    client::exec_ok(host, "sh", &["-c", &cmd]).await?; Ok(())
}
pub async fn remove_user(host: &FileSharingHost, username: &str) -> Result<(), FileSharingError> {
    client::exec_ok(host, "smbpasswd", &["-x", username]).await?; Ok(())
}
pub async fn enable_user(host: &FileSharingHost, username: &str) -> Result<(), FileSharingError> {
    client::exec_ok(host, "smbpasswd", &["-e", username]).await?; Ok(())
}
pub async fn disable_user(host: &FileSharingHost, username: &str) -> Result<(), FileSharingError> {
    client::exec_ok(host, "smbpasswd", &["-d", username]).await?; Ok(())
}

fn parse_pdbedit(output: &str) -> Vec<SambaUser> {
    let mut users = Vec::new();
    let mut username = String::new();
    let mut sid = None;
    for line in output.lines() {
        let line = line.trim();
        if line.starts_with("Unix username:") { username = line.split(':').nth(1).unwrap_or("").trim().into(); }
        else if line.starts_with("User SID:") { sid = Some(line.split(':').nth(1).unwrap_or("").trim().to_string()); }
        else if line.starts_with("Account Flags:") {
            let flags_str = line.split(':').nth(1).unwrap_or("").trim();
            let flags: Vec<String> = flags_str.trim_matches('[').trim_matches(']').chars().filter(|c| !c.is_whitespace()).map(|c| c.to_string()).collect();
            if !username.is_empty() { users.push(SambaUser { username: username.clone(), sid: sid.clone(), flags }); }
            username.clear(); sid = None;
        }
    }
    users
}
