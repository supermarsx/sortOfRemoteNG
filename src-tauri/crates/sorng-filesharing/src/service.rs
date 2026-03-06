use crate::error::FileSharingError;
use crate::types::FileSharingHost;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

pub type FileSharingServiceState = Arc<Mutex<FileSharingService>>;
pub struct FileSharingService { hosts: HashMap<String, FileSharingHost> }
impl FileSharingService {
    pub fn new() -> FileSharingServiceState { Arc::new(Mutex::new(Self { hosts: HashMap::new() })) }
    pub fn add_host(&mut self, h: FileSharingHost) -> Result<(), FileSharingError> { if self.hosts.contains_key(&h.id) { return Err(FileSharingError::Other(format!("Host {} exists", h.id))); } self.hosts.insert(h.id.clone(), h); Ok(()) }
    pub fn remove_host(&mut self, id: &str) -> Result<FileSharingHost, FileSharingError> { self.hosts.remove(id).ok_or_else(|| FileSharingError::HostNotFound(id.into())) }
    pub fn get_host(&self, id: &str) -> Result<&FileSharingHost, FileSharingError> { self.hosts.get(id).ok_or_else(|| FileSharingError::HostNotFound(id.into())) }
    pub fn list_hosts(&self) -> Vec<&FileSharingHost> { self.hosts.values().collect() }
}
#[cfg(test)]
mod tests {
    use super::*; use chrono::Utc;
    fn th(id: &str) -> FileSharingHost { FileSharingHost { id: id.into(), name: id.into(), ssh: None, use_sudo: true, created_at: Utc::now(), updated_at: Utc::now() } }
    #[test] fn test_crud() { let s = FileSharingService::new(); let mut svc = s.blocking_lock(); svc.add_host(th("h1")).unwrap(); assert_eq!(svc.list_hosts().len(), 1); }
}
