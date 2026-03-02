//! Extension API surface.
//!
//! Defines the set of API functions that extensions can call, organised
//! by [`ApiCategory`].  Each function is permission-gated and documented
//! with parameter/return descriptions.

use std::collections::HashMap;

use crate::permissions::PermissionChecker;
use crate::types::*;

// ─── Helpers ────────────────────────────────────────────────────────

/// Shorthand for building an [`ApiParameter`] with type `"string"`.
fn param(name: &str, desc: &str, required: bool) -> ApiParameter {
    ApiParameter {
        name: name.into(),
        description: desc.into(),
        param_type: "string".into(),
        required,
        default_value: None,
    }
}

/// Shorthand for building an [`ApiParameter`] with a custom type.
fn param_typed(name: &str, desc: &str, ptype: &str, required: bool) -> ApiParameter {
    ApiParameter {
        name: name.into(),
        description: desc.into(),
        param_type: ptype.into(),
        required,
        default_value: None,
    }
}

// ─── ApiRegistry ────────────────────────────────────────────────────

/// Registry of API functions available to extensions.
#[derive(Debug, Clone)]
pub struct ApiRegistry {
    /// All registered API functions, keyed by fully-qualified name.
    functions: HashMap<String, ApiFunction>,
}

impl ApiRegistry {
    /// Create a registry pre-populated with the built-in API surface.
    pub fn new() -> Self {
        let mut reg = Self {
            functions: HashMap::new(),
        };
        reg.register_builtins();
        reg
    }

    /// Register a single API function.
    pub fn register(&mut self, func: ApiFunction) {
        self.functions.insert(func.name.clone(), func);
    }

    /// Unregister an API function by name.
    pub fn unregister(&mut self, name: &str) -> bool {
        self.functions.remove(name).is_some()
    }

    /// Look up an API function.
    pub fn get(&self, name: &str) -> Option<&ApiFunction> {
        self.functions.get(name)
    }

    /// List all registered function names.
    pub fn function_names(&self) -> Vec<String> {
        let mut names: Vec<_> = self.functions.keys().cloned().collect();
        names.sort();
        names
    }

    /// List functions by category.
    pub fn functions_by_category(&self, category: &ApiCategory) -> Vec<&ApiFunction> {
        self.functions
            .values()
            .filter(|f| &f.category == category)
            .collect()
    }

    /// List all categories that have at least one function.
    pub fn categories(&self) -> Vec<ApiCategory> {
        let mut cats: Vec<ApiCategory> = self
            .functions
            .values()
            .map(|f| f.category.clone())
            .collect::<std::collections::HashSet<_>>()
            .into_iter()
            .collect();
        cats.sort_by(|a, b| format!("{:?}", a).cmp(&format!("{:?}", b)));
        cats
    }

    /// Total number of registered functions.
    pub fn count(&self) -> usize {
        self.functions.len()
    }

    /// Check whether an extension has permission to call a given API
    /// function.
    pub fn check_access(
        &self,
        function_name: &str,
        extension_id: &str,
        perm_checker: &PermissionChecker,
    ) -> ExtResult<()> {
        let func = self
            .functions
            .get(function_name)
            .ok_or_else(|| ExtError::api_unavailable(format!("API '{}' not found", function_name)))?;

        for perm in &func.required_permissions {
            perm_checker.enforce(extension_id, perm)?;
        }

        Ok(())
    }

    /// Get the documentation for all API functions, suitable for
    /// presenting to extension authors.
    pub fn documentation(&self) -> Vec<ApiFunctionDoc> {
        let mut docs: Vec<ApiFunctionDoc> = self
            .functions
            .values()
            .map(|f| ApiFunctionDoc {
                name: f.name.clone(),
                category: f.category.clone(),
                description: f.description.clone(),
                parameters: f.parameters.clone(),
                returns: f.returns.clone(),
                required_permissions: f.required_permissions.clone(),
            })
            .collect();
        docs.sort_by(|a, b| a.name.cmp(&b.name));
        docs
    }

    // ── Built-in Registrations ──────────────────────────────────

