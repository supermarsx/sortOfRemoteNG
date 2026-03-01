//! Remote Windows Performance Monitoring via WMI.
//!
//! Provides operations for collecting CPU, memory, disk, network, and
//! custom performance counters from remote Windows hosts using
//! Win32_PerfFormattedData_* WMI classes.

use crate::transport::WmiTransport;
use crate::types::*;
use crate::wql::{WqlBuilder, WqlQueries};
use chrono::Utc;
use log::{debug, warn};
use std::collections::HashMap;

/// Manages remote Windows performance monitoring via WMI.
pub struct PerfMonManager;

impl PerfMonManager {
    // ─── Full Snapshot ───────────────────────────────────────────────

    /// Collect a full system performance snapshot.
    pub async fn collect_snapshot(
        transport: &mut WmiTransport,
        config: &PerfMonitorConfig,
    ) -> Result<SystemPerformanceSnapshot, String> {
        let timestamp = Utc::now();

        let cpu = Self::collect_cpu(transport, config.include_per_core_cpu).await?;
        let memory = Self::collect_memory(transport).await?;

        let disks = if config.include_disks {
            Self::collect_disks(transport).await.unwrap_or_default()
        } else {
            Vec::new()
        };

        let network = if config.include_network {
            Self::collect_network(transport).await.unwrap_or_default()
        } else {
            Vec::new()
        };

        let system = Self::collect_system_counters(transport).await?;

        Ok(SystemPerformanceSnapshot {
            timestamp,
            cpu,
            memory,
            disks,
            network,
            system,
        })
    }

    // ─── CPU ─────────────────────────────────────────────────────────

    /// Collect CPU performance counters.
    pub async fn collect_cpu(
        transport: &mut WmiTransport,
        include_per_core: bool,
    ) -> Result<CpuPerformance, String> {
        // Total CPU
        let query = WqlQueries::perf_cpu_total();
        let rows = transport.wql_query(&query).await?;
        let total_row = rows.first().ok_or("No CPU performance data returned")?;

        let total_usage = Self::parse_f64(total_row, "PercentProcessorTime");
        let privileged = Self::parse_f64(total_row, "PercentPrivilegedTime");
        let user_time = Self::parse_f64(total_row, "PercentUserTime");
        let interrupt = Self::parse_f64(total_row, "PercentInterruptTime");
        let dpc = Self::parse_f64(total_row, "PercentDPCTime");
        let idle = Self::parse_f64(total_row, "PercentIdleTime");

        // Per-core breakdown
        let per_core_usage = if include_per_core {
            let query = WqlQueries::perf_cpu_per_core();
            let core_rows = transport.wql_query(&query).await.unwrap_or_default();
            let mut cores: Vec<(String, f64)> = core_rows
                .iter()
                .map(|r| {
                    let name = r.get("Name").cloned().unwrap_or_default();
                    let pct = Self::parse_f64(r, "PercentProcessorTime");
                    (name, pct)
                })
                .collect();
            cores.sort_by(|a, b| a.0.cmp(&b.0));
            cores.into_iter().map(|(_, pct)| pct).collect()
        } else {
            Vec::new()
        };

        // System counters for queue length and context switches
        let sys_query = WqlQueries::perf_context_switches();
        let sys_rows = transport.wql_query(&sys_query).await.unwrap_or_default();
        let sys_row = sys_rows.first();

        let context_switches = sys_row
            .and_then(|r| Self::parse_u64_opt(r, "ContextSwitchesPerSec"))
            .unwrap_or(0);
        let system_calls = sys_row
            .and_then(|r| Self::parse_u64_opt(r, "SystemCallsPerSec"))
            .unwrap_or(0);

        let pq_query = WqlQueries::perf_processor_queue();
        let pq_rows = transport.wql_query(&pq_query).await.unwrap_or_default();
        let queue_length = pq_rows
            .first()
            .and_then(|r| Self::parse_u32_opt(r, "ProcessorQueueLength"))
            .unwrap_or(0);

        Ok(CpuPerformance {
            total_usage_percent: total_usage,
            per_core_usage,
            privileged_time_percent: privileged,
            user_time_percent: user_time,
            interrupt_time_percent: interrupt,
            dpc_time_percent: dpc,
            idle_time_percent: idle,
            processor_queue_length: queue_length,
            context_switches_per_sec: context_switches,
            system_calls_per_sec: system_calls,
        })
    }

