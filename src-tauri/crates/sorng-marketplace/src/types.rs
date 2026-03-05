//! Data types, enums, and configuration structs for the marketplace.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ─── ExtensionCategory ──────────────────────────────────────────────

/// Category of a marketplace extension.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ExtensionCategory {
    ConnectionProvider,
    Theme,
    Tool,
    Widget,
    ImportExport,
    AuthProvider,
    NotificationChannel,
    CredentialStore,
    Monitor,
    Automation,
    Integration,
    Security,
    Utility,
    Other,
}

impl ExtensionCategory {
    /// Return all variants in display order.
    pub fn all() -> Vec<ExtensionCategory> {
        vec![
            Self::ConnectionProvider,
            Self::Theme,
            Self::Tool,
            Self::Widget,
            Self::ImportExport,
            Self::AuthProvider,
            Self::NotificationChannel,
            Self::CredentialStore,
            Self::Monitor,
            Self::Automation,
            Self::Integration,
            Self::Security,
            Self::Utility,
            Self::Other,
        ]
    }

    /// Human-readable label.
    pub fn label(&self) -> &'static str {
        match self {
            Self::ConnectionProvider => "Connection Provider",
            Self::Theme => "Theme",
            Self::Tool => "Tool",
            Self::Widget => "Widget",
            Self::ImportExport => "Import / Export",
            Self::AuthProvider => "Auth Provider",
            Self::NotificationChannel => "Notification Channel",
            Self::CredentialStore => "Credential Store",
            Self::Monitor => "Monitor",
            Self::Automation => "Automation",
            Self::Integration => "Integration",
            Self::Security => "Security",
            Self::Utility => "Utility",
            Self::Other => "Other",
        }
    }
}

// ─── RepoType ───────────────────────────────────────────────────────

/// Type of remote repository hosting a marketplace index.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum RepoType {
    GitHub,
    GitLab,
    Gitea,
    BitBucket,
    Custom,
}

// ─── SearchSort ─────────────────────────────────────────────────────

/// Sort order for marketplace search results.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum SearchSort {
    Relevance,
    Downloads,
    Rating,
    RecentlyUpdated,
    Name,
}

// ─── MarketplaceAuthor ──────────────────────────────────────────────

/// Author information embedded in a listing.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketplaceAuthor {
    pub name: String,
    pub email: Option<String>,
    pub url: Option<String>,
    pub github_username: Option<String>,
    pub verified: bool,
}

// ─── DependencySpec ─────────────────────────────────────────────────

/// A dependency on another extension (semver range).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DependencySpec {
    pub extension_id: String,
    /// Semver version requirement, e.g. `">=1.0.0, <2.0.0"`.
    pub version_requirement: String,
    pub optional: bool,
}

// ─── MarketplaceListing ─────────────────────────────────────────────

/// A single extension listed in the marketplace.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketplaceListing {
    pub id: String,
    pub name: String,
    pub display_name: String,
    pub description: String,
    pub long_description: Option<String>,
    pub author: MarketplaceAuthor,
    pub version: String,
    pub repository_url: String,
    pub homepage_url: Option<String>,
    pub license: Option<String>,
    pub tags: Vec<String>,
    pub category: ExtensionCategory,
    pub downloads: u64,
    pub rating: f64,
    pub rating_count: u32,
    pub verified: bool,
    pub featured: bool,
    pub icon_url: Option<String>,
    pub screenshots: Vec<String>,
    pub manifest_url: String,
    pub published_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub compatible_versions: Vec<String>,
    pub dependencies: Vec<DependencySpec>,
    pub permissions_required: Vec<String>,
    pub size_bytes: Option<u64>,
}

// ─── MarketplaceReview ──────────────────────────────────────────────

/// A user review/rating for a listing.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketplaceReview {
    pub id: String,
    pub listing_id: String,
    pub user_name: String,
    /// 1–5 star rating.
    pub rating: u8,
    pub title: Option<String>,
    pub body: Option<String>,
    pub created_at: DateTime<Utc>,
    pub helpful_count: u32,
}

// ─── RepositoryConfig ───────────────────────────────────────────────

/// Configuration for a single remote marketplace repository.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepositoryConfig {
    pub url: String,
    pub repo_type: RepoType,
    pub branch: Option<String>,
    pub index_path: Option<String>,
    pub auth_token: Option<String>,
    pub refresh_interval_hours: u64,
}

// ─── RepositoryIndex ────────────────────────────────────────────────

/// Parsed index from a remote repository.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepositoryIndex {
    pub listings: Vec<MarketplaceListing>,
    pub last_indexed: DateTime<Utc>,
    pub version: String,
}

// ─── InstallResult ──────────────────────────────────────────────────

/// Outcome of an install / update attempt.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstallResult {
    pub listing_id: String,
    pub version: String,
    pub success: bool,
    pub installed_path: Option<String>,
    pub error: Option<String>,
}

// ─── SearchQuery ────────────────────────────────────────────────────

/// Parameters for a marketplace search request.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchQuery {
    pub query: Option<String>,
    pub category: Option<ExtensionCategory>,
    pub tags: Option<Vec<String>>,
    pub author: Option<String>,
    pub sort_by: SearchSort,
    pub verified_only: bool,
    pub min_rating: Option<f64>,
    pub page: u32,
    pub page_size: u32,
}

// ─── SearchResults ──────────────────────────────────────────────────

/// Paginated search results.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResults {
    pub listings: Vec<MarketplaceListing>,
    pub total_count: u64,
    pub page: u32,
    pub page_size: u32,
    pub has_more: bool,
}

// ─── MarketplaceConfig ──────────────────────────────────────────────

/// Top-level marketplace configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketplaceConfig {
    pub repositories: Vec<RepositoryConfig>,
    pub cache_directory: String,
    pub auto_update_extensions: bool,
    pub check_signatures: bool,
    pub allow_unverified: bool,
}

impl Default for MarketplaceConfig {
    fn default() -> Self {
        Self {
            repositories: Vec::new(),
            cache_directory: String::from(".sorng/marketplace-cache"),
            auto_update_extensions: false,
            check_signatures: true,
            allow_unverified: false,
        }
    }
}

// ─── MarketplaceStats ───────────────────────────────────────────────

/// Aggregate statistics about the marketplace state.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketplaceStats {
    pub total_listings: u64,
    pub total_repositories: u64,
    pub installed_count: u64,
    pub update_available_count: u64,
    pub by_category: HashMap<String, u64>,
}

// ─── InstalledExtension ─────────────────────────────────────────────

/// Metadata about a locally installed extension.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledExtension {
    pub listing_id: String,
    pub version: String,
    pub installed_at: DateTime<Utc>,
    pub auto_update: bool,
    pub path: String,
}
