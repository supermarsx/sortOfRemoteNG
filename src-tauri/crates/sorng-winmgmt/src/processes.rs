//! Remote Windows Process management via WMI (Win32_Process).
//!
//! Provides operations for listing, inspecting, creating, terminating,
//! and monitoring processes on remote Windows hosts through the
//! WMI-over-WinRM transport.

use crate::transport::{parse_wmi_datetime, WmiTransport};
use crate::types::*;
use crate::wql::{WqlBuilder, WqlQueries};
use log::{debug, info};
use std::collections::HashMap;

/// Manages remote Windows processes via WMI.
pub struct ProcessManager;

impl ProcessManager {
    // ─── Query ───────────────────────────────────────────────────────

    /// List all processes on the remote host.
    pub async fn list_processes(
        transport: &mut WmiTransport,
    ) -> Result<Vec<WindowsProcess>, String> {
        let query = WqlQueries::all_processes();
        let rows = transport.wql_query(&query).await?;
        let mut processes: Vec<WindowsProcess> = rows.iter().map(|r| Self::row_to_process(r)).collect();
        // Default sort by working set descending
        processes.sort_by(|a, b| b.working_set_size.cmp(&a.working_set_size));
        Ok(processes)
    }

    /// Get a process by PID.
    pub async fn get_process(
        transport: &mut WmiTransport,
        pid: u32,
    ) -> Result<WindowsProcess, String> {
        let query = WqlQueries::process_by_pid(pid);
        let rows = transport.wql_query(&query).await?;
        let row = rows
            .first()
            .ok_or_else(|| format!("Process with PID {} not found", pid))?;
        Ok(Self::row_to_process(row))
    }

    /// Search processes by name.
    pub async fn processes_by_name(
        transport: &mut WmiTransport,
        name: &str,
    ) -> Result<Vec<WindowsProcess>, String> {
        let query = WqlQueries::processes_by_name(name);
        let rows = transport.wql_query(&query).await?;
        Ok(rows.iter().map(|r| Self::row_to_process(r)).collect())
    }

    /// Search processes by name pattern (LIKE).
    pub async fn search_processes(
        transport: &mut WmiTransport,
        pattern: &str,
    ) -> Result<Vec<WindowsProcess>, String> {
        let query = WqlBuilder::select("Win32_Process")
            .where_like("Name", &format!("%{}%", pattern))
            .build();
        let rows = transport.wql_query(&query).await?;
        Ok(rows.iter().map(|r| Self::row_to_process(r)).collect())
    }

    /// Query processes with a filter.
    pub async fn query_processes(
        transport: &mut WmiTransport,
        filter: &ProcessFilter,
    ) -> Result<Vec<WindowsProcess>, String> {
        let query = Self::build_process_query(filter);
        debug!("Process query: {}", query);
        let rows = transport.wql_query(&query).await?;

        let mut processes: Vec<WindowsProcess> = rows.iter().map(|r| Self::row_to_process(r)).collect();

        // Client-side filtering for fields not easily filterable via WQL
        if let Some(ref owner_filter) = filter.owner {
            let lower = owner_filter.to_lowercase();
            processes.retain(|p| {
                p.owner
                    .as_ref()
                    .map(|o| o.to_lowercase().contains(&lower))
                    .unwrap_or(false)
            });
        }

        if let Some(min_ws) = filter.min_working_set_mb {
            let min_bytes = min_ws * 1024 * 1024;
            processes.retain(|p| p.working_set_size >= min_bytes);
        }

        // Sort
        Self::sort_processes(&mut processes, &filter.sort_by, filter.sort_desc);

        // Limit
        if processes.len() > filter.limit as usize {
            processes.truncate(filter.limit as usize);
        }

        Ok(processes)
    }

    /// Get the owner (domain\user) for a process.
    pub async fn get_process_owner(
        transport: &mut WmiTransport,
        pid: u32,
    ) -> Result<String, String> {
        let result = transport
            .invoke_method(
                "Win32_Process",
                "GetOwner",
                Some(&[("Handle", &pid.to_string())]),
                &HashMap::new(),
            )
            .await?;

        let return_value = result
            .get("ReturnValue")
            .and_then(|v| v.parse::<u32>().ok())
            .unwrap_or(u32::MAX);

        if return_value != 0 {
            return Err(format!(
                "Failed to get owner for PID {}: error code {}",
                pid, return_value
            ));
        }

        let domain = result.get("Domain").cloned().unwrap_or_default();
        let user = result.get("User").cloned().unwrap_or_default();

        if domain.is_empty() {
            Ok(user)
        } else {
            Ok(format!("{}\\{}", domain, user))
        }
    }

