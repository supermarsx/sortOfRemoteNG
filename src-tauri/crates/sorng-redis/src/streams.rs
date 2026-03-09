//! Stream operations: XADD, XLEN, XRANGE, XREVRANGE, XREAD, XTRIM,
//! XINFO, XGROUP, XREADGROUP, XACK, XPENDING, XCLAIM.

use std::collections::HashMap;

use crate::client::{redis_value_to_string, RedisClient};
use crate::error::RedisError;
use crate::types::{
    RedisConsumerGroup, RedisPendingEntry, RedisStreamConsumer, RedisStreamEntry, RedisStreamInfo,
};

/// XADD key [MAXLEN ~ count] id field value [field value ...]
/// Use "*" as id for auto-generated IDs.
pub async fn xadd(
    client: &mut RedisClient,
    key: &str,
    id: &str,
    fields: &[(String, String)],
    maxlen: Option<u64>,
) -> Result<String, RedisError> {
    let mut cmd = redis::cmd("XADD");
    cmd.arg(key);
    if let Some(m) = maxlen {
        cmd.arg("MAXLEN").arg("~").arg(m);
    }
    cmd.arg(id);
    for (f, v) in fields {
        cmd.arg(f.as_str()).arg(v.as_str());
    }
    let entry_id: String = cmd.query_async(client.con()).await?;
    Ok(entry_id)
}

/// XLEN key → number of entries
pub async fn xlen(
    client: &mut RedisClient,
    key: &str,
) -> Result<u64, RedisError> {
    let v: u64 = redis::cmd("XLEN")
        .arg(key)
        .query_async(client.con())
        .await?;
    Ok(v)
}

/// XRANGE key start end [COUNT count] → entries
pub async fn xrange(
    client: &mut RedisClient,
    key: &str,
    start: &str,
    end: &str,
    count: Option<u64>,
) -> Result<Vec<RedisStreamEntry>, RedisError> {
    let mut cmd = redis::cmd("XRANGE");
    cmd.arg(key).arg(start).arg(end);
    if let Some(c) = count {
        cmd.arg("COUNT").arg(c);
    }
    let raw: Vec<redis::Value> = cmd.query_async(client.con()).await?;
    Ok(parse_stream_entries(&raw))
}

/// XREVRANGE key end start [COUNT count] → entries (reverse order)
pub async fn xrevrange(
    client: &mut RedisClient,
    key: &str,
    end: &str,
    start: &str,
    count: Option<u64>,
) -> Result<Vec<RedisStreamEntry>, RedisError> {
    let mut cmd = redis::cmd("XREVRANGE");
    cmd.arg(key).arg(end).arg(start);
    if let Some(c) = count {
        cmd.arg("COUNT").arg(c);
    }
    let raw: Vec<redis::Value> = cmd.query_async(client.con()).await?;
    Ok(parse_stream_entries(&raw))
}

/// XREAD [COUNT count] [BLOCK milliseconds] STREAMS key [key ...] id [id ...]
pub async fn xread(
    client: &mut RedisClient,
    keys: &[String],
    ids: &[String],
    count: Option<u64>,
    block: Option<u64>,
) -> Result<Vec<(String, Vec<RedisStreamEntry>)>, RedisError> {
    let mut cmd = redis::cmd("XREAD");
    if let Some(c) = count {
        cmd.arg("COUNT").arg(c);
    }
    if let Some(b) = block {
        cmd.arg("BLOCK").arg(b);
    }
    cmd.arg("STREAMS");
    for k in keys {
        cmd.arg(k.as_str());
    }
    for id in ids {
        cmd.arg(id.as_str());
    }
    let raw: redis::Value = cmd.query_async(client.con()).await?;
    Ok(parse_xread_result(&raw))
}

/// XTRIM key MAXLEN [~] count → number of entries deleted
pub async fn xtrim(
    client: &mut RedisClient,
    key: &str,
    maxlen: u64,
    approximate: bool,
) -> Result<u64, RedisError> {
    let mut cmd = redis::cmd("XTRIM");
    cmd.arg(key).arg("MAXLEN");
    if approximate {
        cmd.arg("~");
    }
    cmd.arg(maxlen);
    let v: u64 = cmd.query_async(client.con()).await?;
    Ok(v)
}

