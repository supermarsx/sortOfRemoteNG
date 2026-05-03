//! # opkssh Binary Management
//!
//! Detect, validate, and download the opkssh binary.

use crate::types::*;
use chrono::{DateTime, Utc};
use libloading::Library;
use log::{debug, info, warn};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::ffi::{c_char, CStr, CString};
use std::path::{Path, PathBuf};
use std::ptr;
use std::sync::{Mutex, OnceLock};
use tokio::process::Command;

/// Known download URLs for opkssh releases.
const RELEASE_BASE: &str = "https://github.com/openpubkey/opkssh/releases/latest/download";
const CLI_UNAVAILABLE_MESSAGE: &str =
    "opkssh CLI fallback was not found in PATH or common install locations.";
const BUNDLE_RESOURCE_ROOT: &str = "opkssh";
const VENDOR_LIBRARY_OVERRIDE_ENV: &str = "SORNG_OPKSSH_VENDOR_LIBRARY";

#[derive(Debug, Clone)]
struct VendorWrapperRuntimeStatus {
    abi_version: u32,
    embedded_runtime_present: bool,
    backend_callable: bool,
    config_load_supported: bool,
    login_supported: bool,
    artifact_name: String,
    platform_dir: String,
    resource_relative_path: String,
    load_strategy: OpksshVendorLoadStrategy,
    loaded_artifact_path: Option<String>,
}

#[derive(Debug, Clone, Default)]
struct VendorWrapperProbeResult {
    runtime: Option<VendorWrapperRuntimeStatus>,
    load_error: Option<String>,
}

#[cfg(feature = "vendored-wrapper")]
fn linked_vendor_wrapper_status() -> Option<VendorWrapperRuntimeStatus> {
    Some(VendorWrapperRuntimeStatus {
        abi_version: sorng_opkssh_vendor::abi_version(),
        embedded_runtime_present: sorng_opkssh_vendor::embedded_runtime_present(),
        backend_callable: sorng_opkssh_vendor::backend_callable(),
        config_load_supported: sorng_opkssh_vendor::config_load_supported(),
        login_supported: sorng_opkssh_vendor::login_supported(),
        artifact_name: sorng_opkssh_vendor::artifact_name().to_string(),
        platform_dir: sorng_opkssh_vendor::platform_dir().to_string(),
        resource_relative_path: sorng_opkssh_vendor::resource_relative_path(),
        load_strategy: OpksshVendorLoadStrategy::LinkedFeature,
        loaded_artifact_path: None,
    })
}

#[cfg(not(feature = "vendored-wrapper"))]
fn linked_vendor_wrapper_status() -> Option<VendorWrapperRuntimeStatus> {
    None
}

type VendorProbeFn = unsafe extern "C" fn() -> u32;
type VendorLoginFn = unsafe extern "C" fn(*const c_char) -> *mut c_char;
type VendorLoadClientConfigFn = unsafe extern "C" fn(*const c_char) -> *mut c_char;
type VendorFreeStringFn = unsafe extern "C" fn(*mut c_char);

#[derive(Debug)]
enum VendorConfigLoadAttempt {
    NoRuntimeWrapper,
    Unsupported,
    Response(String),
}

#[derive(Debug)]
enum VendorLoginAttempt {
    NoRuntimeWrapper,
    Unsupported,
    Response(String),
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VendorClientConfigEnvelope {
    ok: bool,
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    config: Option<VendorClientConfigPayload>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VendorClientConfigPayload {
    config_path: String,
    #[serde(default)]
    default_provider: Option<String>,
    #[serde(default)]
    providers: Vec<VendorProviderPayload>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VendorProviderPayload {
    #[serde(default)]
    aliases: Vec<String>,
    issuer: String,
    client_id: String,
    #[serde(default)]
    client_secret: String,
    #[serde(default)]
    scopes: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct VendorLoginRequestPayload {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    config_path: Option<String>,
    create_config: bool,
    key_path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    provider: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    issuer: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    client_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    client_secret: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    scopes: Option<String>,
    key_type: &'static str,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    remote_redirect_uri: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VendorLoginEnvelope {
    ok: bool,
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    result: Option<VendorLoginPayload>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VendorLoginPayload {
    success: bool,
    #[serde(default)]
    provider: Option<String>,
    #[serde(default)]
    identity: Option<String>,
    #[serde(default)]
    key_path: Option<String>,
    #[serde(default)]
    expires_at: Option<String>,
    #[serde(default)]
    message: Option<String>,
}

fn vendor_load_strategy_label(strategy: &OpksshVendorLoadStrategy) -> &'static str {
    match strategy {
        OpksshVendorLoadStrategy::LinkedFeature => "the compile-linked wrapper feature",
        OpksshVendorLoadStrategy::OverridePath => "an explicit override path",
        OpksshVendorLoadStrategy::PackagedResource => "a packaged Tauri resource",
        OpksshVendorLoadStrategy::WorkspaceBundle => "the staged workspace bundle",
    }
}

fn vendor_override_library_path() -> Option<PathBuf> {
    let raw = std::env::var_os(VENDOR_LIBRARY_OVERRIDE_ENV)?;
    let candidate = PathBuf::from(raw);
    if candidate.is_dir() {
        let direct = candidate.join(vendor_artifact_name());
        if direct.is_file() {
            return Some(direct);
        }

        return Some(
            candidate
                .join(vendor_platform_dir())
                .join(vendor_artifact_name()),
        );
    }

    Some(candidate)
}

fn packaged_resource_bundle_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    let Ok(exe_path) = std::env::current_exe() else {
        return roots;
    };

    let Some(exe_dir) = exe_path.parent() else {
        return roots;
    };

    if cfg!(target_os = "macos") {
        if let Some(contents_dir) = exe_dir.parent() {
            roots.push(contents_dir.join("Resources").join(BUNDLE_RESOURCE_ROOT));
        }
    }

    roots.push(exe_dir.join("resources").join(BUNDLE_RESOURCE_ROOT));
    roots
}

fn vendor_artifact_path_for_root(root: &Path, platform_dir: &str, artifact_name: &str) -> PathBuf {
    root.join(platform_dir).join(artifact_name)
}

fn vendor_wrapper_candidate_paths(
    workspace_bundle_root: &Path,
) -> Vec<(OpksshVendorLoadStrategy, PathBuf)> {
    let mut candidates = Vec::new();
    for root in packaged_resource_bundle_roots() {
        candidates.push((
            OpksshVendorLoadStrategy::PackagedResource,
            vendor_artifact_path_for_root(&root, &vendor_platform_dir(), vendor_artifact_name()),
        ));
    }
    candidates.push((
        OpksshVendorLoadStrategy::WorkspaceBundle,
        vendor_artifact_path_for_root(
            workspace_bundle_root,
            &vendor_platform_dir(),
            vendor_artifact_name(),
        ),
    ));
    candidates
}

fn pinned_vendor_library_cache() -> &'static Mutex<HashMap<PathBuf, usize>> {
    static CACHE: OnceLock<Mutex<HashMap<PathBuf, usize>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn vendor_library_cache_key(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
}

fn pinned_vendor_library(path: &Path) -> Result<&'static Library, String> {
    let cache_key = vendor_library_cache_key(path);
    let mut cache = pinned_vendor_library_cache()
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());

    if let Some(pointer) = cache.get(&cache_key).copied() {
        // SAFETY: The pointer comes from `Box::leak` below and remains valid for
        // the lifetime of the process.
        return Ok(unsafe { &*(pointer as *const Library) });
    }

    // SAFETY: Loading the wrapper DLL/so/dylib is the same dynamic-link action
    // required for the runtime bridge. We intentionally pin successful loads
    // for process lifetime because unloading the real Go-backed bridge can crash
    // on Windows when `FreeLibrary` runs after cgo/Go runtime initialization.
    let library = unsafe { Library::new(&cache_key) }.map_err(|error| {
        format!(
            "Failed to load OPKSSH vendor wrapper {}: {error}",
            path.display()
        )
    })?;
    let leaked = Box::leak(Box::new(library));
    cache.insert(cache_key, leaked as *const Library as usize);
    Ok(leaked)
}

fn load_vendor_probe_u32(
    library: &Library,
    symbol_name: &[u8],
    path: &Path,
) -> Result<u32, String> {
    // SAFETY: The OPKSSH vendor wrapper exports a narrow, side-effect-free C ABI
    // of zero-arg probe functions that return a u32. We call only those symbols
    // against a handle that stays pinned for the lifetime of the process.
    unsafe {
        let symbol: libloading::Symbol<'_, VendorProbeFn> =
            library.get(symbol_name).map_err(|error| {
                format!(
                    "Failed to load symbol {} from {}: {error}",
                    String::from_utf8_lossy(symbol_name).trim_end_matches('\0'),
                    path.display(),
                )
            })?;
        Ok(symbol())
    }
}

fn load_optional_vendor_probe_u32(library: &Library, symbol_name: &[u8]) -> Option<u32> {
    // SAFETY: Optional probe symbols use the same zero-arg `u32` contract as
    // the mandatory wrapper metadata probes. Missing symbols simply mean this
    // wrapper build predates that capability advertisement.
    unsafe {
        library
            .get::<VendorProbeFn>(symbol_name)
            .ok()
            .map(|symbol| symbol())
    }
}

fn load_vendor_wrapper_from_path(
    path: &Path,
    load_strategy: OpksshVendorLoadStrategy,
) -> Result<VendorWrapperRuntimeStatus, String> {
    let library = pinned_vendor_library(path)?;

    let abi_version = load_vendor_probe_u32(&library, b"sorng_opkssh_vendor_abi_version\0", path)?;
    let embedded_runtime_present =
        load_vendor_probe_u32(&library, b"sorng_opkssh_vendor_embedded_runtime\0", path)? != 0;
    let backend_callable =
        load_vendor_probe_u32(&library, b"sorng_opkssh_vendor_backend_callable\0", path)? != 0;
    let config_load_supported =
        load_optional_vendor_probe_u32(&library, b"sorng_opkssh_vendor_config_load_supported\0")
            .is_some_and(|supported| supported != 0);
    let login_supported =
        load_optional_vendor_probe_u32(&library, b"sorng_opkssh_vendor_login_supported\0")
            .is_some_and(|supported| supported != 0);

    Ok(VendorWrapperRuntimeStatus {
        abi_version,
        embedded_runtime_present,
        backend_callable,
        config_load_supported,
        login_supported,
        artifact_name: path
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| vendor_artifact_name().to_string()),
        platform_dir: vendor_platform_dir(),
        resource_relative_path: vendor_resource_relative_path(),
        load_strategy,
        loaded_artifact_path: Some(path.to_string_lossy().to_string()),
    })
}

