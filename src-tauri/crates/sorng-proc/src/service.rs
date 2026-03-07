//! Service façade for process management — host CRUD.

use crate::error::ProcError;
use crate::types::ProcHost;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

pub type ProcServiceState = Arc<Mutex<ProcService>>;

pub struct ProcService {
    hosts: HashMap<String, ProcHost>,
}

impl ProcService {
    pub fn new() -> ProcServiceState {
        Arc::new(Mutex::new(Self { hosts: HashMap::new() }))
    }

    pub fn add_host(&mut self, host: ProcHost) -> Result<(), ProcError> {
        if self.hosts.contains_key(&host.id) {
            return Err(ProcError::Other(format!("Host {} already exists", host.id)));
        }
        self.hosts.insert(host.id.clone(), host);
        Ok(())
    }

    pub fn remove_host(&mut self, host_id: &str) -> Result<ProcHost, ProcError> {
        self.hosts
            .remove(host_id)
            .ok_or_else(|| ProcError::HostNotFound(host_id.to_string()))
    }

    pub fn get_host(&self, host_id: &str) -> Result<&ProcHost, ProcError> {
        self.hosts
            .get(host_id)
            .ok_or_else(|| ProcError::HostNotFound(host_id.to_string()))
    }

    pub fn update_host(&mut self, host: ProcHost) -> Result<(), ProcError> {
        if !self.hosts.contains_key(&host.id) {
            return Err(ProcError::HostNotFound(host.id.clone()));
        }
        self.hosts.insert(host.id.clone(), host);
        Ok(())
    }

    pub fn list_hosts(&self) -> Vec<&ProcHost> {
        self.hosts.values().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn test_host(id: &str) -> ProcHost {
        ProcHost {
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
        let state = ProcService::new();
        let mut svc = state.blocking_lock();

        svc.add_host(test_host("h1")).unwrap();
        svc.add_host(test_host("h2")).unwrap();
        assert_eq!(svc.list_hosts().len(), 2);

        assert!(svc.get_host("h1").is_ok());
        assert_eq!(svc.get_host("h1").unwrap().name, "Test h1");

        // Duplicate add should fail.
        assert!(svc.add_host(test_host("h1")).is_err());

        // Update existing.
        let mut updated = test_host("h1");
        updated.name = "Updated h1".into();
        svc.update_host(updated).unwrap();
        assert_eq!(svc.get_host("h1").unwrap().name, "Updated h1");

        // Update nonexistent should fail.
        assert!(svc.update_host(test_host("h999")).is_err());

        // Remove.
        let removed = svc.remove_host("h1").unwrap();
        assert_eq!(removed.id, "h1");
        assert_eq!(svc.list_hosts().len(), 1);

        // Remove nonexistent should fail.
        assert!(svc.remove_host("h1").is_err());

        // Get nonexistent should fail.
        assert!(svc.get_host("h999").is_err());
    }
}
