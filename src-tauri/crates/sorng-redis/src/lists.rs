//! List operations: LPUSH, RPUSH, LPOP, RPOP, LRANGE, LLEN, etc.

use redis::AsyncCommands;

use crate::client::RedisClient;
use crate::error::RedisError;

/// LPUSH key value [value ...] → new length
pub async fn lpush(
    client: &mut RedisClient,
    key: &str,
    values: &[String],
) -> Result<i64, RedisError> {
    let len: i64 = client.con().lpush(key, values).await?;
    Ok(len)
}

/// RPUSH key value [value ...] → new length
pub async fn rpush(
    client: &mut RedisClient,
    key: &str,
    values: &[String],
) -> Result<i64, RedisError> {
    let len: i64 = client.con().rpush(key, values).await?;
    Ok(len)
}

/// LPOP key → removed element
pub async fn lpop(
    client: &mut RedisClient,
    key: &str,
) -> Result<Option<String>, RedisError> {
    let v: Option<String> = client.con().lpop(key, None).await?;
    Ok(v)
}

/// RPOP key → removed element
pub async fn rpop(
    client: &mut RedisClient,
    key: &str,
) -> Result<Option<String>, RedisError> {
    let v: Option<String> = client.con().rpop(key, None).await?;
    Ok(v)
}

/// LINDEX key index → element at index
pub async fn lindex(
    client: &mut RedisClient,
    key: &str,
    index: i64,
) -> Result<Option<String>, RedisError> {
    let v: Option<String> = client.con().lindex(key, index as isize).await?;
    Ok(v)
}

/// LRANGE key start stop → elements
pub async fn lrange(
    client: &mut RedisClient,
    key: &str,
    start: i64,
    stop: i64,
) -> Result<Vec<String>, RedisError> {
    let v: Vec<String> = client
        .con()
        .lrange(key, start as isize, stop as isize)
        .await?;
    Ok(v)
}

/// LLEN key → length
pub async fn llen(
    client: &mut RedisClient,
    key: &str,
) -> Result<i64, RedisError> {
    let v: i64 = client.con().llen(key).await?;
    Ok(v)
}

/// LSET key index value
pub async fn lset(
    client: &mut RedisClient,
    key: &str,
    index: i64,
    value: &str,
) -> Result<(), RedisError> {
    client.con().lset::<_, _, ()>(key, index as isize, value).await?;
    Ok(())
}

/// LINSERT key BEFORE|AFTER pivot value → new length
pub async fn linsert(
    client: &mut RedisClient,
    key: &str,
    before: bool,
    pivot: &str,
    value: &str,
) -> Result<i64, RedisError> {
    let pos = if before { "BEFORE" } else { "AFTER" };
    let len: i64 = redis::cmd("LINSERT")
        .arg(key)
        .arg(pos)
        .arg(pivot)
        .arg(value)
        .query_async(client.con())
        .await?;
    Ok(len)
}

/// LTRIM key start stop
pub async fn ltrim(
    client: &mut RedisClient,
    key: &str,
    start: i64,
    stop: i64,
) -> Result<(), RedisError> {
    client
        .con()
        .ltrim::<_, ()>(key, start as isize, stop as isize)
        .await?;
    Ok(())
}

/// LREM key count value → number of removed elements
pub async fn lrem(
    client: &mut RedisClient,
    key: &str,
    count: i64,
    value: &str,
) -> Result<i64, RedisError> {
    let removed: i64 = client.con().lrem(key, count as isize, value).await?;
    Ok(removed)
}

/// BLPOP key [key ...] timeout → (key, value) or None on timeout
pub async fn blpop(
    client: &mut RedisClient,
    keys: &[String],
    timeout: f64,
) -> Result<Option<(String, String)>, RedisError> {
    let v: Option<(String, String)> = redis::cmd("BLPOP")
        .arg(keys)
        .arg(timeout)
        .query_async(client.con())
        .await?;
    Ok(v)
}

/// BRPOP key [key ...] timeout → (key, value) or None on timeout
pub async fn brpop(
    client: &mut RedisClient,
    keys: &[String],
    timeout: f64,
) -> Result<Option<(String, String)>, RedisError> {
    let v: Option<(String, String)> = redis::cmd("BRPOP")
        .arg(keys)
        .arg(timeout)
        .query_async(client.con())
        .await?;
    Ok(v)
}

/// LPOS key element [RANK rank] [COUNT count] → positions
pub async fn lpos(
    client: &mut RedisClient,
    key: &str,
    element: &str,
    rank: Option<i64>,
    count: Option<i64>,
) -> Result<Vec<i64>, RedisError> {
    let mut cmd = redis::cmd("LPOS");
    cmd.arg(key).arg(element);
    if let Some(r) = rank {
        cmd.arg("RANK").arg(r);
    }
    if let Some(c) = count {
        cmd.arg("COUNT").arg(c);
    } else {
        cmd.arg("COUNT").arg(0);
    }
    let v: Vec<i64> = cmd.query_async(client.con()).await?;
    Ok(v)
}
