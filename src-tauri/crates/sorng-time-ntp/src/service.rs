//! Service façade for time / NTP management — hosts CRUD, delegation.
use crate::error::TimeNtpError;
use crate::types::TimeHost;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

pub type TimeNtpServiceState = Arc<Mutex<TimeNtpService>>;

pub struct TimeNtpService {
    hosts: HashMap<String, TimeHost>,
}

impl TimeNtpService {
    pub fn new() -> TimeNtpServiceState {
        Arc::new(Mutex::new(Self { hosts: HashMap::new() }))
    }

    pub fn add_host(&mut self, h: TimeHost) -> Result<(), TimeNtpError> {
        if self.hosts.contains_key(&h.id) {
            return Err(TimeNtpError::Other(format!("Host {} already exists", h.id)));
        }
        self.hosts.insert(h.id.clone(), h);
        Ok(())
    }

    pub fn update_host(&mut self, h: TimeHost) -> Result<(), TimeNtpError> {
        if !self.hosts.contains_key(&h.id) {
            return Err(TimeNtpError::HostNotFound(h.id.clone()));
        }
        self.hosts.insert(h.id.clone(), h);
        Ok(())
    }

    pub fn remove_host(&mut self, id: &str) -> Result<TimeHost, TimeNtpError> {
        self.hosts.remove(id).ok_or_else(|| TimeNtpError::HostNotFound(id.into()))
    }

    pub fn get_host(&self, id: &str) -> Result<&TimeHost, TimeNtpError> {
        self.hosts.get(id).ok_or_else(|| TimeNtpError::HostNotFound(id.into()))
    }

    pub fn list_hosts(&self) -> Vec<&TimeHost> {
        self.hosts.values().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn make_host(id: &str) -> TimeHost {
        TimeHost {
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
        let state = TimeNtpService::new();
        let mut svc = state.blocking_lock();
        svc.add_host(make_host("h1")).unwrap();
        svc.add_host(make_host("h2")).unwrap();
        assert_eq!(svc.list_hosts().len(), 2);
    }

    #[test]
    fn test_add_duplicate() {
        let state = TimeNtpService::new();
        let mut svc = state.blocking_lock();
        svc.add_host(make_host("h1")).unwrap();
        assert!(svc.add_host(make_host("h1")).is_err());
    }

    #[test]
    fn test_remove() {
        let state = TimeNtpService::new();
        let mut svc = state.blocking_lock();
        svc.add_host(make_host("h1")).unwrap();
        let removed = svc.remove_host("h1").unwrap();
        assert_eq!(removed.id, "h1");
        assert_eq!(svc.list_hosts().len(), 0);
    }

    #[test]
    fn test_remove_missing() {
        let state = TimeNtpService::new();
        let mut svc = state.blocking_lock();
        assert!(svc.remove_host("nope").is_err());
    }

    #[test]
    fn test_get_host() {
        let state = TimeNtpService::new();
        let mut svc = state.blocking_lock();
        svc.add_host(make_host("h1")).unwrap();
        assert_eq!(svc.get_host("h1").unwrap().name, "h1");
        assert!(svc.get_host("nope").is_err());
    }

    #[test]
    fn test_update_host() {
        let state = TimeNtpService::new();
        let mut svc = state.blocking_lock();
        svc.add_host(make_host("h1")).unwrap();
        let mut updated = make_host("h1");
        updated.name = "updated".into();
        svc.update_host(updated).unwrap();
        assert_eq!(svc.get_host("h1").unwrap().name, "updated");
    }

    #[test]
    fn test_update_missing() {
        let state = TimeNtpService::new();
        let mut svc = state.blocking_lock();
        assert!(svc.update_host(make_host("nope")).is_err());
    }
}
