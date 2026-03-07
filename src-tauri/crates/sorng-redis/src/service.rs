//! Service façade — thread-safe state management that holds multiple Redis
//! sessions and delegates operations to the per-subsystem modules.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::client::RedisClient;
use crate::error::RedisError;
use crate::types::*;

// ---------------------------------------------------------------------------
// State types
// ---------------------------------------------------------------------------

/// Thread-safe shared state for the Redis service.
pub type RedisServiceState = Arc<Mutex<RedisService>>;

/// Create a new default service state wrapped in `Arc<Mutex<>>`.
pub fn new_state() -> RedisServiceState {
    Arc::new(Mutex::new(RedisService::new()))
}

/// An active session holding a client and its metadata.
struct SessionEntry {
    client: RedisClient,
    config: RedisConnectionConfig,
    connected_at: chrono::DateTime<chrono::Utc>,
    server_info: Option<RedisServerInfo>,
    ssh_child: Option<std::process::Child>,
}

// ---------------------------------------------------------------------------
// RedisService
// ---------------------------------------------------------------------------

/// Façade that manages multiple Redis sessions and delegates operations
/// to the appropriate module functions.
pub struct RedisService {
    sessions: HashMap<String, SessionEntry>,
}

impl RedisService {
    /// Create an empty service with no sessions.
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
        }
    }

    // ── Session management ──────────────────────────────────────────

    /// Connect to a Redis instance and return a `RedisSession`.
    pub async fn connect(
        &mut self,
        config: RedisConnectionConfig,
    ) -> Result<RedisSession, RedisError> {
        // SSH tunnel stub
        let ssh_child = if config.ssh_tunnel.is_some() {
            log::warn!("SSH tunnel support for Redis is a stub — connecting directly");
            None
        } else {
            None
        };

        let mut client = RedisClient::new(&config).await?;

        // Verify connectivity
        let pong: String = redis::cmd("PING")
            .query_async(client.con())
            .await
            .map_err(|e| RedisError::connection_failed(format!("PING failed: {}", e)))?;
        if pong != "PONG" {
            return Err(RedisError::connection_failed(format!(
                "Unexpected PING response: {}",
                pong
            )));
        }

        // Fetch server info
        let server_info = client.get_server_info().await.ok();

        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now();

        let session = RedisSession {
            id: id.clone(),
            config: config.clone(),
            connected_at: now,
            server_info: server_info.clone(),
        };

        self.sessions.insert(
            id.clone(),
            SessionEntry {
                client,
                config,
                connected_at: now,
                server_info,
                ssh_child,
            },
        );

        log::info!("Redis session {} connected", id);
        Ok(session)
    }

    /// Disconnect and remove a session.
    pub fn disconnect(&mut self, session_id: &str) -> Result<(), RedisError> {
        let mut entry = self
            .sessions
            .remove(session_id)
            .ok_or_else(|| RedisError::session_not_found(session_id))?;

        if let Some(ref mut child) = entry.ssh_child {
            let _ = child.kill();
        }

        log::info!("Redis session {} disconnected", session_id);
        Ok(())
    }

    /// List all active sessions.
    pub fn list_sessions(&self) -> Vec<RedisSession> {
        self.sessions
            .iter()
            .map(|(id, entry)| RedisSession {
                id: id.clone(),
                config: entry.config.clone(),
                connected_at: entry.connected_at,
                server_info: entry.server_info.clone(),
            })
            .collect()
    }

    /// Test connectivity by PINGing the server.
    pub async fn test_connection(&mut self, session_id: &str) -> Result<bool, RedisError> {
        let client = self.get_client(session_id)?;
        let result: Result<String, _> = redis::cmd("PING")
            .query_async(client.con())
            .await;
        Ok(result.map(|s| s == "PONG").unwrap_or(false))
    }

    /// Internal helper — get a mutable reference to a session's client.
    fn get_client(&mut self, session_id: &str) -> Result<&mut RedisClient, RedisError> {
        self.sessions
            .get_mut(session_id)
            .map(|entry| &mut entry.client)
            .ok_or_else(|| RedisError::session_not_found(session_id))
    }

    // ── Key operations ──────────────────────────────────────────────

    pub async fn scan_keys(
        &mut self,
        session_id: &str,
        pattern: &str,
        cursor: u64,
        count: Option<u64>,
    ) -> Result<RedisScanResult, RedisError> {
        let client = self.get_client(session_id)?;
        crate::keys::scan_keys(client, pattern, cursor, count).await
    }

    pub async fn get_key_info(
        &mut self,
        session_id: &str,
        key: &str,
    ) -> Result<RedisKeyInfo, RedisError> {
        let client = self.get_client(session_id)?;
        crate::keys::get_key_info(client, key).await
    }

    pub async fn get_key_value(
        &mut self,
        session_id: &str,
        key: &str,
    ) -> Result<RedisKeyValue, RedisError> {
        let client = self.get_client(session_id)?;
        crate::keys::get_key_value(client, key).await
    }

    pub async fn set_key_value(
        &mut self,
        session_id: &str,
        key: &str,
        value: &str,
        ttl: Option<u64>,
    ) -> Result<(), RedisError> {
        let client = self.get_client(session_id)?;
        crate::keys::set_key_value(client, key, value, ttl).await
    }

    pub async fn delete_keys(
        &mut self,
        session_id: &str,
        keys: &[String],
    ) -> Result<u64, RedisError> {
        let client = self.get_client(session_id)?;
        crate::keys::delete_keys(client, keys).await
    }

    pub async fn rename_key(
        &mut self,
        session_id: &str,
        from: &str,
        to: &str,
    ) -> Result<(), RedisError> {
        let client = self.get_client(session_id)?;
        crate::keys::rename_key(client, from, to).await
    }

    pub async fn set_ttl(
        &mut self,
        session_id: &str,
        key: &str,
        ttl: i64,
    ) -> Result<bool, RedisError> {
        let client = self.get_client(session_id)?;
        crate::keys::set_ttl(client, key, ttl).await
    }

    pub async fn persist_key(
        &mut self,
        session_id: &str,
        key: &str,
    ) -> Result<bool, RedisError> {
        let client = self.get_client(session_id)?;
        crate::keys::persist_key(client, key).await
    }

    // ── String operations ───────────────────────────────────────────

    pub async fn string_get(
        &mut self,
        session_id: &str,
        key: &str,
    ) -> Result<Option<String>, RedisError> {
        let client = self.get_client(session_id)?;
        crate::strings::get(client, key).await
    }

    pub async fn string_set(
        &mut self,
        session_id: &str,
        key: &str,
        value: &str,
    ) -> Result<(), RedisError> {
        let client = self.get_client(session_id)?;
        crate::strings::set(client, key, value).await
    }

    pub async fn string_mget(
        &mut self,
        session_id: &str,
        keys: &[String],
    ) -> Result<Vec<Option<String>>, RedisError> {
        let client = self.get_client(session_id)?;
        crate::strings::mget(client, keys).await
    }

    pub async fn string_incr(
        &mut self,
        session_id: &str,
        key: &str,
    ) -> Result<i64, RedisError> {
        let client = self.get_client(session_id)?;
        crate::strings::incr(client, key).await
    }

    pub async fn string_decr(
        &mut self,
        session_id: &str,
        key: &str,
    ) -> Result<i64, RedisError> {
        let client = self.get_client(session_id)?;
        crate::strings::decr(client, key).await
    }

    // ── List operations ─────────────────────────────────────────────

    pub async fn list_range(
        &mut self,
        session_id: &str,
        key: &str,
        start: i64,
        stop: i64,
    ) -> Result<Vec<String>, RedisError> {
        let client = self.get_client(session_id)?;
        crate::lists::lrange(client, key, start, stop).await
    }

    pub async fn list_push(
        &mut self,
        session_id: &str,
        key: &str,
        values: &[String],
        left: bool,
    ) -> Result<i64, RedisError> {
        let client = self.get_client(session_id)?;
        if left {
            crate::lists::lpush(client, key, values).await
        } else {
            crate::lists::rpush(client, key, values).await
        }
    }

    pub async fn list_pop(
        &mut self,
        session_id: &str,
        key: &str,
        left: bool,
    ) -> Result<Option<String>, RedisError> {
        let client = self.get_client(session_id)?;
        if left {
            crate::lists::lpop(client, key).await
        } else {
            crate::lists::rpop(client, key).await
        }
    }

    pub async fn list_len(
        &mut self,
        session_id: &str,
        key: &str,
    ) -> Result<i64, RedisError> {
        let client = self.get_client(session_id)?;
        crate::lists::llen(client, key).await
    }

    // ── Set operations ──────────────────────────────────────────────

    pub async fn set_members(
        &mut self,
        session_id: &str,
        key: &str,
    ) -> Result<Vec<String>, RedisError> {
        let client = self.get_client(session_id)?;
        crate::sets::smembers(client, key).await
    }

    pub async fn set_add(
        &mut self,
        session_id: &str,
        key: &str,
        members: &[String],
    ) -> Result<u64, RedisError> {
        let client = self.get_client(session_id)?;
        crate::sets::sadd(client, key, members).await
    }

    pub async fn set_remove(
        &mut self,
        session_id: &str,
        key: &str,
        members: &[String],
    ) -> Result<u64, RedisError> {
        let client = self.get_client(session_id)?;
        crate::sets::srem(client, key, members).await
    }

    pub async fn set_card(
        &mut self,
        session_id: &str,
        key: &str,
    ) -> Result<u64, RedisError> {
        let client = self.get_client(session_id)?;
        crate::sets::scard(client, key).await
    }

    // ── Hash operations ─────────────────────────────────────────────

    pub async fn hash_getall(
        &mut self,
        session_id: &str,
        key: &str,
    ) -> Result<HashMap<String, String>, RedisError> {
        let client = self.get_client(session_id)?;
        crate::hashes::hgetall(client, key).await
    }

    pub async fn hash_get(
        &mut self,
        session_id: &str,
        key: &str,
        field: &str,
    ) -> Result<Option<String>, RedisError> {
        let client = self.get_client(session_id)?;
        crate::hashes::hget(client, key, field).await
    }

    pub async fn hash_set(
        &mut self,
        session_id: &str,
        key: &str,
        field: &str,
        value: &str,
    ) -> Result<u64, RedisError> {
        let client = self.get_client(session_id)?;
        crate::hashes::hset(client, key, field, value).await
    }

    pub async fn hash_del(
        &mut self,
        session_id: &str,
        key: &str,
        fields: &[String],
    ) -> Result<u64, RedisError> {
        let client = self.get_client(session_id)?;
        crate::hashes::hdel(client, key, fields).await
    }

    // ── Sorted set operations ───────────────────────────────────────

    pub async fn sorted_set_range(
        &mut self,
        session_id: &str,
        key: &str,
        start: i64,
        stop: i64,
        with_scores: bool,
    ) -> Result<Vec<ZSetMember>, RedisError> {
        let client = self.get_client(session_id)?;
        crate::sorted_sets::zrange(client, key, start, stop, with_scores).await
    }

    pub async fn sorted_set_add(
        &mut self,
        session_id: &str,
        key: &str,
        members: &[(f64, String)],
    ) -> Result<u64, RedisError> {
        let client = self.get_client(session_id)?;
        crate::sorted_sets::zadd(client, key, members).await
    }

    pub async fn sorted_set_rem(
        &mut self,
        session_id: &str,
        key: &str,
        members: &[String],
    ) -> Result<u64, RedisError> {
        let client = self.get_client(session_id)?;
        crate::sorted_sets::zrem(client, key, members).await
    }

    pub async fn sorted_set_card(
        &mut self,
        session_id: &str,
        key: &str,
    ) -> Result<u64, RedisError> {
        let client = self.get_client(session_id)?;
        crate::sorted_sets::zcard(client, key).await
    }

    pub async fn sorted_set_score(
        &mut self,
        session_id: &str,
        key: &str,
        member: &str,
    ) -> Result<Option<f64>, RedisError> {
        let client = self.get_client(session_id)?;
        crate::sorted_sets::zscore(client, key, member).await
    }

    // ── Stream operations ───────────────────────────────────────────

    pub async fn stream_add(
        &mut self,
        session_id: &str,
        key: &str,
        id: &str,
        fields: &[(String, String)],
        maxlen: Option<u64>,
    ) -> Result<String, RedisError> {
        let client = self.get_client(session_id)?;
        crate::streams::xadd(client, key, id, fields, maxlen).await
    }

    pub async fn stream_range(
        &mut self,
        session_id: &str,
        key: &str,
        start: &str,
        end: &str,
        count: Option<u64>,
    ) -> Result<Vec<RedisStreamEntry>, RedisError> {
        let client = self.get_client(session_id)?;
        crate::streams::xrange(client, key, start, end, count).await
    }

    pub async fn stream_len(
        &mut self,
        session_id: &str,
        key: &str,
    ) -> Result<u64, RedisError> {
        let client = self.get_client(session_id)?;
        crate::streams::xlen(client, key).await
    }

    pub async fn stream_info(
        &mut self,
        session_id: &str,
        key: &str,
    ) -> Result<RedisStreamInfo, RedisError> {
        let client = self.get_client(session_id)?;
        crate::streams::xinfo_stream(client, key).await
    }

    pub async fn stream_groups(
        &mut self,
        session_id: &str,
        key: &str,
    ) -> Result<Vec<RedisConsumerGroup>, RedisError> {
        let client = self.get_client(session_id)?;
        crate::streams::xinfo_groups(client, key).await
    }

    // ── Pub/Sub ─────────────────────────────────────────────────────

    pub async fn publish(
        &mut self,
        session_id: &str,
        channel: &str,
        message: &str,
    ) -> Result<u64, RedisError> {
        let client = self.get_client(session_id)?;
        crate::pubsub::publish(client, channel, message).await
    }

    pub async fn pubsub_channels(
        &mut self,
        session_id: &str,
        pattern: Option<&str>,
    ) -> Result<Vec<String>, RedisError> {
        let client = self.get_client(session_id)?;
        crate::pubsub::pubsub_channels(client, pattern).await
    }

    pub async fn pubsub_numsub(
        &mut self,
        session_id: &str,
        channels: &[String],
    ) -> Result<Vec<RedisPubSubChannel>, RedisError> {
        let client = self.get_client(session_id)?;
        crate::pubsub::pubsub_numsub(client, channels).await
    }

    // ── Server admin ────────────────────────────────────────────────

    pub async fn server_info(
        &mut self,
        session_id: &str,
        section: Option<&str>,
    ) -> Result<RedisServerInfo, RedisError> {
        let client = self.get_client(session_id)?;
        crate::server::info(client, section).await
    }

    pub async fn config_get(
        &mut self,
        session_id: &str,
        pattern: &str,
    ) -> Result<Vec<RedisConfigParam>, RedisError> {
        let client = self.get_client(session_id)?;
        crate::server::config_get(client, pattern).await
    }

    pub async fn config_set(
        &mut self,
        session_id: &str,
        param: &str,
        value: &str,
    ) -> Result<(), RedisError> {
        let client = self.get_client(session_id)?;
        crate::server::config_set(client, param, value).await
    }

    pub async fn dbsize(&mut self, session_id: &str) -> Result<i64, RedisError> {
        let client = self.get_client(session_id)?;
        crate::server::dbsize(client).await
    }

    pub async fn flushdb(
        &mut self,
        session_id: &str,
        r#async: bool,
    ) -> Result<(), RedisError> {
        let client = self.get_client(session_id)?;
        crate::server::flushdb(client, r#async).await
    }

    pub async fn slowlog_get(
        &mut self,
        session_id: &str,
        count: Option<i64>,
    ) -> Result<Vec<RedisSlowLogEntry>, RedisError> {
        let client = self.get_client(session_id)?;
        crate::server::slowlog_get(client, count).await
    }

    pub async fn client_list(
        &mut self,
        session_id: &str,
    ) -> Result<Vec<RedisClientInfo>, RedisError> {
        let client = self.get_client(session_id)?;
        crate::server::client_list(client).await
    }

    pub async fn memory_stats(
        &mut self,
        session_id: &str,
    ) -> Result<RedisMemoryStats, RedisError> {
        let client = self.get_client(session_id)?;
        crate::server::memory_stats(client).await
    }

    pub async fn command_stats(
        &mut self,
        session_id: &str,
    ) -> Result<Vec<RedisCommandStats>, RedisError> {
        let client = self.get_client(session_id)?;
        crate::server::command_stats(client).await
    }

    pub async fn keyspace_info(
        &mut self,
        session_id: &str,
    ) -> Result<Vec<RedisKeyspaceInfo>, RedisError> {
        let client = self.get_client(session_id)?;
        crate::server::keyspace_info(client).await
    }

    pub async fn module_list(
        &mut self,
        session_id: &str,
    ) -> Result<Vec<RedisModuleInfo>, RedisError> {
        let client = self.get_client(session_id)?;
        crate::server::module_list(client).await
    }

    // ── Cluster ─────────────────────────────────────────────────────

    pub async fn cluster_info(
        &mut self,
        session_id: &str,
    ) -> Result<RedisClusterInfo, RedisError> {
        let client = self.get_client(session_id)?;
        crate::cluster::cluster_info(client).await
    }

    pub async fn cluster_nodes(
        &mut self,
        session_id: &str,
    ) -> Result<Vec<RedisClusterNode>, RedisError> {
        let client = self.get_client(session_id)?;
        crate::cluster::cluster_nodes(client).await
    }

    pub async fn cluster_myid(
        &mut self,
        session_id: &str,
    ) -> Result<String, RedisError> {
        let client = self.get_client(session_id)?;
        crate::cluster::cluster_myid(client).await
    }

    // ── Sentinel ────────────────────────────────────────────────────

    pub async fn sentinel_masters(
        &mut self,
        session_id: &str,
    ) -> Result<Vec<RedisSentinelMaster>, RedisError> {
        let client = self.get_client(session_id)?;
        crate::sentinel::sentinel_masters(client).await
    }

    pub async fn sentinel_master(
        &mut self,
        session_id: &str,
        name: &str,
    ) -> Result<RedisSentinelMaster, RedisError> {
        let client = self.get_client(session_id)?;
        crate::sentinel::sentinel_master(client, name).await
    }

    pub async fn sentinel_slaves(
        &mut self,
        session_id: &str,
        master_name: &str,
    ) -> Result<Vec<RedisSentinelSlave>, RedisError> {
        let client = self.get_client(session_id)?;
        crate::sentinel::sentinel_slaves(client, master_name).await
    }

    // ── Replication ─────────────────────────────────────────────────

    pub async fn replication_info(
        &mut self,
        session_id: &str,
    ) -> Result<RedisReplicationInfo, RedisError> {
        let client = self.get_client(session_id)?;
        crate::replication::replication_info(client).await
    }
}
