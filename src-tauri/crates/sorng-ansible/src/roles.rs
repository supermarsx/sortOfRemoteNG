// ── sorng-ansible/src/roles.rs ───────────────────────────────────────────────
//! Role scaffolding, listing, inspection, and dependency resolution.

use std::path::{Path, PathBuf};

use log::debug;

use crate::client::AnsibleClient;
use crate::error::{AnsibleError, AnsibleResult};
use crate::types::*;

/// Role management operations.
pub struct RoleManager;

impl RoleManager {
    // ── Listing ──────────────────────────────────────────────────────

    /// List roles in the configured roles path(s).
    pub async fn list(roles_path: &str) -> AnsibleResult<Vec<Role>> {
        let path = Path::new(roles_path);
        if !path.exists() {
            return Ok(Vec::new());
        }

        let mut roles = Vec::new();
        let mut entries = tokio::fs::read_dir(roles_path)
            .await
            .map_err(|e| AnsibleError::io(format!("Cannot list roles in {}: {}", roles_path, e)))?;

        while let Some(entry) = entries.next_entry().await? {
            let entry_path = entry.path();
            if entry_path.is_dir() {
                if let Ok(role) = Self::inspect_role(&entry_path).await {
                    roles.push(role);
                }
            }
        }

        roles.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(roles)
    }

    /// Inspect a single role directory.
    pub async fn inspect_role(role_path: &Path) -> AnsibleResult<Role> {
        let name = role_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        let structure = RoleStructure {
            has_tasks: role_path.join("tasks").exists(),
            has_handlers: role_path.join("handlers").exists(),
            has_defaults: role_path.join("defaults").exists(),
            has_vars: role_path.join("vars").exists(),
            has_files: role_path.join("files").exists(),
            has_templates: role_path.join("templates").exists(),
            has_meta: role_path.join("meta").exists(),
            has_tests: role_path.join("tests").exists(),
            has_readme: role_path.join("README.md").exists()
                || role_path.join("readme.md").exists(),
        };

        let (galaxy_info, dependencies) = Self::parse_meta(role_path).await;

        Ok(Role {
            name: name.clone(),
            path: role_path.to_string_lossy().to_string(),
            namespace: galaxy_info.as_ref().and_then(|g| g.namespace.clone()),
            version: None,
            description: galaxy_info.as_ref().and_then(|g| g.description.clone()),
            author: galaxy_info.as_ref().and_then(|g| g.author.clone()),
            license: galaxy_info.as_ref().and_then(|g| g.license.clone()),
            min_ansible_version: galaxy_info
                .as_ref()
                .and_then(|g| g.min_ansible_version.clone()),
            platforms: galaxy_info
                .as_ref()
                .map(|g| g.platforms.clone())
                .unwrap_or_default(),
            dependencies,
            galaxy_info,
            structure,
        })
    }

    // ── Scaffolding ──────────────────────────────────────────────────

    /// Initialize a new role using `ansible-galaxy role init`.
    pub async fn init(client: &AnsibleClient, options: &RoleInitOptions) -> AnsibleResult<Role> {
        let mut args = vec!["role".to_string(), "init".to_string()];

        if let Some(ref path) = options.path {
            args.push("--init-path".to_string());
            args.push(path.clone());
        }

        if options.offline {
            args.push("--offline".to_string());
        }

        let role_type = match options.init_type {
            RoleInitType::Container => "container",
            RoleInitType::Network => "network",
            RoleInitType::Apb => "apb",
            RoleInitType::Default => "default",
        };
        args.push("--type".to_string());
        args.push(role_type.to_string());

        args.push(options.name.clone());

        let output = client
            .run_raw(
                &client.galaxy_bin,
                &args.iter().map(|s| s.as_str()).collect::<Vec<_>>(),
            )
            .await?;

        if output.exit_code != 0 {
            return Err(AnsibleError::role(format!(
                "ansible-galaxy role init failed: {}",
                output.stderr
            )));
        }

        debug!(
            "Initialized role '{}': {}",
            options.name,
            output.stdout.trim()
        );

        let base = options.path.clone().unwrap_or_else(|| ".".to_string());
        let role_path = PathBuf::from(&base).join(&options.name);
        Self::inspect_role(&role_path).await
    }

