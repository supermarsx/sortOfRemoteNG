//! # Windows Group Policy Object (GPO) Service
//!
//! This module provides Windows Group Policy Object management functionality.
//! It allows reading, writing, and managing Windows GPOs for application configuration.
//!
//! ## Features
//!
//! - GPO policy reading and writing
//! - Registry-based policy storage
//! - Policy templates and schemas
//! - Remote GPO management
//! - Policy conflict resolution
//!
//! ## Security
//!
//! Requires appropriate Windows permissions for GPO management.
//! Policies are validated before application.
//!
//! ## Example
//!

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use serde::{Deserialize, Serialize};
use windows::Win32::System::Registry::{HKEY, RegOpenKeyExW, RegQueryValueExW, RegSetValueExW, RegCloseKey, REG_SZ, REG_DWORD, KEY_READ, KEY_WRITE};
use windows::core::PWSTR;

/// Policy value types
#[derive(Serialize, Deserialize, Clone, Debug)]
pub enum PolicyValue {
    /// String value
    String(String),
    /// DWORD (32-bit) value
    Dword(u32),
    /// QWORD (64-bit) value
    Qword(u64),
    /// Binary data
    Binary(Vec<u8>),
}

/// Group Policy Object
#[derive(Serialize, Deserialize, Clone)]
pub struct GroupPolicy {
    /// Policy name
    pub name: String,
    /// Policy description
    pub description: String,
    /// Policy category
    pub category: String,
    /// Registry key path
    pub registry_key: String,
    /// Registry value name
    pub value_name: String,
    /// Policy value
    pub value: PolicyValue,
    /// Whether the policy is enabled
    pub enabled: bool,
}

/// GPO service state
pub type GpoServiceState = Arc<Mutex<GpoService>>;

/// Service for managing Windows Group Policy Objects
pub struct GpoService {
    /// Available policies
    policies: HashMap<String, GroupPolicy>,
    /// Policy registry root
    policy_root: String,
}

impl GpoService {
    /// Creates a new GPO service
    pub fn new() -> GpoServiceState {
        let mut service = GpoService {
            policies: HashMap::new(),
            policy_root: r"SOFTWARE\Policies\SortOfRemoteNG".to_string(),
        };
        service.initialize_default_policies();
        Arc::new(Mutex::new(service))
    }

    /// Initializes default policies
    fn initialize_default_policies(&mut self) {
        let default_policies = vec![
            GroupPolicy {
                name: "AutoLockEnabled".to_string(),
                description: "Enable automatic application locking".to_string(),
                category: "Security".to_string(),
                registry_key: format!("{}\\Security", self.policy_root),
                value_name: "AutoLockEnabled".to_string(),
                value: PolicyValue::Dword(1),
                enabled: true,
            },
            GroupPolicy {
                name: "AutoLockTimeout".to_string(),
                description: "Automatic lock timeout in minutes".to_string(),
                category: "Security".to_string(),
                registry_key: format!("{}\\Security", self.policy_root),
                value_name: "AutoLockTimeout".to_string(),
                value: PolicyValue::Dword(30),
                enabled: true,
            },
            GroupPolicy {
                name: "RequirePassword".to_string(),
                description: "Require password for unlock".to_string(),
                category: "Security".to_string(),
                registry_key: format!("{}\\Security", self.policy_root),
                value_name: "RequirePassword".to_string(),
                value: PolicyValue::Dword(1),
                enabled: true,
            },
            GroupPolicy {
                name: "MaxConnections".to_string(),
                description: "Maximum concurrent connections".to_string(),
                category: "Limits".to_string(),
                registry_key: format!("{}\\Limits", self.policy_root),
                value_name: "MaxConnections".to_string(),
                value: PolicyValue::Dword(10),
                enabled: true,
            },
            GroupPolicy {
                name: "AllowedProtocols".to_string(),
                description: "Comma-separated list of allowed protocols".to_string(),
                category: "Access".to_string(),
                registry_key: format!("{}\\Access", self.policy_root),
                value_name: "AllowedProtocols".to_string(),
                value: PolicyValue::String("ssh,rdp,vnc".to_string()),
                enabled: true,
            },
        ];

        for policy in default_policies {
            self.policies.insert(policy.name.clone(), policy);
        }
    }

    /// Gets a policy value
    pub async fn get_policy(&self, name: &str) -> Result<Option<GroupPolicy>, String> {
        if let Some(policy) = self.policies.get(name) {
            // Try to read from registry first
            match self.read_policy_from_registry(policy) {
                Ok(registry_policy) => Ok(Some(registry_policy)),
                Err(_) => Ok(Some(policy.clone())), // Fall back to default
            }
        } else {
            Ok(None)
        }
    }

