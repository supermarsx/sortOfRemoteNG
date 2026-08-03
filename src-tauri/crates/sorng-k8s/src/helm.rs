// ── sorng-k8s/src/helm.rs ───────────────────────────────────────────────────
//! Helm release management (list, install, upgrade, rollback, uninstall).
//! Wraps the `helm` CLI binary.

use crate::error::{K8sError, K8sResult};
use crate::types::*;
use log::{debug, info};
use std::{
    fs::OpenOptions,
    io::{self, Read, Write},
    path::PathBuf,
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

const MAX_HELM_STDOUT_BYTES: usize = 32 * 1024 * 1024;
const MAX_HELM_STDERR_BYTES: usize = 4 * 1024 * 1024;
const MAX_HELM_VALUES_BYTES: usize = 8 * 1024 * 1024;
const MAX_HELM_SECRET_BYTES: usize = 64 * 1024;
const MAX_HELM_POSITIONAL_BYTES: usize = 4 * 1024;
const MAX_HELM_RUNTIME: Duration = Duration::from_secs(30 * 60);

struct CapturedOutput {
    bytes: Vec<u8>,
    exceeded_limit: bool,
}

struct TempValuesFile {
    path: PathBuf,
}

impl Drop for TempValuesFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

/// Helm CLI wrapper for release management.
pub struct HelmManager;

impl HelmManager {
    /// Check if the helm binary is available.
    pub fn is_available() -> bool {
        let mut cmd = Command::new("helm");
        cmd.args(["version", "--short"]);
        Self::run_cmd(&mut cmd).is_ok()
    }

    /// Get helm version.
    pub fn version() -> K8sResult<String> {
        let mut cmd = Command::new("helm");
        cmd.args(["version", "--short"]);
        Ok(Self::run_cmd(&mut cmd)?.trim().to_string())
    }

    /// List releases in a namespace (or all namespaces).
    pub fn list_releases(
        namespace: Option<&str>,
        all_namespaces: bool,
        kubeconfig: Option<&str>,
    ) -> K8sResult<Vec<HelmRelease>> {
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
        Ok(releases.iter().filter_map(Self::parse_release).collect())
    }

    /// Get a specific release.
    pub fn get_release(
        name: &str,
        namespace: &str,
        kubeconfig: Option<&str>,
    ) -> K8sResult<HelmRelease> {
        Self::validate_positional("release name", name)?;
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
    pub fn history(
        name: &str,
        namespace: &str,
        kubeconfig: Option<&str>,
    ) -> K8sResult<Vec<HelmHistory>> {
        Self::validate_positional("release name", name)?;
        let mut cmd = Command::new("helm");
        cmd.args([
            "history",
            name,
            "--namespace",
            namespace,
            "--output",
            "json",
        ]);
        if let Some(kc) = kubeconfig {
            cmd.args(["--kubeconfig", kc]);
        }
        let output = Self::run_cmd(&mut cmd)?;
        let entries: Vec<serde_json::Value> = serde_json::from_str(&output)?;
        Ok(entries
            .iter()
            .filter_map(|e| {
                Some(HelmHistory {
                    revision: e.get("revision")?.as_i64()? as i32,
                    updated: e.get("updated")?.as_str()?.to_string(),
                    status: Self::parse_status(e.get("status")?.as_str()?),
                    chart: e.get("chart")?.as_str()?.to_string(),
                    app_version: e
                        .get("app_version")
                        .and_then(|v| v.as_str())
                        .map(String::from),
                    description: e
                        .get("description")
                        .and_then(|v| v.as_str())
                        .map(String::from),
                })
            })
            .collect())
    }

    /// Install a Helm chart.
    pub fn install(config: &HelmInstallConfig, kubeconfig: Option<&str>) -> K8sResult<String> {
        Self::validate_positional("release name", &config.release_name)?;
        Self::validate_positional("chart", &config.chart)?;
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

        let temp_values = Self::write_temp_values(&config.values)?;
        if let Some(ref values) = temp_values {
            cmd.arg("--values").arg(&values.path);
        }

        info!(
            "Helm install: {} (chart: {})",
            config.release_name, config.chart
        );
        Self::run_cmd(&mut cmd)
    }

    /// Upgrade a Helm release.
    pub fn upgrade(config: &HelmUpgradeConfig, kubeconfig: Option<&str>) -> K8sResult<String> {
        Self::validate_positional("release name", &config.release_name)?;
        Self::validate_positional("chart", &config.chart)?;
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

        let temp_values = Self::write_temp_values(&config.values)?;
        if let Some(ref values) = temp_values {
            cmd.arg("--values").arg(&values.path);
        }

        info!(
            "Helm upgrade: {} (chart: {})",
            config.release_name, config.chart
        );
        Self::run_cmd(&mut cmd)
    }

    /// Rollback a Helm release.
    pub fn rollback(config: &HelmRollbackConfig, kubeconfig: Option<&str>) -> K8sResult<String> {
        Self::validate_positional("release name", &config.release_name)?;
        let mut cmd = Command::new("helm");
        cmd.args([
            "rollback",
            &config.release_name,
            &config.revision.to_string(),
        ]);
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
        info!(
            "Helm rollback: {} to revision {}",
            config.release_name, config.revision
        );
        Self::run_cmd(&mut cmd)
    }

    /// Uninstall a Helm release.
    pub fn uninstall(config: &HelmUninstallConfig, kubeconfig: Option<&str>) -> K8sResult<String> {
        Self::validate_positional("release name", &config.release_name)?;
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
    pub fn get_values(
        name: &str,
        namespace: &str,
        all: bool,
        kubeconfig: Option<&str>,
    ) -> K8sResult<serde_json::Value> {
        Self::validate_positional("release name", name)?;
        let mut cmd = Command::new("helm");
        cmd.args([
            "get",
            "values",
            name,
            "--namespace",
            namespace,
            "--output",
            "json",
        ]);
        if all {
            cmd.arg("--all");
        }
        if let Some(kc) = kubeconfig {
            cmd.args(["--kubeconfig", kc]);
        }
        let output = Self::run_cmd(&mut cmd)?;
        serde_json::from_str(&output)
            .map_err(|e| K8sError::parse(format!("Failed to parse helm values: {}", e)))
    }

    /// Get release manifest.
    pub fn get_manifest(
        name: &str,
        namespace: &str,
        kubeconfig: Option<&str>,
    ) -> K8sResult<String> {
        Self::validate_positional("release name", name)?;
        let mut cmd = Command::new("helm");
        cmd.args(["get", "manifest", name, "--namespace", namespace]);
        if let Some(kc) = kubeconfig {
            cmd.args(["--kubeconfig", kc]);
        }
        Self::run_cmd(&mut cmd)
    }

    /// Template a chart (render without installing).
    pub fn template(config: &HelmTemplateConfig, kubeconfig: Option<&str>) -> K8sResult<String> {
        Self::validate_positional("release name", &config.release_name)?;
        Self::validate_positional("chart", &config.chart)?;
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

        let temp_values = Self::write_temp_values(&config.values)?;
        if let Some(ref values) = temp_values {
            cmd.arg("--values").arg(&values.path);
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
        Ok(repos
            .iter()
            .filter_map(|r| {
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
            })
            .collect())
    }

    /// Add a Helm repository.
    pub fn add_repo(repo: &HelmRepository) -> K8sResult<String> {
        Self::validate_positional("repository name", &repo.name)?;
        Self::validate_positional("repository URL", &repo.url)?;
        if Self::url_has_embedded_credentials(&repo.url) {
            return Err(K8sError::helm(
                "Repository URL credentials are not allowed; use username and password fields",
            ));
        }
        let mut cmd = Command::new("helm");
        cmd.args(["repo", "add", &repo.name, &repo.url]);
        if let Some(ref user) = repo.username {
            cmd.args(["--username", user]);
        }
        if let Some(ref ca) = repo.ca_file {
            cmd.args(["--ca-file", ca]);
        }
        if let Some(ref cert) = repo.cert_file {
            cmd.args(["--cert-file", cert]);
        }
        if let Some(ref key) = repo.key_file {
            cmd.args(["--key-file", key]);
        }
        if repo.insecure_skip_tls_verify == Some(true) {
            cmd.arg("--insecure-skip-tls-verify");
        }
        if repo.pass_credentials_all == Some(true) {
            cmd.arg("--pass-credentials");
        }
        info!("Adding Helm repo '{}'", repo.name);
        if let Some(ref password) = repo.password {
            Self::validate_secret(password)?;
            cmd.arg("--password-stdin");
            Self::run_cmd_with_secret(&mut cmd, password)
        } else {
            Self::run_cmd(&mut cmd)
        }
    }

    /// Remove a Helm repository.
    pub fn remove_repo(name: &str) -> K8sResult<String> {
        Self::validate_positional("repository name", name)?;
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
        Self::validate_positional("search keyword", keyword)?;
        let mut cmd = Command::new("helm");
        cmd.args(["search", "repo", keyword, "--output", "json"]);
        if all_versions {
            cmd.arg("--versions");
        }
        let output = Self::run_cmd(&mut cmd)?;
        let charts: Vec<serde_json::Value> = serde_json::from_str(&output)?;
        Ok(charts
            .iter()
            .filter_map(|c| {
                Some(HelmChart {
                    name: c.get("name")?.as_str()?.to_string(),
                    version: c.get("version")?.as_str()?.to_string(),
                    app_version: c
                        .get("app_version")
                        .and_then(|v| v.as_str())
                        .map(String::from),
                    description: c
                        .get("description")
                        .and_then(|v| v.as_str())
                        .map(String::from),
                    home: None,
                    icon: None,
                    keywords: vec![],
                    maintainers: vec![],
                    sources: vec![],
                    urls: vec![],
                    created: None,
                    deprecated: c
                        .get("deprecated")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false),
                })
            })
            .collect())
    }

    // ── Internal ────────────────────────────────────────────────────────

    fn run_cmd(cmd: &mut Command) -> K8sResult<String> {
        Self::run_cmd_internal(cmd, None)
    }

    fn run_cmd_with_secret(cmd: &mut Command, secret: &str) -> K8sResult<String> {
        Self::run_cmd_internal(cmd, Some(secret))
    }

    fn run_cmd_internal(cmd: &mut Command, secret: Option<&str>) -> K8sResult<String> {
        debug!("Running Helm subprocess");
        if secret.is_some() {
            cmd.stdin(Stdio::piped());
        } else {
            cmd.stdin(Stdio::null());
        }
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

        let mut child = cmd
            .spawn()
            .map_err(|e| K8sError::helm(format!("Failed to execute Helm: {}", e)))?;

        if let Some(secret) = secret {
            let Some(mut stdin) = child.stdin.take() else {
                let _ = child.kill();
                let _ = child.wait();
                return Err(K8sError::helm("Failed to open Helm standard input"));
            };
            if stdin
                .write_all(secret.as_bytes())
                .and_then(|_| stdin.write_all(b"\n"))
                .is_err()
            {
                let _ = child.kill();
                let _ = child.wait();
                return Err(K8sError::helm("Failed to provide Helm credentials"));
            }
        }

        let Some(stdout) = child.stdout.take() else {
            let _ = child.kill();
            let _ = child.wait();
            return Err(K8sError::helm("Failed to capture Helm output"));
        };
        let Some(stderr) = child.stderr.take() else {
            let _ = child.kill();
            let _ = child.wait();
            return Err(K8sError::helm("Failed to capture Helm errors"));
        };

        let stdout_thread =
            thread::spawn(move || Self::capture_reader(stdout, MAX_HELM_STDOUT_BYTES));
        let stderr_thread =
            thread::spawn(move || Self::capture_reader(stderr, MAX_HELM_STDERR_BYTES));

        let started = Instant::now();
        let mut timed_out = false;
        let mut wait_error = None;
        let status = loop {
            match child.try_wait() {
                Ok(Some(status)) => break Some(status),
                Ok(None) if started.elapsed() >= MAX_HELM_RUNTIME => {
                    timed_out = true;
                    let _ = child.kill();
                    let _ = child.wait();
                    break None;
                }
                Ok(None) => thread::sleep(Duration::from_millis(25)),
                Err(error) => {
                    wait_error = Some(error.to_string());
                    let _ = child.kill();
                    let _ = child.wait();
                    break None;
                }
            }
        };

        let stdout_result = stdout_thread.join();
        let stderr_result = stderr_thread.join();
        let stdout = stdout_result
            .map_err(|_| K8sError::helm("Helm stdout reader failed"))?
            .map_err(|e| K8sError::helm(format!("Failed to read Helm stdout: {}", e)))?;
        let stderr = stderr_result
            .map_err(|_| K8sError::helm("Helm stderr reader failed"))?
            .map_err(|e| K8sError::helm(format!("Failed to read Helm stderr: {}", e)))?;

        if timed_out {
            return Err(K8sError::helm(
                "Helm command exceeded the 30 minute runtime limit",
            ));
        }
        if let Some(error) = wait_error {
            return Err(K8sError::helm(format!(
                "Failed while waiting for Helm: {}",
                error
            )));
        }
        if stdout.exceeded_limit {
            return Err(K8sError::helm("Helm stdout exceeded the 32 MiB limit"));
        }
        if stderr.exceeded_limit {
            return Err(K8sError::helm("Helm stderr exceeded the 4 MiB limit"));
        }

        let stdout = Self::redact_secret(&stdout.bytes, secret);
        if !status
            .ok_or_else(|| K8sError::helm("Helm command ended without a status"))?
            .success()
        {
            let stderr = Self::redact_secret(&stderr.bytes, secret);
            let detail = if stderr.trim().is_empty() {
                "no error details were returned".to_string()
            } else {
                stderr
            };
            return Err(K8sError::helm(format!("Helm command failed: {}", detail)));
        }
        Ok(stdout)
    }

    fn capture_reader<R: Read>(mut reader: R, limit: usize) -> io::Result<CapturedOutput> {
        let mut bytes = Vec::with_capacity(limit.min(64 * 1024));
        let mut buffer = [0_u8; 8192];
        let mut exceeded_limit = false;

        loop {
            let count = reader.read(&mut buffer)?;
            if count == 0 {
                break;
            }
            let remaining = limit.saturating_sub(bytes.len());
            let retained = count.min(remaining);
            bytes.extend_from_slice(&buffer[..retained]);
            exceeded_limit |= retained < count;
        }

        Ok(CapturedOutput {
            bytes,
            exceeded_limit,
        })
    }

    fn redact_secret(bytes: &[u8], secret: Option<&str>) -> String {
        let output = String::from_utf8_lossy(bytes).to_string();
        match secret {
            Some(secret) if !secret.is_empty() => output.replace(secret, "[REDACTED]"),
            _ => output,
        }
    }

    fn validate_positional(label: &str, value: &str) -> K8sResult<()> {
        if value.is_empty()
            || value.len() > MAX_HELM_POSITIONAL_BYTES
            || value.starts_with('-')
            || value.chars().any(char::is_control)
        {
            return Err(K8sError::helm(format!(
                "Invalid Helm {} positional value",
                label
            )));
        }
        Ok(())
    }

    fn validate_secret(secret: &str) -> K8sResult<()> {
        if secret.len() > MAX_HELM_SECRET_BYTES
            || secret.bytes().any(|byte| matches!(byte, b'\r' | b'\n' | 0))
        {
            return Err(K8sError::helm("Invalid Helm repository password"));
        }
        Ok(())
    }

    fn url_has_embedded_credentials(url: &str) -> bool {
        let Some((_, remainder)) = url.split_once("://") else {
            return false;
        };
        remainder
            .split(['/', '?', '#'])
            .next()
            .map(|authority| authority.contains('@'))
            .unwrap_or(false)
    }

    fn write_temp_values(value: &serde_json::Value) -> K8sResult<Option<TempValuesFile>> {
        if value == &serde_json::Value::Null
            || matches!(value, serde_json::Value::Object(values) if values.is_empty())
        {
            return Ok(None);
        }

        let bytes = serde_json::to_vec(value)
            .map_err(|_| K8sError::helm("Failed to serialize inline Helm values"))?;
        if bytes.len() > MAX_HELM_VALUES_BYTES {
            return Err(K8sError::helm("Inline Helm values exceed the 8 MiB limit"));
        }

        let path = std::env::temp_dir().join(format!("sorng-helm-{}.json", uuid::Uuid::new_v4()));
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }

        let mut file = options
            .open(&path)
            .map_err(|e| K8sError::helm(format!("Failed to create Helm values file: {}", e)))?;
        let values_file = TempValuesFile { path };
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|e| K8sError::helm(format!("Failed to write Helm values file: {}", e)))?;
        Ok(Some(values_file))
    }

    fn parse_release(val: &serde_json::Value) -> Option<HelmRelease> {
        Some(HelmRelease {
            name: val.get("name")?.as_str()?.to_string(),
            namespace: val.get("namespace")?.as_str()?.to_string(),
            revision: val.get("revision").and_then(|v| v.as_i64()).unwrap_or(0) as i32,
            updated: val
                .get("updated")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            status: Self::parse_status(val.get("status")?.as_str()?),
            chart: val
                .get("chart")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            chart_version: val
                .get("chart")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            app_version: val
                .get("app_version")
                .and_then(|v| v.as_str())
                .map(String::from),
            description: val
                .get("description")
                .and_then(|v| v.as_str())
                .map(String::from),
            notes: val
                .get("info")
                .and_then(|i| i.get("notes"))
                .and_then(|v| v.as_str())
                .map(String::from),
            values: val
                .get("config")
                .cloned()
                .unwrap_or(serde_json::Value::Null),
            manifest: val
                .get("manifest")
                .and_then(|v| v.as_str())
                .map(String::from),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_option_like_positional_values() {
        assert!(HelmManager::validate_positional("release name", "--debug").is_err());
        assert!(HelmManager::validate_positional("release name", "safe-release").is_ok());
    }

    #[test]
    fn rejects_password_line_injection() {
        assert!(HelmManager::validate_secret("secret\n--debug").is_err());
        assert!(HelmManager::validate_secret("safe-secret").is_ok());
    }

    #[test]
    fn detects_repository_url_credentials() {
        assert!(HelmManager::url_has_embedded_credentials(
            "https://user:secret@example.com/charts"
        ));
        assert!(!HelmManager::url_has_embedded_credentials(
            "https://example.com/charts"
        ));
    }

    #[test]
    fn redacts_stdin_secret_from_captured_output() {
        let output = HelmManager::redact_secret(b"failure for secret-value", Some("secret-value"));
        assert_eq!(output, "failure for [REDACTED]");
    }

    #[test]
    fn temporary_values_file_is_removed_on_drop() {
        let values = serde_json::json!({"replicas": 2});
        let values_file = HelmManager::write_temp_values(&values)
            .expect("temp values should be created")
            .expect("non-empty values should have a file");
        let path = values_file.path.clone();
        assert!(path.is_file());
        drop(values_file);
        assert!(!path.exists());
    }
}
