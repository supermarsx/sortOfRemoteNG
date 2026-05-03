//! # opkssh OIDC Login
//!
//! Handle the `opkssh login` flow, which opens a browser for OIDC authentication
//! and generates an SSH key containing the PK Token.

use crate::service::OpksshServiceState;
use crate::types::*;
use chrono::{DateTime, Duration, Utc};
use log::info;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, OnceLock};
use tokio::process::Command;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;
use uuid::Uuid;

const LOGIN_CANCELLED_MESSAGE: &str = "Login wait cancelled locally. Callback listener bind/shutdown remain provider-owned in this Phase C slice, so external browser/provider activity may still continue.";

type LoginOperationTaskResult = Result<OpksshLoginResult, String>;
type SharedLoginOperation = Arc<Mutex<PendingLoginOperation>>;
type LoginOperationRegistry = Mutex<HashMap<String, SharedLoginOperation>>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum OpksshLoginOperationStatus {
    Running,
    Succeeded,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpksshLoginOperation {
    pub id: String,
    pub status: OpksshLoginOperationStatus,
    pub provider: Option<String>,
    pub runtime: OpksshRuntimeStatus,
    pub browser_url: Option<String>,
    pub can_cancel: bool,
    pub message: Option<String>,
    pub result: Option<OpksshLoginResult>,
    pub started_at: DateTime<Utc>,
    pub finished_at: Option<DateTime<Utc>>,
}

struct PendingLoginOperation {
    snapshot: OpksshLoginOperation,
    task: Option<JoinHandle<LoginOperationTaskResult>>,
}

fn login_operations() -> &'static LoginOperationRegistry {
    static REGISTRY: OnceLock<LoginOperationRegistry> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

fn resolve_operation_provider(opts: &OpksshLoginOptions) -> Option<String> {
    opts.provider.clone().or_else(|| opts.issuer.clone())
}

fn finalize_operation(snapshot: &mut OpksshLoginOperation, outcome: LoginOperationTaskResult) {
    snapshot.finished_at = Some(Utc::now());
    snapshot.can_cancel = false;

    match outcome {
        Ok(result) => {
            snapshot.status = if result.success {
                OpksshLoginOperationStatus::Succeeded
            } else {
                OpksshLoginOperationStatus::Failed
            };
            snapshot.message = Some(result.message.clone());
            snapshot.result = Some(result);
        }
        Err(message) => {
            snapshot.status = OpksshLoginOperationStatus::Failed;
            snapshot.message = Some(message);
            snapshot.result = None;
        }
    }
}

fn mark_operation_cancelled(snapshot: &mut OpksshLoginOperation) {
    snapshot.status = OpksshLoginOperationStatus::Cancelled;
    snapshot.can_cancel = false;
    snapshot.finished_at = Some(Utc::now());
    snapshot.message = Some(LOGIN_CANCELLED_MESSAGE.to_string());
    snapshot.result = None;
}

async fn finalize_if_finished(entry: &SharedLoginOperation) -> Result<(), String> {
    let completed_task = {
        let mut pending = entry.lock().await;
        if pending
            .task
            .as_ref()
            .map_or(false, |task| task.is_finished())
        {
            pending.task.take()
        } else {
            None
        }
    };

    if let Some(task) = completed_task {
        let outcome = task
            .await
            .map_err(|err| format!("OPKSSH login operation task failed: {err}"))?;
        let mut pending = entry.lock().await;
        finalize_operation(&mut pending.snapshot, outcome);
    }

    Ok(())
}

pub async fn start_login_operation(
    service_state: OpksshServiceState,
    opts: OpksshLoginOptions,
) -> Result<OpksshLoginOperation, String> {
    let runtime = {
        let mut svc = service_state.lock().await;
        svc.refresh_runtime_status().await
    };

    if runtime.active_backend.is_none() {
        return Err(runtime.message.clone().unwrap_or_else(|| {
            "No OPKSSH runtime is currently available. The in-process library path is not linked yet and the CLI fallback was not found.".to_string()
        }));
    }

    let id = Uuid::new_v4().to_string();
    let snapshot = OpksshLoginOperation {
        id: id.clone(),
        status: OpksshLoginOperationStatus::Running,
        provider: resolve_operation_provider(&opts),
        runtime: runtime.clone(),
        browser_url: None,
        can_cancel: true,
        message: runtime.message.clone(),
        result: None,
        started_at: Utc::now(),
        finished_at: None,
    };

    let task_state = service_state.clone();
    let task = tokio::spawn(async move {
        let mut svc = task_state.lock().await;
        svc.login(opts).await
    });

    login_operations().lock().await.insert(
        id,
        Arc::new(Mutex::new(PendingLoginOperation {
            snapshot: snapshot.clone(),
            task: Some(task),
        })),
    );

    Ok(snapshot)
}

pub async fn get_login_operation(
    operation_id: &str,
) -> Result<Option<OpksshLoginOperation>, String> {
    let entry = {
        let registry = login_operations().lock().await;
        registry.get(operation_id).cloned()
    };

    let Some(entry) = entry else {
        return Ok(None);
    };

    finalize_if_finished(&entry).await?;

    let pending = entry.lock().await;
    Ok(Some(pending.snapshot.clone()))
}

pub async fn await_login_operation(operation_id: &str) -> Result<OpksshLoginOperation, String> {
    let entry = {
        let registry = login_operations().lock().await;
        registry
            .get(operation_id)
            .cloned()
            .ok_or_else(|| format!("OPKSSH login operation '{operation_id}' was not found"))?
    };

    let task = {
        let mut pending = entry.lock().await;
        if pending.task.is_none() {
            return Ok(pending.snapshot.clone());
        }

        pending.snapshot.can_cancel = false;
        pending.task.take().expect("checked task presence above")
    };

    let outcome = task
        .await
        .map_err(|err| format!("OPKSSH login operation task failed: {err}"))?;

    let mut pending = entry.lock().await;
    finalize_operation(&mut pending.snapshot, outcome);
    Ok(pending.snapshot.clone())
}

pub async fn cancel_login_operation(operation_id: &str) -> Result<OpksshLoginOperation, String> {
    let entry = {
        let registry = login_operations().lock().await;
        registry
            .get(operation_id)
            .cloned()
            .ok_or_else(|| format!("OPKSSH login operation '{operation_id}' was not found"))?
    };

    let mut pending = entry.lock().await;
    if let Some(task) = pending.task.take() {
        task.abort();
        mark_operation_cancelled(&mut pending.snapshot);
    }

    Ok(pending.snapshot.clone())
}

pub async fn run_login_operation(
    service_state: OpksshServiceState,
    opts: OpksshLoginOptions,
) -> Result<OpksshLoginResult, String> {
    let operation = start_login_operation(service_state, opts).await?;
    let completed = await_login_operation(&operation.id).await?;

    if let Some(result) = completed.result {
        return Ok(result);
    }

    Err(completed
        .message
        .unwrap_or_else(|| "OPKSSH login did not produce a result".to_string()))
}

/// Build the command-line arguments for `opkssh login`.
pub fn build_login_args(opts: &OpksshLoginOptions) -> Vec<String> {
    let mut args = vec!["login".to_string()];

    // Provider flag: --provider="issuer,client_id[,client_secret][,scopes]"
    if let Some(ref provider) = opts.provider {
        // Simple alias like "google", "azure", etc.
        if opts.issuer.is_none() && opts.client_id.is_none() {
            args.push(provider.clone());
        }
    }

    if let Some(ref issuer) = opts.issuer {
        let mut provider_str = issuer.clone();
        if let Some(ref cid) = opts.client_id {
            provider_str = format!("{},{}", provider_str, cid);
            if let Some(ref secret) = opts.client_secret {
                provider_str = format!("{},{}", provider_str, secret);
            } else if opts.scopes.is_some() {
                // Need empty secret placeholder to set scopes
                provider_str = format!("{},", provider_str);
            }
            if let Some(ref scopes) = opts.scopes {
                provider_str = format!("{},{}", provider_str, scopes);
            }
        }
        args.push(format!("--provider={}", provider_str));
    }

    if let Some(ref key_name) = opts.key_file_name {
        args.push(format!("--key-file-name={}", key_name));
    }

    if opts.create_config {
        args.push("--create-config".to_string());
    }

    if let Some(ref uri) = opts.remote_redirect_uri {
        args.push(format!("--remote-redirect-uri={}", uri));
    }

    args
}

/// Execute `opkssh login` and parse the result.
pub async fn execute_login(
    binary_path: &PathBuf,
    opts: &OpksshLoginOptions,
) -> Result<OpksshLoginResult, String> {
    let args = build_login_args(opts);
    let args_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();

    info!("Executing opkssh login with args: {:?}", args_refs);

    let start = std::time::Instant::now();
    let output = Command::new(binary_path)
        .args(&args_refs)
        .output()
        .await
        .map_err(|e| format!("Failed to execute opkssh login: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let raw_output = format!("{}\n{}", stdout, stderr);
    let _duration = start.elapsed();

    if !output.status.success() {
        return Ok(OpksshLoginResult {
            success: false,
            key_path: None,
            identity: None,
            provider: opts.provider.clone(),
            expires_at: None,
            message: format!("Login failed: {}", stderr.trim()),
            raw_output,
        });
    }

    // Parse the output to extract key path and identity
    let key_path = parse_key_path(&raw_output, opts);
    let identity = parse_identity(&raw_output);
    // Default: keys expire after 24 hours
    let expires_at = Some(Utc::now() + Duration::hours(24));

    Ok(OpksshLoginResult {
        success: true,
        key_path,
        identity,
        provider: opts.provider.clone(),
        expires_at,
        message: "Login successful".to_string(),
        raw_output,
    })
}

/// Parse key path from login output.
fn parse_key_path(output: &str, opts: &OpksshLoginOptions) -> Option<String> {
    // Look for path mentions in output
    for line in output.lines() {
        let lower = line.to_lowercase();
        if lower.contains("id_ecdsa") || lower.contains("key") && lower.contains("written") {
            // Try to extract a file path
            if let Some(path) = extract_path_from_line(line) {
                return Some(path);
            }
        }
    }

    // Fall back to default path
    let key_name = opts.key_file_name.as_deref().unwrap_or("id_ecdsa");

    dirs::home_dir().map(|h| h.join(".ssh").join(key_name).to_string_lossy().to_string())
}

/// Extract a file path from a log line.
fn extract_path_from_line(line: &str) -> Option<String> {
    // Look for paths like /home/user/.ssh/id_ecdsa or C:\Users\...
    let tokens: Vec<&str> = line.split_whitespace().collect();
    for token in tokens {
        let cleaned = token.trim_matches(|c: char| c == '\'' || c == '"' || c == '`');
        if cleaned.contains(".ssh") || cleaned.contains("id_ecdsa") || cleaned.contains("id_") {
            return Some(cleaned.to_string());
        }
    }
    None
}

/// Parse identity (email) from login output.
fn parse_identity(output: &str) -> Option<String> {
    for line in output.lines() {
        let lower = line.to_lowercase();
        if lower.contains("authenticated") || lower.contains("identity") || lower.contains("email")
        {
            // Look for something that looks like an email
            for token in line.split_whitespace() {
                let cleaned = token.trim_matches(|c: char| {
                    !c.is_alphanumeric() && c != '@' && c != '.' && c != '-' && c != '_'
                });
                if cleaned.contains('@') && cleaned.contains('.') {
                    return Some(cleaned.to_string());
                }
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_runtime_status() -> OpksshRuntimeStatus {
        let cli_backend = OpksshBackendStatus {
            kind: OpksshBackendKind::Cli,
            available: true,
            availability: OpksshRuntimeAvailability::Available,
            version: Some("opkssh v0.13.0".to_string()),
            path: Some("/usr/bin/opkssh".to_string()),
            message: None,
            login_supported: true,
            config_load_supported: false,
            provider_owns_callback_listener: true,
            provider_owns_callback_shutdown: true,
            bundle_contract: None,
        };

        OpksshRuntimeStatus {
            mode: OpksshBackendMode::Auto,
            active_backend: Some(OpksshBackendKind::Cli),
            using_fallback: true,
            library: OpksshBackendStatus {
                kind: OpksshBackendKind::Library,
                available: false,
                availability: OpksshRuntimeAvailability::Planned,
                version: None,
                path: None,
                message: Some("libopkssh is not linked yet".to_string()),
                login_supported: false,
                config_load_supported: false,
                provider_owns_callback_listener: true,
                provider_owns_callback_shutdown: true,
                bundle_contract: None,
            },
            cli: OpksshBinaryStatus {
                installed: true,
                path: Some("/usr/bin/opkssh".to_string()),
                version: Some("opkssh v0.13.0".to_string()),
                platform: "linux".to_string(),
                arch: "amd64".to_string(),
                download_url: Some("https://example.invalid/opkssh".to_string()),
                backend: cli_backend,
            },
            message: Some(
                "The in-process OPKSSH runtime is not linked yet; CLI fallback is active."
                    .to_string(),
            ),
        }
    }

    fn running_operation() -> OpksshLoginOperation {
        OpksshLoginOperation {
            id: "op-1".to_string(),
            status: OpksshLoginOperationStatus::Running,
            provider: Some("google".to_string()),
            runtime: test_runtime_status(),
            browser_url: None,
            can_cancel: true,
            message: None,
            result: None,
            started_at: Utc::now(),
            finished_at: None,
        }
    }

    #[test]
    fn test_build_login_args_simple_alias() {
        let opts = OpksshLoginOptions {
            provider: Some("google".into()),
            ..Default::default()
        };
        let args = build_login_args(&opts);
        assert_eq!(args, vec!["login", "google"]);
    }

    #[test]
    fn test_build_login_args_custom_provider() {
        let opts = OpksshLoginOptions {
            issuer: Some("https://auth.example.com".into()),
            client_id: Some("my-client".into()),
            scopes: Some("openid profile email".into()),
            ..Default::default()
        };
        let args = build_login_args(&opts);
        assert!(args.contains(
            &"--provider=https://auth.example.com,my-client,,openid profile email".to_string()
        ));
    }

    #[test]
    fn test_build_login_args_key_file() {
        let opts = OpksshLoginOptions {
            provider: Some("google".into()),
            key_file_name: Some("my_key".into()),
            ..Default::default()
        };
        let args = build_login_args(&opts);
        assert!(args.contains(&"login".to_string()));
        assert!(args.contains(&"--key-file-name=my_key".to_string()));
    }

    #[test]
    fn test_build_login_args_create_config() {
        let opts = OpksshLoginOptions {
            create_config: true,
            ..Default::default()
        };
        let args = build_login_args(&opts);
        assert!(args.contains(&"--create-config".to_string()));
    }

    #[test]
    fn test_finalize_operation_success() {
        let mut operation = running_operation();
        finalize_operation(
            &mut operation,
            Ok(OpksshLoginResult {
                success: true,
                key_path: Some("/tmp/id_ecdsa".to_string()),
                identity: Some("user@example.com".to_string()),
                provider: Some("google".to_string()),
                expires_at: None,
                message: "Login successful".to_string(),
                raw_output: String::new(),
            }),
        );

        assert_eq!(operation.status, OpksshLoginOperationStatus::Succeeded);
        assert!(!operation.can_cancel);
        assert!(operation.finished_at.is_some());
        assert_eq!(operation.message.as_deref(), Some("Login successful"));
        assert!(operation
            .result
            .as_ref()
            .is_some_and(|result| result.success));
    }

    #[test]
    fn test_finalize_operation_error() {
        let mut operation = running_operation();
        finalize_operation(
            &mut operation,
            Err("Library mode is requested, but the in-process OPKSSH runtime is not linked yet; CLI fallback is unavailable.".to_string()),
        );

        assert_eq!(operation.status, OpksshLoginOperationStatus::Failed);
        assert!(!operation.can_cancel);
        assert!(operation.finished_at.is_some());
        assert!(operation.result.is_none());
        assert!(operation
            .message
            .as_deref()
            .is_some_and(|message| message.contains("not linked yet")));
    }

    #[test]
    fn test_mark_operation_cancelled() {
        let mut operation = running_operation();
        mark_operation_cancelled(&mut operation);

        assert_eq!(operation.status, OpksshLoginOperationStatus::Cancelled);
        assert!(!operation.can_cancel);
        assert!(operation.finished_at.is_some());
        assert!(operation.result.is_none());
        assert!(operation
            .message
            .as_deref()
            .is_some_and(|message| message.contains("provider-owned")));
    }
}
