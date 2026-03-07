use serde::{Deserialize, Serialize};

/// Application metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub identifier: String,
    pub description: String,
    pub copyright: String,
    pub license: String,
    pub homepage: String,
    pub repository: String,
    pub authors: Vec<String>,
    pub build_info: BuildInfo,
}

/// Build-time information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BuildInfo {
    pub rust_version: String,
    pub target: String,
    pub profile: String,
    pub timestamp: String,
}

/// A single dependency entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DependencyInfo {
    pub name: String,
    pub version: String,
    pub license: String,
    pub authors: Vec<String>,
    pub repository: String,
    pub description: String,
    pub category: String,
}

/// License text with metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LicenseEntry {
    pub identifier: String,
    pub name: String,
    pub text: String,
    pub url: String,
    pub osi_approved: bool,
}

/// A workspace crate entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceCrateInfo {
    pub name: String,
    pub description: String,
    pub category: String,
    pub command_count: u32,
}

/// Summary of all licenses used
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LicenseSummary {
    pub total_rust_deps: u32,
    pub total_js_deps: u32,
    pub total_workspace_crates: u32,
    pub license_distribution: Vec<LicenseCount>,
}

/// Count of dependencies per license
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LicenseCount {
    pub license: String,
    pub count: u32,
}

/// Full about response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AboutResponse {
    pub app: AppInfo,
    pub summary: LicenseSummary,
}

/// Category of dependencies
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DependencyCategory {
    pub name: String,
    pub description: String,
    pub dependencies: Vec<DependencyInfo>,
}

/// Acknowledgments entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Acknowledgment {
    pub name: String,
    pub role: String,
    pub url: String,
}

/// Complete credits response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreditsResponse {
    pub project_authors: Vec<String>,
    pub acknowledgments: Vec<Acknowledgment>,
    pub special_thanks: Vec<String>,
}
