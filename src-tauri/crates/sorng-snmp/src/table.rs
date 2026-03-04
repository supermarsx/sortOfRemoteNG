//! # SNMP Table Retrieval
//!
//! Walk-based table fetching with automatic column/row extraction.

use crate::client::SnmpClient;
use crate::error::SnmpResult;
use crate::oid::Oid;
use crate::types::*;
use crate::walk;
use std::collections::HashMap;

/// Retrieve an SNMP table by walking its entry OID.
///
/// # Arguments
/// * `entry_oid` — The table entry OID (e.g. "1.3.6.1.2.1.2.2.1" for ifEntry).
/// * `column_ids` — Column sub-identifiers to fetch (e.g. [1, 2, 3] for ifIndex, ifDescr, ifType).
///   If empty, all columns discovered during walk are returned.
pub async fn get_table(
    client: &SnmpClient,
    target: &SnmpTarget,
    entry_oid: &str,
    column_ids: &[u32],
) -> SnmpResult<SnmpTable> {
    let entry = Oid::parse(entry_oid)?;

    // Walk the entry subtree
    let walk_result = walk::walk(client, target, entry_oid).await?;

    // Group results by column and row
    let mut rows_map: HashMap<String, HashMap<String, SnmpValue>> = HashMap::new();
    let mut columns_set: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();

    for vb in &walk_result.varbinds {
        let vb_oid = Oid::parse(&vb.oid)?;
        if let Some(suffix) = vb_oid.suffix_after(&entry) {
            // Suffix format: "column.index..." — split at first dot
            let parts: Vec<&str> = suffix.splitn(2, '.').collect();
            if parts.len() == 2 {
                let column = parts[0].to_string();
                let index = parts[1].to_string();

                // If column_ids filter is provided, apply it
                if !column_ids.is_empty() {
                    if let Ok(col_num) = column.parse::<u32>() {
                        if !column_ids.contains(&col_num) {
                            continue;
                        }
                    }
                }

                columns_set.insert(column.clone());
                rows_map
                    .entry(index)
                    .or_default()
                    .insert(column, vb.value.clone());
            }
        }
    }

    let columns: Vec<String> = columns_set.into_iter().collect();
    let mut rows: Vec<SnmpTableRow> = rows_map
        .into_iter()
        .map(|(index, values)| SnmpTableRow { index, values })
        .collect();

    // Sort rows by index (numeric if possible)
    rows.sort_by(|a, b| {
        match (a.index.parse::<u64>(), b.index.parse::<u64>()) {
            (Ok(ai), Ok(bi)) => ai.cmp(&bi),
            _ => a.index.cmp(&b.index),
        }
    });

    Ok(SnmpTable {
        base_oid: entry_oid.to_string(),
        table_name: None,
        columns: columns.clone(),
        column_names: columns, // MIB resolution would fill in proper names
        rows,
    })
}

/// Retrieve the ifTable (interface table) from a device.
pub async fn get_if_table(
    client: &SnmpClient,
    target: &SnmpTarget,
) -> SnmpResult<SnmpTable> {
    get_table(
        client,
        target,
        crate::oid::well_known::IF_ENTRY,
        &[], // All columns
    ).await
}

/// Retrieve the ifXTable (extended interface table) from a device.
pub async fn get_if_x_table(
    client: &SnmpClient,
    target: &SnmpTarget,
) -> SnmpResult<SnmpTable> {
    get_table(
        client,
        target,
        crate::oid::well_known::IF_X_TABLE,
        &[],
    ).await
}

/// Retrieve the IP address table.
pub async fn get_ip_addr_table(
    client: &SnmpClient,
    target: &SnmpTarget,
) -> SnmpResult<SnmpTable> {
    get_table(client, target, "1.3.6.1.2.1.4.20.1", &[]).await
}

/// Retrieve the IP routing table.
pub async fn get_ip_route_table(
    client: &SnmpClient,
    target: &SnmpTarget,
) -> SnmpResult<SnmpTable> {
    get_table(client, target, "1.3.6.1.2.1.4.21.1", &[]).await
}

/// Retrieve the TCP connection table.
pub async fn get_tcp_conn_table(
    client: &SnmpClient,
    target: &SnmpTarget,
) -> SnmpResult<SnmpTable> {
    get_table(client, target, "1.3.6.1.2.1.6.13.1", &[]).await
}

/// Retrieve the Host Resources storage table (hrStorageTable).
pub async fn get_hr_storage_table(
    client: &SnmpClient,
    target: &SnmpTarget,
) -> SnmpResult<SnmpTable> {
    get_table(client, target, "1.3.6.1.2.1.25.2.3.1", &[]).await
}

/// Retrieve the Host Resources processor table (hrProcessorTable).
pub async fn get_hr_processor_table(
    client: &SnmpClient,
    target: &SnmpTarget,
) -> SnmpResult<SnmpTable> {
    get_table(client, target, "1.3.6.1.2.1.25.3.3.1", &[]).await
}

/// Retrieve the ARP / IP-to-physical-address table (ipNetToMediaTable).
pub async fn get_arp_table(
    client: &SnmpClient,
    target: &SnmpTarget,
) -> SnmpResult<SnmpTable> {
    get_table(client, target, "1.3.6.1.2.1.4.22.1", &[]).await
}