    /// Get owners for all processes (batch).
    pub async fn enrich_with_owners(
        transport: &mut WmiTransport,
        processes: &mut [WindowsProcess],
    ) -> Result<(), String> {
        for proc in processes.iter_mut() {
            match Self::get_process_owner(transport, proc.process_id).await {
                Ok(owner) => proc.owner = Some(owner),
                Err(e) => {
                    debug!(
                        "Could not get owner for PID {}: {}",
                        proc.process_id, e
                    );
                }
            }
        }
        Ok(())
    }

    /// Get child processes (processes whose parent is the given PID).
    pub async fn get_child_processes(
        transport: &mut WmiTransport,
        parent_pid: u32,
    ) -> Result<Vec<WindowsProcess>, String> {
        let query = WqlBuilder::select("Win32_Process")
            .where_eq_num("ParentProcessId", parent_pid as i64)
            .build();
        let rows = transport.wql_query(&query).await?;
        Ok(rows.iter().map(|r| Self::row_to_process(r)).collect())
    }

    /// Build a process tree (parent → children hierarchy).
    pub async fn get_process_tree(
        transport: &mut WmiTransport,
    ) -> Result<Vec<ProcessTreeNode>, String> {
        let all = Self::list_processes(transport).await?;

        let mut by_parent: HashMap<u32, Vec<&WindowsProcess>> = HashMap::new();
        for p in &all {
            by_parent.entry(p.parent_process_id).or_default().push(p);
        }

        // Find root processes (parents not in our process list)
        let pid_set: std::collections::HashSet<u32> =
            all.iter().map(|p| p.process_id).collect();

        let mut roots = Vec::new();
        for p in &all {
            if !pid_set.contains(&p.parent_process_id) || p.parent_process_id == 0 {
                roots.push(Self::build_tree_node(p, &by_parent));
            }
        }

        Ok(roots)
    }

    // ─── Control ─────────────────────────────────────────────────────

    /// Create a new process on the remote host.
    pub async fn create_process(
        transport: &mut WmiTransport,
        params: &CreateProcessParams,
    ) -> Result<CreateProcessResult, String> {
        info!("Creating remote process: {}", params.command_line);

        let mut method_params = HashMap::new();
        method_params.insert("CommandLine".to_string(), params.command_line.clone());

        if let Some(ref dir) = params.current_directory {
            method_params.insert("CurrentDirectory".to_string(), dir.clone());
        }

        // Process startup info for hidden window
        if params.hidden {
            // The ProcessStartupInformation would need to be embedded as a
            // Win32_ProcessStartup instance. For simplicity, we pass ShowWindow flag.
            method_params.insert("ShowWindow".to_string(), "0".to_string());
        }

        let result = transport
            .invoke_method(
                "Win32_Process",
                "Create",
                None, // Create is a static method
                &method_params,
            )
            .await?;

        let return_value = result
            .get("ReturnValue")
            .and_then(|v| v.parse::<u32>().ok())
            .unwrap_or(u32::MAX);

        let process_id = result
            .get("ProcessId")
            .and_then(|v| v.parse::<u32>().ok())
            .unwrap_or(0);

        if return_value != 0 {
            return Err(format!(
                "Failed to create process: error code {} ({})",
                return_value,
                Self::create_error_description(return_value)
            ));
        }

        Ok(CreateProcessResult {
            process_id,
            return_value,
        })
    }

