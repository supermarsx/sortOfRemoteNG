//! Set operations: SADD, SREM, SMEMBERS, SISMEMBER, SCARD, etc.

use redis::AsyncCommands;

use crate::client::RedisClient;
use crate::error::RedisError;
use crate::types::RedisScanResult;

/// SADD key member [member ...] → number of elements added
pub async fn sadd(
    client: &mut RedisClient,
    key: &str,
    members: &[String],
) -> Result<u64, RedisError> {
    let added: u64 = client.con().sadd(key, members).await?;
    Ok(added)
}

/// SREM key member [member ...] → number of elements removed
pub async fn srem(
    client: &mut RedisClient,
    key: &str,
    members: &[String],
) -> Result<u64, RedisError> {
    let removed: u64 = client.con().srem(key, members).await?;
    Ok(removed)
}

/// SMEMBERS key → all members
pub async fn smembers(
    client: &mut RedisClient,
    key: &str,
) -> Result<Vec<String>, RedisError> {
    let v: Vec<String> = client.con().smembers(key).await?;
    Ok(v)
}

/// SISMEMBER key member → bool
pub async fn sismember(
    client: &mut RedisClient,
    key: &str,
    member: &str,
) -> Result<bool, RedisError> {
    let v: bool = client.con().sismember(key, member).await?;
    Ok(v)
}

/// SCARD key → cardinality
pub async fn scard(
    client: &mut RedisClient,
    key: &str,
) -> Result<u64, RedisError> {
    let v: u64 = client.con().scard(key).await?;
    Ok(v)
}

/// SDIFF key [key ...] → members in first set but not in others
pub async fn sdiff(
    client: &mut RedisClient,
    keys: &[String],
) -> Result<Vec<String>, RedisError> {
    let v: Vec<String> = client.con().sdiff(keys).await?;
    Ok(v)
}

/// SINTER key [key ...] → intersection
pub async fn sinter(
    client: &mut RedisClient,
    keys: &[String],
) -> Result<Vec<String>, RedisError> {
    let v: Vec<String> = client.con().sinter(keys).await?;
    Ok(v)
}

/// SUNION key [key ...] → union
pub async fn sunion(
    client: &mut RedisClient,
    keys: &[String],
) -> Result<Vec<String>, RedisError> {
    let v: Vec<String> = client.con().sunion(keys).await?;
    Ok(v)
}

/// SRANDMEMBER key [count] → random member(s)
pub async fn srandmember(
    client: &mut RedisClient,
    key: &str,
    count: Option<i64>,
) -> Result<Vec<String>, RedisError> {
    let v: Vec<String> = if let Some(c) = count {
        redis::cmd("SRANDMEMBER")
            .arg(key)
            .arg(c)
            .query_async(client.con())
            .await?
    } else {
        let single: Option<String> = redis::cmd("SRANDMEMBER")
            .arg(key)
            .query_async(client.con())
            .await?;
        single.into_iter().collect()
    };
    Ok(v)
}

/// SPOP key [count] → removed member(s)
pub async fn spop(
    client: &mut RedisClient,
    key: &str,
    count: Option<u64>,
) -> Result<Vec<String>, RedisError> {
    let v: Vec<String> = if let Some(c) = count {
        redis::cmd("SPOP")
            .arg(key)
            .arg(c)
            .query_async(client.con())
            .await?
    } else {
        let single: Option<String> = client.con().spop(key).await?;
        single.into_iter().collect()
    };
    Ok(v)
}

/// SMOVE source destination member → bool
pub async fn smove(
    client: &mut RedisClient,
    source: &str,
    destination: &str,
    member: &str,
) -> Result<bool, RedisError> {
    let v: bool = client.con().smove(source, destination, member).await?;
    Ok(v)
}

/// SSCAN key cursor [MATCH pattern] [COUNT count]
pub async fn sscan(
    client: &mut RedisClient,
    key: &str,
    cursor: u64,
    pattern: Option<&str>,
    count: Option<u64>,
) -> Result<RedisScanResult, RedisError> {
    let mut cmd = redis::cmd("SSCAN");
    cmd.arg(key).arg(cursor);
    if let Some(p) = pattern {
        cmd.arg("MATCH").arg(p);
    }
    if let Some(c) = count {
        cmd.arg("COUNT").arg(c);
    }
    let (new_cursor, members): (u64, Vec<String>) =
        cmd.query_async(client.con()).await?;
    Ok(RedisScanResult {
        cursor: new_cursor,
        keys: members,
    })
}
