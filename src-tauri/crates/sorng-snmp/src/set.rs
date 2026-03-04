//! # SNMP SET Operations
//!
//! Higher-level SET helpers with typed value builders.

use crate::client::SnmpClient;
use crate::error::SnmpResult;
use crate::types::*;

/// Set a single OID to an integer value.
pub async fn set_integer(
    client: &SnmpClient,
    target: &SnmpTarget,
    oid: &str,
    value: i64,
) -> SnmpResult<SnmpResponse> {
    client.set(target, &[(oid.to_string(), SnmpValue::Integer(value))]).await
}

/// Set a single OID to a string value.
pub async fn set_string(
    client: &SnmpClient,
    target: &SnmpTarget,
    oid: &str,
    value: &str,
) -> SnmpResult<SnmpResponse> {
    client.set(target, &[(oid.to_string(), SnmpValue::OctetString(value.to_string()))]).await
}

/// Set a single OID to an OID value.
pub async fn set_oid(
    client: &SnmpClient,
    target: &SnmpTarget,
    oid: &str,
    value: &str,
) -> SnmpResult<SnmpResponse> {
    client.set(target, &[(oid.to_string(), SnmpValue::ObjectIdentifier(value.to_string()))]).await
}

/// Set a single OID to an IP address value.
pub async fn set_ip_address(
    client: &SnmpClient,
    target: &SnmpTarget,
    oid: &str,
    ip: &str,
) -> SnmpResult<SnmpResponse> {
    client.set(target, &[(oid.to_string(), SnmpValue::IpAddress(ip.to_string()))]).await
}

/// Set a single OID to a Gauge32/Unsigned32 value.
pub async fn set_gauge(
    client: &SnmpClient,
    target: &SnmpTarget,
    oid: &str,
    value: u32,
) -> SnmpResult<SnmpResponse> {
    client.set(target, &[(oid.to_string(), SnmpValue::Gauge32(value))]).await
}

/// Set a single OID to a TimeTicks value.
pub async fn set_timeticks(
    client: &SnmpClient,
    target: &SnmpTarget,
    oid: &str,
    value: u32,
) -> SnmpResult<SnmpResponse> {
    client.set(target, &[(oid.to_string(), SnmpValue::TimeTicks(value))]).await
}

/// Set multiple OID-value pairs in a single SET request.
pub async fn set_multiple(
    client: &SnmpClient,
    target: &SnmpTarget,
    varbinds: Vec<(String, SnmpValue)>,
) -> SnmpResult<SnmpResponse> {
    client.set(target, &varbinds).await
}

/// Create a row in an SNMP table (using SET with RowStatus).
/// Sends a SET with the RowStatus column set to createAndGo(4).
pub async fn create_row(
    client: &SnmpClient,
    target: &SnmpTarget,
    row_status_oid: &str,
    columns: Vec<(String, SnmpValue)>,
) -> SnmpResult<SnmpResponse> {
    let mut varbinds = columns;
    // RowStatus createAndGo = 4
    varbinds.push((row_status_oid.to_string(), SnmpValue::Integer(4)));
    client.set(target, &varbinds).await
}

/// Delete a row in an SNMP table (using SET with RowStatus destroy(6)).
pub async fn destroy_row(
    client: &SnmpClient,
    target: &SnmpTarget,
    row_status_oid: &str,
) -> SnmpResult<SnmpResponse> {
    // RowStatus destroy = 6
    client.set(target, &[(row_status_oid.to_string(), SnmpValue::Integer(6))]).await
}
