//! Git/GitHub repository indexing and manifest validation.

use chrono::Utc;
use log::{info, warn};
use reqwest::Client;

use crate::error::MarketplaceError;
use crate::types::*;

const MAX_REPOSITORY_RESPONSE_BODY_BYTES: usize = 8 * 1024 * 1024;

/// Fetch the `index.json` from a remote repository and parse it as a
/// [`RepositoryIndex`].
pub async fn fetch_index(config: &RepositoryConfig) -> Result<RepositoryIndex, MarketplaceError> {
    let index_path = config.index_path.as_deref().unwrap_or("index.json");
    let url = build_raw_url(config, index_path);

    info!("Fetching configured repository index");

    let client = build_client(config.auth_token.as_deref())?;
    let resp = client.get(&url).send().await.map_err(|_| {
        MarketplaceError::NetworkError("Repository index request failed".to_string())
    })?;

    if !resp.status().is_success() {
        return Err(MarketplaceError::NetworkError(format!(
            "Repository index returned HTTP {}",
            resp.status()
        )));
    }

    let body = read_bounded_response_body(resp, "Repository index").await?;
    let index: RepositoryIndex = serde_json::from_slice(&body).map_err(|e| {
        MarketplaceError::IndexParseError(format!(
            "Invalid repository index JSON at line {}, column {}",
            e.line(),
            e.column()
        ))
    })?;

    info!("Fetched configured index with {} listing(s)", index.listings.len());

    Ok(index)
}

/// Query GitHub releases for `owner/repo` and map each release to a
/// [`MarketplaceListing`].
pub async fn fetch_github_releases(
    owner: &str,
    repo: &str,
    token: Option<&str>,
) -> Result<Vec<MarketplaceListing>, MarketplaceError> {
    let url = format!("https://api.github.com/repos/{owner}/{repo}/releases");

    info!("Fetching configured GitHub releases");

    let client = build_client(token)?;
    let resp = client
        .get(&url)
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "sorng-marketplace/0.1")
        .send()
        .await
        .map_err(|_| {
            MarketplaceError::NetworkError("GitHub release request failed".to_string())
        })?;

    if !resp.status().is_success() {
        return Err(MarketplaceError::NetworkError(format!(
            "GitHub API returned HTTP {}",
            resp.status()
        )));
    }

    let body = read_bounded_response_body(resp, "GitHub release").await?;
    let releases: Vec<serde_json::Value> = serde_json::from_slice(&body).map_err(|e| {
        MarketplaceError::NetworkError(format!(
            "GitHub release response contained invalid JSON at line {}, column {}",
            e.line(),
            e.column()
        ))
    })?;
    let now = Utc::now();

    let listings: Vec<MarketplaceListing> = releases
        .into_iter()
        .filter_map(|rel| {
            let tag = rel.get("tag_name")?.as_str()?.to_string();
            let name = rel
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or(&tag)
                .to_string();
            let body = rel
                .get("body")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let html_url = rel.get("html_url")?.as_str()?.to_string();
            let published = rel
                .get("published_at")
                .and_then(|v| v.as_str())
                .and_then(|s| s.parse::<chrono::DateTime<Utc>>().ok())
                .unwrap_or(now);

            let tarball = rel
                .get("tarball_url")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            Some(MarketplaceListing {
                id: format!("{owner}/{repo}@{tag}"),
                name: format!("{owner}-{repo}"),
                display_name: name.clone(),
                description: body.chars().take(200).collect(),
                long_description: if body.len() > 200 { Some(body) } else { None },
                author: MarketplaceAuthor {
                    name: owner.to_string(),
                    email: None,
                    url: Some(format!("https://github.com/{owner}")),
                    github_username: Some(owner.to_string()),
                    verified: false,
                },
                version: tag.clone(),
                repository_url: tarball,
                homepage_url: Some(html_url.clone()),
                license: None,
                tags: Vec::new(),
                category: ExtensionCategory::Other,
                downloads: 0,
                rating: 0.0,
                rating_count: 0,
                verified: false,
                featured: false,
                icon_url: None,
                screenshots: Vec::new(),
                manifest_url: html_url,
                published_at: published,
                updated_at: published,
                compatible_versions: Vec::new(),
                dependencies: Vec::new(),
                permissions_required: Vec::new(),
                size_bytes: None,
                checksum: None,
            })
        })
        .collect();

    info!("Parsed {} listing(s) from GitHub releases", listings.len());
    Ok(listings)
}

/// Refresh all configured repositories and return their indexes.
pub async fn refresh_all_repositories(
    configs: &[RepositoryConfig],
) -> Result<Vec<RepositoryIndex>, MarketplaceError> {
    let mut indexes = Vec::with_capacity(configs.len());

    for cfg in configs {
        match fetch_index(cfg).await {
            Ok(idx) => indexes.push(idx),
            Err(e) => {
                warn!("Failed to fetch configured repository index: {e}");
                // Continue with remaining repositories.
            }
        }
    }

    Ok(indexes)
}

