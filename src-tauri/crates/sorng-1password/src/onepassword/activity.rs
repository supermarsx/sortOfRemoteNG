use super::api_client::OnePasswordApiClient;
use super::types::*;

/// API activity / audit log operations for 1Password Connect.
pub struct OnePasswordActivity;

impl OnePasswordActivity {
    /// Get recent API activity (audit log).
    pub async fn list(
        client: &OnePasswordApiClient,
        params: &ActivityListParams,
    ) -> Result<Vec<ApiRequest>, OnePasswordError> {
        client.get_activity(params.limit, params.offset).await
    }

    /// Get activity filtered by action type.
    pub async fn list_by_action(
        client: &OnePasswordApiClient,
        action: &ApiAction,
        limit: Option<u32>,
    ) -> Result<Vec<ApiRequest>, OnePasswordError> {
        let all = client.get_activity(limit, None).await?;
        Ok(all
            .into_iter()
            .filter(|r| r.action.as_ref() == Some(action))
            .collect())
    }

    /// Get activity filtered by result (SUCCESS/DENY).
    pub async fn list_by_result(
        client: &OnePasswordApiClient,
        result: &ApiResult,
        limit: Option<u32>,
    ) -> Result<Vec<ApiRequest>, OnePasswordError> {
        let all = client.get_activity(limit, None).await?;
        Ok(all
            .into_iter()
            .filter(|r| r.result.as_ref() == Some(result))
            .collect())
    }

    /// Count the number of denied requests in the recent activity.
    pub async fn count_denied(
        client: &OnePasswordApiClient,
        limit: Option<u32>,
    ) -> Result<u64, OnePasswordError> {
        let denied = Self::list_by_result(client, &ApiResult::DENY, limit).await?;
        Ok(denied.len() as u64)
    }

    /// Get activity for a specific vault.
    pub async fn list_by_vault(
        client: &OnePasswordApiClient,
        vault_id: &str,
        limit: Option<u32>,
    ) -> Result<Vec<ApiRequest>, OnePasswordError> {
        let all = client.get_activity(limit, None).await?;
        Ok(all
            .into_iter()
            .filter(|r| {
                r.resource
                    .as_ref()
                    .and_then(|res| res.vault.as_ref())
                    .map(|v| v.id == vault_id)
                    .unwrap_or(false)
            })
            .collect())
    }

    /// Get activity for a specific item.
    pub async fn list_by_item(
        client: &OnePasswordApiClient,
        item_id: &str,
        limit: Option<u32>,
    ) -> Result<Vec<ApiRequest>, OnePasswordError> {
        let all = client.get_activity(limit, None).await?;
        Ok(all
            .into_iter()
            .filter(|r| {
                r.resource
                    .as_ref()
                    .and_then(|res| res.item.as_ref())
                    .map(|i| i.id == item_id)
                    .unwrap_or(false)
            })
            .collect())
    }
}
