//! Redis client wrapper around the `redis` crate's async connection.

use std::collections::HashMap;

use crate::error::RedisError;
use crate::types::{RedisConnectionConfig, RedisServerInfo};

// ---------------------------------------------------------------------------
// RedisClient
// ---------------------------------------------------------------------------

/// Wraps a `redis::Client` and its `MultiplexedConnection`.
pub struct RedisClient {
    connection: redis::aio::MultiplexedConnection,
    _client: redis::Client,
}

impl RedisClient {
    /// Create a new client from a connection configuration.
    pub async fn new(config: &RedisConnectionConfig) -> Result<Self, RedisError> {
        let url = config.to_url();
        let client = redis::Client::open(url.as_str()).map_err(|e| {
            RedisError::connection_failed(format!("Failed to create client: {}", e))
        })?;

        let connection = client
            .get_multiplexed_async_connection()
            .await
            .map_err(|e| {
                RedisError::connection_failed(format!("Failed to connect: {}", e))
            })?;

        Ok(Self {
            connection,
            _client: client,
        })
    }

    /// Return a mutable reference to the underlying multiplexed connection.
    pub fn con(&mut self) -> &mut redis::aio::MultiplexedConnection {
        &mut self.connection
    }

    /// Execute an arbitrary Redis command and return the raw `redis::Value`.
    pub async fn execute_command(
        &mut self,
        cmd_name: &str,
        args: &[&str],
    ) -> Result<redis::Value, RedisError> {
        let mut cmd = redis::cmd(cmd_name);
        for arg in args {
            cmd.arg(*arg);
        }
        let val: redis::Value = cmd.query_async(&mut self.connection).await?;
        Ok(val)
    }

    /// Fetch and parse the full INFO output into a [`RedisServerInfo`].
    pub async fn get_server_info(&mut self) -> Result<RedisServerInfo, RedisError> {
        let info_str: String = redis::cmd("INFO")
            .query_async(&mut self.connection)
            .await?;
        Ok(build_server_info(&info_str))
    }

    /// Fetch INFO for a single section.
    pub async fn get_server_info_section(
        &mut self,
        section: &str,
    ) -> Result<RedisServerInfo, RedisError> {
        let info_str: String = redis::cmd("INFO")
            .arg(section)
            .query_async(&mut self.connection)
            .await?;
        Ok(build_server_info(&info_str))
    }
}

// ---------------------------------------------------------------------------
// INFO parsing helpers
// ---------------------------------------------------------------------------

/// Parse the full INFO output into section maps.
pub fn parse_info_sections(
    info: &str,
) -> HashMap<String, HashMap<String, String>> {
    let mut sections: HashMap<String, HashMap<String, String>> = HashMap::new();
    let mut current = "default".to_string();

    for line in info.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if line.starts_with('#') {
            current = line.trim_start_matches('#').trim().to_lowercase();
            continue;
        }
        if let Some((key, val)) = line.split_once(':') {
            sections
                .entry(current.clone())
                .or_default()
                .insert(key.to_string(), val.to_string());
        }
    }
    sections
}

/// Extract a single field from raw INFO output.
pub fn parse_info_field(info: &str, field: &str) -> Option<String> {
    for line in info.lines() {
        if let Some(rest) = line.strip_prefix(&format!("{}:", field)) {
            return Some(rest.trim().to_string());
        }
    }
    None
}

/// Build a [`RedisServerInfo`] from raw INFO text.
fn build_server_info(info: &str) -> RedisServerInfo {
    let sections = parse_info_sections(info);

    let field = |section: &str, key: &str| -> Option<String> {
        sections.get(section).and_then(|m| m.get(key).cloned())
    };
    let field_u64 = |section: &str, key: &str| -> Option<u64> {
        field(section, key).and_then(|v| v.parse().ok())
    };
    let field_u16 = |section: &str, key: &str| -> Option<u16> {
        field(section, key).and_then(|v| v.parse().ok())
    };

    RedisServerInfo {
        version: field("server", "redis_version"),
        mode: field("server", "redis_mode"),
        os: field("server", "os"),
        tcp_port: field_u16("server", "tcp_port"),
        uptime_in_seconds: field_u64("server", "uptime_in_seconds"),
        uptime_in_days: field_u64("server", "uptime_in_days"),
        connected_clients: field_u64("clients", "connected_clients"),
        blocked_clients: field_u64("clients", "blocked_clients"),
        used_memory: field_u64("memory", "used_memory"),
        used_memory_human: field("memory", "used_memory_human"),
        used_memory_peak: field_u64("memory", "used_memory_peak"),
        used_memory_peak_human: field("memory", "used_memory_peak_human"),
        total_connections_received: field_u64("stats", "total_connections_received"),
        total_commands_processed: field_u64("stats", "total_commands_processed"),
        instantaneous_ops_per_sec: field_u64("stats", "instantaneous_ops_per_sec"),
        keyspace_hits: field_u64("stats", "keyspace_hits"),
        keyspace_misses: field_u64("stats", "keyspace_misses"),
        role: field("replication", "role"),
        sections,
    }
}