/// Parse and validate a JSON string as a [`MarketplaceListing`].
pub fn validate_manifest(manifest_json: &str) -> Result<MarketplaceListing, MarketplaceError> {
    let listing: MarketplaceListing = serde_json::from_str(manifest_json)
        .map_err(|e| MarketplaceError::ManifestValidationError(e.to_string()))?;

    // Field-level validation.
    if listing.id.is_empty() {
        return Err(MarketplaceError::ManifestValidationError(
            "id must not be empty".into(),
        ));
    }
    if listing.name.is_empty() {
        return Err(MarketplaceError::ManifestValidationError(
            "name must not be empty".into(),
        ));
    }
    if listing.version.is_empty() {
        return Err(MarketplaceError::ManifestValidationError(
            "version must not be empty".into(),
        ));
    }
    if listing.repository_url.is_empty() {
        return Err(MarketplaceError::ManifestValidationError(
            "repository_url must not be empty".into(),
        ));
    }
    if listing.manifest_url.is_empty() {
        return Err(MarketplaceError::ManifestValidationError(
            "manifest_url must not be empty".into(),
        ));
    }
    if listing.author.name.is_empty() {
        return Err(MarketplaceError::ManifestValidationError(
            "author.name must not be empty".into(),
        ));
    }

    Ok(listing)
}

// ── Internal helpers ────────────────────────────────────────────────

/// Build the raw content URL for a repository file.
fn build_raw_url(config: &RepositoryConfig, path: &str) -> String {
    let branch = config.branch.as_deref().unwrap_or("main");
    match config.repo_type {
        RepoType::GitHub => {
            // Convert github.com/owner/repo → raw.githubusercontent.com/…
            let base = config
                .url
                .replace("github.com", "raw.githubusercontent.com");
            format!("{base}/{branch}/{path}")
        }
        RepoType::GitLab => {
            format!("{}/-/raw/{branch}/{path}", config.url)
        }
        RepoType::Gitea => {
            format!("{}/raw/branch/{branch}/{path}", config.url)
        }
        RepoType::BitBucket => {
            format!(
                "{}/raw/{}/{}",
                config
                    .url
                    .replace("bitbucket.org", "api.bitbucket.org/2.0/repositories"),
                branch,
                path
            )
        }
        RepoType::Custom => {
            // Expect the URL to point directly to the directory root.
            format!("{}/{path}", config.url)
        }
    }
}

/// Build a `reqwest::Client`, optionally injecting a bearer token.
fn build_client(token: Option<&str>) -> Result<Client, MarketplaceError> {
    let mut builder = Client::builder()
        .user_agent("sorng-marketplace/0.1")
        .redirect(reqwest::redirect::Policy::none());
    if let Some(tok) = token {
        use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION};
        let mut headers = HeaderMap::new();
        let val = HeaderValue::from_str(&format!("Bearer {tok}")).map_err(|_| {
            MarketplaceError::NetworkError(
                "Invalid marketplace authorization token".to_string(),
            )
        })?;
        headers.insert(AUTHORIZATION, val);
        builder = builder.default_headers(headers);
    }
    builder
        .build()
        .map_err(|_| MarketplaceError::NetworkError("Failed to build HTTP client".to_string()))
}

async fn read_bounded_response_body(
    mut response: reqwest::Response,
    operation: &str,
) -> Result<Vec<u8>, MarketplaceError> {
    if response
        .content_length()
        .is_some_and(|length| length > MAX_REPOSITORY_RESPONSE_BODY_BYTES as u64)
    {
        return Err(MarketplaceError::NetworkError(format!(
            "{operation} response exceeds {MAX_REPOSITORY_RESPONSE_BODY_BYTES} byte limit"
        )));
    }

    let capacity = response
        .content_length()
        .unwrap_or(0)
        .min(MAX_REPOSITORY_RESPONSE_BODY_BYTES as u64) as usize;
    let mut body = Vec::with_capacity(capacity);
    while let Some(chunk) = response.chunk().await.map_err(|_| {
        MarketplaceError::NetworkError(format!("Failed to read {operation} response"))
    })? {
        let remaining =
            (MAX_REPOSITORY_RESPONSE_BODY_BYTES + 1).saturating_sub(body.len());
        body.extend_from_slice(&chunk[..chunk.len().min(remaining)]);
        if body.len() > MAX_REPOSITORY_RESPONSE_BODY_BYTES {
            return Err(MarketplaceError::NetworkError(format!(
                "{operation} response exceeds {MAX_REPOSITORY_RESPONSE_BODY_BYTES} byte limit"
            )));
        }
    }

    Ok(body)
}
