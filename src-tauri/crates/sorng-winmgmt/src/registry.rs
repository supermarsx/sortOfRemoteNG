//! Remote Windows Registry access via WMI StdRegProv.
//!
//! Provides operations for reading, writing, and enumerating registry
//! keys and values on remote Windows hosts using the StdRegProv WMI
//! provider class through WMI-over-WinRM.

use crate::transport::WmiTransport;
use crate::types::*;
use log::{debug, info};
use std::collections::HashMap;

/// Manages remote Windows Registry via WMI StdRegProv.
pub struct RegistryManager;

impl RegistryManager {
    // ─── Enumerate ───────────────────────────────────────────────────

    /// List subkeys of a registry key.
    pub async fn enum_keys(
        transport: &mut WmiTransport,
        hive: &RegistryHive,
        path: &str,
    ) -> Result<Vec<String>, String> {
        let mut params = HashMap::new();
        params.insert("hDefKey".to_string(), hive.to_wmi_value().to_string());
        params.insert("sSubKeyName".to_string(), path.to_string());

        let result = transport
            .invoke_method("StdRegProv", "EnumKey", None, &params)
            .await?;

        let return_value = result
            .get("ReturnValue")
            .and_then(|v| v.parse::<u32>().ok())
            .unwrap_or(u32::MAX);

        if return_value != 0 {
            return Err(format!(
                "Failed to enumerate keys at {}\\{}: error code {}",
                hive.display_name(),
                path,
                return_value
            ));
        }

        // Parse the sNames array
        let names = result
            .get("sNames")
            .map(|s| Self::parse_array_value(s))
            .unwrap_or_default();

        Ok(names)
    }

    /// List value names under a registry key.
    pub async fn enum_values(
        transport: &mut WmiTransport,
        hive: &RegistryHive,
        path: &str,
    ) -> Result<Vec<(String, RegistryValueType)>, String> {
        let mut params = HashMap::new();
        params.insert("hDefKey".to_string(), hive.to_wmi_value().to_string());
        params.insert("sSubKeyName".to_string(), path.to_string());

        let result = transport
            .invoke_method("StdRegProv", "EnumValues", None, &params)
            .await?;

        let return_value = result
            .get("ReturnValue")
            .and_then(|v| v.parse::<u32>().ok())
            .unwrap_or(u32::MAX);

        if return_value != 0 {
            return Err(format!(
                "Failed to enumerate values at {}\\{}: error code {}",
                hive.display_name(),
                path,
                return_value
            ));
        }

        let names = result
            .get("sNames")
            .map(|s| Self::parse_array_value(s))
            .unwrap_or_default();

        let types = result
            .get("Types")
            .map(|s| Self::parse_type_array(s))
            .unwrap_or_default();

        let pairs = names
            .into_iter()
            .zip(types.into_iter().chain(std::iter::repeat(RegistryValueType::Unknown)))
            .collect();

        Ok(pairs)
    }

    /// Get complete registry key information (subkeys + values).
    pub async fn get_key_info(
        transport: &mut WmiTransport,
        hive: &RegistryHive,
        path: &str,
    ) -> Result<RegistryKeyInfo, String> {
        let subkeys = Self::enum_keys(transport, hive, path)
            .await
            .unwrap_or_default();

        let value_names = Self::enum_values(transport, hive, path)
            .await
            .unwrap_or_default();

        let mut values = Vec::new();
        for (name, vtype) in &value_names {
            match Self::get_value(transport, hive, path, name).await {
                Ok(val) => values.push(val),
                Err(e) => {
                    debug!("Could not read value '{}': {}", name, e);
                    values.push(RegistryValue {
                        name: name.clone(),
                        value_type: vtype.clone(),
                        data: serde_json::Value::Null,
                    });
                }
            }
        }

        Ok(RegistryKeyInfo {
            hive: hive.clone(),
            path: path.to_string(),
            subkeys,
            values,
        })
    }

    // ─── Read Values ─────────────────────────────────────────────────