fn runtime_loaded_vendor_wrapper_status(workspace_bundle_root: &Path) -> VendorWrapperProbeResult {
    if let Some(override_path) = vendor_override_library_path() {
        return match load_vendor_wrapper_from_path(
            &override_path,
            OpksshVendorLoadStrategy::OverridePath,
        ) {
            Ok(runtime) => VendorWrapperProbeResult {
                runtime: Some(runtime),
                load_error: None,
            },
            Err(error) => VendorWrapperProbeResult {
                runtime: None,
                load_error: Some(error),
            },
        };
    }

    let mut first_error = None;
    for (load_strategy, candidate_path) in vendor_wrapper_candidate_paths(workspace_bundle_root) {
        if !candidate_path.is_file() {
            continue;
        }

        match load_vendor_wrapper_from_path(&candidate_path, load_strategy) {
            Ok(runtime) => {
                return VendorWrapperProbeResult {
                    runtime: Some(runtime),
                    load_error: None,
                }
            }
            Err(error) => {
                if first_error.is_none() {
                    first_error = Some(error);
                }
            }
        }
    }

    VendorWrapperProbeResult {
        runtime: None,
        load_error: first_error,
    }
}

fn queried_vendor_wrapper_status(workspace_bundle_root: &Path) -> VendorWrapperProbeResult {
    let runtime_probe = runtime_loaded_vendor_wrapper_status(workspace_bundle_root);
    if runtime_probe.runtime.is_some() {
        return runtime_probe;
    }

    if let Some(runtime) = linked_vendor_wrapper_status() {
        return VendorWrapperProbeResult {
            runtime: Some(runtime),
            load_error: runtime_probe.load_error,
        };
    }

    runtime_probe
}

fn vendor_client_config_from_json(json: &str) -> Result<OpksshClientConfig, String> {
    let envelope: VendorClientConfigEnvelope = serde_json::from_str(json)
        .map_err(|error| format!("Failed to parse OPKSSH vendor config envelope: {error}"))?;

    if !envelope.ok {
        return Err(envelope.error.unwrap_or_else(|| {
            "OPKSSH vendor config load failed without an error message".to_string()
        }));
    }

    let payload = envelope.config.ok_or_else(|| {
        "OPKSSH vendor config envelope did not include a config payload".to_string()
    })?;

    let providers = payload
        .providers
        .into_iter()
        .map(|provider| {
            let client_secret =
                (!provider.client_secret.trim().is_empty()).then_some(provider.client_secret);

            CustomProvider {
                alias: if provider.aliases.is_empty() {
                    provider.issuer.clone()
                } else {
                    provider.aliases.join(" ")
                },
                issuer: provider.issuer,
                client_id: provider.client_id,
                client_secret_present: client_secret.is_some(),
                client_secret_redacted: false,
                client_secret,
                scopes: (!provider.scopes.is_empty()).then_some(provider.scopes.join(" ")),
            }
        })
        .collect();

    let mut config = OpksshClientConfig {
        config_path: payload.config_path,
        default_provider: payload
            .default_provider
            .filter(|value| !value.trim().is_empty()),
        providers,
        provider_secrets_present: false,
        secrets_redacted_for_transport: false,
        secret_storage_note: None,
    };
    config.normalize_secret_metadata();
    Ok(config)
}

fn load_client_config_json_from_library_path(
    library_path: &Path,
    explicit_path: Option<&Path>,
) -> Result<Option<String>, String> {
    let library = pinned_vendor_library(library_path)?;

    let config_load_supported =
        load_optional_vendor_probe_u32(&library, b"sorng_opkssh_vendor_config_load_supported\0")
            .is_some_and(|supported| supported != 0);
    if !config_load_supported {
        return Ok(None);
    }

    let load_fn: libloading::Symbol<'_, VendorLoadClientConfigFn> = unsafe {
        library
            .get(b"sorng_opkssh_vendor_load_client_config_json\0")
            .map_err(|error| {
                format!(
                    "Failed to load config bridge symbol from {}: {error}",
                    library_path.display()
                )
            })?
    };
    let free_fn: libloading::Symbol<'_, VendorFreeStringFn> = unsafe {
        library
            .get(b"sorng_opkssh_vendor_free_string\0")
            .map_err(|error| {
                format!(
                    "Failed to load config bridge free helper from {}: {error}",
                    library_path.display()
                )
            })?
    };

    let explicit_path = explicit_path
        .map(|path| CString::new(path.to_string_lossy().to_string()))
        .transpose()
        .map_err(|_| "client-config path contains an interior NUL byte".to_string())?;

    let response = unsafe {
        load_fn(
            explicit_path
                .as_ref()
                .map_or(ptr::null(), |path| path.as_ptr()),
        )
    };
    if response.is_null() {
        return Err(format!(
            "OPKSSH vendor wrapper {} returned a null config response",
            library_path.display()
        ));
    }

    let json = unsafe { CStr::from_ptr(response) }
        .to_string_lossy()
        .into_owned();
    unsafe { free_fn(response) };
    Ok(Some(json))
}

