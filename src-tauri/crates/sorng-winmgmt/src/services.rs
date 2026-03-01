//! Remote Windows Service management via WMI (Win32_Service).
//!
//! Provides operations for listing, inspecting, starting, stopping,
//! restarting, pausing, resuming, and reconfiguring services on remote
//! Windows hosts through the WMI-over-WinRM transport.

use crate::transport::WmiTransport;
use crate::types::*;
use crate::wql::{WqlBuilder, WqlQueries};
use log::{debug, info};
use std::collections::HashMap;

/// Manages remote Windows services via WMI.
pub struct ServiceManager;

impl ServiceManager {
    // ─── Query ───────────────────────────────────────────────────────

    /// List all services on the remote host.
    pub async fn list_services(
        transport: &mut WmiTransport,
    ) -> Result<Vec<WindowsService>, String> {
        let query = WqlQueries::all_services();
        let rows = transport.wql_query(&query).await?;
        let services = rows.iter().map(|r| Self::row_to_service(r)).collect();
        Ok(services)
    }

    /// Get a single service by name.
    pub async fn get_service(
        transport: &mut WmiTransport,
        name: &str,
    ) -> Result<WindowsService, String> {
        let query = WqlQueries::service_by_name(name);
        let rows = transport.wql_query(&query).await?;
        let row = rows
            .first()
            .ok_or_else(|| format!("Service '{}' not found", name))?;
        Ok(Self::row_to_service(row))
    }

    /// Search services by display name pattern.
    pub async fn search_services(
        transport: &mut WmiTransport,
        pattern: &str,
    ) -> Result<Vec<WindowsService>, String> {
        let query = WqlBuilder::select("Win32_Service")
            .where_like("DisplayName", &format!("%{}%", pattern))
            .build();
        let rows = transport.wql_query(&query).await?;
        Ok(rows.iter().map(|r| Self::row_to_service(r)).collect())
    }

    /// List services in a specific state.
    pub async fn services_by_state(
        transport: &mut WmiTransport,
        state: &str,
    ) -> Result<Vec<WindowsService>, String> {
        let query = WqlQueries::services_by_state(state);
        let rows = transport.wql_query(&query).await?;
        Ok(rows.iter().map(|r| Self::row_to_service(r)).collect())
    }

    /// List services with a specific start mode.
    pub async fn services_by_start_mode(
        transport: &mut WmiTransport,
        mode: &str,
    ) -> Result<Vec<WindowsService>, String> {
        let query = WqlQueries::services_by_start_mode(mode);
        let rows = transport.wql_query(&query).await?;
        Ok(rows.iter().map(|r| Self::row_to_service(r)).collect())
    }

    /// Get service dependencies (services this service depends on).
    pub async fn get_dependencies(
        transport: &mut WmiTransport,
        name: &str,
    ) -> Result<Vec<String>, String> {
        let query = format!(
            "ASSOCIATORS OF {{Win32_Service.Name='{}'}} WHERE AssocClass = Win32_DependentService Role = Dependent",
            name.replace('\'', "\\'")
        );
        let rows = transport.wql_query(&query).await?;
        Ok(rows
            .iter()
            .filter_map(|r| r.get("Name").cloned())
            .collect())
    }

    /// Get dependent services (services that depend on this service).
    pub async fn get_dependents(
        transport: &mut WmiTransport,
        name: &str,
    ) -> Result<Vec<String>, String> {
        let query = format!(
            "ASSOCIATORS OF {{Win32_Service.Name='{}'}} WHERE AssocClass = Win32_DependentService Role = Antecedent",
            name.replace('\'', "\\'")
        );
        let rows = transport.wql_query(&query).await?;
        Ok(rows
            .iter()
            .filter_map(|r| r.get("Name").cloned())
            .collect())
    }

    // ─── Control ─────────────────────────────────────────────────────

    /// Start a service.
    pub async fn start_service(
        transport: &mut WmiTransport,
        name: &str,
    ) -> Result<u32, String> {
        info!("Starting service '{}'", name);
        let result = transport
            .invoke_method(
                "Win32_Service",
                "StartService",
                Some(&[("Name", name)]),
                &HashMap::new(),
            )
            .await?;

        let return_value = result
            .get("ReturnValue")
            .and_then(|v| v.parse::<u32>().ok())
            .unwrap_or(0);

        Self::check_service_return(name, "start", return_value)?;
        Ok(return_value)
    }

