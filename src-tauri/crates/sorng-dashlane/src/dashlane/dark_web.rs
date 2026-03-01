use crate::dashlane::types::{DashlaneError, DarkWebAlert, AlertSeverity, AlertStatus};

/// Filter alerts by status.
pub fn filter_by_status(alerts: &[DarkWebAlert], status: AlertStatus) -> Vec<DarkWebAlert> {
    alerts
        .iter()
        .filter(|a| a.status == status)
        .cloned()
        .collect()
}

/// Get unresolved (active) alerts.
pub fn get_active_alerts(alerts: &[DarkWebAlert]) -> Vec<DarkWebAlert> {
    filter_by_status(alerts, AlertStatus::Active)
}

/// Get critical alerts only.
pub fn get_critical_alerts(alerts: &[DarkWebAlert]) -> Vec<DarkWebAlert> {
    alerts
        .iter()
        .filter(|a| a.severity == AlertSeverity::Critical && a.status == AlertStatus::Active)
        .cloned()
        .collect()
}

/// Find alert by ID.
pub fn find_alert_by_id<'a>(alerts: &'a [DarkWebAlert], id: &str) -> Option<&'a DarkWebAlert> {
    alerts.iter().find(|a| a.id == id)
}

/// Mark an alert as viewed.
pub fn mark_viewed(alert: &mut DarkWebAlert) {
    if alert.status == AlertStatus::Active {
        alert.status = AlertStatus::Viewed;
    }
}

/// Mark an alert as resolved (dismissed).
pub fn mark_resolved(alert: &mut DarkWebAlert) {
    alert.status = AlertStatus::Resolved;
}

/// Search alerts by email or domain.
pub fn search_alerts(alerts: &[DarkWebAlert], query: &str) -> Vec<DarkWebAlert> {
    let lower = query.to_lowercase();
    alerts
        .iter()
        .filter(|a| {
            a.email.to_lowercase().contains(&lower)
                || a.domain.as_deref().unwrap_or("").to_lowercase().contains(&lower)
                || a.breach_name.as_deref().unwrap_or("").to_lowercase().contains(&lower)
        })
        .cloned()
        .collect()
}

/// Group alerts by email.
pub fn group_by_email(alerts: &[DarkWebAlert]) -> Vec<(String, Vec<DarkWebAlert>)> {
    use std::collections::HashMap;
    let mut map: HashMap<String, Vec<DarkWebAlert>> = HashMap::new();
    for alert in alerts {
        map.entry(alert.email.clone())
            .or_default()
            .push(alert.clone());
    }
    let mut result: Vec<_> = map.into_iter().collect();
    result.sort_by(|a, b| b.1.len().cmp(&a.1.len()));
    result
}

/// Count alerts by severity.
pub fn count_by_severity(alerts: &[DarkWebAlert]) -> Vec<(String, usize)> {
    use std::collections::HashMap;
    let mut map: HashMap<String, usize> = HashMap::new();
    for alert in alerts {
        let sev = format!("{:?}", alert.severity);
        *map.entry(sev).or_default() += 1;
    }
    let mut result: Vec<_> = map.into_iter().collect();
    result.sort_by(|a, b| b.1.cmp(&a.1));
    result
}

/// Get breach summary (unique breaches).
pub fn get_breach_summary(alerts: &[DarkWebAlert]) -> Vec<(String, usize)> {
    use std::collections::HashMap;
    let mut map: HashMap<String, usize> = HashMap::new();
    for alert in alerts {
        if let Some(ref name) = alert.breach_name {
            *map.entry(name.clone()).or_default() += 1;
        }
    }
    let mut result: Vec<_> = map.into_iter().collect();
    result.sort_by(|a, b| b.1.cmp(&a.1));
    result
}

/// Create a simulated alert for testing.
pub fn create_test_alert(email: String, domain: String, breach_name: String) -> DarkWebAlert {
    DarkWebAlert {
        id: uuid::Uuid::new_v4().to_string(),
        email,
        domain: Some(domain),
        breach_name: Some(breach_name),
        breach_date: None,
        exposed_data: Vec::new(),
        severity: AlertSeverity::High,
        status: AlertStatus::Active,
        detected_at: Some(chrono::Utc::now().to_rfc3339()),
    }
}
