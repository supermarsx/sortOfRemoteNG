//! # SNMP Bulk Operations
//!
//! Query the same OIDs from many targets concurrently.

use crate::client::SnmpClient;
use crate::types::*;

/// Execute a bulk GET across multiple targets.
pub async fn bulk_get(config: &BulkOperationConfig) -> BulkOperationResult {
    let start = std::time::Instant::now();
    let results = crate::get::batch_get(
        &SnmpClient::new(),
        &config.targets,
        &config.oids,
        config.concurrency as usize,
    )
    .await;

    let success_count = results.iter().filter(|r| r.success).count() as u32;
    let failure_count = results.iter().filter(|r| !r.success).count() as u32;

    BulkOperationResult {
        results,
        elapsed_ms: start.elapsed().as_millis() as u64,
        success_count,
        failure_count,
    }
}

/// Execute a bulk WALK across multiple targets.
pub async fn bulk_walk(
    targets: &[SnmpTarget],
    root_oid: &str,
    concurrency: usize,
) -> Vec<(String, Result<WalkResult, String>)> {
    use std::sync::Arc;
    use tokio::sync::Semaphore;

    let semaphore = Arc::new(Semaphore::new(concurrency));
    let mut handles = vec![];

    for target in targets {
        let sem = semaphore.clone();
        let target = target.clone();
        let root_oid = root_oid.to_string();
        let handle = tokio::spawn(async move {
            let _permit = sem.acquire().await.expect("semaphore not closed");
            let client = SnmpClient::new();
            let result = crate::walk::walk(&client, &target, &root_oid).await;
            (target.host.clone(), result.map_err(|e| e.to_string()))
        });
        handles.push(handle);
    }

    let mut results = vec![];
    for handle in handles {
        match handle.await {
            Ok(result) => results.push(result),
            Err(e) => results.push(("unknown".to_string(), Err(e.to_string()))),
        }
    }
    results
}

/// Execute a bulk SET across multiple targets (same values to all).
pub async fn bulk_set(
    targets: &[SnmpTarget],
    varbinds: &[(String, SnmpValue)],
    concurrency: usize,
) -> Vec<BulkTargetResult> {
    use std::sync::Arc;
    use tokio::sync::Semaphore;

    let semaphore = Arc::new(Semaphore::new(concurrency));
    let mut handles = vec![];

    for target in targets {
        let sem = semaphore.clone();
        let target = target.clone();
        let varbinds = varbinds.to_vec();
        let handle = tokio::spawn(async move {
            let _permit = sem.acquire().await.expect("semaphore not closed");
            let client = SnmpClient::new();
            let start = std::time::Instant::now();
            match client.set(&target, &varbinds).await {
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