    /// Terminate a process by PID.
    pub async fn terminate_process(
        transport: &mut WmiTransport,
        pid: u32,
        reason: Option<u32>,
    ) -> Result<u32, String> {
        info!("Terminating process PID {}", pid);

        let mut params = HashMap::new();
        if let Some(r) = reason {
            params.insert("Reason".to_string(), r.to_string());
        }

        let result = transport
            .invoke_method(
                "Win32_Process",
                "Terminate",
                Some(&[("Handle", &pid.to_string())]),
                &params,
            )
            .await?;

        let return_value = result
            .get("ReturnValue")
            .and_then(|v| v.parse::<u32>().ok())
            .unwrap_or(u32::MAX);

        if return_value != 0 {
            return Err(format!(
                "Failed to terminate PID {}: error code {}",
                pid, return_value
            ));
        }

        Ok(return_value)
    }

    /// Terminate all processes with a given name.
    pub async fn terminate_by_name(
        transport: &mut WmiTransport,
        name: &str,
    ) -> Result<Vec<(u32, Result<u32, String>)>, String> {
        let processes = Self::processes_by_name(transport, name).await?;
        let mut results = Vec::new();

        for p in &processes {
            let result = Self::terminate_process(transport, p.process_id, None).await;
            results.push((p.process_id, result));
        }

        Ok(results)
    }

    /// Set process priority.
    pub async fn set_priority(
        transport: &mut WmiTransport,
        pid: u32,
        priority: u32,
    ) -> Result<u32, String> {
        info!("Setting priority {} for PID {}", priority, pid);

        let mut params = HashMap::new();
        params.insert("Priority".to_string(), priority.to_string());

        let result = transport
            .invoke_method(
                "Win32_Process",
                "SetPriority",
                Some(&[("Handle", &pid.to_string())]),
                &params,
            )
            .await?;

        let return_value = result
            .get("ReturnValue")
            .and_then(|v| v.parse::<u32>().ok())
            .unwrap_or(u32::MAX);

        if return_value != 0 {
            return Err(format!(
                "Failed to set priority for PID {}: error code {}",
                pid, return_value
            ));
        }

        Ok(return_value)
    }

    // ─── Statistics ──────────────────────────────────────────────────

    /// Get summary statistics about processes.
    pub async fn process_statistics(
        transport: &mut WmiTransport,
    ) -> Result<ProcessStatistics, String> {
        let all = Self::list_processes(transport).await?;

        let total_count = all.len() as u32;
        let total_threads: u32 = all.iter().map(|p| p.thread_count).sum();
        let total_handles: u32 = all.iter().map(|p| p.handle_count).sum();
        let total_working_set: u64 = all.iter().map(|p| p.working_set_size).sum();
        let total_virtual: u64 = all.iter().map(|p| p.virtual_size).sum();

        // Top N by memory
        let mut by_mem = all.clone();
        by_mem.sort_by(|a, b| b.working_set_size.cmp(&a.working_set_size));
        let top_by_memory: Vec<(String, u64)> = by_mem
            .iter()
            .take(10)
            .map(|p| (p.name.clone(), p.working_set_size))
            .collect();

        // Top N by handles
        let mut by_handles = all.clone();
        by_handles.sort_by(|a, b| b.handle_count.cmp(&a.handle_count));
        let top_by_handles: Vec<(String, u32)> = by_handles
            .iter()
            .take(10)
            .map(|p| (p.name.clone(), p.handle_count))
            .collect();

        // Unique process names
        let mut names: Vec<String> = all.iter().map(|p| p.name.clone()).collect();
        names.sort();
        names.dedup();
        let unique_process_count = names.len() as u32;

        Ok(ProcessStatistics {
            total_count,
            unique_process_count,
            total_threads,
            total_handles,
            total_working_set_bytes: total_working_set,
            total_virtual_bytes: total_virtual,
            top_by_memory,
            top_by_handles,
        })
    }

    // ─── Helpers ─────────────────────────────────────────────────────

    /// Build WQL query from ProcessFilter.
    fn build_process_query(filter: &ProcessFilter) -> String {
        let mut b = WqlBuilder::select("Win32_Process");

        if let Some(ref name) = filter.name {
            b = b.where_eq("Name", name);
        }
        if let Some(pid) = filter.pid {
            b = b.where_eq_num("ProcessId", pid as i64);
        }
        if let Some(ppid) = filter.parent_pid {
            b = b.where_eq_num("ParentProcessId", ppid as i64);
        }
        if let Some(ref path) = filter.executable_path_contains {
            b = b.where_like("ExecutablePath", &format!("%{}%", path));
        }
        if let Some(ref cmd) = filter.command_line_contains {
            b = b.where_like("CommandLine", &format!("%{}%", cmd));
        }
        if let Some(sid) = filter.session_id {
            b = b.where_eq_num("SessionId", sid as i64);
        }

        b.build()
    }

