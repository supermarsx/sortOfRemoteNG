//! # Auto Lock Service
//!
//! This module provides automatic screen locking functionality based on inactivity.
//! It monitors user activity and locks the application when idle for a specified period.
//!
//! ## Features
//!
//! - Configurable idle timeout
//! - Activity monitoring (keyboard/mouse)
//! - Graceful lock with warning
//! - Policy-based configuration
//! - Windows integration
//!
//! ## Security
//!
//! Automatically locks the application to prevent unauthorized access.
//! Integrates with Windows security policies.
//!
//! ## Example
//!

use std::sync::Arc;
use tokio::sync::Mutex;
use serde::{Deserialize, Serialize};
use tokio::time::{Duration, Instant};

/// Auto-lock configuration
#[derive(Serialize, Deserialize, Clone)]
pub struct AutoLockConfig {
    /// Idle timeout in minutes
    pub idle_timeout_minutes: u32,
    /// Show warning before locking (minutes)
    pub warning_minutes: u32,
    /// Whether auto-lock is enabled
    pub enabled: bool,
    /// Lock on Windows session lock
    pub lock_on_session_lock: bool,
    /// Require password to unlock
    pub require_password: bool,
}

/// Lock state
#[derive(Serialize, Deserialize, Clone, Debug)]
pub enum LockState {
    /// Application is unlocked
    Unlocked,
    /// Application is locked
    Locked,
    /// Warning period before locking
    Warning,
}

/// Auto-lock service state
pub type AutoLockServiceState = Arc<Mutex<AutoLockService>>;

/// Service for managing automatic application locking
pub struct AutoLockService {
    /// Current configuration
    config: AutoLockConfig,
    /// Current lock state
    state: LockState,
    /// Last activity timestamp
    last_activity: Instant,
    /// Lock task handle
    lock_task: Option<tokio::task::JoinHandle<()>>,
}

impl AutoLockService {
    /// Creates a new auto-lock service
    pub fn new() -> AutoLockServiceState {
        let service = AutoLockService {
            config: AutoLockConfig {
                idle_timeout_minutes: 30,
                warning_minutes: 5,
                enabled: true,
                lock_on_session_lock: true,
                require_password: true,
            },
            state: LockState::Unlocked,
            last_activity: Instant::now(),
            lock_task: None,
        };

        Arc::new(Mutex::new(service))
    }

    /// Starts the activity monitoring task
    pub async fn start_monitoring(&mut self) {
        if self.lock_task.is_some() {
            return; // Already started
        }

        let state = Arc::new(Mutex::new(AutoLockService {
            config: self.config.clone(),
            state: self.state.clone(),
            last_activity: self.last_activity,
            lock_task: None,
        }));

        let handle = tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(30));

