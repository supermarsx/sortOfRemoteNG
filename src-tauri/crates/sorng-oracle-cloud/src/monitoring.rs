use crate::client::OciClient;
use crate::error::OciResult;
use crate::types::{OciAlarm, OciAuditEvent, OciMetricData};

/// Monitoring, metrics, alarms, and audit event operations.
pub struct MonitoringManager;

impl MonitoringManager {
    // ── Alarms ───────────────────────────────────────────────────────

    pub async fn list_alarms(client: &OciClient, compartment_id: &str) -> OciResult<Vec<OciAlarm>> {
        client
            .get(
                "monitoring",
                &format!("/20180401/alarms?compartmentId={compartment_id}"),
            )
            .await
    }

    pub async fn get_alarm(client: &OciClient, alarm_id: &str) -> OciResult<OciAlarm> {
        client
            .get("monitoring", &format!("/20180401/alarms/{alarm_id}"))
            .await
    }

    pub async fn create_alarm(client: &OciClient, body: &serde_json::Value) -> OciResult<OciAlarm> {
        client.post("monitoring", "/20180401/alarms", body).await
    }

    pub async fn delete_alarm(client: &OciClient, alarm_id: &str) -> OciResult<()> {
        client
            .delete("monitoring", &format!("/20180401/alarms/{alarm_id}"))
            .await
    }

    pub async fn update_alarm(
        client: &OciClient,
        alarm_id: &str,
        body: &serde_json::Value,
    ) -> OciResult<OciAlarm> {
        client
            .put("monitoring", &format!("/20180401/alarms/{alarm_id}"), body)
            .await
    }

    // ── Metrics ──────────────────────────────────────────────────────

    pub async fn query_metrics(
        client: &OciClient,
        compartment_id: &str,
        query: &str,
        namespace: &str,
    ) -> OciResult<Vec<OciMetricData>> {
        client
            .post(
                "monitoring",
                &format!(
                    "/20180401/metrics/actions/summarizeMetricsData?compartmentId={compartment_id}"
                ),
                &serde_json::json!({
                    "namespace": namespace,
                    "query": query,
                }),
            )
            .await
    }

    pub async fn list_metrics(
        client: &OciClient,
        compartment_id: &str,
        namespace: Option<&str>,
    ) -> OciResult<Vec<OciMetricData>> {
        let mut body = serde_json::json!({
            "compartmentId": compartment_id,
        });
        if let Some(ns) = namespace {
            body["namespace"] = serde_json::Value::String(ns.to_string());
        }
        client
            .post(
                "monitoring",
                &format!("/20180401/metrics/actions/listMetrics?compartmentId={compartment_id}"),
                &body,
            )
            .await
    }

    // ── Audit Events ─────────────────────────────────────────────────

    pub async fn list_audit_events(
        client: &OciClient,
        compartment_id: &str,
        start_time: &str,
        end_time: &str,
    ) -> OciResult<Vec<OciAuditEvent>> {
        client
            .get(
                "audit",
                &format!(
                    "/20190901/auditEvents?compartmentId={compartment_id}&startTime={start_time}&endTime={end_time}"
                ),
            )
            .await
    }
}
