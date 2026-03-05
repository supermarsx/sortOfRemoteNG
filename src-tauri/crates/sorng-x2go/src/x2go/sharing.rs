//! X2Go file sharing (SSHFS-based) and printing support.

use serde::{Deserialize, Serialize};

// ── File sharing ────────────────────────────────────────────────────────────

/// State of a shared folder mount.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MountState {
    /// Not mounted
    Unmounted,
    /// SSHFS mount in progress
    Mounting,
    /// Mounted and accessible
    Mounted,
    /// Mount failed
    Failed,
    /// Unmounting in progress
    Unmounting,
}

/// A tracked shared folder.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MountedFolder {
    /// Local path
    pub local_path: String,
    /// Remote mount point
    pub remote_path: String,
    /// Current mount state
    pub state: MountState,
    /// Error message if failed
    pub error: Option<String>,
    /// Auto-mount this folder on session start
    pub auto_mount: bool,
}

/// File sharing manager for an X2Go session.
pub struct FileSharingManager {
    pub session_id: String,
    pub mounts: Vec<MountedFolder>,
    pub sshfs_port: u16,
}

impl FileSharingManager {
    pub fn new(session_id: String, sshfs_port: u16) -> Self {
        Self {
            session_id,
            mounts: Vec::new(),
            sshfs_port,
        }
    }

    /// Add a folder to the share list.
    pub fn add_folder(&mut self, local_path: String, remote_name: String, auto_mount: bool) {
        self.mounts.push(MountedFolder {
            local_path,
            remote_path: format!("~/media/{}", remote_name),
            state: MountState::Unmounted,
            auto_mount,
            error: None,
        });
    }

    /// Build the SSHFS mount command for a folder.
    pub fn build_mount_command(&self, index: usize) -> Option<String> {
        let mount = self.mounts.get(index)?;
        Some(format!(
            "sshfs -o port={} -o idmap=user {}:{}",
            self.sshfs_port, mount.local_path, mount.remote_path
        ))
    }

    /// Mark a folder as mounted.
    pub fn mark_mounted(&mut self, index: usize) {
        if let Some(m) = self.mounts.get_mut(index) {
            m.state = MountState::Mounted;
            m.error = None;
        }
    }

    /// Mark a folder as failed.
    pub fn mark_failed(&mut self, index: usize, error: String) {
        if let Some(m) = self.mounts.get_mut(index) {
            m.state = MountState::Failed;
            m.error = Some(error);
        }
    }

    /// Mark a folder as unmounted.
    pub fn mark_unmounted(&mut self, index: usize) {
        if let Some(m) = self.mounts.get_mut(index) {
            m.state = MountState::Unmounted;
            m.error = None;
        }
    }

    /// List auto-mount folders.
    pub fn auto_mount_indices(&self) -> Vec<usize> {
        self.mounts
            .iter()
            .enumerate()
            .filter(|(_, m)| m.auto_mount && m.state == MountState::Unmounted)
            .map(|(i, _)| i)
            .collect()
    }

    /// Count mounted folders.
    pub fn mounted_count(&self) -> usize {
        self.mounts
            .iter()
            .filter(|m| m.state == MountState::Mounted)
            .count()
    }

    /// List all folders as JSON.
    pub fn list_folders(&self) -> Vec<serde_json::Value> {
        self.mounts
            .iter()
            .map(|m| {
                serde_json::json!({
                    "local_path": m.local_path,
                    "remote_path": m.remote_path,
                    "state": format!("{:?}", m.state),
                    "auto_mount": m.auto_mount,
                    "error": m.error,
                })
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn add_and_list_folders() {
        let mut mgr = FileSharingManager::new("sess-1".into(), 22);
        mgr.add_folder("/home/user/docs".into(), "documents".into(), true);
        mgr.add_folder("/tmp/shared".into(), "tmp".into(), false);
        assert_eq!(mgr.mounts.len(), 2);
        assert_eq!(mgr.auto_mount_indices(), vec![0]);
    }

    #[test]
    fn mount_lifecycle() {
        let mut mgr = FileSharingManager::new("sess-1".into(), 22);
        mgr.add_folder("/home/user".into(), "home".into(), true);

        assert_eq!(mgr.mounted_count(), 0);
        mgr.mark_mounted(0);
        assert_eq!(mgr.mounted_count(), 1);
        assert_eq!(mgr.mounts[0].state, MountState::Mounted);

        mgr.mark_unmounted(0);
        assert_eq!(mgr.mounted_count(), 0);
    }

    #[test]
    fn mount_command() {
        let mut mgr = FileSharingManager::new("sess-1".into(), 5300);
        mgr.add_folder("/data".into(), "data".into(), true);
        let cmd = mgr.build_mount_command(0).unwrap();
        assert!(cmd.contains("sshfs"));
        assert!(cmd.contains("5300"));
    }

    #[test]
    fn mark_failed() {
        let mut mgr = FileSharingManager::new("sess-1".into(), 22);
        mgr.add_folder("/nope".into(), "nope".into(), false);
        mgr.mark_failed(0, "permission denied".into());
        assert_eq!(mgr.mounts[0].state, MountState::Failed);
        assert_eq!(mgr.mounts[0].error.as_deref(), Some("permission denied"));
    }
}
