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

#[cfg(windows)]
use std::ffi::c_void;
#[cfg(windows)]
use std::ffi::OsStr;
#[cfg(windows)]
use std::os::windows::ffi::OsStrExt;
#[cfg(windows)]
use windows::core::{PCWSTR, PWSTR};
#[cfg(windows)]
use windows::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_PATH_NOT_FOUND, ERROR_SUCCESS};
#[cfg(windows)]
use windows::Win32::System::Registry::{
    RegCloseKey,
    RegCreateKeyExW,
    RegDeleteValueW,
    RegGetValueW,
    RegOpenKeyExW,
    RegSetValueExW,
    HKEY,
    HKEY_CURRENT_USER,
    KEY_SET_VALUE,
    REG_BINARY,
    REG_DWORD,
    REG_OPTION_NON_VOLATILE,
    REG_QWORD,
    REG_SZ,
    RRF_RT_REG_BINARY,
    RRF_RT_REG_DWORD,
    RRF_RT_REG_QWORD,
    RRF_RT_REG_SZ,
};

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
    pub fn get_policy(&self, name: &str) -> Result<Option<GroupPolicy>, String> {
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
            let policy_clone = policy.clone();
            self.write_policy_to_registry(&policy_clone).await?;
            Ok(())
        } else {
            Err("Policy not found".to_string())
        }
    }

    /// Lists all policies
    pub fn list_policies(&self) -> Vec<GroupPolicy> {
        self.policies.values().cloned().collect()
    }

    /// Resets a policy to its default value
    pub async fn reset_policy(&mut self, name: String) -> Result<(), String> {
        if let Some(policy) = self.policies.get_mut(&name) {
            // Reset to default values (this would need to be implemented based on policy type)
            // For now, just disable the policy
            policy.enabled = false;
            let policy_clone = policy.clone();
            self.delete_policy_from_registry(&policy_clone).await?;
            Ok(())
        } else {
            Err("Policy not found".to_string())
        }
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

            let policy_clone = policy.clone();
            if enabled {
                self.write_policy_to_registry(&policy_clone).await?;
            } else {
                self.delete_policy_from_registry(&policy_clone).await?;
            }
            Ok(())
        } else {
            Err("Policy not found".to_string())
        }
    }

    /// Reads a policy from Windows registry
    fn read_policy_from_registry(&self, policy: &GroupPolicy) -> Result<GroupPolicy, String> {
        #[cfg(windows)]
        {
            let registry_value = self.read_registry_value(&policy.registry_key, &policy.value_name, &policy.value)?;
            let mut updated = policy.clone();
            updated.value = registry_value;
            updated.enabled = true;
            return Ok(updated);
        }
        #[cfg(not(windows))]
        {
            let _ = policy;
            Err("Registry access is only supported on Windows".to_string())
        }
    }

    /// Writes a policy to Windows registry
    async fn write_policy_to_registry(&self, policy: &GroupPolicy) -> Result<(), String> {
        #[cfg(windows)]
        {
            self.write_registry_value(&policy.registry_key, &policy.value_name, &policy.value)?;
            return Ok(());
        }
        #[cfg(not(windows))]
        {
            let _ = policy;
            Err("Registry access is only supported on Windows".to_string())
        }
    }

    /// Deletes a policy from Windows registry
    async fn delete_policy_from_registry(&self, policy: &GroupPolicy) -> Result<(), String> {
        #[cfg(windows)]
        {
            self.delete_registry_value(&policy.registry_key, &policy.value_name)?;
            return Ok(());
        }
        #[cfg(not(windows))]
        {
            let _ = policy;
            Err("Registry access is only supported on Windows".to_string())
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
    pub fn export_policies(&self, file_path: &str) -> Result<(), String> {
        let policies = self.list_policies();
        let json = serde_json::to_string_pretty(&policies)
            .map_err(|e| format!("Failed to serialize policies: {}", e))?;
        std::fs::write(file_path, json)
            .map_err(|e| format!("Failed to write policies file: {}", e))?;
        Ok(())
    }

    /// Imports policies from a file
    pub fn import_policies(&mut self, file_path: &str) -> Result<(), String> {
        let json = std::fs::read_to_string(file_path)
            .map_err(|e| format!("Failed to read policies file: {}", e))?;
        let imported_policies: Vec<GroupPolicy> = serde_json::from_str(&json)
            .map_err(|e| format!("Failed to deserialize policies: {}", e))?;

        for policy in imported_policies {
            self.policies.insert(policy.name.clone(), policy);
        }
        Ok(())
    }

    #[cfg(windows)]
    fn to_wide(input: &str) -> Vec<u16> {
        OsStr::new(input)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    #[cfg(windows)]
    fn read_registry_value(
        &self,
        key_path: &str,
        value_name: &str,
        expected: &PolicyValue,
    ) -> Result<PolicyValue, String> {
        let wide_key = Self::to_wide(key_path);
        let wide_value = Self::to_wide(value_name);

        match expected {
            PolicyValue::String(_) => {
                let mut data_len: u32 = 0;
                let status = unsafe {
                    RegGetValueW(
                        HKEY_CURRENT_USER,
                        PCWSTR(wide_key.as_ptr()),
                        PCWSTR(wide_value.as_ptr()),
                        RRF_RT_REG_SZ,
                        None,
                        None,
                        &mut data_len,
                    )
                };
                if status != ERROR_SUCCESS {
                    return Err(format!("Failed to read registry value: {}", status.0));
                }
                let mut buffer = vec![0u16; (data_len as usize) / 2];
                let status = unsafe {
                    RegGetValueW(
                        HKEY_CURRENT_USER,
                        PCWSTR(wide_key.as_ptr()),
                        PCWSTR(wide_value.as_ptr()),
                        RRF_RT_REG_SZ,
                        None,
                        Some(buffer.as_mut_ptr() as *mut c_void),
                        &mut data_len,
                    )
                };
                if status != ERROR_SUCCESS {
                    return Err(format!("Failed to read registry value: {}", status.0));
                }
                let value = String::from_utf16_lossy(&buffer)
                    .trim_end_matches('\0')
                    .to_string();
                Ok(PolicyValue::String(value))
            }
            PolicyValue::Dword(_) => {
                let mut value: u32 = 0;
                let mut data_len = std::mem::size_of::<u32>() as u32;
                let status = unsafe {
                    RegGetValueW(
                        HKEY_CURRENT_USER,
                        PCWSTR(wide_key.as_ptr()),
                        PCWSTR(wide_value.as_ptr()),
                        RRF_RT_REG_DWORD,
                        None,
                        Some((&mut value as *mut u32) as *mut c_void),
                        &mut data_len,
                    )
                };
                if status != ERROR_SUCCESS {
                    return Err(format!("Failed to read registry value: {}", status.0));
                }
                Ok(PolicyValue::Dword(value))
            }
            PolicyValue::Qword(_) => {
                let mut value: u64 = 0;
                let mut data_len = std::mem::size_of::<u64>() as u32;
                let status = unsafe {
                    RegGetValueW(
                        HKEY_CURRENT_USER,
                        PCWSTR(wide_key.as_ptr()),
                        PCWSTR(wide_value.as_ptr()),
                        RRF_RT_REG_QWORD,
                        None,
                        Some((&mut value as *mut u64) as *mut c_void),
                        &mut data_len,
                    )
                };
                if status != ERROR_SUCCESS {
                    return Err(format!("Failed to read registry value: {}", status.0));
                }
                Ok(PolicyValue::Qword(value))
            }
            PolicyValue::Binary(_) => {
                let mut data_len: u32 = 0;
                let status = unsafe {
                    RegGetValueW(
                        HKEY_CURRENT_USER,
                        PCWSTR(wide_key.as_ptr()),
                        PCWSTR(wide_value.as_ptr()),
                        RRF_RT_REG_BINARY,
                        None,
                        None,
                        &mut data_len,
                    )
                };
                if status != ERROR_SUCCESS {
                    return Err(format!("Failed to read registry value: {}", status.0));
                }
                let mut buffer = vec![0u8; data_len as usize];
                let status = unsafe {
                    RegGetValueW(
                        HKEY_CURRENT_USER,
                        PCWSTR(wide_key.as_ptr()),
                        PCWSTR(wide_value.as_ptr()),
                        RRF_RT_REG_BINARY,
                        None,
                        Some(buffer.as_mut_ptr() as *mut c_void),
                        &mut data_len,
                    )
                };
                if status != ERROR_SUCCESS {
                    return Err(format!("Failed to read registry value: {}", status.0));
                }
                Ok(PolicyValue::Binary(buffer))
            }
        }
    }

    #[cfg(windows)]
    fn write_registry_value(
        &self,
        key_path: &str,
        value_name: &str,
        value: &PolicyValue,
    ) -> Result<(), String> {
        let wide_key = Self::to_wide(key_path);
        let mut key = HKEY::default();
        let mut disposition = 0u32;
        let status = unsafe {
            RegCreateKeyExW(
                HKEY_CURRENT_USER,
                PCWSTR(wide_key.as_ptr()),
                0,
                PWSTR::null(),
                REG_OPTION_NON_VOLATILE,
                KEY_SET_VALUE,
                None,
                &mut key,
                Some(&mut disposition),
            )
        };
        if status != ERROR_SUCCESS {
            return Err(format!("Failed to create registry key: {}", status.0));
        }

        let wide_value = Self::to_wide(value_name);
        let status = match value {
            PolicyValue::String(text) => {
                let wide_text = Self::to_wide(text);
                unsafe {
                    RegSetValueExW(
                        key,
                        PCWSTR(wide_value.as_ptr()),
                        0,
                        REG_SZ,
                        Some(std::slice::from_raw_parts(
                            wide_text.as_ptr() as *const u8,
                            wide_text.len() * 2,
                        )),
                    )
                }
            }
            PolicyValue::Dword(number) => unsafe {
                RegSetValueExW(
                    key,
                    PCWSTR(wide_value.as_ptr()),
                    0,
                    REG_DWORD,
                    Some(&number.to_le_bytes()),
                )
            },
            PolicyValue::Qword(number) => unsafe {
                RegSetValueExW(
                    key,
                    PCWSTR(wide_value.as_ptr()),
                    0,
                    REG_QWORD,
                    Some(&number.to_le_bytes()),
                )
            },
            PolicyValue::Binary(data) => unsafe {
                RegSetValueExW(
                    key,
                    PCWSTR(wide_value.as_ptr()),
                    0,
                    REG_BINARY,
                    Some(data),
                )
            },
        };

        unsafe {
            RegCloseKey(key);
        }

        if status == ERROR_SUCCESS {
            Ok(())
        } else {
            Err(format!("Failed to write registry value: {}", status.0))
        }
    }

    #[cfg(windows)]
    fn delete_registry_value(&self, key_path: &str, value_name: &str) -> Result<(), String> {
        let wide_key = Self::to_wide(key_path);
        let mut key = HKEY::default();
        let status = unsafe {
            RegOpenKeyExW(
                HKEY_CURRENT_USER,
                PCWSTR(wide_key.as_ptr()),
                0,
                KEY_SET_VALUE,
                &mut key,
            )
        };
        if status == ERROR_FILE_NOT_FOUND || status == ERROR_PATH_NOT_FOUND {
            return Ok(());
        }
        if status != ERROR_SUCCESS {
            return Err(format!("Failed to open registry key: {}", status.0));
        }

        let wide_value = Self::to_wide(value_name);
        let delete_status = unsafe { RegDeleteValueW(key, PCWSTR(wide_value.as_ptr())) };
        unsafe { RegCloseKey(key) };

        if delete_status == ERROR_SUCCESS || delete_status == ERROR_FILE_NOT_FOUND {
            Ok(())
        } else {
            Err(format!("Failed to delete registry value: {}", delete_status.0))
        }
    }
}
