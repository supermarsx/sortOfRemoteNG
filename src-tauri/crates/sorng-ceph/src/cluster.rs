use reqwest::{Client, Response};
use serde_json::Value;

use crate::error::{CephError, CephErrorKind};
use crate::types::*;

const MAX_SUCCESS_RESPONSE_BYTES: usize = 16 * 1024 * 1024;
const MAX_ERROR_RESPONSE_BYTES: usize = 64 * 1024;
const MAX_REQUEST_TIMEOUT_SECS: u64 = 300;

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
    if !session.config.verify_cert {
        return Err(CephError::invalid_param(
            "TLS certificate verification cannot be disabled: verify_cert=false requires an explicit runtime acknowledgement contract",
        ));
    }
    if session.config.timeout_secs == 0 || session.config.timeout_secs > MAX_REQUEST_TIMEOUT_SECS {
        return Err(CephError::invalid_param(format!(
            "Request timeout must be between 1 and {} seconds",
            MAX_REQUEST_TIMEOUT_SECS
        )));
    }

    let timeout = std::time::Duration::from_secs(session.config.timeout_secs);
    let builder = Client::builder()
        .timeout(timeout)
        .connect_timeout(timeout.min(std::time::Duration::from_secs(10)))
        .redirect(reqwest::redirect::Policy::none());

    builder
        .build()
        .map_err(|e| CephError::connection(format!("Failed to build HTTP client: {}", e)))
}

fn validate_api_path(path: &str) -> Result<(), CephError> {
    if !path.starts_with('/')
        || path.starts_with("//")
        || path.len() > 8 * 1024
        || !path.is_ascii()
        || path.contains('\\')
        || path.contains('#')
        || path.chars().any(char::is_control)
    {
        return Err(CephError::invalid_param(
            "Ceph API path is invalid or oversized",
        ));
    }

    let (route, query) = path.split_once('?').unwrap_or((path, ""));
    if route
        .split('/')
        .any(|segment| matches!(segment, "." | ".."))
    {
        return Err(CephError::invalid_param(
            "Ceph API path contains a traversal segment",
        ));
    }

    let bytes = path.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            if index + 2 >= bytes.len()
                || !bytes[index + 1].is_ascii_hexdigit()
                || !bytes[index + 2].is_ascii_hexdigit()
            {
                return Err(CephError::invalid_param(
                    "Ceph API path contains invalid percent encoding",
                ));
            }
            index += 3;
        } else {
            index += 1;
        }
    }

    if !query.is_empty() {
        if query.len() > 4 * 1024 {
            return Err(CephError::invalid_param("Ceph API query is oversized"));
        }
        let mut keys = std::collections::HashSet::new();
        let allowed = [
            "access_key",
            "duration",
            "group",
            "metric",
            "osd",
            "path",
            "pool",
            "purge-data",
            "purge-objects",
            "quota_type",
            "threshold",
            "type",
        ];
        let pairs: Vec<_> = url::form_urlencoded::parse(query.as_bytes()).collect();
        if pairs.len() > 32 {
            return Err(CephError::invalid_param(
                "Ceph API query has too many parameters",
            ));
        }
        for (key, value) in pairs {
            if !allowed.contains(&key.as_ref())
                || !keys.insert(key.into_owned())
                || value.len() > 4 * 1024
            {
                return Err(CephError::invalid_param(
                    "Ceph API query contains an invalid or duplicate parameter",
                ));
            }
        }
    }
    Ok(())
}

fn build_api_url(session: &CephSession, path: &str) -> Result<reqwest::Url, CephError> {
    validate_api_path(path)?;
    reqwest::Url::parse(&format!("{}{}", base_url(session), path))
        .map_err(|_| CephError::invalid_param("Ceph API URL could not be constructed safely"))
}

