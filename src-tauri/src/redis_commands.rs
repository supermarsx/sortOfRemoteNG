#[cfg(feature = "db-redis")]
mod service {
    pub use crate::redis::service::RedisServiceState;
}

#[cfg(feature = "db-redis")]
mod types {
    pub use crate::redis::types::*;
}

#[cfg(feature = "db-redis")]
mod generated {
    include!("../crates/sorng-redis/src/redis/commands.rs");
}

#[cfg(feature = "db-redis")]
pub use generated::*;

#[cfg(not(feature = "db-redis"))]
mod disabled {
    macro_rules! disabled_commands {
        ($($name:ident),* $(,)?) => {
            $(
                #[tauri::command]
                pub async fn $name() -> Result<(), String> {
                    Err("Redis support is not enabled in this build".into())
                }
            )*
        };
    }

    disabled_commands!(
        redis_connect,
        redis_disconnect,
        redis_disconnect_all,
        redis_list_sessions,
        redis_get_session,
        redis_ping,
        redis_get,
        redis_set,
        redis_del,
        redis_exists,
        redis_expire,
        redis_persist,
        redis_ttl,
        redis_key_type,
        redis_rename,
        redis_scan,
        redis_key_info,
        redis_dbsize,
        redis_flushdb,
        redis_hgetall,
        redis_hget,
        redis_hset,
        redis_hdel,
        redis_lrange,
        redis_lpush,
        redis_rpush,
        redis_llen,
        redis_smembers,
        redis_sadd,
        redis_srem,
        redis_scard,
        redis_zrange_with_scores,
        redis_zadd,
        redis_zrem,
        redis_zcard,
        redis_server_info,
        redis_memory_info,
        redis_client_list,
        redis_client_kill,
        redis_slowlog_get,
        redis_config_get,
        redis_config_set,
        redis_raw_command,
        redis_select_db
    );
}

#[cfg(not(feature = "db-redis"))]
pub use disabled::*;