    /// Read a registry value (auto-detects type).
    pub async fn get_value(
        transport: &mut WmiTransport,
        hive: &RegistryHive,
        path: &str,
        name: &str,
    ) -> Result<RegistryValue, String> {
        // Try reading as string first, then other types
        if let Ok(val) = Self::get_string_value(transport, hive, path, name).await {
            return Ok(RegistryValue {
                name: name.to_string(),
                value_type: RegistryValueType::String,
                data: serde_json::Value::String(val),
            });
        }

        if let Ok(val) = Self::get_dword_value(transport, hive, path, name).await {
            return Ok(RegistryValue {
                name: name.to_string(),
                value_type: RegistryValueType::DWord,
                data: serde_json::Value::Number(serde_json::Number::from(val)),
            });
        }

        if let Ok(val) = Self::get_expanded_string_value(transport, hive, path, name).await {
            return Ok(RegistryValue {
                name: name.to_string(),
                value_type: RegistryValueType::ExpandString,
                data: serde_json::Value::String(val),
            });
        }

        if let Ok(val) = Self::get_multi_string_value(transport, hive, path, name).await {
            return Ok(RegistryValue {
                name: name.to_string(),
                value_type: RegistryValueType::MultiString,
                data: serde_json::Value::Array(
                    val.into_iter()
                        .map(serde_json::Value::String)
                        .collect(),
                ),
            });
        }

        if let Ok(val) = Self::get_qword_value(transport, hive, path, name).await {
            return Ok(RegistryValue {
                name: name.to_string(),
                value_type: RegistryValueType::QWord,
                data: serde_json::json!(val),
            });
        }

        Err(format!("Could not read value '{}' at {}\\{}", name, hive.display_name(), path))
    }

    /// Read a REG_SZ string value.
    pub async fn get_string_value(
        transport: &mut WmiTransport,
        hive: &RegistryHive,
        path: &str,
        name: &str,
    ) -> Result<String, String> {
        let mut params = HashMap::new();
        params.insert("hDefKey".to_string(), hive.to_wmi_value().to_string());
        params.insert("sSubKeyName".to_string(), path.to_string());
        params.insert("sValueName".to_string(), name.to_string());

        let result = transport
            .invoke_method("StdRegProv", "GetStringValue", None, &params)
            .await?;

        Self::check_return(&result, "GetStringValue")?;

        result
            .get("sValue")
            .cloned()
            .ok_or_else(|| "No value returned".to_string())
    }

    /// Read a REG_EXPAND_SZ expanded string value.
    pub async fn get_expanded_string_value(
        transport: &mut WmiTransport,
        hive: &RegistryHive,
        path: &str,
        name: &str,
    ) -> Result<String, String> {
        let mut params = HashMap::new();
        params.insert("hDefKey".to_string(), hive.to_wmi_value().to_string());
        params.insert("sSubKeyName".to_string(), path.to_string());
        params.insert("sValueName".to_string(), name.to_string());

        let result = transport
            .invoke_method("StdRegProv", "GetExpandedStringValue", None, &params)
            .await?;

        Self::check_return(&result, "GetExpandedStringValue")?;

        result
            .get("sValue")
            .cloned()
            .ok_or_else(|| "No value returned".to_string())
    }

    /// Read a REG_DWORD value.
    pub async fn get_dword_value(
        transport: &mut WmiTransport,
        hive: &RegistryHive,
        path: &str,
        name: &str,
    ) -> Result<u32, String> {
        let mut params = HashMap::new();
        params.insert("hDefKey".to_string(), hive.to_wmi_value().to_string());
        params.insert("sSubKeyName".to_string(), path.to_string());
        params.insert("sValueName".to_string(), name.to_string());

        let result = transport
            .invoke_method("StdRegProv", "GetDWORDValue", None, &params)
            .await?;

        Self::check_return(&result, "GetDWORDValue")?;

        result
            .get("uValue")
            .and_then(|v| v.parse::<u32>().ok())
            .ok_or_else(|| "No DWORD value returned".to_string())
    }

    /// Read a REG_QWORD value.
    pub async fn get_qword_value(
        transport: &mut WmiTransport,
        hive: &RegistryHive,
        path: &str,
        name: &str,
    ) -> Result<u64, String> {
        let mut params = HashMap::new();
        params.insert("hDefKey".to_string(), hive.to_wmi_value().to_string());
        params.insert("sSubKeyName".to_string(), path.to_string());
        params.insert("sValueName".to_string(), name.to_string());

        let result = transport
            .invoke_method("StdRegProv", "GetQWORDValue", None, &params)
            .await?;

        Self::check_return(&result, "GetQWORDValue")?;

        result
            .get("uValue")
            .and_then(|v| v.parse::<u64>().ok())
            .ok_or_else(|| "No QWORD value returned".to_string())
    }

    /// Read a REG_MULTI_SZ value.
    pub async fn get_multi_string_value(
        transport: &mut WmiTransport,
        hive: &RegistryHive,
        path: &str,
        name: &str,
    ) -> Result<Vec<String>, String> {
        let mut params = HashMap::new();
        params.insert("hDefKey".to_string(), hive.to_wmi_value().to_string());
        params.insert("sSubKeyName".to_string(), path.to_string());
        params.insert("sValueName".to_string(), name.to_string());

        let result = transport
            .invoke_method("StdRegProv", "GetMultiStringValue", None, &params)
            .await?;

        Self::check_return(&result, "GetMultiStringValue")?;

        let values = result
            .get("sValue")
            .map(|s| Self::parse_array_value(s))
            .unwrap_or_default();

        Ok(values)
    }

