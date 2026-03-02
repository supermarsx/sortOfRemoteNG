//! Service façade for the extensions engine.
//!
//! Aggregates [`ExtensionRegistry`], [`PermissionChecker`],
//! [`HookManager`], [`ExtensionStorage`], [`ApiRegistry`], and
//! [`EngineConfig`] behind a single `Arc<Mutex<..>>` state that
//! Tauri can manage.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::api::ApiRegistry;
use crate::hooks::{event_to_key, HookManager};
use crate::manifest::{create_manifest, parse_manifest, serialize_manifest, validate_manifest};
use crate::permissions::PermissionChecker;
use crate::registry::ExtensionRegistry;
use crate::runtime::{parse_script, RuntimeEnv, ScriptInterpreter};
use crate::sandbox::Sandbox;
use crate::storage::ExtensionStorage;
use crate::types::*;

/// Type alias for the Tauri managed state.
pub type ExtensionsServiceState = Arc<Mutex<ExtensionsService>>;

/// Top-level service combining all sub-systems.
pub struct ExtensionsService {
    pub registry: ExtensionRegistry,
    pub permissions: PermissionChecker,
    pub hooks: HookManager,
    pub storage: ExtensionStorage,
    pub api_registry: ApiRegistry,
    pub config: EngineConfig,
}

impl ExtensionsService {
    /// Create a new `ExtensionsService` wrapped in `Arc<Mutex<..>>`.
    pub fn new() -> ExtensionsServiceState {
        let service = Self {
            registry: ExtensionRegistry::new(),
            permissions: PermissionChecker::new(),
            hooks: HookManager::new(),
            storage: ExtensionStorage::new(),
            api_registry: ApiRegistry::new(),
            config: EngineConfig::default(),
        };
        Arc::new(Mutex::new(service))
    }

    /// Create with custom config.
    pub fn with_config(config: EngineConfig) -> ExtensionsServiceState {
        let service = Self {
            registry: ExtensionRegistry::with_limits(
                config.max_extensions,
                5000,
            ),
            permissions: PermissionChecker::new(),
            hooks: HookManager::new(),
            storage: ExtensionStorage::with_limits(
                config.max_storage_per_extension_bytes as usize,
                10_000,
                (config.max_storage_per_extension_bytes as usize) * config.max_extensions,
            ),
            api_registry: ApiRegistry::new(),
            config,
        };
        Arc::new(Mutex::new(service))
    }

    // ── Extension Lifecycle ─────────────────────────────────────

    /// Install an extension from manifest JSON and optional script JSON.
    pub fn install_extension(
        &mut self,
        manifest_json: &str,
        script_source: Option<String>,
        sandbox_config: Option<SandboxConfig>,
    ) -> ExtResult<String> {
        let manifest = parse_manifest(manifest_json)?;
        self.registry.install(
            manifest,
            script_source,
            sandbox_config,
            &mut self.permissions,
            &mut self.hooks,
        )
    }

    /// Install from a structured manifest.
    pub fn install_extension_manifest(
        &mut self,
        manifest: ExtensionManifest,
        script_source: Option<String>,
        sandbox_config: Option<SandboxConfig>,
    ) -> ExtResult<String> {
        self.registry.install(
            manifest,
            script_source,
            sandbox_config,
            &mut self.permissions,
            &mut self.hooks,
        )
    }

    /// Enable an extension.
    pub fn enable_extension(&mut self, extension_id: &str) -> ExtResult<()> {
        self.registry.enable(extension_id)
    }

    /// Disable an extension.
    pub fn disable_extension(&mut self, extension_id: &str) -> ExtResult<()> {
        self.registry.disable(extension_id)
    }

    /// Uninstall an extension, cleaning up all associated data.
    pub fn uninstall_extension(&mut self, extension_id: &str) -> ExtResult<()> {
        self.registry
            .uninstall(extension_id, &mut self.permissions, &mut self.hooks)?;
        self.storage.remove_extension(extension_id);
        Ok(())
    }

