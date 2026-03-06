//! Bulk user operations — import from CSV/JSON, batch create/delete.

use crate::error::UserMgmtError;
use crate::types::*;
use crate::users;

/// Bulk create users from a list of records.
pub async fn bulk_create(host: &UserMgmtHost, records: &[BulkUserRecord]) -> Result<BulkResult, UserMgmtError> {
    let mut result = BulkResult {
        total: records.len(),
        succeeded: 0,
        failed: 0,
        skipped: 0,
        results: Vec::new(),
    };

    for rec in records {
        let opts = CreateUserOpts {
            username: rec.username.clone(),
            uid: rec.uid,
            gid: rec.gid,
            comment: rec.comment.clone(),
            home_dir: rec.home_dir.clone(),
            create_home: rec.create_home,
            shell: rec.shell.clone(),
            password: rec.password.clone(),
            system_account: false,
            groups: rec.groups.clone(),
            primary_group: None,
            skel_dir: None,
            expire_date: None,
            inactive_days: None,
            no_login: false,
            selinux_user: None,
        };

        match users::create_user(host, &opts).await {
            Ok(()) => {
                result.succeeded += 1;
                result.results.push(BulkItemResult {
                    username: rec.username.clone(),
                    status: BulkItemStatus::Created,
                    message: None,
                });
            }
            Err(e) => {
                result.failed += 1;
                result.results.push(BulkItemResult {
                    username: rec.username.clone(),
                    status: BulkItemStatus::Failed,
                    message: Some(e.to_string()),
                });
            }
        }
    }

    Ok(result)
}

/// Parse CSV content into bulk user records.
pub fn parse_csv(content: &str) -> Result<Vec<BulkUserRecord>, UserMgmtError> {
    let mut records = Vec::new();
    let mut lines = content.lines();

    // Skip header
    let header = lines.next().ok_or_else(|| UserMgmtError::ParseError("Empty CSV".into()))?;
    let columns: Vec<&str> = header.split(',').map(|s| s.trim()).collect();

    for line in lines {
        if line.trim().is_empty() {
            continue;
        }
        let values: Vec<&str> = line.split(',').map(|s| s.trim()).collect();
        let get = |col: &str| -> Option<String> {
            columns.iter().position(|c| *c == col).and_then(|i| {
                values.get(i).filter(|v| !v.is_empty()).map(|v| v.to_string())
            })
        };

        let username = get("username").ok_or_else(|| {
            UserMgmtError::ParseError("Missing username column".into())
        })?;

        records.push(BulkUserRecord {
            username,
            password: get("password"),
            uid: get("uid").and_then(|v| v.parse().ok()),
            gid: get("gid").and_then(|v| v.parse().ok()),
            comment: get("comment"),
            home_dir: get("home"),
            shell: get("shell"),
            groups: get("groups").map(|g| g.split(';').map(|s| s.to_string()).collect()).unwrap_or_default(),
            create_home: get("create_home").map(|v| v == "true" || v == "yes" || v == "1").unwrap_or(true),
        });
    }

    Ok(records)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_csv() {
        let csv = "username,password,uid,comment,shell,groups,create_home\n\
                    alice,,1001,Alice Smith,/bin/bash,sudo;docker,true\n\
                    bob,,1002,Bob Jones,/bin/zsh,,true\n";
        let records = parse_csv(csv).unwrap();
        assert_eq!(records.len(), 2);
        assert_eq!(records[0].username, "alice");
        assert_eq!(records[0].groups, vec!["sudo", "docker"]);
        assert_eq!(records[1].username, "bob");
        assert!(records[1].groups.is_empty());
    }
}
