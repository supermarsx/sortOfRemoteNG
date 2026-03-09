//! Service façade for DHCP management.
use crate::error::DhcpError;
use crate::types::DhcpHost;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

pub type DhcpServiceState = Arc<Mutex<DhcpService>>;
pub struct DhcpService {
    hosts: HashMap<String, DhcpHost>,
}
impl DhcpService {
    pub fn new() -> DhcpServiceState {
        Arc::new(Mutex::new(Self {
            hosts: HashMap::new(),
        }))
    }
    pub fn add_host(&mut self, h: DhcpHost) -> Result<(), DhcpError> {
        if self.hosts.contains_key(&h.id) {
            return Err(DhcpError::Other(format!("Host {} exists", h.id)));
        }
        self.hosts.insert(h.id.clone(), h);
        Ok(())
    }
    pub fn remove_host(&mut self, id: &str) -> Result<DhcpHost, DhcpError> {
        self.hosts
            .remove(id)
            .ok_or_else(|| DhcpError::HostNotFound(id.into()))
    }
    pub fn get_host(&self, id: &str) -> Result<&DhcpHost, DhcpError> {
        self.hosts
            .get(id)
            .ok_or_else(|| DhcpError::HostNotFound(id.into()))
    }
    pub fn list_hosts(&self) -> Vec<&DhcpHost> {
        self.hosts.values().collect()
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::DhcpBackend;
    use chrono::Utc;
    fn th(id: &str) -> DhcpHost {
        DhcpHost {
            id: id.into(),
            name: id.into(),
            ssh: None,
            use_sudo: true,
            backend: DhcpBackend::IscDhcpd,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }
    #[test]
    fn test_crud() {
        let s = DhcpService::new();
        let mut svc = s.blocking_lock();
        svc.add_host(th("h1")).unwrap();
        assert_eq!(svc.list_hosts().len(), 1);
        svc.remove_host("h1").unwrap();
    }
}
