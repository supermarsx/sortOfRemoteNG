// ── sorng-mysql-admin – InnoDB management ────────────────────────────────────

use crate::client::MysqlAdminClient;
use crate::error::MysqlAdminResult;
use crate::types::*;

pub struct InnodbManager;

impl InnodbManager {
    pub async fn get_status(client: &MysqlAdminClient) -> MysqlAdminResult<InnodbStatus> {
        let bp_size = Self::status_val(client, "Innodb_buffer_pool_pages_total").await
            .and_then(|s| s.parse::<u64>().ok());
        let bp_data = Self::status_val(client, "Innodb_buffer_pool_pages_data").await
            .and_then(|s| s.parse::<u64>().ok());
        let bp_dirty = Self::status_val(client, "Innodb_buffer_pool_pages_dirty").await
            .and_then(|s| s.parse::<u64>().ok());
        let bp_free = Self::status_val(client, "Innodb_buffer_pool_pages_free").await
            .and_then(|s| s.parse::<u64>().ok());
        let bp_read_req = Self::status_val(client, "Innodb_buffer_pool_read_requests").await
            .and_then(|s| s.parse::<u64>().ok());
        let bp_reads = Self::status_val(client, "Innodb_buffer_pool_reads").await
            .and_then(|s| s.parse::<u64>().ok());
        let pool_bytes = client.exec_mysql("SELECT @@innodb_buffer_pool_size").await
            .ok().and_then(|s| s.trim().parse::<u64>().ok());

        let raw = client.exec_mysql("SHOW ENGINE INNODB STATUS").await.unwrap_or_default();
        let deadlocks = Self::status_val(client, "Innodb_deadlocks").await
            .and_then(|s| s.parse::<u64>().ok());
        let hll = extract_value(&raw, "History list length").and_then(|s| {
            s.split_whitespace().last().and_then(|v| v.parse::<u64>().ok())
        });
        let active_trx = client.exec_mysql(
            "SELECT COUNT(*) FROM information_schema.INNODB_TRX"
        ).await.ok().and_then(|s| s.trim().parse::<u64>().ok());

        Ok(InnodbStatus {
            buffer_pool_size: pool_bytes,
            buffer_pool_pages_total: bp_size,
            buffer_pool_pages_data: bp_data,
            buffer_pool_pages_dirty: bp_dirty,
            buffer_pool_pages_free: bp_free,
            buffer_pool_read_requests: bp_read_req,
            buffer_pool_reads: bp_reads,
            row_operations: extract_value(&raw, "row operations"),
            log_sequence_number: extract_value(&raw, "Log sequence number"),
            log_flushed_up_to: extract_value(&raw, "Log flushed up to"),
            pending_io: extract_value(&raw, "Pending normal aio"),
            deadlock_count: deadlocks,
            history_list_length: hll,
            transactions_active: active_trx,
        })
    }

    pub async fn get_buffer_pool_stats(client: &MysqlAdminClient) -> MysqlAdminResult<InnodbBufferPoolStats> {
        let v = |key: &str| async move {
            Self::status_val(client, key).await.and_then(|s| s.parse::<u64>().ok())
        };
        let total = v("Innodb_buffer_pool_pages_total").await;
        let free = v("Innodb_buffer_pool_pages_free").await;
        let data = v("Innodb_buffer_pool_pages_data").await;
        let dirty = v("Innodb_buffer_pool_pages_dirty").await;
        let read_req = v("Innodb_buffer_pool_read_requests").await;
        let reads = v("Innodb_buffer_pool_reads").await;
        let hit_rate = match (read_req, reads) {
            (Some(req), Some(r)) if req > 0 => Some(1.0 - (r as f64 / req as f64)),
            _ => None,
        };
        Ok(InnodbBufferPoolStats {
            pool_id: Some(0),
            pool_size: total,
            free_buffers: free,
            database_pages: data,
            old_database_pages: v("Innodb_buffer_pool_pages_old").await,
            modified_database_pages: dirty,
            pending_decompress: None,
            pending_reads: v("Innodb_buffer_pool_read_ahead_rnd").await,
            pending_flush_lru: v("Innodb_buffer_pool_pages_flushed").await,
            pending_flush_list: None,
            pages_made_young: v("Innodb_buffer_pool_pages_made_young").await,
            pages_not_made_young: v("Innodb_buffer_pool_pages_made_not_young").await,
            pages_read: v("Innodb_pages_read").await,
            pages_created: v("Innodb_pages_created").await,
            pages_written: v("Innodb_pages_written").await,
            hit_rate,
        })
    }

    pub async fn list_locks(client: &MysqlAdminClient) -> MysqlAdminResult<Vec<InnodbLock>> {
        let out = client.exec_mysql(
            "SELECT LOCK_ID, LOCK_TRX_ID, LOCK_MODE, LOCK_TYPE, LOCK_TABLE, LOCK_INDEX, LOCK_DATA \
             FROM information_schema.INNODB_LOCKS"
        ).await?;
        let locks = out.lines()
            .filter(|l| !l.is_empty())
            .map(|l| {
                let c: Vec<&str> = l.split('\t').collect();
                InnodbLock {
                    lock_id: c.first().map(|s| s.to_string()).unwrap_or_default(),
                    lock_trx_id: c.get(1).map(|s| s.to_string()).unwrap_or_default(),
                    lock_mode: c.get(2).map(|s| s.to_string()).unwrap_or_default(),
                    lock_type: c.get(3).map(|s| s.to_string()).unwrap_or_default(),
                    lock_table: c.get(4).map(|s| s.to_string()).unwrap_or_default(),
                    lock_index: c.get(5).filter(|s| *s != "NULL").map(|s| s.to_string()),
                    lock_data: c.get(6).filter(|s| *s != "NULL").map(|s| s.to_string()),
                }
            })
            .collect();
        Ok(locks)
    }

