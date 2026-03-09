//! Sentinel operations: SENTINEL MASTERS, SENTINEL MASTER, SENTINEL SLAVES,
//! SENTINEL SENTINELS, SENTINEL GET-MASTER-ADDR-BY-NAME, etc.

use std::collections::HashMap;

use crate::client::{redis_value_to_map, RedisClient};
use crate::error::RedisError;
use crate::types::{RedisSentinelMaster, RedisSentinelSlave};

/// SENTINEL MASTERS → list of monitored masters
pub async fn sentinel_masters(
    client: &mut RedisClient,
) -> Result<Vec<RedisSentinelMaster>, RedisError> {
    let raw: Vec<redis::Value> = redis::cmd("SENTINEL")
        .arg("MASTERS")
        .query_async(client.con())
        .await?;
    let mut masters = Vec::new();
    for item in &raw {
        let map = redis_value_to_map(item);
        masters.push(parse_sentinel_master(&map));
    }
    Ok(masters)
}

/// SENTINEL MASTER name → info about a specific master
pub async fn sentinel_master(
    client: &mut RedisClient,
    name: &str,
) -> Result<RedisSentinelMaster, RedisError> {
    let raw: redis::Value = redis::cmd("SENTINEL")
        .arg("MASTER")
        .arg(name)
        .query_async(client.con())
        .await?;
    let map = redis_value_to_map(&raw);
    Ok(parse_sentinel_master(&map))
}

/// SENTINEL SLAVES master-name → replicas of the given master
pub async fn sentinel_slaves(
    client: &mut RedisClient,
    master_name: &str,
) -> Result<Vec<RedisSentinelSlave>, RedisError> {
    let raw: Vec<redis::Value> = redis::cmd("SENTINEL")
        .arg("SLAVES")
        .arg(master_name)
        .query_async(client.con())
        .await?;
    let mut slaves = Vec::new();
    for item in &raw {
        let map = redis_value_to_map(item);
        slaves.push(RedisSentinelSlave {
            ip: map.get("ip").cloned().unwrap_or_default(),
            port: map.get("port").and_then(|v| v.parse().ok()).unwrap_or(0),
            flags: map.get("flags").cloned().unwrap_or_default(),
            master_host: map.get("master-host").cloned(),
            master_port: map.get("master-port").and_then(|v| v.parse().ok()),
            raw: map,
        });
    }
    Ok(slaves)
}

/// SENTINEL SENTINELS master-name → other sentinels for this master
pub async fn sentinel_sentinels(
    client: &mut RedisClient,
    master_name: &str,
) -> Result<Vec<HashMap<String, String>>, RedisError> {
    let raw: Vec<redis::Value> = redis::cmd("SENTINEL")
        .arg("SENTINELS")
        .arg(master_name)
        .query_async(client.con())
        .await?;
    let mut result = Vec::new();
    for item in &raw {
        result.push(redis_value_to_map(item));
    }
    Ok(result)
}

/// SENTINEL GET-MASTER-ADDR-BY-NAME master-name → (ip, port)
pub async fn sentinel_get_master_addr(
    client: &mut RedisClient,
    master_name: &str,
) -> Result<Option<(String, u16)>, RedisError> {
    let raw: Option<(String, String)> = redis::cmd("SENTINEL")
        .arg("GET-MASTER-ADDR-BY-NAME")
        .arg(master_name)
        .query_async(client.con())
        .await?;
    Ok(raw.map(|(ip, port_str)| (ip, port_str.parse().unwrap_or(0))))
}

/// SENTINEL MONITOR name ip port quorum
pub async fn sentinel_monitor(
    client: &mut RedisClient,
    name: &str,
    ip: &str,
    port: u16,
    quorum: u64,
) -> Result<(), RedisError> {
    redis::cmd("SENTINEL")
        .arg("MONITOR")
        .arg(name)
        .arg(ip)
        .arg(port)
        .arg(quorum)
        .query_async::<()>(client.con())
        .await?;
    Ok(())
}

/// SENTINEL REMOVE name
pub async fn sentinel_remove(client: &mut RedisClient, name: &str) -> Result<(), RedisError> {
    redis::cmd("SENTINEL")
        .arg("REMOVE")
        .arg(name)
        .query_async::<()>(client.con())
        .await?;
    Ok(())
}

/// SENTINEL SET name option value
pub async fn sentinel_set(
    client: &mut RedisClient,
    name: &str,
    option: &str,
    value: &str,
) -> Result<(), RedisError> {
    redis::cmd("SENTINEL")
        .arg("SET")
        .arg(name)
        .arg(option)
        .arg(value)
        .query_async::<()>(client.con())
        .await?;
    Ok(())
}

/// SENTINEL FAILOVER master-name
pub async fn sentinel_failover(
    client: &mut RedisClient,
    master_name: &str,
) -> Result<(), RedisError> {
    redis::cmd("SENTINEL")
        .arg("FAILOVER")
        .arg(master_name)
        .query_async::<()>(client.con())
        .await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

fn parse_sentinel_master(map: &HashMap<String, String>) -> RedisSentinelMaster {
    RedisSentinelMaster {
        name: map.get("name").cloned().unwrap_or_default(),
        ip: map.get("ip").cloned().unwrap_or_default(),
        port: map.get("port").and_then(|v| v.parse().ok()).unwrap_or(0),
        runid: map.get("runid").cloned(),
        flags: map.get("flags").cloned().unwrap_or_default(),
        num_slaves: map.get("num-slaves").and_then(|v| v.parse().ok()),
        num_other_sentinels: map.get("num-other-sentinels").and_then(|v| v.parse().ok()),
        quorum: map.get("quorum").and_then(|v| v.parse().ok()),
        raw: map.clone(),
    }
}