    fn register_builtins(&mut self) {
        // ── Storage APIs ────────────────────────────────────────
        self.register(ApiFunction {
            name: "storage.get".into(),
            category: ApiCategory::Storage,
            description: "Read a value from extension storage".into(),
            parameters: vec![param("key", "Storage key", true)],
            required_permissions: vec![Permission::StorageRead],
            returns: Some("any | null".into()),
        });

        self.register(ApiFunction {
            name: "storage.set".into(),
            category: ApiCategory::Storage,
            description: "Write a value to extension storage".into(),
            parameters: vec![
                param("key", "Storage key", true),
                param_typed("value", "Value to store", "any", true),
            ],
            required_permissions: vec![Permission::StorageWrite],
            returns: Some("void".into()),
        });

        self.register(ApiFunction {
            name: "storage.delete".into(),
            category: ApiCategory::Storage,
            description: "Delete a value from extension storage".into(),
            parameters: vec![param("key", "Storage key to delete", true)],
            required_permissions: vec![Permission::StorageWrite],
            returns: Some("bool".into()),
        });

        self.register(ApiFunction {
            name: "storage.list".into(),
            category: ApiCategory::Storage,
            description: "List all storage keys for this extension".into(),
            parameters: vec![],
            required_permissions: vec![Permission::StorageRead],
            returns: Some("string[]".into()),
        });

        self.register(ApiFunction {
            name: "storage.clear".into(),
            category: ApiCategory::Storage,
            description: "Clear all storage for this extension".into(),
            parameters: vec![],
            required_permissions: vec![Permission::StorageWrite],
            returns: Some("void".into()),
        });

        // ── HTTP APIs ───────────────────────────────────────────
        self.register(ApiFunction {
            name: "http.get".into(),
            category: ApiCategory::Http,
            description: "Perform an HTTP GET request".into(),
            parameters: vec![
                param("url", "Request URL", true),
                param_typed("headers", "Request headers (object)", "object", false),
            ],
            required_permissions: vec![Permission::NetworkHttp],
            returns: Some("{ status: number, body: string, headers: object }".into()),
        });

        self.register(ApiFunction {
            name: "http.post".into(),
            category: ApiCategory::Http,
            description: "Perform an HTTP POST request".into(),
            parameters: vec![
                param("url", "Request URL", true),
                param_typed("body", "Request body (string or object)", "any", false),
                param_typed("headers", "Request headers (object)", "object", false),
            ],
            required_permissions: vec![Permission::NetworkHttp],
            returns: Some("{ status: number, body: string, headers: object }".into()),
        });

        self.register(ApiFunction {
            name: "http.put".into(),
            category: ApiCategory::Http,
            description: "Perform an HTTP PUT request".into(),
            parameters: vec![
                param("url", "Request URL", true),
                param_typed("body", "Request body", "any", false),
                param_typed("headers", "Request headers", "object", false),
            ],
            required_permissions: vec![Permission::NetworkHttp],
            returns: Some("{ status: number, body: string, headers: object }".into()),
        });

        self.register(ApiFunction {
            name: "http.delete".into(),
            category: ApiCategory::Http,
            description: "Perform an HTTP DELETE request".into(),
            parameters: vec![
                param("url", "Request URL", true),
                param_typed("headers", "Request headers", "object", false),
            ],
            required_permissions: vec![Permission::NetworkHttp],
            returns: Some("{ status: number, body: string, headers: object }".into()),
        });

        // ── Connection APIs ─────────────────────────────────────
        self.register(ApiFunction {
            name: "connections.list".into(),
            category: ApiCategory::Connections,
            description: "List all connections visible to the extension".into(),
            parameters: vec![param_typed("filter", "Optional filter object", "object", false)],
            required_permissions: vec![Permission::ConnectionRead],
            returns: Some("Connection[]".into()),
        });

        self.register(ApiFunction {
            name: "connections.get".into(),
            category: ApiCategory::Connections,
            description: "Get a specific connection by ID".into(),
            parameters: vec![param("id", "Connection ID", true)],
            required_permissions: vec![Permission::ConnectionRead],
            returns: Some("Connection | null".into()),
        });

        self.register(ApiFunction {
            name: "connections.create".into(),
            category: ApiCategory::Connections,
            description: "Create a new connection".into(),
            parameters: vec![param_typed("connection", "Connection data object", "object", true)],
            required_permissions: vec![Permission::ConnectionWrite],
            returns: Some("string".into()),
        });

        self.register(ApiFunction {
            name: "connections.update".into(),
            category: ApiCategory::Connections,
            description: "Update an existing connection".into(),
            parameters: vec![
                param("id", "Connection ID", true),
                param_typed("updates", "Fields to update", "object", true),
            ],
            required_permissions: vec![Permission::ConnectionWrite],
            returns: Some("void".into()),
        });

        self.register(ApiFunction {
            name: "connections.connect".into(),
            category: ApiCategory::Connections,
            description: "Open a connection".into(),
            parameters: vec![param("id", "Connection ID", true)],
            required_permissions: vec![Permission::ConnectionConnect],
            returns: Some("void".into()),
        });

        // ── Event APIs ──────────────────────────────────────────
        self.register(ApiFunction {
            name: "events.emit".into(),
            category: ApiCategory::Events,
            description: "Emit a custom event".into(),
            parameters: vec![
                param("event", "Event name", true),
                param_typed("data", "Event data", "any", false),
            ],
            required_permissions: vec![Permission::EventEmit],
            returns: Some("void".into()),
        });

        self.register(ApiFunction {
            name: "events.subscribe".into(),
            category: ApiCategory::Events,
            description: "Subscribe to an event".into(),
            parameters: vec![
                param("event", "Event name", true),
                param("handler", "Handler name", true),
            ],
            required_permissions: vec![Permission::EventSubscribe],
            returns: Some("void".into()),
        });

        // ── Notification APIs ───────────────────────────────────
        self.register(ApiFunction {
            name: "notification.send".into(),
            category: ApiCategory::Notifications,
            description: "Send a desktop notification".into(),
            parameters: vec![
                param("title", "Notification title", true),
                param("body", "Notification body", true),
                param("icon", "Optional icon path", false),
            ],
            required_permissions: vec![Permission::NotificationSend],
            returns: Some("void".into()),
        });

        // ── Crypto APIs ─────────────────────────────────────────
        self.register(ApiFunction {
            name: "crypto.hash".into(),
            category: ApiCategory::Crypto,
            description: "Compute a SHA-256 hash".into(),
            parameters: vec![param("data", "Data to hash (string)", true)],
            required_permissions: vec![Permission::CryptoAccess],
            returns: Some("string".into()),
        });

        self.register(ApiFunction {
            name: "crypto.random_uuid".into(),
            category: ApiCategory::Crypto,
            description: "Generate a random UUID v4".into(),
            parameters: vec![],
            required_permissions: vec![Permission::CryptoAccess],
            returns: Some("string".into()),
        });

        self.register(ApiFunction {
            name: "crypto.random_bytes".into(),
            category: ApiCategory::Crypto,
            description: "Generate random bytes (base64-encoded)".into(),
            parameters: vec![param_typed("count", "Number of bytes", "number", true)],
            required_permissions: vec![Permission::CryptoAccess],
            returns: Some("string".into()),
        });

        // ── Utility APIs ────────────────────────────────────────
        self.register(ApiFunction {
            name: "util.uuid".into(),
            category: ApiCategory::Utility,
            description: "Generate a UUID v4".into(),
            parameters: vec![],
            required_permissions: vec![],
            returns: Some("string".into()),
        });

        self.register(ApiFunction {
            name: "util.timestamp".into(),
            category: ApiCategory::Utility,
            description: "Get current ISO-8601 timestamp".into(),
            parameters: vec![],
            required_permissions: vec![],
            returns: Some("string".into()),
        });

        self.register(ApiFunction {
            name: "util.unix_time".into(),
            category: ApiCategory::Utility,
            description: "Get current UNIX timestamp (seconds)".into(),
            parameters: vec![],
            required_permissions: vec![],
            returns: Some("number".into()),
        });

        self.register(ApiFunction {
            name: "util.sleep".into(),
            category: ApiCategory::Utility,
            description: "Sleep for a given number of milliseconds".into(),
            parameters: vec![param_typed("ms", "Milliseconds to sleep", "number", true)],
            required_permissions: vec![],
            returns: Some("void".into()),
        });

        // ── Logging APIs ────────────────────────────────────────
        self.register(ApiFunction {
            name: "log.debug".into(),
            category: ApiCategory::Logging,
            description: "Log a debug message".into(),
            parameters: vec![param("message", "Message to log", true)],
            required_permissions: vec![],
            returns: Some("void".into()),
        });

        self.register(ApiFunction {
            name: "log.info".into(),
            category: ApiCategory::Logging,
            description: "Log an info message".into(),
            parameters: vec![param("message", "Message to log", true)],
            required_permissions: vec![],
            returns: Some("void".into()),
        });

        self.register(ApiFunction {
            name: "log.warn".into(),
            category: ApiCategory::Logging,
            description: "Log a warning message".into(),
            parameters: vec![param("message", "Message to log", true)],
            required_permissions: vec![],
            returns: Some("void".into()),
        });

        self.register(ApiFunction {
            name: "log.error".into(),
            category: ApiCategory::Logging,
            description: "Log an error message".into(),
            parameters: vec![param("message", "Message to log", true)],
            required_permissions: vec![],
            returns: Some("void".into()),
        });

        // ── Settings APIs ───────────────────────────────────────
        self.register(ApiFunction {
            name: "settings.get".into(),
            category: ApiCategory::Settings,
            description: "Get an extension setting value".into(),
            parameters: vec![param("key", "Setting key", true)],
            required_permissions: vec![Permission::SettingsRead],
            returns: Some("any | null".into()),
        });

        self.register(ApiFunction {
            name: "settings.set".into(),
            category: ApiCategory::Settings,
            description: "Set an extension setting value".into(),
            parameters: vec![
                param("key", "Setting key", true),
                param_typed("value", "Setting value", "any", true),
            ],
            required_permissions: vec![Permission::SettingsWrite],
            returns: Some("void".into()),
        });

        self.register(ApiFunction {
            name: "settings.list".into(),
            category: ApiCategory::Settings,
            description: "List all extension setting keys".into(),
            parameters: vec![],
            required_permissions: vec![Permission::SettingsRead],
            returns: Some("string[]".into()),
        });

        // ── UI APIs ─────────────────────────────────────────────
        self.register(ApiFunction {
            name: "ui.dialog".into(),
            category: ApiCategory::Ui,
            description: "Show a dialog box to the user".into(),
            parameters: vec![
                param("title", "Dialog title", true),
                param("message", "Dialog message", true),
                param_typed("buttons", "Array of button labels", "string[]", false),
            ],
            required_permissions: vec![Permission::DialogOpen],
            returns: Some("string".into()),
        });

        self.register(ApiFunction {
            name: "ui.menu_item".into(),
            category: ApiCategory::Ui,
            description: "Add an item to the extension menu".into(),
            parameters: vec![
                param("label", "Menu item label", true),
                param("handler", "Handler function name", true),
                param("icon", "Optional icon", false),
            ],
            required_permissions: vec![Permission::MenuModify],
            returns: Some("void".into()),
        });

        // ── System Info APIs ────────────────────────────────────
        self.register(ApiFunction {
            name: "system.info".into(),
            category: ApiCategory::Utility,
            description: "Get basic system information".into(),
            parameters: vec![],
            required_permissions: vec![Permission::SystemInfo],
            returns: Some("{ os: string, arch: string, hostname: string }".into()),
        });

        self.register(ApiFunction {
            name: "system.clipboard_read".into(),
            category: ApiCategory::Utility,
            description: "Read from the system clipboard".into(),
            parameters: vec![],
            required_permissions: vec![Permission::ClipboardAccess],
            returns: Some("string".into()),
        });

        self.register(ApiFunction {
            name: "system.clipboard_write".into(),
            category: ApiCategory::Utility,
            description: "Write to the system clipboard".into(),
            parameters: vec![param("text", "Text to write", true)],
            required_permissions: vec![Permission::ClipboardAccess],
            returns: Some("void".into()),
        });
    }
}

