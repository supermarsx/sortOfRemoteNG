// ── sorng-ansible/src/galaxy.rs ──────────────────────────────────────────────
//! Ansible Galaxy role & collection management — install, list, search, remove.

use log::debug;
use regex::Regex;

use crate::client::AnsibleClient;
use crate::error::{AnsibleError, AnsibleResult};
use crate::types::*;

/// Galaxy management operations.
pub struct GalaxyManager;

impl GalaxyManager {
    // ── Roles ────────────────────────────────────────────────────────

    /// Install a role from Galaxy.
    pub async fn install_role(
        client: &AnsibleClient,
        options: &GalaxyInstallOptions,
    ) -> AnsibleResult<String> {
        let mut args = vec!["role".to_string(), "install".to_string()];

        if let Some(ref rp) = options.roles_path {
            args.push("--roles-path".to_string());
            args.push(rp.clone());
        }

        if options.force {
            args.push("--force".to_string());
        }

        if options.no_deps {
            args.push("--no-deps".to_string());
        }

        if let Some(ref req) = options.requirements_file {
            args.push("-r".to_string());
            args.push(req.clone());
        } else {
            let name_with_version = if let Some(ref v) = options.version {
                format!("{},{}", options.name, v)
            } else {
                options.name.clone()
            };
            args.push(name_with_version);
        }

        let output = client
            .run_raw(
                &client.galaxy_bin,
                &args.iter().map(|s| s.as_str()).collect::<Vec<_>>(),
            )
            .await?;

        if output.exit_code != 0 {
            return Err(AnsibleError::galaxy(format!(
                "ansible-galaxy role install failed: {}",
                output.stderr
            )));
        }

        debug!("Installed role: {}", options.name);
        Ok(output.stdout)
    }

    /// List installed roles.
    pub async fn list_roles(
        client: &AnsibleClient,
        roles_path: Option<&str>,
    ) -> AnsibleResult<Vec<GalaxySearchResult>> {
        let mut args = vec!["role".to_string(), "list".to_string()];

        if let Some(rp) = roles_path {
            args.push("--roles-path".to_string());
            args.push(rp.to_string());
        }

        let output = client
            .run_raw(
                &client.galaxy_bin,
                &args.iter().map(|s| s.as_str()).collect::<Vec<_>>(),
            )
            .await?;

        if output.exit_code != 0 {
            return Err(AnsibleError::galaxy(format!(
                "ansible-galaxy role list failed: {}",
                output.stderr
            )));
        }

        let re = Regex::new(r"^-\s+(\S+),\s+(.+)$").unwrap();
        let results: Vec<GalaxySearchResult> = output
            .stdout
            .lines()
            .filter_map(|line| {
                let caps = re.captures(line.trim())?;
                Some(GalaxySearchResult {
                    name: caps[1].to_string(),
                    namespace: String::new(),
                    description: Some(caps[2].trim().to_string()),
                    download_count: None,
                    stars: None,
                    created: None,
                    modified: None,
                })
            })
            .collect();

        Ok(results)
    }

    /// Remove an installed role.
    pub async fn remove_role(
        client: &AnsibleClient,
        role_name: &str,
        roles_path: Option<&str>,
    ) -> AnsibleResult<String> {
        let mut args = vec![
            "role".to_string(),
            "remove".to_string(),
            role_name.to_string(),
        ];

        if let Some(rp) = roles_path {
            args.push("--roles-path".to_string());
            args.push(rp.to_string());
        }

        let output = client
            .run_raw(
                &client.galaxy_bin,
                &args.iter().map(|s| s.as_str()).collect::<Vec<_>>(),
            )
            .await?;

        if output.exit_code != 0 {
            return Err(AnsibleError::galaxy(format!(
                "ansible-galaxy role remove failed: {}",
                output.stderr
            )));
        }

        debug!("Removed role: {}", role_name);
        Ok(output.stdout)
    }

    // ── Collections ──────────────────────────────────────────────────

