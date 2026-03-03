// ── sorng-k8s/src/helm.rs ───────────────────────────────────────────────────
//! Helm release management (list, install, upgrade, rollback, uninstall).
//! Wraps the `helm` CLI binary.

use crate::error::{K8sError, K8sResult};
use crate::types::*;
use log::{debug, info};
use std::process::Command;

/// Helm CLI wrapper for release management.
pub struct HelmManager;

impl HelmManager {
    /// Check if the helm binary is available.
    pub fn is_available() -> bool {
        Command::new("helm").arg("version").arg("--short").output().is_ok()
    }

    /// Get helm version.
    pub fn version() -> K8sResult<String> {
        let output = Command::new("helm")
            .args(["version", "--short"])
            .output()
            .map_err(|e| K8sError::helm(format!("Failed to run helm: {}", e)))?;
        if !output.status.success() {
            return Err(K8sError::helm(String::from_utf8_lossy(&output.stderr).to_string()));
        }
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }

    /// List releases in a namespace (or all namespaces).
    pub fn list_releases(namespace: Option<&str>, all_namespaces: bool, kubeconfig: Option<&str>) -> K8sResult<Vec<HelmRelease>> {
        let mut cmd = Command::new("helm");
        cmd.args(["list", "--output", "json"]);
        if all_namespaces {
            cmd.arg("--all-namespaces");
        } else if let Some(ns) = namespace {
            cmd.args(["--namespace", ns]);
        }
        if let Some(kc) = kubeconfig {
            cmd.args(["--kubeconfig", kc]);
        }
        let output = Self::run_cmd(&mut cmd)?;
        let releases: Vec<serde_json::Value> = serde_json::from_str(&output)
            .map_err(|e| K8sError::parse(format!("Failed to parse helm list output: {}", e)))?;
        Ok(releases.iter().filter_map(|r| Self::parse_release(r)).collect())
    }

    /// Get a specific release.
    pub fn get_release(name: &str, namespace: &str, kubeconfig: Option<&str>) -> K8sResult<HelmRelease> {
        let mut cmd = Command::new("helm");
        cmd.args(["status", name, "--namespace", namespace, "--output", "json"]);
        if let Some(kc) = kubeconfig {
            cmd.args(["--kubeconfig", kc]);
        }
        let output = Self::run_cmd(&mut cmd)?;
        let val: serde_json::Value = serde_json::from_str(&output)?;
        Self::parse_release(&val)
            .ok_or_else(|| K8sError::parse("Failed to parse helm release status"))
    }

    /// Get release history.
    pub fn history(name: &str, namespace: &str, kubeconfig: Option<&str>) -> K8sResult<Vec<HelmHistory>> {
        let mut cmd = Command::new("helm");
        cmd.args(["history", name, "--namespace", namespace, "--output", "json"]);
        if let Some(kc) = kubeconfig {
            cmd.args(["--kubeconfig", kc]);
        }
        let output = Self::run_cmd(&mut cmd)?;
        let entries: Vec<serde_json::Value> = serde_json::from_str(&output)?;
        Ok(entries.iter().filter_map(|e| {
            Some(HelmHistory {
                revision: e.get("revision")?.as_i64()? as i32,
                updated: e.get("updated")?.as_str()?.to_string(),
                status: Self::parse_status(e.get("status")?.as_str()?),
                chart: e.get("chart")?.as_str()?.to_string(),
                app_version: e.get("app_version").and_then(|v| v.as_str()).map(String::from),
                description: e.get("description").and_then(|v| v.as_str()).map(String::from),
            })
        }).collect())
    }