    /// Stop a service.
    pub async fn stop_service(
        transport: &mut WmiTransport,
        name: &str,
    ) -> Result<u32, String> {
        info!("Stopping service '{}'", name);
        let result = transport
            .invoke_method(
                "Win32_Service",
                "StopService",
                Some(&[("Name", name)]),
                &HashMap::new(),
            )
            .await?;

        let return_value = result
            .get("ReturnValue")
            .and_then(|v| v.parse::<u32>().ok())
            .unwrap_or(0);

        Self::check_service_return(name, "stop", return_value)?;
        Ok(return_value)
    }

    /// Pause a service.
    pub async fn pause_service(
        transport: &mut WmiTransport,
        name: &str,
    ) -> Result<u32, String> {
        info!("Pausing service '{}'", name);
        let result = transport
            .invoke_method(
                "Win32_Service",
                "PauseService",
                Some(&[("Name", name)]),
                &HashMap::new(),
            )
            .await?;

        let return_value = result
            .get("ReturnValue")
            .and_then(|v| v.parse::<u32>().ok())
            .unwrap_or(0);

        Self::check_service_return(name, "pause", return_value)?;
        Ok(return_value)
    }

    /// Resume a paused service.
    pub async fn resume_service(
        transport: &mut WmiTransport,
        name: &str,
    ) -> Result<u32, String> {
        info!("Resuming service '{}'", name);
        let result = transport
            .invoke_method(
                "Win32_Service",
                "ResumeService",
                Some(&[("Name", name)]),
                &HashMap::new(),
            )
            .await?;

        let return_value = result
            .get("ReturnValue")
            .and_then(|v| v.parse::<u32>().ok())
            .unwrap_or(0);

        Self::check_service_return(name, "resume", return_value)?;
        Ok(return_value)
    }

    /// Restart a service (stop then start).
    pub async fn restart_service(
        transport: &mut WmiTransport,
        name: &str,
    ) -> Result<u32, String> {
        info!("Restarting service '{}'", name);

        // Check current state
        let svc = Self::get_service(transport, name).await?;
        if svc.state == ServiceState::Running {
            let stop_result = Self::stop_service(transport, name).await?;
            if stop_result != 0 {
                return Err(format!(
                    "Failed to stop service '{}' during restart (code {})",
                    name, stop_result
                ));
            }

            // Wait for the service to stop
            Self::wait_for_state(transport, name, ServiceState::Stopped, 30).await?;
        }

        Self::start_service(transport, name).await
    }

    /// Wait for a service to reach a specific state (polling).
    pub async fn wait_for_state(
        transport: &mut WmiTransport,
        name: &str,
        target_state: ServiceState,
        timeout_sec: u32,
    ) -> Result<ServiceState, String> {
        debug!(
            "Waiting for service '{}' to reach state {:?} (timeout {}s)",
            name, target_state, timeout_sec
        );

        let start = std::time::Instant::now();
        let timeout = std::time::Duration::from_secs(timeout_sec as u64);

        loop {
            let svc = Self::get_service(transport, name).await?;
            if svc.state == target_state {
                return Ok(svc.state);
            }

            if start.elapsed() > timeout {
                return Err(format!(
                    "Timeout waiting for service '{}' to reach state {:?} (current: {:?})",
                    name, target_state, svc.state
                ));
            }

            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        }
    }

    // ─── Configuration ───────────────────────────────────────────────

    /// Change service startup type.
    pub async fn set_start_mode(
        transport: &mut WmiTransport,
        name: &str,
        mode: &ServiceStartMode,
    ) -> Result<u32, String> {
        info!("Setting service '{}' start mode to {:?}", name, mode);

        let mut params = HashMap::new();
        params.insert("StartMode".to_string(), mode.to_wmi().to_string());

        let result = transport
            .invoke_method(
                "Win32_Service",
                "ChangeStartMode",
                Some(&[("Name", name)]),
                &params,
            )
            .await?;

        let return_value = result
            .get("ReturnValue")
            .and_then(|v| v.parse::<u32>().ok())
            .unwrap_or(0);

        if return_value != 0 {
            return Err(format!(
                "Failed to change start mode for service '{}': error code {}",
                name, return_value
            ));
        }

        Ok(return_value)
    }

