use crate::client::PfsenseClient;
use crate::error::PfsenseResult;
use crate::types::*;

pub struct BackupManager;

impl BackupManager {
    pub async fn list(client: &PfsenseClient) -> PfsenseResult<Vec<BackupEntry>> {
        let resp: ApiListResponse<BackupEntry> = client.api_get("diagnostics/backup").await?;
        Ok(resp.data)
    }

    pub async fn create(client: &PfsenseClient, config: &BackupConfig) -> PfsenseResult<BackupEntry> {
        let resp: ApiResponse<BackupEntry> = client.api_post("diagnostics/backup", config).await?;
        Ok(resp.data)
    }

    pub async fn download(client: &PfsenseClient, id: &str) -> PfsenseResult<Vec<u8>> {
        client.api_get_bytes(&format!("diagnostics/backup/download/{id}")).await
    }

    pub async fn restore(client: &PfsenseClient, config_data: &[u8], decrypt_password: Option<&str>) -> PfsenseResult<serde_json::Value> {
        let body = serde_json::json!({
            "config": base64::encode(config_data),
            "decrypt_password": decrypt_password
        });
        client.api_post("diagnostics/backup/restore", &body).await
    }

    pub async fn delete(client: &PfsenseClient, id: &str) -> PfsenseResult<()> {
        client.api_delete_void(&format!("diagnostics/backup/{id}")).await
    }

    pub async fn get(client: &PfsenseClient, id: &str) -> PfsenseResult<BackupEntry> {
        let resp: ApiResponse<BackupEntry> = client.api_get(&format!("diagnostics/backup/{id}")).await?;
        Ok(resp.data)
    }

    pub async fn download_current(client: &PfsenseClient, config: &BackupConfig) -> PfsenseResult<Vec<u8>> {
        let body = serde_json::json!({
            "area": config.area,
            "no_rrd": config.no_rrd,
            "no_packages": config.no_packages,
            "encrypt": config.encrypt,
            "encrypt_password": config.encrypt_password
        });
        let raw: serde_json::Value = client.api_post("diagnostics/backup/download", &body).await?;
        let data_str = raw.get("data")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        Ok(data_str.as_bytes().to_vec())
    }
}