    /// Install a Helm chart.
    pub fn install(config: &HelmInstallConfig, kubeconfig: Option<&str>) -> K8sResult<String> {
        let mut cmd = Command::new("helm");
        cmd.args(["install", &config.release_name, &config.chart]);
        cmd.args(["--namespace", &config.namespace]);

        if let Some(ref ver) = config.version {
            cmd.args(["--version", ver]);
        }
        if config.create_namespace {
            cmd.arg("--create-namespace");
        }
        if config.wait {
            cmd.arg("--wait");
        }
        if config.wait_for_jobs {
            cmd.arg("--wait-for-jobs");
        }
        if let Some(timeout) = config.timeout_secs {
            cmd.args(["--timeout", &format!("{}s", timeout)]);
        }
        if config.atomic {
            cmd.arg("--atomic");
        }
        if config.dry_run {
            cmd.arg("--dry-run");
        }
        if config.no_hooks {
            cmd.arg("--no-hooks");
        }
        if config.skip_crds {
            cmd.arg("--skip-crds");
        }
        if config.dependency_update {
            cmd.arg("--dependency-update");
        }
        if let Some(ref desc) = config.description {
            cmd.args(["--description", desc]);
        }
        if let Some(ref repo) = config.repository {
            cmd.args(["--repo", repo]);
        }
        for vf in &config.values_files {
            cmd.args(["--values", vf]);
        }
        for (k, v) in &config.set_values {
            cmd.args(["--set", &format!("{}={}", k, v)]);
        }
        if let Some(kc) = kubeconfig {
            cmd.args(["--kubeconfig", kc]);
        }

        // Write inline values to a temp file if non-null
        if config.values != serde_json::Value::Null && config.values != serde_json::json!({}) {
            let values_str = serde_json::to_string(&config.values).unwrap_or_default();
            let tmp = std::env::temp_dir().join(format!("helm-values-{}.json", uuid::Uuid::new_v4()));
            std::fs::write(&tmp, &values_str)
                .map_err(|e| K8sError::helm(format!("Failed to write temp values: {}", e)))?;
            cmd.args(["--values", tmp.to_str().unwrap_or("")]);
        }

        info!("Helm install: {} (chart: {})", config.release_name, config.chart);
        Self::run_cmd(&mut cmd)
    }

    /// Upgrade a Helm release.
    pub fn upgrade(config: &HelmUpgradeConfig, kubeconfig: Option<&str>) -> K8sResult<String> {
        let mut cmd = Command::new("helm");
        cmd.args(["upgrade", &config.release_name, &config.chart]);
        cmd.args(["--namespace", &config.namespace]);

        if let Some(ref ver) = config.version {
            cmd.args(["--version", ver]);
        }
        if config.install {
            cmd.arg("--install");
        }
        if config.wait {
            cmd.arg("--wait");
        }
        if config.wait_for_jobs {
            cmd.arg("--wait-for-jobs");
        }
        if let Some(timeout) = config.timeout_secs {
            cmd.args(["--timeout", &format!("{}s", timeout)]);
        }
        if config.atomic {
            cmd.arg("--atomic");
        }
        if config.dry_run {
            cmd.arg("--dry-run");
        }
        if config.force {
            cmd.arg("--force");
        }
        if config.reset_values {
            cmd.arg("--reset-values");
        }
        if config.reuse_values {
            cmd.arg("--reuse-values");
        }
        if config.cleanup_on_fail {
            cmd.arg("--cleanup-on-fail");
        }
        if config.no_hooks {
            cmd.arg("--no-hooks");
        }
        if let Some(ref desc) = config.description {
            cmd.args(["--description", desc]);
        }
        if let Some(mh) = config.max_history {
            cmd.args(["--history-max", &mh.to_string()]);
        }
        if let Some(ref repo) = config.repository {
            cmd.args(["--repo", repo]);
        }
        for vf in &config.values_files {
            cmd.args(["--values", vf]);
        }
        for (k, v) in &config.set_values {
            cmd.args(["--set", &format!("{}={}", k, v)]);
        }
        if let Some(kc) = kubeconfig {
            cmd.args(["--kubeconfig", kc]);
        }

        if config.values != serde_json::Value::Null && config.values != serde_json::json!({}) {
            let values_str = serde_json::to_string(&config.values).unwrap_or_default();
            let tmp = std::env::temp_dir().join(format!("helm-values-{}.json", uuid::Uuid::new_v4()));
            std::fs::write(&tmp, &values_str)
                .map_err(|e| K8sError::helm(format!("Failed to write temp values: {}", e)))?;
            cmd.args(["--values", tmp.to_str().unwrap_or("")]);
        }

        info!("Helm upgrade: {} (chart: {})", config.release_name, config.chart);
        Self::run_cmd(&mut cmd)
    }

    /// Rollback a Helm release.
    pub fn rollback(config: &HelmRollbackConfig, kubeconfig: Option<&str>) -> K8sResult<String> {
        let mut cmd = Command::new("helm");
        cmd.args(["rollback", &config.release_name, &config.revision.to_string()]);
        cmd.args(["--namespace", &config.namespace]);
        if config.wait {
            cmd.arg("--wait");
        }
        if let Some(timeout) = config.timeout_secs {
            cmd.args(["--timeout", &format!("{}s", timeout)]);
        }
        if config.no_hooks {
            cmd.arg("--no-hooks");
        }
        if config.force {
            cmd.arg("--force");
        }
        if config.recreate_pods {
            cmd.arg("--recreate-pods");
        }
        if config.cleanup_on_fail {
            cmd.arg("--cleanup-on-fail");
        }
        if config.dry_run {
            cmd.arg("--dry-run");
        }
        if let Some(kc) = kubeconfig {
            cmd.args(["--kubeconfig", kc]);
        }
        info!("Helm rollback: {} to revision {}", config.release_name, config.revision);
        Self::run_cmd(&mut cmd)
    }

