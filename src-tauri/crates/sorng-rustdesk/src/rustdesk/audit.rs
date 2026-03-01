use super::service::RustDeskService;
use super::types::*;

/// Audit log retrieval operations that delegate to the API client.
impl RustDeskService {
    /// Retrieve connection audit logs from the server.
    pub async fn api_connection_audits(
        &self,
        filter: AuditFilter,
    ) -> Result<serde_json::Value, String> {
        let client = self.get_api_client()?;
        client
            .list_connection_audits(
                filter.remote.as_deref(),
                filter.conn_type,
                filter.days_ago,
                filter.page,
                filter.page_size,
            )
            .await
    }

    /// Retrieve file transfer audit logs from the server.
    pub async fn api_file_audits(
        &self,
        filter: AuditFilter,
    ) -> Result<serde_json::Value, String> {
        let client = self.get_api_client()?;
        client
            .list_file_audits(
                filter.remote.as_deref(),
                filter.days_ago,
                filter.page,
                filter.page_size,
            )
            .await
    }

    /// Retrieve alarm audit logs from the server.
    pub async fn api_alarm_audits(
        &self,
        filter: AuditFilter,
    ) -> Result<serde_json::Value, String> {
        let client = self.get_api_client()?;
        client
            .list_alarm_audits(
                filter.device.as_deref(),
                filter.days_ago,
                filter.page,
                filter.page_size,
            )
            .await
    }

    /// Retrieve console audit logs from the server.
    pub async fn api_console_audits(
        &self,
        filter: AuditFilter,
    ) -> Result<serde_json::Value, String> {
        let client = self.get_api_client()?;
        client
            .list_console_audits(
                filter.operator.as_deref(),
                filter.days_ago,
                filter.page,
                filter.page_size,
            )
            .await
    }

    /// Get a combined audit summary across all categories for a given peer.
    pub async fn api_peer_audit_summary(
        &self,
        remote: &str,
    ) -> Result<serde_json::Value, String> {
        let conn_filter = AuditFilter {
            remote: Some(remote.to_string()),
            page: Some(1),
            page_size: Some(5),
            ..Default::default()
        };
        let file_filter = AuditFilter {
            remote: Some(remote.to_string()),
            page: Some(1),
            page_size: Some(5),
            ..Default::default()
        };
        let alarm_filter = AuditFilter {
            device: Some(remote.to_string()),
            page: Some(1),
            page_size: Some(5),
            ..Default::default()
        };

        let connections = self.api_connection_audits(conn_filter).await.ok();
        let files = self.api_file_audits(file_filter).await.ok();
        let alarms = self.api_alarm_audits(alarm_filter).await.ok();

        Ok(serde_json::json!({
            "remote": remote,
            "connections": connections,
            "files": files,
            "alarms": alarms,
        }))
    }

    /// Get a combined audit summary for a specific operator across all categories.
    pub async fn api_operator_audit_summary(
        &self,
        operator: &str,
    ) -> Result<serde_json::Value, String> {
        let conn_filter = AuditFilter {
            remote: None,
            page: Some(1),
            page_size: Some(10),
            ..Default::default()
        };
        let console_filter = AuditFilter {
            operator: Some(operator.to_string()),
            page: Some(1),
            page_size: Some(10),
            ..Default::default()
        };

        let connections = self.api_connection_audits(conn_filter).await.ok();
        let console = self.api_console_audits(console_filter).await.ok();

        Ok(serde_json::json!({
            "operator": operator,
            "connections": connections,
            "console": console,
        }))
    }
}
