//! Server administration operations: INFO, CONFIG, DBSIZE, FLUSHDB, FLUSHALL,
//! SLOWLOG, CLIENT LIST, TIME, BGSAVE, MEMORY, MODULE LIST, COMMAND STATS, etc.

use std::collections::HashMap;

use crate::client::{
    parse_info_sections, redis_value_to_i64, redis_value_to_string, redis_value_to_strings,
    RedisClient,
};
use crate::error::RedisError;
use crate::types::{
    RedisClientInfo, RedisCommandStats, RedisConfigParam, RedisKeyspaceInfo, RedisMemoryStats,
    RedisModuleInfo, RedisServerInfo, RedisSlowLogEntry,
};

/// INFO [section] → parsed server info
pub async fn info(
    client: &mut RedisClient,
    section: Option<&str>,
) -> Result<RedisServerInfo, RedisError> {
    match section {
        Some(s) => client.get_server_info_section(s).await,
        None => client.get_server_info().await,
    }
}

/// CONFIG GET pattern → matching config params
pub async fn config_get(
    client: &mut RedisClient,
    pattern: &str,
) -> Result<Vec<RedisConfigParam>, RedisError> {
    let pairs: Vec<String> = redis::cmd("CONFIG")
        .arg("GET")
        .arg(pattern)
        .query_async(client.con())
        .await?;

    let mut result = Vec::new();
    let mut iter = pairs.into_iter();
    while let Some(key) = iter.next() {
        if let Some(value) = iter.next() {
            result.push(RedisConfigParam { key, value });
        }
    }
    Ok(result)
}

/// CONFIG SET param value
pub async fn config_set(
    client: &mut RedisClient,
    param: &str,
    value: &str,
) -> Result<(), RedisError> {
    redis::cmd("CONFIG")
        .arg("SET")
        .arg(param)
        .arg(value)
        .query_async::<()>(client.con())
        .await?;
    Ok(())
}

/// CONFIG RESETSTAT
pub async fn config_resetstat(client: &mut RedisClient) -> Result<(), RedisError> {
    redis::cmd("CONFIG")
        .arg("RESETSTAT")
        .query_async::<()>(client.con())
        .await?;
    Ok(())
}

/// DBSIZE → number of keys in the current DB
pub async fn dbsize(client: &mut RedisClient) -> Result<i64, RedisError> {
    let v: i64 = redis::cmd("DBSIZE")
        .query_async(client.con())
        .await?;
    Ok(v)
}

/// FLUSHDB [ASYNC]
pub async fn flushdb(client: &mut RedisClient, r#async: bool) -> Result<(), RedisError> {
    let mut cmd = redis::cmd("FLUSHDB");
    if r#async {
        cmd.arg("ASYNC");
    }
    cmd.query_async::<()>(client.con()).await?;
    Ok(())
}

/// FLUSHALL [ASYNC]
pub async fn flushall(client: &mut RedisClient, r#async: bool) -> Result<(), RedisError> {
    let mut cmd = redis::cmd("FLUSHALL");
    if r#async {
        cmd.arg("ASYNC");
    }
    cmd.query_async::<()>(client.con()).await?;
    Ok(())
}

/// SLOWLOG GET [count]
pub async fn slowlog_get(
    client: &mut RedisClient,
    count: Option<i64>,
) -> Result<Vec<RedisSlowLogEntry>, RedisError> {
    let c = count.unwrap_or(10);
    let raw: Vec<Vec<redis::Value>> = redis::cmd("SLOWLOG")
        .arg("GET")
        .arg(c)
        .query_async(client.con())
        .await?;

    let mut entries = Vec::new();
    for entry in raw {
        if entry.len() >= 4 {
            entries.push(RedisSlowLogEntry {
                id: redis_value_to_i64(&entry[0]),
                timestamp: redis_value_to_i64(&entry[1]),
                duration_us: redis_value_to_i64(&entry[2]),
                command: redis_value_to_strings(&entry[3]),
                client_addr: entry.get(4).and_then(redis_value_to_string),
                client_name: entry.get(5).and_then(redis_value_to_string),
            });
        }
    }
    Ok(entries)
}

/// SLOWLOG RESET
pub async fn slowlog_reset(client: &mut RedisClient) -> Result<(), RedisError> {
    redis::cmd("SLOWLOG")
        .arg("RESET")
        .query_async::<()>(client.con())
        .await?;
    Ok(())
}

/// SLOWLOG LEN → count
pub async fn slowlog_len(client: &mut RedisClient) -> Result<u64, RedisError> {
    let v: u64 = redis::cmd("SLOWLOG")
        .arg("LEN")
        .query_async(client.con())
        .await?;
    Ok(v)
}

