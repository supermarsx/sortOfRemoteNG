//! Hook / event system for extension interop.
//!
//! Extensions register interest in lifecycle and application events via
//! their manifest.  When those events fire, the [`HookManager`] dispatches
//! to each registered handler in priority order.

use std::collections::HashMap;

use chrono::Utc;
use log::debug;

use crate::permissions::PermissionChecker;
use crate::types::*;

// ─── HookRegistrationEntry (internal) ───────────────────────────────

/// Internal record of a single hook subscription.
#[derive(Debug, Clone)]
struct HookEntry {
    extension_id: String,
    handler_name: String,
    priority: i32,
}

// ─── HookManager ────────────────────────────────────────────────────

/// Manages hook registrations and dispatches events.
#[derive(Debug, Clone)]
pub struct HookManager {
    /// Map from event → list of hook entries (kept sorted by priority).
    hooks: HashMap<String, Vec<HookEntry>>,
    /// Maximum hooks per event.
    max_hooks_per_event: usize,
    /// Maximum total hooks across all events.
    max_total_hooks: usize,
    /// Audit trail of dispatches.
    dispatch_log: Vec<DispatchRecord>,
    /// Maximum dispatch log entries kept.
    max_dispatch_log: usize,
}

/// Record of a single dispatch (for auditing).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DispatchRecord {
    pub event: String,
    pub extension_id: String,
    pub handler_name: String,
    pub success: bool,
    pub error: Option<String>,
    pub timestamp: chrono::DateTime<Utc>,
}

impl HookManager {
    /// Create a new hook manager with sensible defaults.
    pub fn new() -> Self {
        Self {
            hooks: HashMap::new(),
            max_hooks_per_event: 50,
            max_total_hooks: 500,
            dispatch_log: Vec::new(),
            max_dispatch_log: 1000,
        }
    }

    /// Create with custom limits.
    pub fn with_limits(
        max_hooks_per_event: usize,
        max_total_hooks: usize,
        max_dispatch_log: usize,
    ) -> Self {
        Self {
            hooks: HashMap::new(),
            max_hooks_per_event,
            max_total_hooks,
            dispatch_log: Vec::new(),
            max_dispatch_log,
        }
    }

    // ── Registration ────────────────────────────────────────────

    /// Register a hook for an extension.
    ///
    /// The caller should have already validated that the extension holds
    /// the `EventSubscribe` permission.
    pub fn register(
        &mut self,
        extension_id: &str,
        event: &HookEvent,
        handler_name: &str,
        priority: i32,
        perm_checker: &PermissionChecker,
    ) -> ExtResult<()> {
        // Permission check.
        perm_checker.enforce(extension_id, &Permission::EventSubscribe)?;

        let event_key = event_to_key(event);

        // Total hooks cap.
        let total: usize = self.hooks.values().map(|v| v.len()).sum();
        if total >= self.max_total_hooks {
            return Err(ExtError::hook(format!(
                "Total hook limit reached ({})",
                self.max_total_hooks
            )));
        }

        let entries = self.hooks.entry(event_key.clone()).or_default();

        // Per-event cap.
        if entries.len() >= self.max_hooks_per_event {
            return Err(ExtError::hook(format!(
                "Hook limit per event '{}' reached ({})",
                event_key, self.max_hooks_per_event
            )));
        }

        // Prevent duplicates (same extension + same handler on same event).
        if entries
            .iter()
            .any(|e| e.extension_id == extension_id && e.handler_name == handler_name)
        {
            debug!(
                "Hook already registered: {}::{} on {}",
                extension_id, handler_name, event_key
            );
            return Ok(());
        }

        entries.push(HookEntry {
            extension_id: extension_id.to_string(),
            handler_name: handler_name.to_string(),
            priority,
        });

        // Keep sorted by priority (highest first).
        entries.sort_by(|a, b| b.priority.cmp(&a.priority));

        debug!(
            "Registered hook {}::{} on {} (priority {})",
            extension_id, handler_name, event_key, priority
        );

        Ok(())
    }

