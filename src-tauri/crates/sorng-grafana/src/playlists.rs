// ── sorng-grafana/src/playlists.rs ───────────────────────────────────────────
//! Playlist management via Grafana REST API.

use crate::client::GrafanaClient;
use crate::error::GrafanaResult;
use crate::types::*;

pub struct PlaylistManager;

impl PlaylistManager {
    /// List all playlists.  GET /api/playlists
    pub async fn list(client: &GrafanaClient) -> GrafanaResult<Vec<Playlist>> {
        client.api_get("playlists").await
    }

    /// Get playlist by ID.  GET /api/playlists/:id
    pub async fn get(client: &GrafanaClient, id: u64) -> GrafanaResult<Playlist> {
        client.api_get(&format!("playlists/{id}")).await
    }

    /// Create a playlist.  POST /api/playlists
    pub async fn create(
        client: &GrafanaClient,
        name: &str,
        interval: &str,
        items: &[PlaylistItem],
    ) -> GrafanaResult<Playlist> {
        let body = serde_json::json!({
            "name": name,
            "interval": interval,
            "items": items,
        });
        client.api_post("playlists", &body).await
    }

    /// Update a playlist.  PUT /api/playlists/:id
    pub async fn update(
        client: &GrafanaClient,
        id: u64,
        name: &str,
        interval: &str,
        items: &[PlaylistItem],
    ) -> GrafanaResult<Playlist> {
        let body = serde_json::json!({
            "name": name,
            "interval": interval,
            "items": items,
        });
        client.api_put(&format!("playlists/{id}"), &body).await
    }

    /// Delete a playlist.  DELETE /api/playlists/:id
    pub async fn delete(client: &GrafanaClient, id: u64) -> GrafanaResult<serde_json::Value> {
        client.api_delete(&format!("playlists/{id}")).await
    }

    /// Get playlist items.  GET /api/playlists/:id/items
    pub async fn get_items(client: &GrafanaClient, id: u64) -> GrafanaResult<Vec<PlaylistItem>> {
        client.api_get(&format!("playlists/{id}/items")).await
    }

    /// Get playlist dashboards.  GET /api/playlists/:id/dashboards
    pub async fn get_dashboards(client: &GrafanaClient, id: u64) -> GrafanaResult<Vec<Dashboard>> {
        client.api_get(&format!("playlists/{id}/dashboards")).await
    }
}
