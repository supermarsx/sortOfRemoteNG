// ── apache config management ─────────────────────────────────────────────────

use crate::client::ApacheClient;
use crate::error::ApacheResult;
use crate::types::*;

pub struct ApacheConfigManager;

impl ApacheConfigManager {
    pub async fn get_main_config(client: &ApacheClient) -> ApacheResult<ApacheMainConfig> {
        let raw = client.read_remote_file(client.config_path()).await?;
        Ok(ApacheMainConfig {
            server_root: None,
            listen: vec![],
            server_admin: None,
            server_name: None,
            document_root: None,
            error_log: None,
            log_level: None,
            keep_alive: None,
            keep_alive_timeout: None,
            max_keep_alive_requests: None,
            timeout: None,
            include_files: vec![],
            raw_content: raw,
        })
    }

    pub async fn update_main_config(client: &ApacheClient, content: &str) -> ApacheResult<()> {
        client
            .write_remote_file(client.config_path(), content)
            .await
    }

    pub async fn test(client: &ApacheClient) -> ApacheResult<ConfigTestResult> {
        client.test_config().await
    }

    pub async fn list_conf_available(client: &ApacheClient) -> ApacheResult<Vec<String>> {
        client.list_remote_dir(client.conf_available_dir()).await
    }

    pub async fn list_conf_enabled(client: &ApacheClient) -> ApacheResult<Vec<String>> {
        client.list_remote_dir(client.conf_enabled_dir()).await
    }

    pub async fn enable_conf(client: &ApacheClient, name: &str) -> ApacheResult<()> {
        client.enable_conf(name).await
    }

    pub async fn disable_conf(client: &ApacheClient, name: &str) -> ApacheResult<()> {
        client.disable_conf(name).await
    }
}
