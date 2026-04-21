// ── Roundcube system settings management ─────────────────────────────────────

use crate::client::RoundcubeClient;
use crate::error::RoundcubeResult;
use crate::types::*;
use log::debug;

pub struct SettingsManager;

impl SettingsManager {
    /// GET /settings/system — get system configuration.
    pub async fn get_system_config(
        client: &RoundcubeClient,
    ) -> RoundcubeResult<RoundcubeSystemConfig> {
        debug!("ROUNDCUBE get_system_config");
        client.get("/settings/system").await
    }

    /// PUT /settings/system — update system configuration.
    pub async fn update_system_config(
        client: &RoundcubeClient,
        config: &RoundcubeSystemConfig,
    ) -> RoundcubeResult<RoundcubeSystemConfig> {
        debug!("ROUNDCUBE update_system_config");
        client.put("/settings/system", config).await
    }

    /// GET /settings/smtp — get SMTP configuration.
    pub async fn get_smtp_config(client: &RoundcubeClient) -> RoundcubeResult<RoundcubeSmtpConfig> {
        debug!("ROUNDCUBE get_smtp_config");
        client.get("/settings/smtp").await
    }

    /// PUT /settings/smtp — update SMTP configuration.
    pub async fn update_smtp_config(
        client: &RoundcubeClient,
        config: &RoundcubeSmtpConfig,
    ) -> RoundcubeResult<RoundcubeSmtpConfig> {
        debug!("ROUNDCUBE update_smtp_config");
        client.put("/settings/smtp", config).await
    }

    /// GET /settings/cache — get cache statistics.
    pub async fn get_cache_stats(client: &RoundcubeClient) -> RoundcubeResult<RoundcubeCacheStats> {
        debug!("ROUNDCUBE get_cache_stats");
        client.get("/settings/cache").await
    }

    /// POST /settings/cache/clear — clear all caches.
    pub async fn clear_cache(client: &RoundcubeClient) -> RoundcubeResult<()> {
        debug!("ROUNDCUBE clear_cache");
        client.post_no_body("/settings/cache/clear").await
    }

    /// GET /settings/logs — get recent log entries.
    pub async fn get_logs(
        client: &RoundcubeClient,
        limit: Option<u64>,
        level: Option<&str>,
    ) -> RoundcubeResult<Vec<RoundcubeLogEntry>> {
        debug!("ROUNDCUBE get_logs limit={limit:?} level={level:?}");
        let mut path = "/settings/logs".to_string();
        let mut params = Vec::new();
        if let Some(l) = limit {
            params.push(format!("limit={l}"));
        }
        if let Some(lv) = level {
            params.push(format!("level={lv}"));
        }
        if !params.is_empty() {
            path.push('?');
            path.push_str(&params.join("&"));
        }
        client.get(&path).await
    }
}
