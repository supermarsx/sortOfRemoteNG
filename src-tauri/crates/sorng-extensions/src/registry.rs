//! Extension lifecycle registry.
//!
//! Manages the set of installed extensions and exposes
//! install / enable / disable / uninstall / update workflows.

use std::collections::HashMap;

use chrono::Utc;
use log::{debug, info, warn};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::hooks::HookManager;
use crate::manifest::validate_manifest;
use crate::permissions::PermissionChecker;
use crate::types::*;

// ─── ExtensionRegistry ──────────────────────────────────────────────

/// Central registry for all installed extensions.
#[derive(Debug, Clone)]
pub struct ExtensionRegistry {
    /// Map from extension_id → extension state.
    extensions: HashMap<String, ExtensionState>,
    /// Maximum number of installed extensions.
    max_extensions: usize,
    /// Audit log.
    audit_log: Vec<AuditEntry>,
    /// Maximum audit log entries.
    max_audit_entries: usize,
}

impl ExtensionRegistry {
    /// Create with default limits.
    pub fn new() -> Self {
        Self {
            extensions: HashMap::new(),
            max_extensions: 100,
            audit_log: Vec::new(),
            max_audit_entries: 5000,
        }
    }

    /// Create with custom limits.
    pub fn with_limits(max_extensions: usize, max_audit_entries: usize) -> Self {
        Self {
            extensions: HashMap::new(),
            max_extensions,
            audit_log: Vec::new(),
            max_audit_entries,
        }
    }

    // ── Install ─────────────────────────────────────────────────

    /// Install an extension from a manifest and optional script source.
    pub fn install(
        &mut self,
        manifest: ExtensionManifest,
        script_source: Option<String>,
        sandbox_config: Option<SandboxConfig>,
        perm_checker: &mut PermissionChecker,
        hook_manager: &mut HookManager,
    ) -> ExtResult<String> {
        // Check capacity.
        if self.extensions.len() >= self.max_extensions {
            return Err(ExtError::new(
                ExtErrorKind::InvalidState,
                format!("Extension limit reached ({})", self.max_extensions),
            ));
        }

        // Validate manifest.
        validate_manifest(&manifest)?;

        let ext_id = manifest.id.clone();

        // Check for duplicates.
        if self.extensions.contains_key(&ext_id) {
            return Err(ExtError::already_installed(&ext_id));
        }

        // Check dependencies.
        self.check_dependencies(&manifest)?;

        // Compute script hash.
        let script_hash = script_source.as_ref().map(|s| {
            let mut hasher = Sha256::new();
            hasher.update(s.as_bytes());
            format!("{:x}", hasher.finalize())
        });

        // Grant permissions.
        perm_checker.grant(&ext_id, &manifest.permissions.clone());

        // Register hooks.
        for hook in &manifest.hooks {
            if let Err(e) = hook_manager.register(
                &ext_id,
                &hook.event,
                &hook.handler,
                hook.priority,
                perm_checker,
            ) {
                warn!("Failed to register hook for {}: {}", ext_id, e);
            }
        }

        let state = ExtensionState {
            manifest,
            status: ExtensionStatus::Installed,
            installed_at: Utc::now(),
            enabled_at: None,
            disabled_at: None,
            last_error: None,
            execution_count: 0,
            total_execution_time_ms: 0,
            settings: HashMap::new(),
            sandbox_config: sandbox_config.unwrap_or_default(),
            script_source,
            script_hash,
        };

        self.extensions.insert(ext_id.clone(), state);
        self.audit("install", &ext_id, None);

        info!("Extension installed: {}", ext_id);
        Ok(ext_id)
    }

    // ── Enable / Disable ────────────────────────────────────────