    /// Unregister all hooks for a specific extension.
    pub fn unregister_all(&mut self, extension_id: &str) {
        for entries in self.hooks.values_mut() {
            entries.retain(|e| e.extension_id != extension_id);
        }
        debug!("Unregistered all hooks for {}", extension_id);
    }

    /// Unregister a specific hook.
    pub fn unregister(
        &mut self,
        extension_id: &str,
        event: &HookEvent,
        handler_name: &str,
    ) -> bool {
        let event_key = event_to_key(event);
        if let Some(entries) = self.hooks.get_mut(&event_key) {
            let before = entries.len();
            entries.retain(|e| !(e.extension_id == extension_id && e.handler_name == handler_name));
            before != entries.len()
        } else {
            false
        }
    }

    // ── Dispatch ────────────────────────────────────────────────

    /// Collect the handlers that should be invoked for an event.
    ///
    /// Returns `(extension_id, handler_name)` pairs in priority order.
    pub fn listeners_for(&self, event: &HookEvent) -> Vec<(String, String)> {
        let event_key = event_to_key(event);
        let mut result: Vec<(String, String)> = Vec::new();

        if let Some(entries) = self.hooks.get(&event_key) {
            for entry in entries {
                result.push((entry.extension_id.clone(), entry.handler_name.clone()));
            }
        }

        // Also collect any listeners on custom wildcard "*" if defined.
        if let Some(wildcard_entries) = self.hooks.get("*") {
            for entry in wildcard_entries {
                result.push((entry.extension_id.clone(), entry.handler_name.clone()));
            }
        }

        result
    }

    /// Record the result of a dispatch.
    pub fn record_dispatch(
        &mut self,
        event: &HookEvent,
        extension_id: &str,
        handler_name: &str,
        success: bool,
        error: Option<String>,
    ) {
        let record = DispatchRecord {
            event: event_to_key(event),
            extension_id: extension_id.to_string(),
            handler_name: handler_name.to_string(),
            success,
            error,
            timestamp: Utc::now(),
        };

        self.dispatch_log.push(record);

        // Trim log if needed.
        if self.dispatch_log.len() > self.max_dispatch_log {
            let excess = self.dispatch_log.len() - self.max_dispatch_log;
            self.dispatch_log.drain(..excess);
        }
    }

    // ── Query ───────────────────────────────────────────────────

    /// Get all events that have at least one registered hook.
    pub fn registered_events(&self) -> Vec<String> {
        self.hooks
            .iter()
            .filter(|(_, v)| !v.is_empty())
            .map(|(k, _)| k.clone())
            .collect()
    }

    /// Count total registered hooks.
    pub fn total_hooks(&self) -> usize {
        self.hooks.values().map(|v| v.len()).sum()
    }

    /// Count hooks for a specific event.
    pub fn hooks_for_event(&self, event: &HookEvent) -> usize {
        let event_key = event_to_key(event);
        self.hooks.get(&event_key).map_or(0, |v| v.len())
    }

    /// Count hooks for a specific extension.
    pub fn hooks_for_extension(&self, extension_id: &str) -> usize {
        self.hooks
            .values()
            .flat_map(|v| v.iter())
            .filter(|e| e.extension_id == extension_id)
            .count()
    }

    /// Get all hooks for a specific extension, grouped by event.
    pub fn extension_hooks(&self, extension_id: &str) -> HashMap<String, Vec<String>> {
        let mut result: HashMap<String, Vec<String>> = HashMap::new();
        for (event_key, entries) in &self.hooks {
            for entry in entries {
                if entry.extension_id == extension_id {
                    result
                        .entry(event_key.clone())
                        .or_default()
                        .push(entry.handler_name.clone());
                }
            }
        }
        result
    }

    /// Get the dispatch log.
    pub fn dispatch_log(&self) -> &[DispatchRecord] {
        &self.dispatch_log
    }

    /// Get recent dispatches for a specific extension.
    pub fn extension_dispatches(&self, extension_id: &str) -> Vec<&DispatchRecord> {
        self.dispatch_log
            .iter()
            .filter(|r| r.extension_id == extension_id)
            .collect()
    }