impl Default for ApiRegistry {
    fn default() -> Self {
        Self::new()
    }
}

// ─── Documentation Type ─────────────────────────────────────────────

/// Documentation entry for an API function.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ApiFunctionDoc {
    pub name: String,
    pub category: ApiCategory,
    pub description: String,
    pub parameters: Vec<ApiParameter>,
    pub returns: Option<String>,
    pub required_permissions: Vec<Permission>,
}

// ─── Tests ──────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn built_in_functions_populated() {
        let reg = ApiRegistry::new();
        assert!(reg.count() > 30);
    }

    #[test]
    fn lookup_function() {
        let reg = ApiRegistry::new();
        let func = reg.get("storage.get").unwrap();
        assert_eq!(func.category, ApiCategory::Storage);
        assert!(!func.required_permissions.is_empty());
    }

    #[test]
    fn lookup_nonexistent() {
        let reg = ApiRegistry::new();
        assert!(reg.get("nonexistent.func").is_none());
    }

    #[test]
    fn function_names_sorted() {
        let reg = ApiRegistry::new();
        let names = reg.function_names();
        let mut sorted = names.clone();
        sorted.sort();
        assert_eq!(names, sorted);
    }

    #[test]
    fn functions_by_category() {
        let reg = ApiRegistry::new();
        let storage_funcs = reg.functions_by_category(&ApiCategory::Storage);
        assert!(storage_funcs.len() >= 4); // get, set, delete, list, clear
    }

    #[test]
    fn categories_list() {
        let reg = ApiRegistry::new();
        let cats = reg.categories();
        assert!(cats.len() >= 5);
    }

    #[test]
    fn register_custom_function() {
        let mut reg = ApiRegistry::new();
        let count_before = reg.count();

        reg.register(ApiFunction {
            name: "custom.my_func".into(),
            category: ApiCategory::Utility,
            description: "Custom function".into(),
            parameters: vec![],
            required_permissions: vec![],
            returns: None,
        });

        assert_eq!(reg.count(), count_before + 1);
        assert!(reg.get("custom.my_func").is_some());
    }

    #[test]
    fn unregister_function() {
        let mut reg = ApiRegistry::new();
        assert!(reg.unregister("storage.get"));
        assert!(reg.get("storage.get").is_none());
        assert!(!reg.unregister("nonexistent"));
    }

    #[test]
    fn check_access_permitted() {
        let reg = ApiRegistry::new();
        let mut checker = PermissionChecker::new();
        checker.grant("ext.a", &[Permission::StorageRead]);

        let result = reg.check_access("storage.get", "ext.a", &checker);
        assert!(result.is_ok());
    }

    #[test]
    fn check_access_denied() {
        let reg = ApiRegistry::new();
        let checker = PermissionChecker::new(); // No permissions.

        let result = reg.check_access("storage.get", "ext.a", &checker);
        assert!(result.is_err());
    }

    #[test]
    fn check_access_no_permission_required() {
        let reg = ApiRegistry::new();
        let checker = PermissionChecker::new();

        let result = reg.check_access("util.uuid", "ext.a", &checker);
        assert!(result.is_ok());
    }

    #[test]
    fn check_access_unknown_function() {
        let reg = ApiRegistry::new();
        let checker = PermissionChecker::new();

        let result = reg.check_access("nonexistent", "ext.a", &checker);
        assert!(result.is_err());
    }

    #[test]
    fn documentation_generated() {
        let reg = ApiRegistry::new();
        let docs = reg.documentation();
        assert!(!docs.is_empty());
        // Should be sorted by name.
        for i in 1..docs.len() {
            assert!(docs[i].name >= docs[i - 1].name);
        }
    }

    #[test]
    fn http_apis_present() {
        let reg = ApiRegistry::new();
        assert!(reg.get("http.get").is_some());
        assert!(reg.get("http.post").is_some());
        assert!(reg.get("http.put").is_some());
        assert!(reg.get("http.delete").is_some());
    }

    #[test]
    fn connection_apis_present() {
        let reg = ApiRegistry::new();
        assert!(reg.get("connections.list").is_some());
        assert!(reg.get("connections.get").is_some());
        assert!(reg.get("connections.create").is_some());
        assert!(reg.get("connections.connect").is_some());
    }

    #[test]
    fn ui_apis_present() {
        let reg = ApiRegistry::new();
        assert!(reg.get("ui.dialog").is_some());
        assert!(reg.get("ui.menu_item").is_some());
    }

    #[test]
    fn logging_apis_no_permission() {
        let reg = ApiRegistry::new();
        for name in &["log.debug", "log.info", "log.warn", "log.error"] {
            let func = reg.get(name).unwrap();
            assert!(func.required_permissions.is_empty());
        }
    }

    #[test]
    fn http_functions_require_network_permission() {
        let reg = ApiRegistry::new();
        let http_get = reg.get("http.get").unwrap();
        assert!(http_get.required_permissions.contains(&Permission::NetworkHttp));

        let storage_get = reg.get("storage.get").unwrap();
        assert!(!storage_get.required_permissions.contains(&Permission::NetworkHttp));
    }

    #[test]
    fn default_constructor() {
        let reg = ApiRegistry::default();
        assert!(reg.count() > 0);
    }
}