    /// Enable an installed extension.
    pub fn enable(&mut self, extension_id: &str) -> ExtResult<()> {
        let state = self
            .extensions
            .get_mut(extension_id)
            .ok_or_else(|| ExtError::not_found(extension_id))?;

        match state.status {
            ExtensionStatus::Enabled => {
                debug!("Extension {} already enabled", extension_id);
                return Ok(());
            }
            ExtensionStatus::PendingRemoval => {
                return Err(ExtError::new(
                    ExtErrorKind::InvalidState,
                    "Cannot enable extension pending removal",
                ));
            }
            _ => {}
        }

        state.status = ExtensionStatus::Enabled;
        state.enabled_at = Some(Utc::now());
        state.disabled_at = None;
        state.last_error = None;

        self.audit("enable", extension_id, None);
        info!("Extension enabled: {}", extension_id);
        Ok(())
    }

    /// Disable an enabled extension.
    pub fn disable(&mut self, extension_id: &str) -> ExtResult<()> {
        let state = self
            .extensions
            .get_mut(extension_id)
            .ok_or_else(|| ExtError::not_found(extension_id))?;

        match state.status {
            ExtensionStatus::Disabled | ExtensionStatus::Installed => {
                debug!("Extension {} already disabled/installed", extension_id);
                return Ok(());
            }
            ExtensionStatus::PendingRemoval => {
                return Err(ExtError::new(
                    ExtErrorKind::InvalidState,
                    "Cannot disable extension pending removal",
                ));
            }
            _ => {}
        }

        state.status = ExtensionStatus::Disabled;
        state.disabled_at = Some(Utc::now());

        self.audit("disable", extension_id, None);
        info!("Extension disabled: {}", extension_id);
        Ok(())
    }

    // ── Uninstall ───────────────────────────────────────────────

    /// Uninstall an extension, revoking all permissions and hooks.
    pub fn uninstall(
        &mut self,
        extension_id: &str,
        perm_checker: &mut PermissionChecker,
        hook_manager: &mut HookManager,
    ) -> ExtResult<()> {
        if !self.extensions.contains_key(extension_id) {
            return Err(ExtError::not_found(extension_id));
        }

        // Check reverse dependencies.
        self.check_reverse_dependencies(extension_id)?;

        // Revoke permissions and hooks.
        perm_checker.revoke_all(extension_id);
        hook_manager.unregister_all(extension_id);

        self.extensions.remove(extension_id);
        self.audit("uninstall", extension_id, None);

        info!("Extension uninstalled: {}", extension_id);
        Ok(())
    }

    // ── Update ──────────────────────────────────────────────────

    /// Update an extension with a new manifest and optional new script.
    pub fn update(
        &mut self,
        extension_id: &str,
        new_manifest: ExtensionManifest,
        new_script_source: Option<String>,
        perm_checker: &mut PermissionChecker,
        hook_manager: &mut HookManager,
    ) -> ExtResult<()> {
        let state = self
            .extensions
            .get_mut(extension_id)
            .ok_or_else(|| ExtError::not_found(extension_id))?;

        if new_manifest.id != extension_id {
            return Err(ExtError::manifest("Extension ID mismatch in update"));
        }

        validate_manifest(&new_manifest)?;

        let was_enabled = state.status == ExtensionStatus::Enabled;

        // Update permissions.
        perm_checker.revoke_all(extension_id);
        perm_checker.grant(extension_id, &new_manifest.permissions.clone());

        // Update hooks.
        hook_manager.unregister_all(extension_id);
        for hook in &new_manifest.hooks {
            if let Err(e) = hook_manager.register(
                extension_id,
                &hook.event,
                &hook.handler,
                hook.priority,
                perm_checker,
            ) {
                warn!("Failed to register hook during update: {}", e);
            }
        }

        // Compute new script hash.
        let script_hash = new_script_source.as_ref().map(|s| {
            let mut hasher = Sha256::new();
            hasher.update(s.as_bytes());
            format!("{:x}", hasher.finalize())
        });

        state.manifest = new_manifest;
        state.script_source = new_script_source;
        state.script_hash = script_hash;
        state.last_error = None;
        state.status = if was_enabled {
            ExtensionStatus::Enabled
        } else {
            ExtensionStatus::Installed
        };

        self.audit("update", extension_id, None);
        info!("Extension updated: {}", extension_id);
        Ok(())
    }

    // ── Mark Error ──────────────────────────────────────────────

