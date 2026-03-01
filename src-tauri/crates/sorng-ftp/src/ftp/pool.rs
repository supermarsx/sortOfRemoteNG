//! Connection pool — manages multiple `FtpClient` sessions keyed by id.
//! Provides idle reaping and keepalive NOOP scheduling.

use crate::ftp::client::FtpClient;
use crate::ftp::error::{FtpError, FtpResult};
use crate::ftp::types::*;
use chrono::Utc;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio::time::{self, Duration};

/// Thread-safe pool of FTP sessions.
pub struct FtpPool {
    pub sessions: HashMap<String, FtpClient>,
    /// Maximum number of concurrent sessions (0 = unlimited).
    pub max_sessions: usize,
    /// Idle timeout in seconds. Connections idle longer are reaped.
    pub idle_timeout_sec: u64,
}

impl FtpPool {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
            max_sessions: 0,
            idle_timeout_sec: 300,
        }
    }

    pub fn with_limits(max_sessions: usize, idle_timeout_sec: u64) -> Self {
        Self {
            sessions: HashMap::new(),
            max_sessions,
            idle_timeout_sec,
        }
    }

    /// Insert a connected client into the pool.
    pub fn insert(&mut self, client: FtpClient) -> FtpResult<String> {
        if self.max_sessions > 0 && self.sessions.len() >= self.max_sessions {
            return Err(FtpError::pool_exhausted(format!(
                "Pool limit reached ({})",
                self.max_sessions
            )));
        }
        let id = client.id.clone();
        self.sessions.insert(id.clone(), client);
        Ok(id)
    }

    /// Retrieve a mutable reference to a session.
    pub fn get_mut(&mut self, id: &str) -> FtpResult<&mut FtpClient> {
        self.sessions
            .get_mut(id)
            .ok_or_else(|| FtpError::session_not_found(id))
    }

    /// Retrieve an immutable reference.
    pub fn get(&self, id: &str) -> FtpResult<&FtpClient> {
        self.sessions
            .get(id)
            .ok_or_else(|| FtpError::session_not_found(id))
    }

    /// Remove and return a session.
    pub fn remove(&mut self, id: &str) -> Option<FtpClient> {
        self.sessions.remove(id)
    }

    /// List all session infos.
    pub fn list_sessions(&self) -> Vec<FtpSessionInfo> {
        self.sessions.values().map(|c| c.info.clone()).collect()
    }

    /// Get pool statistics.
    pub fn stats(&self) -> PoolStats {
        let active = self.sessions.values().filter(|c| c.is_connected()).count() as u32;
        PoolStats {
            total_sessions: self.sessions.len() as u32,
            active_sessions: active,
            idle_sessions: self.sessions.len() as u32 - active,
            max_sessions: self.max_sessions as u32,
        }
    }

    /// Reap sessions that have been idle beyond `idle_timeout_sec`.
    pub async fn reap_idle(&mut self) {
        let cutoff =
            Utc::now() - chrono::Duration::seconds(self.idle_timeout_sec as i64);
        let mut to_remove = Vec::new();

        for (id, client) in &self.sessions {
            if client.info.last_activity < cutoff {
                to_remove.push(id.clone());
            }
        }

        for id in &to_remove {
            if let Some(mut client) = self.sessions.remove(id) {
                let _ = client.quit().await;
            }
        }

        if !to_remove.is_empty() {
            log::info!("FTP pool: reaped {} idle sessions", to_remove.len());
        }
    }

    /// Send NOOP to all connected sessions (keepalive).
    pub async fn keepalive_all(&mut self) {
        for client in self.sessions.values_mut() {
            if client.is_connected() {
                let _ = client.noop().await;
            }
        }
    }

    /// Disconnect and remove all sessions.
    pub async fn disconnect_all(&mut self) {
        let ids: Vec<String> = self.sessions.keys().cloned().collect();
        for id in ids {
            if let Some(mut client) = self.sessions.remove(&id) {
                let _ = client.quit().await;
            }
        }
    }
}

/// Spawn a background task that periodically reaps idle connections and
/// sends keepalive NOOPs.
pub fn spawn_pool_maintenance(
    pool: Arc<Mutex<FtpPool>>,
    interval_secs: u64,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut ticker = time::interval(Duration::from_secs(interval_secs));
        loop {
            ticker.tick().await;
            let mut guard = pool.lock().await;
            guard.reap_idle().await;
            guard.keepalive_all().await;
        }
    })
}
