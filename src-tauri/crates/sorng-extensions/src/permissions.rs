//! Permission checking and enforcement for the extensions engine.
//!
//! Provides utilities to check whether an extension holds the required
//! permissions, group common permissions into presets, and enforce
//! permission boundaries during API calls.

use std::collections::{HashMap, HashSet};

use log::warn;

use crate::types::*;

// ─── Built-in permission groups ─────────────────────────────────────

/// Built-in permission presets that extensions can request as a shorthand.
pub fn builtin_permission_groups() -> Vec<PermissionGroup> {
    vec![
        PermissionGroup {
            name: "read-only".into(),
            description: "Read-only access to connections, settings, and events".into(),
            permissions: vec![
                Permission::ConnectionRead,
                Permission::StorageRead,
                Permission::EventSubscribe,
                Permission::SettingsRead,
            ],
        },
        PermissionGroup {
            name: "basic-tool".into(),
            description: "Permissions suitable for a basic utility tool".into(),
            permissions: vec![
                Permission::ConnectionRead,
                Permission::StorageRead,
                Permission::StorageWrite,
                Permission::EventSubscribe,
                Permission::EventEmit,
                Permission::NotificationSend,
            ],
        },
        PermissionGroup {
            name: "connection-provider".into(),
            description: "Permissions for a connection provider extension".into(),
            permissions: vec![
                Permission::ConnectionRead,
                Permission::ConnectionWrite,
                Permission::ConnectionConnect,
                Permission::StorageRead,
                Permission::StorageWrite,
                Permission::NetworkHttp,
                Permission::NetworkTcp,
                Permission::EventSubscribe,
                Permission::EventEmit,
                Permission::NotificationSend,
                Permission::CryptoAccess,
            ],
        },
        PermissionGroup {
            name: "monitor".into(),
            description: "Permissions for a monitoring / health-check extension".into(),
            permissions: vec![
                Permission::ConnectionRead,
                Permission::StorageRead,
                Permission::StorageWrite,
                Permission::NetworkHttp,
                Permission::EventSubscribe,
                Permission::EventEmit,
                Permission::NotificationSend,
                Permission::SystemInfo,
            ],
        },
        PermissionGroup {
            name: "full-access".into(),
            description: "All permissions — use only for trusted extensions".into(),
            permissions: vec![
                Permission::ConnectionRead,
                Permission::ConnectionWrite,
                Permission::ConnectionConnect,
                Permission::StorageRead,
                Permission::StorageWrite,
                Permission::NetworkHttp,
                Permission::NetworkTcp,
                Permission::FileRead,
                Permission::FileWrite,
                Permission::SystemInfo,
                Permission::ProcessExec,
                Permission::EnvRead,
                Permission::ClipboardAccess,
                Permission::NotificationSend,
                Permission::MenuModify,
                Permission::DialogOpen,
                Permission::EventSubscribe,
                Permission::EventEmit,
                Permission::CryptoAccess,
                Permission::SettingsRead,
                Permission::SettingsWrite,
            ],
        },
    ]
}

/// Resolve a permission group name into its constituent permissions.
pub fn resolve_permission_group(name: &str) -> Option<Vec<Permission>> {
    builtin_permission_groups()
        .into_iter()
        .find(|g| g.name == name)
        .map(|g| g.permissions)
}

// ─── Permission Checker ─────────────────────────────────────────────

/// Manages and checks permissions for installed extensions.
#[derive(Debug, Clone)]
pub struct PermissionChecker {
    /// Extension ID → granted permissions.
    grants: HashMap<String, HashSet<Permission>>,
    /// Permissions that are globally denied regardless of grants.
    global_deny: HashSet<Permission>,
}

impl PermissionChecker {
    /// Create a new, empty permission checker.
    pub fn new() -> Self {
        Self {
            grants: HashMap::new(),
            global_deny: HashSet::new(),
        }
    }

