//! # Tauri Commands
//!
//! All `#[tauri::command]` handlers for SNMP functionality.  Each command
//! takes `State<'_, SnmpServiceState>` and delegates to the service.

use crate::error::SnmpResult;
use crate::service::SnmpServiceState;
use crate::types::*;
use std::sync::Arc;
use tauri::State;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn to_err(e: crate::error::SnmpError) -> String {
    e.to_string()
}

fn build_target(
    host: String,
    port: Option<u16>,
    version: Option<String>,
    community: Option<String>,
    v3_creds: Option<V3Credentials>,
    timeout_ms: Option<u64>,
    retries: Option<u32>,
) -> SnmpTarget {
    let version = match version.as_deref() {
        Some("1") | Some("v1") => SnmpVersion::V1,
        Some("3") | Some("v3") => SnmpVersion::V3,
        _ => SnmpVersion::V2c,
    };

    SnmpTarget {
        host,
        port: port.unwrap_or(161),
        version,
        community: community.or_else(|| Some("public".into())),
        v3_credentials: v3_creds,
        timeout_ms: timeout_ms.unwrap_or(5000),
        retries: retries.unwrap_or(1),
    }
}

// ---------------------------------------------------------------------------
// GET / SET / WALK
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn snmp_get(
    state: State<'_, SnmpServiceState>,
    host: String,
    oids: Vec<String>,
    port: Option<u16>,
    version: Option<String>,
    community: Option<String>,
    v3_creds: Option<V3Credentials>,
    timeout_ms: Option<u64>,
    retries: Option<u32>,
) -> Result<SnmpResponse, String> {
    let target = build_target(host, port, version, community, v3_creds, timeout_ms, retries);
    let mut svc = state.lock().await;
    svc.snmp_get(&target, &oids).await.map_err(to_err)
}

#[tauri::command]
pub async fn snmp_get_next(
    state: State<'_, SnmpServiceState>,
    host: String,
    oids: Vec<String>,
    port: Option<u16>,
    version: Option<String>,
    community: Option<String>,
    v3_creds: Option<V3Credentials>,
    timeout_ms: Option<u64>,
    retries: Option<u32>,
) -> Result<SnmpResponse, String> {
    let target = build_target(host, port, version, community, v3_creds, timeout_ms, retries);
    let mut svc = state.lock().await;
    svc.snmp_get_next(&target, &oids).await.map_err(to_err)
}

#[tauri::command]
pub async fn snmp_get_bulk(
    state: State<'_, SnmpServiceState>,
    host: String,
    oids: Vec<String>,
    non_repeaters: Option<i32>,
    max_repetitions: Option<i32>,
    port: Option<u16>,
    version: Option<String>,
    community: Option<String>,
    v3_creds: Option<V3Credentials>,
    timeout_ms: Option<u64>,
    retries: Option<u32>,
) -> Result<SnmpResponse, String> {
    let target = build_target(host, port, version, community, v3_creds, timeout_ms, retries);
    let mut svc = state.lock().await;
    svc.snmp_get_bulk(
        &target,
        &oids,
        non_repeaters.unwrap_or(0),
        max_repetitions.unwrap_or(10),
    )
    .await
    .map_err(to_err)
}

#[tauri::command]
pub async fn snmp_set_value(
    state: State<'_, SnmpServiceState>,
    host: String,
    oid: String,
    value_type: String,
    value: String,
    port: Option<u16>,
    version: Option<String>,
    community: Option<String>,
    v3_creds: Option<V3Credentials>,
    timeout_ms: Option<u64>,
    retries: Option<u32>,
) -> Result<SnmpResponse, String> {
    let target = build_target(host, port, version, community, v3_creds, timeout_ms, retries);
    let snmp_value = parse_typed_value(&value_type, &value).map_err(|e| e.to_string())?;
    let varbinds = vec![(oid, snmp_value)];
    let mut svc = state.lock().await;
    svc.snmp_set(&target, &varbinds).await.map_err(to_err)
}

