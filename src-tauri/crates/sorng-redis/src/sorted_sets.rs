//! Sorted set operations: ZADD, ZREM, ZRANGE, ZREVRANGE, ZSCORE, etc.

use redis::AsyncCommands;

use crate::client::RedisClient;
use crate::error::RedisError;
use crate::types::ZSetMember;

/// ZADD key score member [score member ...] → number added
pub async fn zadd(
    client: &mut RedisClient,
    key: &str,
    members: &[(f64, String)],
) -> Result<u64, RedisError> {
    let mut cmd = redis::cmd("ZADD");
    cmd.arg(key);
    for (score, member) in members {
        cmd.arg(score).arg(member.as_str());
    }
    let v: u64 = cmd.query_async(client.con()).await?;
    Ok(v)
}

/// ZREM key member [member ...] → number removed
pub async fn zrem(
    client: &mut RedisClient,
    key: &str,
    members: &[String],
) -> Result<u64, RedisError> {
    let v: u64 = client.con().zrem(key, members).await?;
    Ok(v)
}

/// ZRANGE key start stop [WITHSCORES]
pub async fn zrange(
    client: &mut RedisClient,
    key: &str,
    start: i64,
    stop: i64,
    with_scores: bool,
) -> Result<Vec<ZSetMember>, RedisError> {
    if with_scores {
        let pairs: Vec<(String, f64)> = client
            .con()
            .zrange_withscores(key, start as isize, stop as isize)
            .await?;
        Ok(pairs
            .into_iter()
            .map(|(member, score)| ZSetMember { member, score })
            .collect())
    } else {
        let members: Vec<String> = client
            .con()
            .zrange(key, start as isize, stop as isize)
            .await?;
        Ok(members
            .into_iter()
            .map(|member| ZSetMember {
                member,
                score: 0.0,
            })
            .collect())
    }
}

/// ZREVRANGE key start stop [WITHSCORES]
pub async fn zrevrange(
    client: &mut RedisClient,
    key: &str,
    start: i64,
    stop: i64,
    with_scores: bool,
) -> Result<Vec<ZSetMember>, RedisError> {
    if with_scores {
        let pairs: Vec<(String, f64)> = client
            .con()
            .zrevrange_withscores(key, start as isize, stop as isize)
            .await?;
        Ok(pairs
            .into_iter()
            .map(|(member, score)| ZSetMember { member, score })
            .collect())
    } else {
        let members: Vec<String> = client
            .con()
            .zrevrange(key, start as isize, stop as isize)
            .await?;
        Ok(members
            .into_iter()
            .map(|member| ZSetMember {
                member,
                score: 0.0,
            })
            .collect())
    }
}

/// ZRANGEBYSCORE key min max [LIMIT offset count]
pub async fn zrangebyscore(
    client: &mut RedisClient,
    key: &str,
    min: &str,
    max: &str,
    offset: Option<i64>,
    count: Option<i64>,
) -> Result<Vec<ZSetMember>, RedisError> {
    let mut cmd = redis::cmd("ZRANGEBYSCORE");
    cmd.arg(key).arg(min).arg(max).arg("WITHSCORES");
    if let (Some(o), Some(c)) = (offset, count) {
        cmd.arg("LIMIT").arg(o).arg(c);
    }
    let flat: Vec<String> = cmd.query_async(client.con()).await?;
    let mut result = Vec::new();
    let mut iter = flat.into_iter();
    while let Some(member) = iter.next() {
        let score = iter
            .next()
            .and_then(|s| s.parse::<f64>().ok())
            .unwrap_or(0.0);
        result.push(ZSetMember { member, score });
    }
    Ok(result)
}

/// ZRANK key member → rank (0-based) or None
pub async fn zrank(
    client: &mut RedisClient,
    key: &str,
    member: &str,
) -> Result<Option<u64>, RedisError> {
    let v: Option<u64> = client.con().zrank(key, member).await?;
    Ok(v)
}

/// ZREVRANK key member → reverse rank or None
pub async fn zrevrank(
    client: &mut RedisClient,
    key: &str,
    member: &str,
) -> Result<Option<u64>, RedisError> {
    let v: Option<u64> = client.con().zrevrank(key, member).await?;
    Ok(v)
}

/// ZCARD key → cardinality
pub async fn zcard(
    client: &mut RedisClient,
    key: &str,
) -> Result<u64, RedisError> {
    let v: u64 = client.con().zcard(key).await?;
    Ok(v)
}

/// ZSCORE key member → score or None
pub async fn zscore(
    client: &mut RedisClient,
    key: &str,
    member: &str,
) -> Result<Option<f64>, RedisError> {
    let v: Option<f64> = client.con().zscore(key, member).await?;
    Ok(v)
}

