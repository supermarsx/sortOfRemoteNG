//! Service façade for disk management.
use crate::error::DiskError;
use crate::types::DiskHost;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

pub type DiskServiceState = Arc<Mutex<DiskService>>;
pub struct DiskService { hosts: HashMap<String, DiskHost> }
impl DiskService {
    pub fn new() -> DiskServiceState { Arc::new(Mutex::new(Self { hosts: HashMap::new() })) }
    pub fn add_host(&mut self, h: DiskHost) -> Result<(), DiskError> {
        if self.hosts.contains_key(&h.id) { return Err(DiskError::Other(format!("Host {} exists", h.id))); }
        self.hosts.insert(h.id.clone(), h); Ok(())
    }
    pub fn remove_host(&mut self, id: &str) -> Result<DiskHost, DiskError> { self.hosts.remove(id).ok_or_else(|| DiskError::HostNotFound(id.into())) }
    pub fn get_host(&self, id: &str) -> Result<&DiskHost, DiskError> { self.hosts.get(id).ok_or_else(|| DiskError::HostNotFound(id.into())) }
    pub fn list_hosts(&self) -> Vec<&DiskHost> { self.hosts.values().collect() }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    fn th(id: &str) -> DiskHost { DiskHost { id: id.into(), name: id.into(), ssh: None, use_sudo: true, created_at: Utc::now(), updated_at: Utc::now() } }
    #[test] fn test_crud() { let s = DiskService::new(); let mut svc = s.blocking_lock(); svc.add_host(th("h1")).unwrap(); assert_eq!(svc.list_hosts().len(), 1); svc.remove_host("h1").unwrap(); assert!(svc.list_hosts().is_empty()); }
}