#[tauri::command]
pub async fn snmp_walk(
    state: State<'_, SnmpServiceState>,
    host: String,
    root_oid: String,
    port: Option<u16>,
    version: Option<String>,
    community: Option<String>,
    v3_creds: Option<V3Credentials>,
    timeout_ms: Option<u64>,
    retries: Option<u32>,
) -> Result<WalkResult, String> {
    let target = build_target(host, port, version, community, v3_creds, timeout_ms, retries);
    let mut svc = state.lock().await;
    svc.snmp_walk(&target, &root_oid).await.map_err(to_err)
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn snmp_get_table(
    state: State<'_, SnmpServiceState>,
    host: String,
    table_oid: String,
    port: Option<u16>,
    version: Option<String>,
    community: Option<String>,
    v3_creds: Option<V3Credentials>,
    timeout_ms: Option<u64>,
    retries: Option<u32>,
) -> Result<SnmpTable, String> {
    let target = build_target(host, port, version, community, v3_creds, timeout_ms, retries);
    let mut svc = state.lock().await;
    svc.snmp_get_table(&target, &table_oid).await.map_err(to_err)
}

#[tauri::command]
pub async fn snmp_get_if_table(
    state: State<'_, SnmpServiceState>,
    host: String,
    port: Option<u16>,
    version: Option<String>,
    community: Option<String>,
    v3_creds: Option<V3Credentials>,
    timeout_ms: Option<u64>,
    retries: Option<u32>,
) -> Result<SnmpTable, String> {
    let target = build_target(host, port, version, community, v3_creds, timeout_ms, retries);
    let mut svc = state.lock().await;
    svc.snmp_get_if_table(&target).await.map_err(to_err)
}

// ---------------------------------------------------------------------------
// System info
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn snmp_get_system_info(
    state: State<'_, SnmpServiceState>,
    host: String,
    port: Option<u16>,
    version: Option<String>,
    community: Option<String>,
    v3_creds: Option<V3Credentials>,
    timeout_ms: Option<u64>,
    retries: Option<u32>,
) -> Result<SnmpDevice, String> {
    let target = build_target(host, port, version, community, v3_creds, timeout_ms, retries);
    let mut svc = state.lock().await;
    svc.get_system_info(&target).await.map_err(to_err)
}

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn snmp_get_interfaces(
    state: State<'_, SnmpServiceState>,
    host: String,
    port: Option<u16>,
    version: Option<String>,
    community: Option<String>,
    v3_creds: Option<V3Credentials>,
    timeout_ms: Option<u64>,
    retries: Option<u32>,
) -> Result<Vec<InterfaceInfo>, String> {
    let target = build_target(host, port, version, community, v3_creds, timeout_ms, retries);
    let mut svc = state.lock().await;
    svc.get_interfaces(&target).await.map_err(to_err)
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn snmp_discover(
    state: State<'_, SnmpServiceState>,
    config: DiscoveryConfig,
) -> Result<DiscoveryResult, String> {
    let svc = state.lock().await;
    svc.discover_subnet(config).await.map_err(to_err)
}

// ---------------------------------------------------------------------------
// Trap receiver
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn snmp_start_trap_receiver(
    state: State<'_, SnmpServiceState>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.start_trap_receiver().await.map_err(to_err)
}

#[tauri::command]
pub async fn snmp_stop_trap_receiver(
    state: State<'_, SnmpServiceState>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.stop_trap_receiver();
    Ok(())
}

#[tauri::command]
pub async fn snmp_get_trap_receiver_status(
    state: State<'_, SnmpServiceState>,
) -> Result<TrapReceiverStatus, String> {
    let svc = state.lock().await;
    Ok(svc.get_trap_receiver_status())
}

#[tauri::command]
pub async fn snmp_get_traps(
    state: State<'_, SnmpServiceState>,
    limit: Option<usize>,
) -> Result<Vec<SnmpTrap>, String> {
    let svc = state.lock().await;
    Ok(svc.get_traps(limit))
}

#[tauri::command]
pub async fn snmp_clear_traps(
    state: State<'_, SnmpServiceState>,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.clear_traps();
    Ok(())
}

// ---------------------------------------------------------------------------
// MIB database
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn snmp_mib_resolve_oid(
    state: State<'_, SnmpServiceState>,
    oid: String,
) -> Result<Option<String>, String> {
    let svc = state.lock().await;
    Ok(svc.mib_resolve_oid(&oid))
}

#[tauri::command]
pub async fn snmp_mib_resolve_name(
    state: State<'_, SnmpServiceState>,
    name: String,
) -> Result<Option<String>, String> {
    let svc = state.lock().await;
    Ok(svc.mib_resolve_name(&name))
}

#[tauri::command]
pub async fn snmp_mib_search(
    state: State<'_, SnmpServiceState>,
    query: String,
) -> Result<Vec<OidMapping>, String> {
    let svc = state.lock().await;
    Ok(svc.mib_search(&query))
}

#[tauri::command]
pub async fn snmp_mib_load_text(
    state: State<'_, SnmpServiceState>,
    text: String,
) -> Result<String, String> {
    let mut svc = state.lock().await;
    svc.mib_load_text(&text).map_err(to_err)
}

#[tauri::command]
pub async fn snmp_mib_get_subtree(
    state: State<'_, SnmpServiceState>,
    oid: String,
) -> Result<Vec<OidMapping>, String> {
    let svc = state.lock().await;
    Ok(svc.mib_get_subtree(&oid))
}

// ---------------------------------------------------------------------------
// Monitor engine
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn snmp_add_monitor(
    state: State<'_, SnmpServiceState>,
    monitor: MonitorTarget,
) -> Result<(), String> {
    let svc = state.lock().await;
    let engine_ref = svc.monitor_engine();
    let mut engine = engine_ref.lock().await;
    engine.add_monitor(monitor).map_err(to_err)
}

#[tauri::command]
pub async fn snmp_remove_monitor(
    state: State<'_, SnmpServiceState>,
    id: String,
) -> Result<bool, String> {
    let svc = state.lock().await;
    let engine_ref = svc.monitor_engine();
    let mut engine = engine_ref.lock().await;
    Ok(engine.remove_monitor(&id))
}

#[tauri::command]
pub async fn snmp_start_monitor(
    state: State<'_, SnmpServiceState>,
    id: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    let engine_ref = svc.monitor_engine();
    let mut engine = engine_ref.lock().await;
    engine.start_monitor(&id, Arc::clone(&engine_ref)).map_err(to_err)
}

#[tauri::command]
pub async fn snmp_stop_monitor(
    state: State<'_, SnmpServiceState>,
    id: String,
) -> Result<(), String> {
    let svc = state.lock().await;
    let engine_ref = svc.monitor_engine();
    let mut engine = engine_ref.lock().await;
    engine.stop_monitor(&id);
    Ok(())
}

#[tauri::command]
pub async fn snmp_get_monitor_alerts(
    state: State<'_, SnmpServiceState>,
) -> Result<Vec<MonitorAlert>, String> {
    let svc = state.lock().await;
    let engine_ref = svc.monitor_engine();
    let engine = engine_ref.lock().await;
    Ok(engine.get_active_alerts().into_iter().cloned().collect())
}

#[tauri::command]
pub async fn snmp_acknowledge_alert(
    state: State<'_, SnmpServiceState>,
    alert_id: String,
) -> Result<bool, String> {
    let svc = state.lock().await;
    let engine_ref = svc.monitor_engine();
    let mut engine = engine_ref.lock().await;
    Ok(engine.acknowledge_alert(&alert_id))
}

#[tauri::command]
pub async fn snmp_clear_alerts(
    state: State<'_, SnmpServiceState>,
) -> Result<(), String> {
    let svc = state.lock().await;
    let engine_ref = svc.monitor_engine();
    let mut engine = engine_ref.lock().await;
    engine.clear_alerts();
    Ok(())
}

// ---------------------------------------------------------------------------
// Target management
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn snmp_add_target(
    state: State<'_, SnmpServiceState>,
    name: String,
    host: String,
    port: Option<u16>,
    version: Option<String>,
    community: Option<String>,
    v3_creds: Option<V3Credentials>,
    timeout_ms: Option<u64>,
    retries: Option<u32>,
) -> Result<(), String> {
    let target = build_target(host, port, version, community, v3_creds, timeout_ms, retries);
    let mut svc = state.lock().await;
    svc.add_target(name, target);
    Ok(())
}

#[tauri::command]
pub async fn snmp_remove_target(
    state: State<'_, SnmpServiceState>,
    name: String,
) -> Result<bool, String> {
    let mut svc = state.lock().await;
    Ok(svc.remove_target(&name))
}

#[tauri::command]
pub async fn snmp_list_targets(
    state: State<'_, SnmpServiceState>,
) -> Result<Vec<(String, SnmpTarget)>, String> {
    let svc = state.lock().await;
    Ok(svc.list_targets())
}

// ---------------------------------------------------------------------------
// USM user management
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn snmp_add_usm_user(
    state: State<'_, SnmpServiceState>,
    user: UsmUser,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.add_usm_user(user);
    Ok(())
}

#[tauri::command]
pub async fn snmp_remove_usm_user(
    state: State<'_, SnmpServiceState>,
    user_id: String,
) -> Result<bool, String> {
    let mut svc = state.lock().await;
    Ok(svc.remove_usm_user(&user_id))
}

#[tauri::command]
pub async fn snmp_list_usm_users(
    state: State<'_, SnmpServiceState>,
) -> Result<Vec<UsmUser>, String> {
    let svc = state.lock().await;
    Ok(svc.list_usm_users().into_iter().cloned().collect())
}

// ---------------------------------------------------------------------------
// Device inventory
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn snmp_add_device(
    state: State<'_, SnmpServiceState>,
    device: SnmpDevice,
) -> Result<(), String> {
    let mut svc = state.lock().await;
    svc.add_device(device);
    Ok(())
}

#[tauri::command]
pub async fn snmp_remove_device(
    state: State<'_, SnmpServiceState>,
    host: String,
    port: Option<u16>,
) -> Result<bool, String> {
    let mut svc = state.lock().await;
    Ok(svc.remove_device(&host, port.unwrap_or(161)))
}

#[tauri::command]
pub async fn snmp_list_devices(
    state: State<'_, SnmpServiceState>,
) -> Result<Vec<SnmpDevice>, String> {
    let svc = state.lock().await;
    Ok(svc.list_devices().into_iter().cloned().collect())
}

// ---------------------------------------------------------------------------
// Service status
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn snmp_get_service_status(
    state: State<'_, SnmpServiceState>,
) -> Result<SnmpServiceStatus, String> {
    let svc = state.lock().await;
    Ok(svc.status())
}

// ---------------------------------------------------------------------------
// Bulk operations
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn snmp_bulk_get(
    _state: State<'_, SnmpServiceState>,
    config: BulkOperationConfig,
) -> Result<BulkOperationResult, String> {
    Ok(crate::bulk::bulk_get(&config).await)
}

#[tauri::command]
pub async fn snmp_bulk_walk(
    _state: State<'_, SnmpServiceState>,
    targets: Vec<SnmpTarget>,
    root_oid: String,
    concurrency: Option<usize>,
) -> Result<Vec<(String, Result<WalkResult, String>)>, String> {
    Ok(crate::bulk::bulk_walk(&targets, &root_oid, concurrency.unwrap_or(10)).await)
}

// ---------------------------------------------------------------------------
// Value parser
// ---------------------------------------------------------------------------

fn parse_typed_value(value_type: &str, value: &str) -> SnmpResult<SnmpValue> {
    match value_type.to_lowercase().as_str() {
        "integer" | "int" | "i" => {
            let v: i64 = value.parse().map_err(|_| {
                crate::error::SnmpError::config("Invalid integer value")
            })?;
            Ok(SnmpValue::Integer(v))
        }
        "string" | "str" | "s" => Ok(SnmpValue::OctetString(value.to_string())),
        "oid" | "o" => Ok(SnmpValue::ObjectIdentifier(value.to_string())),
        "ipaddress" | "ip" | "a" => Ok(SnmpValue::IpAddress(value.to_string())),
        "counter32" | "c" => {
            let v: u32 = value.parse().map_err(|_| {
                crate::error::SnmpError::config("Invalid counter32 value")
            })?;
            Ok(SnmpValue::Counter32(v))
        }
        "gauge32" | "gauge" | "g" | "unsigned" | "u" => {
            let v: u32 = value.parse().map_err(|_| {
                crate::error::SnmpError::config("Invalid gauge32 value")
            })?;
            Ok(SnmpValue::Gauge32(v))
        }
        "timeticks" | "t" => {
            let v: u32 = value.parse().map_err(|_| {
                crate::error::SnmpError::config("Invalid timeticks value")
            })?;
            Ok(SnmpValue::TimeTicks(v))
        }
        "counter64" => {
            let v: u64 = value.parse().map_err(|_| {
                crate::error::SnmpError::config("Invalid counter64 value")
            })?;
            Ok(SnmpValue::Counter64(v))
        }
        "hex" | "x" => {
            let hex_string = value.split(':')
                .filter(|s| !s.is_empty())
                .map(|s| {
                    let byte = u8::from_str_radix(s, 16).unwrap_or(0);
                    format!("{:02x}", byte)
                })
                .collect::<Vec<_>>()
                .join("");
            Ok(SnmpValue::OctetString(hex_string))
        }
        _ => Err(crate::error::SnmpError::config(format!("Unknown value type: {}", value_type))),
    }
}
