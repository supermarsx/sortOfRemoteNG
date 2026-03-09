use reqwest::Client;
use serde_json::Value;

use crate::error::{CephError, CephErrorKind};
use crate::types::*;

/// Build the base URL for the Ceph Manager REST API from a session.
pub fn base_url(session: &CephSession) -> String {
    let scheme = if session.config.use_tls {
        "https"
    } else {
        "http"
    };
    format!(
        "{}://{}:{}/api",
        scheme, session.config.host, session.config.port
    )
}

/// Build a configured reqwest::Client for the session.
pub fn build_client(session: &CephSession) -> Result<Client, CephError> {
    let mut builder =
        Client::builder().timeout(std::time::Duration::from_secs(session.config.timeout_secs));

    if !session.config.verify_cert {
        builder = builder.danger_accept_invalid_certs(true);
    }

    builder
        .build()
        .map_err(|e| CephError::connection(format!("Failed to build HTTP client: {}", e)))
}

/// Add authentication headers to a request builder.
pub fn auth_header(session: &CephSession) -> Result<String, CephError> {
    if let Some(ref token) = session.auth_token {
        Ok(format!("Bearer {}", token))
    } else if let Some(ref token) = session.config.api_token {
        Ok(format!("Bearer {}", token))
    } else if let Some(ref password) = session.config.password {
        let credentials = base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            format!("{}:{}", session.config.username, password),
        );
        Ok(format!("Basic {}", credentials))
    } else {
        Err(CephError::auth("No authentication credentials provided"))
    }
}

/// Perform a GET request to the Ceph REST API.
pub async fn api_get(session: &CephSession, path: &str) -> Result<Value, CephError> {
    let client = build_client(session)?;
    let url = format!("{}{}", base_url(session), path);
    let auth = auth_header(session)?;

    let response = client
        .get(&url)
        .header("Authorization", &auth)
        .header("Accept", "application/json")
        .send()
        .await?;

    let status = response.status();
    if status.is_success() {
        let body: Value = response.json().await?;
        Ok(body)
    } else if status.as_u16() == 401 || status.as_u16() == 403 {
        let text = response.text().await.unwrap_or_default();
        Err(CephError::new(CephErrorKind::AuthenticationFailed, text).with_status(status.as_u16()))
    } else {
        let text = response.text().await.unwrap_or_default();
        Err(CephError::api(text, Some(status.as_u16())))
    }
}

/// Perform a POST request to the Ceph REST API.
pub async fn api_post(session: &CephSession, path: &str, body: &Value) -> Result<Value, CephError> {
    let client = build_client(session)?;
    let url = format!("{}{}", base_url(session), path);
    let auth = auth_header(session)?;

    let response = client
        .post(&url)
        .header("Authorization", &auth)
        .header("Accept", "application/json")
        .header("Content-Type", "application/json")
        .json(body)
        .send()
        .await?;

    let status = response.status();
    if status.is_success() {
        let body: Value = response.json().await.unwrap_or(Value::Null);
        Ok(body)
    } else if status.as_u16() == 401 || status.as_u16() == 403 {
        let text = response.text().await.unwrap_or_default();
        Err(CephError::new(CephErrorKind::AuthenticationFailed, text).with_status(status.as_u16()))
    } else {
        let text = response.text().await.unwrap_or_default();
        Err(CephError::api(text, Some(status.as_u16())))
    }
}

/// Perform a PUT request to the Ceph REST API.
pub async fn api_put(session: &CephSession, path: &str, body: &Value) -> Result<Value, CephError> {
    let client = build_client(session)?;
    let url = format!("{}{}", base_url(session), path);
    let auth = auth_header(session)?;

    let response = client
        .put(&url)
        .header("Authorization", &auth)
        .header("Accept", "application/json")
        .header("Content-Type", "application/json")
        .json(body)
        .send()
        .await?;

    let status = response.status();
    if status.is_success() {
        let body: Value = response.json().await.unwrap_or(Value::Null);
        Ok(body)
    } else {
        let text = response.text().await.unwrap_or_default();
        Err(CephError::api(text, Some(status.as_u16())))
    }
}

