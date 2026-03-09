use chrono::Utc;
use serde_json::Value;

use crate::cluster::{api_delete, api_get, api_post};
use crate::error::CephError;
use crate::types::*;

// ---------------------------------------------------------------------------
// Health Checks & Alerts
// ---------------------------------------------------------------------------

/// List all current health checks from the Ceph cluster.
pub async fn list_health_checks(session: &CephSession) -> Result<Vec<HealthCheck>, CephError> {
    let data = api_get(session, "/health/full").await?;
    let mut checks = Vec::new();

    if let Some(check_map) = data["checks"].as_object() {
        for (code, check_val) in check_map {
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

            let detail: Vec<String> = check_val["detail"]
                .as_array()
                .map(|arr| {
                    arr.iter()
                        .filter_map(|d| d["message"].as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default();

            let muted = check_val["muted"].as_bool().unwrap_or(false);

            checks.push(HealthCheck {
                code: code.clone(),
                severity,
                summary,
                detail,
                muted,
            });
        }
    }
    Ok(checks)
}

/// Get detailed health information for the cluster.
pub async fn get_health_detail(session: &CephSession) -> Result<Value, CephError> {
    let data = api_get(session, "/health/full").await?;

    let overall_str = data["status"].as_str().unwrap_or("HEALTH_ERR");
    let checks = list_health_checks(session).await?;
    let muted = list_muted_checks(session).await.unwrap_or_default();

    Ok(serde_json::json!({
        "overall_status": overall_str,
        "checks_count": checks.len(),
        "checks": checks.iter().map(|c| serde_json::json!({
            "code": c.code,
            "severity": format!("{}", c.severity),
            "summary": c.summary,
            "detail_count": c.detail.len(),
            "detail": c.detail,
            "muted": c.muted,
        })).collect::<Vec<_>>(),
        "muted_checks": muted,
        "warnings": checks.iter().filter(|c| c.severity == HealthStatus::Warning).count(),
        "errors": checks.iter().filter(|c| c.severity == HealthStatus::Error).count(),
    }))
}

/// Mute a specific health check code.
pub async fn mute_health_check(
    session: &CephSession,
    check_code: &str,
    duration: Option<&str>,
    sticky: bool,
) -> Result<(), CephError> {
    if check_code.is_empty() {
        return Err(CephError::invalid_param(
            "Health check code cannot be empty",
        ));
    }

    let mut body = serde_json::json!({
        "code": check_code,
    });
    if let Some(dur) = duration {
        body["ttl"] = Value::String(dur.to_string());
    }
    if sticky {
        body["sticky"] = serde_json::json!(true);
    }

    api_post(session, "/health/mute", &body).await?;
    log::info!("Muted health check: {} (sticky={})", check_code, sticky);
    Ok(())
}

/// Unmute a previously muted health check.
pub async fn unmute_health_check(session: &CephSession, check_code: &str) -> Result<(), CephError> {
    if check_code.is_empty() {
        return Err(CephError::invalid_param(
            "Health check code cannot be empty",
        ));
    }

    api_delete(session, &format!("/health/mute/{}", check_code)).await?;
    log::info!("Unmuted health check: {}", check_code);
    Ok(())
}

/// List all currently muted health checks.
pub async fn list_muted_checks(session: &CephSession) -> Result<Vec<Value>, CephError> {
    let data = api_get(session, "/health/mute").await?;
    Ok(data.as_array().cloned().unwrap_or_default())
}

// ---------------------------------------------------------------------------
// Alert Management (higher-level alert tracking)
// ---------------------------------------------------------------------------

/// List all alerts derived from health checks, with enriched metadata.
pub async fn list_alerts(session: &CephSession) -> Result<Vec<CephAlert>, CephError> {
    let checks = list_health_checks(session).await?;
    let now = Utc::now();

    let mut alerts = Vec::new();
    for check in &checks {
        let severity = match check.severity {
            HealthStatus::Error => AlertSeverity::Critical,
            HealthStatus::Warning => AlertSeverity::Warning,
            HealthStatus::Ok => AlertSeverity::Info,
        };

        alerts.push(CephAlert {
            id: check.code.clone(),
            severity,
            type_name: check.code.clone(),
            message: check.summary.clone(),
            first_seen: now,
            last_seen: now,
            count: 1,
            entity: extract_entity_from_check(check),
            muted: check.muted,
            muted_until: None,
            acknowledged: false,
            detail: check.detail.clone(),
        });
    }
    Ok(alerts)
}

/// Get a specific alert by its check code.
pub async fn get_alert(session: &CephSession, alert_id: &str) -> Result<CephAlert, CephError> {
    let alerts = list_alerts(session).await?;
    alerts
        .into_iter()
        .find(|a| a.id == alert_id)
        .ok_or_else(|| CephError::not_found(format!("Alert: {}", alert_id)))
}

/// Acknowledge a health alert (mutes it with sticky flag).
pub async fn acknowledge_alert(
    session: &CephSession,
    alert_id: &str,
    comment: Option<&str>,
) -> Result<(), CephError> {
    if alert_id.is_empty() {
        return Err(CephError::invalid_param("Alert ID cannot be empty"));
    }

    let mut body = serde_json::json!({
        "code": alert_id,
        "sticky": true,
    });
    if let Some(c) = comment {
        body["comment"] = Value::String(c.to_string());
    }

    api_post(session, "/health/mute", &body).await?;
    log::info!("Acknowledged alert: {}", alert_id);
    Ok(())
}

/// Clear (unmute) an acknowledged alert.
pub async fn clear_alert(session: &CephSession, alert_id: &str) -> Result<(), CephError> {
    unmute_health_check(session, alert_id).await?;
    log::info!("Cleared alert: {}", alert_id);
    Ok(())
}

/// Clear all muted/acknowledged alerts.
pub async fn clear_all_alerts(session: &CephSession) -> Result<u32, CephError> {
    let muted = list_muted_checks(session).await?;
    let count = muted.len() as u32;
    for item in &muted {
        let code = item["code"]
            .as_str()
            .or_else(|| item.as_str())
            .unwrap_or("");
        if !code.is_empty() {
            unmute_health_check(session, code).await.ok();
        }
    }
    log::info!("Cleared {} muted alerts", count);
    Ok(count)
}

fn extract_entity_from_check(check: &HealthCheck) -> Option<String> {
    // Try to extract the entity (OSD, pool, etc.) from the check code
    let code = &check.code;
    if code.starts_with("OSD_") {
        // Try to find osd.N in the summary or detail
        for text in std::iter::once(&check.summary).chain(check.detail.iter()) {
            for word in text.split_whitespace() {
                if word.starts_with("osd.") {
                    return Some(
                        word.trim_end_matches(|c: char| !c.is_ascii_digit() && c != '.')
                            .to_string(),
                    );
                }
            }
        }
        return Some("osd".to_string());
    }
    if code.starts_with("PG_") {
        return Some("pg".to_string());
    }
    if code.starts_with("MON_") {
        return Some("mon".to_string());
    }
    if code.starts_with("MDS_") {
        return Some("mds".to_string());
    }
    if code.starts_with("POOL_") {
        return Some("pool".to_string());
    }
    None
}

/// Get alerts filtered by severity.
pub async fn list_alerts_by_severity(
    session: &CephSession,
    severity: AlertSeverity,
) -> Result<Vec<CephAlert>, CephError> {
    let alerts = list_alerts(session).await?;
    Ok(alerts
        .into_iter()
        .filter(|a| a.severity == severity)
        .collect())
}

/// Get the count of alerts by severity.
pub async fn get_alert_counts(session: &CephSession) -> Result<(u32, u32, u32), CephError> {
    let alerts = list_alerts(session).await?;
    let critical = alerts
        .iter()
        .filter(|a| a.severity == AlertSeverity::Critical)
        .count() as u32;
    let warning = alerts
        .iter()
        .filter(|a| a.severity == AlertSeverity::Warning)
        .count() as u32;
    let info = alerts
        .iter()
        .filter(|a| a.severity == AlertSeverity::Info)
        .count() as u32;
    Ok((critical, warning, info))
}

/// Check if any critical alerts are active.
pub async fn has_critical_alerts(session: &CephSession) -> Result<bool, CephError> {
    let (critical, _, _) = get_alert_counts(session).await?;
    Ok(critical > 0)
}

/// Get a summary of the current health state suitable for UI display.
pub async fn get_health_summary(session: &CephSession) -> Result<Value, CephError> {
    let health = api_get(session, "/health/full").await?;
    let alerts = list_alerts(session).await?;
    let (critical, warning, info) = get_alert_counts(session).await.unwrap_or((0, 0, 0));
    let muted = list_muted_checks(session).await.unwrap_or_default();

    Ok(serde_json::json!({
        "status": health["status"].as_str().unwrap_or("HEALTH_ERR"),
        "total_alerts": alerts.len(),
        "critical": critical,
        "warning": warning,
        "info": info,
        "muted_count": muted.len(),
        "top_alerts": alerts.iter().take(10).map(|a| serde_json::json!({
            "id": a.id,
            "severity": format!("{}", a.severity),
            "message": a.message,
            "muted": a.muted,
        })).collect::<Vec<_>>(),
    }))
}
