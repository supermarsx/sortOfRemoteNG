// ── postfix process management ───────────────────────────────────────────────

use crate::client::PostfixClient;
use crate::error::PostfixResult;
use crate::types::*;

pub struct PostfixProcessManager;

impl PostfixProcessManager {
    pub async fn start(client: &PostfixClient) -> PostfixResult<()> {
        client.start().await
    }

    pub async fn stop(client: &PostfixClient) -> PostfixResult<()> {
        client.stop().await
    }

    pub async fn restart(client: &PostfixClient) -> PostfixResult<()> {
        client.stop().await?;
        client.start().await
    }

    pub async fn reload(client: &PostfixClient) -> PostfixResult<()> {
        client.reload().await
    }

    pub async fn status(client: &PostfixClient) -> PostfixResult<String> {
        client.status().await
    }

    pub async fn flush(client: &PostfixClient) -> PostfixResult<()> {
        client.postqueue_flush().await
    }

    pub async fn version(client: &PostfixClient) -> PostfixResult<String> {
        client.version().await
    }

    pub async fn info(client: &PostfixClient) -> PostfixResult<PostfixInfo> {
        let version = client.version().await.unwrap_or_else(|_| "unknown".into());
        let mail_name = client.postconf("mail_name").await.ok();
        let daemon_directory = client.postconf("daemon_directory").await.ok();
        Ok(PostfixInfo {
            version,
            mail_name,
            config_directory: client.config_dir().to_string(),
            queue_directory: client.queue_dir().to_string(),
            daemon_directory,
        })
    }

    pub async fn check_config(client: &PostfixClient) -> PostfixResult<ConfigTestResult> {
        client.check_config().await
    }
}
