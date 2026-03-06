//! # sorng-remote-backup
//!
//! SSH-based remote backup, sync, and replication engine for SortOfRemote NG.
//!
//! Integrates rsync, rclone, restic, borg, sftp, scp, unison, and duplicity
//! with scheduling, progress tracking, bandwidth limiting, integrity
//! verification, retention policies, and multi-host orchestration.
//!
//! | Module       | Purpose                                                  |
//! |--------------|----------------------------------------------------------|
//! | `types`      | Data types, enums, tool configs, job definitions         |
//! | `error`      | Error types for backup operations                        |
//! | `rsync`      | rsync wrapper: argument building, output parsing          |
//! | `rclone`     | rclone wrapper: remotes, sync/copy/mount, bandwidth      |
//! | `restic`     | restic wrapper: repos, snapshots, backup, restore, prune |
//! | `borg`       | borg wrapper: repos, archives, create, extract, prune    |
//! | `sftp`       | SFTP bulk transfer engine with resume support             |
//! | `scp`        | SCP file/directory transfer                               |
//! | `unison`     | Unison bi-directional sync profile management            |
//! | `duplicity`  | duplicity encrypted incremental backup wrapper           |
//! | `integrity`  | Checksum verification, manifest comparison               |
//! | `retention`  | Retention policy engine (count, age, tiered)             |
//! | `progress`   | Progress tracking, bandwidth measurement, ETA             |
//! | `scheduler`  | Backup schedule management and cron integration          |
//! | `service`    | Service façade (`RemoteBackupServiceState`)               |
//! | `commands`   | Tauri `#[command]` handlers                               |

pub mod types;
pub mod error;
pub mod rsync;
pub mod rclone;
pub mod restic;
pub mod borg;
pub mod sftp;
pub mod scp;
pub mod unison;
pub mod duplicity;
pub mod integrity;
pub mod retention;
pub mod progress;
pub mod scheduler;
pub mod service;
pub mod commands;
