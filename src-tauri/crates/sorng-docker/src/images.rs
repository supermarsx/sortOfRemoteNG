// ── sorng-docker/src/images.rs ────────────────────────────────────────────────
//! Docker image management.

use crate::client::DockerClient;
use crate::error::DockerResult;
use crate::types::*;

pub struct ImageManager;

impl ImageManager {
    /// List images.
    pub async fn list(client: &DockerClient, opts: &ListImagesOptions) -> DockerResult<Vec<ImageSummary>> {
        let mut q = Vec::new();
        if opts.all.unwrap_or(false) { q.push(("all", "true".to_string())); }
        if opts.digests.unwrap_or(false) { q.push(("digests", "true".to_string())); }
        if let Some(ref f) = opts.filters {
            q.push(("filters", serde_json::to_string(f).unwrap_or_default()));
        }
        let path = if q.is_empty() {
            "/images/json".to_string()
        } else {
            let qs: Vec<String> = q.iter().map(|(k, v)| format!("{}={}", k, v)).collect();
            format!("/images/json?{}", qs.join("&"))
        };
        client.get(&path).await
    }

    /// Inspect an image.
    pub async fn inspect(client: &DockerClient, name: &str) -> DockerResult<ImageInspect> {
        client.get(&format!("/images/{}/json", name)).await
    }

    /// Get image history.
    pub async fn history(client: &DockerClient, name: &str) -> DockerResult<Vec<ImageHistoryEntry>> {
        client.get(&format!("/images/{}/history", name)).await
    }

    /// Pull an image. Returns the final status text.
    pub async fn pull(client: &DockerClient, image: &str, tag: Option<&str>) -> DockerResult<String> {
        let t = tag.unwrap_or("latest");
        let path = format!("/images/create?fromImage={}&tag={}", image, t);
        client.post_text(&path).await
    }

    /// Tag an image.
    pub async fn tag(client: &DockerClient, source: &str, repo: &str, tag: &str) -> DockerResult<()> {
        let path = format!("/images/{}/tag?repo={}&tag={}", source, repo, tag);
        client.post_empty(&path).await
    }

    /// Push an image to a registry.
    pub async fn push(client: &DockerClient, name: &str, tag: Option<&str>) -> DockerResult<String> {
        let path = if let Some(t) = tag {
            format!("/images/{}/push?tag={}", name, t)
        } else {
            format!("/images/{}/push", name)
        };
        client.post_text(&path).await
    }

    /// Remove an image.
    pub async fn remove(client: &DockerClient, name: &str, force: bool, no_prune: bool) -> DockerResult<()> {
        let mut q = Vec::new();
        if force { q.push(("force", "true")); }
        if no_prune { q.push(("noprune", "true")); }
        if q.is_empty() {
            client.delete(&format!("/images/{}", name)).await
        } else {
            let qs: Vec<String> = q.iter().map(|(k, v)| format!("{}={}", k, v)).collect();
            client.delete(&format!("/images/{}?{}", name, qs.join("&"))).await
        }
    }

    /// Search Docker Hub.
    pub async fn search(client: &DockerClient, term: &str, limit: Option<i32>) -> DockerResult<Vec<RegistrySearchResult>> {
        let path = if let Some(l) = limit {
            format!("/images/search?term={}&limit={}", term, l)
        } else {
            format!("/images/search?term={}", term)
        };
        client.get(&path).await
    }

    /// Prune unused images.
    pub async fn prune(client: &DockerClient, dangling_only: bool) -> DockerResult<PruneResult> {
        let path = if dangling_only {
            "/images/prune?filters=%7B%22dangling%22%3A%5B%22true%22%5D%7D".to_string()
        } else {
            "/images/prune".to_string()
        };
        let resp: serde_json::Value = client.post_json(&path, &serde_json::json!({})).await?;
        let deleted = resp.get("ImagesDeleted")
            .and_then(|v| v.as_array())
            .map(|a| {
                a.iter().filter_map(|v| {
                    v.get("Deleted").or(v.get("Untagged"))
                        .and_then(|s| s.as_str()).map(String::from)
                }).collect()
            })
            .unwrap_or_default();
        let space = resp.get("SpaceReclaimed").and_then(|v| v.as_i64()).unwrap_or(0);
        Ok(PruneResult { deleted_items: deleted, space_reclaimed: space })
    }

    /// Create an image from a container (commit).
    pub async fn commit(
        client: &DockerClient,
        container_id: &str,
        repo: &str,
        tag: &str,
        comment: Option<&str>,
        author: Option<&str>,
    ) -> DockerResult<serde_json::Value> {
        let mut path = format!("/commit?container={}&repo={}&tag={}", container_id, repo, tag);
        if let Some(c) = comment { path.push_str(&format!("&comment={}", c)); }
        if let Some(a) = author { path.push_str(&format!("&author={}", a)); }
        client.post_json(&path, &serde_json::json!({})).await
    }
}
