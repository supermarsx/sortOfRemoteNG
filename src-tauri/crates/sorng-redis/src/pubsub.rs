//! Pub/Sub operations: PUBLISH, PUBSUB CHANNELS, PUBSUB NUMSUB, PUBSUB NUMPAT.
//!
//! Note: SUBSCRIBE / PSUBSCRIBE require a dedicated PubSub connection and are
//! not supported through the multiplexed connection used here.  Use the
//! management-oriented introspection commands instead.

use crate::client::RedisClient;
use crate::error::RedisError;
use crate::types::RedisPubSubChannel;

/// PUBLISH channel message → number of clients that received the message
pub async fn publish(
    client: &mut RedisClient,
    channel: &str,
    message: &str,
) -> Result<u64, RedisError> {
    let v: u64 = redis::cmd("PUBLISH")
        .arg(channel)
        .arg(message)
        .query_async(client.con())
        .await?;
    Ok(v)
}

/// PUBSUB CHANNELS [pattern] → list of active channels
pub async fn pubsub_channels(
    client: &mut RedisClient,
    pattern: Option<&str>,
) -> Result<Vec<String>, RedisError> {
    let mut cmd = redis::cmd("PUBSUB");
    cmd.arg("CHANNELS");
    if let Some(p) = pattern {
        cmd.arg(p);
    }
    let v: Vec<String> = cmd.query_async(client.con()).await?;
    Ok(v)
}

/// PUBSUB NUMSUB [channel ...] → channels with subscriber counts
pub async fn pubsub_numsub(
    client: &mut RedisClient,
    channels: &[String],
) -> Result<Vec<RedisPubSubChannel>, RedisError> {
    let mut cmd = redis::cmd("PUBSUB");
    cmd.arg("NUMSUB");
    for ch in channels {
        cmd.arg(ch.as_str());
    }
    let flat: Vec<String> = cmd.query_async(client.con()).await?;

    let mut result = Vec::new();
    let mut iter = flat.into_iter();
    while let Some(channel) = iter.next() {
        let subscribers = iter
            .next()
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(0);
        result.push(RedisPubSubChannel {
            channel,
            subscribers,
        });
    }
    Ok(result)
}

/// PUBSUB NUMPAT → number of active pattern subscriptions
pub async fn pubsub_numpat(
    client: &mut RedisClient,
) -> Result<u64, RedisError> {
    let v: u64 = redis::cmd("PUBSUB")
        .arg("NUMPAT")
        .query_async(client.con())
        .await?;
    Ok(v)
}

/// PUBSUB SHARDCHANNELS [pattern] → list of active shard channels (Redis 7.0+)
pub async fn pubsub_shardchannels(
    client: &mut RedisClient,
    pattern: Option<&str>,
) -> Result<Vec<String>, RedisError> {
    let mut cmd = redis::cmd("PUBSUB");
    cmd.arg("SHARDCHANNELS");
    if let Some(p) = pattern {
        cmd.arg(p);
    }
    let v: Vec<String> = cmd.query_async(client.con()).await?;
    Ok(v)
}

/// PUBSUB SHARDNUMSUB [channel ...] → shard channels with subscriber counts
pub async fn pubsub_shardnumsub(
    client: &mut RedisClient,
    channels: &[String],
) -> Result<Vec<RedisPubSubChannel>, RedisError> {
    let mut cmd = redis::cmd("PUBSUB");
    cmd.arg("SHARDNUMSUB");
    for ch in channels {
        cmd.arg(ch.as_str());
    }
    let flat: Vec<String> = cmd.query_async(client.con()).await?;

    let mut result = Vec::new();
    let mut iter = flat.into_iter();
    while let Some(channel) = iter.next() {
        let subscribers = iter
            .next()
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(0);
        result.push(RedisPubSubChannel {
            channel,
            subscribers,
        });
    }
    Ok(result)
}