    /// Get failed dispatches.
    pub fn failed_dispatches(&self) -> Vec<&DispatchRecord> {
        self.dispatch_log.iter().filter(|r| !r.success).collect()
    }

    /// Clear the dispatch log.
    pub fn clear_dispatch_log(&mut self) {
        self.dispatch_log.clear();
    }
}

impl Default for HookManager {
    fn default() -> Self {
        Self::new()
    }
}

// ─── Helpers ────────────────────────────────────────────────────────

/// Convert a [`HookEvent`] to a stable string key.
pub fn event_to_key(event: &HookEvent) -> String {
    match event {
        HookEvent::AppStartup => "app.startup".into(),
        HookEvent::AppShutdown => "app.shutdown".into(),
        HookEvent::AppFocused => "app.focused".into(),
        HookEvent::AppBlurred => "app.blurred".into(),
        HookEvent::ConnectionOpened => "connection.opened".into(),
        HookEvent::ConnectionClosed => "connection.closed".into(),
        HookEvent::ConnectionError => "connection.error".into(),
        HookEvent::ConnectionReconnecting => "connection.reconnecting".into(),
        HookEvent::SessionCreated => "session.created".into(),
        HookEvent::SessionDestroyed => "session.destroyed".into(),
        HookEvent::SessionIdle => "session.idle".into(),
        HookEvent::SessionResumed => "session.resumed".into(),
        HookEvent::FileTransferStarted => "filetransfer.started".into(),
        HookEvent::FileTransferProgress => "filetransfer.progress".into(),
        HookEvent::FileTransferCompleted => "filetransfer.completed".into(),
        HookEvent::FileTransferFailed => "filetransfer.failed".into(),
        HookEvent::UserLoggedIn => "user.logged_in".into(),
        HookEvent::UserLoggedOut => "user.logged_out".into(),
        HookEvent::AuthFailed => "auth.failed".into(),
        HookEvent::SettingsChanged => "settings.changed".into(),
        HookEvent::ThemeChanged => "theme.changed".into(),
        HookEvent::ExtensionLoaded => "extension.loaded".into(),
        HookEvent::ExtensionUnloaded => "extension.unloaded".into(),
        HookEvent::ExtensionError => "extension.error".into(),
        HookEvent::NetworkStatusChanged => "network.status_changed".into(),
        HookEvent::HostDiscovered => "network.host_discovered".into(),
        HookEvent::DataImported => "data.imported".into(),
        HookEvent::DataExported => "data.exported".into(),
        HookEvent::BackupCreated => "data.backup_created".into(),
        HookEvent::ScheduledTaskTriggered => "scheduled.task_triggered".into(),
        HookEvent::TimerFired => "scheduled.timer_fired".into(),
        HookEvent::Custom(name) => format!("custom.{}", name),
    }
}