    /// Sort processes by a given field.
    fn sort_processes(processes: &mut [WindowsProcess], field: &ProcessSortField, desc: bool) {
        processes.sort_by(|a, b| {
            let cmp = match field {
                ProcessSortField::Name => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
                ProcessSortField::ProcessId => a.process_id.cmp(&b.process_id),
                ProcessSortField::WorkingSetSize => {
                    a.working_set_size.cmp(&b.working_set_size)
                }
                ProcessSortField::CpuTime => {
                    let a_cpu = a.kernel_mode_time + a.user_mode_time;
                    let b_cpu = b.kernel_mode_time + b.user_mode_time;
                    a_cpu.cmp(&b_cpu)
                }
                ProcessSortField::ThreadCount => a.thread_count.cmp(&b.thread_count),
                ProcessSortField::HandleCount => a.handle_count.cmp(&b.handle_count),
                ProcessSortField::CreationDate => a.creation_date.cmp(&b.creation_date),
            };
            if desc {
                cmp.reverse()
            } else {
                cmp
            }
        });
    }

    /// Convert a WMI result row to a WindowsProcess.
    fn row_to_process(row: &HashMap<String, String>) -> WindowsProcess {
        let get = |key: &str| row.get(key).cloned();
        let get_u32 = |key: &str| {
            row.get(key)
                .and_then(|v| v.parse::<u32>().ok())
                .unwrap_or(0)
        };
        let get_u64 = |key: &str| {
            row.get(key)
                .and_then(|v| v.parse::<u64>().ok())
                .unwrap_or(0)
        };

        WindowsProcess {
            process_id: get_u32("ProcessId"),
            parent_process_id: get_u32("ParentProcessId"),
            name: row
                .get("Name")
                .cloned()
                .unwrap_or_else(|| "".to_string()),
            executable_path: get("ExecutablePath"),
            command_line: get("CommandLine"),
            creation_date: row
                .get("CreationDate")
                .and_then(|v| parse_wmi_datetime(v)),
            status: get("Status"),
            thread_count: get_u32("ThreadCount"),
            handle_count: get_u32("HandleCount"),
            working_set_size: get_u64("WorkingSetSize"),
            virtual_size: get_u64("VirtualSize"),
            peak_working_set_size: get_u64("PeakWorkingSetSize"),
            page_faults: get_u32("PageFaults"),
            page_file_usage: get_u64("PageFileUsage"),
            peak_page_file_usage: get_u64("PeakPageFileUsage"),
            kernel_mode_time: get_u64("KernelModeTime"),
            user_mode_time: get_u64("UserModeTime"),
            priority: get_u32("Priority"),
            session_id: get_u32("SessionId"),
            owner: None, // populated separately via GetOwner
            read_operation_count: row
                .get("ReadOperationCount")
                .and_then(|v| v.parse().ok()),
            write_operation_count: row
                .get("WriteOperationCount")
                .and_then(|v| v.parse().ok()),
            read_transfer_count: row
                .get("ReadTransferCount")
                .and_then(|v| v.parse().ok()),
            write_transfer_count: row
                .get("WriteTransferCount")
                .and_then(|v| v.parse().ok()),
        }
    }

    /// Build a tree node recursively.
    fn build_tree_node(
        process: &WindowsProcess,
        children_map: &HashMap<u32, Vec<&WindowsProcess>>,
    ) -> ProcessTreeNode {
        let children = children_map
            .get(&process.process_id)
            .map(|kids| {
                kids.iter()
                    .map(|child| Self::build_tree_node(child, children_map))
                    .collect()
            })
            .unwrap_or_default();

        ProcessTreeNode {
            process: process.clone(),
            children,
        }
    }