    /// Install a collection from Galaxy.
    pub async fn install_collection(
        client: &AnsibleClient,
        options: &GalaxyInstallOptions,
    ) -> AnsibleResult<String> {
        let mut args = vec!["collection".to_string(), "install".to_string()];

        if let Some(ref cp) = options.collections_path {
            args.push("-p".to_string());
            args.push(cp.clone());
        }

        if options.force {
            args.push("--force".to_string());
        }

        if options.no_deps {
            args.push("--no-deps".to_string());
        }

        if let Some(ref req) = options.requirements_file {
            args.push("-r".to_string());
            args.push(req.clone());
        } else {
            let name_with_version = if let Some(ref v) = options.version {
                format!("{}:{}", options.name, v)
            } else {
                options.name.clone()
            };
            args.push(name_with_version);
        }

        let output = client
            .run_raw(
                &client.galaxy_bin,
                &args.iter().map(|s| s.as_str()).collect::<Vec<_>>(),
            )
            .await?;

        if output.exit_code != 0 {
            return Err(AnsibleError::galaxy(format!(
                "ansible-galaxy collection install failed: {}",
                output.stderr
            )));
        }

        debug!("Installed collection: {}", options.name);
        Ok(output.stdout)
    }

    /// List installed collections.
    pub async fn list_collections(
        client: &AnsibleClient,
        collections_path: Option<&str>,
    ) -> AnsibleResult<Vec<GalaxyCollection>> {
        let mut args = vec!["collection".to_string(), "list".to_string()];

        if let Some(cp) = collections_path {
            args.push("-p".to_string());
            args.push(cp.to_string());
        }

        let output = client
            .run_raw(
                &client.galaxy_bin,
                &args.iter().map(|s| s.as_str()).collect::<Vec<_>>(),
            )
            .await?;

        if output.exit_code != 0 {
            return Err(AnsibleError::galaxy(format!(
                "ansible-galaxy collection list failed: {}",
                output.stderr
            )));
        }

        let re = Regex::new(r"^(\S+\.\S+)\s+(\S+)").unwrap();
        let collections: Vec<GalaxyCollection> = output
            .stdout
            .lines()
            .filter_map(|line| {
                let caps = re.captures(line.trim())?;
                let full_name = &caps[1];
                let version = caps[2].to_string();
                let parts: Vec<&str> = full_name.splitn(2, '.').collect();
                if parts.len() == 2 {
                    Some(GalaxyCollection {
                        namespace: parts[0].to_string(),
                        name: parts[1].to_string(),
                        version,
                        path: None,
                        description: None,
                        authors: Vec::new(),
                        dependencies: std::collections::HashMap::new(),
                        tags: Vec::new(),
                        repository: None,
                        homepage: None,
                        documentation: None,
                    })
                } else {
                    None
                }
            })
            .collect();

        Ok(collections)
    }

    /// Remove an installed collection.
    pub async fn remove_collection(
        _client: &AnsibleClient,
        name: &str,
        collections_path: Option<&str>,
    ) -> AnsibleResult<String> {
        // There's no official `ansible-galaxy collection remove`,
        // but we can delete the directory.
        if let Some(cp) = collections_path {
            let parts: Vec<&str> = name.splitn(2, '.').collect();
            if parts.len() == 2 {
                let collection_path = std::path::Path::new(cp)
                    .join("ansible_collections")
                    .join(parts[0])
                    .join(parts[1]);

                if collection_path.exists() {
                    tokio::fs::remove_dir_all(&collection_path).await?;
                    debug!(
                        "Removed collection directory: {}",
                        collection_path.display()
                    );
                    return Ok(format!("Removed {}", name));
                }
            }
        }

        Err(AnsibleError::galaxy(format!(
            "Collection '{}' not found or cannot be removed",
            name
        )))
    }

    // ── Search ───────────────────────────────────────────────────────

