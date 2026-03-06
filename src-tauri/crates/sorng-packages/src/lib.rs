//! # sorng-packages — Package Manager Abstraction
//!
//! Unified interface for apt, yum/dnf, pacman, zypper, snap, flatpak.

pub mod types;
pub mod error;
pub mod client;
pub mod service;
pub mod apt;
pub mod dnf;
pub mod pacman;
pub mod zypper;
pub mod snap;
pub mod flatpak;
pub mod repos;
pub mod updates;