async fn read_limited_response(
    mut response: Response,
    max_bytes: usize,
) -> Result<Vec<u8>, CephError> {
    let status = response.status();
    if response
        .content_length()
        .is_some_and(|length| length > max_bytes as u64)
    {
        return Err(CephError::api(
            format!(
                "Ceph API response exceeded the {} byte safety limit",
                max_bytes
            ),
            Some(status.as_u16()),
        ));
    }

    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        if chunk.len() > max_bytes.saturating_sub(body.len()) {
            return Err(CephError::api(
                format!(
                    "Ceph API response exceeded the {} byte safety limit",
                    max_bytes
                ),
                Some(status.as_u16()),
            ));
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

async fn read_json_response(response: Response, allow_empty: bool) -> Result<Value, CephError> {
    let status = response.status();
    let body = read_limited_response(response, MAX_SUCCESS_RESPONSE_BYTES).await?;
    if body.is_empty() && allow_empty {
        return Ok(Value::Null);
    }
    serde_json::from_slice(&body).map_err(|_| {
        CephError::api(
            "Ceph API returned a malformed JSON response",
            Some(status.as_u16()),
        )
    })
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
    let url = build_api_url(session, path)?;
    let auth = auth_header(session)?;

    let response = client
        .get(url)
        .header("Authorization", &auth)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|_| CephError::connection("Ceph API GET transport failed"))?;

    let status = response.status();
    if status.is_success() {
        read_json_response(response, false).await
    } else if status.as_u16() == 401 || status.as_u16() == 403 {
        let _ = read_limited_response(response, MAX_ERROR_RESPONSE_BYTES).await;
        Err(CephError::new(
            CephErrorKind::AuthenticationFailed,
            "Ceph API rejected the supplied credentials",
        )
        .with_status(status.as_u16()))
    } else {
        let _ = read_limited_response(response, MAX_ERROR_RESPONSE_BYTES).await;
        Err(CephError::api(
            format!("Ceph API GET returned HTTP {}", status.as_u16()),
            Some(status.as_u16()),
        ))
    }
}

/// Perform a POST request to the Ceph REST API.
pub async fn api_post(session: &CephSession, path: &str, body: &Value) -> Result<Value, CephError> {
    let client = build_client(session)?;
    let url = build_api_url(session, path)?;
    let auth = auth_header(session)?;

    let response = client
        .post(url)
        .header("Authorization", &auth)
        .header("Accept", "application/json")
        .header("Content-Type", "application/json")
        .json(body)
        .send()
        .await
        .map_err(|_| CephError::connection("Ceph API POST transport failed"))?;

    let status = response.status();
    if status.is_success() {
        read_json_response(response, true).await
    } else if status.as_u16() == 401 || status.as_u16() == 403 {
        let _ = read_limited_response(response, MAX_ERROR_RESPONSE_BYTES).await;
        Err(CephError::new(
            CephErrorKind::AuthenticationFailed,
            "Ceph API rejected the supplied credentials",
        )
        .with_status(status.as_u16()))
    } else {
        let _ = read_limited_response(response, MAX_ERROR_RESPONSE_BYTES).await;
        Err(CephError::api(
            format!("Ceph API POST returned HTTP {}", status.as_u16()),
            Some(status.as_u16()),
        ))
    }
}

/// Perform a PUT request to the Ceph REST API.
pub async fn api_put(session: &CephSession, path: &str, body: &Value) -> Result<Value, CephError> {
    let client = build_client(session)?;
    let url = build_api_url(session, path)?;
    let auth = auth_header(session)?;

    let response = client
        .put(url)
        .header("Authorization", &auth)
        .header("Accept", "application/json")
        .header("Content-Type", "application/json")
        .json(body)
        .send()
        .await
        .map_err(|_| CephError::connection("Ceph API PUT transport failed"))?;

    let status = response.status();
    if status.is_success() {
        read_json_response(response, true).await
    } else {
        let _ = read_limited_response(response, MAX_ERROR_RESPONSE_BYTES).await;
        Err(CephError::api(
            format!("Ceph API PUT returned HTTP {}", status.as_u16()),
            Some(status.as_u16()),
        ))
    }
}

/// Perform a DELETE request to the Ceph REST API.
pub async fn api_delete(session: &CephSession, path: &str) -> Result<Value, CephError> {
    let client = build_client(session)?;
    let url = build_api_url(session, path)?;
    let auth = auth_header(session)?;

    let response = client
        .delete(url)
        .header("Authorization", &auth)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|_| CephError::connection("Ceph API DELETE transport failed"))?;

    let status = response.status();
    if status.is_success() {
        read_json_response(response, true).await
    } else {
        let _ = read_limited_response(response, MAX_ERROR_RESPONSE_BYTES).await;
        Err(CephError::api(
            format!("Ceph API DELETE returned HTTP {}", status.as_u16()),
            Some(status.as_u16()),
        ))
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
    log::info!(
        "Set Ceph config option {}/{} (value redacted)",
        section,
        name
    );
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