/// Parse a string key back into a [`HookEvent`].
pub fn key_to_event(key: &str) -> Option<HookEvent> {
    match key {
        "app.startup" => Some(HookEvent::AppStartup),
        "app.shutdown" => Some(HookEvent::AppShutdown),
        "app.focused" => Some(HookEvent::AppFocused),
        "app.blurred" => Some(HookEvent::AppBlurred),
        "connection.opened" => Some(HookEvent::ConnectionOpened),
        "connection.closed" => Some(HookEvent::ConnectionClosed),
        "connection.error" => Some(HookEvent::ConnectionError),
        "connection.reconnecting" => Some(HookEvent::ConnectionReconnecting),
        "session.created" => Some(HookEvent::SessionCreated),
        "session.destroyed" => Some(HookEvent::SessionDestroyed),
        "session.idle" => Some(HookEvent::SessionIdle),
        "session.resumed" => Some(HookEvent::SessionResumed),
        "filetransfer.started" => Some(HookEvent::FileTransferStarted),
        "filetransfer.progress" => Some(HookEvent::FileTransferProgress),
        "filetransfer.completed" => Some(HookEvent::FileTransferCompleted),
        "filetransfer.failed" => Some(HookEvent::FileTransferFailed),
        "user.logged_in" => Some(HookEvent::UserLoggedIn),
        "user.logged_out" => Some(HookEvent::UserLoggedOut),
        "auth.failed" => Some(HookEvent::AuthFailed),
        "settings.changed" => Some(HookEvent::SettingsChanged),
        "theme.changed" => Some(HookEvent::ThemeChanged),
        "extension.loaded" => Some(HookEvent::ExtensionLoaded),
        "extension.unloaded" => Some(HookEvent::ExtensionUnloaded),
        "extension.error" => Some(HookEvent::ExtensionError),
        "network.status_changed" => Some(HookEvent::NetworkStatusChanged),
        "network.host_discovered" => Some(HookEvent::HostDiscovered),
        "data.imported" => Some(HookEvent::DataImported),
        "data.exported" => Some(HookEvent::DataExported),
        "data.backup_created" => Some(HookEvent::BackupCreated),
        "scheduled.task_triggered" => Some(HookEvent::ScheduledTaskTriggered),
        "scheduled.timer_fired" => Some(HookEvent::TimerFired),
        other if other.starts_with("custom.") => Some(HookEvent::Custom(other[7..].to_string())),
        _ => None,
    }
}

