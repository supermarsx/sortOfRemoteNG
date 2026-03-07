//! # sorng-bootloader — Boot Loader Management
//!
//! GRUB2 configuration, systemd-boot management, UEFI boot entries,
//! kernel parameter editing, initramfs/initrd management, boot entry
//! management, default kernel selection, and recovery options.

pub mod types;
pub mod error;
pub mod client;
pub mod commands;
pub mod grub;
pub mod systemd_boot;
pub mod uefi;
pub mod kernels;
pub mod initramfs;
pub mod detect;
pub mod service;