    /// Mark an extension as errored.
    pub fn mark_error(&mut self, extension_id: &str, error: &str) -> ExtResult<()> {
        let state = self
            .extensions
            .get_mut(extension_id)
            .ok_or_else(|| ExtError::not_found(extension_id))?;

        state.status = ExtensionStatus::Error;
        state.last_error = Some(error.to_string());

        self.audit("error", extension_id, Some(error));
        warn!("Extension {} errored: {}", extension_id, error);
        Ok(())
    }

    // ── Record Execution ────────────────────────────────────────

    /// Record an execution of a handler.
    pub fn record_execution(&mut self, extension_id: &str, duration_ms: u64) -> ExtResult<()> {
        let state = self
            .extensions
            .get_mut(extension_id)
            .ok_or_else(|| ExtError::not_found(extension_id))?;

        state.execution_count += 1;
        state.total_execution_time_ms += duration_ms;
        Ok(())
    }

    // ── Settings ────────────────────────────────────────────────

    /// Get an extension setting.
    pub fn get_setting(
        &self,
        extension_id: &str,
        key: &str,
    ) -> ExtResult<Option<serde_json::Value>> {
        let state = self
            .extensions
            .get(extension_id)
            .ok_or_else(|| ExtError::not_found(extension_id))?;

        Ok(state.settings.get(key).cloned())
    }

    /// Set an extension setting.
    pub fn set_setting(
        &mut self,
        extension_id: &str,
        key: &str,
        value: serde_json::Value,
    ) -> ExtResult<()> {
        let state = self
            .extensions
            .get_mut(extension_id)
            .ok_or_else(|| ExtError::not_found(extension_id))?;

        state.settings.insert(key.to_string(), value);
        Ok(())
    }

    /// Remove an extension setting.
    pub fn remove_setting(&mut self, extension_id: &str, key: &str) -> ExtResult<bool> {
        let state = self
            .extensions
            .get_mut(extension_id)
            .ok_or_else(|| ExtError::not_found(extension_id))?;

        Ok(state.settings.remove(key).is_some())
    }

    // ── Query ───────────────────────────────────────────────────

    /// Get extension state by ID.
    pub fn get(&self, extension_id: &str) -> Option<&ExtensionState> {
        self.extensions.get(extension_id)
    }

    /// Check if an extension is installed.
    pub fn is_installed(&self, extension_id: &str) -> bool {
        self.extensions.contains_key(extension_id)
    }

    /// Check if an extension is enabled.
    pub fn is_enabled(&self, extension_id: &str) -> bool {
        self.extensions
            .get(extension_id)
            .is_some_and(|s| s.status == ExtensionStatus::Enabled)
    }

    /// Get all extension IDs.
    pub fn extension_ids(&self) -> Vec<String> {
        self.extensions.keys().cloned().collect()
    }

    /// Get the total count of installed extensions.
    pub fn count(&self) -> usize {
        self.extensions.len()
    }

    /// Get count by status.
    pub fn count_by_status(&self, status: ExtensionStatus) -> usize {
        self.extensions
            .values()
            .filter(|s| s.status == status)
            .count()
    }

