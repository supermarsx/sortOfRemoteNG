//! # sorng-time-ntp — Time, Timezone & NTP Management
//!
//! timedatectl, chronyd/ntpd configuration, NTP peer/server management,
//! timezone configuration, RTC (hardware clock), PTP support, and time
//! synchronization monitoring.

pub mod types;
pub mod error;
pub mod client;
pub mod service;
pub mod timedatectl;
pub mod chrony;
pub mod ntpd;
pub mod hwclock;
pub mod detect;
pub mod ptp;
pub mod commands;
