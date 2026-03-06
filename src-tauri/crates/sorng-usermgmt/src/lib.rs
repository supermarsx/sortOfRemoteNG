//! # sorng-usermgmt — Linux/Unix User & Group Management
//!
//! Comprehensive crate for managing system users and groups on Linux/Unix
//! hosts, comparable to Webmin's "Users and Groups" module.
//!
//! ## Capabilities
//!
//! ### User Management
//! - Create, modify, delete users (`useradd`, `usermod`, `userdel`)
//! - Password management (`passwd`, `chpasswd`, expiry via `chage`)
//! - Home directory management (create, remove, migrate, skeleton)
//! - Shell management (list available shells, change shell)
//! - UID/GID assignment (auto, manual, ranges, system accounts)
//! - Account locking / unlocking
//! - User quotas (disk usage limits)
//! - Login history and session tracking (`last`, `lastlog`, `who`, `w`)
//!
//! ### Group Management
//! - Create, modify, delete groups (`groupadd`, `groupmod`, `groupdel`)
//! - Group membership (add/remove users, primary group changes)
//! - GID management and system groups
//!
//! ### File Parsers
//! - `/etc/passwd` — user account entries
//! - `/etc/shadow` — password hashes and aging
//! - `/etc/group` — group definitions
//! - `/etc/gshadow` — group passwords
//! - `/etc/login.defs` — login defaults (UID_MIN/MAX, PASS_MAX_DAYS, etc.)
//! - `/etc/shells` — available login shells
//!
//! ### Sudo / Sudoers
//! - Parse and edit `/etc/sudoers` and `/etc/sudoers.d/*`
//! - User/group sudo privileges
//! - NOPASSWD entries, command aliases, host aliases
//! - Validate with `visudo -c`
//!
//! ### Bulk Operations
//! - Import users from CSV/JSON
//! - Batch create/delete/modify
//! - Export user/group data

pub mod types;
pub mod error;
pub mod client;
pub mod service;
pub mod users;
pub mod groups;
pub mod passwords;
pub mod shadow;
pub mod shells;
pub mod home;
pub mod sudoers;
pub mod quotas;
pub mod login_defs;
pub mod sessions;
pub mod bulk;