/// ZINCRBY key increment member → new score
pub async fn zincrby(
    client: &mut RedisClient,
    key: &str,
    increment: f64,
    member: &str,
) -> Result<f64, RedisError> {
    let v: f64 = client.con().zincr(key, member, increment).await?;
    Ok(v)
}

/// ZCOUNT key min max → count
pub async fn zcount(
    client: &mut RedisClient,
    key: &str,
    min: &str,
    max: &str,
) -> Result<u64, RedisError> {
    let v: u64 = redis::cmd("ZCOUNT")
        .arg(key)
        .arg(min)
        .arg(max)
        .query_async(client.con())
        .await?;
    Ok(v)
}

/// ZLEXCOUNT key min max → count
pub async fn zlexcount(
    client: &mut RedisClient,
    key: &str,
    min: &str,
    max: &str,
) -> Result<u64, RedisError> {
    let v: u64 = redis::cmd("ZLEXCOUNT")
        .arg(key)
        .arg(min)
        .arg(max)
        .query_async(client.con())
        .await?;
    Ok(v)
}

/// ZPOPMIN key [count] → lowest-score members
pub async fn zpopmin(
    client: &mut RedisClient,
    key: &str,
    count: Option<u64>,
) -> Result<Vec<ZSetMember>, RedisError> {
    let mut cmd = redis::cmd("ZPOPMIN");
    cmd.arg(key);
    if let Some(c) = count {
        cmd.arg(c);
    }
    let flat: Vec<String> = cmd.query_async(client.con()).await?;
    let mut result = Vec::new();
    let mut iter = flat.into_iter();
    while let Some(member) = iter.next() {
        let score = iter
            .next()
            .and_then(|s| s.parse::<f64>().ok())
            .unwrap_or(0.0);
        result.push(ZSetMember { member, score });
    }
    Ok(result)
}

/// ZPOPMAX key [count] → highest-score members
pub async fn zpopmax(
    client: &mut RedisClient,
    key: &str,
    count: Option<u64>,
) -> Result<Vec<ZSetMember>, RedisError> {
    let mut cmd = redis::cmd("ZPOPMAX");
    cmd.arg(key);
    if let Some(c) = count {
        cmd.arg(c);
    }
    let flat: Vec<String> = cmd.query_async(client.con()).await?;
    let mut result = Vec::new();
    let mut iter = flat.into_iter();
    while let Some(member) = iter.next() {
        let score = iter
            .next()
            .and_then(|s| s.parse::<f64>().ok())
            .unwrap_or(0.0);
        result.push(ZSetMember { member, score });
    }
    Ok(result)
}

/// ZSCAN key cursor [MATCH pattern] [COUNT count]
pub async fn zscan(
    client: &mut RedisClient,
    key: &str,
    cursor: u64,
    pattern: Option<&str>,
    count: Option<u64>,
) -> Result<(u64, Vec<ZSetMember>), RedisError> {
    let mut cmd = redis::cmd("ZSCAN");
    cmd.arg(key).arg(cursor);
    if let Some(p) = pattern {
        cmd.arg("MATCH").arg(p);
    }
    if let Some(c) = count {
        cmd.arg("COUNT").arg(c);
    }
    let (new_cursor, flat): (u64, Vec<String>) =
        cmd.query_async(client.con()).await?;
    let mut result = Vec::new();
    let mut iter = flat.into_iter();
    while let Some(member) = iter.next() {
        let score = iter
            .next()
            .and_then(|s| s.parse::<f64>().ok())
            .unwrap_or(0.0);
        result.push(ZSetMember { member, score });
    }
    Ok((new_cursor, result))
}

/// ZUNIONSTORE destination numkeys key [key ...] → cardinality of result
pub async fn zunionstore(
    client: &mut RedisClient,
    destination: &str,
    keys: &[String],
) -> Result<u64, RedisError> {
    let mut cmd = redis::cmd("ZUNIONSTORE");
    cmd.arg(destination).arg(keys.len());
    for k in keys {
        cmd.arg(k.as_str());
    }
    let v: u64 = cmd.query_async(client.con()).await?;
    Ok(v)
}

/// ZINTERSTORE destination numkeys key [key ...] → cardinality of result
pub async fn zinterstore(
    client: &mut RedisClient,
    destination: &str,
    keys: &[String],
) -> Result<u64, RedisError> {
    let mut cmd = redis::cmd("ZINTERSTORE");
    cmd.arg(destination).arg(keys.len());
    for k in keys {
        cmd.arg(k.as_str());
    }
    let v: u64 = cmd.query_async(client.con()).await?;
    Ok(v)
}