    /// List extensions with flexible filtering and sorting.
    pub fn list_extensions(&self, filter: &ExtensionFilter) -> Vec<ExtensionSummary> {
        let mut results: Vec<ExtensionSummary> = self
            .extensions
            .values()
            .filter(|state| {
                // Status filter.
                if let Some(ref status) = filter.status {
                    if &state.status != status {
                        return false;
                    }
                }

                // Type filter.
                if let Some(ref ext_type) = filter.extension_type {
                    if &state.manifest.extension_type != ext_type {
                        return false;
                    }
                }

                // Search text.
                if let Some(ref search) = filter.query {
                    let search_lower: String = search.to_lowercase();
                    let matches = state.manifest.id.to_lowercase().contains(&search_lower)
                        || state.manifest.name.to_lowercase().contains(&search_lower)
                        || state
                            .manifest
                            .description
                            .to_lowercase()
                            .contains(&search_lower)
                        || state.manifest.author.to_lowercase().contains(&search_lower)
                        || state
                            .manifest
                            .tags
                            .iter()
                            .any(|t| t.to_lowercase().contains(&search_lower));
                    if !matches {
                        return false;
                    }
                }

                // Tag filter.
                if let Some(ref tag) = filter.tag {
                    if !state.manifest.tags.contains(tag) {
                        return false;
                    }
                }

                true
            })
            .map(|state| ExtensionSummary {
                id: state.manifest.id.clone(),
                name: state.manifest.name.clone(),
                version: state.manifest.version.clone(),
                description: state.manifest.description.clone(),
                author: state.manifest.author.clone(),
                extension_type: state.manifest.extension_type.clone(),
                status: state.status.clone(),
                installed_at: state.installed_at,
                execution_count: state.execution_count,
                tags: state.manifest.tags.clone(),
                has_settings: !state.settings.is_empty(),
                permission_count: state.manifest.permissions.len(),
                hook_count: state.manifest.hooks.len(),
            })
            .collect();

        // Sort.
        let sort_field = filter.sort_by.clone().unwrap_or(ExtensionSortField::Name);
        results.sort_by(|a, b| {
            let ord = match sort_field {
                ExtensionSortField::Name => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
                ExtensionSortField::Author => a.author.to_lowercase().cmp(&b.author.to_lowercase()),
                ExtensionSortField::InstalledAt => a.installed_at.cmp(&b.installed_at),
                ExtensionSortField::ExecutionCount => a.execution_count.cmp(&b.execution_count),
                ExtensionSortField::Status => a.status.to_string().cmp(&b.status.to_string()),
                ExtensionSortField::UpdatedAt => a.installed_at.cmp(&b.installed_at),
            };
            if !filter.ascending {
                ord.reverse()
            } else {
                ord
            }
        });

        results
    }

    /// Generate engine stats.
    pub fn stats(&self) -> EngineStats {
        EngineStats {
            total_installed: self.extensions.len(),
            total_enabled: self.count_by_status(ExtensionStatus::Enabled),
            total_disabled: self.count_by_status(ExtensionStatus::Disabled)
                + self.count_by_status(ExtensionStatus::Installed),
            total_errored: self.count_by_status(ExtensionStatus::Error),
            total_hooks: 0, // Updated externally.
            total_executions: self.extensions.values().map(|s| s.execution_count).sum(),
            total_storage_entries: 0, // Updated externally.
            total_storage_bytes: 0,   // Updated externally.
            uptime_seconds: 0,        // Updated externally.
            api_calls_this_minute: 0, // Updated externally.
        }
    }

    // ── Audit ───────────────────────────────────────────────────

    /// Get the audit log.
    pub fn audit_log(&self) -> &[AuditEntry] {
        &self.audit_log
    }

    /// Clear the audit log.
    pub fn clear_audit_log(&mut self) {
        self.audit_log.clear();
    }

    // ── Private Helpers ─────────────────────────────────────────

    fn check_dependencies(&self, manifest: &ExtensionManifest) -> ExtResult<()> {
        for dep in &manifest.dependencies {
            match self.extensions.get(&dep.extension_id) {
                None => {
                    if dep.optional {
                        debug!("Optional dependency {} not installed", dep.extension_id);
                        continue;
                    }
                    return Err(ExtError::dependency(format!(
                        "Required dependency '{}' not installed",
                        dep.extension_id
                    )));
                }
                Some(state) => {
                    // Version check.
                    if let Some(ref min) = dep.min_version {
                        if crate::manifest::compare_versions(&state.manifest.version, min)
                            == std::cmp::Ordering::Less
                        {
                            return Err(ExtError::dependency(format!(
                                "Dependency '{}' requires version >= {} but found {}",
                                dep.extension_id, min, state.manifest.version
                            )));
                        }
                    }
                }
            }
        }
        Ok(())
    }

    fn check_reverse_dependencies(&self, extension_id: &str) -> ExtResult<()> {
        for (id, state) in &self.extensions {
            for dep in &state.manifest.dependencies {
                if dep.extension_id == extension_id && !dep.optional {
                    return Err(ExtError::dependency(format!(
                        "Cannot uninstall '{}': required by '{}'",
                        extension_id, id
                    )));
                }
            }
        }
        Ok(())
    }