fn load_login_json_from_library_path(
    library_path: &Path,
    request_json: &str,
) -> Result<Option<String>, String> {
    let library = pinned_vendor_library(library_path)?;

    let login_supported =
        load_optional_vendor_probe_u32(&library, b"sorng_opkssh_vendor_login_supported\0")
            .is_some_and(|supported| supported != 0);
    if !login_supported {
        return Ok(None);
    }

    let load_fn: libloading::Symbol<'_, VendorLoginFn> = unsafe {
        library
            .get(b"sorng_opkssh_vendor_login_json\0")
            .map_err(|error| {
                format!(
                    "Failed to load login bridge symbol from {}: {error}",
                    library_path.display()
                )
            })?
    };
    let free_fn: libloading::Symbol<'_, VendorFreeStringFn> = unsafe {
        library
            .get(b"sorng_opkssh_vendor_free_string\0")
            .map_err(|error| {
                format!(
                    "Failed to load login bridge free helper from {}: {error}",
                    library_path.display()
                )
            })?
    };

    let request_json = CString::new(request_json)
        .map_err(|_| "embedded login request contains an interior NUL byte".to_string())?;

    let response = unsafe { load_fn(request_json.as_ptr()) };
    if response.is_null() {
        return Err(format!(
            "OPKSSH vendor wrapper {} returned a null login response",
            library_path.display()
        ));
    }

    let json = unsafe { CStr::from_ptr(response) }
        .to_string_lossy()
        .into_owned();
    unsafe { free_fn(response) };
    Ok(Some(json))
}

fn runtime_loaded_client_config_json(
    workspace_bundle_root: &Path,
    explicit_path: Option<&Path>,
) -> Result<VendorConfigLoadAttempt, String> {
    if let Some(override_path) = vendor_override_library_path() {
        return load_client_config_json_from_library_path(&override_path, explicit_path).map(
            |response| {
                response
                    .map(VendorConfigLoadAttempt::Response)
                    .unwrap_or(VendorConfigLoadAttempt::Unsupported)
            },
        );
    }

    for (_strategy, candidate_path) in vendor_wrapper_candidate_paths(workspace_bundle_root) {
        if !candidate_path.is_file() {
            continue;
        }

        return load_client_config_json_from_library_path(&candidate_path, explicit_path).map(
            |response| {
                response
                    .map(VendorConfigLoadAttempt::Response)
                    .unwrap_or(VendorConfigLoadAttempt::Unsupported)
            },
        );
    }

    Ok(VendorConfigLoadAttempt::NoRuntimeWrapper)
}

fn runtime_loaded_login_json(
    workspace_bundle_root: &Path,
    request_json: &str,
) -> Result<VendorLoginAttempt, String> {
    if let Some(override_path) = vendor_override_library_path() {
        return load_login_json_from_library_path(&override_path, request_json).map(|response| {
            response
                .map(VendorLoginAttempt::Response)
                .unwrap_or(VendorLoginAttempt::Unsupported)
        });
    }

    for (_strategy, candidate_path) in vendor_wrapper_candidate_paths(workspace_bundle_root) {
        if !candidate_path.is_file() {
            continue;
        }

        return load_login_json_from_library_path(&candidate_path, request_json).map(|response| {
            response
                .map(VendorLoginAttempt::Response)
                .unwrap_or(VendorLoginAttempt::Unsupported)
        });
    }

    Ok(VendorLoginAttempt::NoRuntimeWrapper)
}

#[cfg(feature = "vendored-wrapper")]
fn linked_client_config_json(explicit_path: Option<&Path>) -> Result<Option<String>, String> {
    if !sorng_opkssh_vendor::config_load_supported() {
        return Ok(None);
    }

    let explicit_path = explicit_path.map(|path| path.to_string_lossy().to_string());
    sorng_opkssh_vendor::load_client_config_json(explicit_path.as_deref()).map(Some)
}

#[cfg(not(feature = "vendored-wrapper"))]
fn linked_client_config_json(explicit_path: Option<&Path>) -> Result<Option<String>, String> {
    let _ = explicit_path;
    Ok(None)
}

#[cfg(feature = "vendored-wrapper")]
fn linked_login_json(request_json: &str) -> Result<Option<String>, String> {
    if !sorng_opkssh_vendor::login_supported() {
        return Ok(None);
    }

    sorng_opkssh_vendor::login_json(request_json).map(Some)
}

#[cfg(not(feature = "vendored-wrapper"))]
fn linked_login_json(request_json: &str) -> Result<Option<String>, String> {
    let _ = request_json;
    Ok(None)
}

pub(crate) fn load_client_config_from_wrapper(
    explicit_path: Option<&Path>,
) -> Result<Option<OpksshClientConfig>, String> {
    let workspace_bundle_root = library_workspace_bundle_root();

    match runtime_loaded_client_config_json(&workspace_bundle_root, explicit_path)? {
        VendorConfigLoadAttempt::Response(json) => {
            return vendor_client_config_from_json(&json).map(Some)
        }
        VendorConfigLoadAttempt::Unsupported => return Ok(None),
        VendorConfigLoadAttempt::NoRuntimeWrapper => {}
    }

    if let Some(json) = linked_client_config_json(explicit_path)? {
        return vendor_client_config_from_json(&json).map(Some);
    }

    Ok(None)
}

fn vendor_login_result_from_json(json: &str) -> Result<OpksshLoginResult, String> {
    let envelope: VendorLoginEnvelope = serde_json::from_str(json)
        .map_err(|error| format!("Failed to parse OPKSSH vendor login envelope: {error}"))?;

    if !envelope.ok {
        return Err(envelope
            .error
            .unwrap_or_else(|| "OPKSSH vendor login failed without an error message".to_string()));
    }

    let payload = envelope.result.ok_or_else(|| {
        "OPKSSH vendor login envelope did not include a result payload".to_string()
    })?;

    let expires_at =
        payload
            .expires_at
            .as_deref()
            .and_then(|value| match DateTime::parse_from_rfc3339(value) {
                Ok(parsed) => Some(parsed.with_timezone(&Utc)),
                Err(error) => {
                    warn!("Failed to parse OPKSSH vendor login expiry '{value}': {error}");
                    None
                }
            });

    Ok(OpksshLoginResult {
        success: payload.success,
        key_path: payload.key_path.filter(|value| !value.trim().is_empty()),
        identity: payload.identity.filter(|value| !value.trim().is_empty()),
        provider: payload.provider.filter(|value| !value.trim().is_empty()),
        expires_at,
        message: payload.message.unwrap_or_else(|| {
            if payload.success {
                "Login successful".to_string()
            } else {
                "Login failed".to_string()
            }
        }),
        raw_output: String::new(),
    })
}

