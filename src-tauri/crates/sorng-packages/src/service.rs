use crate::error::PkgError;
use crate::types::PkgHost;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
pub type PkgServiceState = Arc<Mutex<PkgService>>;
pub struct PkgService {
    hosts: HashMap<String, PkgHost>,
}
impl PkgService {
    pub fn new() -> PkgServiceState {
        Arc::new(Mutex::new(Self {
            hosts: HashMap::new(),
        }))
    }
    pub fn add_host(&mut self, h: PkgHost) -> Result<(), PkgError> {
        if self.hosts.contains_key(&h.id) {
            return Err(PkgError::Other(format!("Host {} exists", h.id)));
        }
        self.hosts.insert(h.id.clone(), h);
        Ok(())
    }
    pub fn remove_host(&mut self, id: &str) -> Result<PkgHost, PkgError> {
        self.hosts
            .remove(id)
            .ok_or_else(|| PkgError::HostNotFound(id.into()))
    }
    pub fn get_host(&self, id: &str) -> Result<&PkgHost, PkgError> {
        self.hosts
            .get(id)
            .ok_or_else(|| PkgError::HostNotFound(id.into()))
    }
    pub fn list_hosts(&self) -> Vec<&PkgHost> {
        self.hosts.values().collect()
    }
}