    fn audit(&mut self, action: &str, extension_id: &str, details: Option<&str>) {
        self.audit_log.push(AuditEntry {
            id: Uuid::new_v4().to_string(),
            timestamp: Utc::now(),
            action: action.to_string(),
            extension_id: extension_id.to_string(),
            api_function: None,
            success: true,
            error: None,
            details: details.map(|d| serde_json::Value::String(d.to_string())),
        });

        // Trim if needed.
        if self.audit_log.len() > self.max_audit_entries {
            let excess = self.audit_log.len() - self.max_audit_entries;
            self.audit_log.drain(..excess);
        }
    }
}

impl Default for ExtensionRegistry {
    fn default() -> Self {
        Self::new()
    }
}

// ─── Tests ──────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::manifest::create_manifest;

    fn make_manifest(id: &str, name: &str) -> ExtensionManifest {
        create_manifest(
            id.to_string(),
            name.to_string(),
            "1.0.0".to_string(),
            "Test extension".to_string(),
            "Author".to_string(),
            ExtensionType::Tool,
        )
    }

    fn make_manifest_with_dep(id: &str, dep_id: &str) -> ExtensionManifest {
        let mut m = make_manifest(id, id);
        m.dependencies.push(ExtensionDependency {
            extension_id: dep_id.to_string(),
            min_version: None,
            max_version: None,
            optional: false,
        });
        m
    }

    #[test]
    fn install_and_query() {
        let mut reg = ExtensionRegistry::new();
        let mut perms = PermissionChecker::new();
        let mut hooks = HookManager::new();
        let manifest = make_manifest("com.test.ext", "Test Extension");

        let id = reg
            .install(manifest, None, None, &mut perms, &mut hooks)
            .unwrap();
        assert_eq!(id, "com.test.ext");
        assert!(reg.is_installed("com.test.ext"));
        assert_eq!(reg.count(), 1);
    }

    #[test]
    fn install_duplicate_fails() {
        let mut reg = ExtensionRegistry::new();
        let mut perms = PermissionChecker::new();
        let mut hooks = HookManager::new();
        let manifest = make_manifest("com.test.ext", "Test Extension");
        reg.install(manifest.clone(), None, None, &mut perms, &mut hooks)
            .unwrap();

        let result = reg.install(manifest, None, None, &mut perms, &mut hooks);
        assert!(result.is_err());
    }

    #[test]
    fn install_exceeds_limit() {
        let mut reg = ExtensionRegistry::with_limits(1, 100);
        let mut perms = PermissionChecker::new();
        let mut hooks = HookManager::new();

        reg.install(
            make_manifest("com.test.a", "A"),
            None,
            None,
            &mut perms,
            &mut hooks,
        )
        .unwrap();

        let result = reg.install(
            make_manifest("com.test.b", "B"),
            None,
            None,
            &mut perms,
            &mut hooks,
        );
        assert!(result.is_err());
    }

    #[test]
    fn enable_disable_lifecycle() {
        let mut reg = ExtensionRegistry::new();
        let mut perms = PermissionChecker::new();
        let mut hooks = HookManager::new();
        reg.install(
            make_manifest("com.test.ext", "Ext"),
            None,
            None,
            &mut perms,
            &mut hooks,
        )
        .unwrap();

        assert!(!reg.is_enabled("com.test.ext"));

        reg.enable("com.test.ext").unwrap();
        assert!(reg.is_enabled("com.test.ext"));

        reg.disable("com.test.ext").unwrap();
        assert!(!reg.is_enabled("com.test.ext"));
    }

    #[test]
    fn enable_already_enabled_is_ok() {
        let mut reg = ExtensionRegistry::new();
        let mut perms = PermissionChecker::new();
        let mut hooks = HookManager::new();
        reg.install(
            make_manifest("com.test.ext", "Ext"),
            None,
            None,
            &mut perms,
            &mut hooks,
        )
        .unwrap();
        reg.enable("com.test.ext").unwrap();
        reg.enable("com.test.ext").unwrap(); // Should not error.
    }

    #[test]
    fn enable_nonexistent_fails() {
        let mut reg = ExtensionRegistry::new();
        let result = reg.enable("com.nonexistent");
        assert!(result.is_err());
    }

    #[test]
    fn uninstall_removes_extension() {
        let mut reg = ExtensionRegistry::new();
        let mut perms = PermissionChecker::new();
        let mut hooks = HookManager::new();
        reg.install(
            make_manifest("com.test.ext", "Ext"),
            None,
            None,
            &mut perms,
            &mut hooks,
        )
        .unwrap();

        reg.uninstall("com.test.ext", &mut perms, &mut hooks)
            .unwrap();
        assert!(!reg.is_installed("com.test.ext"));
        assert_eq!(reg.count(), 0);
    }

    #[test]
    fn uninstall_nonexistent_fails() {
        let mut reg = ExtensionRegistry::new();
        let mut perms = PermissionChecker::new();
        let mut hooks = HookManager::new();
        let result = reg.uninstall("com.nonexistent", &mut perms, &mut hooks);
        assert!(result.is_err());
    }

    #[test]
    fn uninstall_blocks_if_depended_on() {
        let mut reg = ExtensionRegistry::new();
        let mut perms = PermissionChecker::new();
        let mut hooks = HookManager::new();

        reg.install(
            make_manifest("com.dep.base", "Base"),
            None,
            None,
            &mut perms,
            &mut hooks,
        )
        .unwrap();
        reg.install(
            make_manifest_with_dep("com.dep.user", "com.dep.base"),
            None,
            None,
            &mut perms,
            &mut hooks,
        )
        .unwrap();

        let result = reg.uninstall("com.dep.base", &mut perms, &mut hooks);
        assert!(result.is_err());
    }

    #[test]
    fn install_missing_dependency_fails() {
        let mut reg = ExtensionRegistry::new();
        let mut perms = PermissionChecker::new();
        let mut hooks = HookManager::new();

        let result = reg.install(
            make_manifest_with_dep("com.ext", "com.missing.dep"),
            None,
            None,
            &mut perms,
            &mut hooks,
        );
        assert!(result.is_err());
    }

    #[test]
    fn optional_dependency_missing_is_ok() {
        let mut reg = ExtensionRegistry::new();
        let mut perms = PermissionChecker::new();
        let mut hooks = HookManager::new();

        let mut m = make_manifest("com.ext", "Ext");
        m.dependencies.push(ExtensionDependency {
            extension_id: "com.optional.dep".into(),
            min_version: None,
            max_version: None,
            optional: true,
        });

        reg.install(m, None, None, &mut perms, &mut hooks).unwrap();
    }

    #[test]
    fn update_extension() {
        let mut reg = ExtensionRegistry::new();
        let mut perms = PermissionChecker::new();
        let mut hooks = HookManager::new();

        reg.install(
            make_manifest("com.test.ext", "Ext v1"),
            None,
            None,
            &mut perms,
            &mut hooks,
        )
        .unwrap();
        reg.enable("com.test.ext").unwrap();

        let new_manifest = make_manifest("com.test.ext", "Ext v2");
        reg.update(
            "com.test.ext",
            new_manifest,
            Some("new script".into()),
            &mut perms,
            &mut hooks,
        )
        .unwrap();

        let state = reg.get("com.test.ext").unwrap();
        assert_eq!(state.manifest.name, "Ext v2");
        assert_eq!(state.status, ExtensionStatus::Enabled); // Stays enabled.
        assert!(state.script_hash.is_some());
    }

    #[test]
    fn update_id_mismatch_fails() {
        let mut reg = ExtensionRegistry::new();
        let mut perms = PermissionChecker::new();
        let mut hooks = HookManager::new();

        reg.install(
            make_manifest("com.test.ext", "Ext"),
            None,
            None,
            &mut perms,
            &mut hooks,
        )
        .unwrap();

        let bad = make_manifest("com.other.ext", "Other");
        let result = reg.update("com.test.ext", bad, None, &mut perms, &mut hooks);
        assert!(result.is_err());
    }

    #[test]
    fn mark_error_and_recover() {
        let mut reg = ExtensionRegistry::new();
        let mut perms = PermissionChecker::new();
        let mut hooks = HookManager::new();

        reg.install(
            make_manifest("com.test.ext", "Ext"),
            None,
            None,
            &mut perms,
            &mut hooks,
        )
        .unwrap();
        reg.enable("com.test.ext").unwrap();

        reg.mark_error("com.test.ext", "Script crashed").unwrap();
        let state = reg.get("com.test.ext").unwrap();
        assert_eq!(state.status, ExtensionStatus::Error);
        assert!(state.last_error.is_some());

        // Re-enable after fixing.
        reg.enable("com.test.ext").unwrap();
        assert!(reg.is_enabled("com.test.ext"));
    }

    #[test]
    fn record_execution() {
        let mut reg = ExtensionRegistry::new();
        let mut perms = PermissionChecker::new();
        let mut hooks = HookManager::new();

        reg.install(
            make_manifest("com.test.ext", "Ext"),
            None,
            None,
            &mut perms,
            &mut hooks,
        )
        .unwrap();

        reg.record_execution("com.test.ext", 100).unwrap();
        reg.record_execution("com.test.ext", 200).unwrap();

        let state = reg.get("com.test.ext").unwrap();
        assert_eq!(state.execution_count, 2);
        assert_eq!(state.total_execution_time_ms, 300);
    }

    #[test]
    fn settings_crud() {
        let mut reg = ExtensionRegistry::new();
        let mut perms = PermissionChecker::new();
        let mut hooks = HookManager::new();

        reg.install(
            make_manifest("com.test.ext", "Ext"),
            None,
            None,
            &mut perms,
            &mut hooks,
        )
        .unwrap();

        assert_eq!(reg.get_setting("com.test.ext", "key").unwrap(), None);

        reg.set_setting("com.test.ext", "key", serde_json::json!("value"))
            .unwrap();
        assert_eq!(
            reg.get_setting("com.test.ext", "key").unwrap(),
            Some(serde_json::json!("value"))
        );

        assert!(reg.remove_setting("com.test.ext", "key").unwrap());
        assert!(!reg.remove_setting("com.test.ext", "key").unwrap());
    }

    #[test]
    fn list_extensions_with_filter() {
        let mut reg = ExtensionRegistry::new();
        let mut perms = PermissionChecker::new();
        let mut hooks = HookManager::new();

        reg.install(
            make_manifest("com.test.a", "Alpha"),
            None,
            None,
            &mut perms,
            &mut hooks,
        )
        .unwrap();
        reg.install(
            make_manifest("com.test.b", "Beta"),
            None,
            None,
            &mut perms,
            &mut hooks,
        )
        .unwrap();
        reg.enable("com.test.a").unwrap();

        let all = reg.list_extensions(&ExtensionFilter::default());
        assert_eq!(all.len(), 2);

        let enabled = reg.list_extensions(&ExtensionFilter {
            status: Some(ExtensionStatus::Enabled),
            ..Default::default()
        });
        assert_eq!(enabled.len(), 1);
        assert_eq!(enabled[0].id, "com.test.a");
    }

    #[test]
    fn list_extensions_search() {
        let mut reg = ExtensionRegistry::new();
        let mut perms = PermissionChecker::new();
        let mut hooks = HookManager::new();

        reg.install(
            make_manifest("com.test.ssh", "SSH Helper"),
            None,
            None,
            &mut perms,
            &mut hooks,
        )
        .unwrap();
        reg.install(
            make_manifest("com.test.rdp", "RDP Tool"),
            None,
            None,
            &mut perms,
            &mut hooks,
        )
        .unwrap();

        let results = reg.list_extensions(&ExtensionFilter {
            query: Some("ssh".into()),
            ..Default::default()
        });
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "com.test.ssh");
    }

    #[test]
    fn stats_generation() {
        let mut reg = ExtensionRegistry::new();
        let mut perms = PermissionChecker::new();
        let mut hooks = HookManager::new();

        reg.install(
            make_manifest("com.test.a", "A"),
            None,
            None,
            &mut perms,
            &mut hooks,
        )
        .unwrap();
        reg.install(
            make_manifest("com.test.b", "B"),
            None,
            None,
            &mut perms,
            &mut hooks,
        )
        .unwrap();
        reg.enable("com.test.a").unwrap();
        reg.record_execution("com.test.a", 50).unwrap();

        let stats = reg.stats();
        assert_eq!(stats.total_installed, 2);
        assert_eq!(stats.total_enabled, 1);
        assert_eq!(stats.total_executions, 1);
    }

    #[test]
    fn audit_log_tracks_actions() {
        let mut reg = ExtensionRegistry::new();
        let mut perms = PermissionChecker::new();
        let mut hooks = HookManager::new();

        reg.install(
            make_manifest("com.test.ext", "Ext"),
            None,
            None,
            &mut perms,
            &mut hooks,
        )
        .unwrap();
        reg.enable("com.test.ext").unwrap();
        reg.disable("com.test.ext").unwrap();
        reg.uninstall("com.test.ext", &mut perms, &mut hooks)
            .unwrap();

        let log = reg.audit_log();
        assert_eq!(log.len(), 4); // install, enable, disable, uninstall
        assert_eq!(log[0].action, "install");
        assert_eq!(log[1].action, "enable");
        assert_eq!(log[2].action, "disable");
        assert_eq!(log[3].action, "uninstall");
    }

    #[test]
    fn audit_log_trimming() {
        let mut reg = ExtensionRegistry::with_limits(100, 3);
        let mut perms = PermissionChecker::new();
        let mut hooks = HookManager::new();

        for i in 0..5 {
            let id = format!("com.test.ext{}", i);
            reg.install(
                make_manifest(&id, &format!("Ext {}", i)),
                None,
                None,
                &mut perms,
                &mut hooks,
            )
            .unwrap();
        }

        assert!(reg.audit_log().len() <= 3);
    }

    #[test]
    fn extension_ids_list() {
        let mut reg = ExtensionRegistry::new();
        let mut perms = PermissionChecker::new();
        let mut hooks = HookManager::new();

        reg.install(
            make_manifest("com.a", "A"),
            None,
            None,
            &mut perms,
            &mut hooks,
        )
        .unwrap();
        reg.install(
            make_manifest("com.b", "B"),
            None,
            None,
            &mut perms,
            &mut hooks,
        )
        .unwrap();

        let ids = reg.extension_ids();
        assert_eq!(ids.len(), 2);
    }

    #[test]
    fn install_with_script_computes_hash() {
        let mut reg = ExtensionRegistry::new();
        let mut perms = PermissionChecker::new();
        let mut hooks = HookManager::new();

        reg.install(
            make_manifest("com.test.ext", "Ext"),
            Some(r#"{"handlers":{},"init":[],"cleanup":[]}"#.into()),
            None,
            &mut perms,
            &mut hooks,
        )
        .unwrap();

        let state = reg.get("com.test.ext").unwrap();
        assert!(state.script_hash.is_some());
        assert!(!state.script_hash.as_ref().unwrap().is_empty());
    }

    #[test]
    fn default_constructor() {
        let reg = ExtensionRegistry::default();
        assert_eq!(reg.count(), 0);
    }

    #[test]
    fn count_by_status() {
        let mut reg = ExtensionRegistry::new();
        let mut perms = PermissionChecker::new();
        let mut hooks = HookManager::new();

        reg.install(
            make_manifest("com.a", "A"),
            None,
            None,
            &mut perms,
            &mut hooks,
        )
        .unwrap();
        reg.install(
            make_manifest("com.b", "B"),
            None,
            None,
            &mut perms,
            &mut hooks,
        )
        .unwrap();
        reg.install(
            make_manifest("com.c", "C"),
            None,
            None,
            &mut perms,
            &mut hooks,
        )
        .unwrap();
        reg.enable("com.a").unwrap();
        reg.enable("com.b").unwrap();
        reg.mark_error("com.c", "broken").unwrap();

        assert_eq!(reg.count_by_status(ExtensionStatus::Enabled), 2);
        assert_eq!(reg.count_by_status(ExtensionStatus::Error), 1);
    }
}
