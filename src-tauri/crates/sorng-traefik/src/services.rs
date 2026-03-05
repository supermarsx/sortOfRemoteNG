// ── traefik service management ───────────────────────────────────────────────

use crate::client::TraefikClient;
use crate::error::TraefikResult;
use crate::types::*;

pub struct ServiceManager;

impl ServiceManager {
    pub async fn list_http(client: &TraefikClient) -> TraefikResult<Vec<TraefikService>> {
        client.get("/http/services").await
    }

    pub async fn get_http(client: &TraefikClient, name: &str) -> TraefikResult<TraefikService> {
        client.get(&format!("/http/services/{}", encode(name))).await
    }

    pub async fn list_tcp(client: &TraefikClient) -> TraefikResult<Vec<TraefikTcpService>> {
        client.get("/tcp/services").await
    }

    pub async fn get_tcp(client: &TraefikClient, name: &str) -> TraefikResult<TraefikTcpService> {
        client.get(&format!("/tcp/services/{}", encode(name))).await
    }

    pub async fn list_udp(client: &TraefikClient) -> TraefikResult<Vec<TraefikUdpService>> {
        client.get("/udp/services").await
    }

    pub async fn get_udp(client: &TraefikClient, name: &str) -> TraefikResult<TraefikUdpService> {
        client.get(&format!("/udp/services/{}", encode(name))).await
    }
}

fn encode(name: &str) -> String {
    name.replace('@', "%40")
}
