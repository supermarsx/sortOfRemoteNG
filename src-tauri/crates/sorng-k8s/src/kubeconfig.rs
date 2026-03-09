// ── sorng-k8s/src/kubeconfig.rs ─────────────────────────────────────────────
//! Kubeconfig parsing, context management, and credential resolution.

use crate::error::{K8sError, K8sResult};
use crate::types::*;
use log::{debug, info, warn};
use std::collections::HashMap;
use std::path::PathBuf;

/// Manager for kubeconfig file operations.
pub struct KubeconfigManager;

impl KubeconfigManager {
    /// Locate the default kubeconfig path (~/.kube/config or $KUBECONFIG).
    pub fn default_path() -> K8sResult<PathBuf> {
        if let Ok(env_path) = std::env::var("KUBECONFIG") {
            let first = env_path
                .split(if cfg!(windows) { ';' } else { ':' })
                .next()
                .unwrap_or(&env_path);
            let p = PathBuf::from(first);
            if p.exists() {
                return Ok(p);
            }
        }
        if let Some(home) = dirs::home_dir() {
            let p = home.join(".kube").join("config");
            if p.exists() {
                return Ok(p);
            }
        }
        Err(K8sError::kubeconfig(
            "No kubeconfig found at default location or $KUBECONFIG",
        ))
    }

    /// Load and parse a kubeconfig from a file path.
    pub fn load(path: &str) -> K8sResult<Kubeconfig> {
        let content = std::fs::read_to_string(path).map_err(|e| {
            K8sError::kubeconfig(format!("Failed to read kubeconfig '{}': {}", path, e))
        })?;
        Self::parse(&content)
    }

    /// Parse kubeconfig from a YAML string.
    pub fn parse(yaml: &str) -> K8sResult<Kubeconfig> {
        let raw: serde_json::Value = serde_yaml::from_str(yaml)?;

        let api_version = raw
            .get("apiVersion")
            .and_then(|v| v.as_str())
            .unwrap_or("v1")
            .to_string();
        let kind = raw
            .get("kind")
            .and_then(|v| v.as_str())
            .unwrap_or("Config")
            .to_string();
        let current_context = raw
            .get("current-context")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        let clusters = Self::parse_clusters(&raw)?;
        let contexts = Self::parse_contexts(&raw)?;
        let users = Self::parse_users(&raw)?;

        let preferences = if let Some(prefs) = raw.get("preferences") {
            serde_json::from_value(prefs.clone()).unwrap_or_default()
        } else {
            HashMap::new()
        };

        Ok(Kubeconfig {
            api_version,
            kind,
            current_context,
            clusters,
            contexts,
            users,
            preferences,
        })
    }

    fn parse_clusters(raw: &serde_json::Value) -> K8sResult<Vec<KubeconfigCluster>> {
        let arr = match raw.get("clusters").and_then(|v| v.as_array()) {
            Some(a) => a,
            None => return Ok(vec![]),
        };
        let mut result = Vec::new();
        for item in arr {
            let name = item
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let cluster_val = item
                .get("cluster")
                .cloned()
                .unwrap_or(serde_json::Value::Object(Default::default()));
            let cluster = ClusterEndpoint {
                server: cluster_val
                    .get("server")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                certificate_authority: cluster_val
                    .get("certificate-authority")
                    .and_then(|v| v.as_str())
                    .map(String::from),
                certificate_authority_data: cluster_val
                    .get("certificate-authority-data")
                    .and_then(|v| v.as_str())
                    .map(String::from),
                insecure_skip_tls_verify: cluster_val
                    .get("insecure-skip-tls-verify")
                    .and_then(|v| v.as_bool()),
                proxy_url: cluster_val
                    .get("proxy-url")
                    .and_then(|v| v.as_str())
                    .map(String::from),
                tls_server_name: cluster_val
                    .get("tls-server-name")
                    .and_then(|v| v.as_str())
                    .map(String::from),
                disable_compression: cluster_val
                    .get("disable-compression")
                    .and_then(|v| v.as_bool()),
            };
            result.push(KubeconfigCluster { name, cluster });
        }
        Ok(result)
    }

    fn parse_contexts(raw: &serde_json::Value) -> K8sResult<Vec<KubeconfigContext>> {
        let arr = match raw.get("contexts").and_then(|v| v.as_array()) {
            Some(a) => a,
            None => return Ok(vec![]),
        };
        let mut result = Vec::new();
        for item in arr {
            let name = item
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let ctx = item
                .get("context")
                .cloned()
                .unwrap_or(serde_json::Value::Object(Default::default()));
            let context = ContextSpec {
                cluster: ctx
                    .get("cluster")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                user: ctx
                    .get("user")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                namespace: ctx
                    .get("namespace")
                    .and_then(|v| v.as_str())
                    .map(String::from),
            };
            result.push(KubeconfigContext { name, context });
        }
        Ok(result)
    }