    /// Read a REG_BINARY value.
    pub async fn get_binary_value(
        transport: &mut WmiTransport,
        hive: &RegistryHive,
        path: &str,
        name: &str,
    ) -> Result<Vec<u8>, String> {
        let mut params = HashMap::new();
        params.insert("hDefKey".to_string(), hive.to_wmi_value().to_string());
        params.insert("sSubKeyName".to_string(), path.to_string());
        params.insert("sValueName".to_string(), name.to_string());

        let result = transport
            .invoke_method("StdRegProv", "GetBinaryValue", None, &params)
            .await?;

        Self::check_return(&result, "GetBinaryValue")?;

        let bytes = result
            .get("uValue")
            .map(|s| {
                Self::parse_array_value(s)
                    .iter()
                    .filter_map(|b| b.parse::<u8>().ok())
                    .collect()
            })
            .unwrap_or_default();

        Ok(bytes)
    }

    // ─── Write Values ────────────────────────────────────────────────

    /// Write a REG_SZ string value.
    pub async fn set_string_value(
        transport: &mut WmiTransport,
        hive: &RegistryHive,
        path: &str,
        name: &str,
        value: &str,
    ) -> Result<(), String> {
        info!("Setting registry value {}\\{}\\{}", hive.display_name(), path, name);

        let mut params = HashMap::new();
        params.insert("hDefKey".to_string(), hive.to_wmi_value().to_string());
        params.insert("sSubKeyName".to_string(), path.to_string());
        params.insert("sValueName".to_string(), name.to_string());
        params.insert("sValue".to_string(), value.to_string());

        let result = transport
            .invoke_method("StdRegProv", "SetStringValue", None, &params)
            .await?;

        Self::check_return(&result, "SetStringValue")
    }

    /// Write a REG_DWORD value.
    pub async fn set_dword_value(
        transport: &mut WmiTransport,
        hive: &RegistryHive,
        path: &str,
        name: &str,
        value: u32,
    ) -> Result<(), String> {
        info!("Setting registry DWORD {}\\{}\\{} = {}", hive.display_name(), path, name, value);

        let mut params = HashMap::new();
        params.insert("hDefKey".to_string(), hive.to_wmi_value().to_string());
        params.insert("sSubKeyName".to_string(), path.to_string());
        params.insert("sValueName".to_string(), name.to_string());
        params.insert("uValue".to_string(), value.to_string());

        let result = transport
            .invoke_method("StdRegProv", "SetDWORDValue", None, &params)
            .await?;

        Self::check_return(&result, "SetDWORDValue")
    }

    /// Write a REG_EXPAND_SZ value.
    pub async fn set_expanded_string_value(
        transport: &mut WmiTransport,
        hive: &RegistryHive,
        path: &str,
        name: &str,
        value: &str,
    ) -> Result<(), String> {
        let mut params = HashMap::new();
        params.insert("hDefKey".to_string(), hive.to_wmi_value().to_string());
        params.insert("sSubKeyName".to_string(), path.to_string());
        params.insert("sValueName".to_string(), name.to_string());
        params.insert("sValue".to_string(), value.to_string());

        let result = transport
            .invoke_method("StdRegProv", "SetExpandedStringValue", None, &params)
            .await?;

        Self::check_return(&result, "SetExpandedStringValue")
    }

    // ─── Key Management ──────────────────────────────────────────────

    /// Create a registry key.
    pub async fn create_key(
        transport: &mut WmiTransport,
        hive: &RegistryHive,
        path: &str,
    ) -> Result<(), String> {
        info!("Creating registry key {}\\{}", hive.display_name(), path);

        let mut params = HashMap::new();
        params.insert("hDefKey".to_string(), hive.to_wmi_value().to_string());
        params.insert("sSubKeyName".to_string(), path.to_string());

        let result = transport
            .invoke_method("StdRegProv", "CreateKey", None, &params)
            .await?;

        Self::check_return(&result, "CreateKey")
    }

    /// Delete a registry key (must be empty of subkeys).
    pub async fn delete_key(
        transport: &mut WmiTransport,
        hive: &RegistryHive,
        path: &str,
    ) -> Result<(), String> {
        info!("Deleting registry key {}\\{}", hive.display_name(), path);

        let mut params = HashMap::new();
        params.insert("hDefKey".to_string(), hive.to_wmi_value().to_string());
        params.insert("sSubKeyName".to_string(), path.to_string());

        let result = transport
            .invoke_method("StdRegProv", "DeleteKey", None, &params)
            .await?;

        Self::check_return(&result, "DeleteKey")
    }

