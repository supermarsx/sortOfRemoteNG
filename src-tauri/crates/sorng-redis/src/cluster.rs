//! Cluster operations: CLUSTER INFO, CLUSTER NODES, CLUSTER SLOTS, etc.

use std::collections::HashMap;

use crate::client::RedisClient;
use crate::error::RedisError;
use crate::types::{RedisClusterInfo, RedisClusterNode};

/// CLUSTER INFO → parsed cluster status
pub async fn cluster_info(client: &mut RedisClient) -> Result<RedisClusterInfo, RedisError> {
    let raw: String = redis::cmd("CLUSTER")
        .arg("INFO")
        .query_async(client.con())
        .await?;

    let mut map = HashMap::new();
    for line in raw.lines() {
        let line = line.trim();
        if let Some((k, v)) = line.split_once(':') {
            map.insert(k.to_string(), v.to_string());
        }
    }

    Ok(RedisClusterInfo {
        cluster_enabled: map
            .get("cluster_enabled")
            .map(|v| v == "1")
            .unwrap_or(false),
        cluster_state: map
            .get("cluster_state")
            .cloned()
            .unwrap_or_else(|| "unknown".to_string()),
        cluster_slots_assigned: map
            .get("cluster_slots_assigned")
            .and_then(|v| v.parse().ok())
            .unwrap_or(0),
        cluster_slots_ok: map
            .get("cluster_slots_ok")
            .and_then(|v| v.parse().ok())
            .unwrap_or(0),
        cluster_slots_pfail: map
            .get("cluster_slots_pfail")
            .and_then(|v| v.parse().ok())
            .unwrap_or(0),
        cluster_slots_fail: map
            .get("cluster_slots_fail")
            .and_then(|v| v.parse().ok())
            .unwrap_or(0),
        cluster_known_nodes: map
            .get("cluster_known_nodes")
            .and_then(|v| v.parse().ok())
            .unwrap_or(0),
        cluster_size: map
            .get("cluster_size")
            .and_then(|v| v.parse().ok())
            .unwrap_or(0),
        cluster_current_epoch: map
            .get("cluster_current_epoch")
            .and_then(|v| v.parse().ok())
            .unwrap_or(0),
        cluster_my_epoch: map
            .get("cluster_my_epoch")
            .and_then(|v| v.parse().ok())
            .unwrap_or(0),
        raw: map,
    })
}

/// CLUSTER NODES → parsed node list
pub async fn cluster_nodes(client: &mut RedisClient) -> Result<Vec<RedisClusterNode>, RedisError> {
    let raw: String = redis::cmd("CLUSTER")
        .arg("NODES")
        .query_async(client.con())
        .await?;

    let mut nodes = Vec::new();
    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 8 {
            let master = if parts[3] == "-" {
                None
            } else {
                Some(parts[3].to_string())
            };
            let slots: Vec<String> = parts[8..].iter().map(|s| s.to_string()).collect();
            nodes.push(RedisClusterNode {
                id: parts[0].to_string(),
                addr: parts[1].to_string(),
                flags: parts[2].to_string(),
                master,
                slots,
                connected: parts[7] == "connected",
                ping_sent: parts[4].parse().ok(),
                pong_recv: parts[5].parse().ok(),
                config_epoch: parts[6].parse().ok(),
                link_state: Some(parts[7].to_string()),
            });
        }
    }
    Ok(nodes)
}

/// CLUSTER SLOTS → raw value (complex nested structure)
pub async fn cluster_slots(client: &mut RedisClient) -> Result<redis::Value, RedisError> {
    let v: redis::Value = redis::cmd("CLUSTER")
        .arg("SLOTS")
        .query_async(client.con())
        .await?;
    Ok(v)
}

/// CLUSTER MYID → this node's ID
pub async fn cluster_myid(client: &mut RedisClient) -> Result<String, RedisError> {
    let v: String = redis::cmd("CLUSTER")
        .arg("MYID")
        .query_async(client.con())
        .await?;
    Ok(v)
}

/// CLUSTER KEYSLOT key → hash slot number
pub async fn cluster_keyslot(
    client: &mut RedisClient,
    key: &str,
) -> Result<u64, RedisError> {
    let v: u64 = redis::cmd("CLUSTER")
        .arg("KEYSLOT")
        .arg(key)
        .query_async(client.con())
        .await?;
    Ok(v)
}

/// CLUSTER COUNTKEYSINSLOT slot → number of keys in that slot
pub async fn cluster_count_keys(
    client: &mut RedisClient,
    slot: u64,
) -> Result<u64, RedisError> {
    let v: u64 = redis::cmd("CLUSTER")
        .arg("COUNTKEYSINSLOT")
        .arg(slot)
        .query_async(client.con())
        .await?;
    Ok(v)
}

/// CLUSTER ADDSLOTS slot [slot ...]
pub async fn cluster_addslots(
    client: &mut RedisClient,
    slots: &[u64],
) -> Result<(), RedisError> {
    let mut cmd = redis::cmd("CLUSTER");
    cmd.arg("ADDSLOTS");
    for s in slots {
        cmd.arg(*s);
    }
    cmd.query_async::<()>(client.con()).await?;
    Ok(())
}

/// CLUSTER DELSLOTS slot [slot ...]
pub async fn cluster_delslots(
    client: &mut RedisClient,
    slots: &[u64],
) -> Result<(), RedisError> {
    let mut cmd = redis::cmd("CLUSTER");
    cmd.arg("DELSLOTS");
    for s in slots {
        cmd.arg(*s);
    }
    cmd.query_async::<()>(client.con()).await?;
    Ok(())
}

/// CLUSTER FAILOVER [FORCE|TAKEOVER]
pub async fn cluster_failover(
    client: &mut RedisClient,
    option: Option<&str>,
) -> Result<(), RedisError> {
    let mut cmd = redis::cmd("CLUSTER");
    cmd.arg("FAILOVER");
    if let Some(opt) = option {
        cmd.arg(opt);
    }
    cmd.query_async::<()>(client.con()).await?;
    Ok(())
}

/// CLUSTER REPLICATE node-id
pub async fn cluster_replicate(
    client: &mut RedisClient,
    node_id: &str,
) -> Result<(), RedisError> {
    redis::cmd("CLUSTER")
        .arg("REPLICATE")
        .arg(node_id)
        .query_async::<()>(client.con())
        .await?;
    Ok(())
}

/// CLUSTER MEET ip port
pub async fn cluster_meet(
    client: &mut RedisClient,
    ip: &str,
    port: u16,
) -> Result<(), RedisError> {
    redis::cmd("CLUSTER")
        .arg("MEET")
        .arg(ip)
        .arg(port)
        .query_async::<()>(client.con())
        .await?;
    Ok(())
}

/// CLUSTER FORGET node-id
pub async fn cluster_forget(
    client: &mut RedisClient,
    node_id: &str,
) -> Result<(), RedisError> {
    redis::cmd("CLUSTER")
        .arg("FORGET")
        .arg(node_id)
        .query_async::<()>(client.con())
        .await?;
    Ok(())
}

/// CLUSTER RESET [HARD|SOFT]
pub async fn cluster_reset(
    client: &mut RedisClient,
    hard: bool,
) -> Result<(), RedisError> {
    let opt = if hard { "HARD" } else { "SOFT" };
    redis::cmd("CLUSTER")
        .arg("RESET")
        .arg(opt)
        .query_async::<()>(client.con())
        .await?;
    Ok(())
}