    fn parse_users(raw: &serde_json::Value) -> K8sResult<Vec<KubeconfigUser>> {
        let arr = match raw.get("users").and_then(|v| v.as_array()) {
            Some(a) => a,
            None => return Ok(vec![]),
        };
        let mut result = Vec::new();
        for item in arr {
            let name = item
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let user_val = item
                .get("user")
                .cloned()
                .unwrap_or(serde_json::Value::Object(Default::default()));

            let exec_config = user_val.get("exec").map(|e| ExecCredentialConfig {
                api_version: e
                    .get("apiVersion")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                command: e
                    .get("command")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                args: e.get("args").and_then(|v| v.as_array()).map(|arr| {
                    arr.iter()
                        .filter_map(|a| a.as_str().map(String::from))
                        .collect()
                }),
                env: e.get("env").and_then(|v| v.as_array()).map(|arr| {
                    arr.iter()
                        .filter_map(|ev| {
                            Some(ExecEnvVar {
                                name: ev.get("name")?.as_str()?.to_string(),
                                value: ev.get("value")?.as_str()?.to_string(),
                            })
                        })
                        .collect()
                }),
                install_hint: e
                    .get("installHint")
                    .and_then(|v| v.as_str())
                    .map(String::from),
                provide_cluster_info: e.get("provideClusterInfo").and_then(|v| v.as_bool()),
                interactive_mode: e
                    .get("interactiveMode")
                    .and_then(|v| v.as_str())
                    .map(String::from),
            });

            let auth_provider = user_val.get("auth-provider").map(|ap| AuthProviderConfig {
                name: ap
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                config: ap
                    .get("config")
                    .and_then(|v| serde_json::from_value::<HashMap<String, String>>(v.clone()).ok())
                    .unwrap_or_default(),
            });

            let user = UserCredentials {
                client_certificate: user_val
                    .get("client-certificate")
                    .and_then(|v| v.as_str())
                    .map(String::from),
                client_certificate_data: user_val
                    .get("client-certificate-data")
                    .and_then(|v| v.as_str())
                    .map(String::from),
                client_key: user_val
                    .get("client-key")
                    .and_then(|v| v.as_str())
                    .map(String::from),
                client_key_data: user_val
                    .get("client-key-data")
                    .and_then(|v| v.as_str())
                    .map(String::from),
                token: user_val
                    .get("token")
                    .and_then(|v| v.as_str())
                    .map(String::from),
                username: user_val
                    .get("username")
                    .and_then(|v| v.as_str())
                    .map(String::from),
                password: user_val
                    .get("password")
                    .and_then(|v| v.as_str())
                    .map(String::from),
                exec: exec_config,
                auth_provider,
            };
            result.push(KubeconfigUser { name, user });
        }
        Ok(result)
    }

    /// List all context names.
    pub fn list_contexts(kc: &Kubeconfig) -> Vec<String> {
        kc.contexts.iter().map(|c| c.name.clone()).collect()
    }

    /// Get the current context name.
    pub fn current_context(kc: &Kubeconfig) -> String {
        kc.current_context.clone()
    }

    /// Resolve cluster endpoint + user credentials for a named context.
    pub fn resolve_context(
        kc: &Kubeconfig,
        context_name: &str,
    ) -> K8sResult<(ClusterEndpoint, UserCredentials)> {
        let ctx = kc
            .contexts
            .iter()
            .find(|c| c.name == context_name)
            .ok_or_else(|| K8sError::kubeconfig(format!("Context '{}' not found", context_name)))?;

        let cluster = kc
            .clusters
            .iter()
            .find(|c| c.name == ctx.context.cluster)
            .ok_or_else(|| {
                K8sError::kubeconfig(format!(
                    "Cluster '{}' referenced by context '{}' not found",
                    ctx.context.cluster, context_name
                ))
            })?;

        let user = kc
            .users
            .iter()
            .find(|u| u.name == ctx.context.user)
            .ok_or_else(|| {
                K8sError::kubeconfig(format!(
                    "User '{}' referenced by context '{}' not found",
                    ctx.context.user, context_name
                ))
            })?;

        debug!(
            "Resolved context '{}': cluster='{}', user='{}'",
            context_name, cluster.name, user.name
        );

        Ok((cluster.cluster.clone(), user.user.clone()))
    }

    /// Merge multiple kubeconfigs (KUBECONFIG env with : or ; separated paths).
    pub fn merge(configs: Vec<Kubeconfig>) -> K8sResult<Kubeconfig> {
        if configs.is_empty() {
            return Err(K8sError::kubeconfig("No kubeconfigs to merge"));
        }

        let mut merged = configs[0].clone();
        for config in configs.into_iter().skip(1) {
            for cluster in config.clusters {
                if !merged.clusters.iter().any(|c| c.name == cluster.name) {
                    merged.clusters.push(cluster);
                }
            }
            for context in config.contexts {
                if !merged.contexts.iter().any(|c| c.name == context.name) {
                    merged.contexts.push(context);
                }
            }
            for user in config.users {
                if !merged.users.iter().any(|u| u.name == user.name) {
                    merged.users.push(user);
                }
            }
        }

        info!(
            "Merged kubeconfigs: {} clusters, {} contexts, {} users",
            merged.clusters.len(),
            merged.contexts.len(),
            merged.users.len()
        );

        Ok(merged)
    }

    /// Validate that all context references resolve to existing clusters and users.
    pub fn validate(kc: &Kubeconfig) -> Vec<String> {
        let mut errors = Vec::new();
        for ctx in &kc.contexts {
            if !kc.clusters.iter().any(|c| c.name == ctx.context.cluster) {
                errors.push(format!(
                    "Context '{}' references unknown cluster '{}'",
                    ctx.name, ctx.context.cluster
                ));
            }
            if !kc.users.iter().any(|u| u.name == ctx.context.user) {
                errors.push(format!(
                    "Context '{}' references unknown user '{}'",
                    ctx.name, ctx.context.user
                ));
            }
        }
        if !kc.current_context.is_empty()
            && !kc.contexts.iter().any(|c| c.name == kc.current_context)
        {
            errors.push(format!(
                "current-context '{}' does not match any context",
                kc.current_context
            ));
        }
        if !errors.is_empty() {
            warn!("Kubeconfig validation found {} issue(s)", errors.len());
        }
        errors
    }
}
