//! Replication operations: INFO replication parsing, SLAVEOF, REPLICAOF.

use std::collections::HashMap;

use crate::client::{parse_info_sections, RedisClient};
use crate::error::RedisError;
use crate::types::{RedisReplicaSummary, RedisReplicationInfo};

/// Parse the replication section of INFO.
pub async fn replication_info(
    client: &mut RedisClient,
) -> Result<RedisReplicationInfo, RedisError> {
    let info_str: String = redis::cmd("INFO")
        .arg("replication")
        .query_async(client.con())
        .await?;

    let sections = parse_info_sections(&info_str);
    let repl = sections
        .get("replication")
        .or_else(|| sections.values().next())
        .cloned()
        .unwrap_or_default();

    let mut slaves = Vec::new();
    // Parse slave0, slave1, ... entries like:
    //   slave0:ip=127.0.0.1,port=6380,state=online,offset=1234,lag=0
    for i in 0..64 {
        let key = format!("slave{}", i);
        if let Some(val) = repl.get(&key) {
            let mut fields = HashMap::new();
            for part in val.split(',') {
                if let Some((k, v)) = part.split_once('=') {
                    fields.insert(k.to_string(), v.to_string());
                }
            }
            slaves.push(RedisReplicaSummary {
                ip: fields.get("ip").cloned().unwrap_or_default(),
                port: fields.get("port").and_then(|v| v.parse().ok()).unwrap_or(0),
                state: fields
                    .get("state")
                    .cloned()
                    .unwrap_or_else(|| "unknown".to_string()),
                offset: fields.get("offset").and_then(|v| v.parse().ok()),
                lag: fields.get("lag").and_then(|v| v.parse().ok()),
            });
        } else {
            break;
        }
    }

    Ok(RedisReplicationInfo {
        role: repl
            .get("role")
            .cloned()
            .unwrap_or_else(|| "unknown".to_string()),
        connected_slaves: repl.get("connected_slaves").and_then(|v| v.parse().ok()),
        master_host: repl.get("master_host").cloned(),
        master_port: repl.get("master_port").and_then(|v| v.parse().ok()),
        master_link_status: repl.get("master_link_status").cloned(),
        master_last_io_seconds_ago: repl
            .get("master_last_io_seconds_ago")
            .and_then(|v| v.parse().ok()),
        master_sync_in_progress: repl.get("master_sync_in_progress").map(|v| v == "1"),
        repl_backlog_active: repl.get("repl_backlog_active").map(|v| v == "1"),
        repl_backlog_size: repl.get("repl_backlog_size").and_then(|v| v.parse().ok()),
        slaves,
        raw: repl,
    })
}

/// SLAVEOF host port (or SLAVEOF NO ONE to become a master).
pub async fn slaveof(client: &mut RedisClient, host: &str, port: u16) -> Result<(), RedisError> {
    redis::cmd("SLAVEOF")
        .arg(host)
        .arg(port)
        .query_async::<()>(client.con())
        .await?;
    Ok(())
}

/// REPLICAOF host port (Redis 5.0+, alias for SLAVEOF).
pub async fn replicaof(client: &mut RedisClient, host: &str, port: u16) -> Result<(), RedisError> {
    redis::cmd("REPLICAOF")
        .arg(host)
        .arg(port)
        .query_async::<()>(client.con())
        .await?;
    Ok(())
}

/// REPLICAOF NO ONE — promote this node to master.
pub async fn replicaof_no_one(client: &mut RedisClient) -> Result<(), RedisError> {
    redis::cmd("REPLICAOF")
        .arg("NO")
        .arg("ONE")
        .query_async::<()>(client.con())
        .await?;
    Ok(())
}