    /// Delete a registry value.
    pub async fn delete_value(
        transport: &mut WmiTransport,
        hive: &RegistryHive,
        path: &str,
        name: &str,
    ) -> Result<(), String> {
        info!(
            "Deleting registry value {}\\{}\\{}",
            hive.display_name(),
            path,
            name
        );

        let mut params = HashMap::new();
        params.insert("hDefKey".to_string(), hive.to_wmi_value().to_string());
        params.insert("sSubKeyName".to_string(), path.to_string());
        params.insert("sValueName".to_string(), name.to_string());

        let result = transport
            .invoke_method("StdRegProv", "DeleteValue", None, &params)
            .await?;

        Self::check_return(&result, "DeleteValue")
    }

    /// Check if a key exists.
    pub async fn key_exists(
        transport: &mut WmiTransport,
        hive: &RegistryHive,
        path: &str,
    ) -> Result<bool, String> {
        match Self::enum_keys(transport, hive, path).await {
            Ok(_) => Ok(true),
            Err(_) => Ok(false),
        }
    }

    // ─── Security ────────────────────────────────────────────────────

    /// Check access rights for a registry key.
    pub async fn check_access(
        transport: &mut WmiTransport,
        hive: &RegistryHive,
        path: &str,
        access_mask: u32,
    ) -> Result<bool, String> {
        let mut params = HashMap::new();
        params.insert("hDefKey".to_string(), hive.to_wmi_value().to_string());
        params.insert("sSubKeyName".to_string(), path.to_string());
        params.insert("uRequired".to_string(), access_mask.to_string());

        let result = transport
            .invoke_method("StdRegProv", "CheckAccess", None, &params)
            .await?;

        let granted = result
            .get("bGranted")
            .map(|v| v.eq_ignore_ascii_case("true") || v == "1")
            .unwrap_or(false);

        Ok(granted)
    }

    // ─── Helpers ─────────────────────────────────────────────────────

    /// Check the ReturnValue from a StdRegProv method call.
    fn check_return(result: &HashMap<String, String>, method: &str) -> Result<(), String> {
        let return_value = result
            .get("ReturnValue")
            .and_then(|v| v.parse::<u32>().ok())
            .unwrap_or(u32::MAX);

        if return_value == 0 {
            Ok(())
        } else {
            Err(format!(
                "Registry {} failed: error code {} ({})",
                method,
                return_value,
                Self::registry_error_description(return_value)
            ))
        }
    }

    /// Parse a WMI array value (comes as comma-separated or XML array).
    fn parse_array_value(s: &str) -> Vec<String> {
        if s.is_empty() {
            return Vec::new();
        }

        // Try comma-separated first
        s.split(',')
            .map(|part| part.trim().to_string())
            .filter(|p| !p.is_empty())
            .collect()
    }

    /// Parse a types array from EnumValues.
    fn parse_type_array(s: &str) -> Vec<RegistryValueType> {
        Self::parse_array_value(s)
            .iter()
            .map(|t| match t.trim() {
                "1" => RegistryValueType::String,
                "2" => RegistryValueType::ExpandString,
                "3" => RegistryValueType::Binary,
                "4" => RegistryValueType::DWord,
                "7" => RegistryValueType::MultiString,
                "11" => RegistryValueType::QWord,
                _ => RegistryValueType::Unknown,
            })
            .collect()
    }

    /// Human-readable registry error description.
    fn registry_error_description(code: u32) -> &'static str {
        match code {
            0 => "Success",
            2 => "Key not found",
            5 => "Access denied",
            6 => "Invalid handle",
            87 => "Invalid parameter",
            1018 => "Invalid registry hive",
            _ => "Unknown error",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_registry_hive_values() {
        assert_eq!(
            RegistryHive::HkeyLocalMachine.to_wmi_value(),
            0x80000002
        );
        assert_eq!(
            RegistryHive::HkeyCurrentUser.to_wmi_value(),
            0x80000001
        );
        assert_eq!(
            RegistryHive::HkeyLocalMachine.display_name(),
            "HKEY_LOCAL_MACHINE"
        );
    }

    #[test]
    fn test_parse_array_value() {
        let result = RegistryManager::parse_array_value("one, two, three");
        assert_eq!(result, vec!["one", "two", "three"]);
    }

    #[test]
    fn test_parse_type_array() {
        let types = RegistryManager::parse_type_array("1, 4, 7");
        assert_eq!(types.len(), 3);
        assert_eq!(types[0], RegistryValueType::String);
        assert_eq!(types[1], RegistryValueType::DWord);
        assert_eq!(types[2], RegistryValueType::MultiString);
    }

    #[test]
    fn test_check_return_ok() {
        let mut result = HashMap::new();
        result.insert("ReturnValue".to_string(), "0".to_string());
        assert!(RegistryManager::check_return(&result, "test").is_ok());
    }

    #[test]
    fn test_check_return_error() {
        let mut result = HashMap::new();
        result.insert("ReturnValue".to_string(), "5".to_string());
        assert!(RegistryManager::check_return(&result, "test").is_err());
    }
}