/// XINFO STREAM key
pub async fn xinfo_stream(
    client: &mut RedisClient,
    key: &str,
) -> Result<RedisStreamInfo, RedisError> {
    let raw: redis::Value = redis::cmd("XINFO")
        .arg("STREAM")
        .arg(key)
        .query_async(client.con())
        .await?;
    let map = crate::client::redis_value_to_map(&raw);
    Ok(RedisStreamInfo {
        length: map
            .get("length")
            .and_then(|v| v.parse().ok())
            .unwrap_or(0),
        radix_tree_keys: map
            .get("radix-tree-keys")
            .and_then(|v| v.parse().ok())
            .unwrap_or(0),
        radix_tree_nodes: map
            .get("radix-tree-nodes")
            .and_then(|v| v.parse().ok())
            .unwrap_or(0),
        groups: map
            .get("groups")
            .and_then(|v| v.parse().ok())
            .unwrap_or(0),
        last_generated_id: map.get("last-generated-id").cloned(),
        first_entry: None,
        last_entry: None,
    })
}

/// XGROUP CREATE key groupname id [MKSTREAM]
pub async fn xgroup_create(
    client: &mut RedisClient,
    key: &str,
    group: &str,
    id: &str,
    mkstream: bool,
) -> Result<(), RedisError> {
    let mut cmd = redis::cmd("XGROUP");
    cmd.arg("CREATE").arg(key).arg(group).arg(id);
    if mkstream {
        cmd.arg("MKSTREAM");
    }
    cmd.query_async::<()>(client.con()).await?;
    Ok(())
}

/// XGROUP DESTROY key groupname
pub async fn xgroup_destroy(
    client: &mut RedisClient,
    key: &str,
    group: &str,
) -> Result<bool, RedisError> {
    let v: bool = redis::cmd("XGROUP")
        .arg("DESTROY")
        .arg(key)
        .arg(group)
        .query_async(client.con())
        .await?;
    Ok(v)
}

/// XREADGROUP GROUP group consumer [COUNT count] [BLOCK ms] STREAMS key id
pub async fn xreadgroup(
    client: &mut RedisClient,
    group: &str,
    consumer: &str,
    keys: &[String],
    ids: &[String],
    count: Option<u64>,
    block: Option<u64>,
) -> Result<Vec<(String, Vec<RedisStreamEntry>)>, RedisError> {
    let mut cmd = redis::cmd("XREADGROUP");
    cmd.arg("GROUP").arg(group).arg(consumer);
    if let Some(c) = count {
        cmd.arg("COUNT").arg(c);
    }
    if let Some(b) = block {
        cmd.arg("BLOCK").arg(b);
    }
    cmd.arg("STREAMS");
    for k in keys {
        cmd.arg(k.as_str());
    }
    for id in ids {
        cmd.arg(id.as_str());
    }
    let raw: redis::Value = cmd.query_async(client.con()).await?;
    Ok(parse_xread_result(&raw))
}

/// XACK key group id [id ...]
pub async fn xack(
    client: &mut RedisClient,
    key: &str,
    group: &str,
    ids: &[String],
) -> Result<u64, RedisError> {
    let mut cmd = redis::cmd("XACK");
    cmd.arg(key).arg(group);
    for id in ids {
        cmd.arg(id.as_str());
    }
    let v: u64 = cmd.query_async(client.con()).await?;
    Ok(v)
}

/// XPENDING key group [start end count]
pub async fn xpending(
    client: &mut RedisClient,
    key: &str,
    group: &str,
    start: Option<&str>,
    end: Option<&str>,
    count: Option<u64>,
) -> Result<Vec<RedisPendingEntry>, RedisError> {
    let mut cmd = redis::cmd("XPENDING");
    cmd.arg(key).arg(group);
    if let (Some(s), Some(e), Some(c)) = (start, end, count) {
        cmd.arg(s).arg(e).arg(c);
    }
    let raw: Vec<redis::Value> = cmd.query_async(client.con()).await?;
    let mut entries = Vec::new();
    for item in &raw {
        if let redis::Value::Array(arr) = item {
            if arr.len() >= 4 {
                entries.push(RedisPendingEntry {
                    id: redis_value_to_string(&arr[0]).unwrap_or_default(),
                    consumer: redis_value_to_string(&arr[1]).unwrap_or_default(),
                    idle_ms: crate::client::redis_value_to_i64(&arr[2]) as u64,
                    delivery_count: crate::client::redis_value_to_i64(&arr[3]) as u64,
                });
            }
        }
    }
    Ok(entries)
}