    // ─── Memory ──────────────────────────────────────────────────────

    /// Collect memory performance counters.
    pub async fn collect_memory(
        transport: &mut WmiTransport,
    ) -> Result<MemoryPerformance, String> {
        // Performance counters
        let query = WqlQueries::perf_memory();
        let rows = transport.wql_query(&query).await?;
        let row = rows
            .first()
            .ok_or("No memory performance data returned")?;

        let available = Self::parse_u64(row, "AvailableBytes");
        let committed = Self::parse_u64(row, "CommittedBytes");
        let commit_limit = Self::parse_u64(row, "CommitLimit");
        let pages_per_sec = Self::parse_u64(row, "PagesPerSec");
        let page_faults_per_sec = Self::parse_u64(row, "PageFaultsPerSec");
        let cache_bytes = Self::parse_u64(row, "CacheBytes");
        let pool_paged = Self::parse_u64(row, "PoolPagedBytes");
        let pool_nonpaged = Self::parse_u64(row, "PoolNonpagedBytes");

        // Get total physical memory from Win32_OperatingSystem
        let os_query = WqlQueries::os_memory();
        let os_rows = transport.wql_query(&os_query).await.unwrap_or_default();
        let os_row = os_rows.first();

        let total_visible_kb = os_row
            .and_then(|r| Self::parse_u64_opt(r, "TotalVisibleMemorySize"))
            .unwrap_or(0);
        let total_physical = total_visible_kb * 1024;

        let used_percent = if total_physical > 0 {
            ((total_physical - available) as f64 / total_physical as f64) * 100.0
        } else {
            0.0
        };

        Ok(MemoryPerformance {
            total_physical_bytes: total_physical,
            available_bytes: available,
            used_percent,
            committed_bytes: committed,
            commit_limit,
            pages_per_sec,
            page_faults_per_sec,
            cache_bytes,
            pool_paged_bytes: pool_paged,
            pool_nonpaged_bytes: pool_nonpaged,
        })
    }

    // ─── Disk ────────────────────────────────────────────────────────

    /// Collect disk performance counters.
    pub async fn collect_disks(
        transport: &mut WmiTransport,
    ) -> Result<Vec<DiskPerformance>, String> {
        let query = WqlQueries::perf_physical_disk();
        let rows = transport.wql_query(&query).await?;

        // Also get logical disk free space
        let ld_query = WqlQueries::logical_disks();
        let ld_rows = transport.wql_query(&ld_query).await.unwrap_or_default();
        let ld_map: HashMap<String, (u64, u64)> = ld_rows
            .iter()
            .filter_map(|r| {
                let id = r.get("DeviceID")?.clone();
                let free = Self::parse_u64_opt(r, "FreeSpace")?;
                let size = Self::parse_u64_opt(r, "Size")?;
                Some((id, (free, size)))
            })
            .collect();

        let mut disks = Vec::new();
        for row in &rows {
            let name = row.get("Name").cloned().unwrap_or_default();

            // Skip _Total aggregate if individual disks are present
            if name == "_Total" && rows.len() > 1 {
                continue;
            }

            let (free_space, total_size) = ld_map
                .get(&name)
                .or_else(|| {
                    // Try matching by disk letter
                    ld_map
                        .iter()
                        .find(|(k, _)| name.contains(k.as_str()))
                        .map(|(_, v)| v)
                })
                .cloned()
                .unwrap_or((0, 0));

            disks.push(DiskPerformance {
                name,
                read_bytes_per_sec: Self::parse_u64(row, "DiskReadBytesPerSec"),
                write_bytes_per_sec: Self::parse_u64(row, "DiskWriteBytesPerSec"),
                reads_per_sec: Self::parse_u64(row, "DiskReadsPerSec"),
                writes_per_sec: Self::parse_u64(row, "DiskWritesPerSec"),
                avg_disk_queue_length: Self::parse_f64(row, "AvgDiskQueueLength"),
                percent_disk_time: Self::parse_f64(row, "PercentDiskTime"),
                avg_sec_per_read: Self::parse_f64(row, "AvgDiskSecPerRead"),
                avg_sec_per_write: Self::parse_f64(row, "AvgDiskSecPerWrite"),
                free_space_bytes: if total_size > 0 {
                    Some(free_space)
                } else {
                    None
                },
                total_size_bytes: if total_size > 0 {
                    Some(total_size)
                } else {
                    None
                },
            });
        }

        Ok(disks)
    }

