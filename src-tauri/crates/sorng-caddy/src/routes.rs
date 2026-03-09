// ── caddy route management ───────────────────────────────────────────────────

use crate::client::CaddyClient;
use crate::error::CaddyResult;
use crate::types::*;

pub struct RouteManager;

impl RouteManager {
    pub async fn list(client: &CaddyClient, server: &str) -> CaddyResult<Vec<CaddyRoute>> {
        client
            .get(&format!("/config/apps/http/servers/{}/routes", server))
            .await
    }

    pub async fn get(client: &CaddyClient, server: &str, index: usize) -> CaddyResult<CaddyRoute> {
        client
            .get(&format!(
                "/config/apps/http/servers/{}/routes/{}",
                server, index
            ))
            .await
    }

    pub async fn add(client: &CaddyClient, server: &str, route: &CaddyRoute) -> CaddyResult<()> {
        // POST appends to the array
        let _: serde_json::Value = client
            .post(
                &format!("/config/apps/http/servers/{}/routes", server),
                route,
            )
            .await?;
        Ok(())
    }

    pub async fn set(
        client: &CaddyClient,
        server: &str,
        index: usize,
        route: &CaddyRoute,
    ) -> CaddyResult<()> {
        client
            .put(
                &format!("/config/apps/http/servers/{}/routes/{}", server, index),
                route,
            )
            .await
    }

    pub async fn delete(client: &CaddyClient, server: &str, index: usize) -> CaddyResult<()> {
        client
            .delete(&format!(
                "/config/apps/http/servers/{}/routes/{}",
                server, index
            ))
            .await
    }

    pub async fn set_all(
        client: &CaddyClient,
        server: &str,
        routes: &[CaddyRoute],
    ) -> CaddyResult<()> {
        client
            .put(
                &format!("/config/apps/http/servers/{}/routes", server),
                &routes,
            )
            .await
    }
}