/// Perform a DELETE request to the Ceph REST API.
pub async fn api_delete(session: &CephSession, path: &str) -> Result<Value, CephError> {
    let client = build_client(session)?;
    let url = format!("{}{}", base_url(session), path);
    let auth = auth_header(session)?;

    let response = client
        .delete(&url)
        .header("Authorization", &auth)
        .header("Accept", "application/json")
        .send()
        .await?;

    let status = response.status();
    if status.is_success() {
        let body: Value = response.json().await.unwrap_or(Value::Null);
        Ok(body)
    } else {
        let text = response.text().await.unwrap_or_default();
        Err(CephError::api(text, Some(status.as_u16())))
    }
}

// ---------------------------------------------------------------------------
// Cluster-level operations
// ---------------------------------------------------------------------------

/// Retrieve a comprehensive cluster health report.
pub async fn get_cluster_health(session: &CephSession) -> Result<ClusterHealth, CephError> {
    let health_data = api_get(session, "/health/full").await?;

    let overall_str = health_data["status"].as_str().unwrap_or("HEALTH_ERR");
    let overall_status = match overall_str {
        "HEALTH_OK" => HealthStatus::Ok,
        "HEALTH_WARN" => HealthStatus::Warning,
        _ => HealthStatus::Error,
    };

    let mut health_checks = Vec::new();
    if let Some(checks) = health_data["checks"].as_object() {
        for (code, check_val) in checks {
            let severity_str = check_val["severity"].as_str().unwrap_or("HEALTH_ERR");
            let severity = match severity_str {
                "HEALTH_OK" => HealthStatus::Ok,
                "HEALTH_WARN" => HealthStatus::Warning,
                _ => HealthStatus::Error,
            };
            let summary = check_val["summary"]["message"]
                .as_str()
                .unwrap_or("")
                .to_string();
            let detail = check_val["detail"]
                .as_array()
                .map(|arr| {
                    arr.iter()
                        .filter_map(|d| d["message"].as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default();
            let muted = check_val["muted"].as_bool().unwrap_or(false);

            health_checks.push(HealthCheck {
                code: code.clone(),
                severity,
                summary,
                detail,
                muted,
            });
        }
    }

    let mon_data = api_get(session, "/mon").await.unwrap_or(Value::Null);
    let mons = mon_data.as_array().map(|a| a.len() as u32).unwrap_or(0);
    let quorum_data = api_get(session, "/mon/quorum").await.unwrap_or(Value::Null);
    let quorum_names: Vec<String> = quorum_data["quorum_names"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    let mon_status = MonStatusSummary {
        num_mons: mons,
        num_in_quorum: quorum_names.len() as u32,
        quorum_names,
    };

    let osd_data = api_get(session, "/osd").await.unwrap_or(Value::Null);
    let num_osds = osd_data.as_array().map(|a| a.len() as u32).unwrap_or(0);
    let mut num_up = 0u32;
    let mut num_in = 0u32;
    if let Some(osds) = osd_data.as_array() {
        for osd in osds {
            if osd["up"].as_i64().unwrap_or(0) == 1 {
                num_up += 1;
            }
            if osd["in"].as_i64().unwrap_or(0) == 1 {
                num_in += 1;
            }
        }
    }
    let osd_status = OsdStatusSummary {
        num_osds,
        num_up_osds: num_up,
        num_in_osds: num_in,
        num_remapped_pgs: 0,
    };

    let pg_data = api_get(session, "/pg/summary").await.unwrap_or(Value::Null);
    let pg_num = pg_data["num_pgs"].as_u64().unwrap_or(0) as u32;
    let pg_status = PgStatusSummary {
        num_pgs: pg_num,
        num_active_clean: pg_data["num_active_clean"].as_u64().unwrap_or(0) as u32,
        num_degraded: pg_data["num_degraded"].as_u64().unwrap_or(0) as u32,
        num_recovering: pg_data["num_recovering"].as_u64().unwrap_or(0) as u32,
        num_undersized: pg_data["num_undersized"].as_u64().unwrap_or(0) as u32,
        num_stale: pg_data["num_stale"].as_u64().unwrap_or(0) as u32,
        num_peering: pg_data["num_peering"].as_u64().unwrap_or(0) as u32,
    };

    let df_data = api_get(session, "/df").await.unwrap_or(Value::Null);
    let stats = &df_data["stats"];
    let total = stats["total_bytes"].as_u64().unwrap_or(0);
    let used = stats["total_used_bytes"].as_u64().unwrap_or(0);
    let avail = stats["total_avail_bytes"].as_u64().unwrap_or(0);
    let used_pct = if total > 0 {
        (used as f64 / total as f64) * 100.0
    } else {
        0.0
    };
    let storage_stats = StorageStats {
        total_bytes: total,
        used_bytes: used,
        available_bytes: avail,
        used_percent: used_pct,
        raw_used_bytes: stats["total_used_raw_bytes"].as_u64().unwrap_or(used),
        num_objects: stats["total_objects"].as_u64().unwrap_or(0),
        data_bytes: stats["total_bytes"].as_u64().unwrap_or(0),
        num_pools: df_data["pools"]
            .as_array()
            .map(|a| a.len() as u32)
            .unwrap_or(0),
    };

    Ok(ClusterHealth {
        overall_status,
        health_checks,
        mon_status,
        osd_status,
        pg_status,
        storage_stats,
    })
}

/// Get the raw cluster status JSON (equivalent to `ceph status`).
pub async fn get_cluster_status(session: &CephSession) -> Result<Value, CephError> {
    api_get(session, "/health/full").await
}

/// Get cluster-wide storage utilization (equivalent to `ceph df`).
pub async fn get_cluster_df(session: &CephSession) -> Result<StorageStats, CephError> {
    let df_data = api_get(session, "/df").await?;
    let stats = &df_data["stats"];
    let total = stats["total_bytes"].as_u64().unwrap_or(0);
    let used = stats["total_used_bytes"].as_u64().unwrap_or(0);
    let avail = stats["total_avail_bytes"].as_u64().unwrap_or(0);
    let used_pct = if total > 0 {
        (used as f64 / total as f64) * 100.0
    } else {
        0.0
    };

    Ok(StorageStats {
        total_bytes: total,
        used_bytes: used,
        available_bytes: avail,
        used_percent: used_pct,
        raw_used_bytes: stats["total_used_raw_bytes"].as_u64().unwrap_or(used),
        num_objects: stats["total_objects"].as_u64().unwrap_or(0),
        data_bytes: stats["total_bytes"].as_u64().unwrap_or(0),
        num_pools: df_data["pools"]
            .as_array()
            .map(|a| a.len() as u32)
            .unwrap_or(0),
    })
}

/// Get all cluster configuration options.
pub async fn get_cluster_config(session: &CephSession) -> Result<Vec<CephConfig>, CephError> {
    let data = api_get(session, "/config").await?;
    let mut configs = Vec::new();
    if let Some(arr) = data.as_array() {
        for item in arr {
            configs.push(CephConfig {
                section: item["section"].as_str().unwrap_or("global").to_string(),
                name: item["name"].as_str().unwrap_or("").to_string(),
                value: item["value"].as_str().unwrap_or("").to_string(),
                source: item["source"].as_str().unwrap_or("default").to_string(),
                mask: item["mask"].as_str().map(String::from),
                can_update_at_runtime: item["can_update_at_runtime"].as_bool().unwrap_or(true),
            });
        }
    }
    Ok(configs)
}

/// Set a cluster configuration option.
pub async fn set_config_option(
    session: &CephSession,
    section: &str,
    name: &str,
    value: &str,
) -> Result<(), CephError> {
    let body = serde_json::json!({
        "name": name,
        "value": value,
    });
    api_put(session, &format!("/config/{}/{}", section, name), &body).await?;
    log::info!("Set config {}/{} = {}", section, name, value);
    Ok(())
}

/// Reset a cluster configuration option to default.
pub async fn reset_config_option(
    session: &CephSession,
    section: &str,
    name: &str,
) -> Result<(), CephError> {
    api_delete(session, &format!("/config/{}/{}", section, name)).await?;
    log::info!("Reset config {}/{}", section, name);
    Ok(())
}

/// List all running Ceph services/daemons.
pub async fn list_services(session: &CephSession) -> Result<Vec<ServiceInfo>, CephError> {
    let data = api_get(session, "/daemon").await?;
    let mut services = Vec::new();
    if let Some(arr) = data.as_array() {
        for item in arr {
            let dtype_str = item["daemon_type"].as_str().unwrap_or("unknown");
            let dtype = match dtype_str {
                "mon" => DaemonType::Mon,
                "osd" => DaemonType::Osd,
                "mds" => DaemonType::Mds,
                "mgr" => DaemonType::Mgr,
                "rgw" => DaemonType::Rgw,
                "crash" => DaemonType::CrashCollector,
                "rbd-mirror" => DaemonType::RbdMirror,
                _ => DaemonType::Agent,
            };
            services.push(ServiceInfo {
                type_name: dtype.clone(),
                id: item["daemon_id"].as_str().unwrap_or("").to_string(),
                status: item["status_desc"]
                    .as_str()
                    .unwrap_or("unknown")
                    .to_string(),
                hostname: item["hostname"].as_str().unwrap_or("").to_string(),
                daemon_type: dtype_str.to_string(),
                version: item["version"].as_str().map(String::from),
                running: item["status"].as_i64().unwrap_or(0) == 1,
                last_configured: None,
                memory_usage_bytes: item["mem_usage"].as_u64(),
            });
        }
    }
    Ok(services)
}

/// Get info about a specific service daemon.
pub async fn get_service(
    session: &CephSession,
    daemon_type: &str,
    id: &str,
) -> Result<ServiceInfo, CephError> {
    let data = api_get(session, &format!("/daemon/{}.{}", daemon_type, id)).await?;
    let dtype = match daemon_type {
        "mon" => DaemonType::Mon,
        "osd" => DaemonType::Osd,
        "mds" => DaemonType::Mds,
        "mgr" => DaemonType::Mgr,
        "rgw" => DaemonType::Rgw,
        "crash" => DaemonType::CrashCollector,
        "rbd-mirror" => DaemonType::RbdMirror,
        _ => DaemonType::Agent,
    };
    Ok(ServiceInfo {
        type_name: dtype,
        id: id.to_string(),
        status: data["status_desc"]
            .as_str()
            .unwrap_or("unknown")
            .to_string(),
        hostname: data["hostname"].as_str().unwrap_or("").to_string(),
        daemon_type: daemon_type.to_string(),
        version: data["version"].as_str().map(String::from),
        running: data["status"].as_i64().unwrap_or(0) == 1,
        last_configured: None,
        memory_usage_bytes: data["mem_usage"].as_u64(),
    })
}

/// Restart a specific service daemon.
pub async fn restart_service(
    session: &CephSession,
    daemon_type: &str,
    id: &str,
) -> Result<(), CephError> {
    let body = serde_json::json!({"action": "restart"});
    api_post(session, &format!("/daemon/{}.{}", daemon_type, id), &body).await?;
    log::info!("Restarted daemon {}.{}", daemon_type, id);
    Ok(())
}

/// Get the Ceph cluster version string.
pub async fn get_cluster_version(session: &CephSession) -> Result<String, CephError> {
    let data = api_get(session, "/summary").await?;
    let version = data["health"]["status"].as_str().unwrap_or("unknown");
    // The mgr REST API exposes the version at /api/summary
    let ver = data["mgr_map"]["available_modules"]
        .as_array()
        .and_then(|_| data["version"].as_str())
        .unwrap_or(version);
    Ok(ver.to_string())
}

/// Get the cluster FSID (unique identifier).
pub async fn get_cluster_fsid(session: &CephSession) -> Result<String, CephError> {
    let data = api_get(session, "/health/full").await?;
    let fsid = data["fsid"]
        .as_str()
        .ok_or_else(|| CephError::new(CephErrorKind::ClusterError, "FSID not found in response"))?;
    Ok(fsid.to_string())
}

/// Get the quorum status of the monitor cluster.
pub async fn get_quorum_status(session: &CephSession) -> Result<Value, CephError> {
    api_get(session, "/mon/quorum").await
}
