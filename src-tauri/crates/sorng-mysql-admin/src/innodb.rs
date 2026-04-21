// ── sorng-mysql-admin – InnoDB management ────────────────────────────────────
//! InnoDB engine status, buffer pool stats, and lock analysis via SSH.

use crate::client::MysqlClient;
use crate::error::MysqlResult;
use crate::types::*;

pub struct InnodbManager;

impl InnodbManager {
    /// Get InnoDB status metrics from global status variables.
    pub async fn get_status(client: &MysqlClient) -> MysqlResult<InnodbStatus> {
        let sql = "SELECT VARIABLE_NAME, VARIABLE_VALUE \
                   FROM information_schema.GLOBAL_STATUS \
                   WHERE VARIABLE_NAME LIKE 'Innodb_%'";
        let out = client.exec_sql(sql).await?;
        let mut status = InnodbStatus {
            buffer_pool_size: 0,
            buffer_pool_free: 0,
            buffer_pool_dirty: 0,
            buffer_pool_hit_rate: 0.0,
            log_sequence_number: 0,
            log_flushed_up_to: 0,
            pages_created: 0,
            pages_read: 0,
            pages_written: 0,
            rows_inserted: 0,
            rows_updated: 0,
            rows_deleted: 0,
            rows_read: 0,
            deadlocks: 0,
            pending_io_reads: 0,
            pending_io_writes: 0,
        };
        for line in out.lines() {
            let cols: Vec<&str> = line.split('\t').collect();
            if cols.len() < 2 {
                continue;
            }
            let val: u64 = cols[1].parse().unwrap_or(0);
            match cols[0] {
                "Innodb_buffer_pool_pages_total" => status.buffer_pool_size = val,
                "Innodb_buffer_pool_pages_free" => status.buffer_pool_free = val,
                "Innodb_buffer_pool_pages_dirty" => status.buffer_pool_dirty = val,
                "Innodb_os_log_written" => status.log_sequence_number = val,
                "Innodb_os_log_fsyncs" => status.log_flushed_up_to = val,
                "Innodb_pages_created" => status.pages_created = val,
                "Innodb_pages_read" => status.pages_read = val,
                "Innodb_pages_written" => status.pages_written = val,
                "Innodb_rows_inserted" => status.rows_inserted = val,
                "Innodb_rows_updated" => status.rows_updated = val,
                "Innodb_rows_deleted" => status.rows_deleted = val,
                "Innodb_rows_read" => status.rows_read = val,
                "Innodb_data_pending_reads" => status.pending_io_reads = val,
                "Innodb_data_pending_writes" => status.pending_io_writes = val,
                _ => {}
            }
        }
        // Compute hit rate from read requests and reads
        let read_requests_sql = "SELECT VARIABLE_VALUE FROM information_schema.GLOBAL_STATUS \
                                  WHERE VARIABLE_NAME = 'Innodb_buffer_pool_read_requests'";
        let rr_out = client.exec_sql(read_requests_sql).await.unwrap_or_default();
        let read_requests: f64 = rr_out.trim().parse().unwrap_or(0.0);
        let disk_reads = status.pages_read as f64;
        if read_requests > 0.0 {
            status.buffer_pool_hit_rate = ((read_requests - disk_reads) / read_requests) * 100.0;
        }

        Ok(status)
    }

    /// Get InnoDB buffer pool statistics (alias for get_status for convenience).
    pub async fn get_buffer_pool_stats(client: &MysqlClient) -> MysqlResult<InnodbStatus> {
        Self::get_status(client).await
    }

    /// Get raw SHOW ENGINE INNODB STATUS output.
    pub async fn get_engine_status(client: &MysqlClient) -> MysqlResult<String> {
        let out = client.exec_sql("SHOW ENGINE INNODB STATUS\\G").await?;
        Ok(out)
    }

    /// List current InnoDB locks (from performance_schema or information_schema).
    pub async fn list_locks(client: &MysqlClient) -> MysqlResult<String> {
        let sql = "SELECT * FROM performance_schema.data_locks ORDER BY ENGINE_TRANSACTION_ID";
        client.exec_sql(sql).await
    }

    /// List InnoDB lock waits (from performance_schema).
    pub async fn list_lock_waits(client: &MysqlClient) -> MysqlResult<String> {
        let sql = "SELECT * FROM performance_schema.data_lock_waits";
        client.exec_sql(sql).await
    }

    /// Get the latest deadlock information from SHOW ENGINE INNODB STATUS.
    pub async fn get_deadlock_info(client: &MysqlClient) -> MysqlResult<String> {
        let full_status = Self::get_engine_status(client).await?;
        // Extract the LATEST DETECTED DEADLOCK section
        let mut in_section = false;
        let mut lines = Vec::new();
        for line in full_status.lines() {
            if line.contains("LATEST DETECTED DEADLOCK") {
                in_section = true;
                lines.push(line.to_string());
                continue;
            }
            if in_section {
                if line.starts_with("---") && !lines.is_empty() && lines.len() > 2 {
                    // Likely the start of the next section
                    if line.contains("TRANSACTIONS") || line.contains("FILE I/O") {
                        break;
                    }
                }
                lines.push(line.to_string());
            }
        }
        if lines.is_empty() {
            Ok("No deadlock detected".to_string())
        } else {
            Ok(lines.join("\n"))
        }
    }

    /// Get InnoDB I/O statistics.
    pub async fn get_io_stats(client: &MysqlClient) -> MysqlResult<String> {
        let sql = "SELECT VARIABLE_NAME, VARIABLE_VALUE \
                   FROM information_schema.GLOBAL_STATUS \
                   WHERE VARIABLE_NAME LIKE 'Innodb_data_%' \
                   OR VARIABLE_NAME LIKE 'Innodb_os_log_%'";
        client.exec_sql(sql).await
    }

    /// Get InnoDB row operation counters.
    pub async fn get_row_operations(client: &MysqlClient) -> MysqlResult<String> {
        let sql = "SELECT VARIABLE_NAME, VARIABLE_VALUE \
                   FROM information_schema.GLOBAL_STATUS \
                   WHERE VARIABLE_NAME LIKE 'Innodb_rows_%'";
        client.exec_sql(sql).await
    }

    /// Check the innodb_force_recovery level.
    pub async fn force_recovery_check(client: &MysqlClient) -> MysqlResult<String> {
        let out = client.exec_sql("SELECT @@innodb_force_recovery").await?;
        Ok(out.trim().to_string())
    }
}
