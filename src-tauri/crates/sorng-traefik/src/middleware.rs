// ── traefik middleware management ────────────────────────────────────────────

use crate::client::TraefikClient;
use crate::error::TraefikResult;
use crate::types::*;

pub struct MiddlewareManager;

impl MiddlewareManager {
    pub async fn list_http(client: &TraefikClient) -> TraefikResult<Vec<TraefikMiddleware>> {
        client.get("/http/middlewares").await
    }

    pub async fn get_http(client: &TraefikClient, name: &str) -> TraefikResult<TraefikMiddleware> {
        client.get(&format!("/http/middlewares/{}", encode(name))).await
    }

    pub async fn list_tcp(client: &TraefikClient) -> TraefikResult<Vec<TraefikTcpMiddleware>> {
        client.get("/tcp/middlewares").await
    }

    pub async fn get_tcp(client: &TraefikClient, name: &str) -> TraefikResult<TraefikTcpMiddleware> {
        client.get(&format!("/tcp/middlewares/{}", encode(name))).await
    }
}

fn encode(name: &str) -> String {
    name.replace('@', "%40")
}