fn build_vendor_login_request_json(
    opts: &OpksshLoginOptions,
    config_path: Option<&Path>,
    key_path: &Path,
) -> Result<String, String> {
    serde_json::to_string(&VendorLoginRequestPayload {
        config_path: config_path.map(|path| path.to_string_lossy().to_string()),
        create_config: opts.create_config,
        key_path: key_path.to_string_lossy().to_string(),
        provider: if opts.issuer.is_none() && opts.client_id.is_none() {
            opts.provider
                .clone()
                .filter(|value| !value.trim().is_empty())
        } else {
            None
        },
        issuer: opts.issuer.clone().filter(|value| !value.trim().is_empty()),
        client_id: opts
            .client_id
            .clone()
            .filter(|value| !value.trim().is_empty()),
        client_secret: opts
            .client_secret
            .clone()
            .filter(|value| !value.trim().is_empty()),
        scopes: opts.scopes.clone().filter(|value| !value.trim().is_empty()),
        key_type: "ecdsa",
        remote_redirect_uri: opts
            .remote_redirect_uri
            .clone()
            .filter(|value| !value.trim().is_empty()),
    })
    .map_err(|error| format!("Failed to encode OPKSSH vendor login request: {error}"))
}

pub(crate) fn execute_login_from_wrapper(
    opts: &OpksshLoginOptions,
    config_path: Option<&Path>,
    key_path: &Path,
) -> Result<Option<OpksshLoginResult>, String> {
    let request_json = build_vendor_login_request_json(opts, config_path, key_path)?;
    let workspace_bundle_root = library_workspace_bundle_root();

    match runtime_loaded_login_json(&workspace_bundle_root, &request_json)? {
        VendorLoginAttempt::Response(json) => {
            return vendor_login_result_from_json(&json).map(Some)
        }
        VendorLoginAttempt::Unsupported => return Ok(None),
        VendorLoginAttempt::NoRuntimeWrapper => {}
    }

    if let Some(json) = linked_login_json(&request_json)? {
        return vendor_login_result_from_json(&json).map(Some);
    }

    Ok(None)
}

/// Narrow backend boundary for runtime selection inside `sorng-opkssh`.
#[derive(Debug, Clone)]
pub(crate) enum OpksshBackend {
    Library,
    Cli { binary_path: PathBuf },
}

impl OpksshBackend {
    pub(crate) fn kind(&self) -> OpksshBackendKind {
        match self {
            Self::Library => OpksshBackendKind::Library,
            Self::Cli { .. } => OpksshBackendKind::Cli,
        }
    }

    pub(crate) fn binary_path(&self) -> Option<&PathBuf> {
        match self {
            Self::Library => None,
            Self::Cli { binary_path } => Some(binary_path),
        }
    }
}

#[derive(Debug, Clone)]
pub(crate) struct ResolvedBackendRuntime {
    pub(crate) runtime: OpksshRuntimeStatus,
    pub(crate) active_backend: Option<OpksshBackend>,
    pub(crate) cli_binary_path: Option<PathBuf>,
}

#[derive(Debug, Clone, Copy, Default)]
struct LibraryBackend;

#[derive(Debug, Clone, Copy, Default)]
struct CliBackend;

impl LibraryBackend {
    async fn status(self) -> OpksshBackendStatus {
        library_backend_status_from_root(&library_workspace_bundle_root())
    }
}

impl CliBackend {
    async fn status(self) -> (OpksshBinaryStatus, Option<PathBuf>) {
        check_cli_status().await
    }
}

/// Get the expected binary name for the current platform.
pub fn binary_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "opkssh.exe"
    } else {
        "opkssh"
    }
}

/// Get the download URL for the current platform.
pub fn download_url() -> String {
    let file = if cfg!(target_os = "windows") {
        "opkssh-windows-amd64.exe"
    } else if cfg!(target_os = "macos") {
        if cfg!(target_arch = "aarch64") {
            "opkssh-osx-arm64"
        } else {
            "opkssh-osx-amd64"
        }
    } else {
        // Linux
        if cfg!(target_arch = "aarch64") {
            "opkssh-linux-arm64"
        } else {
            "opkssh-linux-amd64"
        }
    };
    format!("{}/{}", RELEASE_BASE, file)
}

/// Platform string for status reporting.
pub fn platform() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    }
}

/// Architecture string for status reporting.
pub fn arch() -> &'static str {
    if cfg!(target_arch = "aarch64") {
        "arm64"
    } else {
        "amd64"
    }
}

/// Search for the opkssh binary in PATH and common locations.
pub async fn find_binary() -> Option<PathBuf> {
    // Try `which`/`where` first
    let cmd = if cfg!(target_os = "windows") {
        "where"
    } else {
        "which"
    };

    if let Ok(output) = Command::new(cmd).arg(binary_name()).output().await {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                let p = PathBuf::from(path.lines().next().unwrap_or(&path));
                if p.exists() {
                    return Some(p);
                }
            }
        }
    }

    // Check common installation paths
    let common_paths: Vec<PathBuf> = if cfg!(target_os = "windows") {
        vec![
            dirs::home_dir()
                .map(|h| h.join("opkssh.exe"))
                .unwrap_or_default(),
            PathBuf::from(r"C:\Program Files\opkssh\opkssh.exe"),
            PathBuf::from(r"C:\ProgramData\chocolatey\bin\opkssh.exe"),
        ]
    } else if cfg!(target_os = "macos") {
        vec![
            PathBuf::from("/usr/local/bin/opkssh"),
            PathBuf::from("/opt/homebrew/bin/opkssh"),
            dirs::home_dir()
                .map(|h| h.join("opkssh"))
                .unwrap_or_default(),
        ]
    } else {
        vec![
            PathBuf::from("/usr/local/bin/opkssh"),
            PathBuf::from("/usr/bin/opkssh"),
            dirs::home_dir()
                .map(|h| h.join("opkssh"))
                .unwrap_or_default(),
        ]
    };

    for p in common_paths {
        if p.exists() {
            return Some(p);
        }
    }

    None
}

/// Get the version of an opkssh binary.
pub async fn get_version(binary_path: &PathBuf) -> Option<String> {
    match Command::new(binary_path).arg("--version").output().await {
        Ok(output) => {
            let combined = format!(
                "{}{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            // opkssh typically prints something like "opkssh v0.13.0"
            let version = combined
                .lines()
                .find(|l| l.contains("opkssh") || l.starts_with('v') || l.contains('.'))
                .map(|l| l.trim().to_string())
                .or_else(|| {
                    let trimmed = combined.trim();
                    if !trimmed.is_empty() {
                        Some(trimmed.to_string())
                    } else {
                        None
                    }
                });
            debug!("opkssh version output: {:?}", version);
            version
        }
        Err(e) => {
            warn!("Failed to get opkssh version: {}", e);
            None
        }
    }
}

/// Check the full binary status.
pub async fn check_status() -> OpksshBinaryStatus {
    check_cli_status().await.0
}

async fn check_cli_status() -> (OpksshBinaryStatus, Option<PathBuf>) {
    let path = find_binary().await;
    let (installed, version, path_str) = if let Some(ref p) = path {
        let ver = get_version(p).await;
        (true, ver, Some(p.to_string_lossy().to_string()))
    } else {
        (false, None, None)
    };

    let backend = OpksshBackendStatus {
        kind: OpksshBackendKind::Cli,
        available: installed,
        availability: if installed {
            OpksshRuntimeAvailability::Available
        } else {
            OpksshRuntimeAvailability::Unavailable
        },
        version: version.clone(),
        path: path_str.clone(),
        message: if installed {
            None
        } else {
            Some(CLI_UNAVAILABLE_MESSAGE.to_string())
        },
        login_supported: installed,
        config_load_supported: false,
        provider_owns_callback_listener: true,
        provider_owns_callback_shutdown: true,
        bundle_contract: None,
    };

    (
        OpksshBinaryStatus {
            installed,
            path: path_str,
            version,
            platform: platform().to_string(),
            arch: arch().to_string(),
            download_url: Some(download_url()),
            backend,
        },
        path,
    )
}

fn vendor_artifact_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "sorng_opkssh_vendor.dll"
    } else if cfg!(target_os = "macos") {
        "libsorng_opkssh_vendor.dylib"
    } else {
        "libsorng_opkssh_vendor.so"
    }
}