    /// Grant a set of permissions to an extension.
    pub fn grant(&mut self, extension_id: &str, permissions: &[Permission]) {
        let set = self.grants.entry(extension_id.to_string()).or_default();
        for perm in permissions {
            set.insert(perm.clone());
        }
    }

    /// Revoke all permissions for an extension.
    pub fn revoke_all(&mut self, extension_id: &str) {
        self.grants.remove(extension_id);
    }

    /// Revoke a specific permission from an extension.
    pub fn revoke(&mut self, extension_id: &str, permission: &Permission) {
        if let Some(set) = self.grants.get_mut(extension_id) {
            set.remove(permission);
        }
    }

    /// Add a permission to the global deny list.
    pub fn deny_globally(&mut self, permission: Permission) {
        self.global_deny.insert(permission);
    }

    /// Remove a permission from the global deny list.
    pub fn allow_globally(&mut self, permission: &Permission) {
        self.global_deny.remove(permission);
    }

    /// Check if an extension has a specific permission.
    pub fn has_permission(&self, extension_id: &str, permission: &Permission) -> bool {
        if self.global_deny.contains(permission) {
            return false;
        }
        self.grants
            .get(extension_id)
            .is_some_and(|set| set.contains(permission))
    }

    /// Check if an extension has ALL of the specified permissions.
    pub fn has_all_permissions(&self, extension_id: &str, permissions: &[Permission]) -> bool {
        permissions
            .iter()
            .all(|p| self.has_permission(extension_id, p))
    }

    /// Check if an extension has ANY of the specified permissions.
    pub fn has_any_permission(&self, extension_id: &str, permissions: &[Permission]) -> bool {
        permissions
            .iter()
            .any(|p| self.has_permission(extension_id, p))
    }

    /// Enforce that an extension has a specific permission, returning an error if not.
    pub fn enforce(&self, extension_id: &str, permission: &Permission) -> ExtResult<()> {
        if !self.has_permission(extension_id, permission) {
            warn!(
                "Permission denied for extension '{}': {:?}",
                extension_id, permission
            );
            return Err(ExtError::permission_denied(format!(
                "Extension '{}' lacks permission: {}",
                extension_id, permission
            ))
            .with_ext(extension_id));
        }
        Ok(())
    }

    /// Enforce that an extension has ALL of the specified permissions.
    pub fn enforce_all(&self, extension_id: &str, permissions: &[Permission]) -> ExtResult<()> {
        for perm in permissions {
            self.enforce(extension_id, perm)?;
        }
        Ok(())
    }

    /// Get all permissions granted to an extension.
    pub fn get_permissions(&self, extension_id: &str) -> Vec<Permission> {
        self.grants
            .get(extension_id)
            .map(|set| set.iter().cloned().collect())
            .unwrap_or_default()
    }

    /// Get the number of extensions tracked.
    pub fn extension_count(&self) -> usize {
        self.grants.len()
    }

    /// Get the global deny list.
    pub fn global_deny_list(&self) -> Vec<Permission> {
        self.global_deny.iter().cloned().collect()
    }

    /// Check whether a permission is dangerous (grants system-level access).
    pub fn is_dangerous(permission: &Permission) -> bool {
        matches!(
            permission,
            Permission::ProcessExec
                | Permission::FileWrite
                | Permission::NetworkTcp
                | Permission::SettingsWrite
                | Permission::ClipboardAccess
                | Permission::EnvRead
        )
    }

    /// Return the list of dangerous permissions in the given set.
    pub fn dangerous_permissions(permissions: &[Permission]) -> Vec<Permission> {
        permissions
            .iter()
            .filter(|p| Self::is_dangerous(p))
            .cloned()
            .collect()
    }