    pub async fn list_transactions(client: &MysqlAdminClient) -> MysqlAdminResult<Vec<InnodbTransaction>> {
        let out = client.exec_mysql(
            "SELECT TRX_ID, TRX_STATE, TRX_STARTED, TRX_QUERY, TRX_ROWS_LOCKED, \
             TRX_ROWS_MODIFIED, TRX_LOCK_WAIT_STARTED \
             FROM information_schema.INNODB_TRX"
        ).await?;
        let trxs = out.lines()
            .filter(|l| !l.is_empty())
            .map(|l| {
                let c: Vec<&str> = l.split('\t').collect();
                InnodbTransaction {
                    trx_id: c.first().map(|s| s.to_string()).unwrap_or_default(),
                    trx_state: c.get(1).map(|s| s.to_string()).unwrap_or_default(),
                    trx_started: c.get(2).filter(|s| *s != "NULL").map(|s| s.to_string()),
                    trx_query: c.get(3).filter(|s| *s != "NULL").map(|s| s.to_string()),
                    trx_rows_locked: c.get(4).and_then(|s| s.parse().ok()),
                    trx_rows_modified: c.get(5).and_then(|s| s.parse().ok()),
                    trx_lock_wait_started: c.get(6).filter(|s| *s != "NULL").map(|s| s.to_string()),
                }
            })
            .collect();
        Ok(trxs)
    }

    pub async fn kill_transaction(client: &MysqlAdminClient, trx_id: &str) -> MysqlAdminResult<()> {
        let out = client.exec_mysql(&format!(
            "SELECT TRX_MYSQL_THREAD_ID FROM information_schema.INNODB_TRX WHERE TRX_ID='{}'", trx_id
        )).await?;
        let thread_id = out.trim();
        if thread_id.is_empty() {
            return Err(crate::error::MysqlAdminError::internal(format!(
                "Transaction '{}' not found or already completed", trx_id
            )));
        }
        client.exec_mysql(&format!("KILL {}", thread_id)).await?;
        Ok(())
    }

    pub async fn get_deadlock_info(client: &MysqlAdminClient) -> MysqlAdminResult<String> {
        let out = client.exec_mysql("SHOW ENGINE INNODB STATUS").await?;
        let in_deadlock = out.lines()
            .skip_while(|l| !l.contains("LATEST DETECTED DEADLOCK"))
            .take_while(|l| !l.contains("TRANSACTIONS"))
            .collect::<Vec<&str>>()
            .join("\n");
        if in_deadlock.is_empty() {
            Ok("No deadlocks detected.".to_string())
        } else {
            Ok(in_deadlock)
        }
    }

    pub async fn get_tablespace_info(client: &MysqlAdminClient) -> MysqlAdminResult<String> {
        client.exec_mysql(
            "SELECT SPACE, NAME, FILE_SIZE, ALLOCATED_SIZE, STATE \
             FROM information_schema.INNODB_TABLESPACES LIMIT 100"
        ).await
    }

    pub async fn get_redo_log_status(client: &MysqlAdminClient) -> MysqlAdminResult<String> {
        let lsn = client.exec_mysql(
            "SELECT VARIABLE_VALUE FROM performance_schema.global_status WHERE VARIABLE_NAME='Innodb_os_log_written'"
        ).await.unwrap_or_default();
        let pending = client.exec_mysql(
            "SELECT VARIABLE_VALUE FROM performance_schema.global_status WHERE VARIABLE_NAME='Innodb_os_log_pending_writes'"
        ).await.unwrap_or_default();
        let fsyncs = client.exec_mysql(
            "SELECT VARIABLE_VALUE FROM performance_schema.global_status WHERE VARIABLE_NAME='Innodb_os_log_fsyncs'"
        ).await.unwrap_or_default();
        Ok(format!(
            "log_written={} pending_writes={} fsyncs={}",
            lsn.trim(), pending.trim(), fsyncs.trim()
        ))
    }

    pub async fn get_adaptive_hash_index_stats(client: &MysqlAdminClient) -> MysqlAdminResult<String> {
        let enabled = client.exec_mysql("SELECT @@innodb_adaptive_hash_index").await.unwrap_or_default();
        let parts = client.exec_mysql("SELECT @@innodb_adaptive_hash_index_parts").await.unwrap_or_default();
        let searches = client.exec_mysql(
            "SELECT VARIABLE_VALUE FROM performance_schema.global_status WHERE VARIABLE_NAME='Innodb_adaptive_hash_searches'"
        ).await.unwrap_or_default();
        let non_hash = client.exec_mysql(
            "SELECT VARIABLE_VALUE FROM performance_schema.global_status WHERE VARIABLE_NAME='Innodb_adaptive_hash_searches_btree'"
        ).await.unwrap_or_default();
        Ok(format!(
            "enabled={} parts={} hash_searches={} btree_searches={}",
            enabled.trim(), parts.trim(), searches.trim(), non_hash.trim()
        ))
    }

    async fn status_val(client: &MysqlAdminClient, key: &str) -> Option<String> {
        client.exec_mysql(&format!(
            "SELECT VARIABLE_VALUE FROM performance_schema.global_status WHERE VARIABLE_NAME='{}'", key
        )).await.ok().map(|s| s.trim().to_string())
    }
}

fn extract_value(text: &str, key: &str) -> Option<String> {
    text.lines()
        .find(|l| l.contains(key))
        .map(|l| l.trim().to_string())
}
