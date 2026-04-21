//! Service façade — manages multiple fail2ban hosts and delegates operations.

use crate::error::Fail2banError;
use crate::types::{Fail2banHost, Fail2banStats, Jail};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Shared state type alias for Tauri.
pub type Fail2banServiceState = Arc<Mutex<Fail2banService>>;

/// Central service managing multiple fail2ban hosts.
pub struct Fail2banService {
    hosts: HashMap<String, Fail2banHost>,
}

impl Fail2banService {
    /// Create a new service with empty state.
    pub fn new() -> Fail2banServiceState {
        Arc::new(Mutex::new(Self {
            hosts: HashMap::new(),
        }))
    }

    // ─── Host Management ────────────────────────────────────────────

    /// Register a new host.
    pub fn add_host(&mut self, host: Fail2banHost) -> Result<(), Fail2banError> {
        if self.hosts.contains_key(&host.id) {
            return Err(Fail2banError::ConfigError(format!(
                "Host {} already exists",
                host.id
            )));
        }
        self.hosts.insert(host.id.clone(), host);
        Ok(())
    }

    /// Update an existing host.
    pub fn update_host(&mut self, host: Fail2banHost) -> Result<(), Fail2banError> {
        if !self.hosts.contains_key(&host.id) {
            return Err(Fail2banError::HostNotFound(host.id.clone()));
        }
        self.hosts.insert(host.id.clone(), host);
        Ok(())
    }

    /// Remove a host.
    pub fn remove_host(&mut self, host_id: &str) -> Result<Fail2banHost, Fail2banError> {
        self.hosts
            .remove(host_id)
            .ok_or_else(|| Fail2banError::HostNotFound(host_id.to_string()))
    }

    /// Get a host by ID.
    pub fn get_host(&self, host_id: &str) -> Result<&Fail2banHost, Fail2banError> {
        self.hosts
            .get(host_id)
            .ok_or_else(|| Fail2banError::HostNotFound(host_id.to_string()))
    }

    /// Clone a host by ID (for use outside the lock).
    pub fn clone_host(&self, host_id: &str) -> Result<Fail2banHost, Fail2banError> {
        self.get_host(host_id).cloned()
    }

    /// List all registered hosts.
    pub fn list_hosts(&self) -> Vec<Fail2banHost> {
        self.hosts.values().cloned().collect()
    }

    /// List hosts filtered by tags.
    pub fn list_hosts_by_tag(&self, tag: &str) -> Vec<Fail2banHost> {
        self.hosts
            .values()
            .filter(|h| h.tags.iter().any(|t| t == tag))
            .cloned()
            .collect()
    }
}

// ─── Async operations (operate outside the lock) ────────────────────

/// Ping a host to check if fail2ban is reachable.
pub async fn ping_host(host: &Fail2banHost) -> Result<bool, Fail2banError> {
    crate::client::ping(host).await
}

/// Get fail2ban version on a host.
pub async fn host_version(host: &Fail2banHost) -> Result<String, Fail2banError> {
    crate::client::version(host).await
}

/// Get full server status for a host.
pub async fn host_server_status(host: &Fail2banHost) -> Result<String, Fail2banError> {
    crate::client::server_status(host).await
}

/// List jails on a host.
pub async fn host_jails(host: &Fail2banHost) -> Result<Vec<String>, Fail2banError> {
    crate::jails::list_jails(host).await
}

/// Get jail details on a host.
pub async fn host_jail_status(host: &Fail2banHost, jail_name: &str) -> Result<Jail, Fail2banError> {
    crate::jails::jail_status(host, jail_name).await
}

/// Get full statistics for a host.
pub async fn host_full_stats(host: &Fail2banHost) -> Result<Fail2banStats, Fail2banError> {
    crate::stats::host_stats(host).await
}

/// Reload fail2ban on a host.
pub async fn host_reload(host: &Fail2banHost) -> Result<(), Fail2banError> {
    crate::client::reload(host).await
}

/// Ban an IP in a jail on a host.
pub async fn host_ban_ip(
    host: &Fail2banHost,
    jail_name: &str,
    ip: &str,
) -> Result<(), Fail2banError> {
    crate::bans::ban_ip(host, jail_name, ip).await
}

/// Unban an IP from a jail on a host.
pub async fn host_unban_ip(
    host: &Fail2banHost,
    jail_name: &str,
    ip: &str,
) -> Result<(), Fail2banError> {
    crate::bans::unban_ip(host, jail_name, ip).await
}

/// Unban an IP from all jails on a host.
pub async fn host_unban_ip_all(host: &Fail2banHost, ip: &str) -> Result<(), Fail2banError> {
    crate::bans::unban_ip_all(host, ip).await.map(|_| ())
}

/// Get log entries from a host.
pub async fn host_log_tail(
    host: &Fail2banHost,
    lines: u32,
) -> Result<Vec<crate::types::LogEntry>, Fail2banError> {
    crate::logs::tail_log(host, lines, None).await
}
