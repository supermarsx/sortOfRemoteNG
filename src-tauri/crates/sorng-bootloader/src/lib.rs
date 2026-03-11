//! # sorng-bootloader — Boot Loader Management
//!
//! GRUB2 configuration, systemd-boot management, UEFI boot entries,
//! kernel parameter editing, initramfs/initrd management, boot entry
//! management, default kernel selection, and recovery options.

pub mod client;
pub mod detect;
pub mod error;
pub mod grub;
pub mod initramfs;
pub mod kernels;
pub mod service;
pub mod systemd_boot;
pub mod types;
pub mod uefi;
