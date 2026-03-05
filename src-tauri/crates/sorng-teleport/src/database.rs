//! # Teleport Database Access
//!
//! List databases, establish database proxy connections, and manage
//! database sessions through Teleport.

use crate::types::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Build `tsh db ls` command.
pub fn list_databases_command(cluster: Option<&str>, format_json: bool) -> Vec<String> {
    let mut cmd = vec!["tsh".to_string(), "db".to_string(), "ls".to_string()];
    if let Some(c) = cluster {
        cmd.push(format!("--cluster={}", c));
    }
    if format_json {
        cmd.push("--format=json".to_string());
    }
    cmd
}

/// Build `tsh db login` command.
pub fn db_login_command(
    db_name: &str,
    db_user: Option<&str>,
    db_database: Option<&str>,
) -> Vec<String> {
    let mut cmd = vec!["tsh".to_string(), "db".to_string(), "login".to_string()];
    if let Some(u) = db_user {
        cmd.push(format!("--db-user={}", u));
    }
    if let Some(d) = db_database {
        cmd.push(format!("--db-name={}", d));
    }
    cmd.push(db_name.to_string());
    cmd
}

/// Build `tsh db connect` command.
pub fn db_connect_command(
    db_name: &str,
    db_user: Option<&str>,
    db_database: Option<&str>,
) -> Vec<String> {
    let mut cmd = vec!["tsh".to_string(), "db".to_string(), "connect".to_string()];
    if let Some(u) = db_user {
        cmd.push(format!("--db-user={}", u));
    }
    if let Some(d) = db_database {
        cmd.push(format!("--db-name={}", d));
    }
    cmd.push(db_name.to_string());
    cmd
}

/// Build `tsh proxy db` command for local proxy.
pub fn db_proxy_command(
    db_name: &str,
    port: u16,
    db_user: Option<&str>,
    db_database: Option<&str>,
) -> Vec<String> {
    let mut cmd = vec![
        "tsh".to_string(),
        "proxy".to_string(),
        "db".to_string(),
        format!("--port={}", port),
    ];
    if let Some(u) = db_user {
        cmd.push(format!("--db-user={}", u));
    }
    if let Some(d) = db_database {
        cmd.push(format!("--db-name={}", d));
    }
    cmd.push(db_name.to_string());
    cmd
}

/// Build `tsh db logout` command.
pub fn db_logout_command(db_name: &str) -> Vec<String> {
    vec![
        "tsh".to_string(),
        "db".to_string(),
        "logout".to_string(),
        db_name.to_string(),
    ]
}

/// Group databases by protocol.
pub fn group_by_protocol<'a>(dbs: &[&'a TeleportDatabase]) -> HashMap<String, Vec<&'a TeleportDatabase>> {
    let mut map: HashMap<String, Vec<&TeleportDatabase>> = HashMap::new();
    for db in dbs {
        let key = format!("{:?}", db.protocol);
        map.entry(key).or_default().push(db);
    }
    map
}

/// Database summary.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseSummary {
    pub total: u32,
    pub online: u32,
    pub offline: u32,
    pub protocols: HashMap<String, u32>,
}

pub fn summarize_databases(dbs: &[&TeleportDatabase]) -> DatabaseSummary {
    let mut protocols: HashMap<String, u32> = HashMap::new();
    for db in dbs {
        *protocols.entry(format!("{:?}", db.protocol)).or_insert(0) += 1;
    }
    DatabaseSummary {
        total: dbs.len() as u32,
        online: dbs.iter().filter(|d| d.status == ResourceStatus::Online).count() as u32,
        offline: dbs.iter().filter(|d| d.status == ResourceStatus::Offline).count() as u32,
        protocols,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_db_login_command() {
        let cmd = db_login_command("my-postgres", Some("admin"), Some("mydb"));
        assert!(cmd.contains(&"tsh".to_string()));
        assert!(cmd.contains(&"login".to_string()));
        assert!(cmd.iter().any(|c| c.contains("--db-user=admin")));
        assert!(cmd.iter().any(|c| c.contains("--db-name=mydb")));
        assert!(cmd.contains(&"my-postgres".to_string()));
    }

    #[test]
    fn test_db_proxy_command() {
        let cmd = db_proxy_command("my-db", 5432, Some("root"), None);
        assert!(cmd.iter().any(|c| c.contains("--port=5432")));
    }

    #[test]
    fn test_db_logout_command() {
        let cmd = db_logout_command("mydb");
        assert_eq!(cmd, vec!["tsh", "db", "logout", "mydb"]);
    }
}
