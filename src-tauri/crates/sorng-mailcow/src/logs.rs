//! Log retrieval for Mailcow.

use crate::client::MailcowClient;
use crate::error::MailcowResult;
use crate::types::*;

pub struct LogManager;

impl LogManager {
    /// Get logs of a given type. GET /api/v1/get/logs/{type}/{count}
    pub async fn get_logs(
        client: &MailcowClient,
        log_type: &MailcowLogType,
        count: u64,
    ) -> MailcowResult<Vec<MailcowLogEntry>> {
        let path = format!("/get/logs/{}/{count}", log_type.as_api_str());
        client.get(&path).await
    }

    /// Get API logs. GET /api/v1/get/logs/api/{count}
    pub async fn get_api_logs(
        client: &MailcowClient,
        count: u64,
    ) -> MailcowResult<Vec<MailcowLogEntry>> {
        client.get(&format!("/get/logs/api/{count}")).await
    }
}
