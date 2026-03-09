//! Service façade for systemd management.

use crate::error::SystemdError;
use crate::types::SystemdHost;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

pub type SystemdServiceState = Arc<Mutex<SystemdService>>;

pub struct SystemdService {
    hosts: HashMap<String, SystemdHost>,
}

impl SystemdService {
    pub fn new() -> SystemdServiceState {
        Arc::new(Mutex::new(Self {
            hosts: HashMap::new(),
        }))
    }

    pub fn add_host(&mut self, host: SystemdHost) -> Result<(), SystemdError> {
        if self.hosts.contains_key(&host.id) {
            return Err(SystemdError::Other(format!(
                "Host {} already exists",
                host.id
            )));
        }
        self.hosts.insert(host.id.clone(), host);
        Ok(())
    }

    pub fn remove_host(&mut self, host_id: &str) -> Result<SystemdHost, SystemdError> {
        self.hosts
            .remove(host_id)
            .ok_or_else(|| SystemdError::HostNotFound(host_id.to_string()))
    }

    pub fn get_host(&self, host_id: &str) -> Result<&SystemdHost, SystemdError> {
        self.hosts
            .get(host_id)
            .ok_or_else(|| SystemdError::HostNotFound(host_id.to_string()))
    }

    pub fn list_hosts(&self) -> Vec<&SystemdHost> {
        self.hosts.values().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn test_host(id: &str) -> SystemdHost {
        SystemdHost {
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
        let state = SystemdService::new();
        let mut svc = state.blocking_lock();
        svc.add_host(test_host("h1")).unwrap();
        assert_eq!(svc.list_hosts().len(), 1);
        svc.remove_host("h1").unwrap();
        assert!(svc.list_hosts().is_empty());
    }
}
