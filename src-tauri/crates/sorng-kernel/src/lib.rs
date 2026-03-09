//! # sorng-kernel — Kernel Module & Sysctl Management
//!
//! Comprehensive crate for managing Linux kernel modules, sysctl parameters,
//! kernel features, hardware info, power management, and sysfs exploration.
//!
//! ## Capabilities
//!
//! ### Module Management (modprobe / lsmod)
//! - List loaded modules, load/unload/reload modules
//! - Module parameters — read and write at runtime
//! - Module info, dependencies, blacklisting, autoloading
//! - Available module scanning and search
//!
//! ### Sysctl Management
//! - Get/set sysctl values at runtime and persistently
//! - sysctl.d file management
//! - Category-based access (kernel, net, vm, fs, etc.)
//!
//! ### Kernel Features
//! - Kernel configuration option inspection
//! - cgroup, namespace, LSM, filesystem, I/O scheduler detection
//! - Kernel version and command line
//!
//! ### Hardware / Proc Info
//! - /proc/interrupts, /proc/dma, /proc/ioports, /proc/iomem parsing
//!
//! ### Power Management
//! - Power states, thermal zones, CPU governors
//! - Power profiles (power-profiles-daemon / tuned)
//!
//! ### Sysfs Exploration
//! - Read/write arbitrary /sys attributes
//! - Block device enumeration

pub mod client;
pub mod commands;
pub mod error;
pub mod features;
pub mod interrupts;
pub mod modules;
pub mod power;
pub mod service;
pub mod sysctl;
pub mod sysfs;
pub mod types;
