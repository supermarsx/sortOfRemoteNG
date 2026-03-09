//! # sorng-systemd — systemd & Init System Management
//!
//! Comprehensive crate for managing Linux systemd units, journals, boot targets,
//! timers, sockets, and system-wide settings.
//!
//! ## Capabilities
//!
//! ### Unit Management (systemctl)
//! - Start, stop, restart, reload, enable, disable, mask, unmask units
//! - List units by type (service, timer, socket, mount, target, etc.)
//! - Unit status, dependency tree, reverse dependencies
//! - Edit unit overrides (drop-in files)
//! - Create custom unit files
//!
//! ### Journal (journalctl)
//! - View logs for units, boots, time ranges
//! - Follow logs in real-time
//! - Filter by priority, facility, PID
//! - Export logs (JSON, short, verbose)
//! - Disk usage and vacuum
//!
//! ### Boot / Target
//! - Get/set default boot target
//! - List available targets
//! - Boot analysis (systemd-analyze blame, critical-chain, plot)
//!
//! ### Timers
//! - List active timers
//! - Create/edit timer units (OnCalendar, OnBoot, etc.)
//! - Timer status and next trigger time
//!
//! ### Resource Control (cgroups)
//! - CPU, memory, IO limits per unit
//! - systemd-cgtop equivalent
//!
//! ### System Settings
//! - hostnamectl — hostname, chassis, icon, deployment
//! - localectl — locale, keymap, X11 layout
//! - loginctl — sessions, seats, users
//! - systemd-resolve — DNS status, flush cache, statistics

pub mod analyze;
pub mod cgroups;
pub mod client;
pub mod error;
pub mod hostnamectl;
pub mod journal;
pub mod localectl;
pub mod loginctl;
pub mod overrides;
pub mod service;
pub mod sockets;
pub mod targets;
pub mod timers;
pub mod types;
pub mod unit_files;
pub mod units;
