//! Service façade for syslog management.
use crate::error::SyslogError;
use crate::types::SyslogHost;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

pub type SyslogServiceState = Arc<Mutex<SyslogService>>;

pub struct SyslogService { hosts: HashMap<String, SyslogHost> }

impl SyslogService {
    pub fn new() -> SyslogServiceState { Arc::new(Mutex::new(Self { hosts: HashMap::new() })) }
    pub fn add_host(&mut self, h: SyslogHost) -> Result<(), SyslogError> {
        if self.hosts.contains_key(&h.id) { return Err(SyslogError::Other(format!("Host {} exists", h.id))); }
        self.hosts.insert(h.id.clone(), h); Ok(())
    }
    pub fn remove_host(&mut self, id: &str) -> Result<SyslogHost, SyslogError> { self.hosts.remove(id).ok_or_else(|| SyslogError::HostNotFound(id.into())) }
    pub fn get_host(&self, id: &str) -> Result<&SyslogHost, SyslogError> { self.hosts.get(id).ok_or_else(|| SyslogError::HostNotFound(id.into())) }
    pub fn list_hosts(&self) -> Vec<&SyslogHost> { self.hosts.values().collect() }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::SyslogBackend;
    use chrono::Utc;
    fn th(id: &str) -> SyslogHost { SyslogHost { id: id.into(), name: id.into(), ssh: None, use_sudo: true, backend: SyslogBackend::Rsyslog, created_at: Utc::now(), updated_at: Utc::now() } }
    #[test] fn test_crud() { let s = SyslogService::new(); let mut svc = s.blocking_lock(); svc.add_host(th("h1")).unwrap(); assert_eq!(svc.list_hosts().len(), 1); svc.remove_host("h1").unwrap(); assert!(svc.list_hosts().is_empty()); }
}
