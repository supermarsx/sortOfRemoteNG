//! Hash operations: HSET, HGET, HMSET, HMGET, HDEL, HGETALL, etc.

use redis::AsyncCommands;
use std::collections::HashMap;

use crate::client::RedisClient;
use crate::error::RedisError;

/// HSET key field value → number of fields added
pub async fn hset(
    client: &mut RedisClient,
    key: &str,
    field: &str,
    value: &str,
) -> Result<u64, RedisError> {
    let v: u64 = client.con().hset(key, field, value).await?;
    Ok(v)
}

/// HGET key field → value
pub async fn hget(
    client: &mut RedisClient,
    key: &str,
    field: &str,
) -> Result<Option<String>, RedisError> {
    let v: Option<String> = client.con().hget(key, field).await?;
    Ok(v)
}

/// HMSET key field value [field value ...]
pub async fn hmset(
    client: &mut RedisClient,
    key: &str,
    fields: &[(String, String)],
) -> Result<(), RedisError> {
    let items: Vec<(&str, &str)> = fields
        .iter()
        .map(|(k, v)| (k.as_str(), v.as_str()))
        .collect();
    client
        .con()
        .hset_multiple::<_, _, _, ()>(key, &items)
        .await?;
    Ok(())
}

/// HMGET key field [field ...] → values
pub async fn hmget(
    client: &mut RedisClient,
    key: &str,
    fields: &[String],
) -> Result<Vec<Option<String>>, RedisError> {
    let v: Vec<Option<String>> = client.con().hget(key, fields).await?;
    Ok(v)
}

/// HDEL key field [field ...] → number of removed fields
pub async fn hdel(
    client: &mut RedisClient,
    key: &str,
    fields: &[String],
) -> Result<u64, RedisError> {
    let v: u64 = client.con().hdel(key, fields).await?;
    Ok(v)
}

/// HGETALL key → all fields and values
pub async fn hgetall(
    client: &mut RedisClient,
    key: &str,
) -> Result<HashMap<String, String>, RedisError> {
    let v: HashMap<String, String> = client.con().hgetall(key).await?;
    Ok(v)
}

/// HKEYS key → all field names
pub async fn hkeys(client: &mut RedisClient, key: &str) -> Result<Vec<String>, RedisError> {
    let v: Vec<String> = client.con().hkeys(key).await?;
    Ok(v)
}

/// HVALS key → all values
pub async fn hvals(client: &mut RedisClient, key: &str) -> Result<Vec<String>, RedisError> {
    let v: Vec<String> = client.con().hvals(key).await?;
    Ok(v)
}

/// HLEN key → number of fields
pub async fn hlen(client: &mut RedisClient, key: &str) -> Result<u64, RedisError> {
    let v: u64 = client.con().hlen(key).await?;
    Ok(v)
}

/// HEXISTS key field → bool
pub async fn hexists(client: &mut RedisClient, key: &str, field: &str) -> Result<bool, RedisError> {
    let v: bool = client.con().hexists(key, field).await?;
    Ok(v)
}

/// HINCRBY key field increment → new value
pub async fn hincrby(
    client: &mut RedisClient,
    key: &str,
    field: &str,
    increment: i64,
) -> Result<i64, RedisError> {
    let v: i64 = client.con().hincr(key, field, increment).await?;
    Ok(v)
}

/// HINCRBYFLOAT key field increment → new value
pub async fn hincrbyfloat(
    client: &mut RedisClient,
    key: &str,
    field: &str,
    increment: f64,
) -> Result<f64, RedisError> {
    let v: f64 = redis::cmd("HINCRBYFLOAT")
        .arg(key)
        .arg(field)
        .arg(increment)
        .query_async(client.con())
        .await?;
    Ok(v)
}

/// HSCAN key cursor [MATCH pattern] [COUNT count]
pub async fn hscan(
    client: &mut RedisClient,
    key: &str,
    cursor: u64,
    pattern: Option<&str>,
    count: Option<u64>,
) -> Result<(u64, HashMap<String, String>), RedisError> {
    let mut cmd = redis::cmd("HSCAN");
    cmd.arg(key).arg(cursor);
    if let Some(p) = pattern {
        cmd.arg("MATCH").arg(p);
    }
    if let Some(c) = count {
        cmd.arg("COUNT").arg(c);
    }
    let (new_cursor, flat): (u64, Vec<String>) = cmd.query_async(client.con()).await?;

    let mut map = HashMap::new();
    let mut iter = flat.into_iter();
    while let Some(k) = iter.next() {
        if let Some(v) = iter.next() {
            map.insert(k, v);
        }
    }
    Ok((new_cursor, map))
}

/// HSETNX key field value → true if field was set (did not exist)
pub async fn hsetnx(
    client: &mut RedisClient,
    key: &str,
    field: &str,
    value: &str,
) -> Result<bool, RedisError> {
    let v: bool = client.con().hset_nx(key, field, value).await?;
    Ok(v)
}