    /// Uninstall a Helm release.
    pub fn uninstall(config: &HelmUninstallConfig, kubeconfig: Option<&str>) -> K8sResult<String> {
        let mut cmd = Command::new("helm");
        cmd.args(["uninstall", &config.release_name]);
        cmd.args(["--namespace", &config.namespace]);
        if config.keep_history {
            cmd.arg("--keep-history");
        }
        if config.no_hooks {
            cmd.arg("--no-hooks");
        }
        if let Some(timeout) = config.timeout_secs {
            cmd.args(["--timeout", &format!("{}s", timeout)]);
        }
        if config.dry_run {
            cmd.arg("--dry-run");
        }
        if config.wait {
            cmd.arg("--wait");
        }
        if let Some(ref desc) = config.description {
            cmd.args(["--description", desc]);
        }
        if let Some(kc) = kubeconfig {
            cmd.args(["--kubeconfig", kc]);
        }
        info!("Helm uninstall: {}", config.release_name);
        Self::run_cmd(&mut cmd)
    }

    /// Get release values.
    pub fn get_values(name: &str, namespace: &str, all: bool, kubeconfig: Option<&str>) -> K8sResult<serde_json::Value> {
        let mut cmd = Command::new("helm");
        cmd.args(["get", "values", name, "--namespace", namespace, "--output", "json"]);
        if all {
            cmd.arg("--all");
        }
        if let Some(kc) = kubeconfig {
            cmd.args(["--kubeconfig", kc]);
        }
        let output = Self::run_cmd(&mut cmd)?;
        serde_json::from_str(&output).map_err(|e| K8sError::parse(format!("Failed to parse helm values: {}", e)))
    }

    /// Get release manifest.
    pub fn get_manifest(name: &str, namespace: &str, kubeconfig: Option<&str>) -> K8sResult<String> {
        let mut cmd = Command::new("helm");
        cmd.args(["get", "manifest", name, "--namespace", namespace]);
        if let Some(kc) = kubeconfig {
            cmd.args(["--kubeconfig", kc]);
        }
        Self::run_cmd(&mut cmd)
    }

    /// Template a chart (render without installing).
    pub fn template(config: &HelmTemplateConfig, kubeconfig: Option<&str>) -> K8sResult<String> {
        let mut cmd = Command::new("helm");
        cmd.args(["template", &config.release_name, &config.chart]);
        cmd.args(["--namespace", &config.namespace]);

        if let Some(ref ver) = config.version {
            cmd.args(["--version", ver]);
        }
        if config.validate {
            cmd.arg("--validate");
        }
        if config.include_crds {
            cmd.arg("--include-crds");
        }
        if config.skip_tests {
            cmd.arg("--skip-tests");
        }
        for tpl in &config.show_only {
            cmd.args(["--show-only", tpl]);
        }
        for apiv in &config.api_versions {
            cmd.args(["--api-versions", apiv]);
        }
        if let Some(ref kv) = config.kube_version {
            cmd.args(["--kube-version", kv]);
        }
        for (k, v) in &config.set_values {
            cmd.args(["--set", &format!("{}={}", k, v)]);
        }
        if let Some(kc) = kubeconfig {
            cmd.args(["--kubeconfig", kc]);
        }

        if config.values != serde_json::Value::Null && config.values != serde_json::json!({}) {
            let values_str = serde_json::to_string(&config.values).unwrap_or_default();
            let tmp = std::env::temp_dir().join(format!("helm-values-{}.json", uuid::Uuid::new_v4()));
            std::fs::write(&tmp, &values_str)
                .map_err(|e| K8sError::helm(format!("Failed to write temp values: {}", e)))?;
            cmd.args(["--values", tmp.to_str().unwrap_or("")]);
        }

        Self::run_cmd(&mut cmd)
    }

    // ── Repositories ────────────────────────────────────────────────────

    /// List configured Helm repositories.
    pub fn list_repos() -> K8sResult<Vec<HelmRepository>> {
        let mut cmd = Command::new("helm");
        cmd.args(["repo", "list", "--output", "json"]);
        let output = Self::run_cmd(&mut cmd)?;
        let repos: Vec<serde_json::Value> = serde_json::from_str(&output)?;
        Ok(repos.iter().filter_map(|r| {
            Some(HelmRepository {
                name: r.get("name")?.as_str()?.to_string(),
                url: r.get("url")?.as_str()?.to_string(),
                username: None,
                password: None,
                ca_file: None,
                cert_file: None,
                key_file: None,
                insecure_skip_tls_verify: None,
                pass_credentials_all: None,
                oci: false,
            })
        }).collect())
    }