    /// Change service configuration using the Change method.
    pub async fn change_service(
        transport: &mut WmiTransport,
        params: &ServiceChangeParams,
    ) -> Result<u32, String> {
        info!("Changing configuration for service '{}'", params.service_name);

        let mut method_params = HashMap::new();

        if let Some(ref display_name) = params.display_name {
            method_params.insert("DisplayName".to_string(), display_name.clone());
        }
        if let Some(ref path_name) = params.path_name {
            method_params.insert("PathName".to_string(), path_name.clone());
        }
        if let Some(ref start_mode) = params.start_mode {
            method_params.insert("StartMode".to_string(), start_mode.to_wmi().to_string());
        }
        if let Some(ref start_name) = params.start_name {
            method_params.insert("StartName".to_string(), start_name.clone());
        }
        if let Some(ref start_password) = params.start_password {
            method_params.insert("StartPassword".to_string(), start_password.clone());
        }

        let result = transport
            .invoke_method(
                "Win32_Service",
                "Change",
                Some(&[("Name", &params.service_name)]),
                &method_params,
            )
            .await?;

        let return_value = result
            .get("ReturnValue")
            .and_then(|v| v.parse::<u32>().ok())
            .unwrap_or(0);

        if return_value != 0 {
            return Err(format!(
                "Failed to change service '{}': error code {} ({})",
                params.service_name,
                return_value,
                Self::service_error_description(return_value)
            ));
        }

        // Update description separately if provided (Change doesn't support it)
        if let Some(ref desc) = params.description {
            let mut desc_props = HashMap::new();
            desc_props.insert("Description".to_string(), desc.clone());
            let _ = transport
                .put_instance(
                    "Win32_Service",
                    &[("Name", params.service_name.as_str())],
                    &desc_props,
                )
                .await;
        }

        Ok(return_value)
    }

    /// Delete a service.
    pub async fn delete_service(
        transport: &mut WmiTransport,
        name: &str,
    ) -> Result<u32, String> {
        info!("Deleting service '{}'", name);

        let result = transport
            .invoke_method(
                "Win32_Service",
                "Delete",
                Some(&[("Name", name)]),
                &HashMap::new(),
            )
            .await?;

        let return_value = result
            .get("ReturnValue")
            .and_then(|v| v.parse::<u32>().ok())
            .unwrap_or(0);

        if return_value != 0 {
            return Err(format!(
                "Failed to delete service '{}': error code {} ({})",
                name,
                return_value,
                Self::service_error_description(return_value)
            ));
        }

        Ok(return_value)
    }

    /// Get security descriptor for a service (SDDL string).
    pub async fn get_security_descriptor(
        transport: &mut WmiTransport,
        name: &str,
    ) -> Result<String, String> {
        let result = transport
            .invoke_method(
                "Win32_Service",
                "GetSecurityDescriptor",
                Some(&[("Name", name)]),
                &HashMap::new(),
            )
            .await?;

        Ok(result
            .get("Descriptor")
            .cloned()
            .unwrap_or_default())
    }

    // ─── Helpers ─────────────────────────────────────────────────────

    /// Convert a WMI result row to a WindowsService struct.
    fn row_to_service(row: &HashMap<String, String>) -> WindowsService {
        let get = |key: &str| row.get(key).cloned();
        let get_or = |key: &str, default: &str| {
            row.get(key).cloned().unwrap_or_else(|| default.to_string())
        };
        let get_u32 = |key: &str| row.get(key).and_then(|v| v.parse::<u32>().ok());
        let get_bool = |key: &str| {
            row.get(key)
                .map(|v| v.eq_ignore_ascii_case("true") || v == "1")
                .unwrap_or(false)
        };

        WindowsService {
            name: get_or("Name", ""),
            display_name: get_or("DisplayName", ""),
            description: get("Description"),
            state: ServiceState::from_wmi(&get_or("State", "Unknown")),
            start_mode: ServiceStartMode::from_wmi(&get_or("StartMode", "Unknown")),
            service_type: get_or("ServiceType", "Unknown"),
            path_name: get("PathName"),
            process_id: get_u32("ProcessId"),
            exit_code: get_u32("ExitCode"),
            status: get_or("Status", "OK"),
            started: get_bool("Started"),
            accept_pause: get_bool("AcceptPause"),
            accept_stop: get_bool("AcceptStop"),
            start_name: get("StartName"),
            delayed_auto_start: row.get("DelayedAutoStart").map(|v| {
                v.eq_ignore_ascii_case("true") || v == "1"
            }),
            depends_on: Vec::new(),      // populated separately via get_dependencies
            dependent_services: Vec::new(), // populated separately via get_dependents
        }
    }