    // ─── Network ─────────────────────────────────────────────────────

    /// Collect network interface performance counters.
    pub async fn collect_network(
        transport: &mut WmiTransport,
    ) -> Result<Vec<NetworkPerformance>, String> {
        let query = WqlQueries::perf_network();
        let rows = transport.wql_query(&query).await?;

        let mut nics = Vec::new();
        for row in &rows {
            nics.push(NetworkPerformance {
                name: row.get("Name").cloned().unwrap_or_default(),
                bytes_received_per_sec: Self::parse_u64(row, "BytesReceivedPerSec"),
                bytes_sent_per_sec: Self::parse_u64(row, "BytesSentPerSec"),
                bytes_total_per_sec: Self::parse_u64(row, "BytesTotalPerSec"),
                packets_received_per_sec: Self::parse_u64(row, "PacketsReceivedPerSec"),
                packets_sent_per_sec: Self::parse_u64(row, "PacketsSentPerSec"),
                current_bandwidth: Self::parse_u64(row, "CurrentBandwidth"),
                output_queue_length: Self::parse_u64(row, "OutputQueueLength"),
                packets_received_errors: Self::parse_u64(row, "PacketsReceivedErrors"),
                packets_outbound_errors: Self::parse_u64(row, "PacketsOutboundErrors"),
                packets_received_discarded: Self::parse_u64(row, "PacketsReceivedDiscarded"),
                packets_outbound_discarded: Self::parse_u64(row, "PacketsOutboundDiscarded"),
            });
        }

        Ok(nics)
    }

    // ─── System ──────────────────────────────────────────────────────

    /// Collect system-wide performance counters.
    pub async fn collect_system_counters(
        transport: &mut WmiTransport,
    ) -> Result<SystemCounters, String> {
        let query = WqlQueries::perf_system();
        let rows = transport.wql_query(&query).await?;
        let row = rows
            .first()
            .ok_or("No system performance data returned")?;

        Ok(SystemCounters {
            processes: Self::parse_u32(row, "Processes"),
            threads: Self::parse_u32(row, "Threads"),
            system_up_time: Self::parse_u64(row, "SystemUpTime"),
            file_data_operations_per_sec: Self::parse_u64(row, "FileDataOperationsPerSec"),
            file_read_operations_per_sec: Self::parse_u64(row, "FileReadOperationsPerSec"),
            file_write_operations_per_sec: Self::parse_u64(row, "FileWriteOperationsPerSec"),
            handle_count: None, // populated from process enumeration if needed
        })
    }

    // ─── Custom Counters ─────────────────────────────────────────────

    /// Query a custom WMI performance counter class.
    pub async fn query_custom_counter(
        transport: &mut WmiTransport,
        counter: &CustomPerfCounter,
    ) -> Result<Vec<HashMap<String, String>>, String> {
        let mut b = WqlBuilder::select(&counter.wmi_class);

        if !counter.properties.is_empty() {
            let field_refs: Vec<&str> = counter.properties.iter().map(|s| s.as_str()).collect();
            b = b.fields(&field_refs);
        }

        if let Some(ref filter) = counter.filter {
            b = b.where_raw(filter);
        }

        let query = b.build();
        debug!("Custom counter query: {}", query);
        transport.wql_query(&query).await
    }

    /// Collect all configured custom counters.
    pub async fn collect_custom_counters(
        transport: &mut WmiTransport,
        counters: &[CustomPerfCounter],
    ) -> Result<HashMap<String, Vec<HashMap<String, String>>>, String> {
        let mut results = HashMap::new();

        for counter in counters {
            match Self::query_custom_counter(transport, counter).await {
                Ok(data) => {
                    results.insert(counter.name.clone(), data);
                }
                Err(e) => {
                    warn!("Failed to query custom counter '{}': {}", counter.name, e);
                    results.insert(counter.name.clone(), Vec::new());
                }
            }
        }

        Ok(results)
    }

    // ─── Quick Metrics ───────────────────────────────────────────────