fn vendor_platform_dir() -> String {
    format!("{}-{}", platform(), arch())
}

fn vendor_resource_relative_path() -> String {
    format!(
        "{}/{}/{}",
        BUNDLE_RESOURCE_ROOT,
        vendor_platform_dir(),
        vendor_artifact_name()
    )
}

fn backend_unavailability_reason(library: &OpksshBackendStatus) -> String {
    library.message.clone().unwrap_or_else(|| {
        "The in-process OPKSSH runtime is unavailable in this build.".to_string()
    })
}

fn with_runtime_suffix(reason: String, suffix: &str) -> String {
    if reason.ends_with('.') || reason.ends_with('!') || reason.ends_with('?') {
        format!("{reason} {suffix}")
    } else {
        format!("{reason}. {suffix}")
    }
}

fn library_mode_runtime_message(library: &OpksshBackendStatus, suffix: &str) -> String {
    format!(
        "Library mode is requested. {}",
        with_runtime_suffix(backend_unavailability_reason(library), suffix)
    )
}

fn library_bundle_contract_message(bundle_contract: &OpksshBundleArtifactStatus) -> String {
    let feature_hint = "Enable app feature `opkssh-vendored-wrapper` or crate feature `vendored-wrapper` to link the wrapper metadata into the build graph.";
    let bundle_hint = "Bundle staging is opt-in via `SORNG_ENABLE_OPKSSH_VENDOR_BUNDLE=1` or `npm run stage:opkssh-vendor -- --enable`.";
    let abi = bundle_contract
        .wrapper_abi_version
        .map(|version| format!(" ABI v{version}"))
        .unwrap_or_default();

    if bundle_contract.metadata_queryable {
        let source = match (
            bundle_contract.load_strategy.as_ref(),
            bundle_contract.loaded_artifact_path.as_deref(),
        ) {
            (Some(strategy), Some(path)) => {
                format!(
                    "loaded from {path} via {}",
                    vendor_load_strategy_label(strategy)
                )
            }
            (Some(strategy), None) => {
                format!("queried through {}", vendor_load_strategy_label(strategy))
            }
            (None, Some(path)) => format!("loaded from {path}"),
            (None, None) => "queried successfully".to_string(),
        };

        if !bundle_contract.embedded_runtime_present {
            return format!(
                "OPKSSH vendor wrapper{abi} was {source}, but it reports no embedded libopkssh runtime. Runtime metadata is available.",
            );
        }

        if !bundle_contract.backend_callable {
            return format!(
                "OPKSSH vendor wrapper{abi} was {source} and reports an embedded libopkssh runtime, but its backend ABI is not callable yet. Runtime metadata is available.",
            );
        }

        if !bundle_contract.config_load_supported {
            return format!(
                "OPKSSH vendor wrapper{abi} was {source} and reports a callable embedded runtime, but it does not expose the client-config bridge symbol yet. Runtime metadata is available.",
            );
        }

        if !bundle_contract.login_supported {
            return format!(
                "OPKSSH vendor wrapper{abi} was {source} and reports a callable embedded runtime with client-config load support, but it does not expose the login bridge symbol yet. Runtime metadata is available.",
            );
        }

        return format!(
            "OPKSSH vendor wrapper{abi} was {source} and reports a callable embedded runtime with client-config load and login support. Runtime metadata is available.",
        );
    }

    if let Some(load_error) = &bundle_contract.load_error {
        return format!(
            "OPKSSH vendor wrapper staging is configured for {} -> {}, but runtime loading failed: {} {}",
            bundle_contract.workspace_artifact_path,
            bundle_contract.resource_relative_path,
            load_error,
            bundle_hint,
        );
    }

    if !bundle_contract.app_linked {
        if bundle_contract.artifact_present {
            return format!(
                "OPKSSH vendor wrapper staging is configured and a staged artifact exists at {} for bundle resource {}, but the current build did not link the wrapper. {} {}",
                bundle_contract.workspace_artifact_path,
                bundle_contract.resource_relative_path,
                feature_hint,
                bundle_hint,
            );
        }

        return format!(
            "OPKSSH vendor wrapper staging is configured for {} -> {}, but the current build did not link the wrapper and no staged artifact is present yet. {} {}",
            bundle_contract.workspace_artifact_path,
            bundle_contract.resource_relative_path,
            feature_hint,
            bundle_hint,
        );
    }

    if !bundle_contract.embedded_runtime_present {
        if bundle_contract.artifact_present {
            return format!(
                "OPKSSH vendor wrapper{abi} is linked and staged at {} for bundle resource {}, but it reports no embedded libopkssh runtime. Wrapper metadata is available; backend calls remain disabled. {}",
                bundle_contract.workspace_artifact_path,
                bundle_contract.resource_relative_path,
                bundle_hint,
            );
        }

        return format!(
            "OPKSSH vendor wrapper{abi} is linked, but no staged artifact is present at {} for bundle resource {} and it reports no embedded libopkssh runtime. Wrapper metadata is available; backend calls remain disabled. {}",
            bundle_contract.workspace_artifact_path,
            bundle_contract.resource_relative_path,
            bundle_hint,
        );
    }

    if !bundle_contract.backend_callable {
        return format!(
            "OPKSSH vendor wrapper{abi} is linked and reports an embedded runtime, but the Rust-side library bridge is still disabled. Wrapper metadata is available; backend calls remain disabled. {}",
            bundle_hint,
        );
    }

    if !bundle_contract.config_load_supported {
        return format!(
            "OPKSSH vendor wrapper{abi} is linked and reports a callable embedded runtime, but the client-config bridge symbol is still unavailable. Wrapper metadata is available; login remains on CLI fallback. {}",
            bundle_hint,
        );
    }

    if !bundle_contract.login_supported {
        return format!(
            "OPKSSH vendor wrapper{abi} is linked and reports a callable embedded runtime with client-config load support, but the login bridge symbol is still unavailable. Wrapper metadata is available; login remains on CLI fallback. {}",
            bundle_hint,
        );
    }

    if bundle_contract.artifact_present {
        return format!(
            "OPKSSH vendor wrapper{abi} is linked, staged at {}, and reports a callable embedded runtime with client-config load and login support for bundle resource {}.",
            bundle_contract.workspace_artifact_path,
            bundle_contract.resource_relative_path,
        );
    }

    format!(
        "OPKSSH vendor wrapper{abi} is linked and reports a callable embedded runtime with client-config load and login support, but no staged bundle artifact is present at {} yet. {}",
        bundle_contract.workspace_artifact_path,
        bundle_hint,
    )
}

