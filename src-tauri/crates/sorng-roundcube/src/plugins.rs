// ── Roundcube plugin management ───────────────────────────────────────────────

use crate::client::RoundcubeClient;
use crate::error::RoundcubeResult;
use crate::types::*;
use log::debug;
use std::collections::HashMap;

pub struct PluginManager;

impl PluginManager {
    /// GET /plugins — list all plugins.
    pub async fn list(client: &RoundcubeClient) -> RoundcubeResult<Vec<RoundcubePlugin>> {
        debug!("ROUNDCUBE list_plugins");
        client.get("/plugins").await
    }

    /// GET /plugins/:name — get a single plugin.
    pub async fn get(client: &RoundcubeClient, name: &str) -> RoundcubeResult<RoundcubePlugin> {
        debug!("ROUNDCUBE get_plugin name={name}");
        client.get(&format!("/plugins/{name}")).await
    }

    /// POST /plugins/:name/enable — enable a plugin.
    pub async fn enable(client: &RoundcubeClient, name: &str) -> RoundcubeResult<()> {
        debug!("ROUNDCUBE enable_plugin name={name}");
        client
            .post_no_body(&format!("/plugins/{name}/enable"))
            .await
    }

    /// POST /plugins/:name/disable — disable a plugin.
    pub async fn disable(client: &RoundcubeClient, name: &str) -> RoundcubeResult<()> {
        debug!("ROUNDCUBE disable_plugin name={name}");
        client
            .post_no_body(&format!("/plugins/{name}/disable"))
            .await
    }

    /// GET /plugins/:name/config — get plugin configuration.
    pub async fn get_config(
        client: &RoundcubeClient,
        name: &str,
    ) -> RoundcubeResult<RoundcubePluginConfig> {
        debug!("ROUNDCUBE get_plugin_config name={name}");
        client.get(&format!("/plugins/{name}/config")).await
    }

    /// PUT /plugins/:name/config — update plugin configuration.
    pub async fn update_config(
        client: &RoundcubeClient,
        name: &str,
        settings: &HashMap<String, serde_json::Value>,
    ) -> RoundcubeResult<()> {
        debug!("ROUNDCUBE update_plugin_config name={name}");
        client
            .put_no_response(&format!("/plugins/{name}/config"), settings)
            .await
    }
}
