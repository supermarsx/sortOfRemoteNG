//! Service façade for kernel management — host CRUD.

use crate::error::KernelError;
use crate::types::KernelHost;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

pub type KernelServiceState = Arc<Mutex<KernelService>>;

pub struct KernelService {
    hosts: HashMap<String, KernelHost>,
}

impl KernelService {
    pub fn new() -> KernelServiceState {
        Arc::new(Mutex::new(Self {
            hosts: HashMap::new(),
        }))
    }

    pub fn add_host(&mut self, host: KernelHost) -> Result<(), KernelError> {
        if self.hosts.contains_key(&host.id) {
            return Err(KernelError::Other(format!(
                "Host {} already exists",
                host.id
            )));
        }
        self.hosts.insert(host.id.clone(), host);
        Ok(())
    }

    pub fn update_host(&mut self, host: KernelHost) -> Result<(), KernelError> {
        if !self.hosts.contains_key(&host.id) {
            return Err(KernelError::HostNotFound(host.id.clone()));
        }
        self.hosts.insert(host.id.clone(), host);
        Ok(())
    }

    pub fn remove_host(&mut self, host_id: &str) -> Result<KernelHost, KernelError> {
        self.hosts
            .remove(host_id)
            .ok_or_else(|| KernelError::HostNotFound(host_id.to_string()))
    }

    pub fn get_host(&self, host_id: &str) -> Result<&KernelHost, KernelError> {
        self.hosts
            .get(host_id)
            .ok_or_else(|| KernelError::HostNotFound(host_id.to_string()))
    }

    pub fn list_hosts(&self) -> Vec<&KernelHost> {
        self.hosts.values().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn test_host(id: &str) -> KernelHost {
        KernelHost {
            id: id.into(),
            name: format!("Test {id}"),
            ssh: None,
            use_sudo: true,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }

    #[test]
    fn test_host_crud() {
        let state = KernelService::new();
        let mut svc = state.blocking_lock();
        svc.add_host(test_host("h1")).unwrap();
        assert_eq!(svc.list_hosts().len(), 1);
        assert!(svc.get_host("h1").is_ok());
        assert!(svc.get_host("nope").is_err());
        svc.remove_host("h1").unwrap();
        assert!(svc.list_hosts().is_empty());
    }

    #[test]
    fn test_duplicate_host() {
        let state = KernelService::new();
        let mut svc = state.blocking_lock();
        svc.add_host(test_host("h1")).unwrap();
        assert!(svc.add_host(test_host("h1")).is_err());
    }

    #[test]
    fn test_update_host() {
        let state = KernelService::new();
        let mut svc = state.blocking_lock();
        svc.add_host(test_host("h1")).unwrap();
        let mut updated = test_host("h1");
        updated.name = "Updated".into();
        svc.update_host(updated).unwrap();
        assert_eq!(svc.get_host("h1").unwrap().name, "Updated");
    }

    #[test]
    fn test_update_nonexistent() {
        let state = KernelService::new();
        let mut svc = state.blocking_lock();
        assert!(svc.update_host(test_host("nope")).is_err());
    }
}