/// XCLAIM key group consumer min-idle-time id [id ...]
pub async fn xclaim(
    client: &mut RedisClient,
    key: &str,
    group: &str,
    consumer: &str,
    min_idle_time: u64,
    ids: &[String],
) -> Result<Vec<RedisStreamEntry>, RedisError> {
    let mut cmd = redis::cmd("XCLAIM");
    cmd.arg(key).arg(group).arg(consumer).arg(min_idle_time);
    for id in ids {
        cmd.arg(id.as_str());
    }
    let raw: Vec<redis::Value> = cmd.query_async(client.con()).await?;
    Ok(parse_stream_entries(&raw))
}

/// XINFO GROUPS key
pub async fn xinfo_groups(
    client: &mut RedisClient,
    key: &str,
) -> Result<Vec<RedisConsumerGroup>, RedisError> {
    let raw: Vec<redis::Value> = redis::cmd("XINFO")
        .arg("GROUPS")
        .arg(key)
        .query_async(client.con())
        .await?;
    let mut groups = Vec::new();
    for item in &raw {
        let map = crate::client::redis_value_to_map(item);
        groups.push(RedisConsumerGroup {
            name: map.get("name").cloned().unwrap_or_default(),
            consumers: map
                .get("consumers")
                .and_then(|v| v.parse().ok())
                .unwrap_or(0),
            pending: map
                .get("pending")
                .and_then(|v| v.parse().ok())
                .unwrap_or(0),
            last_delivered_id: map
                .get("last-delivered-id")
                .cloned()
                .unwrap_or_default(),
        });
    }
    Ok(groups)
}

/// XINFO CONSUMERS key group
pub async fn xinfo_consumers(
    client: &mut RedisClient,
    key: &str,
    group: &str,
) -> Result<Vec<RedisStreamConsumer>, RedisError> {
    let raw: Vec<redis::Value> = redis::cmd("XINFO")
        .arg("CONSUMERS")
        .arg(key)
        .arg(group)
        .query_async(client.con())
        .await?;
    let mut consumers = Vec::new();
    for item in &raw {
        let map = crate::client::redis_value_to_map(item);
        consumers.push(RedisStreamConsumer {
            name: map.get("name").cloned().unwrap_or_default(),
            pending: map
                .get("pending")
                .and_then(|v| v.parse().ok())
                .unwrap_or(0),
            idle: map
                .get("idle")
                .and_then(|v| v.parse().ok())
                .unwrap_or(0),
        });
    }
    Ok(consumers)
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// Parse a flat list of `[id, [field, value, ...], ...]` entries.
fn parse_stream_entries(raw: &[redis::Value]) -> Vec<RedisStreamEntry> {
    let mut entries = Vec::new();
    for item in raw {
        if let redis::Value::Array(pair) = item {
            if pair.len() >= 2 {
                let id = redis_value_to_string(&pair[0]).unwrap_or_default();
                let mut fields = HashMap::new();
                if let redis::Value::Array(fv) = &pair[1] {
                    let mut iter = fv.iter();
                    while let Some(k) = iter.next() {
                        if let Some(v) = iter.next() {
                            if let (Some(key), Some(val)) =
                                (redis_value_to_string(k), redis_value_to_string(v))
                            {
                                fields.insert(key, val);
                            }
                        }
                    }
                }
                entries.push(RedisStreamEntry { id, fields });
            }
        }
    }
    entries
}

/// Parse the result of XREAD / XREADGROUP into `(stream_key, entries)` tuples.
fn parse_xread_result(val: &redis::Value) -> Vec<(String, Vec<RedisStreamEntry>)> {
    let mut result = Vec::new();
    if let redis::Value::Array(streams) = val {
        for stream in streams {
            if let redis::Value::Array(pair) = stream {
                if pair.len() >= 2 {
                    let key = redis_value_to_string(&pair[0]).unwrap_or_default();
                    let entries = if let redis::Value::Array(arr) = &pair[1] {
                        parse_stream_entries(arr)
                    } else {
                        Vec::new()
                    };
                    result.push((key, entries));
                }
            }
        }
    }
    result
}
