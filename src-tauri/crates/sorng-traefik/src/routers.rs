// ── traefik router management ────────────────────────────────────────────────

use crate::client::TraefikClient;
use crate::error::TraefikResult;
use crate::types::*;

pub struct RouterManager;

impl RouterManager {
    pub async fn list_http(client: &TraefikClient) -> TraefikResult<Vec<TraefikRouter>> {
        client.get("/http/routers").await
    }

    pub async fn get_http(client: &TraefikClient, name: &str) -> TraefikResult<TraefikRouter> {
        client.get(&format!("/http/routers/{}", encode(name))).await
    }

    pub async fn list_tcp(client: &TraefikClient) -> TraefikResult<Vec<TraefikTcpRouter>> {
        client.get("/tcp/routers").await
    }

    pub async fn get_tcp(client: &TraefikClient, name: &str) -> TraefikResult<TraefikTcpRouter> {
        client.get(&format!("/tcp/routers/{}", encode(name))).await
    }

    pub async fn list_udp(client: &TraefikClient) -> TraefikResult<Vec<TraefikUdpRouter>> {
        client.get("/udp/routers").await
    }

    pub async fn get_udp(client: &TraefikClient, name: &str) -> TraefikResult<TraefikUdpRouter> {
        client.get(&format!("/udp/routers/{}", encode(name))).await
    }
}

fn encode(name: &str) -> String {
    name.replace('@', "%40")
}