    /// Search Galaxy for roles.
    pub async fn search_roles(
        client: &AnsibleClient,
        options: &GalaxySearchOptions,
    ) -> AnsibleResult<Vec<GalaxySearchResult>> {
        let mut args = vec![
            "role".to_string(),
            "search".to_string(),
            options.query.clone(),
        ];

        for tag in &options.galaxy_tags {
            args.push("--galaxy-tags".to_string());
            args.push(tag.clone());
        }

        for platform in &options.platforms {
            args.push("--platforms".to_string());
            args.push(platform.clone());
        }

        if let Some(ref author) = options.author {
            args.push("--author".to_string());
            args.push(author.clone());
        }

        let output = client
            .run_raw(
                &client.galaxy_bin,
                &args.iter().map(|s| s.as_str()).collect::<Vec<_>>(),
            )
            .await?;

        if output.exit_code != 0 {
            return Err(AnsibleError::galaxy(format!(
                "ansible-galaxy role search failed: {}",
                output.stderr
            )));
        }

        Self::parse_search_output(&output.stdout)
    }

    fn parse_search_output(output: &str) -> AnsibleResult<Vec<GalaxySearchResult>> {
        let mut results = Vec::new();
        let mut in_results = false;

        for line in output.lines() {
            let trimmed = line.trim();

            // Detect the header separator line
            if trimmed.starts_with("------") {
                in_results = true;
                continue;
            }

            if !in_results || trimmed.is_empty() {
                continue;
            }

            // Parse "namespace.name   description"
            let parts: Vec<&str> = trimmed.splitn(2, char::is_whitespace).collect();
            if parts.is_empty() {
                continue;
            }

            let full_name = parts[0];
            let name_parts: Vec<&str> = full_name.splitn(2, '.').collect();
            let (namespace, name) = if name_parts.len() == 2 {
                (name_parts[0].to_string(), name_parts[1].to_string())
            } else {
                (String::new(), full_name.to_string())
            };

            let description = parts.get(1).map(|s| s.trim().to_string());

            results.push(GalaxySearchResult {
                name,
                namespace,
                description,
                download_count: None,
                stars: None,
                created: None,
                modified: None,
            });
        }

        Ok(results)
    }

    /// Get info about a Galaxy role.
    pub async fn role_info(client: &AnsibleClient, role_name: &str) -> AnsibleResult<String> {
        let output = client
            .run_raw(&client.galaxy_bin, &["role", "info", role_name])
            .await?;

        if output.exit_code != 0 {
            return Err(AnsibleError::galaxy(format!(
                "ansible-galaxy role info failed: {}",
                output.stderr
            )));
        }

        Ok(output.stdout)
    }

    /// Import requirements from a YAML file (roles + collections).
    pub async fn install_requirements(
        client: &AnsibleClient,
        requirements_path: &str,
        force: bool,
    ) -> AnsibleResult<String> {
        let mut roles_args = vec![
            "role".to_string(),
            "install".to_string(),
            "-r".to_string(),
            requirements_path.to_string(),
        ];
        if force {
            roles_args.push("--force".to_string());
        }

        let roles_out = client
            .run_raw(
                &client.galaxy_bin,
                &roles_args.iter().map(|s| s.as_str()).collect::<Vec<_>>(),
            )
            .await;

        let mut colls_args = vec![
            "collection".to_string(),
            "install".to_string(),
            "-r".to_string(),
            requirements_path.to_string(),
        ];
        if force {
            colls_args.push("--force".to_string());
        }

        let colls_out = client
            .run_raw(
                &client.galaxy_bin,
                &colls_args.iter().map(|s| s.as_str()).collect::<Vec<_>>(),
            )
            .await;

        let mut combined = String::new();
        if let Ok(o) = roles_out {
            combined.push_str("=== Roles ===\n");
            combined.push_str(&o.stdout);
            if !o.stderr.is_empty() {
                combined.push_str(&o.stderr);
            }
        }
        if let Ok(o) = colls_out {
            combined.push_str("\n=== Collections ===\n");
            combined.push_str(&o.stdout);
            if !o.stderr.is_empty() {
                combined.push_str(&o.stderr);
            }
        }

        Ok(combined)
    }
}