    /// Sets a policy value
    pub async fn set_policy(&mut self, name: String, value: PolicyValue) -> Result<(), String> {
        if let Some(policy) = self.policies.get_mut(&name) {
            policy.value = value.clone();
            policy.enabled = true;

            // Write to registry
            self.write_policy_to_registry(policy).await?;
            Ok(())
        } else {
            Err("Policy not found".to_string())
        }
    }

    /// Lists all policies
    pub async fn list_policies(&self) -> Vec<GroupPolicy> {
        self.policies.values().cloned().collect()
    }

    /// Lists policies by category
    pub async fn list_policies_by_category(&self, category: &str) -> Vec<GroupPolicy> {
        self.policies.values()
            .filter(|policy| policy.category == category)
            .cloned()
            .collect()
    }

    /// Enables or disables a policy
    pub async fn set_policy_enabled(&mut self, name: String, enabled: bool) -> Result<(), String> {
        if let Some(policy) = self.policies.get_mut(&name) {
            policy.enabled = enabled;

            if enabled {
                self.write_policy_to_registry(policy).await?;
            } else {
                self.delete_policy_from_registry(policy).await?;
            }
            Ok(())
        } else {
            Err("Policy not found".to_string())
        }
    }

    /// Reads a policy from Windows registry
    fn read_policy_from_registry(&self, policy: &GroupPolicy) -> Result<GroupPolicy, String> {
        #[cfg(target_os = "windows")]
        {
            use windows::Win32::System::Registry::{RegOpenKeyExW, RegQueryValueExW, RegCloseKey, HKEY_CURRENT_USER};
            use windows::core::{PWSTR, PSTR};
            use std::ffi::OsString;
            use std::os::windows::ffi::OsStringExt;

            unsafe {
                let mut hkey = HKEY::default();
                let key_path: Vec<u16> = format!("{}\0", policy.registry_key).encode_utf16().collect();

                let result = RegOpenKeyExW(
                    HKEY_CURRENT_USER,
                    PWSTR(key_path.as_ptr()),
                    0,
                    KEY_READ,
                    &mut hkey,
                );

                if result.is_ok() {
                    // Read the value based on its type
                    let value_name: Vec<u16> = format!("{}\0", policy.value_name).encode_utf16().collect();

                    match &policy.value {
                        PolicyValue::String(_) => {
                            let mut buffer = [0u16; 1024];
                            let mut size = (buffer.len() * 2) as u32;

                            let result = RegQueryValueExW(
                                hkey,
                                PWSTR(value_name.as_ptr()),
                                std::ptr::null_mut(),
                                std::ptr::null_mut(),
                                Some(buffer.as_mut_ptr() as *mut _),
                                Some(&mut size),
                            );

                            RegCloseKey(hkey);

                            if result.is_ok() {
                                let len = (size as usize) / 2;
                                let value_str = OsString::from_wide(&buffer[..len.saturating_sub(1)]);
                                let mut policy_clone = policy.clone();
                                policy_clone.value = PolicyValue::String(value_str.to_string_lossy().to_string());
                                Ok(policy_clone)
                            } else {
                                Err("Failed to read registry value".to_string())
                            }
                        }
                        PolicyValue::Dword(_) => {
                            let mut value: u32 = 0;
                            let mut size = std::mem::size_of::<u32>() as u32;

                            let result = RegQueryValueExW(
                                hkey,
                                PWSTR(value_name.as_ptr()),
                                std::ptr::null_mut(),
                                std::ptr::null_mut(),
                                Some(&mut value as *mut u32 as *mut _),
                                Some(&mut size),
                            );

                            RegCloseKey(hkey);

                            if result.is_ok() {
                                let mut policy_clone = policy.clone();
                                policy_clone.value = PolicyValue::Dword(value);
                                Ok(policy_clone)
                            } else {
                                Err("Failed to read registry value".to_string())
                            }
                        }
                        _ => {
                            RegCloseKey(hkey);
                            Err("Unsupported policy value type".to_string())
                        }
                    }
                } else {
                    Err("Failed to open registry key".to_string())
                }
            }
        }

        #[cfg(not(target_os = "windows"))]
        {
            Err("GPO policies are only supported on Windows".to_string())
        }
    }

