//! # System Information (SNMPv2-MIB system group)
//!
//! Convenience functions for retrieving standard system MIB objects.

use crate::client::SnmpClient;
use crate::error::SnmpResult;
use crate::oid::well_known;
use crate::types::*;

/// Retrieve the full system info group from a device.
pub async fn get_system_info(
    client: &SnmpClient,
    target: &SnmpTarget,
) -> SnmpResult<SnmpDevice> {
    let oids = vec![
        well_known::SYS_DESCR.to_string(),
        well_known::SYS_OBJECT_ID.to_string(),
        well_known::SYS_UPTIME.to_string(),
        well_known::SYS_CONTACT.to_string(),
        well_known::SYS_NAME.to_string(),
        well_known::SYS_LOCATION.to_string(),
        well_known::SYS_SERVICES.to_string(),
        well_known::IF_NUMBER.to_string(),
    ];

    let response = client.get(target, &oids).await?;

    let mut device = SnmpDevice {
        host: target.host.clone(),
        port: target.port,
        version: target.version,
        sys_descr: None,
        sys_object_id: None,
        sys_uptime: None,
        sys_contact: None,
        sys_name: None,
        sys_location: None,
        sys_services: None,
        if_number: None,
        last_seen: Some(chrono::Utc::now().to_rfc3339()),
        reachable: true,
    };

    for vb in &response.varbinds {
        if vb.value.is_exception() {
            continue;
        }
        match vb.oid.as_str() {
            oid if oid == well_known::SYS_DESCR => {
                device.sys_descr = Some(vb.value.display_value());
            }
            oid if oid == well_known::SYS_OBJECT_ID => {
                device.sys_object_id = Some(vb.value.display_value());
            }
            oid if oid == well_known::SYS_UPTIME => {
                device.sys_uptime = Some(vb.value.display_value());
            }
            oid if oid == well_known::SYS_CONTACT => {
                device.sys_contact = Some(vb.value.display_value());
            }
            oid if oid == well_known::SYS_NAME => {
                device.sys_name = Some(vb.value.display_value());
            }
            oid if oid == well_known::SYS_LOCATION => {
                device.sys_location = Some(vb.value.display_value());
            }
            oid if oid == well_known::SYS_SERVICES => {
                device.sys_services = vb.value.as_integer();
            }
            oid if oid == well_known::IF_NUMBER => {
                device.if_number = vb.value.as_integer();
            }
            _ => {}
        }
    }

    Ok(device)
}

/// Get sysDescr.0.
pub async fn get_sys_descr(client: &SnmpClient, target: &SnmpTarget) -> SnmpResult<String> {
    client.get_string(target, well_known::SYS_DESCR).await
}

/// Get sysObjectID.0.
pub async fn get_sys_object_id(client: &SnmpClient, target: &SnmpTarget) -> SnmpResult<String> {
    client.get_string(target, well_known::SYS_OBJECT_ID).await
}

/// Get sysUpTime.0 as a formatted string.
pub async fn get_sys_uptime(client: &SnmpClient, target: &SnmpTarget) -> SnmpResult<String> {
    client.get_string(target, well_known::SYS_UPTIME).await
}

/// Get sysUpTime.0 as raw ticks (hundredths of a second).
pub async fn get_sys_uptime_ticks(client: &SnmpClient, target: &SnmpTarget) -> SnmpResult<u32> {
    let value = client.get_value(target, well_known::SYS_UPTIME).await?;
    value.as_u32().ok_or_else(|| crate::error::SnmpError::protocol_error("Expected TimeTicks for sysUpTime"))
}

/// Get sysContact.0.
pub async fn get_sys_contact(client: &SnmpClient, target: &SnmpTarget) -> SnmpResult<String> {
    client.get_string(target, well_known::SYS_CONTACT).await
}

/// Get sysName.0.
pub async fn get_sys_name(client: &SnmpClient, target: &SnmpTarget) -> SnmpResult<String> {
    client.get_string(target, well_known::SYS_NAME).await
}

/// Get sysLocation.0.
pub async fn get_sys_location(client: &SnmpClient, target: &SnmpTarget) -> SnmpResult<String> {
    client.get_string(target, well_known::SYS_LOCATION).await
}

/// Check if a target is reachable via SNMP (probes sysUpTime).
pub async fn is_reachable(client: &SnmpClient, target: &SnmpTarget) -> bool {
    client.get_value(target, well_known::SYS_UPTIME).await.is_ok()
}

/// Set sysContact.0.
pub async fn set_sys_contact(
    client: &SnmpClient,
    target: &SnmpTarget,
    contact: &str,
) -> SnmpResult<SnmpResponse> {
    crate::set::set_string(client, target, well_known::SYS_CONTACT, contact).await
}

/// Set sysName.0.
pub async fn set_sys_name(
    client: &SnmpClient,
    target: &SnmpTarget,
    name: &str,
) -> SnmpResult<SnmpResponse> {
    crate::set::set_string(client, target, well_known::SYS_NAME, name).await
}

/// Set sysLocation.0.
pub async fn set_sys_location(
    client: &SnmpClient,
    target: &SnmpTarget,
    location: &str,
) -> SnmpResult<SnmpResponse> {
    crate::set::set_string(client, target, well_known::SYS_LOCATION, location).await
}
