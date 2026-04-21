//! # sorng-os-detect — Extensive OS & Capabilities Detection
//!
//! Comprehensive crate for detecting operating system details, hardware profiles,
//! available services, and capability matrices across Linux, macOS, FreeBSD, and Windows.
//!
//! ## Capabilities
//!
//! ### Distribution Detection (distro)
//! - Determine OS family (Linux, macOS, FreeBSD, Windows, etc.)
//! - Identify Linux distribution from /etc/os-release, lsb_release, release files
//! - Full version information (major.minor.patch, codename, build)
//! - macOS sw_vers parsing, FreeBSD version, Windows systeminfo
//!
//! ### Init System Detection (init_system)
//! - Detect systemd, OpenRC, SysVInit, runit, s6, launchd, Windows SCM
//! - Service manager version
//! - List managed services and default boot target/runlevel
//!
//! ### Package Manager Detection (package_mgr)
//! - Discover all available package managers (apt, dnf, pacman, etc.)
//! - Installed package counts and full listings
//! - Repository/source detection, available updates
//!
//! ### Hardware Profiling (hardware)
//! - CPU: model, cores, frequency, features, cache, vendor
//! - Memory: total, available, swap, huge pages
//! - Disks: devices, mount points, filesystem types, usage
//! - Network interfaces: MACs, IPs, state, MTU, speed, driver
//! - GPUs: vendor, model, driver, VRAM
//! - Virtualization: hypervisor detection, container runtime
//! - DMI: vendor, product, serial via dmidecode
//!
//! ### Kernel Information (kernel)
//! - Kernel name, version, release, machine type via uname
//! - Architecture detection (x86_64, aarch64, armv7l, etc.)
//! - Loaded kernel modules (lsmod)
//! - sysctl queries for tunable values
//! - Kernel feature detection (cgroups, namespaces, capabilities)
//!
//! ### Security Subsystem Detection (security)
//! - SELinux status and mode (enforcing/permissive/disabled)
//! - AppArmor status and loaded profiles
//! - Firewall backend detection (iptables, nftables, firewalld, ufw, pf)
//! - Linux capabilities detection
//!
//! ### Service & Daemon Discovery (services)
//! - Scan for known services and daemons
//! - Build full ServiceCapabilities matrix
//! - Detect installed runtimes, web servers, databases, mail, containers
//!
//! ### Shell Detection (shell)
//! - Default shell from $SHELL or /etc/passwd
//! - Available shells from /etc/shells
//! - Shell version detection (bash, zsh, fish, etc.)
//!
//! ### Locale & Timezone (locale)
//! - System locale (LANG, LC_ALL)
//! - Timezone via timedatectl or /etc/timezone
//! - Keymap via localectl or /etc/vconsole.conf
//!
//! ### Full System Scan (full_scan)
//! - Aggregate all detection modules into a single OsCapabilities report
//! - Quick scan for essential info only
//! - Partial scan for selected subsystems

pub mod client;
pub mod distro;
pub mod error;
pub mod full_scan;
pub mod hardware;
pub mod init_system;
pub mod kernel;
pub mod locale;
pub mod package_mgr;
pub mod security;
pub mod service;
pub mod services;
pub mod shell;
pub mod types;