fn library_backend_message(
    bundle_contract: &OpksshBundleArtifactStatus,
    login_supported: bool,
) -> String {
    if bundle_contract.metadata_queryable {
        if bundle_contract.backend_callable && !login_supported {
            if bundle_contract.config_load_supported {
                return format!(
                    "{} sorng-opkssh can use the wrapper for typed client-config load at runtime, but the library login bridge is not implemented yet, so CLI fallback remains authoritative for login.",
                    bundle_contract.message.clone().unwrap_or_default(),
                );
            }

            return format!(
                "{} sorng-opkssh can query the wrapper at runtime, but the library login bridge is not implemented yet, so CLI fallback remains authoritative.",
                bundle_contract.message.clone().unwrap_or_default(),
            );
        }

        if bundle_contract.backend_callable && login_supported {
            return format!(
                "{} sorng-opkssh can execute login through the wrapper/runtime path.",
                bundle_contract.message.clone().unwrap_or_default(),
            );
        }

        return format!(
            "{} CLI fallback remains authoritative.",
            bundle_contract.message.clone().unwrap_or_default(),
        );
    }

    bundle_contract.message.clone().unwrap_or_else(|| {
        "The in-process OPKSSH runtime is unavailable in this build.".to_string()
    })
}

fn library_workspace_bundle_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("crates dir")
        .join("sorng-opkssh-vendor")
        .join("bundle")
        .join(BUNDLE_RESOURCE_ROOT)
}

fn library_bundle_contract_for_root(workspace_bundle_root: &Path) -> OpksshBundleArtifactStatus {
    let linked_wrapper = linked_vendor_wrapper_status();
    let probe = queried_vendor_wrapper_status(workspace_bundle_root);
    let queried_wrapper = probe.runtime.as_ref();
    let platform_dir = queried_wrapper
        .as_ref()
        .map(|status| status.platform_dir.clone())
        .unwrap_or_else(vendor_platform_dir);
    let artifact_name = queried_wrapper
        .as_ref()
        .map(|status| status.artifact_name.clone())
        .unwrap_or_else(|| vendor_artifact_name().to_string());
    let artifact_path =
        vendor_artifact_path_for_root(workspace_bundle_root, &platform_dir, &artifact_name);
    let artifact_present = artifact_path.is_file();
    let resource_relative_path = queried_wrapper
        .as_ref()
        .map(|status| status.resource_relative_path.clone())
        .unwrap_or_else(vendor_resource_relative_path);

    let mut bundle_contract = OpksshBundleArtifactStatus {
        dylib_required: true,
        tauri_bundle_configured: true,
        app_linked: linked_wrapper.is_some(),
        wrapper_abi_version: queried_wrapper.as_ref().map(|status| status.abi_version),
        workspace_bundle_dir: workspace_bundle_root.to_string_lossy().to_string(),
        workspace_artifact_path: artifact_path.to_string_lossy().to_string(),
        resource_relative_path,
        artifact_name,
        artifact_present,
        metadata_queryable: queried_wrapper.is_some(),
        load_strategy: queried_wrapper
            .as_ref()
            .map(|status| status.load_strategy.clone()),
        loaded_artifact_path: queried_wrapper
            .as_ref()
            .and_then(|status| status.loaded_artifact_path.clone()),
        embedded_runtime_present: queried_wrapper
            .as_ref()
            .is_some_and(|status| status.embedded_runtime_present),
        backend_callable: queried_wrapper
            .as_ref()
            .is_some_and(|status| status.backend_callable),
        config_load_supported: queried_wrapper
            .as_ref()
            .is_some_and(|status| status.config_load_supported),
        login_supported: queried_wrapper
            .as_ref()
            .is_some_and(|status| status.login_supported),
        load_error: probe.load_error,
        message: None,
    };
    bundle_contract.message = Some(library_bundle_contract_message(&bundle_contract));
    bundle_contract
}

fn library_backend_status_from_root(workspace_bundle_root: &Path) -> OpksshBackendStatus {
    let bundle_contract = library_bundle_contract_for_root(workspace_bundle_root);
    let login_supported = bundle_contract.backend_callable && bundle_contract.login_supported;
    let available = bundle_contract.backend_callable && login_supported;

    OpksshBackendStatus {
        kind: OpksshBackendKind::Library,
        available,
        availability: if available {
            OpksshRuntimeAvailability::Available
        } else if bundle_contract.metadata_queryable
            || bundle_contract.app_linked
            || bundle_contract.artifact_present
            || bundle_contract.load_error.is_some()
        {
            OpksshRuntimeAvailability::Unavailable
        } else {
            OpksshRuntimeAvailability::Planned
        },
        version: None,
        path: Some(
            bundle_contract
                .loaded_artifact_path
                .clone()
                .unwrap_or_else(|| bundle_contract.workspace_artifact_path.clone()),
        ),
        message: Some(library_backend_message(&bundle_contract, login_supported)),
        login_supported,
        config_load_supported: bundle_contract.config_load_supported,
        provider_owns_callback_listener: true,
        provider_owns_callback_shutdown: true,
        bundle_contract: Some(bundle_contract),
    }
}

pub(crate) async fn resolve_runtime(mode: OpksshBackendMode) -> ResolvedBackendRuntime {
    let library_backend = LibraryBackend;
    let cli_backend = CliBackend;

    let library = library_backend.status().await;
    let (cli, cli_binary_path) = cli_backend.status().await;
    let (active_backend, using_fallback, message) =
        select_active_backend(&mode, &library, &cli, cli_binary_path.as_ref());

    ResolvedBackendRuntime {
        runtime: OpksshRuntimeStatus {
            mode,
            active_backend: active_backend.as_ref().map(OpksshBackend::kind),
            using_fallback,
            library,
            cli,
            message,
        },
        active_backend,
        cli_binary_path,
    }
}

fn select_active_backend(
    mode: &OpksshBackendMode,
    library: &OpksshBackendStatus,
    cli: &OpksshBinaryStatus,
    cli_binary_path: Option<&PathBuf>,
) -> (Option<OpksshBackend>, bool, Option<String>) {
    match mode {
        OpksshBackendMode::Auto => {
            if library.available {
                (Some(OpksshBackend::Library), false, None)
            } else if cli.installed {
                (
                    cli_backend_from_path(cli_binary_path),
                    true,
                    Some(with_runtime_suffix(
                        backend_unavailability_reason(library),
                        "CLI fallback is active.",
                    )),
                )
            } else {
                (
                    None,
                    false,
                    Some(with_runtime_suffix(
                        backend_unavailability_reason(library),
                        "No CLI fallback is available.",
                    )),
                )
            }
        }
        OpksshBackendMode::Library => {
            if library.available {
                (Some(OpksshBackend::Library), false, None)
            } else if cli.installed {
                (
                    cli_backend_from_path(cli_binary_path),
                    true,
                    Some(library_mode_runtime_message(
                        library,
                        "CLI fallback is active.",
                    )),
                )
            } else {
                (
                    None,
                    false,
                    Some(library_mode_runtime_message(
                        library,
                        "No CLI fallback is available.",
                    )),
                )
            }
        }
        OpksshBackendMode::Cli => {
            if cli.installed {
                (cli_backend_from_path(cli_binary_path), false, None)
            } else {
                (None, false, Some(CLI_UNAVAILABLE_MESSAGE.to_string()))
            }
        }
    }
}

fn cli_backend_from_path(cli_binary_path: Option<&PathBuf>) -> Option<OpksshBackend> {
    cli_binary_path
        .cloned()
        .map(|binary_path| OpksshBackend::Cli { binary_path })
}

