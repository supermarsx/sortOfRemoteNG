//! # sorng-diskmgmt — Disk & Storage Management
//!
//! Partitions (fdisk/parted), filesystems, LVM, ZFS, RAID (mdadm),
//! mount/fstab, SMART health, disk usage, and swap.

pub mod blocks;
pub mod client;
pub mod error;
pub mod filesystems;
pub mod fstab;
pub mod lvm;
pub mod mdraid;
pub mod mounts;
pub mod partitions;
pub mod service;
pub mod smart;
pub mod swap;
pub mod types;
pub mod usage;
pub mod zfs;
