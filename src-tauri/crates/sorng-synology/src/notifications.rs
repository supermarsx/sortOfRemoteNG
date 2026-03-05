//! Notification settings — email, SMS, push.

use crate::client::SynoClient;
use crate::error::SynologyResult;
use crate::types::*;

pub struct NotificationsManager;

impl NotificationsManager {
    /// Get notification configuration.
    pub async fn get_config(client: &SynoClient) -> SynologyResult<NotificationConfig> {
        let v = client.best_version("SYNO.Core.Notification.Setting", 1).unwrap_or(1);
        client.api_call("SYNO.Core.Notification.Setting", v, "get", &[]).await
    }

    /// Test email notification.
    pub async fn test_email(client: &SynoClient) -> SynologyResult<()> {
        let v = client.best_version("SYNO.Core.Notification.Mail", 1).unwrap_or(1);
        client.api_post_void("SYNO.Core.Notification.Mail", v, "test", &[]).await
    }

    /// Set email notification settings.
    pub async fn set_email_config(
        client: &SynoClient,
        enabled: bool,
        smtp_server: &str,
        smtp_port: u16,
        sender: &str,
        recipients: &str,
    ) -> SynologyResult<()> {
        let v = client.best_version("SYNO.Core.Notification.Mail", 1).unwrap_or(1);
        let en = if enabled { "true" } else { "false" };
        let port = smtp_port.to_string();
        client.api_post_void(
            "SYNO.Core.Notification.Mail",
            v,
            "set",
            &[
                ("enable", en),
                ("smtp_server", smtp_server),
                ("smtp_port", &port),
                ("sender", sender),
                ("primary_mail", recipients),
            ],
        )
        .await
    }

    /// Get push notification settings.
    pub async fn get_push_config(client: &SynoClient) -> SynologyResult<serde_json::Value> {
        let v = client.best_version("SYNO.Core.Notification.Push.Mobile", 1).unwrap_or(1);
        client.api_call("SYNO.Core.Notification.Push.Mobile", v, "get", &[]).await
    }

    /// Enable/disable push notifications.
    pub async fn set_push_enabled(client: &SynoClient, enabled: bool) -> SynologyResult<()> {
        let v = client.best_version("SYNO.Core.Notification.Push.Mobile", 1).unwrap_or(1);
        let en = if enabled { "true" } else { "false" };
        client.api_post_void(
            "SYNO.Core.Notification.Push.Mobile",
            v,
            "set",
            &[("enable", en)],
        )
        .await
    }

    /// Test push notification.
    pub async fn test_push(client: &SynoClient) -> SynologyResult<()> {
        let v = client.best_version("SYNO.Core.Notification.Push.Mobile", 1).unwrap_or(1);
        client.api_post_void("SYNO.Core.Notification.Push.Mobile", v, "test", &[]).await
    }

    /// Get SMS notification settings.
    pub async fn get_sms_config(client: &SynoClient) -> SynologyResult<serde_json::Value> {
        let v = client.best_version("SYNO.Core.Notification.SMS", 1).unwrap_or(1);
        client.api_call("SYNO.Core.Notification.SMS", v, "get", &[]).await
    }

    /// Get notification history.
    pub async fn get_history(client: &SynoClient) -> SynologyResult<serde_json::Value> {
        let v = client.best_version("SYNO.Core.Notification.Event", 1).unwrap_or(1);
        client.api_call("SYNO.Core.Notification.Event", v, "list", &[("offset", "0"), ("limit", "100")]).await
    }

    /// Acknowledge all notifications.
    pub async fn acknowledge_all(client: &SynoClient) -> SynologyResult<()> {
        let v = client.best_version("SYNO.Core.Notification.Event", 1).unwrap_or(1);
        client.api_post_void("SYNO.Core.Notification.Event", v, "acknowledge_all", &[]).await
    }
}
