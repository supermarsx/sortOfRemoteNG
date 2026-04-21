//! Service façade for bootloader management.

use crate::error::BootloaderError;
use crate::types::BootloaderHost;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

pub type BootloaderServiceState = Arc<Mutex<BootloaderService>>;

pub struct BootloaderService {
    hosts: HashMap<String, BootloaderHost>,
}

impl BootloaderService {
    pub fn new() -> BootloaderServiceState {
        Arc::new(Mutex::new(Self {
            hosts: HashMap::new(),
        }))
    }

    pub fn add_host(&mut self, h: BootloaderHost) -> Result<(), BootloaderError> {
        if self.hosts.contains_key(&h.id) {
            return Err(BootloaderError::Other(format!(
                "Host {} already exists",
                h.id
            )));
        }
        self.hosts.insert(h.id.clone(), h);
        Ok(())
    }

    pub fn remove_host(&mut self, id: &str) -> Result<BootloaderHost, BootloaderError> {
        self.hosts
            .remove(id)
            .ok_or_else(|| BootloaderError::HostNotFound(id.into()))
    }

    pub fn get_host(&self, id: &str) -> Result<&BootloaderHost, BootloaderError> {
        self.hosts
            .get(id)
            .ok_or_else(|| BootloaderError::HostNotFound(id.into()))
    }

    pub fn list_hosts(&self) -> Vec<&BootloaderHost> {
        self.hosts.values().collect()
    }

    pub fn update_host(&mut self, h: BootloaderHost) -> Result<(), BootloaderError> {
        if !self.hosts.contains_key(&h.id) {
            return Err(BootloaderError::HostNotFound(h.id.clone()));
        }
        self.hosts.insert(h.id.clone(), h);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn make_host(id: &str) -> BootloaderHost {
        BootloaderHost {
            id: id.into(),
            name: id.into(),
            ssh: None,
            use_sudo: true,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }

    #[test]
    fn test_add_and_list() {
        let state = BootloaderService::new();
        let mut svc = state.blocking_lock();
        svc.add_host(make_host("h1")).unwrap();
        svc.add_host(make_host("h2")).unwrap();
        assert_eq!(svc.list_hosts().len(), 2);
    }

    #[test]
    fn test_duplicate_host() {
        let state = BootloaderService::new();
        let mut svc = state.blocking_lock();
        svc.add_host(make_host("h1")).unwrap();
        assert!(svc.add_host(make_host("h1")).is_err());
    }

    #[test]
    fn test_remove_host() {
        let state = BootloaderService::new();
        let mut svc = state.blocking_lock();
        svc.add_host(make_host("h1")).unwrap();
        let removed = svc.remove_host("h1").unwrap();
        assert_eq!(removed.id, "h1");
        assert!(svc.remove_host("h1").is_err());
    }

    #[test]
    fn test_get_host() {
        let state = BootloaderService::new();
        let mut svc = state.blocking_lock();
        svc.add_host(make_host("web1")).unwrap();
        let host = svc.get_host("web1").unwrap();
        assert_eq!(host.name, "web1");
        assert!(svc.get_host("missing").is_err());
    }

    #[test]
    fn test_update_host() {
        let state = BootloaderService::new();
        let mut svc = state.blocking_lock();
        svc.add_host(make_host("h1")).unwrap();
        let mut updated = make_host("h1");
        updated.name = "updated-name".into();
        svc.update_host(updated).unwrap();
        assert_eq!(svc.get_host("h1").unwrap().name, "updated-name");
    }

    #[test]
    fn test_update_nonexistent_host() {
        let state = BootloaderService::new();
        let mut svc = state.blocking_lock();
        assert!(svc.update_host(make_host("missing")).is_err());
    }
}