    // ── Dependency resolution ────────────────────────────────────────

    /// Read and resolve all role dependencies (from meta/main.yml).
    pub async fn resolve_dependencies(
        roles_path: &str,
        role_name: &str,
    ) -> AnsibleResult<Vec<RoleDependency>> {
        let role_dir = Path::new(roles_path).join(role_name);
        let (_galaxy, deps) = Self::parse_meta(&role_dir).await;
        Ok(deps)
    }

    /// Install role dependencies via `ansible-galaxy role install`.
    pub async fn install_dependencies(
        client: &AnsibleClient,
        role_path: &str,
    ) -> AnsibleResult<String> {
        let meta_path = Path::new(role_path).join("meta").join("main.yml");
        if !meta_path.exists() {
            return Err(AnsibleError::role("meta/main.yml not found"));
        }

        let output = client
            .run_raw(
                &client.galaxy_bin,
                &[
                    "role",
                    "install",
                    "-r",
                    &meta_path.to_string_lossy(),
                    "--force",
                ],
            )
            .await?;

        if output.exit_code != 0 {
            return Err(AnsibleError::galaxy(format!(
                "Failed to install role dependencies: {}",
                output.stderr
            )));
        }

        Ok(output.stdout)
    }

    // ── Internal helpers ─────────────────────────────────────────────

    async fn parse_meta(role_path: &Path) -> (Option<GalaxyRoleMeta>, Vec<RoleDependency>) {
        let meta_path = role_path.join("meta").join("main.yml");
        if !meta_path.exists() {
            let meta_yaml = role_path.join("meta").join("main.yaml");
            if !meta_yaml.exists() {
                return (None, Vec::new());
            }
            return Self::parse_meta_file(&meta_yaml).await;
        }
        Self::parse_meta_file(&meta_path).await
    }

    async fn parse_meta_file(path: &Path) -> (Option<GalaxyRoleMeta>, Vec<RoleDependency>) {
        let content = match tokio::fs::read_to_string(path).await {
            Ok(c) => c,
            Err(_) => return (None, Vec::new()),
        };

        let doc: serde_yaml::Value = match serde_yaml::from_str(&content) {
            Ok(d) => d,
            Err(_) => return (None, Vec::new()),
        };

        let mapping = match doc.as_mapping() {
            Some(m) => m,
            None => return (None, Vec::new()),
        };

        // galaxy_info section
        let galaxy_info = mapping
            .get(serde_yaml::Value::String("galaxy_info".into()))
            .and_then(|v| {
                let gi = v.as_mapping()?;
                let get_str = |key: &str| -> Option<String> {
                    gi.get(serde_yaml::Value::String(key.into()))
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string())
                };

                Some(GalaxyRoleMeta {
                    role_name: get_str("role_name"),
                    namespace: get_str("namespace"),
                    description: get_str("description"),
                    author: get_str("author"),
                    license: get_str("license"),
                    min_ansible_version: get_str("min_ansible_version"),
                    platforms: Vec::new(),
                    galaxy_tags: Vec::new(),
                    dependencies: Vec::new(),
                })
            });

        // dependencies section
        let dependencies = mapping
            .get(serde_yaml::Value::String("dependencies".into()))
            .and_then(|v| v.as_sequence())
            .map(|deps| {
                deps.iter()
                    .filter_map(|d| {
                        if let Some(s) = d.as_str() {
                            Some(RoleDependency {
                                role: s.to_string(),
                                version: None,
                                source: None,
                            })
                        } else if let Some(m) = d.as_mapping() {
                            let role = m
                                .get(serde_yaml::Value::String("role".into()))
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string())?;
                            let version = m
                                .get(serde_yaml::Value::String("version".into()))
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string());
                            Some(RoleDependency {
                                role,
                                version,
                                source: None,
                            })
                        } else {
                            None
                        }
                    })
                    .collect()
            })
            .unwrap_or_default();

        (galaxy_info, dependencies)
    }
}
