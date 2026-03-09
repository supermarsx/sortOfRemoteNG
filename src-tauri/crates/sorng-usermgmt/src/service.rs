//! Service façade — manages multiple hosts and delegates user/group operations.

use crate::error::UserMgmtError;
use crate::types::UserMgmtHost;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Shared state type alias for Tauri.
pub type UserMgmtServiceState = Arc<Mutex<UserMgmtService>>;

/// Central service managing user/group operations across hosts.
pub struct UserMgmtService {
    hosts: HashMap<String, UserMgmtHost>,
}

impl UserMgmtService {
    pub fn new() -> UserMgmtServiceState {
        Arc::new(Mutex::new(Self {
            hosts: HashMap::new(),
        }))
    }

    pub fn add_host(&mut self, host: UserMgmtHost) -> Result<(), UserMgmtError> {
        if self.hosts.contains_key(&host.id) {
            return Err(UserMgmtError::Other(format!(
                "Host {} already exists",
                host.id
            )));
        }
        self.hosts.insert(host.id.clone(), host);
        Ok(())
    }

    pub fn update_host(&mut self, host: UserMgmtHost) -> Result<(), UserMgmtError> {
        if !self.hosts.contains_key(&host.id) {
            return Err(UserMgmtError::HostNotFound(host.id.clone()));
        }
        self.hosts.insert(host.id.clone(), host);
        Ok(())
    }

    pub fn remove_host(&mut self, host_id: &str) -> Result<UserMgmtHost, UserMgmtError> {
        self.hosts
            .remove(host_id)
            .ok_or_else(|| UserMgmtError::HostNotFound(host_id.to_string()))
    }

    pub fn get_host(&self, host_id: &str) -> Result<&UserMgmtHost, UserMgmtError> {
        self.hosts
            .get(host_id)
            .ok_or_else(|| UserMgmtError::HostNotFound(host_id.to_string()))
    }

    pub fn list_hosts(&self) -> Vec<&UserMgmtHost> {
        self.hosts.values().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::OsFamily;
    use chrono::Utc;

    fn test_host(id: &str) -> UserMgmtHost {
        UserMgmtHost {
            id: id.to_string(),
            name: format!("Test {id}"),
            ssh: None,
            use_sudo: true,
            os_family: OsFamily::Debian,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }

    #[test]
    fn test_add_and_list_hosts() {
        let state = UserMgmtService::new();
        let mut svc = state.blocking_lock();
        svc.add_host(test_host("h1")).unwrap();
        svc.add_host(test_host("h2")).unwrap();
        assert_eq!(svc.list_hosts().len(), 2);
    }

    #[test]
    fn test_duplicate_host_rejected() {
        let state = UserMgmtService::new();
        let mut svc = state.blocking_lock();
        svc.add_host(test_host("h1")).unwrap();
        assert!(svc.add_host(test_host("h1")).is_err());
    }

    #[test]
    fn test_remove_host() {
        let state = UserMgmtService::new();
        let mut svc = state.blocking_lock();
        svc.add_host(test_host("h1")).unwrap();
        let removed = svc.remove_host("h1").unwrap();
        assert_eq!(removed.id, "h1");
        assert!(svc.list_hosts().is_empty());
    }
}