/// CLIENT LIST → parsed list of connected clients
pub async fn client_list(client: &mut RedisClient) -> Result<Vec<RedisClientInfo>, RedisError> {
    let raw: String = redis::cmd("CLIENT")
        .arg("LIST")
        .query_async(client.con())
        .await?;

    let mut clients = Vec::new();
    for line in raw.lines() {
        if line.is_empty() {
            continue;
        }
        let mut fields = HashMap::new();
        for part in line.split_whitespace() {
            if let Some((k, v)) = part.split_once('=') {
                fields.insert(k.to_string(), v.to_string());
            }
        }
        clients.push(RedisClientInfo {
            id: fields.get("id").cloned().unwrap_or_default(),
            addr: fields.get("addr").cloned().unwrap_or_default(),
            name: fields.get("name").cloned().filter(|s| !s.is_empty()),
            age: fields.get("age").and_then(|v| v.parse().ok()),
            idle: fields.get("idle").and_then(|v| v.parse().ok()),
            db: fields.get("db").and_then(|v| v.parse().ok()),
            cmd: fields.get("cmd").cloned(),
            flags: fields.get("flags").cloned(),
        });
    }
    Ok(clients)
}

/// CLIENT KILL ID client-id
pub async fn client_kill(
    client: &mut RedisClient,
    client_id: &str,
) -> Result<(), RedisError> {
    redis::cmd("CLIENT")
        .arg("KILL")
        .arg("ID")
        .arg(client_id)
        .query_async::<()>(client.con())
        .await?;
    Ok(())
}

/// CLIENT SETNAME connection-name
pub async fn client_setname(
    client: &mut RedisClient,
    name: &str,
) -> Result<(), RedisError> {
    redis::cmd("CLIENT")
        .arg("SETNAME")
        .arg(name)
        .query_async::<()>(client.con())
        .await?;
    Ok(())
}

/// TIME → (unix_timestamp_seconds, microseconds)
pub async fn time(client: &mut RedisClient) -> Result<(i64, i64), RedisError> {
    let v: (String, String) = redis::cmd("TIME")
        .query_async(client.con())
        .await?;
    Ok((
        v.0.parse().unwrap_or(0),
        v.1.parse().unwrap_or(0),
    ))
}

/// LASTSAVE → unix timestamp of last successful save
pub async fn lastsave(client: &mut RedisClient) -> Result<i64, RedisError> {
    let v: i64 = redis::cmd("LASTSAVE")
        .query_async(client.con())
        .await?;
    Ok(v)
}

/// BGSAVE
pub async fn bgsave(client: &mut RedisClient) -> Result<String, RedisError> {
    let v: String = redis::cmd("BGSAVE")
        .query_async(client.con())
        .await?;
    Ok(v)
}

/// BGREWRITEAOF
pub async fn bgrewriteaof(client: &mut RedisClient) -> Result<String, RedisError> {
    let v: String = redis::cmd("BGREWRITEAOF")
        .query_async(client.con())
        .await?;
    Ok(v)
}

/// DEBUG SLEEP seconds (for testing only)
pub async fn debug_sleep(client: &mut RedisClient, seconds: f64) -> Result<(), RedisError> {
    redis::cmd("DEBUG")
        .arg("SLEEP")
        .arg(seconds)
        .query_async::<()>(client.con())
        .await?;
    Ok(())
}

/// MEMORY USAGE key → bytes
pub async fn memory_usage(
    client: &mut RedisClient,
    key: &str,
) -> Result<Option<i64>, RedisError> {
    let v: Option<i64> = redis::cmd("MEMORY")
        .arg("USAGE")
        .arg(key)
        .query_async(client.con())
        .await?;
    Ok(v)
}