    /// Get full service info including dependencies.
    pub async fn get_service_full(
        transport: &mut WmiTransport,
        name: &str,
    ) -> Result<WindowsService, String> {
        let mut svc = Self::get_service(transport, name).await?;
        svc.depends_on = Self::get_dependencies(transport, name)
            .await
            .unwrap_or_default();
        svc.dependent_services = Self::get_dependents(transport, name)
            .await
            .unwrap_or_default();
        Ok(svc)
    }

    /// Check the return value from a service control method and generate an error if needed.
    fn check_service_return(name: &str, action: &str, return_value: u32) -> Result<(), String> {
        if return_value == 0 {
            return Ok(());
        }
        Err(format!(
            "Failed to {} service '{}': error code {} ({})",
            action,
            name,
            return_value,
            Self::service_error_description(return_value)
        ))
    }

    /// Human-readable description of Win32_Service method return codes.
    fn service_error_description(code: u32) -> &'static str {
        match code {
            0 => "Success",
            1 => "Not Supported",
            2 => "Access Denied",
            3 => "Dependent Services Running",
            4 => "Invalid Service Control",
            5 => "Service Cannot Accept Control",
            6 => "Service Not Active",
            7 => "Service Request Timeout",
            8 => "Unknown Failure",
            9 => "Path Not Found",
            10 => "Service Already Running",
            11 => "Service Database Locked",
            12 => "Service Dependency Deleted",
            13 => "Service Dependency Failure",
            14 => "Service Disabled",
            15 => "Service Logon Failed",
            16 => "Service Marked For Deletion",
            17 => "Service No Thread",
            18 => "Status Circular Dependency",
            19 => "Status Duplicate Name",
            20 => "Status Invalid Name",
            21 => "Status Invalid Parameter",
            22 => "Status Invalid Service Account",
            23 => "Status Service Exists",
            24 => "Service Already Paused",
            _ => "Unknown error code",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_row_to_service() {
        let mut row = HashMap::new();
        row.insert("Name".to_string(), "Spooler".to_string());
        row.insert("DisplayName".to_string(), "Print Spooler".to_string());
        row.insert("State".to_string(), "Running".to_string());
        row.insert("StartMode".to_string(), "Auto".to_string());
        row.insert("ServiceType".to_string(), "Own Process".to_string());
        row.insert("ProcessId".to_string(), "1234".to_string());
        row.insert("Status".to_string(), "OK".to_string());
        row.insert("Started".to_string(), "True".to_string());
        row.insert("AcceptPause".to_string(), "False".to_string());
        row.insert("AcceptStop".to_string(), "True".to_string());
        row.insert("StartName".to_string(), "LocalSystem".to_string());

        let svc = ServiceManager::row_to_service(&row);
        assert_eq!(svc.name, "Spooler");
        assert_eq!(svc.display_name, "Print Spooler");
        assert_eq!(svc.state, ServiceState::Running);
        assert_eq!(svc.start_mode, ServiceStartMode::Auto);
        assert_eq!(svc.process_id, Some(1234));
        assert!(svc.started);
        assert!(!svc.accept_pause);
        assert!(svc.accept_stop);
    }

    #[test]
    fn test_service_error_description() {
        assert_eq!(
            ServiceManager::service_error_description(0),
            "Success"
        );
        assert_eq!(
            ServiceManager::service_error_description(2),
            "Access Denied"
        );
        assert_eq!(
            ServiceManager::service_error_description(14),
            "Service Disabled"
        );
    }
}