/// Run an arbitrary opkssh command and return the raw output.
pub async fn run_command(binary_path: &PathBuf, args: &[&str]) -> Result<CommandOutput, String> {
    let start = std::time::Instant::now();
    info!("Running opkssh: {:?} {:?}", binary_path, args);

    let output = Command::new(binary_path)
        .args(args)
        .output()
        .await
        .map_err(|e| format!("Failed to execute opkssh: {}", e))?;

    let duration_ms = start.elapsed().as_millis() as u64;

    Ok(CommandOutput {
        exit_code: output.status.code().unwrap_or(-1),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        duration_ms,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsString;

    struct VendorOverrideEnvGuard {
        saved: Option<OsString>,
    }

    impl VendorOverrideEnvGuard {
        fn clear() -> Self {
            let saved = std::env::var_os(VENDOR_LIBRARY_OVERRIDE_ENV);
            std::env::remove_var(VENDOR_LIBRARY_OVERRIDE_ENV);
            Self { saved }
        }
    }

    impl Drop for VendorOverrideEnvGuard {
        fn drop(&mut self) {
            if let Some(value) = self.saved.take() {
                std::env::set_var(VENDOR_LIBRARY_OVERRIDE_ENV, value);
            } else {
                std::env::remove_var(VENDOR_LIBRARY_OVERRIDE_ENV);
            }
        }
    }

    fn unique_temp_dir(prefix: &str) -> PathBuf {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        std::env::temp_dir().join(format!("{prefix}-{}-{stamp}", std::process::id()))
    }

    fn library_status(available: bool) -> OpksshBackendStatus {
        OpksshBackendStatus {
            kind: OpksshBackendKind::Library,
            available,
            availability: if available {
                OpksshRuntimeAvailability::Available
            } else {
                OpksshRuntimeAvailability::Planned
            },
            version: None,
            path: None,
            message: None,
            login_supported: available,
            config_load_supported: false,
            provider_owns_callback_listener: true,
            provider_owns_callback_shutdown: true,
            bundle_contract: None,
        }
    }

    fn cli_status(installed: bool) -> OpksshBinaryStatus {
        OpksshBinaryStatus {
            installed,
            path: installed.then(|| "/tmp/opkssh".to_string()),
            version: installed.then(|| "opkssh v0.0.0".to_string()),
            platform: "linux".to_string(),
            arch: "amd64".to_string(),
            download_url: Some(download_url()),
            backend: OpksshBackendStatus {
                kind: OpksshBackendKind::Cli,
                available: installed,
                availability: if installed {
                    OpksshRuntimeAvailability::Available
                } else {
                    OpksshRuntimeAvailability::Unavailable
                },
                version: installed.then(|| "opkssh v0.0.0".to_string()),
                path: installed.then(|| "/tmp/opkssh".to_string()),
                message: None,
                login_supported: installed,
                config_load_supported: false,
                provider_owns_callback_listener: true,
                provider_owns_callback_shutdown: true,
                bundle_contract: None,
            },
        }
    }

    fn compile_fake_vendor_wrapper(
        output_path: &Path,
        embedded_runtime_present: bool,
        backend_callable: bool,
        config_load_supported: bool,
        login_supported: bool,
    ) {
        let source_path = output_path.with_extension("rs");
        let source = format!(
            r#"
#[no_mangle]
pub extern "C" fn sorng_opkssh_vendor_abi_version() -> u32 {{
    7
}}

#[no_mangle]
pub extern "C" fn sorng_opkssh_vendor_embedded_runtime() -> u32 {{
    {}
}}

#[no_mangle]
pub extern "C" fn sorng_opkssh_vendor_backend_callable() -> u32 {{
    {}
}}

#[no_mangle]
pub extern "C" fn sorng_opkssh_vendor_config_load_supported() -> u32 {{
    {}
}}

#[no_mangle]
pub extern "C" fn sorng_opkssh_vendor_login_supported() -> u32 {{
    {}
}}
"#,
            u32::from(embedded_runtime_present),
            u32::from(backend_callable),
            u32::from(config_load_supported),
            u32::from(login_supported),
        );
        std::fs::write(&source_path, source).expect("write fake vendor wrapper source");

        let rustc = std::env::var_os("RUSTC").unwrap_or_else(|| OsString::from("rustc"));
        let status = std::process::Command::new(rustc)
            .arg("--crate-type=cdylib")
            .arg("--edition=2021")
            .arg(&source_path)
            .arg("-O")
            .arg("-o")
            .arg(output_path)
            .status()
            .expect("compile fake vendor wrapper");

        assert!(status.success(), "failed to compile fake vendor wrapper");
    }

    #[test]
    fn bundle_contract_reports_expected_paths_when_artifact_is_missing() {
        let _override_guard = VendorOverrideEnvGuard::clear();
        let root = unique_temp_dir("sorng-opkssh-vendor-contract-missing");
        std::fs::create_dir_all(&root).expect("create bundle root");

        let bundle_contract = library_bundle_contract_for_root(&root);

        assert!(bundle_contract.dylib_required);
        assert!(bundle_contract.tauri_bundle_configured);
        assert!(!bundle_contract.app_linked);
        assert_eq!(bundle_contract.wrapper_abi_version, None);
        assert!(!bundle_contract.artifact_present);
        assert!(!bundle_contract.metadata_queryable);
        assert_eq!(bundle_contract.load_strategy, None);
        assert_eq!(bundle_contract.loaded_artifact_path, None);
        assert!(!bundle_contract.embedded_runtime_present);
        assert!(!bundle_contract.backend_callable);
        assert!(!bundle_contract.config_load_supported);
        assert_eq!(bundle_contract.load_error, None);
        assert_eq!(bundle_contract.artifact_name, vendor_artifact_name());
        assert_eq!(
            bundle_contract.resource_relative_path,
            vendor_resource_relative_path()
        );
        assert!(PathBuf::from(&bundle_contract.workspace_artifact_path)
            .ends_with(PathBuf::from(vendor_platform_dir()).join(vendor_artifact_name())));
        assert!(bundle_contract
            .message
            .as_deref()
            .is_some_and(|message| message.contains("did not link the wrapper")));

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn staged_vendor_artifact_reports_truthful_contract_when_wrapper_is_not_linked() {
        let _override_guard = VendorOverrideEnvGuard::clear();
        let root = unique_temp_dir("sorng-opkssh-vendor-contract-staged");
        let platform_dir = root.join(vendor_platform_dir());
        std::fs::create_dir_all(&platform_dir).expect("create platform dir");

        let staged_artifact = platform_dir.join(vendor_artifact_name());
        std::fs::write(&staged_artifact, b"placeholder dylib bytes")
            .expect("write staged artifact");

        let status = library_backend_status_from_root(&root);

        assert!(!status.available);
        assert!(!status.login_supported);
        assert_eq!(status.availability, OpksshRuntimeAvailability::Unavailable);
        assert_eq!(
            status.path.as_deref(),
            Some(staged_artifact.to_string_lossy().as_ref())
        );
        assert!(status
            .message
            .as_deref()
            .is_some_and(|message| message.contains("runtime loading failed")));

        let bundle_contract = status.bundle_contract.expect("bundle contract");
        assert!(bundle_contract.artifact_present);
        assert!(!bundle_contract.app_linked);
        assert!(!bundle_contract.metadata_queryable);
        assert_eq!(bundle_contract.load_strategy, None);
        assert_eq!(bundle_contract.loaded_artifact_path, None);
        assert!(bundle_contract.load_error.is_some());
        assert_eq!(
            bundle_contract.workspace_artifact_path,
            staged_artifact.to_string_lossy()
        );

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn staged_vendor_wrapper_can_be_loaded_and_queried_without_enabling_library_login() {
        let _override_guard = VendorOverrideEnvGuard::clear();
        let root = unique_temp_dir("sorng-opkssh-vendor-contract-loadable");
        let platform_dir = root.join(vendor_platform_dir());
        std::fs::create_dir_all(&platform_dir).expect("create platform dir");

        let staged_artifact = platform_dir.join(vendor_artifact_name());
        compile_fake_vendor_wrapper(&staged_artifact, true, true, false, false);

        let status = library_backend_status_from_root(&root);

        assert!(!status.available);
        assert!(!status.login_supported);
        assert_eq!(status.availability, OpksshRuntimeAvailability::Unavailable);
        assert_eq!(
            status.path.as_deref(),
            Some(staged_artifact.to_string_lossy().as_ref())
        );
        assert!(status
            .message
            .as_deref()
            .is_some_and(|message| message.contains("callable embedded runtime")));
        assert!(status
            .message
            .as_deref()
            .is_some_and(|message| message.contains("library login bridge is not implemented")));

        let bundle_contract = status.bundle_contract.expect("bundle contract");
        assert!(bundle_contract.artifact_present);
        assert!(bundle_contract.metadata_queryable);
        assert_eq!(
            bundle_contract.load_strategy,
            Some(OpksshVendorLoadStrategy::WorkspaceBundle)
        );
        assert_eq!(
            bundle_contract.loaded_artifact_path.as_deref(),
            Some(staged_artifact.to_string_lossy().as_ref())
        );
        assert_eq!(bundle_contract.wrapper_abi_version, Some(7));
        assert!(bundle_contract.embedded_runtime_present);
        assert!(bundle_contract.backend_callable);
        assert!(!bundle_contract.config_load_supported);
        assert!(!bundle_contract.login_supported);
        assert_eq!(bundle_contract.load_error, None);

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn staged_vendor_wrapper_enables_the_library_backend_when_login_bridge_is_truthful() {
        let _override_guard = VendorOverrideEnvGuard::clear();
        let root = unique_temp_dir("sorng-opkssh-vendor-contract-login-ready");
        let platform_dir = root.join(vendor_platform_dir());
        std::fs::create_dir_all(&platform_dir).expect("create platform dir");

        let staged_artifact = platform_dir.join(vendor_artifact_name());
        compile_fake_vendor_wrapper(&staged_artifact, true, true, true, true);

        let status = library_backend_status_from_root(&root);

        assert!(status.available);
        assert!(status.login_supported);
        assert!(status.config_load_supported);
        assert_eq!(status.availability, OpksshRuntimeAvailability::Available);
        assert_eq!(
            status.path.as_deref(),
            Some(staged_artifact.to_string_lossy().as_ref())
        );
        assert!(status.message.as_deref().is_some_and(
            |message| message.contains("execute login through the wrapper/runtime path")
        ));

        let bundle_contract = status.bundle_contract.expect("bundle contract");
        assert!(bundle_contract.artifact_present);
        assert!(bundle_contract.metadata_queryable);
        assert!(bundle_contract.config_load_supported);
        assert!(bundle_contract.login_supported);
        assert_eq!(
            bundle_contract.load_strategy,
            Some(OpksshVendorLoadStrategy::WorkspaceBundle)
        );

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn auto_mode_uses_cli_fallback_when_library_runtime_is_not_ready() {
        let cli_path = Some(&PathBuf::from("/tmp/opkssh"));
        let (active_backend, using_fallback, message) = select_active_backend(
            &OpksshBackendMode::Auto,
            &library_status(false),
            &cli_status(true),
            cli_path,
        );

        assert!(matches!(active_backend, Some(OpksshBackend::Cli { .. })));
        assert!(using_fallback);
        assert_eq!(
            message.as_deref(),
            Some("The in-process OPKSSH runtime is unavailable in this build. CLI fallback is active.")
        );
    }

    #[test]
    fn auto_mode_prefers_library_when_it_is_available() {
        let (active_backend, using_fallback, message) = select_active_backend(
            &OpksshBackendMode::Auto,
            &library_status(true),
            &cli_status(true),
            Some(&PathBuf::from("/tmp/opkssh")),
        );

        assert!(matches!(active_backend, Some(OpksshBackend::Library)));
        assert!(!using_fallback);
        assert!(message.is_none());
    }

    #[test]
    fn library_mode_reports_total_unavailability_when_no_runtime_exists() {
        let (active_backend, using_fallback, message) = select_active_backend(
            &OpksshBackendMode::Library,
            &library_status(false),
            &cli_status(false),
            None,
        );

        assert!(active_backend.is_none());
        assert!(!using_fallback);
        assert_eq!(
            message.as_deref(),
            Some(
                "Library mode is requested. The in-process OPKSSH runtime is unavailable in this build. No CLI fallback is available."
            )
        );
    }

    #[test]
    fn cli_mode_requires_the_cli_binary() {
        let (active_backend, using_fallback, message) = select_active_backend(
            &OpksshBackendMode::Cli,
            &library_status(false),
            &cli_status(false),
            None,
        );

        assert!(active_backend.is_none());
        assert!(!using_fallback);
        assert_eq!(message.as_deref(), Some(CLI_UNAVAILABLE_MESSAGE));
    }

    #[cfg(feature = "vendored-wrapper")]
    #[test]
    fn linked_wrapper_reports_truthful_runtime_capabilities() {
        let _override_guard = VendorOverrideEnvGuard::clear();
        let root = unique_temp_dir("sorng-opkssh-vendor-contract-linked");
        std::fs::create_dir_all(&root).expect("create bundle root");

        let status = library_backend_status_from_root(&root);

        assert_eq!(status.available, sorng_opkssh_vendor::login_supported());
        assert_eq!(
            status.login_supported,
            sorng_opkssh_vendor::login_supported()
        );
        assert_eq!(
            status.availability,
            if sorng_opkssh_vendor::login_supported() {
                OpksshRuntimeAvailability::Available
            } else {
                OpksshRuntimeAvailability::Unavailable
            }
        );
        let bundle_contract = status.bundle_contract.expect("bundle contract");
        assert!(bundle_contract.app_linked);
        assert!(bundle_contract.metadata_queryable);
        assert_eq!(
            bundle_contract.load_strategy,
            Some(OpksshVendorLoadStrategy::LinkedFeature)
        );
        assert_eq!(bundle_contract.wrapper_abi_version, Some(3));
        assert_eq!(
            bundle_contract.embedded_runtime_present,
            sorng_opkssh_vendor::embedded_runtime_present()
        );
        assert_eq!(
            bundle_contract.backend_callable,
            sorng_opkssh_vendor::backend_callable()
        );
        assert_eq!(
            bundle_contract.config_load_supported,
            sorng_opkssh_vendor::config_load_supported()
        );
        assert_eq!(
            bundle_contract.login_supported,
            sorng_opkssh_vendor::login_supported()
        );
        assert_eq!(bundle_contract.load_error, None);
        assert!(bundle_contract
            .message
            .as_deref()
            .is_some_and(|message| message.contains("Runtime metadata is available")));

        let _ = std::fs::remove_dir_all(root);
    }
}
