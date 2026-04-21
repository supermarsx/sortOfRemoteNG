//! Update checking via the GitHub Releases API.

use chrono::Utc;
use log::{debug, info, warn};

use crate::channels::{filter_releases_by_channel, get_update_url, GitHubAsset, GitHubRelease};
use crate::error::UpdateError;
use crate::types::*;
use crate::version;

/// Checks for new releases on GitHub and performs version comparison.
pub struct UpdateChecker {
    client: reqwest::Client,
}

impl Default for UpdateChecker {
    fn default() -> Self {
        Self::new()
    }
}

impl UpdateChecker {
    /// Create a new `UpdateChecker` with a default HTTP client.
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .user_agent("SortOfRemoteNG-Updater/0.1")
            .build()
            .unwrap_or_default();
        Self { client }
    }

    /// Create with a custom `reqwest::Client`.
    pub fn with_client(client: reqwest::Client) -> Self {
        Self { client }
    }

    /// Check for available updates.
    ///
    /// 1. Fetches releases from GitHub.
    /// 2. Filters by channel.
    /// 3. Compares the latest matching release against `current_version`.
    /// 4. Returns the appropriate [`UpdateStatus`].
    pub async fn check_for_updates(
        &self,
        config: &UpdateConfig,
        current_version: &str,
    ) -> Result<UpdateStatus, UpdateError> {
        info!(
            "checking for updates (current: {current_version}, channel: {})",
            config.channel
        );

        let current = version::parse(current_version)?;

        let release = match self.get_latest_release(config).await {
            Ok(r) => r,
            Err(UpdateError::NoUpdateAvailable) => {
                debug!("no matching release found");
                return Ok(UpdateStatus::UpToDate);
            }
            Err(e) => return Err(e),
        };

        let candidate = version::parse(&release.tag_name)?;

        if version::is_newer(&candidate, &current) {
            let info = self.parse_release_to_update_info(&release, config)?;
            info!("update available: {} → {}", current_version, info.version);
            Ok(UpdateStatus::UpdateAvailable { info })
        } else {
            debug!("current version is up to date");
            Ok(UpdateStatus::UpToDate)
        }
    }

    /// Fetch the latest release that matches the configured channel.
    ///
    /// For the **Stable** channel (with `pre_release == false`) the
    /// `/releases/latest` endpoint is used directly. For all other
    /// channels the full list is fetched and filtered.
    pub async fn get_latest_release(
        &self,
        config: &UpdateConfig,
    ) -> Result<GitHubRelease, UpdateError> {
        let url = get_update_url(config);
        debug!("fetching releases from {url}");

        let response = self
            .client
            .get(&url)
            .header("Accept", "application/vnd.github+json")
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(UpdateError::InvalidResponse(format!(
                "GitHub API returned {status}: {body}"
            )));
        }

        // If the URL ends with /latest the response is a single release object.
        if url.ends_with("/latest") {
            let release: GitHubRelease = response.json().await?;
            return Ok(release);
        }

        // Otherwise parse the array and filter by channel.
        let releases: Vec<GitHubRelease> = response.json().await?;

        if releases.is_empty() {
            return Err(UpdateError::NoUpdateAvailable);
        }

        let filtered = filter_releases_by_channel(&releases, &config.channel);

        if filtered.is_empty() {
            return Err(UpdateError::NoUpdateAvailable);
        }

        // Find the newest release by semantic version.
        let mut best: &GitHubRelease = filtered[0];
        let mut best_ver =
            version::parse(&best.tag_name).unwrap_or_else(|_| version::SemVer::new(0, 0, 0));

        for rel in &filtered[1..] {
            if let Ok(v) = version::parse(&rel.tag_name) {
                if v > best_ver {
                    best = rel;
                    best_ver = v;
                }
            }
        }

        Ok(best.clone())
    }

    /// Convert a [`GitHubRelease`] into the crate-internal [`UpdateInfo`]
    /// structure.
    pub fn parse_release_to_update_info(
        &self,
        release: &GitHubRelease,
        config: &UpdateConfig,
    ) -> Result<UpdateInfo, UpdateError> {
        let release_date = release
            .published_at
            .as_deref()
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|dt| dt.with_timezone(&Utc))
            .unwrap_or_else(Utc::now);

        let release_notes = release.body.clone().unwrap_or_default();

        // Determine the platform-specific primary download asset.
        let platform_asset = select_platform_asset(&release.assets);

        let (download_url, download_size, checksum_sha256) = match platform_asset {
            Some(asset) => (
                asset.browser_download_url.clone(),
                asset.size,
                String::new(), // checksum may be in a companion .sha256 asset
            ),
            None if !release.assets.is_empty() => (
                release.assets[0].browser_download_url.clone(),
                release.assets[0].size,
                String::new(),
            ),
            None => {
                warn!("release {} has no downloadable assets", release.tag_name);
                (String::new(), 0, String::new())
            }
        };

        // Look for a .sha256 companion to fill the checksum.
        let checksum = if checksum_sha256.is_empty() {
            find_checksum_asset(&release.assets).unwrap_or_default()
        } else {
            checksum_sha256
        };

        // Look for a .sig companion to fill the signature.
        let signature = find_signature_asset(&release.assets);

        // Convert assets.
        let assets: Vec<UpdateAsset> = release
            .assets
            .iter()
            .map(|a| UpdateAsset {
                name: a.name.clone(),
                url: a.browser_download_url.clone(),
                size: a.size,
                content_type: a.content_type.clone(),
                os: detect_os_from_name(&a.name),
                arch: detect_arch_from_name(&a.name),
            })
            .collect();

        // Detect if the release notes contain a mandatory marker.
        let mandatory = release_notes.to_lowercase().contains("[mandatory]");

        // Detect min_version from release notes (pattern: `min_version: X.Y.Z`).
        let min_version = extract_min_version(&release_notes);

        Ok(UpdateInfo {
            version: release.tag_name.clone(),
            channel: config.channel.clone(),
            release_date,
            release_notes,
            download_url,
            download_size,
            checksum_sha256: checksum,
            signature,
            mandatory,
            min_version,
            assets,
        })
    }
}

