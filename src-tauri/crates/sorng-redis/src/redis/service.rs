//! Redis service providing multi-session connection management,
//! key-value operations, data structure commands, pub/sub, and server admin.

use crate::redis::types::*;
use chrono::Utc;
use log::{error, info, warn};
use redis::AsyncCommands;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;

// ── State ───────────────────────────────────────────────────────────

pub type RedisServiceState = Arc<Mutex<RedisService>>;

pub fn new_state() -> RedisServiceState {
    Arc::new(Mutex::new(RedisService::new()))
}

/// A live Redis session.
struct RedisSession {
    connection: redis::aio::MultiplexedConnection,
    info: SessionInfo,
    _client: redis::Client,
    ssh_child: Option<std::process::Child>,
}

/// Manages multiple named Redis sessions.
pub struct RedisService {
    sessions: HashMap<String, RedisSession>,
}

impl RedisService {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
        }
    }

    // ── Connection lifecycle ────────────────────────────────────────

    /// Connect to a Redis instance, returning the session ID.
    pub async fn connect(&mut self, config: RedisConnectionConfig) -> Result<String, RedisError> {
        let session_id = Uuid::new_v4().to_string();
        let label = config
            .label
            .clone()
            .unwrap_or_else(|| format!("redis-{}", &session_id[..8]));

        // SSH tunnel stub
        let ssh_child = if let Some(ref _ssh) = config.ssh_tunnel {
            warn!("SSH tunnel support for Redis is a stub — connecting directly");
            None
        } else {
            None
        };

        let url = config.to_url();
        let client = redis::Client::open(url.as_str()).map_err(|e| {
            RedisError::connection_failed(format!("Failed to create client: {e}"))
        })?;

        let mut con = client
            .get_multiplexed_async_connection()
            .await
            .map_err(|e| {
                RedisError::connection_failed(format!("Failed to connect: {e}"))
            })?;

        // Verify connectivity
        let pong: String = redis::cmd("PING")
            .query_async(&mut con)
            .await
            .map_err(|e| {
                RedisError::connection_failed(format!("PING failed: {e}"))
            })?;

        if pong != "PONG" {
            return Err(RedisError::connection_failed(format!(
                "Unexpected PING response: {pong}"
            )));
        }

        // Get server info
        let info_str: String = redis::cmd("INFO")
            .arg("server")
            .query_async(&mut con)
            .await
            .unwrap_or_default();

        let server_version = parse_info_field(&info_str, "redis_version");
        let role = parse_info_field(&info_str, "role");

        let session_info = SessionInfo {
            id: session_id.clone(),
            label,
            host: config.host.clone(),
            port: config.port,
            database: config.database.unwrap_or(0),
            status: ConnectionStatus::Connected,
            connected_at: Utc::now().to_rfc3339(),
            server_version,
            role,
        };

        info!(
            "Redis connected: {} ({})",
            session_info.label, session_id
        );

        self.sessions.insert(
            session_id.clone(),
            RedisSession {
                connection: con,
                info: session_info,
                _client: client,
                ssh_child,
            },
        );

        Ok(session_id)
    }

    /// Disconnect a specific session.
    pub async fn disconnect(&mut self, session_id: &str) -> Result<(), RedisError> {
        let mut session = self
            .sessions
            .remove(session_id)
            .ok_or_else(|| RedisError::session_not_found(session_id))?;

        if let Some(ref mut child) = session.ssh_child {
            let _ = child.kill();
        }

        info!("Redis disconnected: {session_id}");
        Ok(())
    }

    /// Disconnect all sessions.
    pub async fn disconnect_all(&mut self) {
        for (id, mut s) in self.sessions.drain() {
            if let Some(ref mut child) = s.ssh_child {
                let _ = child.kill();
            }
            info!("Redis disconnected: {id}");
        }
    }

    /// List active sessions.
    pub fn list_sessions(&self) -> Vec<SessionInfo> {
        self.sessions.values().map(|s| s.info.clone()).collect()
    }

    /// Get a specific session's info.
    pub fn get_session(&self, session_id: &str) -> Result<SessionInfo, RedisError> {
        self.sessions
            .get(session_id)
            .map(|s| s.info.clone())
            .ok_or_else(|| RedisError::session_not_found(session_id))
    }

    /// Ping the server for a session.
    pub async fn ping(&mut self, session_id: &str) -> Result<bool, RedisError> {
        let session = self
            .sessions
            .get_mut(session_id)
            .ok_or_else(|| RedisError::session_not_found(session_id))?;

        match redis::cmd("PING")
            .query_async::<String>(&mut session.connection)
            .await
        {
            Ok(s) if s == "PONG" => Ok(true),
            _ => Ok(false),
        }
    }

    // ── Helpers ─────────────────────────────────────────────────────

    fn get_con(
        &mut self,
        session_id: &str,
    ) -> Result<&mut redis::aio::MultiplexedConnection, RedisError> {
        self.sessions
            .get_mut(session_id)
            .map(|s| &mut s.connection)
            .ok_or_else(|| RedisError::session_not_found(session_id))
    }

    // ── Key operations ──────────────────────────────────────────────

    /// Get the value of a key as a string.
    pub async fn get(&mut self, session_id: &str, key: &str) -> Result<Option<String>, RedisError> {
        let con = self.get_con(session_id)?;
        let val: Option<String> = con.get(key).await.map_err(|e| {
            RedisError::new(RedisErrorKind::CommandError, format!("GET: {e}"))
        })?;
        Ok(val)
    }

    /// Set a key to a string value with optional TTL.
    pub async fn set(
        &mut self,
        session_id: &str,
        key: &str,
        value: &str,
        ttl_secs: Option<u64>,
    ) -> Result<(), RedisError> {
        let con = self.get_con(session_id)?;
        if let Some(ttl) = ttl_secs {
            redis::cmd("SET")
                .arg(key)
                .arg(value)
                .arg("EX")
                .arg(ttl)
                .query_async::<()>(con)
                .await
                .map_err(|e| {
                    RedisError::new(RedisErrorKind::CommandError, format!("SET EX: {e}"))
                })?;
        } else {
            con.set::<_, _, ()>(key, value).await.map_err(|e| {
                RedisError::new(RedisErrorKind::CommandError, format!("SET: {e}"))
            })?;
        }
        Ok(())
    }

    /// Delete one or more keys.
    pub async fn del(&mut self, session_id: &str, keys: &[String]) -> Result<i64, RedisError> {
        let con = self.get_con(session_id)?;
        let count: i64 = con.del(keys).await.map_err(|e| {
            RedisError::new(RedisErrorKind::CommandError, format!("DEL: {e}"))
        })?;
        Ok(count)
    }

    /// Check if a key exists.
    pub async fn exists(&mut self, session_id: &str, key: &str) -> Result<bool, RedisError> {
        let con = self.get_con(session_id)?;
        let exists: bool = con.exists(key).await.map_err(|e| {
            RedisError::new(RedisErrorKind::CommandError, format!("EXISTS: {e}"))
        })?;
        Ok(exists)
    }

    /// Set TTL on a key.
    pub async fn expire(
        &mut self,
        session_id: &str,
        key: &str,
        ttl_secs: i64,
    ) -> Result<bool, RedisError> {
        let con = self.get_con(session_id)?;
        let ok: bool = con.expire(key, ttl_secs).await.map_err(|e| {
            RedisError::new(RedisErrorKind::CommandError, format!("EXPIRE: {e}"))
        })?;
        Ok(ok)
    }

    /// Remove TTL from a key (make it persistent).
    pub async fn persist(&mut self, session_id: &str, key: &str) -> Result<bool, RedisError> {
        let con = self.get_con(session_id)?;
        let ok: bool = con.persist(key).await.map_err(|e| {
            RedisError::new(RedisErrorKind::CommandError, format!("PERSIST: {e}"))
        })?;
        Ok(ok)
    }

    /// Get the TTL of a key in seconds.
    pub async fn ttl(&mut self, session_id: &str, key: &str) -> Result<i64, RedisError> {
        let con = self.get_con(session_id)?;
        let ttl: i64 = con.ttl(key).await.map_err(|e| {
            RedisError::new(RedisErrorKind::CommandError, format!("TTL: {e}"))
        })?;
        Ok(ttl)
    }

    /// Get the type of a key.
    pub async fn key_type(&mut self, session_id: &str, key: &str) -> Result<RedisKeyType, RedisError> {
        let con = self.get_con(session_id)?;
        let t: String = redis::cmd("TYPE")
            .arg(key)
            .query_async(con)
            .await
            .map_err(|e| {
                RedisError::new(RedisErrorKind::CommandError, format!("TYPE: {e}"))
            })?;
        Ok(RedisKeyType::from(t.as_str()))
    }

    /// Rename a key.
    pub async fn rename(
        &mut self,
        session_id: &str,
        key: &str,
        new_key: &str,
    ) -> Result<(), RedisError> {
        let con = self.get_con(session_id)?;
        con.rename::<_, _, ()>(key, new_key).await.map_err(|e| {
            RedisError::new(RedisErrorKind::CommandError, format!("RENAME: {e}"))
        })?;
        Ok(())
    }

    /// Scan keys matching a pattern.
    pub async fn scan(
        &mut self,
        session_id: &str,
        cursor: u64,
        pattern: &str,
        count: Option<u64>,
    ) -> Result<ScanResult, RedisError> {
        let con = self.get_con(session_id)?;
        let count_val = count.unwrap_or(100);

        let (new_cursor, keys): (u64, Vec<String>) = redis::cmd("SCAN")
            .arg(cursor)
            .arg("MATCH")
            .arg(pattern)
            .arg("COUNT")
            .arg(count_val)
            .query_async(con)
            .await
            .map_err(|e| {
                RedisError::new(RedisErrorKind::CommandError, format!("SCAN: {e}"))
            })?;

        Ok(ScanResult {
            cursor: new_cursor,
            keys,
        })
    }

    /// Get detailed info about a key.
    pub async fn key_info(
        &mut self,
        session_id: &str,
        key: &str,
    ) -> Result<KeyInfo, RedisError> {
        let key_type = self.key_type(session_id, key).await?;
        let ttl = self.ttl(session_id, key).await?;

        let con = self.get_con(session_id)?;

        // OBJECT ENCODING
        let encoding: Option<String> = redis::cmd("OBJECT")
            .arg("ENCODING")
            .arg(key)
            .query_async(con)
            .await
            .ok();

        // MEMORY USAGE (Redis 4.0+)
        let size: Option<i64> = redis::cmd("MEMORY")
            .arg("USAGE")
            .arg(key)
            .query_async(con)
            .await
            .ok();

        Ok(KeyInfo {
            key: key.to_string(),
            key_type,
            ttl,
            size,
            encoding,
        })
    }

    /// Get the number of keys in the current database.
    pub async fn dbsize(&mut self, session_id: &str) -> Result<i64, RedisError> {
        let con = self.get_con(session_id)?;
        let size: i64 = redis::cmd("DBSIZE")
            .query_async(con)
            .await
            .map_err(|e| {
                RedisError::new(RedisErrorKind::CommandError, format!("DBSIZE: {e}"))
            })?;
        Ok(size)
    }

    /// Flush the current database.
    pub async fn flushdb(&mut self, session_id: &str) -> Result<(), RedisError> {
        let con = self.get_con(session_id)?;
        redis::cmd("FLUSHDB")
            .query_async::<()>(con)
            .await
            .map_err(|e| {
                RedisError::new(RedisErrorKind::CommandError, format!("FLUSHDB: {e}"))
            })?;
        Ok(())
    }

    // ── Hash operations ─────────────────────────────────────────────

    /// Get all fields and values of a hash.
    pub async fn hgetall(
        &mut self,
        session_id: &str,
        key: &str,
    ) -> Result<HashMap<String, String>, RedisError> {
        let con = self.get_con(session_id)?;
        let map: HashMap<String, String> = con.hgetall(key).await.map_err(|e| {
            RedisError::new(RedisErrorKind::CommandError, format!("HGETALL: {e}"))
        })?;
        Ok(map)
    }

    /// Get a single hash field.
    pub async fn hget(
        &mut self,
        session_id: &str,
        key: &str,
        field: &str,
    ) -> Result<Option<String>, RedisError> {
        let con = self.get_con(session_id)?;
        let val: Option<String> = con.hget(key, field).await.map_err(|e| {
            RedisError::new(RedisErrorKind::CommandError, format!("HGET: {e}"))
        })?;
        Ok(val)
    }

    /// Set a hash field.
    pub async fn hset(
        &mut self,
        session_id: &str,
        key: &str,
        field: &str,
        value: &str,
    ) -> Result<(), RedisError> {
        let con = self.get_con(session_id)?;
        con.hset::<_, _, _, ()>(key, field, value)
            .await
            .map_err(|e| {
                RedisError::new(RedisErrorKind::CommandError, format!("HSET: {e}"))
            })?;
        Ok(())
    }

    /// Delete a hash field.
    pub async fn hdel(
        &mut self,
        session_id: &str,
        key: &str,
        field: &str,
    ) -> Result<bool, RedisError> {
        let con = self.get_con(session_id)?;
        let removed: bool = con.hdel(key, field).await.map_err(|e| {
            RedisError::new(RedisErrorKind::CommandError, format!("HDEL: {e}"))
        })?;
        Ok(removed)
    }

    // ── List operations ─────────────────────────────────────────────

    /// Get a range of list elements.
    pub async fn lrange(
        &mut self,
        session_id: &str,
        key: &str,
        start: i64,
        stop: i64,
    ) -> Result<Vec<String>, RedisError> {
        let con = self.get_con(session_id)?;
        let vals: Vec<String> = con.lrange(key, start as isize, stop as isize).await.map_err(|e| {
            RedisError::new(RedisErrorKind::CommandError, format!("LRANGE: {e}"))
        })?;
        Ok(vals)
    }

    /// Push a value to the left of a list.
    pub async fn lpush(
        &mut self,
        session_id: &str,
        key: &str,
        value: &str,
    ) -> Result<i64, RedisError> {
        let con = self.get_con(session_id)?;
        let len: i64 = con.lpush(key, value).await.map_err(|e| {
            RedisError::new(RedisErrorKind::CommandError, format!("LPUSH: {e}"))
        })?;
        Ok(len)
    }

    /// Push a value to the right of a list.
    pub async fn rpush(
        &mut self,
        session_id: &str,
        key: &str,
        value: &str,
    ) -> Result<i64, RedisError> {
        let con = self.get_con(session_id)?;
        let len: i64 = con.rpush(key, value).await.map_err(|e| {
            RedisError::new(RedisErrorKind::CommandError, format!("RPUSH: {e}"))
        })?;
        Ok(len)
    }

    /// Get list length.
    pub async fn llen(&mut self, session_id: &str, key: &str) -> Result<i64, RedisError> {
        let con = self.get_con(session_id)?;
        let len: i64 = con.llen(key).await.map_err(|e| {
            RedisError::new(RedisErrorKind::CommandError, format!("LLEN: {e}"))
        })?;
        Ok(len)
    }

    // ── Set operations ──────────────────────────────────────────────

    /// Get all members of a set.
    pub async fn smembers(
        &mut self,
        session_id: &str,
        key: &str,
    ) -> Result<Vec<String>, RedisError> {
        let con = self.get_con(session_id)?;
        let members: Vec<String> = con.smembers(key).await.map_err(|e| {
            RedisError::new(RedisErrorKind::CommandError, format!("SMEMBERS: {e}"))
        })?;
        Ok(members)
    }

    /// Add a member to a set.
    pub async fn sadd(
        &mut self,
        session_id: &str,
        key: &str,
        member: &str,
    ) -> Result<bool, RedisError> {
        let con = self.get_con(session_id)?;
        let added: bool = con.sadd(key, member).await.map_err(|e| {
            RedisError::new(RedisErrorKind::CommandError, format!("SADD: {e}"))
        })?;
        Ok(added)
    }

    /// Remove a member from a set.
    pub async fn srem(
        &mut self,
        session_id: &str,
        key: &str,
        member: &str,
    ) -> Result<bool, RedisError> {
        let con = self.get_con(session_id)?;
        let removed: bool = con.srem(key, member).await.map_err(|e| {
            RedisError::new(RedisErrorKind::CommandError, format!("SREM: {e}"))
        })?;
        Ok(removed)
    }

    /// Get set size.
    pub async fn scard(&mut self, session_id: &str, key: &str) -> Result<i64, RedisError> {
        let con = self.get_con(session_id)?;
        let size: i64 = con.scard(key).await.map_err(|e| {
            RedisError::new(RedisErrorKind::CommandError, format!("SCARD: {e}"))
        })?;
        Ok(size)
    }

    // ── Sorted set operations ───────────────────────────────────────

    /// Get members of a sorted set by rank range with scores.
    pub async fn zrange_with_scores(
        &mut self,
        session_id: &str,
        key: &str,
        start: i64,
        stop: i64,
    ) -> Result<Vec<ZSetMember>, RedisError> {
        let con = self.get_con(session_id)?;
        let pairs: Vec<(String, f64)> =
            con.zrange_withscores(key, start as isize, stop as isize).await.map_err(|e| {
                RedisError::new(RedisErrorKind::CommandError, format!("ZRANGE: {e}"))
            })?;
        Ok(pairs
            .into_iter()
            .map(|(member, score)| ZSetMember { member, score })
            .collect())
    }

    /// Add a member to a sorted set.
    pub async fn zadd(
        &mut self,
        session_id: &str,
        key: &str,
        member: &str,
        score: f64,
    ) -> Result<bool, RedisError> {
        let con = self.get_con(session_id)?;
        let added: bool = con.zadd(key, member, score).await.map_err(|e| {
            RedisError::new(RedisErrorKind::CommandError, format!("ZADD: {e}"))
        })?;
        Ok(added)
    }

    /// Remove a member from a sorted set.
    pub async fn zrem(
        &mut self,
        session_id: &str,
        key: &str,
        member: &str,
    ) -> Result<bool, RedisError> {
        let con = self.get_con(session_id)?;
        let removed: bool = con.zrem(key, member).await.map_err(|e| {
            RedisError::new(RedisErrorKind::CommandError, format!("ZREM: {e}"))
        })?;
        Ok(removed)
    }

    /// Get sorted set size.
    pub async fn zcard(&mut self, session_id: &str, key: &str) -> Result<i64, RedisError> {
        let con = self.get_con(session_id)?;
        let size: i64 = con.zcard(key).await.map_err(|e| {
            RedisError::new(RedisErrorKind::CommandError, format!("ZCARD: {e}"))
        })?;
        Ok(size)
    }

    // ── Server admin ────────────────────────────────────────────────

    /// Get server INFO (optionally a specific section).
    pub async fn server_info(
        &mut self,
        session_id: &str,
        section: Option<&str>,
    ) -> Result<ServerInfo, RedisError> {
        let con = self.get_con(session_id)?;
        let info_str: String = if let Some(sec) = section {
            redis::cmd("INFO")
                .arg(sec)
                .query_async(con)
                .await
                .map_err(|e| {
                    RedisError::new(RedisErrorKind::CommandError, format!("INFO: {e}"))
                })?
        } else {
            redis::cmd("INFO")
                .query_async(con)
                .await
                .map_err(|e| {
                    RedisError::new(RedisErrorKind::CommandError, format!("INFO: {e}"))
                })?
        };

        Ok(parse_info(&info_str))
    }

    /// Get memory usage information.
    pub async fn memory_info(&mut self, session_id: &str) -> Result<MemoryInfo, RedisError> {
        let info = self.server_info(session_id, Some("memory")).await?;
        let mem = info
            .sections
            .get("memory")
            .or_else(|| info.sections.values().next())
            .cloned()
            .unwrap_or_default();

        Ok(MemoryInfo {
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
        })
    }

    /// List connected clients.
    pub async fn client_list(&mut self, session_id: &str) -> Result<Vec<ClientInfo>, RedisError> {
        let con = self.get_con(session_id)?;
        let raw: String = redis::cmd("CLIENT")
            .arg("LIST")
            .query_async(con)
            .await
            .map_err(|e| {
                RedisError::new(RedisErrorKind::CommandError, format!("CLIENT LIST: {e}"))
            })?;

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
            clients.push(ClientInfo {
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

    /// Kill a client by ID.
    pub async fn client_kill(
        &mut self,
        session_id: &str,
        client_id: &str,
    ) -> Result<(), RedisError> {
        let con = self.get_con(session_id)?;
        redis::cmd("CLIENT")
            .arg("KILL")
            .arg("ID")
            .arg(client_id)
            .query_async::<()>(con)
            .await
            .map_err(|e| {
                RedisError::new(RedisErrorKind::CommandError, format!("CLIENT KILL: {e}"))
            })?;
        Ok(())
    }

    /// Get slow log entries.
    pub async fn slowlog_get(
        &mut self,
        session_id: &str,
        count: Option<i64>,
    ) -> Result<Vec<SlowLogEntry>, RedisError> {
        let con = self.get_con(session_id)?;
        let c = count.unwrap_or(10);

        // SLOWLOG GET returns nested arrays
        let raw: Vec<Vec<redis::Value>> = redis::cmd("SLOWLOG")
            .arg("GET")
            .arg(c)
            .query_async(con)
            .await
            .map_err(|e| {
                RedisError::new(RedisErrorKind::CommandError, format!("SLOWLOG GET: {e}"))
            })?;

        let mut entries = Vec::new();
        for entry in raw {
            if entry.len() >= 4 {
                let id = redis_value_to_i64(&entry[0]);
                let timestamp = redis_value_to_i64(&entry[1]);
                let duration_us = redis_value_to_i64(&entry[2]);
                let command = redis_value_to_strings(&entry[3]);
                let client_addr = entry.get(4).and_then(|v| redis_value_to_string(v));
                let client_name = entry.get(5).and_then(|v| redis_value_to_string(v));

                entries.push(SlowLogEntry {
                    id,
                    timestamp,
                    duration_us,
                    command,
                    client_addr,
                    client_name,
                });
            }
        }
        Ok(entries)
    }

    /// Get server config value.
    pub async fn config_get(
        &mut self,
        session_id: &str,
        pattern: &str,
    ) -> Result<HashMap<String, String>, RedisError> {
        let con = self.get_con(session_id)?;
        let pairs: Vec<String> = redis::cmd("CONFIG")
            .arg("GET")
            .arg(pattern)
            .query_async(con)
            .await
            .map_err(|e| {
                RedisError::new(RedisErrorKind::CommandError, format!("CONFIG GET: {e}"))
            })?;

        let mut map = HashMap::new();
        let mut iter = pairs.into_iter();
        while let Some(key) = iter.next() {
            if let Some(val) = iter.next() {
                map.insert(key, val);
            }
        }
        Ok(map)
    }

    /// Set a server config value.
    pub async fn config_set(
        &mut self,
        session_id: &str,
        param: &str,
        value: &str,
    ) -> Result<(), RedisError> {
        let con = self.get_con(session_id)?;
        redis::cmd("CONFIG")
            .arg("SET")
            .arg(param)
            .arg(value)
            .query_async::<()>(con)
            .await
            .map_err(|e| {
                RedisError::new(RedisErrorKind::CommandError, format!("CONFIG SET: {e}"))
            })?;
        Ok(())
    }

    /// Execute a raw Redis command.
    pub async fn raw_command(
        &mut self,
        session_id: &str,
        args: &[String],
    ) -> Result<String, RedisError> {
        if args.is_empty() {
            return Err(RedisError::new(
                RedisErrorKind::InvalidConfig,
                "Empty command",
            ));
        }

        let con = self.get_con(session_id)?;
        let mut cmd = redis::cmd(&args[0]);
        for arg in &args[1..] {
            cmd.arg(arg);
        }

        let val: redis::Value = cmd.query_async(con).await.map_err(|e| {
            RedisError::new(RedisErrorKind::CommandError, format!("raw: {e}"))
        })?;

        Ok(format_redis_value(&val))
    }

    /// Select a database index.
    pub async fn select_db(
        &mut self,
        session_id: &str,
        db: u8,
    ) -> Result<(), RedisError> {
        let con = self.get_con(session_id)?;
        redis::cmd("SELECT")
            .arg(db)
            .query_async::<()>(con)
            .await
            .map_err(|e| {
                RedisError::new(RedisErrorKind::CommandError, format!("SELECT: {e}"))
            })?;

        // Update session info
        if let Some(session) = self.sessions.get_mut(session_id) {
            session.info.database = db;
        }
        Ok(())
    }
}

// ── Helper functions ────────────────────────────────────────────────

/// Parse a single field from Redis INFO output.
fn parse_info_field(info: &str, field: &str) -> Option<String> {
    for line in info.lines() {
        if let Some(rest) = line.strip_prefix(&format!("{field}:")) {
            return Some(rest.trim().to_string());
        }
    }
    None
}

/// Parse full INFO output into sections.
fn parse_info(info: &str) -> ServerInfo {
    let mut sections = HashMap::new();
    let mut current_section = String::from("default");

    for line in info.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if line.starts_with('#') {
            current_section = line
                .trim_start_matches('#')
                .trim()
                .to_lowercase();
            continue;
        }
        if let Some((key, val)) = line.split_once(':') {
            sections
                .entry(current_section.clone())
                .or_insert_with(HashMap::new)
                .insert(key.to_string(), val.to_string());
        }
    }

    ServerInfo { sections }
}

/// Format a Redis Value for display.
fn format_redis_value(val: &redis::Value) -> String {
    match val {
        redis::Value::Nil => "(nil)".to_string(),
        redis::Value::Int(i) => format!("(integer) {i}"),
        redis::Value::BulkString(data) => {
            String::from_utf8_lossy(data).to_string()
        }
        redis::Value::Array(arr) => {
            let mut out = String::new();
            for (i, v) in arr.iter().enumerate() {
                out.push_str(&format!("{}) {}\n", i + 1, format_redis_value(v)));
            }
            out.trim_end().to_string()
        }
        redis::Value::SimpleString(s) => s.clone(),
        redis::Value::Okay => "OK".to_string(),
        redis::Value::Double(f) => format!("(double) {f}"),
        redis::Value::Boolean(b) => format!("(boolean) {b}"),
        redis::Value::Map(m) => {
            let mut out = String::new();
            for (i, (k, v)) in m.iter().enumerate() {
                out.push_str(&format!(
                    "{}) {} -> {}\n",
                    i + 1,
                    format_redis_value(k),
                    format_redis_value(v)
                ));
            }
            out.trim_end().to_string()
        }
        other => format!("{other:?}"),
    }
}

fn redis_value_to_i64(val: &redis::Value) -> i64 {
    match val {
        redis::Value::Int(i) => *i,
        redis::Value::BulkString(data) => {
            String::from_utf8_lossy(data)
                .parse()
                .unwrap_or(0)
        }
        _ => 0,
    }
}

fn redis_value_to_string(val: &redis::Value) -> Option<String> {
    match val {
        redis::Value::BulkString(data) => Some(String::from_utf8_lossy(data).to_string()),
        redis::Value::SimpleString(s) => Some(s.clone()),
        redis::Value::Int(i) => Some(i.to_string()),
        redis::Value::Nil => None,
        _ => Some(format!("{val:?}")),
    }
}

fn redis_value_to_strings(val: &redis::Value) -> Vec<String> {
    match val {
        redis::Value::Array(arr) => arr
            .iter()
            .filter_map(|v| redis_value_to_string(v))
            .collect(),
        _ => vec![],
    }
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_service() {
        let svc = RedisService::new();
        assert!(svc.list_sessions().is_empty());
    }

    #[test]
    fn test_session_not_found() {
        let svc = RedisService::new();
        let result = svc.get_session("nonexistent");
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_info_field() {
        let info = "redis_version:7.2.0\nredis_mode:standalone\nrole:master\n";
        assert_eq!(
            parse_info_field(info, "redis_version"),
            Some("7.2.0".to_string())
        );
        assert_eq!(
            parse_info_field(info, "role"),
            Some("master".to_string())
        );
        assert_eq!(parse_info_field(info, "missing"), None);
    }

    #[test]
    fn test_parse_info_sections() {
        let info = "# Server\nredis_version:7.2.0\nredis_mode:standalone\n\n# Clients\nconnected_clients:5\n";
        let parsed = parse_info(info);
        assert!(parsed.sections.contains_key("server"));
        assert!(parsed.sections.contains_key("clients"));
        assert_eq!(
            parsed.sections["server"]["redis_version"],
            "7.2.0"
        );
        assert_eq!(
            parsed.sections["clients"]["connected_clients"],
            "5"
        );
    }

    #[test]
    fn test_format_redis_value_nil() {
        assert_eq!(format_redis_value(&redis::Value::Nil), "(nil)");
    }

    #[test]
    fn test_format_redis_value_int() {
        assert_eq!(
            format_redis_value(&redis::Value::Int(42)),
            "(integer) 42"
        );
    }

    #[test]
    fn test_format_redis_value_ok() {
        assert_eq!(format_redis_value(&redis::Value::Okay), "OK");
    }

    #[test]
    fn test_format_redis_value_bulk() {
        let val = redis::Value::BulkString(b"hello".to_vec());
        assert_eq!(format_redis_value(&val), "hello");
    }

    #[test]
    fn test_format_redis_value_array() {
        let val = redis::Value::Array(vec![
            redis::Value::BulkString(b"a".to_vec()),
            redis::Value::BulkString(b"b".to_vec()),
        ]);
        let formatted = format_redis_value(&val);
        assert!(formatted.contains("1) a"));
        assert!(formatted.contains("2) b"));
    }

    #[test]
    fn test_redis_value_to_i64() {
        assert_eq!(redis_value_to_i64(&redis::Value::Int(99)), 99);
        assert_eq!(
            redis_value_to_i64(&redis::Value::BulkString(b"42".to_vec())),
            42
        );
        assert_eq!(redis_value_to_i64(&redis::Value::Nil), 0);
    }

    #[test]
    fn test_redis_value_to_string() {
        assert_eq!(
            redis_value_to_string(&redis::Value::BulkString(b"test".to_vec())),
            Some("test".to_string())
        );
        assert_eq!(redis_value_to_string(&redis::Value::Nil), None);
        assert_eq!(
            redis_value_to_string(&redis::Value::Int(5)),
            Some("5".to_string())
        );
    }

    #[test]
    fn test_redis_value_to_strings() {
        let val = redis::Value::Array(vec![
            redis::Value::BulkString(b"GET".to_vec()),
            redis::Value::BulkString(b"key".to_vec()),
        ]);
        let strs = redis_value_to_strings(&val);
        assert_eq!(strs, vec!["GET", "key"]);
    }

    #[tokio::test]
    async fn test_disconnect_nonexistent() {
        let mut svc = RedisService::new();
        let result = svc.disconnect("no-such").await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_ping_nonexistent() {
        let mut svc = RedisService::new();
        let result = svc.ping("no-such").await;
        assert!(result.is_err());
    }
}
