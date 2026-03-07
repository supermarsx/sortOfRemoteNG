//! String operations: GET, SET, MGET, MSET, APPEND, STRLEN, INCR, DECR, etc.

use redis::AsyncCommands;

use crate::client::RedisClient;
use crate::error::RedisError;

/// GET key
pub async fn get(
    client: &mut RedisClient,
    key: &str,
) -> Result<Option<String>, RedisError> {
    let v: Option<String> = client.con().get(key).await?;
    Ok(v)
}

/// SET key value
pub async fn set(
    client: &mut RedisClient,
    key: &str,
    value: &str,
) -> Result<(), RedisError> {
    client.con().set::<_, _, ()>(key, value).await?;
    Ok(())
}

/// MGET key [key ...]
pub async fn mget(
    client: &mut RedisClient,
    keys: &[String],
) -> Result<Vec<Option<String>>, RedisError> {
    let vals: Vec<Option<String>> = client.con().get(keys).await?;
    Ok(vals)
}

/// MSET key value [key value ...]
pub async fn mset(
    client: &mut RedisClient,
    pairs: &[(String, String)],
) -> Result<(), RedisError> {
    let items: Vec<(&str, &str)> = pairs
        .iter()
        .map(|(k, v)| (k.as_str(), v.as_str()))
        .collect();
    client.con().mset::<_, _, ()>(&items).await?;
    Ok(())
}

/// APPEND key value → new length
pub async fn append(
    client: &mut RedisClient,
    key: &str,
    value: &str,
) -> Result<i64, RedisError> {
    let len: i64 = client.con().append(key, value).await?;
    Ok(len)
}

/// STRLEN key → length
pub async fn strlen(
    client: &mut RedisClient,
    key: &str,
) -> Result<i64, RedisError> {
    let len: i64 = redis::cmd("STRLEN")
        .arg(key)
        .query_async(client.con())
        .await?;
    Ok(len)
}

/// INCR key → new value
pub async fn incr(
    client: &mut RedisClient,
    key: &str,
) -> Result<i64, RedisError> {
    let v: i64 = client.con().incr(key, 1i64).await?;
    Ok(v)
}

/// DECR key → new value
pub async fn decr(
    client: &mut RedisClient,
    key: &str,
) -> Result<i64, RedisError> {
    let v: i64 = client.con().decr(key, 1i64).await?;
    Ok(v)
}

/// INCRBY key increment → new value
pub async fn incrby(
    client: &mut RedisClient,
    key: &str,
    increment: i64,
) -> Result<i64, RedisError> {
    let v: i64 = client.con().incr(key, increment).await?;
    Ok(v)
}

/// DECRBY key decrement → new value
pub async fn decrby(
    client: &mut RedisClient,
    key: &str,
    decrement: i64,
) -> Result<i64, RedisError> {
    let v: i64 = client.con().decr(key, decrement).await?;
    Ok(v)
}

/// INCRBYFLOAT key increment → new value as string
pub async fn incrbyfloat(
    client: &mut RedisClient,
    key: &str,
    increment: f64,
) -> Result<f64, RedisError> {
    let v: f64 = redis::cmd("INCRBYFLOAT")
        .arg(key)
        .arg(increment)
        .query_async(client.con())
        .await?;
    Ok(v)
}

/// GETRANGE key start end → substring
pub async fn getrange(
    client: &mut RedisClient,
    key: &str,
    start: i64,
    end: i64,
) -> Result<String, RedisError> {
    let v: String = redis::cmd("GETRANGE")
        .arg(key)
        .arg(start)
        .arg(end)
        .query_async(client.con())
        .await?;
    Ok(v)
}

/// SETRANGE key offset value → new length
pub async fn setrange(
    client: &mut RedisClient,
    key: &str,
    offset: i64,
    value: &str,
) -> Result<i64, RedisError> {
    let len: i64 = redis::cmd("SETRANGE")
        .arg(key)
        .arg(offset)
        .arg(value)
        .query_async(client.con())
        .await?;
    Ok(len)
}

/// SETNX key value → true if the key was set (did not exist before)
pub async fn setnx(
    client: &mut RedisClient,
    key: &str,
    value: &str,
) -> Result<bool, RedisError> {
    let ok: bool = client.con().set_nx(key, value).await?;
    Ok(ok)
}

/// SETEX key seconds value
pub async fn setex(
    client: &mut RedisClient,
    key: &str,
    seconds: u64,
    value: &str,
) -> Result<(), RedisError> {
    redis::cmd("SETEX")
        .arg(key)
        .arg(seconds)
        .arg(value)
        .query_async::<()>(client.con())
        .await?;
    Ok(())
}

/// PSETEX key milliseconds value
pub async fn psetex(
    client: &mut RedisClient,
    key: &str,
    milliseconds: u64,
    value: &str,
) -> Result<(), RedisError> {
    redis::cmd("PSETEX")
        .arg(key)
        .arg(milliseconds)
        .arg(value)
        .query_async::<()>(client.con())
        .await?;
    Ok(())
}

/// GETSET key value → old value (deprecated in Redis 6.2, use GETDEL/GETEX)
pub async fn getset(
    client: &mut RedisClient,
    key: &str,
    value: &str,
) -> Result<Option<String>, RedisError> {
    let old: Option<String> = redis::cmd("GETSET")
        .arg(key)
        .arg(value)
        .query_async(client.con())
        .await?;
    Ok(old)
}