// ---------------------------------------------------------------------------
// Value formatting helpers
// ---------------------------------------------------------------------------

/// Format a `redis::Value` into a human-readable string.
pub fn format_redis_value(val: &redis::Value) -> String {
    match val {
        redis::Value::Nil => "(nil)".to_string(),
        redis::Value::Int(i) => format!("(integer) {}", i),
        redis::Value::BulkString(data) => String::from_utf8_lossy(data).to_string(),
        redis::Value::Array(arr) => {
            let mut out = String::new();
            for (i, v) in arr.iter().enumerate() {
                out.push_str(&format!("{}) {}\n", i + 1, format_redis_value(v)));
            }
            out.trim_end().to_string()
        }
        redis::Value::SimpleString(s) => s.clone(),
        redis::Value::Okay => "OK".to_string(),
        redis::Value::Double(f) => format!("(double) {}", f),
        redis::Value::Boolean(b) => format!("(boolean) {}", b),
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
        other => format!("{:?}", other),
    }
}

/// Extract an i64 from a `redis::Value`.
pub fn redis_value_to_i64(val: &redis::Value) -> i64 {
    match val {
        redis::Value::Int(i) => *i,
        redis::Value::BulkString(data) => {
            String::from_utf8_lossy(data).parse().unwrap_or(0)
        }
        _ => 0,
    }
}

/// Extract an optional String from a `redis::Value`.
pub fn redis_value_to_string(val: &redis::Value) -> Option<String> {
    match val {
        redis::Value::BulkString(data) => Some(String::from_utf8_lossy(data).to_string()),
        redis::Value::SimpleString(s) => Some(s.clone()),
        redis::Value::Int(i) => Some(i.to_string()),
        redis::Value::Nil => None,
        _ => Some(format!("{:?}", val)),
    }
}

/// Extract a Vec<String> from an array `redis::Value`.
pub fn redis_value_to_strings(val: &redis::Value) -> Vec<String> {
    match val {
        redis::Value::Array(arr) => arr
            .iter()
            .filter_map(redis_value_to_string)
            .collect(),
        _ => vec![],
    }
}

/// Parse a `redis::Value::Map` or flat array into a `HashMap`.
pub fn redis_value_to_map(val: &redis::Value) -> HashMap<String, String> {
    let mut map = HashMap::new();
    match val {
        redis::Value::Map(pairs) => {
            for (k, v) in pairs {
                if let (Some(key), Some(value)) = (redis_value_to_string(k), redis_value_to_string(v)) {
                    map.insert(key, value);
                }
            }
        }
        redis::Value::Array(arr) => {
            let mut iter = arr.iter();
            while let Some(k) = iter.next() {
                if let Some(v) = iter.next() {
                    if let (Some(key), Some(value)) = (redis_value_to_string(k), redis_value_to_string(v)) {
                        map.insert(key, value);
                    }
                }
            }
        }
        _ => {}
    }
    map
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_info_basic() {
        let info = "# Server\nredis_version:7.2.0\nos:Linux\n\n# Clients\nconnected_clients:5\n";
        let sections = parse_info_sections(info);
        assert_eq!(
            sections.get("server").and_then(|m| m.get("redis_version")),
            Some(&"7.2.0".to_string())
        );
        assert_eq!(
            sections.get("clients").and_then(|m| m.get("connected_clients")),
            Some(&"5".to_string())
        );
    }

    #[test]
    fn parse_info_field_works() {
        let info = "redis_version:7.2.0\nredis_mode:standalone\n";
        assert_eq!(
            parse_info_field(info, "redis_version"),
            Some("7.2.0".to_string())
        );
        assert_eq!(parse_info_field(info, "missing"), None);
    }
}