/// Parse the memory section of INFO into a `RedisMemoryStats`.
pub async fn memory_stats(client: &mut RedisClient) -> Result<RedisMemoryStats, RedisError> {
    let info_str: String = redis::cmd("INFO")
        .arg("memory")
        .query_async(client.con())
        .await?;
    let sections = parse_info_sections(&info_str);
    let mem = sections
        .get("memory")
        .or_else(|| sections.values().next())
        .cloned()
        .unwrap_or_default();

    Ok(RedisMemoryStats {
        used_memory: mem
            .get("used_memory")
            .and_then(|v| v.parse().ok())
            .unwrap_or(0),
        used_memory_human: mem
            .get("used_memory_human")
            .cloned()
            .unwrap_or_default(),
        used_memory_peak: mem
            .get("used_memory_peak")
            .and_then(|v| v.parse().ok())
            .unwrap_or(0),
        used_memory_peak_human: mem
            .get("used_memory_peak_human")
            .cloned()
            .unwrap_or_default(),
        used_memory_rss: mem
            .get("used_memory_rss")
            .and_then(|v| v.parse().ok())
            .unwrap_or(0),
        used_memory_rss_human: mem.get("used_memory_rss_human").cloned(),
        maxmemory: mem
            .get("maxmemory")
            .and_then(|v| v.parse().ok())
            .unwrap_or(0),
        maxmemory_human: mem
            .get("maxmemory_human")
            .cloned()
            .unwrap_or_default(),
        maxmemory_policy: mem
            .get("maxmemory_policy")
            .cloned()
            .unwrap_or_default(),
        mem_fragmentation_ratio: mem
            .get("mem_fragmentation_ratio")
            .and_then(|v| v.parse().ok()),
        mem_allocator: mem.get("mem_allocator").cloned(),
        total_system_memory: mem
            .get("total_system_memory")
            .and_then(|v| v.parse().ok()),
        total_system_memory_human: mem.get("total_system_memory_human").cloned(),
    })
}

/// MODULE LIST → loaded modules
pub async fn module_list(client: &mut RedisClient) -> Result<Vec<RedisModuleInfo>, RedisError> {
    let raw: Vec<redis::Value> = redis::cmd("MODULE")
        .arg("LIST")
        .query_async(client.con())
        .await?;
    let mut modules = Vec::new();
    for item in &raw {
        let map = crate::client::redis_value_to_map(item);
        modules.push(RedisModuleInfo {
            name: map.get("name").cloned().unwrap_or_default(),
            version: map.get("ver").and_then(|v| v.parse().ok()),
            path: map.get("path").cloned(),
            args: Vec::new(),
        });
    }
    Ok(modules)
}

/// Parse INFO commandstats section into `RedisCommandStats` list.
pub async fn command_stats(
    client: &mut RedisClient,
) -> Result<Vec<RedisCommandStats>, RedisError> {
    let info_str: String = redis::cmd("INFO")
        .arg("commandstats")
        .query_async(client.con())
        .await?;

    let mut stats = Vec::new();
    for line in info_str.lines() {
        let line = line.trim();
        if line.starts_with("cmdstat_") {
            if let Some((name_part, values)) = line.split_once(':') {
                let name = name_part.trim_start_matches("cmdstat_").to_string();
                let mut fields = HashMap::new();
                for part in values.split(',') {
                    if let Some((k, v)) = part.split_once('=') {
                        fields.insert(k.to_string(), v.to_string());
                    }
                }
                stats.push(RedisCommandStats {
                    name,
                    calls: fields
                        .get("calls")
                        .and_then(|v| v.parse().ok())
                        .unwrap_or(0),
                    usec: fields
                        .get("usec")
                        .and_then(|v| v.parse().ok())
                        .unwrap_or(0),
                    usec_per_call: fields
                        .get("usec_per_call")
                        .and_then(|v| v.parse().ok())
                        .unwrap_or(0.0),
                    rejected_calls: fields
                        .get("rejected_calls")
                        .and_then(|v| v.parse().ok()),
                    failed_calls: fields
                        .get("failed_calls")
                        .and_then(|v| v.parse().ok()),
                });
            }
        }
    }
    Ok(stats)
}

/// Parse INFO keyspace section.
pub async fn keyspace_info(
    client: &mut RedisClient,
) -> Result<Vec<RedisKeyspaceInfo>, RedisError> {
    let info_str: String = redis::cmd("INFO")
        .arg("keyspace")
        .query_async(client.con())
        .await?;

    let mut result = Vec::new();
    for line in info_str.lines() {
        let line = line.trim();
        if line.starts_with("db") {
            if let Some((db_part, values)) = line.split_once(':') {
                let db_num: u32 = db_part
                    .trim_start_matches("db")
                    .parse()
                    .unwrap_or(0);
                let mut fields = HashMap::new();
                for part in values.split(',') {
                    if let Some((k, v)) = part.split_once('=') {
                        fields.insert(k.to_string(), v.to_string());
                    }
                }
                result.push(RedisKeyspaceInfo {
                    db: db_num,
                    keys: fields
                        .get("keys")
                        .and_then(|v| v.parse().ok())
                        .unwrap_or(0),
                    expires: fields
                        .get("expires")
                        .and_then(|v| v.parse().ok())
                        .unwrap_or(0),
                    avg_ttl: fields.get("avg_ttl").and_then(|v| v.parse().ok()),
                });
            }
        }
    }
    Ok(result)
}
