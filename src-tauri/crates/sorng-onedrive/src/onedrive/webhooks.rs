//! Microsoft Graph webhook subscriptions for OneDrive change notifications.
//!
//! Create, renew, delete, and validate subscriptions.  The callback
//! endpoint validation (echo-back of `validationToken`) is also handled.

use crate::onedrive::api_client::GraphApiClient;
use crate::onedrive::error::OneDriveResult;
use crate::onedrive::types::{
    Subscription, SubscriptionRequest, WebhookNotification, WebhookNotificationEnvelope,
};
use log::info;

/// Webhook / subscription management.
pub struct OneDriveWebhooks<'a> {
    client: &'a GraphApiClient,
}

impl<'a> OneDriveWebhooks<'a> {
    pub fn new(client: &'a GraphApiClient) -> Self {
        Self { client }
    }

    /// Create a new subscription.
    pub async fn create_subscription(
        &self,
        request: &SubscriptionRequest,
    ) -> OneDriveResult<Subscription> {
        let body = serde_json::to_value(request)?;
        let resp = self.client.post("subscriptions", &body).await?;
        let sub: Subscription = serde_json::from_value(resp)?;
        info!(
            "Created subscription {} for {}",
            sub.id.as_deref().unwrap_or("?"),
            sub.resource,
        );
        Ok(sub)
    }

    /// Renew (update) an existing subscription.
    pub async fn renew_subscription(
        &self,
        subscription_id: &str,
        new_expiration: &str,
    ) -> OneDriveResult<Subscription> {
        let path = format!("subscriptions/{}", subscription_id);
        let body = serde_json::json!({
            "expirationDateTime": new_expiration,
        });
        let resp = self.client.patch(&path, &body).await?;
        let sub: Subscription = serde_json::from_value(resp)?;
        info!("Renewed subscription {}", subscription_id);
        Ok(sub)
    }

    /// Get an existing subscription.
    pub async fn get_subscription(
        &self,
        subscription_id: &str,
    ) -> OneDriveResult<Subscription> {
        let path = format!("subscriptions/{}", subscription_id);
        let resp = self.client.get(&path, &[]).await?;
        let sub: Subscription = serde_json::from_value(resp)?;
        Ok(sub)
    }

    /// Delete a subscription.
    pub async fn delete_subscription(
        &self,
        subscription_id: &str,
    ) -> OneDriveResult<()> {
        let path = format!("subscriptions/{}", subscription_id);
        self.client.delete(&path).await?;
        info!("Deleted subscription {}", subscription_id);
        Ok(())
    }

    /// List all active subscriptions.
    pub async fn list_subscriptions(&self) -> OneDriveResult<Vec<Subscription>> {
        let resp = self.client.get("subscriptions", &[]).await?;
        let subs: Vec<Subscription> = resp["value"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| serde_json::from_value(v.clone()).ok())
                    .collect()
            })
            .unwrap_or_default();
        Ok(subs)
    }

    /// Parse an incoming webhook notification body.
    pub fn parse_notification(
        body: &str,
    ) -> OneDriveResult<Vec<WebhookNotification>> {
        let envelope: WebhookNotificationEnvelope = serde_json::from_str(body)?;
        Ok(envelope.value)
    }

    /// Validate a subscription verification request.
    ///
    /// When Graph creates a subscription it sends a validation request with
    /// a `validationToken` query parameter.  The server must respond with
    /// the token as-is (text/plain, HTTP 200).
    pub fn validate_token(validation_token: &str) -> String {
        validation_token.to_string()
    }

    /// Verify the `clientState` in an incoming notification.
    pub fn verify_client_state(
        notification: &WebhookNotification,
        expected: &str,
    ) -> bool {
        notification
            .client_state
            .as_deref()
            .map(|cs| cs == expected)
            .unwrap_or(false)
    }
}

// ═══════════════════════════════════════════════════════════════════════
//  Tests
// ═══════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_notification() {
        let body = r#"{
            "value": [
                {
                    "subscriptionId": "sub1",
                    "changeType": "updated",
                    "resource": "me/drive/root",
                    "clientState": "my_secret"
                }
            ]
        }"#;
        let notifs = OneDriveWebhooks::parse_notification(body).unwrap();
        assert_eq!(notifs.len(), 1);
        assert_eq!(notifs[0].subscription_id.as_deref(), Some("sub1"));
        assert_eq!(notifs[0].change_type.as_deref(), Some("updated"));
    }

    #[test]
    fn test_verify_client_state() {
        let notif = WebhookNotification {
            subscription_id: None,
            subscription_expiration_date_time: None,
            change_type: None,
            resource: None,
            resource_data: None,
            client_state: Some("secret123".into()),
            tenant_id: None,
        };
        assert!(OneDriveWebhooks::verify_client_state(&notif, "secret123"));
        assert!(!OneDriveWebhooks::verify_client_state(&notif, "wrong"));
    }

    #[test]
    fn test_validate_token() {
        assert_eq!(
            OneDriveWebhooks::validate_token("abc-123"),
            "abc-123"
        );
    }

    #[test]
    fn test_subscription_request_serde() {
        let req = SubscriptionRequest {
            resource: "me/drive/root".into(),
            change_type: "updated".into(),
            notification_url: "https://example.com/hook".into(),
            expiration_date_time: "2026-12-31T00:00:00Z".into(),
            client_state: Some("my_state".into()),
            lifecycle_notification_url: None,
        };
        let v = serde_json::to_value(&req).unwrap();
        assert_eq!(v["resource"], "me/drive/root");
        assert_eq!(v["changeType"], "updated");
    }
}
