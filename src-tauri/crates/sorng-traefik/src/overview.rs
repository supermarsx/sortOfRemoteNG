// ── traefik overview & raw config ────────────────────────────────────────────

use crate::client::TraefikClient;
use crate::error::TraefikResult;
use crate::types::*;

pub struct OverviewManager;

impl OverviewManager {
    pub async fn get_overview(client: &TraefikClient) -> TraefikResult<TraefikOverview> {
        client.get("/overview").await
    }

    pub async fn get_version(client: &TraefikClient) -> TraefikResult<TraefikVersion> {
        client.get("/version").await
    }

    pub async fn get_raw_config(client: &TraefikClient) -> TraefikResult<TraefikRawConfig> {
        client.get("/rawdata").await
    }
}