    /// Quick CPU usage check (just total percent).
    pub async fn quick_cpu_usage(transport: &mut WmiTransport) -> Result<f64, String> {
        let query = WqlQueries::perf_cpu_total();
        let rows = transport.wql_query(&query).await?;
        let row = rows.first().ok_or("No CPU data")?;
        Ok(Self::parse_f64(row, "PercentProcessorTime"))
    }

    /// Quick memory usage check (percent used).
    pub async fn quick_memory_usage(transport: &mut WmiTransport) -> Result<f64, String> {
        let mem = Self::collect_memory(transport).await?;
        Ok(mem.used_percent)
    }

    /// Quick health summary.
    pub async fn quick_health(
        transport: &mut WmiTransport,
    ) -> Result<QuickHealthSummary, String> {
        let cpu = Self::quick_cpu_usage(transport).await.unwrap_or(-1.0);
        let memory = Self::collect_memory(transport).await.ok();
        let system = Self::collect_system_counters(transport).await.ok();

        let status = if cpu > 95.0
            || memory
                .as_ref()
                .map(|m| m.used_percent > 95.0)
                .unwrap_or(false)
        {
            "critical".to_string()
        } else if cpu > 80.0
            || memory
                .as_ref()
                .map(|m| m.used_percent > 80.0)
                .unwrap_or(false)
        {
            "warning".to_string()
        } else {
            "healthy".to_string()
        };

        Ok(QuickHealthSummary {
            status,
            cpu_percent: cpu,
            memory_percent: memory.as_ref().map(|m| m.used_percent).unwrap_or(-1.0),
            memory_available_gb: memory
                .as_ref()
                .map(|m| m.available_bytes as f64 / 1_073_741_824.0)
                .unwrap_or(0.0),
            process_count: system.as_ref().map(|s| s.processes).unwrap_or(0),
            uptime_hours: system
                .as_ref()
                .map(|s| s.system_up_time as f64 / 3600.0)
                .unwrap_or(0.0),
            timestamp: Utc::now(),
        })
    }

    // ─── Parse Helpers ───────────────────────────────────────────────

    fn parse_f64(row: &HashMap<String, String>, key: &str) -> f64 {
        row.get(key)
            .and_then(|v| v.parse::<f64>().ok())
            .unwrap_or(0.0)
    }

    fn parse_u64(row: &HashMap<String, String>, key: &str) -> u64 {
        row.get(key)
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(0)
    }

    fn parse_u64_opt(row: &HashMap<String, String>, key: &str) -> Option<u64> {
        row.get(key).and_then(|v| v.parse::<u64>().ok())
    }

    fn parse_u32(row: &HashMap<String, String>, key: &str) -> u32 {
        row.get(key)
            .and_then(|v| v.parse::<u32>().ok())
            .unwrap_or(0)
    }

    fn parse_u32_opt(row: &HashMap<String, String>, key: &str) -> Option<u32> {
        row.get(key).and_then(|v| v.parse::<u32>().ok())
    }
}

// ─── Supporting Types ────────────────────────────────────────────────

use serde::{Deserialize, Serialize};

/// Quick health summary for dashboard display.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickHealthSummary {
    pub status: String,
    pub cpu_percent: f64,
    pub memory_percent: f64,
    pub memory_available_gb: f64,
    pub process_count: u32,
    pub uptime_hours: f64,
    pub timestamp: chrono::DateTime<Utc>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_helpers() {
        let mut row = HashMap::new();
        row.insert("Percent".to_string(), "85.5".to_string());
        row.insert("Count".to_string(), "42".to_string());
        row.insert("Big".to_string(), "1073741824".to_string());
        row.insert("Invalid".to_string(), "not_a_number".to_string());

        assert!((PerfMonManager::parse_f64(&row, "Percent") - 85.5).abs() < f64::EPSILON);
        assert_eq!(PerfMonManager::parse_u32(&row, "Count"), 42);
        assert_eq!(PerfMonManager::parse_u64(&row, "Big"), 1073741824);
        assert_eq!(PerfMonManager::parse_f64(&row, "Invalid"), 0.0);
        assert_eq!(PerfMonManager::parse_f64(&row, "Missing"), 0.0);
    }

    #[test]
    fn test_default_perf_config() {
        let config = PerfMonitorConfig::default();
        assert_eq!(config.interval_sec, 5);
        assert!(config.include_per_core_cpu);
        assert!(config.include_disks);
        assert!(config.include_network);
        assert_eq!(config.max_history, 720);
    }
}