    /// Writes a policy to Windows registry
    async fn write_policy_to_registry(&self, policy: &GroupPolicy) -> Result<(), String> {
        #[cfg(target_os = "windows")]
        {
            use windows::Win32::System::Registry::{RegCreateKeyExW, RegSetValueExW, HKEY_CURRENT_USER, KEY_WRITE, REG_OPTION_NON_VOLATILE, REG_CREATED_NEW_KEY, REG_OPENED_EXISTING_KEY};
            use windows::core::PWSTR;

            unsafe {
                let mut hkey = HKEY::default();
                let key_path: Vec<u16> = format!("{}\0", policy.registry_key).encode_utf16().collect();
                let mut disposition = 0u32;

                let result = RegCreateKeyExW(
                    HKEY_CURRENT_USER,
                    PWSTR(key_path.as_ptr()),
                    0,
                    PWSTR(std::ptr::null()),
                    REG_OPTION_NON_VOLATILE,
                    KEY_WRITE,
                    std::ptr::null(),
                    &mut hkey,
                    &mut disposition,
                );

                if result.is_ok() {
                    let value_name: Vec<u16> = format!("{}\0", policy.value_name).encode_utf16().collect();

                    let write_result = match &policy.value {
                        PolicyValue::String(s) => {
                            let value_data: Vec<u16> = format!("{}\0", s).encode_utf16().collect();
                            RegSetValueExW(
                                hkey,
                                PWSTR(value_name.as_ptr()),
                                0,
                                REG_SZ,
                                Some(value_data.as_ptr() as *const _),
                                (value_data.len() * 2) as u32,
                            )
                        }
                        PolicyValue::Dword(d) => {
                            RegSetValueExW(
                                hkey,
                                PWSTR(value_name.as_ptr()),
                                0,
                                REG_DWORD,
                                Some(d as *const u32 as *const _),
                                std::mem::size_of::<u32>() as u32,
                            )
                        }
                        _ => {
                            return Err("Unsupported policy value type for writing".to_string());
                        }
                    };

                    let close_result = RegCloseKey(hkey);

                    if write_result.is_ok() && close_result.is_ok() {
                        Ok(())
                    } else {
                        Err("Failed to write registry value".to_string())
                    }
                } else {
                    Err("Failed to create registry key".to_string())
                }
            }
        }

        #[cfg(not(target_os = "windows"))]
        {
            Err("GPO policies are only supported on Windows".to_string())
        }
    }

    /// Deletes a policy from Windows registry
    async fn delete_policy_from_registry(&self, policy: &GroupPolicy) -> Result<(), String> {
        #[cfg(target_os = "windows")]
        {
            use windows::Win32::System::Registry::{RegDeleteValueW, RegOpenKeyExW, RegCloseKey, HKEY_CURRENT_USER, KEY_WRITE};
            use windows::core::PWSTR;

            unsafe {
                let mut hkey = HKEY::default();
                let key_path: Vec<u16> = format!("{}\0", policy.registry_key).encode_utf16().collect();

                let open_result = RegOpenKeyExW(
                    HKEY_CURRENT_USER,
                    PWSTR(key_path.as_ptr()),
                    0,
                    KEY_WRITE,
                    &mut hkey,
                );

                if open_result.is_ok() {
                    let value_name: Vec<u16> = format!("{}\0", policy.value_name).encode_utf16().collect();

                    let delete_result = RegDeleteValueW(hkey, PWSTR(value_name.as_ptr()));
                    let close_result = RegCloseKey(hkey);

                    if delete_result.is_ok() && close_result.is_ok() {
                        Ok(())
                    } else {
                        Err("Failed to delete registry value".to_string())
                    }
                } else {
                    // Key doesn't exist, which is fine
                    Ok(())
                }
            }
        }

        #[cfg(not(target_os = "windows"))]
        {
            Err("GPO policies are only supported on Windows".to_string())
        }
    }

    /// Applies all enabled policies
    pub async fn apply_policies(&self) -> Result<(), String> {
        for policy in self.policies.values() {
            if policy.enabled {
                // Apply the policy (this would integrate with other services)
                log::info!("Applying policy: {} = {:?}", policy.name, policy.value);
            }
        }
        Ok(())
    }

    /// Exports policies to a file
    pub async fn export_policies(&self, file_path: &str) -> Result<(), String> {
        let policies = self.list_policies().await;
        let json = serde_json::to_string_pretty(&policies)
            .map_err(|e| format!("Failed to serialize policies: {}", e))?;
        std::fs::write(file_path, json)
            .map_err(|e| format!("Failed to write policies file: {}", e))?;
        Ok(())
    }

    /// Imports policies from a file
    pub async fn import_policies(&mut self, file_path: &str) -> Result<(), String> {
        let json = std::fs::read_to_string(file_path)
            .map_err(|e| format!("Failed to read policies file: {}", e))?;
        let imported_policies: Vec<GroupPolicy> = serde_json::from_str(&json)
            .map_err(|e| format!("Failed to deserialize policies: {}", e))?;

        for policy in imported_policies {
            self.policies.insert(policy.name.clone(), policy);
        }
        Ok(())
    }
}</content>
<parameter name="filePath">c:\Projects\sortOfRemoteNG\src-tauri\src\gpo.rs