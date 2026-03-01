//! # SortOfRemote NG – Remote Windows Management
//!
//! Comprehensive remote Windows host management via WMI (Windows Management
//! Instrumentation) over WinRM/DCOM. Provides services for:
//!
//! - **Windows Services** – enumerate, start, stop, restart, configure
//! - **Event Viewer** – query, filter, export Windows Event Logs
//! - **Processes** – list, inspect, kill, launch remote processes
//! - **Performance Monitoring** – CPU, memory, disk, network counters
//! - **Registry** – read/write remote registry keys & values
//! - **Scheduled Tasks** – enumerate, create, modify, run remote tasks
//! - **System Information** – OS, hardware, disks, network adapters

pub mod types;
pub mod transport;
pub mod wql;
pub mod services;
pub mod eventlog;
pub mod processes;
pub mod perfmon;
pub mod registry;
pub mod scheduled_tasks;
pub mod system_info;
pub mod service;
pub mod commands;