// ─── Helpers ────────────────────────────────────────────────────────

/// Choose the best asset for the current platform.
fn select_platform_asset(assets: &[GitHubAsset]) -> Option<&GitHubAsset> {
    let os_keywords = if cfg!(target_os = "windows") {
        &["windows", "win64", "win", ".msi", ".exe"][..]
    } else if cfg!(target_os = "macos") {
        &["macos", "darwin", ".dmg", ".app"][..]
    } else {
        &["linux", ".appimage", ".deb", ".tar.gz"][..]
    };

    let arch_keywords = if cfg!(target_arch = "x86_64") {
        &["x86_64", "amd64", "x64"][..]
    } else if cfg!(target_arch = "aarch64") {
        &["aarch64", "arm64"][..]
    } else {
        &[][..]
    };

    // First try to find an asset matching both OS and arch.
    for asset in assets {
        let name_lower = asset.name.to_lowercase();
        let matches_os = os_keywords.iter().any(|k| name_lower.contains(k));
        let matches_arch =
            arch_keywords.is_empty() || arch_keywords.iter().any(|k| name_lower.contains(k));
        if matches_os && matches_arch {
            return Some(asset);
        }
    }

    // Fallback: match just OS.
    for asset in assets {
        let name_lower = asset.name.to_lowercase();
        if os_keywords.iter().any(|k| name_lower.contains(k)) {
            return Some(asset);
        }
    }

    None
}

/// Look for a `.sha256` companion asset and return its download URL as
/// a stand-in for the checksum value.
fn find_checksum_asset(assets: &[GitHubAsset]) -> Option<String> {
    assets
        .iter()
        .find(|a| a.name.ends_with(".sha256") || a.name.ends_with(".sha256sum"))
        .map(|a| a.browser_download_url.clone())
}

/// Look for a `.sig` or `.asc` signature companion.
fn find_signature_asset(assets: &[GitHubAsset]) -> Option<String> {
    assets
        .iter()
        .find(|a| a.name.ends_with(".sig") || a.name.ends_with(".asc"))
        .map(|a| a.browser_download_url.clone())
}

/// Heuristic OS detection from asset filename.
fn detect_os_from_name(name: &str) -> Option<String> {
    let n = name.to_lowercase();
    if n.contains("windows") || n.contains("win") || n.ends_with(".msi") || n.ends_with(".exe") {
        Some("windows".into())
    } else if n.contains("macos") || n.contains("darwin") || n.ends_with(".dmg") {
        Some("macos".into())
    } else if n.contains("linux") || n.ends_with(".appimage") || n.ends_with(".deb") {
        Some("linux".into())
    } else {
        None
    }
}

/// Heuristic arch detection from asset filename.
fn detect_arch_from_name(name: &str) -> Option<String> {
    let n = name.to_lowercase();
    if n.contains("x86_64") || n.contains("amd64") || n.contains("x64") {
        Some("x86_64".into())
    } else if n.contains("aarch64") || n.contains("arm64") {
        Some("aarch64".into())
    } else if n.contains("i686") || n.contains("x86") {
        Some("x86".into())
    } else {
        None
    }
}

/// Extract a `min_version: X.Y.Z` directive from release notes.
fn extract_min_version(notes: &str) -> Option<String> {
    for line in notes.lines() {
        let trimmed = line.trim().to_lowercase();
        if let Some(rest) = trimmed.strip_prefix("min_version:") {
            let ver = rest.trim();
            if !ver.is_empty() {
                return Some(ver.to_string());
            }
        }
    }
    None
}