// ─── Tests ──────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::permissions::PermissionChecker;

    fn make_checker_with_subscribe(ext_id: &str) -> PermissionChecker {
        let mut checker = PermissionChecker::new();
        checker.grant(ext_id, &[Permission::EventSubscribe, Permission::EventEmit]);
        checker
    }

    #[test]
    fn register_and_count() {
        let mut mgr = HookManager::new();
        let checker = make_checker_with_subscribe("ext.a");
        mgr.register("ext.a", &HookEvent::AppStartup, "on_startup", 10, &checker)
            .unwrap();
        assert_eq!(mgr.total_hooks(), 1);
        assert_eq!(mgr.hooks_for_event(&HookEvent::AppStartup), 1);
    }

    #[test]
    fn register_rejects_without_permission() {
        let mut mgr = HookManager::new();
        let checker = PermissionChecker::new(); // no permissions
        let result = mgr.register("ext.a", &HookEvent::AppStartup, "on_startup", 10, &checker);
        assert!(result.is_err());
    }

    #[test]
    fn duplicate_registration_is_noop() {
        let mut mgr = HookManager::new();
        let checker = make_checker_with_subscribe("ext.a");
        mgr.register("ext.a", &HookEvent::AppStartup, "on_startup", 10, &checker)
            .unwrap();
        mgr.register("ext.a", &HookEvent::AppStartup, "on_startup", 10, &checker)
            .unwrap();
        assert_eq!(mgr.total_hooks(), 1);
    }

    #[test]
    fn priority_ordering() {
        let mut mgr = HookManager::new();
        let checker_a = make_checker_with_subscribe("ext.a");
        let checker_b = make_checker_with_subscribe("ext.b");
        let checker_c = make_checker_with_subscribe("ext.c");

        mgr.register(
            "ext.a",
            &HookEvent::ConnectionOpened,
            "handler_a",
            5,
            &checker_a,
        )
        .unwrap();
        mgr.register(
            "ext.b",
            &HookEvent::ConnectionOpened,
            "handler_b",
            20,
            &checker_b,
        )
        .unwrap();
        mgr.register(
            "ext.c",
            &HookEvent::ConnectionOpened,
            "handler_c",
            10,
            &checker_c,
        )
        .unwrap();

        let listeners = mgr.listeners_for(&HookEvent::ConnectionOpened);
        assert_eq!(listeners.len(), 3);
        assert_eq!(listeners[0].0, "ext.b"); // highest priority
        assert_eq!(listeners[1].0, "ext.c");
        assert_eq!(listeners[2].0, "ext.a"); // lowest priority
    }

    #[test]
    fn unregister_specific() {
        let mut mgr = HookManager::new();
        let checker = make_checker_with_subscribe("ext.a");
        mgr.register("ext.a", &HookEvent::AppStartup, "h1", 10, &checker)
            .unwrap();
        mgr.register("ext.a", &HookEvent::AppStartup, "h2", 5, &checker)
            .unwrap();

        assert!(mgr.unregister("ext.a", &HookEvent::AppStartup, "h1"));
        assert_eq!(mgr.hooks_for_event(&HookEvent::AppStartup), 1);
        assert!(!mgr.unregister("ext.a", &HookEvent::AppStartup, "nonexistent"));
    }

    #[test]
    fn unregister_all_for_extension() {
        let mut mgr = HookManager::new();
        let checker = make_checker_with_subscribe("ext.a");
        mgr.register("ext.a", &HookEvent::AppStartup, "h1", 10, &checker)
            .unwrap();
        mgr.register("ext.a", &HookEvent::AppShutdown, "h2", 5, &checker)
            .unwrap();

        mgr.unregister_all("ext.a");
        assert_eq!(mgr.total_hooks(), 0);
    }

    #[test]
    fn registered_events() {
        let mut mgr = HookManager::new();
        let checker = make_checker_with_subscribe("ext.a");
        mgr.register("ext.a", &HookEvent::AppStartup, "h1", 10, &checker)
            .unwrap();
        mgr.register("ext.a", &HookEvent::SessionCreated, "h2", 5, &checker)
            .unwrap();

        let events = mgr.registered_events();
        assert_eq!(events.len(), 2);
    }

    #[test]
    fn hooks_for_extension() {
        let mut mgr = HookManager::new();
        let checker_a = make_checker_with_subscribe("ext.a");
        let checker_b = make_checker_with_subscribe("ext.b");
        mgr.register("ext.a", &HookEvent::AppStartup, "h1", 10, &checker_a)
            .unwrap();
        mgr.register("ext.a", &HookEvent::AppShutdown, "h2", 5, &checker_a)
            .unwrap();
        mgr.register("ext.b", &HookEvent::AppStartup, "h3", 3, &checker_b)
            .unwrap();

        assert_eq!(mgr.hooks_for_extension("ext.a"), 2);
        assert_eq!(mgr.hooks_for_extension("ext.b"), 1);
        assert_eq!(mgr.hooks_for_extension("ext.c"), 0);
    }

    #[test]
    fn extension_hooks_grouped() {
        let mut mgr = HookManager::new();
        let checker = make_checker_with_subscribe("ext.a");
        mgr.register("ext.a", &HookEvent::AppStartup, "h1", 10, &checker)
            .unwrap();
        mgr.register("ext.a", &HookEvent::AppStartup, "h2", 5, &checker)
            .unwrap();
        mgr.register("ext.a", &HookEvent::AppShutdown, "h3", 5, &checker)
            .unwrap();

        let grouped = mgr.extension_hooks("ext.a");
        assert_eq!(grouped.len(), 2);
        assert_eq!(grouped["app.startup"].len(), 2);
        assert_eq!(grouped["app.shutdown"].len(), 1);
    }

    #[test]
    fn dispatch_recording() {
        let mut mgr = HookManager::new();
        mgr.record_dispatch(&HookEvent::AppStartup, "ext.a", "h1", true, None);
        mgr.record_dispatch(
            &HookEvent::AppStartup,
            "ext.b",
            "h2",
            false,
            Some("timeout".into()),
        );

        assert_eq!(mgr.dispatch_log().len(), 2);
        assert_eq!(mgr.failed_dispatches().len(), 1);
    }

    #[test]
    fn dispatch_log_trimming() {
        let mut mgr = HookManager::with_limits(50, 500, 3);
        for i in 0..5 {
            mgr.record_dispatch(
                &HookEvent::AppStartup,
                &format!("ext.{}", i),
                "h",
                true,
                None,
            );
        }
        assert_eq!(mgr.dispatch_log().len(), 3);
    }

    #[test]
    fn extension_dispatches() {
        let mut mgr = HookManager::new();
        mgr.record_dispatch(&HookEvent::AppStartup, "ext.a", "h1", true, None);
        mgr.record_dispatch(&HookEvent::AppStartup, "ext.b", "h2", true, None);
        mgr.record_dispatch(
            &HookEvent::AppShutdown,
            "ext.a",
            "h3",
            false,
            Some("err".into()),
        );

        let ext_a = mgr.extension_dispatches("ext.a");
        assert_eq!(ext_a.len(), 2);
    }

    #[test]
    fn clear_dispatch_log() {
        let mut mgr = HookManager::new();
        mgr.record_dispatch(&HookEvent::AppStartup, "ext.a", "h1", true, None);
        mgr.clear_dispatch_log();
        assert!(mgr.dispatch_log().is_empty());
    }

    #[test]
    fn event_key_roundtrip() {
        let events = vec![
            HookEvent::AppStartup,
            HookEvent::AppShutdown,
            HookEvent::ConnectionOpened,
            HookEvent::SessionCreated,
            HookEvent::Custom("my_event".into()),
        ];
        for event in events {
            let key = event_to_key(&event);
            let back = key_to_event(&key).unwrap();
            assert_eq!(event_to_key(&back), key);
        }
    }

    #[test]
    fn custom_event_hooks() {
        let mut mgr = HookManager::new();
        let checker = make_checker_with_subscribe("ext.a");
        mgr.register(
            "ext.a",
            &HookEvent::Custom("my_event".into()),
            "on_my_event",
            10,
            &checker,
        )
        .unwrap();

        let listeners = mgr.listeners_for(&HookEvent::Custom("my_event".into()));
        assert_eq!(listeners.len(), 1);
        assert_eq!(listeners[0].1, "on_my_event");
    }

    #[test]
    fn max_hooks_per_event_enforced() {
        let mut mgr = HookManager::with_limits(2, 100, 100);
        let checker = make_checker_with_subscribe("ext.a");
        mgr.register("ext.a", &HookEvent::AppStartup, "h1", 10, &checker)
            .unwrap();
        mgr.register("ext.a", &HookEvent::AppStartup, "h2", 5, &checker)
            .unwrap();
        let result = mgr.register("ext.a", &HookEvent::AppStartup, "h3", 1, &checker);
        assert!(result.is_err());
    }

    #[test]
    fn max_total_hooks_enforced() {
        let mut mgr = HookManager::with_limits(50, 2, 100);
        let checker = make_checker_with_subscribe("ext.a");
        mgr.register("ext.a", &HookEvent::AppStartup, "h1", 10, &checker)
            .unwrap();
        mgr.register("ext.a", &HookEvent::AppShutdown, "h2", 5, &checker)
            .unwrap();
        let result = mgr.register("ext.a", &HookEvent::ConnectionOpened, "h3", 1, &checker);
        assert!(result.is_err());
    }

    #[test]
    fn wildcard_listeners() {
        let mut mgr = HookManager::new();
        let checker = make_checker_with_subscribe("ext.a");
        // Register on wildcard
        let _wildcard = HookEvent::Custom("".into());
        // Directly insert to wildcard key
        mgr.hooks.entry("*".into()).or_default().push(HookEntry {
            extension_id: "ext.a".into(),
            handler_name: "catch_all".into(),
            priority: 0,
        });

        // Also register a normal hook
        mgr.register("ext.a", &HookEvent::AppStartup, "on_start", 10, &checker)
            .unwrap();

        let listeners = mgr.listeners_for(&HookEvent::AppStartup);
        assert_eq!(listeners.len(), 2); // normal + wildcard
    }

    #[test]
    fn key_to_event_unknown_returns_none() {
        assert!(key_to_event("unknown.key").is_none());
        assert!(key_to_event("").is_none());
    }

    #[test]
    fn default_constructor() {
        let mgr = HookManager::default();
        assert_eq!(mgr.total_hooks(), 0);
        assert!(mgr.dispatch_log().is_empty());
    }
}
