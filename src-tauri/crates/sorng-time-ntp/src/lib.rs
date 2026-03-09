//! # sorng-time-ntp — Time, Timezone & NTP Management
//!
//! timedatectl, chronyd/ntpd configuration, NTP peer/server management,
//! timezone configuration, RTC (hardware clock), PTP support, and time
//! synchronization monitoring.

pub mod chrony;
pub mod client;
pub mod commands;
pub mod detect;
pub mod error;
pub mod hwclock;
pub mod ntpd;
pub mod ptp;
pub mod service;
pub mod timedatectl;
pub mod types;
