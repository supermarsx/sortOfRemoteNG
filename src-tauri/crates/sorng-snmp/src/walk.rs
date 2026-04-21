//! # SNMP Walk
//!
//! GET-NEXT / GET-BULK based tree traversal for walking OID subtrees.

use crate::client::SnmpClient;
use crate::error::{SnmpError, SnmpResult};
use crate::oid::Oid;
use crate::types::*;

/// Maximum OIDs to collect in a single walk (safety limit).
const MAX_WALK_RESULTS: usize = 100_000;

/// Perform an SNMP walk using GET-NEXT (v1) or GET-BULK (v2c/v3).
pub async fn walk(
    client: &SnmpClient,
    target: &SnmpTarget,
    root_oid: &str,
) -> SnmpResult<WalkResult> {
    let root = Oid::parse(root_oid)?;
    let start = std::time::Instant::now();
    let mut all_varbinds = vec![];
    let mut current_oid = root_oid.to_string();
    let mut request_count = 0u32;

    loop {
        if all_varbinds.len() >= MAX_WALK_RESULTS {
            log::warn!("Walk truncated at {} results", MAX_WALK_RESULTS);
            break;
        }

        let response = if target.version == SnmpVersion::V1 {
            client.get_next(target, &[current_oid.clone()]).await?
        } else {
            // Use GET-BULK for efficiency
            client
                .get_bulk(target, &[current_oid.clone()], 0, 25)
                .await?
        };
        request_count += 1;

        if response.varbinds.is_empty() {
            break;
        }

        let mut found_next = false;
        for vb in &response.varbinds {
            // Check if we're still under the root OID
            let vb_oid = Oid::parse(&vb.oid)?;
            if !root.is_parent_of(&vb_oid) && root != vb_oid {
                // Walked past the subtree
                return Ok(WalkResult {
                    root_oid: root_oid.to_string(),
                    varbinds: all_varbinds,
                    request_count,
                    elapsed_ms: start.elapsed().as_millis() as u64,
                    complete: true,
                });
            }

            // Check for end-of-MIB or exception values
            if vb.value.is_exception() {
                return Ok(WalkResult {
                    root_oid: root_oid.to_string(),
                    varbinds: all_varbinds,
                    request_count,
                    elapsed_ms: start.elapsed().as_millis() as u64,
                    complete: true,
                });
            }

            // Ensure OID is advancing (prevent loops)
            if vb.oid <= current_oid {
                return Err(SnmpError::protocol_error(format!(
                    "Walk OID not advancing: {} <= {}",
                    vb.oid, current_oid
                )));
            }

            current_oid = vb.oid.clone();
            all_varbinds.push(vb.clone());
            found_next = true;
        }

        if !found_next {
            break;
        }
    }

    Ok(WalkResult {
        root_oid: root_oid.to_string(),
        varbinds: all_varbinds,
        request_count,
        elapsed_ms: start.elapsed().as_millis() as u64,
        complete: true,
    })
}

/// Walk a subtree and return results as a map of OID → value.
pub async fn walk_map(
    client: &SnmpClient,
    target: &SnmpTarget,
    root_oid: &str,
) -> SnmpResult<std::collections::HashMap<String, SnmpValue>> {
    let result = walk(client, target, root_oid).await?;
    let mut map = std::collections::HashMap::new();
    for vb in result.varbinds {
        map.insert(vb.oid, vb.value);
    }
    Ok(map)
}

/// Walk a subtree and return only the display strings.
pub async fn walk_strings(
    client: &SnmpClient,
    target: &SnmpTarget,
    root_oid: &str,
) -> SnmpResult<Vec<(String, String)>> {
    let result = walk(client, target, root_oid).await?;
    Ok(result
        .varbinds
        .iter()
        .map(|vb| (vb.oid.clone(), vb.value.display_value()))
        .collect())
}