    /// Update an extension.
    pub fn update_extension(
        &mut self,
        extension_id: &str,
        manifest_json: &str,
        new_script_source: Option<String>,
    ) -> ExtResult<()> {
        let manifest = parse_manifest(manifest_json)?;
        self.registry.update(
            extension_id,
            manifest,
            new_script_source,
            &mut self.permissions,
            &mut self.hooks,
        )
    }

    // ── Execution ───────────────────────────────────────────────

    /// Execute a handler on an enabled extension.
    pub fn execute_handler(
        &mut self,
        extension_id: &str,
        handler_name: &str,
        args: HashMap<String, ScriptValue>,
    ) -> ExtResult<ExecutionResult> {
        let state = self
            .registry
            .get(extension_id)
            .ok_or_else(|| ExtError::not_found(extension_id))?;

        if state.status != ExtensionStatus::Enabled {
            return Err(ExtError::new(
                ExtErrorKind::InvalidState,
                format!("Extension '{}' is not enabled", extension_id),
            ));
        }

        let script_src = state
            .script_source
            .as_ref()
            .ok_or_else(|| ExtError::script(format!("Extension '{}' has no script", extension_id)))?;

        let sandbox_config = state.sandbox_config.clone();

        let script = parse_script(script_src)?;
        let interp = ScriptInterpreter::new(script);

        if !interp.has_handler(handler_name) {
            return Err(ExtError::script(format!(
                "Handler '{}' not found in extension '{}'",
                handler_name, extension_id
            )));
        }

        let mut sandbox = Sandbox::new(sandbox_config);
        let mut env = RuntimeEnv::new();

        let result = interp.run_handler(handler_name, args, &mut sandbox, &mut env)?;

        // Record execution.
        let _ = self
            .registry
            .record_execution(extension_id, result.duration_ms);

        if !result.success {
            if let Some(ref err) = result.error {
                let _ = self.registry.mark_error(extension_id, err);
            }
        }

        Ok(result)
    }

    // ── Hook Dispatch ───────────────────────────────────────────

    /// Dispatch a hook event, executing all registered handlers.
    pub fn dispatch_event(
        &mut self,
        event: &HookEvent,
        payload: Option<HashMap<String, ScriptValue>>,
    ) -> Vec<HookResult> {
        let listeners = self.hooks.listeners_for(event);
        let mut results = Vec::new();

        for (ext_id, handler_name) in listeners {
            if !self.registry.is_enabled(&ext_id) {
                continue;
            }

            let args = payload.clone().unwrap_or_default();
            let start = std::time::Instant::now();

            match self.execute_handler(&ext_id, &handler_name, args) {
                Ok(exec_result) => {
                    let duration_ms = start.elapsed().as_millis() as u64;
                    self.hooks
                        .record_dispatch(event, &ext_id, &handler_name, exec_result.success, exec_result.error.clone());

                    results.push(HookResult {
                        extension_id: ext_id,
                        hook_event: event_to_key(event),
                        handler: handler_name.clone(),
                        success: exec_result.success,
                        output: exec_result.output,
                        error: exec_result.error,
                        duration_ms,
                    });
                }
                Err(e) => {
                    let duration_ms = start.elapsed().as_millis() as u64;
                    self.hooks
                        .record_dispatch(event, &ext_id, &handler_name, false, Some(e.message.clone()));

                    results.push(HookResult {
                        extension_id: ext_id,
                        hook_event: event_to_key(event),
                        handler: handler_name,
                        success: false,
                        output: None,
                        error: Some(e.message),
                        duration_ms,
                    });
                }
            }
        }

        results
    }

    // ── Storage ─────────────────────────────────────────────────

