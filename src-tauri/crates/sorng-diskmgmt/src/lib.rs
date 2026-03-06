//! # sorng-diskmgmt — Disk & Storage Management
//!
//! Partitions (fdisk/parted), filesystems, LVM, ZFS, RAID (mdadm),
//! mount/fstab, SMART health, disk usage, and swap.

pub mod types;
pub mod error;
pub mod client;
pub mod service;
pub mod blocks;
pub mod partitions;
pub mod filesystems;
pub mod mounts;
pub mod fstab;
pub mod lvm;
pub mod zfs;
pub mod mdraid;
pub mod smart;
pub mod swap;
pub mod usage;
