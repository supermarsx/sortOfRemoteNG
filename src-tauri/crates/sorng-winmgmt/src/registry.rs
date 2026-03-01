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

    // ─── Write Extended Types ────────────────────────────────────────

    /// Write a REG_QWORD value.
    pub async fn set_qword_value(
        transport: &mut WmiTransport,
        hive: &RegistryHive,
        path: &str,
        name: &str,
        value: u64,
    ) -> Result<(), String> {
        info!(
            "Setting registry QWORD {}\\{}\\{} = {}",
            hive.display_name(),
            path,
            name,
            value
        );

        let mut params = HashMap::new();
        params.insert("hDefKey".to_string(), hive.to_wmi_value().to_string());
        params.insert("sSubKeyName".to_string(), path.to_string());
        params.insert("sValueName".to_string(), name.to_string());
        params.insert("uValue".to_string(), value.to_string());

        let result = transport
            .invoke_method("StdRegProv", "SetQWORDValue", None, &params)
            .await?;

        Self::check_return(&result, "SetQWORDValue")
    }

    /// Write a REG_MULTI_SZ value.
    pub async fn set_multi_string_value(
        transport: &mut WmiTransport,
        hive: &RegistryHive,
        path: &str,
        name: &str,
        values: &[String],
    ) -> Result<(), String> {
        info!(
            "Setting registry MultiString {}\\{}\\{} ({} items)",
            hive.display_name(),
            path,
            name,
            values.len()
        );

        let mut params = HashMap::new();
        params.insert("hDefKey".to_string(), hive.to_wmi_value().to_string());
        params.insert("sSubKeyName".to_string(), path.to_string());
        params.insert("sValueName".to_string(), name.to_string());
        params.insert("sValue".to_string(), values.join(","));

        let result = transport
            .invoke_method("StdRegProv", "SetMultiStringValue", None, &params)
            .await?;

        Self::check_return(&result, "SetMultiStringValue")
    }

    /// Write a REG_BINARY value.
    pub async fn set_binary_value(
        transport: &mut WmiTransport,
        hive: &RegistryHive,
        path: &str,
        name: &str,
        data: &[u8],
    ) -> Result<(), String> {
        info!(
            "Setting registry Binary {}\\{}\\{} ({} bytes)",
            hive.display_name(),
            path,
            name,
            data.len()
        );

        let mut params = HashMap::new();
        params.insert("hDefKey".to_string(), hive.to_wmi_value().to_string());
        params.insert("sSubKeyName".to_string(), path.to_string());
        params.insert("sValueName".to_string(), name.to_string());
        let byte_str = data
            .iter()
            .map(|b| b.to_string())
            .collect::<Vec<_>>()
            .join(",");
        params.insert("uValue".to_string(), byte_str);

        let result = transport
            .invoke_method("StdRegProv", "SetBinaryValue", None, &params)
            .await?;

        Self::check_return(&result, "SetBinaryValue")
    }

    // ─── Recursive Enumeration ───────────────────────────────────────

    /// Recursively enumerate a registry subtree, returning a tree structure.
    pub async fn recursive_enum(
        transport: &mut WmiTransport,
        hive: &RegistryHive,
        path: &str,
        max_depth: u32,
    ) -> Result<RegistryTreeNode, String> {
        Self::recursive_enum_inner(transport, hive, path, max_depth, 0).await
    }

    fn recursive_enum_inner<'a>(
        transport: &'a mut WmiTransport,
        hive: &'a RegistryHive,
        path: &'a str,
        max_depth: u32,
        current_depth: u32,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<RegistryTreeNode, String>> + Send + 'a>>
    {
        Box::pin(async move {
            let name = path
                .rsplit('\\')
                .next()
                .unwrap_or(path)
                .to_string();

            // Get values for this key
            let values = match Self::get_key_info(transport, hive, path).await {
                Ok(info) => info.values,
                Err(_) => Vec::new(),
            };

            let mut children = Vec::new();

            // Recurse into subkeys if within depth limit
            if max_depth == 0 || current_depth < max_depth {
                if let Ok(subkeys) = Self::enum_keys(transport, hive, path).await {
                    for subkey in subkeys {
                        let child_path = if path.is_empty() {
                            subkey.clone()
                        } else {
                            format!("{}\\{}", path, subkey)
                        };
                        match Self::recursive_enum_inner(
                            transport,
                            hive,
                            &child_path,
                            max_depth,
                            current_depth + 1,
                        )
                        .await
                        {
                            Ok(child) => children.push(child),
                            Err(e) => {
                                debug!("Skipping subkey {}: {}", child_path, e);
                            }
                        }
                    }
                }
            }

            Ok(RegistryTreeNode {
                hive: hive.clone(),
                path: path.to_string(),
                name,
                values,
                children,
            })
        })
    }

    /// Recursively delete a registry key and all its subkeys.
    pub async fn recursive_delete(
        transport: &mut WmiTransport,
        hive: &RegistryHive,
        path: &str,
    ) -> Result<u32, String> {
        info!(
            "Recursively deleting {}\\{}",
            hive.display_name(),
            path
        );
        Self::recursive_delete_inner(transport, hive, path).await
    }

    fn recursive_delete_inner<'a>(
        transport: &'a mut WmiTransport,
        hive: &'a RegistryHive,
        path: &'a str,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<u32, String>> + Send + 'a>> {
        Box::pin(async move {
            let mut count = 0u32;

            // First delete all subkeys recursively
            if let Ok(subkeys) = Self::enum_keys(transport, hive, path).await {
                for subkey in subkeys {
                    let child_path = format!("{}\\{}", path, subkey);
                    match Self::recursive_delete_inner(transport, hive, &child_path).await {
                        Ok(c) => count += c,
                        Err(e) => {
                            return Err(format!(
                                "Failed to delete subkey {}: {}",
                                child_path, e
                            ));
                        }
                    }
                }
            }

            // Now delete this key (should be empty of subkeys)
            Self::delete_key(transport, hive, path).await?;
            count += 1;

            Ok(count)
        })
    }

    // ─── Search ──────────────────────────────────────────────────────

    /// Search the registry for keys and values matching a pattern.
    pub async fn search(
        transport: &mut WmiTransport,
        filter: &RegistrySearchFilter,
    ) -> Result<Vec<RegistrySearchResult>, String> {
        info!(
            "Searching registry {}\\{} for '{}'",
            filter.hive.display_name(),
            filter.root_path,
            filter.pattern
        );
        let mut results = Vec::new();
        Self::search_inner(transport, filter, &filter.root_path, 0, &mut results).await?;
        Ok(results)
    }

    fn search_inner<'a>(
        transport: &'a mut WmiTransport,
        filter: &'a RegistrySearchFilter,
        path: &'a str,
        depth: u32,
        results: &'a mut Vec<RegistrySearchResult>,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), String>> + Send + 'a>> {
        Box::pin(async move {
            // Check result limit
            if filter.max_results > 0 && results.len() as u32 >= filter.max_results {
                return Ok(());
            }

            // Check depth limit
            if filter.max_depth > 0 && depth > filter.max_depth {
                return Ok(());
            }

            let key_name = path.rsplit('\\').next().unwrap_or(path);

            // Check key name match
            if filter.search_keys && Self::matches_pattern(key_name, &filter.pattern, filter.is_regex) {
                results.push(RegistrySearchResult {
                    hive: filter.hive.clone(),
                    path: path.to_string(),
                    match_type: RegistrySearchMatchType::KeyName,
                    matched_text: key_name.to_string(),
                    value: None,
                });
            }

            // Check values
            if filter.search_value_names || filter.search_value_data {
                if let Ok(value_names) = Self::enum_values(transport, &filter.hive, path).await {
                    for (vname, _vtype) in &value_names {
                        if filter.max_results > 0 && results.len() as u32 >= filter.max_results {
                            return Ok(());
                        }

                        // Match value name
                        if filter.search_value_names
                            && Self::matches_pattern(vname, &filter.pattern, filter.is_regex)
                        {
                            let value = Self::get_value(transport, &filter.hive, path, vname)
                                .await
                                .ok();
                            results.push(RegistrySearchResult {
                                hive: filter.hive.clone(),
                                path: path.to_string(),
                                match_type: RegistrySearchMatchType::ValueName,
                                matched_text: vname.clone(),
                                value,
                            });
                        }

                        // Match value data (strings only)
                        if filter.search_value_data {
                            if let Ok(val) = Self::get_value(transport, &filter.hive, path, vname).await
                            {
                                let data_str = match &val.data {
                                    serde_json::Value::String(s) => Some(s.clone()),
                                    serde_json::Value::Number(n) => Some(n.to_string()),
                                    serde_json::Value::Array(arr) => {
                                        let parts: Vec<String> = arr
                                            .iter()
                                            .filter_map(|v| v.as_str().map(|s| s.to_string()))
                                            .collect();
                                        if parts.is_empty() {
                                            None
                                        } else {
                                            Some(parts.join(", "))
                                        }
                                    }
                                    _ => None,
                                };

                                if let Some(ref ds) = data_str {
                                    if Self::matches_pattern(ds, &filter.pattern, filter.is_regex) {
                                        results.push(RegistrySearchResult {
                                            hive: filter.hive.clone(),
                                            path: path.to_string(),
                                            match_type: RegistrySearchMatchType::ValueData,
                                            matched_text: ds.clone(),
                                            value: Some(val),
                                        });
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // Recurse into subkeys
            if let Ok(subkeys) = Self::enum_keys(transport, &filter.hive, path).await {
                for subkey in subkeys {
                    if filter.max_results > 0 && results.len() as u32 >= filter.max_results {
                        return Ok(());
                    }
                    let child_path = if path.is_empty() {
                        subkey.clone()
                    } else {
                        format!("{}\\{}", path, subkey)
                    };
                    Self::search_inner(transport, filter, &child_path, depth + 1, results).await?;
                }
            }

            Ok(())
        })
    }

    /// Check whether text matches a pattern (case-insensitive).
    fn matches_pattern(text: &str, pattern: &str, is_regex: bool) -> bool {
        if is_regex {
            // Simple regex-like matching using basic wildcard support
            let lower_text = text.to_lowercase();
            let lower_pattern = pattern.to_lowercase();

            // Support basic * and ? wildcards in non-regex mode too
            if lower_pattern.contains('*') || lower_pattern.contains('?') {
                let regex_pat = lower_pattern
                    .replace('.', "\\.")
                    .replace('*', ".*")
                    .replace('?', ".");
                // Simple match without regex crate
                Self::simple_glob_match(&lower_text, &regex_pat)
            } else {
                lower_text.contains(&lower_pattern)
            }
        } else {
            text.to_lowercase().contains(&pattern.to_lowercase())
        }
    }

    /// Simple glob-style matching without regex crate.
    fn simple_glob_match(text: &str, pattern: &str) -> bool {
        let parts: Vec<&str> = pattern.split(".*").collect();
        if parts.len() == 1 {
            return text.contains(parts[0]);
        }

        let mut pos = 0;
        for (i, part) in parts.iter().enumerate() {
            if part.is_empty() {
                continue;
            }
            if let Some(found) = text[pos..].find(part) {
                if i == 0 && !pattern.starts_with(".*") && found != 0 {
                    return false;
                }
                pos += found + part.len();
            } else {
                return false;
            }
        }

        if !pattern.ends_with(".*") {
            return pos == text.len();
        }
        true
    }

    // ─── Export ──────────────────────────────────────────────────────

    /// Export a registry subtree to .reg file format or JSON.
    pub async fn export(
        transport: &mut WmiTransport,
        hive: &RegistryHive,
        path: &str,
        format: &RegistryExportFormat,
        max_depth: u32,
    ) -> Result<String, String> {
        info!(
            "Exporting {}\\{} as {:?}",
            hive.display_name(),
            path,
            format
        );

        let tree = Self::recursive_enum(transport, hive, path, max_depth).await?;

        match format {
            RegistryExportFormat::RegFile => Ok(Self::tree_to_reg_file(hive, &tree)),
            RegistryExportFormat::Json => serde_json::to_string_pretty(&tree)
                .map_err(|e| format!("JSON serialization failed: {}", e)),
        }
    }

    /// Convert a tree node to .reg file format.
    fn tree_to_reg_file(hive: &RegistryHive, node: &RegistryTreeNode) -> String {
        let mut output = String::from("Windows Registry Editor Version 5.00\r\n\r\n");
        Self::tree_to_reg_file_inner(hive, node, &mut output);
        output
    }

    fn tree_to_reg_file_inner(hive: &RegistryHive, node: &RegistryTreeNode, output: &mut String) {
        // Write key header
        output.push_str(&format!("[{}\\{}]\r\n", hive.display_name(), node.path));

        // Write values
        for val in &node.values {
            let line = Self::value_to_reg_line(val);
            output.push_str(&line);
            output.push_str("\r\n");
        }

        output.push_str("\r\n");

        // Recurse into children
        for child in &node.children {
            Self::tree_to_reg_file_inner(hive, child, output);
        }
    }

    /// Format a single registry value as a .reg file line.
    fn value_to_reg_line(val: &RegistryValue) -> String {
        let name_part = if val.name.is_empty() || val.name == "@" {
            "@".to_string()
        } else {
            format!("\"{}\"", Self::escape_reg_string(&val.name))
        };

        match val.value_type {
            RegistryValueType::String => {
                let s = val.data.as_str().unwrap_or("");
                format!("{}=\"{}\"", name_part, Self::escape_reg_string(s))
            }
            RegistryValueType::DWord => {
                let n = val
                    .data
                    .as_u64()
                    .unwrap_or(0) as u32;
                format!("{}=dword:{:08x}", name_part, n)
            }
            RegistryValueType::QWord => {
                let n = val.data.as_u64().unwrap_or(0);
                let bytes = n.to_le_bytes();
                let hex: Vec<String> = bytes.iter().map(|b| format!("{:02x}", b)).collect();
                format!("{}=hex(b):{}", name_part, hex.join(","))
            }
            RegistryValueType::ExpandString => {
                let s = val.data.as_str().unwrap_or("");
                let wide: Vec<u8> = s
                    .encode_utf16()
                    .flat_map(|c| c.to_le_bytes())
                    .chain([0u8, 0u8])
                    .collect();
                let hex: Vec<String> = wide.iter().map(|b| format!("{:02x}", b)).collect();
                format!("{}=hex(2):{}", name_part, hex.join(","))
            }
            RegistryValueType::MultiString => {
                let strings: Vec<&str> = val
                    .data
                    .as_array()
                    .map(|arr| arr.iter().filter_map(|v| v.as_str()).collect())
                    .unwrap_or_default();

                let mut wide_bytes: Vec<u8> = Vec::new();
                for s in &strings {
                    for c in s.encode_utf16() {
                        wide_bytes.extend_from_slice(&c.to_le_bytes());
                    }
                    wide_bytes.extend_from_slice(&[0u8, 0u8]); // null terminator
                }
                wide_bytes.extend_from_slice(&[0u8, 0u8]); // final null

                let hex: Vec<String> = wide_bytes.iter().map(|b| format!("{:02x}", b)).collect();
                format!("{}=hex(7):{}", name_part, hex.join(","))
            }
            RegistryValueType::Binary => {
                let bytes: Vec<u8> = val
                    .data
                    .as_array()
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|v| v.as_u64().map(|n| n as u8))
                            .collect()
                    })
                    .unwrap_or_default();
                let hex: Vec<String> = bytes.iter().map(|b| format!("{:02x}", b)).collect();
                format!("{}=hex:{}", name_part, hex.join(","))
            }
            RegistryValueType::Unknown => {
                format!("{}=hex:{}", name_part, "")
            }
        }
    }

    /// Escape a string value for .reg file format.
    fn escape_reg_string(s: &str) -> String {
        s.replace('\\', "\\\\").replace('"', "\\\"")
    }

    // ─── Import ──────────────────────────────────────────────────────

    /// Import registry data from .reg file content.
    pub async fn import(
        transport: &mut WmiTransport,
        request: &RegistryImportRequest,
    ) -> Result<RegistryImportResult, String> {
        info!("Importing registry data (dry_run={})", request.dry_run);

        match request.format {
            RegistryExportFormat::RegFile => {
                Self::import_reg_file(transport, &request.content, request.dry_run).await
            }
            RegistryExportFormat::Json => {
                Self::import_json(transport, &request.content, request.dry_run).await
            }
        }
    }

    /// Parse and apply a .reg file.
    async fn import_reg_file(
        transport: &mut WmiTransport,
        content: &str,
        dry_run: bool,
    ) -> Result<RegistryImportResult, String> {
        let mut result = RegistryImportResult {
            keys_created: 0,
            values_set: 0,
            values_deleted: 0,
            errors: Vec::new(),
            dry_run,
        };

        let mut current_hive: Option<RegistryHive> = None;
        let mut current_path: Option<String> = None;

        for line in content.lines() {
            let trimmed = line.trim();

            // Skip empty lines, comments, and header
            if trimmed.is_empty()
                || trimmed.starts_with(';')
                || trimmed.starts_with("Windows Registry Editor")
                || trimmed.starts_with("REGEDIT4")
            {
                continue;
            }

            // Key line: [HKEY_LOCAL_MACHINE\Software\...]
            if trimmed.starts_with('[') && trimmed.ends_with(']') {
                let key_path = &trimmed[1..trimmed.len() - 1];
                let delete = key_path.starts_with('-');
                let key_path = if delete { &key_path[1..] } else { key_path };

                if let Some((hive, path)) = Self::parse_reg_key_path(key_path) {
                    if !delete && !dry_run {
                        if let Err(e) = Self::create_key(transport, &hive, &path).await {
                            result.errors.push(format!("Create key {}: {}", path, e));
                        } else {
                            result.keys_created += 1;
                        }
                    } else if !delete {
                        result.keys_created += 1;
                    }
                    current_hive = Some(hive);
                    current_path = Some(path);
                }
                continue;
            }

            // Value line
            if let (Some(ref hive), Some(ref path)) = (&current_hive, &current_path) {
                if let Some((name, delete_val)) = Self::parse_reg_value_line(trimmed) {
                    if delete_val {
                        if !dry_run {
                            if let Err(e) =
                                Self::delete_value(transport, hive, path, &name).await
                            {
                                result
                                    .errors
                                    .push(format!("Delete value {}\\{}: {}", path, name, e));
                            } else {
                                result.values_deleted += 1;
                            }
                        } else {
                            result.values_deleted += 1;
                        }
                    } else if let Some((vtype, data)) = Self::parse_reg_value_data(trimmed) {
                        if !dry_run {
                            match Self::set_typed_value(transport, hive, path, &name, &vtype, &data)
                                .await
                            {
                                Ok(()) => result.values_set += 1,
                                Err(e) => result
                                    .errors
                                    .push(format!("Set value {}\\{}: {}", path, name, e)),
                            }
                        } else {
                            result.values_set += 1;
                        }
                    }
                }
            }
        }

        Ok(result)
    }

    /// Import from JSON format (RegistryTreeNode).
    async fn import_json(
        transport: &mut WmiTransport,
        content: &str,
        dry_run: bool,
    ) -> Result<RegistryImportResult, String> {
        let tree: RegistryTreeNode =
            serde_json::from_str(content).map_err(|e| format!("Invalid JSON: {}", e))?;

        let mut result = RegistryImportResult {
            keys_created: 0,
            values_set: 0,
            values_deleted: 0,
            errors: Vec::new(),
            dry_run,
        };

        Self::import_json_node(transport, &tree, dry_run, &mut result).await;
        Ok(result)
    }

    fn import_json_node<'a>(
        transport: &'a mut WmiTransport,
        node: &'a RegistryTreeNode,
        dry_run: bool,
        result: &'a mut RegistryImportResult,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send + 'a>> {
        Box::pin(async move {
            // Create the key
            if !dry_run {
                if let Err(e) = Self::create_key(transport, &node.hive, &node.path).await {
                    result
                        .errors
                        .push(format!("Create key {}: {}", node.path, e));
                } else {
                    result.keys_created += 1;
                }
            } else {
                result.keys_created += 1;
            }

            // Set values
            for val in &node.values {
                if !dry_run {
                    match Self::set_typed_value(
                        transport,
                        &node.hive,
                        &node.path,
                        &val.name,
                        &val.value_type,
                        &val.data,
                    )
                    .await
                    {
                        Ok(()) => result.values_set += 1,
                        Err(e) => result
                            .errors
                            .push(format!("Set {}\\{}: {}", node.path, val.name, e)),
                    }
                } else {
                    result.values_set += 1;
                }
            }

            // Recurse
            for child in &node.children {
                Self::import_json_node(transport, child, dry_run, result).await;
            }
        })
    }

    /// Set a value by type from serde_json::Value data.
    async fn set_typed_value(
        transport: &mut WmiTransport,
        hive: &RegistryHive,
        path: &str,
        name: &str,
        vtype: &RegistryValueType,
        data: &serde_json::Value,
    ) -> Result<(), String> {
        match vtype {
            RegistryValueType::String => {
                let s = data.as_str().unwrap_or("");
                Self::set_string_value(transport, hive, path, name, s).await
            }
            RegistryValueType::ExpandString => {
                let s = data.as_str().unwrap_or("");
                Self::set_expanded_string_value(transport, hive, path, name, s).await
            }
            RegistryValueType::DWord => {
                let n = data.as_u64().unwrap_or(0) as u32;
                Self::set_dword_value(transport, hive, path, name, n).await
            }
            RegistryValueType::QWord => {
                let n = data.as_u64().unwrap_or(0);
                Self::set_qword_value(transport, hive, path, name, n).await
            }
            RegistryValueType::MultiString => {
                let strs: Vec<String> = data
                    .as_array()
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|v| v.as_str().map(|s| s.to_string()))
                            .collect()
                    })
                    .unwrap_or_default();
                Self::set_multi_string_value(transport, hive, path, name, &strs).await
            }
            RegistryValueType::Binary => {
                let bytes: Vec<u8> = data
                    .as_array()
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|v| v.as_u64().map(|n| n as u8))
                            .collect()
                    })
                    .unwrap_or_default();
                Self::set_binary_value(transport, hive, path, name, &bytes).await
            }
            RegistryValueType::Unknown => {
                Err("Cannot set value of unknown type".to_string())
            }
        }
    }

    /// Parse a .reg key path like "HKEY_LOCAL_MACHINE\Software\Foo" into (hive, path).
    fn parse_reg_key_path(full_path: &str) -> Option<(RegistryHive, String)> {
        let (hive_str, rest) = if let Some(pos) = full_path.find('\\') {
            (&full_path[..pos], &full_path[pos + 1..])
        } else {
            (full_path, "")
        };

        let hive = match hive_str.to_uppercase().as_str() {
            "HKEY_LOCAL_MACHINE" | "HKLM" => RegistryHive::HkeyLocalMachine,
            "HKEY_CURRENT_USER" | "HKCU" => RegistryHive::HkeyCurrentUser,
            "HKEY_CLASSES_ROOT" | "HKCR" => RegistryHive::HkeyClassesRoot,
            "HKEY_USERS" | "HKU" => RegistryHive::HkeyUsers,
            "HKEY_CURRENT_CONFIG" | "HKCC" => RegistryHive::HkeyCurrentConfig,
            _ => return None,
        };

        Some((hive, rest.to_string()))
    }

    /// Parse a .reg value line. Returns (name, is_delete).
    fn parse_reg_value_line(line: &str) -> Option<(String, bool)> {
        if line.starts_with('@') {
            // Default value
            if line.contains("=-") {
                return Some(("".to_string(), true));
            }
            return Some(("".to_string(), false));
        }

        if line.starts_with('"') {
            let end_quote = line[1..].find('"')?;
            let name = line[1..end_quote + 1].replace("\\\\", "\x00").replace("\\\"", "\"").replace('\x00', "\\");

            if line[end_quote + 2..].trim_start().starts_with("=-") {
                return Some((name, true));
            }
            return Some((name, false));
        }

        None
    }

    /// Parse reg value data from a line like `"name"=dword:00000001`.
    fn parse_reg_value_data(line: &str) -> Option<(RegistryValueType, serde_json::Value)> {
        let eq_pos = line.find('=')?;
        let data_part = line[eq_pos + 1..].trim();

        // String value: "value"
        if data_part.starts_with('"') && data_part.ends_with('"') && data_part.len() >= 2 {
            let s = data_part[1..data_part.len() - 1]
                .replace("\\\\", "\\")
                .replace("\\\"", "\"");
            return Some((RegistryValueType::String, serde_json::Value::String(s)));
        }

        // DWORD: dword:xxxxxxxx
        if let Some(hex) = data_part.strip_prefix("dword:") {
            let n = u32::from_str_radix(hex.trim(), 16).unwrap_or(0);
            return Some((
                RegistryValueType::DWord,
                serde_json::Value::Number(serde_json::Number::from(n)),
            ));
        }

        // QWORD: hex(b):xx,xx,...
        if let Some(hex_data) = data_part.strip_prefix("hex(b):") {
            let bytes: Vec<u8> = Self::parse_hex_bytes(hex_data);
            let mut arr = [0u8; 8];
            for (i, &b) in bytes.iter().take(8).enumerate() {
                arr[i] = b;
            }
            let n = u64::from_le_bytes(arr);
            return Some((RegistryValueType::QWord, serde_json::json!(n)));
        }

        // ExpandString: hex(2):xx,xx,...
        if let Some(hex_data) = data_part.strip_prefix("hex(2):") {
            let bytes = Self::parse_hex_bytes(hex_data);
            let s = Self::decode_utf16_bytes(&bytes);
            return Some((
                RegistryValueType::ExpandString,
                serde_json::Value::String(s),
            ));
        }

        // MultiString: hex(7):xx,xx,...
        if let Some(hex_data) = data_part.strip_prefix("hex(7):") {
            let bytes = Self::parse_hex_bytes(hex_data);
            let strings = Self::decode_multi_string_bytes(&bytes);
            return Some((
                RegistryValueType::MultiString,
                serde_json::Value::Array(
                    strings.into_iter().map(serde_json::Value::String).collect(),
                ),
            ));
        }

        // Binary: hex:xx,xx,...
        if let Some(hex_data) = data_part.strip_prefix("hex:") {
            let bytes = Self::parse_hex_bytes(hex_data);
            return Some((
                RegistryValueType::Binary,
                serde_json::Value::Array(
                    bytes
                        .into_iter()
                        .map(|b| serde_json::Value::Number(serde_json::Number::from(b)))
                        .collect(),
                ),
            ));
        }

        None
    }

    /// Parse hex bytes from comma-separated hex string.
    fn parse_hex_bytes(s: &str) -> Vec<u8> {
        s.split(',')
            .filter_map(|h| {
                let h = h.trim().replace('\\', "").replace('\r', "").replace('\n', "");
                if h.is_empty() {
                    None
                } else {
                    u8::from_str_radix(&h, 16).ok()
                }
            })
            .collect()
    }

    /// Decode UTF-16LE bytes to a String, stripping trailing null.
    fn decode_utf16_bytes(bytes: &[u8]) -> String {
        let u16s: Vec<u16> = bytes
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();

        // Strip trailing null
        let end = u16s.iter().position(|&c| c == 0).unwrap_or(u16s.len());
        String::from_utf16_lossy(&u16s[..end])
    }

    /// Decode a multi-string (double-null-terminated UTF-16LE) to Vec<String>.
    fn decode_multi_string_bytes(bytes: &[u8]) -> Vec<String> {
        let u16s: Vec<u16> = bytes
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();

        let mut strings = Vec::new();
        let mut start = 0;

        for (i, &ch) in u16s.iter().enumerate() {
            if ch == 0 {
                if i > start {
                    strings.push(String::from_utf16_lossy(&u16s[start..i]));
                }
                start = i + 1;
            }
        }

        strings
    }

    // ─── Snapshots & Comparison ──────────────────────────────────────

    /// Capture a snapshot of a registry subtree.
    pub async fn snapshot(
        transport: &mut WmiTransport,
        hive: &RegistryHive,
        path: &str,
        computer_name: &str,
        max_depth: u32,
    ) -> Result<RegistrySnapshot, String> {
        info!(
            "Capturing registry snapshot: {}\\{} on {}",
            hive.display_name(),
            path,
            computer_name
        );

        let mut keys = Vec::new();
        Self::snapshot_inner(transport, hive, path, max_depth, 0, &mut keys).await?;

        Ok(RegistrySnapshot {
            hive: hive.clone(),
            root_path: path.to_string(),
            computer_name: computer_name.to_string(),
            captured_at: chrono::Utc::now(),
            keys,
        })
    }

    fn snapshot_inner<'a>(
        transport: &'a mut WmiTransport,
        hive: &'a RegistryHive,
        path: &'a str,
        max_depth: u32,
        depth: u32,
        keys: &'a mut Vec<RegistrySnapshotKey>,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), String>> + Send + 'a>> {
        Box::pin(async move {
            // Read values for this key
            let values = match Self::get_key_info(transport, hive, path).await {
                Ok(info) => info.values,
                Err(_) => Vec::new(),
            };

            keys.push(RegistrySnapshotKey {
                path: path.to_string(),
                values,
            });

            // Recurse if within depth
            if max_depth == 0 || depth < max_depth {
                if let Ok(subkeys) = Self::enum_keys(transport, hive, path).await {
                    for subkey in subkeys {
                        let child_path = if path.is_empty() {
                            subkey
                        } else {
                            format!("{}\\{}", path, subkey)
                        };
                        Self::snapshot_inner(transport, hive, &child_path, max_depth, depth + 1, keys)
                            .await?;
                    }
                }
            }

            Ok(())
        })
    }

    /// Compare two registry snapshots and return the differences.
    pub fn compare_snapshots(
        source: &RegistrySnapshot,
        target: &RegistrySnapshot,
    ) -> RegistryDiff {
        let mut entries = Vec::new();

        let source_map: HashMap<&str, &RegistrySnapshotKey> =
            source.keys.iter().map(|k| (k.path.as_str(), k)).collect();
        let target_map: HashMap<&str, &RegistrySnapshotKey> =
            target.keys.iter().map(|k| (k.path.as_str(), k)).collect();

        let mut values_identical = 0u32;

        // Keys only in source
        for (path, src_key) in &source_map {
            if !target_map.contains_key(path) {
                entries.push(RegistryDiffEntry {
                    path: path.to_string(),
                    diff_type: RegistryDiffType::KeyOnlyInSource,
                    value_name: None,
                    source_value: None,
                    target_value: None,
                });
            } else {
                // Key exists in both — compare values
                let tgt_key = target_map[path];
                let src_vals: HashMap<&str, &RegistryValue> =
                    src_key.values.iter().map(|v| (v.name.as_str(), v)).collect();
                let tgt_vals: HashMap<&str, &RegistryValue> =
                    tgt_key.values.iter().map(|v| (v.name.as_str(), v)).collect();

                for (vname, sv) in &src_vals {
                    if let Some(tv) = tgt_vals.get(vname) {
                        if sv.data != tv.data || sv.value_type != tv.value_type {
                            entries.push(RegistryDiffEntry {
                                path: path.to_string(),
                                diff_type: RegistryDiffType::ValueDifferent,
                                value_name: Some(vname.to_string()),
                                source_value: Some((*sv).clone()),
                                target_value: Some((*tv).clone()),
                            });
                        } else {
                            values_identical += 1;
                        }
                    } else {
                        entries.push(RegistryDiffEntry {
                            path: path.to_string(),
                            diff_type: RegistryDiffType::ValueOnlyInSource,
                            value_name: Some(vname.to_string()),
                            source_value: Some((*sv).clone()),
                            target_value: None,
                        });
                    }
                }

                for (vname, tv) in &tgt_vals {
                    if !src_vals.contains_key(vname) {
                        entries.push(RegistryDiffEntry {
                            path: path.to_string(),
                            diff_type: RegistryDiffType::ValueOnlyInTarget,
                            value_name: Some(vname.to_string()),
                            source_value: None,
                            target_value: Some((*tv).clone()),
                        });
                    }
                }
            }
        }

        // Keys only in target
        for path in target_map.keys() {
            if !source_map.contains_key(path) {
                entries.push(RegistryDiffEntry {
                    path: path.to_string(),
                    diff_type: RegistryDiffType::KeyOnlyInTarget,
                    value_name: None,
                    source_value: None,
                    target_value: None,
                });
            }
        }

        let summary = RegistryDiffSummary {
            keys_only_in_source: entries
                .iter()
                .filter(|e| e.diff_type == RegistryDiffType::KeyOnlyInSource)
                .count() as u32,
            keys_only_in_target: entries
                .iter()
                .filter(|e| e.diff_type == RegistryDiffType::KeyOnlyInTarget)
                .count() as u32,
            values_only_in_source: entries
                .iter()
                .filter(|e| e.diff_type == RegistryDiffType::ValueOnlyInSource)
                .count() as u32,
            values_only_in_target: entries
                .iter()
                .filter(|e| e.diff_type == RegistryDiffType::ValueOnlyInTarget)
                .count() as u32,
            values_different: entries
                .iter()
                .filter(|e| e.diff_type == RegistryDiffType::ValueDifferent)
                .count() as u32,
            values_identical,
        };

        RegistryDiff {
            source: RegistryDiffSide {
                computer_name: source.computer_name.clone(),
                hive: source.hive.clone(),
                root_path: source.root_path.clone(),
                captured_at: source.captured_at,
            },
            target: RegistryDiffSide {
                computer_name: target.computer_name.clone(),
                hive: target.hive.clone(),
                root_path: target.root_path.clone(),
                captured_at: target.captured_at,
            },
            entries,
            summary,
        }
    }

    // ─── Bulk Operations ─────────────────────────────────────────────

    /// Set multiple registry values in a single operation.
    pub async fn bulk_set(
        transport: &mut WmiTransport,
        request: &RegistryBulkSetRequest,
    ) -> Result<RegistryBulkSetResult, String> {
        info!(
            "Bulk setting {} values at {}\\{}",
            request.values.len(),
            request.hive.display_name(),
            request.path
        );

        let mut result = RegistryBulkSetResult {
            total: request.values.len() as u32,
            succeeded: 0,
            failed: 0,
            errors: Vec::new(),
        };

        // Optionally create the key
        if request.create_key {
            if let Err(e) = Self::create_key(transport, &request.hive, &request.path).await {
                debug!("Key creation (may already exist): {}", e);
            }
        }

        for val in &request.values {
            match Self::set_typed_value(
                transport,
                &request.hive,
                &request.path,
                &val.name,
                &val.value_type,
                &val.data,
            )
            .await
            {
                Ok(()) => result.succeeded += 1,
                Err(e) => {
                    result.failed += 1;
                    result.errors.push(RegistryBulkError {
                        name: val.name.clone(),
                        error: e,
                    });
                }
            }
        }

        Ok(result)
    }

    // ─── Copy Key ────────────────────────────────────────────────────

    /// Copy a registry key (with all values) to another location.
    pub async fn copy_key(
        transport: &mut WmiTransport,
        request: &RegistryCopyRequest,
    ) -> Result<RegistryCopyResult, String> {
        info!(
            "Copying {}\\{} to {}\\{}",
            request.source_hive.display_name(),
            request.source_path,
            request.dest_hive.display_name(),
            request.dest_path
        );

        let mut result = RegistryCopyResult {
            keys_created: 0,
            values_copied: 0,
            errors: Vec::new(),
        };

        Self::copy_key_inner(transport, request, &request.source_path, &request.dest_path, &mut result)
            .await;

        Ok(result)
    }

    fn copy_key_inner<'a>(
        transport: &'a mut WmiTransport,
        request: &'a RegistryCopyRequest,
        src_path: &'a str,
        dst_path: &'a str,
        result: &'a mut RegistryCopyResult,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send + 'a>> {
        Box::pin(async move {
            // Create destination key
            if let Err(e) = Self::create_key(transport, &request.dest_hive, dst_path).await {
                result
                    .errors
                    .push(format!("Create key {}: {}", dst_path, e));
                return;
            }
            result.keys_created += 1;

            // Copy values
            if let Ok(info) = Self::get_key_info(transport, &request.source_hive, src_path).await {
                for val in &info.values {
                    // Check if exists at destination when not overwriting
                    if !request.overwrite {
                        if let Ok(_) =
                            Self::get_value(transport, &request.dest_hive, dst_path, &val.name).await
                        {
                            continue; // Skip — already exists
                        }
                    }

                    match Self::set_typed_value(
                        transport,
                        &request.dest_hive,
                        dst_path,
                        &val.name,
                        &val.value_type,
                        &val.data,
                    )
                    .await
                    {
                        Ok(()) => result.values_copied += 1,
                        Err(e) => result
                            .errors
                            .push(format!("Copy value {}\\{}: {}", dst_path, val.name, e)),
                    }
                }
            }

            // Recurse into subkeys
            if let Ok(subkeys) =
                Self::enum_keys(transport, &request.source_hive, src_path).await
            {
                for subkey in subkeys {
                    let child_src = format!("{}\\{}", src_path, subkey);
                    let child_dst = format!("{}\\{}", dst_path, subkey);
                    Self::copy_key_inner(transport, request, &child_src, &child_dst, result).await;
                }
            }
        })
    }

    /// Rename a registry value (copy + delete).
    pub async fn rename_value(
        transport: &mut WmiTransport,
        hive: &RegistryHive,
        path: &str,
        old_name: &str,
        new_name: &str,
    ) -> Result<(), String> {
        info!(
            "Renaming registry value {}\\{}\\{} → {}",
            hive.display_name(),
            path,
            old_name,
            new_name
        );

        // Read the existing value
        let val = Self::get_value(transport, hive, path, old_name).await?;

        // Write with new name
        Self::set_typed_value(transport, hive, path, new_name, &val.value_type, &val.data)
            .await?;

        // Delete old
        Self::delete_value(transport, hive, path, old_name).await?;

        Ok(())
    }

    // ─── Security ────────────────────────────────────────────────────

    /// Get the security descriptor for a registry key.
    pub async fn get_security(
        transport: &mut WmiTransport,
        hive: &RegistryHive,
        path: &str,
    ) -> Result<RegistryKeySecurity, String> {
        debug!(
            "Getting security for {}\\{}",
            hive.display_name(),
            path
        );

        // Use GetSecurityDescriptor method
        let mut params = HashMap::new();
        params.insert("hDefKey".to_string(), hive.to_wmi_value().to_string());
        params.insert("sSubKeyName".to_string(), path.to_string());

        let result = transport
            .invoke_method("StdRegProv", "GetSecurityDescriptor", None, &params)
            .await?;

        Self::check_return(&result, "GetSecurityDescriptor")?;

        // Parse the security descriptor from the response
        let owner = result.get("Owner").cloned();
        let group = result.get("Group").cloned();
        let sddl = result.get("SDDL").cloned();

        // Parse DACL into ACE entries
        let permissions = Self::parse_dacl_from_result(&result);

        Ok(RegistryKeySecurity {
            hive: hive.clone(),
            path: path.to_string(),
            owner,
            group,
            sddl,
            permissions,
        })
    }

    /// Parse access control entries from the security descriptor result.
    fn parse_dacl_from_result(result: &HashMap<String, String>) -> Vec<RegistryAce> {
        // The DACL from WMI GetSecurityDescriptor comes as a structured
        // response. We parse what we can from the flat key-value map.
        let mut aces = Vec::new();

        // Look for indexed ACE entries (DACL.0.Trustee, DACL.0.AccessMask, etc.)
        let mut idx = 0;
        loop {
            let trustee_key = format!("DACL.{}.Trustee.Name", idx);
            let mask_key = format!("DACL.{}.AccessMask", idx);
            let type_key = format!("DACL.{}.AceType", idx);
            let flags_key = format!("DACL.{}.AceFlags", idx);

            let trustee = match result.get(&trustee_key) {
                Some(t) => t.clone(),
                None => break,
            };

            let access_mask = result
                .get(&mask_key)
                .and_then(|v| v.parse::<u32>().ok())
                .unwrap_or(0);

            let ace_type = result
                .get(&type_key)
                .cloned()
                .unwrap_or_else(|| "Allow".to_string());

            let ace_flags = result
                .get(&flags_key)
                .and_then(|v| v.parse::<u32>().ok())
                .unwrap_or(0);

            let permissions = Self::decode_access_mask(access_mask);

            aces.push(RegistryAce {
                trustee,
                access_mask,
                ace_type,
                ace_flags,
                permissions,
            });

            idx += 1;
        }

        aces
    }

    /// Decode an access mask into human-readable permission names.
    fn decode_access_mask(mask: u32) -> Vec<String> {
        let mut perms = Vec::new();

        // Standard registry access rights
        if mask & 0x0001 != 0 {
            perms.push("QueryValue".to_string());
        }
        if mask & 0x0002 != 0 {
            perms.push("SetValue".to_string());
        }
        if mask & 0x0004 != 0 {
            perms.push("CreateSubKey".to_string());
        }
        if mask & 0x0008 != 0 {
            perms.push("EnumerateSubKeys".to_string());
        }
        if mask & 0x0010 != 0 {
            perms.push("Notify".to_string());
        }
        if mask & 0x0020 != 0 {
            perms.push("CreateLink".to_string());
        }
        // Generic rights
        if mask & 0x20000 != 0 {
            perms.push("ReadControl".to_string());
        }
        if mask & 0x40000 != 0 {
            perms.push("WriteDac".to_string());
        }
        if mask & 0x80000 != 0 {
            perms.push("WriteOwner".to_string());
        }
        if mask & 0x10000 != 0 {
            perms.push("Delete".to_string());
        }
        // Full control
        if mask == 0xF003F {
            perms.clear();
            perms.push("FullControl".to_string());
        }

        perms
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

    #[test]
    fn test_matches_pattern_case_insensitive() {
        assert!(RegistryManager::matches_pattern("FooBar", "foobar", false));
        assert!(RegistryManager::matches_pattern("FooBar", "oob", false));
        assert!(!RegistryManager::matches_pattern("FooBar", "xyz", false));
    }

    #[test]
    fn test_matches_pattern_glob() {
        assert!(RegistryManager::matches_pattern("foobar", "foo*", true));
        assert!(RegistryManager::matches_pattern("foobar", "*bar", true));
        assert!(RegistryManager::matches_pattern("foobar", "f*r", true));
        assert!(!RegistryManager::matches_pattern("foobar", "baz*", true));
    }

    #[test]
    fn test_simple_glob_match() {
        assert!(RegistryManager::simple_glob_match("hello", "hel.*"));
        assert!(RegistryManager::simple_glob_match("hello", ".*llo"));
        assert!(!RegistryManager::simple_glob_match("hello", ".*xyz"));
    }

    #[test]
    fn test_parse_reg_key_path() {
        let (hive, path) = RegistryManager::parse_reg_key_path(
            "HKEY_LOCAL_MACHINE\\Software\\Test",
        )
        .unwrap();
        assert_eq!(hive, RegistryHive::HkeyLocalMachine);
        assert_eq!(path, "Software\\Test");

        let (hive, path) =
            RegistryManager::parse_reg_key_path("HKCU\\Software").unwrap();
        assert_eq!(hive, RegistryHive::HkeyCurrentUser);
        assert_eq!(path, "Software");

        assert!(RegistryManager::parse_reg_key_path("INVALID\\test").is_none());
    }

    #[test]
    fn test_parse_reg_value_line_default() {
        let (name, delete) = RegistryManager::parse_reg_value_line("@=\"hello\"").unwrap();
        assert_eq!(name, "");
        assert!(!delete);
    }

    #[test]
    fn test_parse_reg_value_line_named() {
        let (name, delete) =
            RegistryManager::parse_reg_value_line("\"MyValue\"=dword:00000001").unwrap();
        assert_eq!(name, "MyValue");
        assert!(!delete);
    }

    #[test]
    fn test_parse_reg_value_line_delete() {
        let (name, delete) =
            RegistryManager::parse_reg_value_line("\"OldValue\"=-").unwrap();
        assert_eq!(name, "OldValue");
        assert!(delete);
    }

    #[test]
    fn test_parse_reg_value_data_string() {
        let (vtype, data) =
            RegistryManager::parse_reg_value_data("\"Name\"=\"Hello World\"").unwrap();
        assert_eq!(vtype, RegistryValueType::String);
        assert_eq!(data.as_str().unwrap(), "Hello World");
    }

    #[test]
    fn test_parse_reg_value_data_dword() {
        let (vtype, data) =
            RegistryManager::parse_reg_value_data("\"Val\"=dword:0000000a").unwrap();
        assert_eq!(vtype, RegistryValueType::DWord);
        assert_eq!(data.as_u64().unwrap(), 10);
    }

    #[test]
    fn test_parse_reg_value_data_binary() {
        let (vtype, data) =
            RegistryManager::parse_reg_value_data("\"Bin\"=hex:01,02,ff").unwrap();
        assert_eq!(vtype, RegistryValueType::Binary);
        let arr = data.as_array().unwrap();
        assert_eq!(arr.len(), 3);
        assert_eq!(arr[0].as_u64().unwrap(), 1);
        assert_eq!(arr[2].as_u64().unwrap(), 255);
    }

    #[test]
    fn test_parse_hex_bytes() {
        let bytes = RegistryManager::parse_hex_bytes("01,ff,0a");
        assert_eq!(bytes, vec![1, 255, 10]);

        let empty = RegistryManager::parse_hex_bytes("");
        assert!(empty.is_empty());
    }

    #[test]
    fn test_decode_utf16_bytes() {
        // "Hi" in UTF-16LE: 0x48 0x00 0x69 0x00 0x00 0x00
        let bytes = vec![0x48, 0x00, 0x69, 0x00, 0x00, 0x00];
        assert_eq!(RegistryManager::decode_utf16_bytes(&bytes), "Hi");
    }

    #[test]
    fn test_decode_multi_string_bytes() {
        // "A\0B\0\0" in UTF-16LE
        let bytes = vec![
            0x41, 0x00, // A
            0x00, 0x00, // null
            0x42, 0x00, // B
            0x00, 0x00, // null
            0x00, 0x00, // final null
        ];
        let result = RegistryManager::decode_multi_string_bytes(&bytes);
        assert_eq!(result, vec!["A", "B"]);
    }

    #[test]
    fn test_value_to_reg_line_string() {
        let val = RegistryValue {
            name: "Test".to_string(),
            value_type: RegistryValueType::String,
            data: serde_json::Value::String("Hello".to_string()),
        };
        assert_eq!(
            RegistryManager::value_to_reg_line(&val),
            "\"Test\"=\"Hello\""
        );
    }

    #[test]
    fn test_value_to_reg_line_dword() {
        let val = RegistryValue {
            name: "Count".to_string(),
            value_type: RegistryValueType::DWord,
            data: serde_json::json!(255),
        };
        assert_eq!(
            RegistryManager::value_to_reg_line(&val),
            "\"Count\"=dword:000000ff"
        );
    }

    #[test]
    fn test_value_to_reg_line_default_value() {
        let val = RegistryValue {
            name: "@".to_string(),
            value_type: RegistryValueType::String,
            data: serde_json::Value::String("default".to_string()),
        };
        assert_eq!(
            RegistryManager::value_to_reg_line(&val),
            "@=\"default\""
        );
    }

    #[test]
    fn test_escape_reg_string() {
        assert_eq!(
            RegistryManager::escape_reg_string("C:\\path\\to\\file"),
            "C:\\\\path\\\\to\\\\file"
        );
        assert_eq!(
            RegistryManager::escape_reg_string("He said \"hi\""),
            "He said \\\"hi\\\""
        );
    }

    #[test]
    fn test_compare_snapshots_identical() {
        let snap = RegistrySnapshot {
            hive: RegistryHive::HkeyLocalMachine,
            root_path: "Software\\Test".to_string(),
            computer_name: "PC1".to_string(),
            captured_at: chrono::Utc::now(),
            keys: vec![RegistrySnapshotKey {
                path: "Software\\Test".to_string(),
                values: vec![RegistryValue {
                    name: "v1".to_string(),
                    value_type: RegistryValueType::String,
                    data: serde_json::Value::String("hello".to_string()),
                }],
            }],
        };

        let diff = RegistryManager::compare_snapshots(&snap, &snap);
        assert_eq!(diff.summary.values_identical, 1);
        assert_eq!(diff.summary.values_different, 0);
        assert!(diff.entries.is_empty());
    }

    #[test]
    fn test_compare_snapshots_different_values() {
        let source = RegistrySnapshot {
            hive: RegistryHive::HkeyLocalMachine,
            root_path: "Software\\Test".to_string(),
            computer_name: "PC1".to_string(),
            captured_at: chrono::Utc::now(),
            keys: vec![RegistrySnapshotKey {
                path: "Software\\Test".to_string(),
                values: vec![RegistryValue {
                    name: "v1".to_string(),
                    value_type: RegistryValueType::String,
                    data: serde_json::Value::String("hello".to_string()),
                }],
            }],
        };

        let target = RegistrySnapshot {
            hive: RegistryHive::HkeyLocalMachine,
            root_path: "Software\\Test".to_string(),
            computer_name: "PC2".to_string(),
            captured_at: chrono::Utc::now(),
            keys: vec![RegistrySnapshotKey {
                path: "Software\\Test".to_string(),
                values: vec![RegistryValue {
                    name: "v1".to_string(),
                    value_type: RegistryValueType::String,
                    data: serde_json::Value::String("world".to_string()),
                }],
            }],
        };

        let diff = RegistryManager::compare_snapshots(&source, &target);
        assert_eq!(diff.summary.values_different, 1);
        assert_eq!(diff.summary.values_identical, 0);
        assert_eq!(diff.entries.len(), 1);
        assert_eq!(diff.entries[0].diff_type, RegistryDiffType::ValueDifferent);
    }

    #[test]
    fn test_compare_snapshots_missing_keys() {
        let source = RegistrySnapshot {
            hive: RegistryHive::HkeyLocalMachine,
            root_path: "Software".to_string(),
            computer_name: "PC1".to_string(),
            captured_at: chrono::Utc::now(),
            keys: vec![
                RegistrySnapshotKey {
                    path: "Software\\A".to_string(),
                    values: vec![],
                },
                RegistrySnapshotKey {
                    path: "Software\\B".to_string(),
                    values: vec![],
                },
            ],
        };

        let target = RegistrySnapshot {
            hive: RegistryHive::HkeyLocalMachine,
            root_path: "Software".to_string(),
            computer_name: "PC2".to_string(),
            captured_at: chrono::Utc::now(),
            keys: vec![RegistrySnapshotKey {
                path: "Software\\A".to_string(),
                values: vec![],
            }],
        };

        let diff = RegistryManager::compare_snapshots(&source, &target);
        assert_eq!(diff.summary.keys_only_in_source, 1);
        assert_eq!(diff.summary.keys_only_in_target, 0);
    }

    #[test]
    fn test_decode_access_mask_full_control() {
        let perms = RegistryManager::decode_access_mask(0xF003F);
        assert_eq!(perms, vec!["FullControl"]);
    }

    #[test]
    fn test_decode_access_mask_read() {
        let perms = RegistryManager::decode_access_mask(0x20019);
        assert!(perms.contains(&"QueryValue".to_string()));
        assert!(perms.contains(&"EnumerateSubKeys".to_string()));
        assert!(perms.contains(&"Notify".to_string()));
        assert!(perms.contains(&"ReadControl".to_string()));
    }

    #[test]
    fn test_parse_reg_value_data_qword() {
        let (vtype, data) = RegistryManager::parse_reg_value_data(
            "\"Q\"=hex(b):ff,00,00,00,00,00,00,00",
        )
        .unwrap();
        assert_eq!(vtype, RegistryValueType::QWord);
        assert_eq!(data.as_u64().unwrap(), 255);
    }

    #[test]
    fn test_parse_reg_value_data_expand_string() {
        // "%SystemRoot%" in UTF-16LE + null
        let (vtype, _data) = RegistryManager::parse_reg_value_data(
            "\"Path\"=hex(2):25,00,53,00,79,00,73,00,74,00,65,00,6d,00,52,00,6f,00,6f,00,74,00,25,00,00,00",
        )
        .unwrap();
        assert_eq!(vtype, RegistryValueType::ExpandString);
    }
}