    /// Classify permissions as "safe" and "dangerous" for user review.
    pub fn classify_permissions(permissions: &[Permission]) -> (Vec<Permission>, Vec<Permission>) {
        let mut safe = Vec::new();
        let mut dangerous = Vec::new();
        for perm in permissions {
            if Self::is_dangerous(perm) {
                dangerous.push(perm.clone());
            } else {
                safe.push(perm.clone());
            }
        }
        (safe, dangerous)
    }
}

impl Default for PermissionChecker {
    fn default() -> Self {
        Self::new()
    }
}

// ─── Tests ──────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn grant_and_check_permission() {
        let mut checker = PermissionChecker::new();
        checker.grant(
            "com.test.ext",
            &[Permission::StorageRead, Permission::StorageWrite],
        );

        assert!(checker.has_permission("com.test.ext", &Permission::StorageRead));
        assert!(checker.has_permission("com.test.ext", &Permission::StorageWrite));
        assert!(!checker.has_permission("com.test.ext", &Permission::FileRead));
    }

    #[test]
    fn revoke_permission() {
        let mut checker = PermissionChecker::new();
        checker.grant(
            "com.test.ext",
            &[Permission::StorageRead, Permission::StorageWrite],
        );
        checker.revoke("com.test.ext", &Permission::StorageWrite);

        assert!(checker.has_permission("com.test.ext", &Permission::StorageRead));
        assert!(!checker.has_permission("com.test.ext", &Permission::StorageWrite));
    }

    #[test]
    fn revoke_all() {
        let mut checker = PermissionChecker::new();
        checker.grant(
            "com.test.ext",
            &[Permission::StorageRead, Permission::StorageWrite],
        );
        checker.revoke_all("com.test.ext");

        assert!(!checker.has_permission("com.test.ext", &Permission::StorageRead));
        assert_eq!(checker.get_permissions("com.test.ext").len(), 0);
    }

    #[test]
    fn global_deny_overrides_grant() {
        let mut checker = PermissionChecker::new();
        checker.grant("com.test.ext", &[Permission::ProcessExec]);
        checker.deny_globally(Permission::ProcessExec);

        assert!(!checker.has_permission("com.test.ext", &Permission::ProcessExec));
    }

    #[test]
    fn allow_globally_removes_deny() {
        let mut checker = PermissionChecker::new();
        checker.grant("com.test.ext", &[Permission::ProcessExec]);
        checker.deny_globally(Permission::ProcessExec);
        checker.allow_globally(&Permission::ProcessExec);

        assert!(checker.has_permission("com.test.ext", &Permission::ProcessExec));
    }

    #[test]
    fn has_all_permissions() {
        let mut checker = PermissionChecker::new();
        checker.grant(
            "com.test.ext",
            &[Permission::StorageRead, Permission::StorageWrite],
        );

        assert!(checker.has_all_permissions(
            "com.test.ext",
            &[Permission::StorageRead, Permission::StorageWrite]
        ));
        assert!(!checker.has_all_permissions(
            "com.test.ext",
            &[Permission::StorageRead, Permission::FileRead]
        ));
    }

    #[test]
    fn has_any_permission() {
        let mut checker = PermissionChecker::new();
        checker.grant("com.test.ext", &[Permission::StorageRead]);

        assert!(checker.has_any_permission(
            "com.test.ext",
            &[Permission::StorageRead, Permission::FileRead]
        ));
        assert!(!checker.has_any_permission(
            "com.test.ext",
            &[Permission::FileRead, Permission::FileWrite]
        ));
    }

    #[test]
    fn enforce_success() {
        let mut checker = PermissionChecker::new();
        checker.grant("com.test.ext", &[Permission::StorageRead]);

        assert!(checker
            .enforce("com.test.ext", &Permission::StorageRead)
            .is_ok());
    }

    #[test]
    fn enforce_failure() {
        let checker = PermissionChecker::new();
        let result = checker.enforce("com.test.ext", &Permission::StorageRead);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert_eq!(err.kind, ExtErrorKind::PermissionDenied);
    }

    #[test]
    fn enforce_all_permissions() {
        let mut checker = PermissionChecker::new();
        checker.grant(
            "com.test.ext",
            &[Permission::StorageRead, Permission::StorageWrite],
        );

        assert!(checker
            .enforce_all(
                "com.test.ext",
                &[Permission::StorageRead, Permission::StorageWrite]
            )
            .is_ok());
        assert!(checker
            .enforce_all(
                "com.test.ext",
                &[Permission::StorageRead, Permission::FileRead]
            )
            .is_err());
    }

    #[test]
    fn is_dangerous_check() {
        assert!(PermissionChecker::is_dangerous(&Permission::ProcessExec));
        assert!(PermissionChecker::is_dangerous(&Permission::FileWrite));
        assert!(!PermissionChecker::is_dangerous(&Permission::StorageRead));
        assert!(!PermissionChecker::is_dangerous(
            &Permission::NotificationSend
        ));
    }

    #[test]
    fn classify_permissions_splits() {
        let perms = vec![
            Permission::StorageRead,
            Permission::ProcessExec,
            Permission::NotificationSend,
            Permission::FileWrite,
        ];
        let (safe, dangerous) = PermissionChecker::classify_permissions(&perms);
        assert_eq!(safe.len(), 2);
        assert_eq!(dangerous.len(), 2);
        assert!(dangerous.contains(&Permission::ProcessExec));
        assert!(dangerous.contains(&Permission::FileWrite));
    }

    #[test]
    fn dangerous_permissions_filter() {
        let perms = vec![
            Permission::StorageRead,
            Permission::ProcessExec,
            Permission::EnvRead,
        ];
        let dangerous = PermissionChecker::dangerous_permissions(&perms);
        assert_eq!(dangerous.len(), 2);
    }

    #[test]
    fn builtin_groups_exist() {
        let groups = builtin_permission_groups();
        assert!(groups.len() >= 5);
        let names: Vec<&str> = groups.iter().map(|g| g.name.as_str()).collect();
        assert!(names.contains(&"read-only"));
        assert!(names.contains(&"full-access"));
        assert!(names.contains(&"basic-tool"));
    }

    #[test]
    fn resolve_group_read_only() {
        let perms = resolve_permission_group("read-only").unwrap();
        assert!(perms.contains(&Permission::ConnectionRead));
        assert!(perms.contains(&Permission::StorageRead));
        assert!(!perms.contains(&Permission::StorageWrite));
    }

    #[test]
    fn resolve_group_nonexistent() {
        assert!(resolve_permission_group("nonexistent").is_none());
    }

    #[test]
    fn extension_count() {
        let mut checker = PermissionChecker::new();
        checker.grant("com.test.a", &[Permission::StorageRead]);
        checker.grant("com.test.b", &[Permission::StorageRead]);
        assert_eq!(checker.extension_count(), 2);
    }

    #[test]
    fn get_permissions_empty() {
        let checker = PermissionChecker::new();
        assert!(checker.get_permissions("com.nonexistent").is_empty());
    }

    #[test]
    fn global_deny_list() {
        let mut checker = PermissionChecker::new();
        checker.deny_globally(Permission::ProcessExec);
        checker.deny_globally(Permission::FileWrite);
        let deny = checker.global_deny_list();
        assert_eq!(deny.len(), 2);
    }

    #[test]
    fn unknown_extension_has_no_permissions() {
        let checker = PermissionChecker::new();
        assert!(!checker.has_permission("unknown.ext", &Permission::StorageRead));
        assert!(!checker.has_any_permission("unknown.ext", &[Permission::StorageRead]));
    }

    #[test]
    fn custom_permission() {
        let mut checker = PermissionChecker::new();
        let custom = Permission::Custom("my.special.perm".into());
        checker.grant("com.test.ext", &[custom.clone()]);
        assert!(checker.has_permission("com.test.ext", &custom));
    }
}