    /// Add a Helm repository.
    pub fn add_repo(repo: &HelmRepository) -> K8sResult<String> {
        let mut cmd = Command::new("helm");
        cmd.args(["repo", "add", &repo.name, &repo.url]);
        if let Some(ref user) = repo.username {
            cmd.args(["--username", user]);
        }
        if let Some(ref pass) = repo.password {
            cmd.args(["--password", pass]);
        }
        if let Some(ref ca) = repo.ca_file {
            cmd.args(["--ca-file", ca]);
        }
        if repo.insecure_skip_tls_verify == Some(true) {
            cmd.arg("--insecure-skip-tls-verify");
        }
        if repo.pass_credentials_all == Some(true) {
            cmd.arg("--pass-credentials");
        }
        info!("Adding Helm repo '{}' ({})", repo.name, repo.url);
        Self::run_cmd(&mut cmd)
    }

    /// Remove a Helm repository.
    pub fn remove_repo(name: &str) -> K8sResult<String> {
        let mut cmd = Command::new("helm");
        cmd.args(["repo", "remove", name]);
        info!("Removing Helm repo '{}'", name);
        Self::run_cmd(&mut cmd)
    }

    /// Update all Helm repositories.
    pub fn update_repos() -> K8sResult<String> {
        let mut cmd = Command::new("helm");
        cmd.args(["repo", "update"]);
        info!("Updating Helm repositories");
        Self::run_cmd(&mut cmd)
    }

    /// Search for charts in repositories.
    pub fn search_charts(keyword: &str, all_versions: bool) -> K8sResult<Vec<HelmChart>> {
        let mut cmd = Command::new("helm");
        cmd.args(["search", "repo", keyword, "--output", "json"]);
        if all_versions {
            cmd.arg("--versions");
        }
        let output = Self::run_cmd(&mut cmd)?;
        let charts: Vec<serde_json::Value> = serde_json::from_str(&output)?;
        Ok(charts.iter().filter_map(|c| {
            Some(HelmChart {
                name: c.get("name")?.as_str()?.to_string(),
                version: c.get("version")?.as_str()?.to_string(),
                app_version: c.get("app_version").and_then(|v| v.as_str()).map(String::from),
                description: c.get("description").and_then(|v| v.as_str()).map(String::from),
                home: None,
                icon: None,
                keywords: vec![],
                maintainers: vec![],
                sources: vec![],
                urls: vec![],
                created: None,
                deprecated: c.get("deprecated").and_then(|v| v.as_bool()).unwrap_or(false),
            })
        }).collect())
    }

    // ── Internal ────────────────────────────────────────────────────────

    fn run_cmd(cmd: &mut Command) -> K8sResult<String> {
        debug!("Running: {:?}", cmd);
        let output = cmd.output()
            .map_err(|e| K8sError::helm(format!("Failed to execute helm: {}", e)))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(K8sError::helm(format!("helm command failed: {}", stderr)));
        }
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    }

    fn parse_release(val: &serde_json::Value) -> Option<HelmRelease> {
        Some(HelmRelease {
            name: val.get("name")?.as_str()?.to_string(),
            namespace: val.get("namespace")?.as_str()?.to_string(),
            revision: val.get("revision").and_then(|v| v.as_i64()).unwrap_or(0) as i32,
            updated: val.get("updated").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            status: Self::parse_status(val.get("status")?.as_str()?),
            chart: val.get("chart").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            chart_version: val.get("chart").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            app_version: val.get("app_version").and_then(|v| v.as_str()).map(String::from),
            description: val.get("description").and_then(|v| v.as_str()).map(String::from),
            notes: val.get("info").and_then(|i| i.get("notes")).and_then(|v| v.as_str()).map(String::from),
            values: val.get("config").cloned().unwrap_or(serde_json::Value::Null),
            manifest: val.get("manifest").and_then(|v| v.as_str()).map(String::from),
        })
    }

    fn parse_status(s: &str) -> HelmReleaseStatus {
        match s.to_lowercase().as_str() {
            "deployed" => HelmReleaseStatus::Deployed,
            "uninstalled" => HelmReleaseStatus::Uninstalled,
            "superseded" => HelmReleaseStatus::Superseded,
            "failed" => HelmReleaseStatus::Failed,
            "uninstalling" => HelmReleaseStatus::Uninstalling,
            "pending-install" => HelmReleaseStatus::PendingInstall,
            "pending-upgrade" => HelmReleaseStatus::PendingUpgrade,
            "pending-rollback" => HelmReleaseStatus::PendingRollback,
            _ => HelmReleaseStatus::Unknown,
        }
    }
}
