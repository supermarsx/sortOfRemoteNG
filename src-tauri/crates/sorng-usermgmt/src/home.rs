//! Home directory management — info, skeleton, migrate.

use crate::client;
use crate::error::UserMgmtError;
use crate::types::*;
use log::info;

/// Get home directory information.
pub async fn home_info(host: &UserMgmtHost, path: &str) -> Result<HomeInfo, UserMgmtError> {
    let (stdout, _, code) = client::exec(host, "stat", &["-c", "%U:%G:%s:%a", path]).await?;
    if code != 0 {
        return Ok(HomeInfo {
            path: path.to_string(),
            exists: false,
            owner_uid: None,
            owner_gid: None,
            size_bytes: None,
            permissions: None,
            files_count: None,
        });
    }
    let parts: Vec<&str> = stdout.trim().split(':').collect();
    Ok(HomeInfo {
        path: path.to_string(),
        exists: true,
        owner_uid: parts.first().and_then(|s| s.parse().ok()),
        owner_gid: parts.get(1).and_then(|s| s.parse().ok()),
        size_bytes: parts.get(2).and_then(|s| s.parse().ok()),
        permissions: parts.get(3).map(|s| s.to_string()),
        files_count: None,
    })
}

/// Get skeleton directory template.
pub async fn get_skel(host: &UserMgmtHost, skel_path: Option<&str>) -> Result<SkelTemplate, UserMgmtError> {
    let path = skel_path.unwrap_or("/etc/skel");
    let stdout = client::exec_ok(host, "find", &[path, "-maxdepth", "3", "-printf", "%P\\t%y\\t%m\\t%s\\n"]).await?;

    let mut files = Vec::new();
    for line in stdout.lines() {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() < 4 || parts[0].is_empty() {
            continue;
        }
        files.push(SkelFile {
            relative_path: parts[0].to_string(),
            file_type: match parts[1] {
                "d" => SkelFileType::Directory,
                "l" => SkelFileType::Symlink,
                _ => SkelFileType::File,
            },
            permissions: parts[2].to_string(),
            size_bytes: parts[3].parse().unwrap_or(0),
        });
    }

    Ok(SkelTemplate {
        path: path.to_string(),
        files,
    })
}

/// Migrate home directory to a new location.
pub async fn migrate_home(host: &UserMgmtHost, username: &str, new_path: &str) -> Result<(), UserMgmtError> {
    client::exec_ok(host, "usermod", &["-d", new_path, "-m", username]).await?;
    info!("Migrated home for {username} to {new_path}");
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn test_module_loads() {}
}
