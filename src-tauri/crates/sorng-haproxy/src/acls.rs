// ── haproxy ACL management ───────────────────────────────────────────────────

use crate::client::HaproxyClient;
use crate::error::HaproxyResult;
use crate::types::*;

pub struct AclManager;

impl AclManager {
    pub async fn list(client: &HaproxyClient) -> HaproxyResult<Vec<HaproxyAcl>> {
        let raw = client.socket_cmd("show acl").await?;
        Ok(parse_acl_list(&raw))
    }

    pub async fn get(client: &HaproxyClient, acl_id: &str) -> HaproxyResult<Vec<AclEntry>> {
        let raw = client.show_acl(acl_id).await?;
        Ok(parse_acl_entries(&raw))
    }

    pub async fn add_entry(client: &HaproxyClient, acl_id: &str, value: &str) -> HaproxyResult<String> {
        client.socket_cmd(&format!("add acl #{} {}", acl_id, value)).await
    }

    pub async fn del_entry(client: &HaproxyClient, acl_id: &str, value: &str) -> HaproxyResult<String> {
        client.socket_cmd(&format!("del acl #{} {}", acl_id, value)).await
    }

    pub async fn clear(client: &HaproxyClient, acl_id: &str) -> HaproxyResult<String> {
        client.socket_cmd(&format!("clear acl #{}", acl_id)).await
    }
}

fn parse_acl_list(raw: &str) -> Vec<HaproxyAcl> {
    raw.lines().filter_map(|line| {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 2 {
            Some(HaproxyAcl {
                id: parts[0].trim_start_matches('#').to_string(),
                description: parts[1..].join(" "),
                entry_count: None,
            })
        } else {
            None
        }
    }).collect()
}

fn parse_acl_entries(raw: &str) -> Vec<AclEntry> {
    raw.lines().filter_map(|line| {
        let parts: Vec<&str> = line.splitn(2, ' ').collect();
        if parts.len() >= 2 {
            Some(AclEntry { id: parts[0].to_string(), value: parts[1].to_string() })
        } else {
            None
        }
    }).collect()
}
