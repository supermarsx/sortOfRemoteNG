//! # sorng-packages — Package Manager Abstraction
//!
//! Unified interface for apt, yum/dnf, pacman, zypper, snap, flatpak.

pub mod apt;
pub mod client;
pub mod dnf;
pub mod error;
pub mod flatpak;
pub mod pacman;
pub mod repos;
pub mod service;
pub mod snap;
pub mod types;
pub mod updates;
pub mod zypper;
