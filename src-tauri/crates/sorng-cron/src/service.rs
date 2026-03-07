//! Service façade for cron/at/anacron management.

use crate::error::CronError;
use crate::types::CronHost;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

pub type CronServiceState = Arc<Mutex<CronService>>;

pub struct CronService {
    hosts: HashMap<String, CronHost>,
}

impl CronService {
    pub fn new() -> CronServiceState {
        Arc::new(Mutex::new(Self {
            hosts: HashMap::new(),
        }))
    }

    // ─── Host CRUD ──────────────────────────────────────────────────

    pub fn add_host(&mut self, host: CronHost) -> Result<(), CronError> {
        if self.hosts.contains_key(&host.id) {
            return Err(CronError::Other(format!(
                "Host {} already exists",
                host.id
            )));
        }
        self.hosts.insert(host.id.clone(), host);
        Ok(())
    }

    pub fn remove_host(&mut self, host_id: &str) -> Result<CronHost, CronError> {
        self.hosts
            .remove(host_id)
            .ok_or_else(|| CronError::HostNotFound(host_id.to_string()))
    }

    pub fn get_host(&self, host_id: &str) -> Result<&CronHost, CronError> {
        self.hosts
            .get(host_id)
            .ok_or_else(|| CronError::HostNotFound(host_id.to_string()))
    }

    pub fn list_hosts(&self) -> Vec<&CronHost> {
        self.hosts.values().collect()
    }

    pub fn update_host(&mut self, host: CronHost) -> Result<(), CronError> {
        if !self.hosts.contains_key(&host.id) {
            return Err(CronError::HostNotFound(host.id.clone()));
        }
        self.hosts.insert(host.id.clone(), host);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn test_host(id: &str) -> CronHost {
        CronHost {
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
        let state = CronService::new();
        let mut svc = state.blocking_lock();

        svc.add_host(test_host("h1")).unwrap();
        assert_eq!(svc.list_hosts().len(), 1);

        svc.add_host(test_host("h2")).unwrap();
        assert_eq!(svc.list_hosts().len(), 2);

        assert!(svc.get_host("h1").is_ok());
        assert!(svc.get_host("nonexistent").is_err());

        svc.remove_host("h1").unwrap();
        assert_eq!(svc.list_hosts().len(), 1);
        assert!(svc.remove_host("h1").is_err());
    }

    #[test]
    fn test_duplicate_host() {
        let state = CronService::new();
        let mut svc = state.blocking_lock();
        svc.add_host(test_host("h1")).unwrap();
        assert!(svc.add_host(test_host("h1")).is_err());
    }

    #[test]
    fn test_update_host() {
        let state = CronService::new();
        let mut svc = state.blocking_lock();

        svc.add_host(test_host("h1")).unwrap();

        let mut updated = test_host("h1");
        updated.name = "Updated Host".into();
        svc.update_host(updated).unwrap();

        assert_eq!(svc.get_host("h1").unwrap().name, "Updated Host");
        assert!(svc.update_host(test_host("nonexistent")).is_err());
    }
}