    /// Human-readable description for Win32_Process.Create return codes.
    fn create_error_description(code: u32) -> &'static str {
        match code {
            0 => "Successful completion",
            2 => "Access denied",
            3 => "Insufficient privilege",
            8 => "Unknown failure",
            9 => "Path not found",
            21 => "Invalid parameter",
            _ => "Unknown error",
        }
    }
}

// ─── Supporting Types ────────────────────────────────────────────────

/// Process tree node for hierarchy display.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessTreeNode {
    pub process: WindowsProcess,
    pub children: Vec<ProcessTreeNode>,
}

/// Summary statistics about remote processes.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessStatistics {
    pub total_count: u32,
    pub unique_process_count: u32,
    pub total_threads: u32,
    pub total_handles: u32,
    pub total_working_set_bytes: u64,
    pub total_virtual_bytes: u64,
    pub top_by_memory: Vec<(String, u64)>,
    pub top_by_handles: Vec<(String, u32)>,
}

use serde::{Deserialize, Serialize};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_row_to_process() {
        let mut row = HashMap::new();
        row.insert("ProcessId".to_string(), "1234".to_string());
        row.insert("ParentProcessId".to_string(), "4".to_string());
        row.insert("Name".to_string(), "notepad.exe".to_string());
        row.insert(
            "ExecutablePath".to_string(),
            "C:\\Windows\\notepad.exe".to_string(),
        );
        row.insert("ThreadCount".to_string(), "8".to_string());
        row.insert("HandleCount".to_string(), "200".to_string());
        row.insert("WorkingSetSize".to_string(), "52428800".to_string());
        row.insert("VirtualSize".to_string(), "2147483648".to_string());
        row.insert("Priority".to_string(), "8".to_string());
        row.insert("SessionId".to_string(), "1".to_string());
        row.insert("KernelModeTime".to_string(), "156250".to_string());
        row.insert("UserModeTime".to_string(), "312500".to_string());

        let proc = ProcessManager::row_to_process(&row);
        assert_eq!(proc.process_id, 1234);
        assert_eq!(proc.parent_process_id, 4);
        assert_eq!(proc.name, "notepad.exe");
        assert_eq!(proc.thread_count, 8);
        assert_eq!(proc.handle_count, 200);
        assert_eq!(proc.working_set_size, 52428800);
        assert_eq!(proc.priority, 8);
    }

    #[test]
    fn test_build_process_query() {
        let filter = ProcessFilter {
            name: Some("chrome.exe".to_string()),
            session_id: Some(1),
            ..Default::default()
        };
        let query = ProcessManager::build_process_query(&filter);
        assert!(query.contains("Name = 'chrome.exe'"));
        assert!(query.contains("SessionId = 1"));
    }

    #[test]
    fn test_sort_processes() {
        let mut procs = vec![
            WindowsProcess {
                process_id: 1,
                parent_process_id: 0,
                name: "b.exe".to_string(),
                executable_path: None,
                command_line: None,
                creation_date: None,
                status: None,
                thread_count: 5,
                handle_count: 100,
                working_set_size: 200,
                virtual_size: 0,
                peak_working_set_size: 0,
                page_faults: 0,
                page_file_usage: 0,
                peak_page_file_usage: 0,
                kernel_mode_time: 0,
                user_mode_time: 0,
                priority: 8,
                session_id: 0,
                owner: None,
                read_operation_count: None,
                write_operation_count: None,
                read_transfer_count: None,
                write_transfer_count: None,
            },
            WindowsProcess {
                process_id: 2,
                parent_process_id: 0,
                name: "a.exe".to_string(),
                executable_path: None,
                command_line: None,
                creation_date: None,
                status: None,
                thread_count: 10,
                handle_count: 50,
                working_set_size: 100,
                virtual_size: 0,
                peak_working_set_size: 0,
                page_faults: 0,
                page_file_usage: 0,
                peak_page_file_usage: 0,
                kernel_mode_time: 0,
                user_mode_time: 0,
                priority: 8,
                session_id: 0,
                owner: None,
                read_operation_count: None,
                write_operation_count: None,
                read_transfer_count: None,
                write_transfer_count: None,
            },
        ];

        ProcessManager::sort_processes(&mut procs, &ProcessSortField::Name, false);
        assert_eq!(procs[0].name, "a.exe");
        assert_eq!(procs[1].name, "b.exe");
    }
}