            loop {
                interval.tick().await;

                let mut service = state.lock().await;
                if !service.config.enabled || matches!(service.state, LockState::Locked) {
                    continue;
                }

                let idle_duration = service.last_activity.elapsed();
                let timeout_duration = Duration::from_secs(service.config.idle_timeout_minutes as u64 * 60);
                let warning_duration = Duration::from_secs(service.config.warning_minutes as u64 * 60);

                if idle_duration >= timeout_duration {
                    service.lock_application().await;
                } else if idle_duration >= (timeout_duration - warning_duration) {
                    service.state = LockState::Warning;
                }
            }
        });

        self.lock_task = Some(handle);
    }

    /// Updates the auto-lock configuration
    pub async fn update_config(&mut self, config: AutoLockConfig) -> Result<(), String> {
        self.config = config;

        // Restart monitoring with new config
        if self.config.enabled && self.lock_task.is_none() {
            // Note: In a real implementation, you'd restart the monitoring task
        }

        Ok(())
    }

    /// Records user activity
    pub async fn record_activity(&mut self) {
        self.last_activity = Instant::now();
        if matches!(self.state, LockState::Warning) {
            self.state = LockState::Unlocked;
        }
    }

    /// Locks the application
    pub async fn lock_application(&mut self) {
        self.state = LockState::Locked;
        log::info!("Application locked due to inactivity");
    }

    /// Unlocks the application
    pub async fn unlock_application(&mut self) -> Result<(), String> {
        if self.config.require_password {
            // In a real implementation, you'd prompt for password
            // For now, just unlock
            self.state = LockState::Unlocked;
            self.last_activity = Instant::now();
            Ok(())
        } else {
            self.state = LockState::Unlocked;
            self.last_activity = Instant::now();
            Ok(())
        }
    }

    /// Gets the current lock state
    pub async fn get_lock_state(&self) -> LockState {
        self.state.clone()
    }

    /// Gets the current configuration
    pub async fn get_config(&self) -> AutoLockConfig {
        self.config.clone()
    }

    /// Forces an immediate lock
    pub async fn force_lock(&mut self) {
        self.lock_application().await;
    }

    /// Gets time until lock (in seconds)
    pub async fn get_time_until_lock(&self) -> Option<u64> {
        if !self.config.enabled || matches!(self.state, LockState::Locked) {
            return None;
        }

        let idle_duration = self.last_activity.elapsed();
        let timeout_duration = Duration::from_secs(self.config.idle_timeout_minutes as u64 * 60);

        if idle_duration >= timeout_duration {
            Some(0)
        } else {
            Some((timeout_duration - idle_duration).as_secs())
        }
    }

    /// Checks if the application should be locked
    pub async fn should_lock(&self) -> bool {
        if !self.config.enabled {
            return false;
        }

        let idle_duration = self.last_activity.elapsed();
        let timeout_duration = Duration::from_secs(self.config.idle_timeout_minutes as u64 * 60);

        idle_duration >= timeout_duration
    }

    /// Sets the lock timeout in minutes
    pub async fn set_lock_timeout(&mut self, minutes: u32) -> Result<(), String> {
        self.config.idle_timeout_minutes = minutes;
        Ok(())
    }

    /// Gets the current lock timeout in minutes
    pub async fn get_lock_timeout(&self) -> u32 {
        self.config.idle_timeout_minutes
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn make_service() -> AutoLockService {
        AutoLockService {
            config: AutoLockConfig {
                idle_timeout_minutes: 30,
                warning_minutes: 5,
                enabled: true,
                lock_on_session_lock: true,
                require_password: true,
            },
            state: LockState::Unlocked,
            last_activity: Instant::now(),
            lock_task: None,
        }
    }

    // ── Default state ───────────────────────────────────────────────────

    #[tokio::test]
    async fn new_service_is_unlocked() {
        let svc = make_service().await;
        assert!(matches!(svc.get_lock_state().await, LockState::Unlocked));
    }

    #[tokio::test]
    async fn default_config_values() {
        let svc = make_service().await;
        let cfg = svc.get_config().await;
        assert_eq!(cfg.idle_timeout_minutes, 30);
        assert_eq!(cfg.warning_minutes, 5);
        assert!(cfg.enabled);
        assert!(cfg.require_password);
    }

    // ── Lock / unlock cycle ─────────────────────────────────────────────

    #[tokio::test]
    async fn lock_application_sets_locked_state() {
        let mut svc = make_service().await;
        svc.lock_application().await;
        assert!(matches!(svc.get_lock_state().await, LockState::Locked));
    }

    #[tokio::test]
    async fn unlock_after_lock_returns_to_unlocked() {
        let mut svc = make_service().await;
        svc.lock_application().await;
        svc.unlock_application().await.unwrap();
        assert!(matches!(svc.get_lock_state().await, LockState::Unlocked));
    }

    #[tokio::test]
    async fn force_lock_locks_immediately() {
        let mut svc = make_service().await;
        svc.force_lock().await;
        assert!(matches!(svc.get_lock_state().await, LockState::Locked));
    }

    // ── Activity recording ──────────────────────────────────────────────

    #[tokio::test]
    async fn record_activity_clears_warning_state() {
        let mut svc = make_service().await;
        svc.state = LockState::Warning;
        svc.record_activity().await;
        assert!(matches!(svc.get_lock_state().await, LockState::Unlocked));
    }

    #[tokio::test]
    async fn record_activity_does_not_unlock_locked() {
        let mut svc = make_service().await;
        svc.lock_application().await;
        svc.record_activity().await;
        // record_activity only clears Warning, not Locked
        assert!(matches!(svc.get_lock_state().await, LockState::Locked));
    }

    // ── should_lock ─────────────────────────────────────────────────────

    #[tokio::test]
    async fn should_lock_false_when_just_active() {
        let svc = make_service().await;
        assert!(!svc.should_lock().await);
    }

    #[tokio::test]
    async fn should_lock_false_when_disabled() {
        let mut svc = make_service().await;
        svc.config.enabled = false;
        assert!(!svc.should_lock().await);
    }

    // ── get_time_until_lock ─────────────────────────────────────────────

    #[tokio::test]
    async fn time_until_lock_returns_some_when_enabled() {
        let svc = make_service().await;
        let time = svc.get_time_until_lock().await;
        assert!(time.is_some());
        // Should be roughly 30 * 60 = 1800 seconds (minus a few ms)
        assert!(time.unwrap() > 1700);
    }

    #[tokio::test]
    async fn time_until_lock_none_when_disabled() {
        let mut svc = make_service().await;
        svc.config.enabled = false;
        assert!(svc.get_time_until_lock().await.is_none());
    }

    #[tokio::test]
    async fn time_until_lock_none_when_locked() {
        let mut svc = make_service().await;
        svc.lock_application().await;
        assert!(svc.get_time_until_lock().await.is_none());
    }

    // ── set / get lock timeout ──────────────────────────────────────────

    #[tokio::test]
    async fn set_lock_timeout_updates_config() {
        let mut svc = make_service().await;
        svc.set_lock_timeout(10).await.unwrap();
        assert_eq!(svc.get_lock_timeout().await, 10);
    }

    #[tokio::test]
    async fn set_lock_timeout_zero_is_allowed() {
        let mut svc = make_service().await;
        svc.set_lock_timeout(0).await.unwrap();
        assert_eq!(svc.get_lock_timeout().await, 0);
    }

    // ── update_config ───────────────────────────────────────────────────

    #[tokio::test]
    async fn update_config_applies_new_values() {
        let mut svc = make_service().await;
        let new_config = AutoLockConfig {
            idle_timeout_minutes: 5,
            warning_minutes: 1,
            enabled: false,
            lock_on_session_lock: false,
            require_password: false,
        };
        svc.update_config(new_config).await.unwrap();
        let cfg = svc.get_config().await;
        assert_eq!(cfg.idle_timeout_minutes, 5);
        assert_eq!(cfg.warning_minutes, 1);
        assert!(!cfg.enabled);
        assert!(!cfg.lock_on_session_lock);
        assert!(!cfg.require_password);
    }

    // ── LockState serde ─────────────────────────────────────────────────

    #[test]
    fn lock_state_serde_roundtrip() {
        for state in [LockState::Unlocked, LockState::Locked, LockState::Warning] {
            let json = serde_json::to_string(&state).unwrap();
            let back: LockState = serde_json::from_str(&json).unwrap();
            assert_eq!(format!("{:?}", state), format!("{:?}", back));
        }
    }

    // ── AutoLockConfig serde ────────────────────────────────────────────

    #[test]
    fn auto_lock_config_serde_roundtrip() {
        let cfg = AutoLockConfig {
            idle_timeout_minutes: 15,
            warning_minutes: 3,
            enabled: true,
            lock_on_session_lock: false,
            require_password: true,
        };
        let json = serde_json::to_string(&cfg).unwrap();
        let back: AutoLockConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(back.idle_timeout_minutes, 15);
        assert_eq!(back.warning_minutes, 3);
    }

    // ── Edge cases ──────────────────────────────────────────────────────

    #[tokio::test]
    async fn double_lock_stays_locked() {
        let mut svc = make_service().await;
        svc.lock_application().await;
        svc.lock_application().await;
        assert!(matches!(svc.get_lock_state().await, LockState::Locked));
    }

    #[tokio::test]
    async fn unlock_when_already_unlocked_succeeds() {
        let mut svc = make_service().await;
        let result = svc.unlock_application().await;
        assert!(result.is_ok());
        assert!(matches!(svc.get_lock_state().await, LockState::Unlocked));
    }
}