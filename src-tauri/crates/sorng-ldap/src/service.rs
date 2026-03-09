use crate::error::LdapError;
use crate::types::LdapHost;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
pub type LdapServiceState = Arc<Mutex<LdapService>>;
pub struct LdapService {
    hosts: HashMap<String, LdapHost>,
}
impl LdapService {
    pub fn new() -> LdapServiceState {
        Arc::new(Mutex::new(Self {
            hosts: HashMap::new(),
        }))
    }
    pub fn add_host(&mut self, h: LdapHost) -> Result<(), LdapError> {
        if self.hosts.contains_key(&h.id) {
            return Err(LdapError::Other(format!("Host {} exists", h.id)));
        }
        self.hosts.insert(h.id.clone(), h);
        Ok(())
    }
    pub fn remove_host(&mut self, id: &str) -> Result<LdapHost, LdapError> {
        self.hosts
            .remove(id)
            .ok_or_else(|| LdapError::HostNotFound(id.into()))
    }
    pub fn get_host(&self, id: &str) -> Result<&LdapHost, LdapError> {
        self.hosts
            .get(id)
            .ok_or_else(|| LdapError::HostNotFound(id.into()))
    }
    pub fn list_hosts(&self) -> Vec<&LdapHost> {
        self.hosts.values().collect()
    }
}