    /// Get a value from extension storage.
    pub fn storage_get(
        &self,
        extension_id: &str,
        key: &str,
    ) -> ExtResult<Option<serde_json::Value>> {
        self.permissions
            .enforce(extension_id, &Permission::StorageRead)?;
        Ok(self.storage.get_value(extension_id, key))
    }

    /// Set a value in extension storage.
    pub fn storage_set(
        &mut self,
        extension_id: &str,
        key: &str,
        value: serde_json::Value,
    ) -> ExtResult<()> {
        self.permissions
            .enforce(extension_id, &Permission::StorageWrite)?;
        self.storage.set(extension_id, key, value)
    }

    /// Delete a value from extension storage.
    pub fn storage_delete(
        &mut self,
        extension_id: &str,
        key: &str,
    ) -> ExtResult<bool> {
        self.permissions
            .enforce(extension_id, &Permission::StorageWrite)?;
        Ok(self.storage.delete(extension_id, key))
    }

    /// List storage keys for an extension.
    pub fn storage_list_keys(&self, extension_id: &str) -> ExtResult<Vec<String>> {
        self.permissions
            .enforce(extension_id, &Permission::StorageRead)?;
        Ok(self.storage.list_keys(extension_id))
    }

    /// Clear all storage for an extension.
    pub fn storage_clear(&mut self, extension_id: &str) -> ExtResult<usize> {
        self.permissions
            .enforce(extension_id, &Permission::StorageWrite)?;
        Ok(self.storage.clear(extension_id))
    }

    /// Export extension storage as JSON.
    pub fn storage_export(&self, extension_id: &str) -> serde_json::Value {
        self.storage.export(extension_id)
    }

    /// Import extension storage from JSON.
    pub fn storage_import(
        &mut self,
        extension_id: &str,
        data: serde_json::Value,
    ) -> ExtResult<usize> {
        self.storage.import(extension_id, data)
    }

    // ── Settings ────────────────────────────────────────────────

    /// Get an extension setting.
    pub fn get_setting(
        &self,
        extension_id: &str,
        key: &str,
    ) -> ExtResult<Option<serde_json::Value>> {
        self.registry.get_setting(extension_id, key)
    }

    /// Set an extension setting.
    pub fn set_setting(
        &mut self,
        extension_id: &str,
        key: &str,
        value: serde_json::Value,
    ) -> ExtResult<()> {
        self.registry.set_setting(extension_id, key, value)
    }

    // ── Query / Listing ─────────────────────────────────────────

    /// Get details of a single extension.
    pub fn get_extension(&self, extension_id: &str) -> Option<&ExtensionState> {
        self.registry.get(extension_id)
    }

    /// List extensions with a filter.
    pub fn list_extensions(&self, filter: &ExtensionFilter) -> Vec<ExtensionSummary> {
        self.registry.list_extensions(filter)
    }

    /// Get engine statistics.
    pub fn engine_stats(&self) -> EngineStats {
        let mut stats = self.registry.stats();
        stats.total_storage_bytes = self.storage.total_size_bytes() as u64;
        stats
    }

    /// Get the API documentation.
    pub fn api_documentation(&self) -> Vec<crate::api::ApiFunctionDoc> {
        self.api_registry.documentation()
    }

    /// Get available permission groups.
    pub fn permission_groups(&self) -> Vec<PermissionGroup> {
        crate::permissions::builtin_permission_groups()
    }

    /// Get the config.
    pub fn config(&self) -> &EngineConfig {
        &self.config
    }

    /// Update the config.
    pub fn update_config(&mut self, config: EngineConfig) {
        self.config = config;
    }

    /// Validate a manifest JSON without installing.
    pub fn validate_manifest_json(&self, json: &str) -> ExtResult<ExtensionManifest> {
        let manifest = parse_manifest(json)?;
        validate_manifest(&manifest)?;
        Ok(manifest)
    }

