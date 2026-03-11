//! # sorng-vmware-desktop
//!
//! VMware **Desktop** hypervisor management for **Player**, **Workstation**
//! and **Fusion** — distinct from the `sorng-vmware` crate which covers
//! vSphere / ESXi server virtualisation.
//!
//! ## Driver layers
//!
//! | Driver | Coverage |
//! |--------|----------|
//! | `vmrun` CLI | Ships with every desktop product — VM lifecycle, snapshots, clones, guest ops, shared folders |
//! | `vmrest` REST API | Workstation Pro 15+ / Fusion 11+ — VM CRUD, NICs, shared folders, virtual networks |
//! | VMX parser | Direct `.vmx` file read/write for full configuration access |
//! | `vmware-vdiskmanager` | VMDK creation, defrag, shrink, expand, convert |
//! | `ovftool` | OVF / OVA import and export |
pub mod error;
pub mod guest;
pub mod networks;
pub mod ovf;
pub mod power;
pub mod prefs;
pub mod service;
pub mod shared_folders;
pub mod snapshots;
pub mod types;
pub mod vm;
pub mod vmdk;
pub mod vmrest;
pub mod vmrun;
pub mod vmx;
