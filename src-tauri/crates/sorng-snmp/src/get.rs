//! # SNMP GET Operations
//!
//! Higher-level GET helpers: multi-OID get, scalar get with type coercion,
//! and batch get across multiple targets.

use crate::client::SnmpClient;
use crate::error::SnmpResult;
use crate::types::*;
use std::collections::HashMap;

/// GET multiple OIDs and return a map of OID → value.
pub async fn get_map(
    client: &SnmpClient,
    target: &SnmpTarget,
    oids: &[String],
) -> SnmpResult<HashMap<String, SnmpValue>> {
    let response = client.get(target, oids).await?;
    let mut map = HashMap::new();
    for vb in response.varbinds {
        if !vb.value.is_exception() {
            map.insert(vb.oid, vb.value);
        }
    }
    Ok(map)
}

/// GET a single OID and return as an i64 integer.
pub async fn get_integer(client: &SnmpClient, target: &SnmpTarget, oid: &str) -> SnmpResult<i64> {
    let value = client.get_value(target, oid).await?;
    value.as_integer().ok_or_else(|| {
        crate::error::SnmpError::protocol_error(format!(
            "Expected integer for OID {}, got {}",
            oid,
            value.type_name()
        ))
    })
}

/// GET a single OID and return as a string.
pub async fn get_string(client: &SnmpClient, target: &SnmpTarget, oid: &str) -> SnmpResult<String> {
    client.get_string(target, oid).await
}

/// GET a single OID and return as u64 counter.
pub async fn get_counter(client: &SnmpClient, target: &SnmpTarget, oid: &str) -> SnmpResult<u64> {
    let value = client.get_value(target, oid).await?;
    value.as_u64().ok_or_else(|| {
        crate::error::SnmpError::protocol_error(format!(
            "Expected counter for OID {}, got {}",
            oid,
            value.type_name()
        ))
    })
}

/// Batch GET: query the same OIDs from multiple targets concurrently.
pub async fn batch_get(
    _client: &SnmpClient,
    targets: &[SnmpTarget],
    oids: &[String],
    concurrency: usize,
) -> Vec<BulkTargetResult> {
    use std::sync::Arc;
    use tokio::sync::Semaphore;

    let semaphore = Arc::new(Semaphore::new(concurrency));
    let mut handles = vec![];

    for target in targets {
        let sem = semaphore.clone();
        let target = target.clone();
        let oids = oids.to_vec();
        // We need to reference the client across tasks, so we build the message here
        // For simplicity in the scaffolding, we capture what we need
        let handle = tokio::spawn(async move {
            let _permit = sem.acquire().await.unwrap();
            let client = SnmpClient::new();
            let start = std::time::Instant::now();
            match client.get(&target, &oids).await {
                Ok(response) => BulkTargetResult {
                    host: target.host.clone(),
                    success: true,
                    varbinds: response.varbinds,
                    error: None,
                    rtt_ms: start.elapsed().as_millis() as u64,
                },
                Err(e) => BulkTargetResult {
                    host: target.host.clone(),
                    success: false,
                    varbinds: vec![],
                    error: Some(e.to_string()),
                    rtt_ms: start.elapsed().as_millis() as u64,
                },
            }
        });
        handles.push(handle);
    }

    let mut results = vec![];
    for handle in handles {
        match handle.await {
            Ok(result) => results.push(result),
            Err(e) => results.push(BulkTargetResult {
                host: "unknown".to_string(),
                success: false,
                varbinds: vec![],
                error: Some(e.to_string()),
                rtt_ms: 0,
            }),
        }
    }
    results
}
