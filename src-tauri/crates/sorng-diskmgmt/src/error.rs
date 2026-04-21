//! Error types for disk management.
use std::fmt;

#[derive(Debug)]
pub enum DiskError {
    CommandNotFound(String),
    CommandFailed {
        command: String,
        exit_code: i32,
        stderr: String,
    },
    SshError(String),
    HostNotFound(String),
    DeviceNotFound(String),
    DeviceBusy(String),
    FilesystemError(String),
    MountError(String),
    PartitionError(String),
    LvmError(String),
    ZfsError(String),
    RaidError(String),
    PermissionDenied(String),
    IoError(String),
    JsonError(String),
    ParseError(String),
    Other(String),
}

impl fmt::Display for DiskError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::CommandNotFound(c) => write!(f, "Command not found: {c}"),
            Self::CommandFailed {
                command,
                exit_code,
                stderr,
            } => write!(f, "`{command}` failed (exit {exit_code}): {stderr}"),
            Self::SshError(e) => write!(f, "SSH: {e}"),
            Self::HostNotFound(h) => write!(f, "Host not found: {h}"),
            Self::DeviceNotFound(d) => write!(f, "Device not found: {d}"),
            Self::DeviceBusy(d) => write!(f, "Device busy: {d}"),
            Self::FilesystemError(e) => write!(f, "Filesystem: {e}"),
            Self::MountError(e) => write!(f, "Mount: {e}"),
            Self::PartitionError(e) => write!(f, "Partition: {e}"),
            Self::LvmError(e) => write!(f, "LVM: {e}"),
            Self::ZfsError(e) => write!(f, "ZFS: {e}"),
            Self::RaidError(e) => write!(f, "RAID: {e}"),
            Self::PermissionDenied(e) => write!(f, "Permission denied: {e}"),
            Self::IoError(e) => write!(f, "I/O: {e}"),
            Self::JsonError(e) => write!(f, "JSON: {e}"),
            Self::ParseError(e) => write!(f, "Parse: {e}"),
            Self::Other(e) => write!(f, "{e}"),
        }
    }
}
impl std::error::Error for DiskError {}
impl From<std::io::Error> for DiskError {
    fn from(e: std::io::Error) -> Self {
        Self::IoError(e.to_string())
    }
}
impl From<serde_json::Error> for DiskError {
    fn from(e: serde_json::Error) -> Self {
        Self::JsonError(e.to_string())
    }
}
