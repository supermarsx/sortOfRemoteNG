//! Update channel management and GitHub release filtering.

use serde::{Deserialize, Serialize};

use crate::types::{UpdateChannel, UpdateConfig};

// ─── GitHub API types ───────────────────────────────────────────────

/// A release as returned by the GitHub Releases API.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubRelease {
    pub tag_name: String,
    pub name: Option<String>,
    pub body: Option<String>,
    pub draft: bool,
    pub prerelease: bool,
    pub published_at: Option<String>,
    pub assets: Vec<GitHubAsset>,
}

/// An asset attached to a GitHub release.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubAsset {
    pub name: String,
    pub browser_download_url: String,
    pub size: u64,
    pub content_type: String,
}

// ─── ChannelManager ─────────────────────────────────────────────────

/// Manages channel-specific logic for update resolution.
pub struct ChannelManager {
    pub config: UpdateConfig,
}

impl ChannelManager {
    /// Create a new `ChannelManager` for the given configuration.
    pub fn new(config: UpdateConfig) -> Self {
        Self { config }
    }

    /// Return the GitHub Releases API URL based on the config.
    ///
    /// For stable releases only the latest release endpoint is used;
    /// for other channels the full list endpoint is used so that
    /// pre-releases and tagged releases can be filtered.
    pub fn get_update_url(&self) -> String {
        get_update_url(&self.config)
    }

    /// Filter a set of releases to those matching the configured channel.
    pub fn filter_releases<'a>(
        &self,
        releases: &'a [GitHubRelease],
    ) -> Vec<&'a GitHubRelease> {
        filter_releases_by_channel(releases, &self.config.channel)
    }
}

/// Construct the GitHub API URL for fetching releases.
///
/// * **Stable** channel (and `pre_release == false`): uses
///   `/repos/{owner}/{repo}/releases/latest`.
/// * **Beta / Nightly / Custom** (or `pre_release == true`): uses
///   `/repos/{owner}/{repo}/releases` to get all releases.
/// * If `custom_update_url` is set it takes precedence.
pub fn get_update_url(config: &UpdateConfig) -> String {
    if let Some(ref custom) = config.custom_update_url {
        return custom.clone();
    }

    let base = format!(
        "https://api.github.com/repos/{}/{}/releases",
        config.github_owner, config.github_repo,
    );

    match config.channel {
        UpdateChannel::Stable if !config.pre_release => format!("{base}/latest"),
        _ => base,
    }
}

/// Filter a slice of [`GitHubRelease`] entries to only those matching
/// the requested [`UpdateChannel`].
///
/// * **Stable**: non-draft, non-prerelease releases.
/// * **Beta**: pre-releases whose tag contains "beta" or "rc".
/// * **Nightly**: pre-releases whose tag contains "nightly".
/// * **Custom { name }**: pre-releases whose tag contains the custom name.
pub fn filter_releases_by_channel<'a>(
    releases: &'a [GitHubRelease],
    channel: &UpdateChannel,
) -> Vec<&'a GitHubRelease> {
    releases
        .iter()
        .filter(|r| !r.draft)
        .filter(|r| match channel {
            UpdateChannel::Stable => !r.prerelease,
            UpdateChannel::Beta => {
                r.prerelease && {
                    let tag = r.tag_name.to_lowercase();
                    tag.contains("beta") || tag.contains("rc")
                }
            }
            UpdateChannel::Nightly => {
                r.prerelease && r.tag_name.to_lowercase().contains("nightly")
            }
            UpdateChannel::Custom { name } => {
                r.prerelease && r.tag_name.to_lowercase().contains(&name.to_lowercase())
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_release(tag: &str, prerelease: bool, draft: bool) -> GitHubRelease {
        GitHubRelease {
            tag_name: tag.to_string(),
            name: Some(tag.to_string()),
            body: None,
            draft,
            prerelease,
            published_at: None,
            assets: vec![],
        }
    }

    #[test]
    fn url_stable_uses_latest() {
        let cfg = UpdateConfig {
            github_owner: "org".into(),
            github_repo: "app".into(),
            channel: UpdateChannel::Stable,
            pre_release: false,
            ..UpdateConfig::default()
        };
        let url = get_update_url(&cfg);
        assert_eq!(url, "https://api.github.com/repos/org/app/releases/latest");
    }

    #[test]
    fn url_beta_uses_releases_list() {
        let cfg = UpdateConfig {
            github_owner: "org".into(),
            github_repo: "app".into(),
            channel: UpdateChannel::Beta,
            ..UpdateConfig::default()
        };
        let url = get_update_url(&cfg);
        assert_eq!(url, "https://api.github.com/repos/org/app/releases");
    }

    #[test]
    fn url_custom_takes_precedence() {
        let cfg = UpdateConfig {
            custom_update_url: Some("https://my.server/updates".into()),
            ..UpdateConfig::default()
        };
        let url = get_update_url(&cfg);
        assert_eq!(url, "https://my.server/updates");
    }

    #[test]
    fn filter_stable_excludes_prereleases() {
        let releases = vec![
            make_release("v1.0.0", false, false),
            make_release("v1.1.0-beta.1", true, false),
            make_release("v2.0.0-nightly.1", true, false),
        ];
        let filtered = filter_releases_by_channel(&releases, &UpdateChannel::Stable);
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].tag_name, "v1.0.0");
    }

    #[test]
    fn filter_beta_includes_beta_and_rc() {
        let releases = vec![
            make_release("v1.0.0", false, false),
            make_release("v1.1.0-beta.1", true, false),
            make_release("v1.1.0-rc.1", true, false),
            make_release("v2.0.0-nightly.1", true, false),
        ];
        let filtered = filter_releases_by_channel(&releases, &UpdateChannel::Beta);
        assert_eq!(filtered.len(), 2);
    }

    #[test]
    fn filter_nightly() {
        let releases = vec![
            make_release("v1.0.0", false, false),
            make_release("v1.1.0-beta.1", true, false),
            make_release("v2.0.0-nightly.20260301", true, false),
        ];
        let filtered = filter_releases_by_channel(&releases, &UpdateChannel::Nightly);
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].tag_name, "v2.0.0-nightly.20260301");
    }

    #[test]
    fn filter_excludes_drafts() {
        let releases = vec![
            make_release("v1.0.0", false, true),
            make_release("v1.1.0", false, false),
        ];
        let filtered = filter_releases_by_channel(&releases, &UpdateChannel::Stable);
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].tag_name, "v1.1.0");
    }

    #[test]
    fn filter_custom_channel() {
        let releases = vec![
            make_release("v1.0.0-canary.1", true, false),
            make_release("v1.0.0-beta.1", true, false),
        ];
        let filtered = filter_releases_by_channel(
            &releases,
            &UpdateChannel::Custom {
                name: "canary".into(),
            },
        );
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].tag_name, "v1.0.0-canary.1");
    }
}
