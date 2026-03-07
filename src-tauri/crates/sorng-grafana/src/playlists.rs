// ── Grafana playlist management ──────────────────────────────────────────────

use crate::client::GrafanaClient;
use crate::error::{GrafanaError, GrafanaResult};
use crate::types::*;

pub struct PlaylistManager;

impl PlaylistManager {
    pub async fn list_playlists(client: &GrafanaClient) -> GrafanaResult<Vec<Playlist>> {
        let body = client.api_get("/api/playlists").await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("list_playlists: {e}")))
    }

    pub async fn get_playlist(client: &GrafanaClient, uid: &str) -> GrafanaResult<Playlist> {
        let body = client.api_get(&format!("/api/playlists/{uid}")).await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("get_playlist: {e}")))
    }

    pub async fn create_playlist(client: &GrafanaClient, req: &CreatePlaylistRequest) -> GrafanaResult<Playlist> {
        let payload = serde_json::to_string(req).map_err(|e| GrafanaError::parse(e.to_string()))?;
        let body = client.api_post("/api/playlists", &payload).await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("create_playlist: {e}")))
    }

    pub async fn update_playlist(client: &GrafanaClient, uid: &str, req: &UpdatePlaylistRequest) -> GrafanaResult<Playlist> {
        let payload = serde_json::to_string(req).map_err(|e| GrafanaError::parse(e.to_string()))?;
        let body = client.api_put(&format!("/api/playlists/{uid}"), &payload).await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("update_playlist: {e}")))
    }

    pub async fn delete_playlist(client: &GrafanaClient, uid: &str) -> GrafanaResult<()> {
        client.api_delete(&format!("/api/playlists/{uid}")).await?;
        Ok(())
    }

    pub async fn get_playlist_items(client: &GrafanaClient, uid: &str) -> GrafanaResult<Vec<PlaylistItem>> {
        let body = client.api_get(&format!("/api/playlists/{uid}/items")).await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("get_playlist_items: {e}")))
    }

    pub async fn get_playlist_dashboards(client: &GrafanaClient, uid: &str) -> GrafanaResult<Vec<DashboardSearchResult>> {
        let body = client.api_get(&format!("/api/playlists/{uid}/dashboards")).await?;
        serde_json::from_str(&body).map_err(|e| GrafanaError::parse(format!("get_playlist_dashboards: {e}")))
    }

    pub async fn start_playlist(client: &GrafanaClient, uid: &str) -> GrafanaResult<()> {
        client.api_post(&format!("/api/playlists/{uid}/start"), "{}").await?;
        Ok(())
    }

    pub async fn stop_playlist(client: &GrafanaClient, uid: &str) -> GrafanaResult<()> {
        client.api_post(&format!("/api/playlists/{uid}/stop"), "{}").await?;
        Ok(())
    }
}
