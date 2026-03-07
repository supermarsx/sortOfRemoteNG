//! Key operations: scan, info, type, TTL, rename, delete, exists.

use redis::AsyncCommands;

use crate::client::RedisClient;
use crate::error::RedisError;
use crate::types::{RedisKeyInfo, RedisKeyType, RedisKeyValue, RedisScanResult, ZSetMember};
use std::collections::HashMap;

/// Scan keys matching a pattern (SCAN cursor MATCH pattern COUNT count).
pub async fn scan_keys(
    client: &mut RedisClient,
    pattern: &str,
    cursor: u64,
    count: Option<u64>,
) -> Result<RedisScanResult, RedisError> {
    let c = count.unwrap_or(100);
    let (new_cursor, keys): (u64, Vec<String>) = redis::cmd("SCAN")
        .arg(cursor)
        .arg("MATCH")
        .arg(pattern)
        .arg("COUNT")
        .arg(c)
        .query_async(client.con())
        .await?;
    Ok(RedisScanResult {
        cursor: new_cursor,
        keys,
    })
}

/// Get the type of a key.
pub async fn key_type(
    client: &mut RedisClient,
    key: &str,
) -> Result<RedisKeyType, RedisError> {
    let t: String = redis::cmd("TYPE")
        .arg(key)
        .query_async(client.con())
        .await?;
    Ok(RedisKeyType::from(t.as_str()))
}

/// Get detailed info about a key (type, TTL, encoding, memory usage).
pub async fn get_key_info(
    client: &mut RedisClient,
    key: &str,
) -> Result<RedisKeyInfo, RedisError> {
    let kt = key_type(client, key).await?;
    let ttl: i64 = client.con().ttl(key).await?;

    let encoding: Option<String> = redis::cmd("OBJECT")
        .arg("ENCODING")
        .arg(key)
        .query_async(client.con())
        .await
        .ok();

    let size: Option<i64> = redis::cmd("MEMORY")
        .arg("USAGE")
        .arg(key)
        .query_async(client.con())
        .await
        .ok();

    Ok(RedisKeyInfo {
        key: key.to_string(),
        key_type: kt,
        ttl,
        size,
        encoding,
    })
}

/// Get the value of a key, auto-detecting the data type.
pub async fn get_key_value(
    client: &mut RedisClient,
    key: &str,
) -> Result<RedisKeyValue, RedisError> {
    let kt = key_type(client, key).await?;
    match kt {
        RedisKeyType::String => {
            let v: Option<String> = client.con().get(key).await?;
            Ok(v.map(RedisKeyValue::String).unwrap_or(RedisKeyValue::None))
        }
        RedisKeyType::List => {
            let v: Vec<String> = client.con().lrange(key, 0, -1).await?;
            Ok(RedisKeyValue::List(v))
        }
        RedisKeyType::Set => {
            let v: Vec<String> = client.con().smembers(key).await?;
            Ok(RedisKeyValue::Set(v))
        }
        RedisKeyType::ZSet => {
            let pairs: Vec<(String, f64)> =
                client.con().zrange_withscores(key, 0, -1).await?;
            Ok(RedisKeyValue::SortedSet(
                pairs
                    .into_iter()
                    .map(|(member, score)| ZSetMember { member, score })
                    .collect(),
            ))
        }
        RedisKeyType::Hash => {
            let map: HashMap<String, String> = client.con().hgetall(key).await?;
            Ok(RedisKeyValue::Hash(map))
        }
        RedisKeyType::Stream => {
            // Return first 100 stream entries
            let entries = crate::streams::xrange(client, key, "-", "+", Some(100)).await?;
            Ok(RedisKeyValue::Stream(entries))
        }
        RedisKeyType::Unknown => Ok(RedisKeyValue::None),
    }
}

/// Set a string key with optional TTL (EX seconds).
pub async fn set_key_value(
    client: &mut RedisClient,
    key: &str,
    value: &str,
    ttl: Option<u64>,
) -> Result<(), RedisError> {
    if let Some(secs) = ttl {
        redis::cmd("SET")
            .arg(key)
            .arg(value)
            .arg("EX")
            .arg(secs)
            .query_async::<()>(client.con())
            .await?;
    } else {
        client.con().set::<_, _, ()>(key, value).await?;
    }
    Ok(())
}

/// Delete one or more keys. Returns the number of keys removed.
pub async fn delete_keys(
    client: &mut RedisClient,
    keys: &[String],
) -> Result<u64, RedisError> {
    let count: u64 = client.con().del(keys).await?;
    Ok(count)
}

/// Rename a key.
pub async fn rename_key(
    client: &mut RedisClient,
    from: &str,
    to: &str,
) -> Result<(), RedisError> {
    client.con().rename::<_, _, ()>(from, to).await?;
    Ok(())
}

/// Set TTL on a key in seconds.
pub async fn set_ttl(
    client: &mut RedisClient,
    key: &str,
    ttl: i64,
) -> Result<bool, RedisError> {
    let ok: bool = client.con().expire(key, ttl).await?;
    Ok(ok)
}

/// Remove TTL (make key persistent).
pub async fn persist_key(
    client: &mut RedisClient,
    key: &str,
) -> Result<bool, RedisError> {
    let ok: bool = client.con().persist(key).await?;
    Ok(ok)
}

/// Check if one or more keys exist. Returns the number that exist.
pub async fn exists(
    client: &mut RedisClient,
    keys: &[String],
) -> Result<u64, RedisError> {
    let count: u64 = redis::cmd("EXISTS")
        .arg(keys)
        .query_async(client.con())
        .await?;
    Ok(count)
}

/// Get TTL in seconds (-1 = no expiry, -2 = key missing).
pub async fn ttl(
    client: &mut RedisClient,
    key: &str,
) -> Result<i64, RedisError> {
    let v: i64 = client.con().ttl(key).await?;
    Ok(v)
}

/// Get TTL in milliseconds.
pub async fn pttl(
    client: &mut RedisClient,
    key: &str,
) -> Result<i64, RedisError> {
    let v: i64 = redis::cmd("PTTL")
        .arg(key)
        .query_async(client.con())
        .await?;
    Ok(v)
}

/// Return a random key from the database.
pub async fn random_key(
    client: &mut RedisClient,
) -> Result<Option<String>, RedisError> {
    let v: Option<String> = redis::cmd("RANDOMKEY")
        .query_async(client.con())
        .await?;
    Ok(v)
}

/// Dump the serialized representation of a key.
pub async fn dump(
    client: &mut RedisClient,
    key: &str,
) -> Result<Vec<u8>, RedisError> {
    let v: Vec<u8> = redis::cmd("DUMP")
        .arg(key)
        .query_async(client.con())
        .await?;
    Ok(v)
}

/// Unlink (async delete) one or more keys.
pub async fn unlink(
    client: &mut RedisClient,
    keys: &[String],
) -> Result<u64, RedisError> {
    let count: u64 = redis::cmd("UNLINK")
        .arg(keys)
        .query_async(client.con())
        .await?;
    Ok(count)
}
