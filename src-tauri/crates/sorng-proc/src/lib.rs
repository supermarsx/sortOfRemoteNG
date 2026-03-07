//! # sorng-proc — Running Process Management
//!
//! Comprehensive crate for managing Linux processes remotely via SSH —
//! equivalent to Webmin's "Running Processes" module.
//!
//! ## Capabilities
//!
//! ### Process Listing
//! - List all running processes with full resource details
//! - Build parent-child process trees
//! - Search/filter processes by pattern, user, state
//! - Top-N queries by CPU, memory, or I/O
//! - Process count by state
//!
//! ### Process Control (Signals)
//! - Send any POSIX signal (SIGTERM, SIGKILL, SIGHUP, etc.)
//! - Kill by PID, name (killall), or pattern (pkill)
//! - Renice / ionice — adjust scheduling priority
//! - CPU affinity via taskset
//!
//! ### Open Files & Sockets
//! - List open file descriptors per process (lsof / /proc/pid/fd)
//! - List sockets (ss -tulnp), listening ports
//! - Find files by name pattern
//!
//! ### /proc Filesystem Browsing
//! - Process status, cmdline, environment, limits
//! - Memory maps (/proc/pid/maps)
//! - I/O accounting (/proc/pid/io)
//! - Namespace and cgroup info
//!
//! ### System-Wide Information
//! - Load average, uptime, boot time
//! - /proc/meminfo, /proc/vmstat, /proc/stat
//! - Mounted filesystems, sysctl limits

pub mod client;
pub mod commands;
pub mod error;
pub mod files;
pub mod list;
pub mod proc_fs;
pub mod service;
pub mod signals;
pub mod system;
pub mod types;
