//! # IF-MIB Helpers
//!
//! High-level functions for querying interface statistics via IF-MIB and ifXTable.

use crate::client::SnmpClient;
use crate::error::SnmpResult;
use crate::oid::well_known;
use crate::table;
use crate::types::*;

/// Retrieve all interfaces from a device using IF-MIB.
pub async fn get_interfaces(
    client: &SnmpClient,
    target: &SnmpTarget,
) -> SnmpResult<Vec<InterfaceInfo>> {
    // Walk ifEntry for basic counters
    let if_table = table::get_if_table(client, target).await?;
    // Walk ifXTable for 64-bit counters and alias
    let ifx_table = table::get_if_x_table(client, target).await.ok();

    let mut interfaces = vec![];

    for row in &if_table.rows {
        let index = row
            .values
            .get("1")
            .and_then(|v| v.as_integer())
            .unwrap_or(0);

        let descr = row
            .values
            .get("2")
            .map(|v| v.display_value())
            .unwrap_or_default();

        let if_type = row
            .values
            .get("3")
            .and_then(|v| v.as_integer())
            .unwrap_or(0);

        let mtu = row.values.get("4").and_then(|v| v.as_integer());
        let speed = row.values.get("5").and_then(|v| v.as_u64());
        let phys_address = row.values.get("6").map(|v| v.display_value());

        let admin_status = row
            .values
            .get("7")
            .and_then(|v| v.as_integer())
            .map(InterfaceStatus::from_code)
            .unwrap_or(InterfaceStatus::Unknown);

        let oper_status = row
            .values
            .get("8")
            .and_then(|v| v.as_integer())
            .map(InterfaceStatus::from_code)
            .unwrap_or(InterfaceStatus::Unknown);

        let last_change = row.values.get("9").and_then(|v| v.as_u32());
        let in_octets = row.values.get("10").and_then(|v| v.as_u64());
        let out_octets = row.values.get("16").and_then(|v| v.as_u64());
        let in_ucast_pkts = row.values.get("11").and_then(|v| v.as_u64());
        let out_ucast_pkts = row.values.get("17").and_then(|v| v.as_u64());
        let in_errors = row.values.get("14").and_then(|v| v.as_u64());
        let out_errors = row.values.get("20").and_then(|v| v.as_u64());
        let in_discards = row.values.get("13").and_then(|v| v.as_u64());
        let out_discards = row.values.get("19").and_then(|v| v.as_u64());

        // Get HC counters and alias from ifXTable if available
        let (hc_in_octets, hc_out_octets, high_speed, alias) = if let Some(ref ifx) = ifx_table {
            let ifx_row = ifx.rows.iter().find(|r| r.index == row.index);
            (
                ifx_row
                    .and_then(|r| r.values.get("6"))
                    .and_then(|v| v.as_u64()),
                ifx_row
                    .and_then(|r| r.values.get("10"))
                    .and_then(|v| v.as_u64()),
                ifx_row
                    .and_then(|r| r.values.get("15"))
                    .and_then(|v| v.as_u64()),
                ifx_row
                    .and_then(|r| r.values.get("18"))
                    .map(|v| v.display_value()),
            )
        } else {
            (None, None, None, None)
        };

        interfaces.push(InterfaceInfo {
            index,
            descr,
            if_type,
            mtu,
            speed,
            high_speed,
            phys_address,
            admin_status,
            oper_status,
            last_change,
            in_octets: hc_in_octets.or(in_octets),
            out_octets: hc_out_octets.or(out_octets),
            in_ucast_pkts,
            out_ucast_pkts,
            in_errors,
            out_errors,
            in_discards,
            out_discards,
            alias,
        });
    }

    Ok(interfaces)
}

/// Calculate bandwidth utilisation for all interfaces.
/// Requires two snapshots taken at different times.
pub fn calculate_bandwidth(
    prev: &[InterfaceInfo],
    curr: &[InterfaceInfo],
    interval_secs: f64,
) -> Vec<InterfaceBandwidth> {
    let mut results = vec![];

    for curr_if in curr {
        if let Some(prev_if) = prev.iter().find(|p| p.index == curr_if.index) {
            let in_octets_diff = curr_if
                .in_octets
                .unwrap_or(0)
                .saturating_sub(prev_if.in_octets.unwrap_or(0));
            let out_octets_diff = curr_if
                .out_octets
                .unwrap_or(0)
                .saturating_sub(prev_if.out_octets.unwrap_or(0));

            let in_bps = (in_octets_diff as f64 * 8.0) / interval_secs;
            let out_bps = (out_octets_diff as f64 * 8.0) / interval_secs;

            // Determine interface speed
            let speed_bps = if let Some(hs) = curr_if.high_speed {
                hs * 1_000_000 // Mbps to bps
            } else {
                curr_if.speed.unwrap_or(0)
            };

            let (in_util, out_util) = if speed_bps > 0 {
                (
                    (in_bps / speed_bps as f64) * 100.0,
                    (out_bps / speed_bps as f64) * 100.0,
                )
            } else {
                (0.0, 0.0)
            };

            results.push(InterfaceBandwidth {
                if_index: curr_if.index,
                if_descr: curr_if.descr.clone(),
                in_bps,
                out_bps,
                in_utilization: in_util.min(100.0),
                out_utilization: out_util.min(100.0),
                speed_bps,
                timestamp: chrono::Utc::now().to_rfc3339(),
            });
        }
    }

    results
}

/// Get the number of interfaces on a device.
pub async fn get_interface_count(client: &SnmpClient, target: &SnmpTarget) -> SnmpResult<i64> {
    crate::get::get_integer(client, target, well_known::IF_NUMBER).await
}
