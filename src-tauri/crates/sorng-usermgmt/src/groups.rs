//! Group management — create, modify, delete, list groups.

use crate::client;
use crate::error::UserMgmtError;
use crate::types::*;
use log::info;

/// List all groups from /etc/group.
pub async fn list_groups(host: &UserMgmtHost) -> Result<Vec<SystemGroup>, UserMgmtError> {
    let content = client::read_file(host, "/etc/group").await?;
    let mut groups = Vec::new();
    for line in content.lines() {
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some(g) = parse_group_line(line) {
            groups.push(g);
        }
    }
    Ok(groups)
}

/// Get a group by name.
pub async fn get_group(host: &UserMgmtHost, name: &str) -> Result<SystemGroup, UserMgmtError> {
    let groups = list_groups(host).await?;
    groups.into_iter()
        .find(|g| g.name == name)
        .ok_or_else(|| UserMgmtError::GroupNotFound(name.to_string()))
}

/// Create a new group.
pub async fn create_group(host: &UserMgmtHost, opts: &CreateGroupOpts) -> Result<(), UserMgmtError> {
    let mut args: Vec<String> = Vec::new();
    if let Some(gid) = opts.gid {
        args.push("-g".into());
        args.push(gid.to_string());
    }
    if opts.system_group {
        args.push("-r".into());
    }
    args.push(opts.name.clone());

    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    client::exec_ok(host, "groupadd", &arg_refs).await?;

    // Add initial members
    for member in &opts.members {
        add_member(host, &opts.name, member).await?;
    }

    info!("Created group: {}", opts.name);
    Ok(())
}

/// Modify a group.
pub async fn modify_group(host: &UserMgmtHost, opts: &ModifyGroupOpts) -> Result<(), UserMgmtError> {
    let mut args: Vec<String> = Vec::new();
    if let Some(ref new_name) = opts.new_name {
        args.push("-n".into());
        args.push(new_name.clone());
    }
    if let Some(gid) = opts.gid {
        args.push("-g".into());
        args.push(gid.to_string());
    }
    if !args.is_empty() {
        args.push(opts.name.clone());
        let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        client::exec_ok(host, "groupmod", &arg_refs).await?;
    }

    let group_name = opts.new_name.as_deref().unwrap_or(&opts.name);
    for member in &opts.add_members {
        add_member(host, group_name, member).await?;
    }
    for member in &opts.remove_members {
        remove_member(host, group_name, member).await?;
    }

    info!("Modified group: {}", opts.name);
    Ok(())
}

/// Delete a group.
pub async fn delete_group(host: &UserMgmtHost, name: &str) -> Result<(), UserMgmtError> {
    client::exec_ok(host, "groupdel", &[name]).await?;
    info!("Deleted group: {name}");
    Ok(())
}

/// Add a user to a group.
pub async fn add_member(host: &UserMgmtHost, group: &str, user: &str) -> Result<(), UserMgmtError> {
    client::exec_ok(host, "usermod", &["-a", "-G", group, user]).await?;
    Ok(())
}

/// Remove a user from a group.
pub async fn remove_member(host: &UserMgmtHost, group: &str, user: &str) -> Result<(), UserMgmtError> {
    client::exec_ok(host, "gpasswd", &["-d", user, group]).await?;
    Ok(())
}

fn parse_group_line(line: &str) -> Option<SystemGroup> {
    let fields: Vec<&str> = line.split(':').collect();
    if fields.len() < 4 {
        return None;
    }
    let gid: u32 = fields[2].parse().ok()?;
    let members: Vec<String> = fields[3]
        .split(',')
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect();
    Some(SystemGroup {
        name: fields[0].to_string(),
        gid,
        members,
        is_system: gid < 1000,
        has_password: fields[1] != "x" && fields[1] != "!" && !fields[1].is_empty(),
        admins: Vec::new(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_group_line() {
        let line = "sudo:x:27:alice,bob";
        let g = parse_group_line(line).unwrap();
        assert_eq!(g.name, "sudo");
        assert_eq!(g.gid, 27);
        assert_eq!(g.members, vec!["alice", "bob"]);
        assert!(g.is_system);
    }

    #[test]
    fn test_parse_empty_members() {
        let line = "nogroup:x:65534:";
        let g = parse_group_line(line).unwrap();
        assert!(g.members.is_empty());
    }
}