    /// Create a new manifest from basic info.
    pub fn create_manifest_template(
        &self,
        id: String,
        name: String,
        version: String,
        description: String,
        author: String,
        extension_type: ExtensionType,
    ) -> ExtensionManifest {
        create_manifest(id, name, version, description, author, extension_type)
    }

    /// Serialize a manifest to JSON.
    pub fn serialize_manifest(&self, manifest: &ExtensionManifest) -> ExtResult<String> {
        serialize_manifest(manifest)
    }

    /// Get a storage summary for a specific extension.
    pub fn storage_summary(&self, extension_id: &str) -> StorageSummary {
        self.storage.extension_summary(extension_id)
    }

    /// Get audit log entries.
    pub fn audit_log(&self) -> &[AuditEntry] {
        self.registry.audit_log()
    }

    /// Get hook dispatch log.
    pub fn dispatch_log(&self) -> &[crate::hooks::DispatchRecord] {
        self.hooks.dispatch_log()
    }
}

// ─── Tests ──────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn blocking_lock(
        state: &ExtensionsServiceState,
    ) -> tokio::sync::MutexGuard<'_, ExtensionsService> {
        state.blocking_lock()
    }

    fn sample_manifest_json() -> String {
        serde_json::json!({
            "id": "com.test.hello",
            "name": "Hello Extension",
            "version": "1.0.0",
            "description": "A test extension",
            "author": "Test Author",
            "extension_type": "Tool",
            "permissions": ["StorageRead", "StorageWrite", "EventSubscribe"],
            "hooks": [],
            "entry_point": "main.json",
            "dependencies": [],
            "tags": ["test"],
            "keywords": [],
            "settings_schema": [],
            "created_at": "2025-01-01T00:00:00Z",
            "updated_at": "2025-01-01T00:00:00Z"
        })
        .to_string()
    }

    fn sample_script_json() -> String {
        serde_json::json!({
            "handlers": {
                "on_hello": [
                    { "SetVar": { "name": "greeting", "value": { "String": "Hello, World!" } } },
                    { "Return": { "value": { "String": "$greeting" } } }
                ]
            },
            "init": [],
            "cleanup": []
        })
        .to_string()
    }

    #[test]
    fn new_service_creates_state() {
        let state = ExtensionsService::new();
        let svc = blocking_lock(&state);
        assert_eq!(svc.registry.count(), 0);
    }

    #[test]
    fn install_enable_execute() {
        let state = ExtensionsService::new();
        let mut svc = blocking_lock(&state);

        let id = svc
            .install_extension(&sample_manifest_json(), Some(sample_script_json()), None)
            .unwrap();
        assert_eq!(id, "com.test.hello");

        svc.enable_extension("com.test.hello").unwrap();

        let result = svc
            .execute_handler("com.test.hello", "on_hello", HashMap::new())
            .unwrap();
        assert!(result.success);
        assert_eq!(result.output, Some(serde_json::json!("Hello, World!")));
    }

    #[test]
    fn install_disable_uninstall() {
        let state = ExtensionsService::new();
        let mut svc = blocking_lock(&state);

        svc.install_extension(&sample_manifest_json(), None, None)
            .unwrap();
        svc.enable_extension("com.test.hello").unwrap();
        svc.disable_extension("com.test.hello").unwrap();
        svc.uninstall_extension("com.test.hello").unwrap();

        assert_eq!(svc.registry.count(), 0);
    }

    #[test]
    fn execute_disabled_extension_fails() {
        let state = ExtensionsService::new();
        let mut svc = blocking_lock(&state);

        svc.install_extension(&sample_manifest_json(), Some(sample_script_json()), None)
            .unwrap();

        // Not enabled – should fail.
        let result = svc.execute_handler("com.test.hello", "on_hello", HashMap::new());
        assert!(result.is_err());
    }

    #[test]
    fn storage_operations() {
        let state = ExtensionsService::new();
        let mut svc = blocking_lock(&state);

        svc.install_extension(&sample_manifest_json(), None, None)
            .unwrap();

        svc.storage_set("com.test.hello", "key", serde_json::json!("val"))
            .unwrap();
        let val = svc.storage_get("com.test.hello", "key").unwrap();
        assert_eq!(val, Some(serde_json::json!("val")));

        let keys = svc.storage_list_keys("com.test.hello").unwrap();
        assert_eq!(keys, vec!["key"]);

        svc.storage_delete("com.test.hello", "key").unwrap();
        let val = svc.storage_get("com.test.hello", "key").unwrap();
        assert_eq!(val, None);
    }

    #[test]
    fn settings_operations() {
        let state = ExtensionsService::new();
        let mut svc = blocking_lock(&state);

        svc.install_extension(&sample_manifest_json(), None, None)
            .unwrap();

        svc.set_setting("com.test.hello", "theme", serde_json::json!("dark"))
            .unwrap();
        let val = svc.get_setting("com.test.hello", "theme").unwrap();
        assert_eq!(val, Some(serde_json::json!("dark")));
    }

    #[test]
    fn list_extensions() {
        let state = ExtensionsService::new();
        let mut svc = blocking_lock(&state);

        svc.install_extension(&sample_manifest_json(), None, None)
            .unwrap();

        let list = svc.list_extensions(&ExtensionFilter::default());
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, "com.test.hello");
    }

    #[test]
    fn engine_stats() {
        let state = ExtensionsService::new();
        let mut svc = blocking_lock(&state);

        svc.install_extension(&sample_manifest_json(), None, None)
            .unwrap();

        let stats = svc.engine_stats();
        assert_eq!(stats.total_installed, 1);
    }

    #[test]
    fn validate_manifest_without_install() {
        let state = ExtensionsService::new();
        let svc = blocking_lock(&state);

        let manifest = svc.validate_manifest_json(&sample_manifest_json()).unwrap();
        assert_eq!(manifest.id, "com.test.hello");
    }

    #[test]
    fn create_and_serialize_manifest() {
        let state = ExtensionsService::new();
        let svc = blocking_lock(&state);

        let manifest = svc.create_manifest_template(
            "com.test.new".into(),
            "New Ext".into(),
            "1.0.0".into(),
            "A new extension".into(),
            "Author".into(),
            ExtensionType::Tool,
        );

        let json = svc.serialize_manifest(&manifest).unwrap();
        assert!(json.contains("com.test.new"));
    }

    #[test]
    fn api_documentation() {
        let state = ExtensionsService::new();
        let svc = blocking_lock(&state);
        let docs = svc.api_documentation();
        assert!(!docs.is_empty());
    }

    #[test]
    fn permission_groups() {
        let state = ExtensionsService::new();
        let svc = blocking_lock(&state);
        let groups = svc.permission_groups();
        assert!(!groups.is_empty());
    }

    #[test]
    fn update_config() {
        let state = ExtensionsService::new();
        let mut svc = blocking_lock(&state);

        let mut config = svc.config().clone();
        config.max_extensions = 50;
        svc.update_config(config);

        assert_eq!(svc.config().max_extensions, 50);
    }

    #[test]
    fn uninstall_clears_storage() {
        let state = ExtensionsService::new();
        let mut svc = blocking_lock(&state);

        svc.install_extension(&sample_manifest_json(), None, None)
            .unwrap();
        svc.storage_set("com.test.hello", "data", serde_json::json!(42))
            .unwrap();

        svc.uninstall_extension("com.test.hello").unwrap();
        assert_eq!(svc.storage.key_count("com.test.hello"), 0);
    }

    #[test]
    fn with_config_constructor() {
        let config = EngineConfig {
            max_extensions: 5,
            ..Default::default()
        };
        let state = ExtensionsService::with_config(config);
        let svc = blocking_lock(&state);
        assert_eq!(svc.config().max_extensions, 5);
    }
}
