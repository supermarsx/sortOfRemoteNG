use serde_json::Value;
use sorng_opkssh::login;
use sorng_opkssh::{
    OpksshBackendKind, OpksshBackendMode, OpksshLoginOptions, OpksshRuntimeAvailability,
    OpksshService, OpksshVendorLoadStrategy,
};
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::Mutex as AsyncMutex;

const FAKE_CLI_SOURCE: &str = r#"
use std::env;
use std::path::PathBuf;
use std::process;
use std::thread;
use std::time::Duration;

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();

    if args.iter().any(|arg| arg == "--version") {
        println!("opkssh v9.9.9-test");
        return;
    }

    if args.first().map(String::as_str) == Some("login") {
        if let Some(delay_ms) = env::var("OPKSSH_FAKE_DELAY_MS")
            .ok()
            .and_then(|value| value.parse::<u64>().ok())
        {
            thread::sleep(Duration::from_millis(delay_ms));
        }

        let key_path = env::var("OPKSSH_FAKE_KEY_PATH").unwrap_or_else(|_| {
            let home = env::var("HOME")
                .or_else(|_| env::var("USERPROFILE"))
                .unwrap_or_else(|_| ".".to_string());
            PathBuf::from(home)
                .join(".ssh")
                .join("id_ecdsa")
                .to_string_lossy()
                .to_string()
        });
        let identity = env::var("OPKSSH_FAKE_IDENTITY")
            .unwrap_or_else(|_| "integration@example.com".to_string());

        println!("key written to {}", key_path);
        println!("authenticated identity {}", identity);
        eprintln!("callback handled by provider");

        let exit_code = env::var("OPKSSH_FAKE_EXIT_CODE")
            .ok()
            .and_then(|value| value.parse::<i32>().ok())
            .unwrap_or(0);
        if exit_code != 0 {
            eprintln!("fake login failure");
            process::exit(exit_code);
        }

        return;
    }

    eprintln!("unsupported args: {:?}", args);
    process::exit(1);
}
"#;
const VENDOR_LIBRARY_OVERRIDE_ENV: &str = "SORNG_OPKSSH_VENDOR_LIBRARY";
const DETERMINISTIC_FAKE_OIDC_ENV: &str = "SORNG_OPKSSH_TEST_FAKE_OIDC_LOGIN";
const DETERMINISTIC_FAKE_OIDC_USERNAME_ENV: &str = "SORNG_OPKSSH_TEST_FAKE_OIDC_USERNAME";
const DETERMINISTIC_FAKE_OIDC_PASSWORD_ENV: &str = "SORNG_OPKSSH_TEST_FAKE_OIDC_PASSWORD";

fn env_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn fake_cli_path() -> PathBuf {
    static PATH: OnceLock<PathBuf> = OnceLock::new();
    PATH.get_or_init(|| {
        let dir = unique_temp_dir("sorng-opkssh-fake-cli-login");
        std::fs::create_dir_all(&dir).expect("create fake cli dir");

        let source_path = dir.join("fake_opkssh.rs");
        std::fs::write(&source_path, FAKE_CLI_SOURCE).expect("write fake cli source");

        let output_path = dir.join(if cfg!(windows) {
            "opkssh.exe"
        } else {
            "opkssh"
        });
        let rustc = std::env::var_os("RUSTC").unwrap_or_else(|| OsString::from("rustc"));
        let status = Command::new(rustc)
            .arg("--edition=2021")
            .arg(&source_path)
            .arg("-O")
            .arg("-o")
            .arg(&output_path)
            .status()
            .expect("compile fake opkssh helper");

        assert!(status.success(), "failed to compile fake opkssh helper");
        output_path
    })
    .clone()
}

fn compile_fake_vendor_wrapper(
    output_path: &Path,
    embedded_runtime_present: bool,
    backend_callable: bool,
    config_load_supported: bool,
    config_load_response: Option<&str>,
    login_supported: bool,
    login_response: Option<&str>,
) {
    let source_path = output_path.with_extension("rs");
    let config_load_response = config_load_response
        .map(|response| format!("Some({response:?})"))
        .unwrap_or_else(|| "None".to_string());
    let login_response = login_response
        .map(|response| format!("Some({response:?})"))
        .unwrap_or_else(|| "None".to_string());
    let source = format!(
        r#"
use std::ffi::{{c_char, CString}};

const CONFIG_LOAD_RESPONSE: Option<&str> = {};
const LOGIN_RESPONSE: Option<&str> = {};

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

#[no_mangle]
pub extern "C" fn sorng_opkssh_vendor_load_client_config_json(_config_path: *const c_char) -> *mut c_char {{
    CString::new(
        CONFIG_LOAD_RESPONSE.unwrap_or("{{\"ok\":false,\"error\":\"fake wrapper config load disabled\"}}"),
    )
    .unwrap()
    .into_raw()
}}

#[no_mangle]
pub extern "C" fn sorng_opkssh_vendor_login_json(_request_json: *const c_char) -> *mut c_char {{
    CString::new(
        LOGIN_RESPONSE.unwrap_or("{{\"ok\":true,\"result\":{{\"success\":false,\"message\":\"fake wrapper login disabled\"}}}}"),
    )
    .unwrap()
    .into_raw()
}}

#[no_mangle]
pub extern "C" fn sorng_opkssh_vendor_free_string(value: *mut c_char) {{
    if value.is_null() {{
        return;
    }}

    let _ = unsafe {{ CString::from_raw(value) }};
}}
"#,
        config_load_response,
        login_response,
        u32::from(embedded_runtime_present),
        u32::from(backend_callable),
        u32::from(config_load_supported),
        u32::from(login_supported),
    );
    std::fs::write(&source_path, source).expect("write fake vendor wrapper source");

    let rustc = std::env::var_os("RUSTC").unwrap_or_else(|| OsString::from("rustc"));
    let status = Command::new(rustc)
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

fn unique_temp_dir(prefix: &str) -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time")
        .as_nanos();
    std::env::temp_dir().join(format!("{prefix}-{}-{stamp}", std::process::id()))
}

fn src_tauri_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("crate parent")
        .parent()
        .expect("src-tauri dir")
        .to_path_buf()
}

fn vendor_platform_dir() -> String {
    let platform = if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    };
    let arch = if cfg!(target_arch = "aarch64") {
        "arm64"
    } else {
        "amd64"
    };
    format!("{platform}-{arch}")
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

fn vendor_workspace_artifact_suffix() -> PathBuf {
    PathBuf::from("crates")
        .join("sorng-opkssh-vendor")
        .join("bundle")
        .join("opkssh")
        .join(vendor_platform_dir())
        .join(vendor_artifact_name())
}

fn value_contains_opkssh(value: &Value) -> bool {
    match value {
        Value::String(text) => text.to_ascii_lowercase().contains("opkssh"),
        Value::Array(items) => items.iter().any(value_contains_opkssh),
        Value::Object(entries) => entries.values().any(value_contains_opkssh),
        _ => false,
    }
}

struct EnvGuard {
    saved: Vec<(String, Option<OsString>)>,
}

impl EnvGuard {
    fn new() -> Self {
        Self { saved: Vec::new() }
    }

    fn set<K, V>(&mut self, key: K, value: V)
    where
        K: Into<String>,
        V: Into<OsString>,
    {
        let key = key.into();
        if !self.saved.iter().any(|(saved_key, _)| saved_key == &key) {
            self.saved.push((key.clone(), std::env::var_os(&key)));
        }
        std::env::set_var(&key, value.into());
    }

    fn remove(&mut self, key: &str) {
        if !self.saved.iter().any(|(saved_key, _)| saved_key == key) {
            self.saved.push((key.to_string(), std::env::var_os(key)));
        }
        std::env::remove_var(key);
    }
}

impl Drop for EnvGuard {
    fn drop(&mut self) {
        for (key, value) in self.saved.drain(..).rev() {
            if let Some(value) = value {
                std::env::set_var(&key, value);
            } else {
                std::env::remove_var(&key);
            }
        }
    }
}

fn set_home_env(guard: &mut EnvGuard, home: &Path) {
    let home_value = home.as_os_str().to_os_string();
    guard.set("HOME", home_value.clone());
    guard.set("USERPROFILE", home_value.clone());

    #[cfg(windows)]
    {
        let home_text = home.to_string_lossy().replace('/', "\\");
        if home_text.len() >= 2 && home_text.as_bytes()[1] == b':' {
            guard.set("HOMEDRIVE", OsString::from(&home_text[..2]));
            guard.set("HOMEPATH", OsString::from(&home_text[2..]));
        }
    }
}

fn configure_fake_cli_env(home: &Path, key_path: &Path, identity: &str) -> EnvGuard {
    let fake_cli = fake_cli_path();
    let mut guard = EnvGuard::new();

    let mut paths = vec![fake_cli.parent().expect("fake cli parent").to_path_buf()];
    if let Some(existing) = std::env::var_os("PATH") {
        paths.extend(std::env::split_paths(&existing));
    }
    let joined = std::env::join_paths(paths).expect("join PATH entries");
    guard.set("PATH", joined);

    std::fs::create_dir_all(home.join(".ssh")).expect("create test ssh dir");
    set_home_env(&mut guard, home);
    guard.remove("SORNG_OPKSSH_BACKEND");
    guard.remove(VENDOR_LIBRARY_OVERRIDE_ENV);
    guard.remove("OPKSSH_DEFAULT");
    guard.remove("OPKSSH_PROVIDERS");
    guard.remove(DETERMINISTIC_FAKE_OIDC_ENV);
    guard.remove(DETERMINISTIC_FAKE_OIDC_USERNAME_ENV);
    guard.remove(DETERMINISTIC_FAKE_OIDC_PASSWORD_ENV);
    guard.set("OPKSSH_FAKE_KEY_PATH", key_path.as_os_str().to_os_string());
    guard.set("OPKSSH_FAKE_IDENTITY", OsString::from(identity));
    guard.set("OPKSSH_FAKE_EXIT_CODE", OsString::from("0"));
    guard.remove("OPKSSH_FAKE_DELAY_MS");

    guard
}

fn enable_deterministic_fake_oidc_env(guard: &mut EnvGuard) {
    guard.set(DETERMINISTIC_FAKE_OIDC_ENV, OsString::from("1"));
    guard.set(
        DETERMINISTIC_FAKE_OIDC_USERNAME_ENV,
        OsString::from("test-user@localhost"),
    );
    guard.set(
        DETERMINISTIC_FAKE_OIDC_PASSWORD_ENV,
        OsString::from("verysecure"),
    );
}

fn fake_wrapper_config_response(config_path: &Path) -> String {
    format!(
        r#"{{"ok":true,"config":{{"configPath":"{}","defaultProvider":"google","providers":[{{"aliases":["google","workspace"],"issuer":"https://accounts.google.com","clientId":"file-client","clientSecret":"file-secret","scopes":["openid","email"]}}]}}}}"#,
        config_path.to_string_lossy().replace('\\', "\\\\")
    )
}

fn fake_wrapper_login_response(key_path: &Path, identity: &str, provider: &str) -> String {
    format!(
        r#"{{"ok":true,"result":{{"success":true,"provider":"{}","identity":"{}","keyPath":"{}","expiresAt":"2026-04-01T00:00:00Z","message":"Login successful"}}}}"#,
        provider,
        identity,
        key_path.to_string_lossy().replace('\\', "\\\\"),
    )
}

#[tokio::test(flavor = "current_thread")]
async fn service_status_prefers_cli_fallback_over_the_current_library_runtime_contract() {
    let _env_lock = env_lock()
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    let home = unique_temp_dir("sorng-opkssh-login-home-status");
    let key_path = home.join(".ssh").join("id_ecdsa");
    let _env = configure_fake_cli_env(&home, &key_path, "status@example.com");

    let mut service = OpksshService::new();
    let status = service.get_status().await;
    let library_login_ready = status.runtime.library.login_supported;

    assert_eq!(status.runtime.mode, OpksshBackendMode::Auto);
    assert_eq!(
        status.runtime.active_backend,
        Some(if library_login_ready {
            OpksshBackendKind::Library
        } else {
            OpksshBackendKind::Cli
        })
    );
    assert_eq!(status.runtime.using_fallback, !library_login_ready);
    assert_eq!(status.runtime.library.available, library_login_ready);
    assert_eq!(
        status.runtime.library.config_load_supported,
        status
            .runtime
            .library
            .bundle_contract
            .as_ref()
            .is_some_and(|bundle_contract| bundle_contract.config_load_supported)
    );
    assert!(status.runtime.library.provider_owns_callback_listener);
    assert!(status.runtime.library.provider_owns_callback_shutdown);
    let bundle_contract = status
        .runtime
        .library
        .bundle_contract
        .as_ref()
        .expect("library bundle contract");
    assert!(bundle_contract.dylib_required);
    assert!(bundle_contract.tauri_bundle_configured);
    assert_eq!(
        bundle_contract.app_linked,
        cfg!(feature = "vendored-wrapper")
    );
    assert_eq!(
        bundle_contract.wrapper_abi_version.is_some(),
        bundle_contract.metadata_queryable
    );
    assert_eq!(bundle_contract.artifact_name, vendor_artifact_name());
    assert_eq!(
        bundle_contract.resource_relative_path,
        format!(
            "opkssh/{}/{}",
            vendor_platform_dir(),
            vendor_artifact_name()
        )
    );
    assert!(PathBuf::from(&bundle_contract.workspace_artifact_path)
        .ends_with(vendor_workspace_artifact_suffix()));
    assert!(status
        .runtime
        .library
        .path
        .as_deref()
        .is_some_and(|path| PathBuf::from(path).ends_with(vendor_workspace_artifact_suffix())));

    let expected_availability = if bundle_contract.metadata_queryable
        || bundle_contract.app_linked
        || bundle_contract.artifact_present
        || bundle_contract.load_error.is_some()
    {
        if library_login_ready {
            OpksshRuntimeAvailability::Available
        } else {
            OpksshRuntimeAvailability::Unavailable
        }
    } else {
        OpksshRuntimeAvailability::Planned
    };
    assert_eq!(status.runtime.library.availability, expected_availability);

    if bundle_contract.metadata_queryable {
        assert_eq!(bundle_contract.load_error, None);
        match &bundle_contract.load_strategy {
            Some(OpksshVendorLoadStrategy::LinkedFeature) => {
                assert_eq!(bundle_contract.loaded_artifact_path, None);
                assert_eq!(bundle_contract.wrapper_abi_version, Some(3));
            }
            Some(OpksshVendorLoadStrategy::WorkspaceBundle) => {
                assert!(bundle_contract.artifact_present);
                assert_eq!(
                    bundle_contract.loaded_artifact_path.as_deref(),
                    Some(bundle_contract.workspace_artifact_path.as_str())
                );
                assert_eq!(bundle_contract.wrapper_abi_version, Some(3));
            }
            other => panic!("unexpected OPKSSH wrapper load strategy in test runtime: {other:?}"),
        }
        assert_eq!(status.runtime.library.availability, expected_availability);
        if bundle_contract.login_supported {
            assert!(status.runtime.library.message.as_deref().is_some_and(
                |message| message.contains("execute login through the wrapper/runtime path")
            ));
        } else if bundle_contract.config_load_supported {
            assert!(status
                .runtime
                .library
                .message
                .as_deref()
                .is_some_and(|message| message.contains("typed client-config load")));
        } else {
            assert!(status
                .runtime
                .library
                .message
                .as_deref()
                .is_some_and(|message| message.contains("Runtime metadata is available")));
        }
    } else if bundle_contract.load_error.is_some() {
        assert!(status
            .runtime
            .library
            .message
            .as_deref()
            .is_some_and(|message| message.contains("runtime loading failed")));
    } else {
        assert!(status
            .runtime
            .library
            .message
            .as_deref()
            .is_some_and(|message| message.contains("did not link the wrapper")));
    }
    assert!(status.binary.installed);
    assert_eq!(status.binary.backend.kind, OpksshBackendKind::Cli);
    assert_eq!(
        status.binary.path.as_deref(),
        Some(fake_cli_path().to_string_lossy().as_ref())
    );
    if library_login_ready {
        assert!(status.runtime.message.is_none());
    } else {
        assert!(status
            .runtime
            .message
            .as_deref()
            .is_some_and(|message| message.contains("CLI fallback is active")));
    }
    assert!(status.last_login.is_none());
    assert!(status.last_error.is_none());
}

#[tokio::test(flavor = "current_thread")]
async fn service_status_can_query_a_runtime_loaded_wrapper_without_claiming_library_login() {
    let _env_lock = env_lock()
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    let home = unique_temp_dir("sorng-opkssh-login-home-runtime-wrapper");
    let key_path = home.join(".ssh").join("id_ecdsa-runtime-wrapper");
    let config_dir = home.join(".opk");
    std::fs::create_dir_all(&config_dir).expect("create opk config dir");
    let config_path = config_dir.join("config.yml");
    std::fs::write(&config_path, "placeholder: true\n").expect("write placeholder config");
    let vendor_dir = unique_temp_dir("sorng-opkssh-runtime-wrapper");
    std::fs::create_dir_all(&vendor_dir).expect("create fake vendor dir");
    let vendor_path = vendor_dir.join(vendor_artifact_name());
    compile_fake_vendor_wrapper(
        &vendor_path,
        true,
        true,
        true,
        Some(&fake_wrapper_config_response(&config_path)),
        false,
        None,
    );

    let mut env = configure_fake_cli_env(&home, &key_path, "runtime-wrapper@example.com");
    env.set(
        VENDOR_LIBRARY_OVERRIDE_ENV,
        vendor_path.as_os_str().to_os_string(),
    );

    let mut service = OpksshService::new();
    let status = service.get_status().await;

    assert_eq!(status.runtime.mode, OpksshBackendMode::Auto);
    assert_eq!(status.runtime.active_backend, Some(OpksshBackendKind::Cli));
    assert!(status.runtime.using_fallback);
    assert!(!status.runtime.library.available);
    assert!(!status.runtime.library.login_supported);
    assert!(status.runtime.library.config_load_supported);
    assert_eq!(
        status.runtime.library.availability,
        OpksshRuntimeAvailability::Unavailable
    );
    assert_eq!(
        status.runtime.library.path.as_deref(),
        Some(vendor_path.to_string_lossy().as_ref())
    );
    assert!(status
        .runtime
        .library
        .message
        .as_deref()
        .is_some_and(|message| message.contains("callable embedded runtime")));
    assert!(status
        .runtime
        .library
        .message
        .as_deref()
        .is_some_and(|message| message.contains("typed client-config load")));

    let bundle_contract = status
        .runtime
        .library
        .bundle_contract
        .as_ref()
        .expect("library bundle contract");
    assert!(bundle_contract.metadata_queryable);
    assert_eq!(
        bundle_contract.load_strategy,
        Some(OpksshVendorLoadStrategy::OverridePath)
    );
    assert_eq!(
        bundle_contract.loaded_artifact_path.as_deref(),
        Some(vendor_path.to_string_lossy().as_ref())
    );
    assert_eq!(bundle_contract.wrapper_abi_version, Some(7));
    assert!(bundle_contract.embedded_runtime_present);
    assert!(bundle_contract.backend_callable);
    assert!(bundle_contract.config_load_supported);
    assert_eq!(bundle_contract.load_error, None);
    assert!(status
        .runtime
        .message
        .as_deref()
        .is_some_and(|message| message.contains("CLI fallback is active")));
}

#[tokio::test(flavor = "current_thread")]
async fn refresh_client_config_uses_a_runtime_loaded_wrapper_when_the_bridge_is_callable() {
    let _env_lock = env_lock()
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    let home = unique_temp_dir("sorng-opkssh-config-home-runtime-wrapper");
    let key_path = home.join(".ssh").join("id_ecdsa-config-wrapper");
    let config_dir = home.join(".opk");
    std::fs::create_dir_all(&config_dir).expect("create opk config dir");
    let config_path = config_dir.join("config.yml");
    std::fs::write(&config_path, "placeholder: true\n").expect("write placeholder config");

    let vendor_dir = unique_temp_dir("sorng-opkssh-config-wrapper");
    std::fs::create_dir_all(&vendor_dir).expect("create fake vendor dir");
    let vendor_path = vendor_dir.join(vendor_artifact_name());
    compile_fake_vendor_wrapper(
        &vendor_path,
        true,
        true,
        true,
        Some(&fake_wrapper_config_response(&config_path)),
        false,
        None,
    );

    let mut env = configure_fake_cli_env(&home, &key_path, "config-wrapper@example.com");
    env.set(
        VENDOR_LIBRARY_OVERRIDE_ENV,
        vendor_path.as_os_str().to_os_string(),
    );
    env.set("OPKSSH_DEFAULT", "envdefault");
    env.set(
        "OPKSSH_PROVIDERS",
        "envalias,https://env.example,env-client,,openid profile",
    );

    let mut service = OpksshService::new();
    let transport = service.refresh_client_config().await;

    assert_eq!(transport.default_provider.as_deref(), Some("envdefault"));
    assert_eq!(transport.providers.len(), 2);
    assert!(transport.provider_secrets_present);
    assert!(transport.secrets_redacted_for_transport);

    let google = transport
        .providers
        .iter()
        .find(|provider| provider.alias == "google workspace")
        .expect("google provider from wrapper");
    assert_eq!(google.client_secret, None);
    assert!(google.client_secret_present);
    assert!(google.client_secret_redacted);
    assert_eq!(google.scopes.as_deref(), Some("openid email"));

    let env_provider = transport
        .providers
        .iter()
        .find(|provider| provider.alias == "envalias")
        .expect("env override provider");
    assert_eq!(env_provider.client_secret, None);
    assert!(!env_provider.client_secret_present);
    assert!(!env_provider.client_secret_redacted);
    assert_eq!(env_provider.scopes.as_deref(), Some("openid profile"));

    let runtime = service.get_runtime_status().expect("cached runtime status");
    assert!(runtime.library.config_load_supported);
    assert_eq!(runtime.active_backend, Some(OpksshBackendKind::Cli));
}

#[tokio::test(flavor = "current_thread")]
async fn library_login_wrapper_returns_a_redacted_result_from_the_operation_path() {
    let _env_lock = env_lock()
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    let home = unique_temp_dir("sorng-opkssh-login-home-library-run");
    let key_path = home.join(".ssh").join("id_ecdsa-library");
    let config_dir = home.join(".opk");
    std::fs::create_dir_all(&config_dir).expect("create opk config dir");
    let config_path = config_dir.join("config.yml");
    std::fs::write(&config_path, "placeholder: true\n").expect("write placeholder config");

    let identity = "library@example.com";
    let vendor_dir = unique_temp_dir("sorng-opkssh-library-login-wrapper");
    std::fs::create_dir_all(&vendor_dir).expect("create fake vendor dir");
    let vendor_path = vendor_dir.join(vendor_artifact_name());
    compile_fake_vendor_wrapper(
        &vendor_path,
        true,
        true,
        true,
        Some(&fake_wrapper_config_response(&config_path)),
        true,
        Some(&fake_wrapper_login_response(&key_path, identity, "google")),
    );

    let mut env = configure_fake_cli_env(&home, &key_path, identity);
    env.set(
        VENDOR_LIBRARY_OVERRIDE_ENV,
        vendor_path.as_os_str().to_os_string(),
    );
    env.set("OPKSSH_FAKE_EXIT_CODE", OsString::from("9"));

    let service_state = Arc::new(AsyncMutex::new(OpksshService::new()));
    let result = login::run_login_operation(
        service_state.clone(),
        OpksshLoginOptions {
            provider: Some("google".to_string()),
            ..Default::default()
        },
    )
    .await
    .expect("run wrapper-backed opkssh login operation");

    assert!(result.success);
    assert_eq!(result.provider.as_deref(), Some("google"));
    assert_eq!(result.identity.as_deref(), Some(identity));
    assert_eq!(
        result.key_path.as_deref(),
        Some(key_path.to_string_lossy().as_ref())
    );
    assert_eq!(result.message, "Login successful");
    assert!(result.raw_output.is_empty());
    assert_eq!(
        result.expires_at.map(|expiry| expiry.to_rfc3339()),
        Some("2026-04-01T00:00:00+00:00".to_string())
    );

    let mut service = service_state.lock().await;
    let status = service.get_status().await;
    assert!(status.last_login.is_some());
    assert!(status.last_error.is_none());
    assert_eq!(
        status.runtime.active_backend,
        Some(OpksshBackendKind::Library)
    );
    assert!(!status.runtime.using_fallback);
    assert!(status.runtime.library.available);
    assert!(status.runtime.library.login_supported);
}

#[tokio::test(flavor = "current_thread")]
#[ignore = "requires SORNG_OPKSSH_VENDOR_LIBRARY to point at a built vendor wrapper"]
async fn real_vendor_wrapper_override_can_be_loaded_and_queried() {
    let _env_lock = env_lock()
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    let override_path = std::env::var_os(VENDOR_LIBRARY_OVERRIDE_ENV).expect(
        "set SORNG_OPKSSH_VENDOR_LIBRARY to a built vendor wrapper before running this test",
    );
    let home = unique_temp_dir("sorng-opkssh-login-home-real-wrapper");
    let key_path = home.join(".ssh").join("id_ecdsa-real-wrapper");

    let mut env = configure_fake_cli_env(&home, &key_path, "real-wrapper@example.com");
    env.set(VENDOR_LIBRARY_OVERRIDE_ENV, override_path);

    let mut service = OpksshService::new();
    let status = service.get_status().await;

    let bundle_contract = status
        .runtime
        .library
        .bundle_contract
        .as_ref()
        .expect("library bundle contract");
    assert!(bundle_contract.metadata_queryable);
    assert_eq!(
        bundle_contract.load_strategy,
        Some(OpksshVendorLoadStrategy::OverridePath)
    );
    assert_eq!(bundle_contract.wrapper_abi_version, Some(3));
    assert!(bundle_contract.embedded_runtime_present);
    assert!(bundle_contract.backend_callable);
    assert!(bundle_contract.config_load_supported);
    assert!(status.runtime.library.available);
    assert!(status.runtime.library.login_supported);
    assert!(status.runtime.library.config_load_supported);
    assert_eq!(
        status.runtime.active_backend,
        Some(OpksshBackendKind::Library)
    );
}

#[tokio::test(flavor = "current_thread")]
#[ignore = "requires SORNG_OPKSSH_VENDOR_LIBRARY to point at a built vendor wrapper"]
async fn real_vendor_wrapper_override_can_refresh_client_config() {
    let _env_lock = env_lock()
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    let override_path = std::env::var_os(VENDOR_LIBRARY_OVERRIDE_ENV).expect(
        "set SORNG_OPKSSH_VENDOR_LIBRARY to a built vendor wrapper before running this test",
    );
    let home = unique_temp_dir("sorng-opkssh-config-home-real-wrapper");
    let key_path = home.join(".ssh").join("id_ecdsa-real-wrapper-config");
    let config_dir = home.join(".opk");
    std::fs::create_dir_all(&config_dir).expect("create opk config dir");
    let config_path = config_dir.join("config.yml");
    std::fs::write(
        &config_path,
        r#"default_provider: google
providers:
  - alias: google
    issuer: https://accounts.google.com
    client_id: file-client
    client_secret: file-secret
    scopes: openid email
"#,
    )
    .expect("write real wrapper config");

    let mut env = configure_fake_cli_env(&home, &key_path, "real-wrapper-config@example.com");
    env.set(VENDOR_LIBRARY_OVERRIDE_ENV, override_path);

    let mut service = OpksshService::new();
    let transport = service.refresh_client_config().await;

    assert_eq!(
        transport.config_path,
        config_path.to_string_lossy().as_ref()
    );
    assert_eq!(transport.default_provider.as_deref(), Some("google"));
    assert_eq!(transport.providers.len(), 1);
    assert!(transport.provider_secrets_present);
    assert!(transport.secrets_redacted_for_transport);

    let google = transport
        .providers
        .iter()
        .find(|provider| provider.alias == "google")
        .expect("google provider from real wrapper");
    assert_eq!(google.issuer, "https://accounts.google.com");
    assert_eq!(google.client_id, "file-client");
    assert_eq!(google.client_secret, None);
    assert!(google.client_secret_present);
    assert!(google.client_secret_redacted);
    assert_eq!(google.scopes.as_deref(), Some("openid email"));

    let runtime = service.get_runtime_status().expect("cached runtime status");
    assert!(runtime.library.config_load_supported);
    assert_eq!(runtime.active_backend, Some(OpksshBackendKind::Library));
}

#[tokio::test(flavor = "current_thread")]
#[ignore = "requires SORNG_OPKSSH_VENDOR_LIBRARY to point at a built vendor wrapper"]
async fn real_vendor_wrapper_override_surfaces_a_library_login_result_without_cli_fallback() {
    let _env_lock = env_lock()
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    let override_path = std::env::var_os(VENDOR_LIBRARY_OVERRIDE_ENV).expect(
        "set SORNG_OPKSSH_VENDOR_LIBRARY to a built vendor wrapper before running this test",
    );
    let home = unique_temp_dir("sorng-opkssh-login-home-real-wrapper-library-login");
    let key_path = home
        .join(".ssh")
        .join("id_ecdsa-real-wrapper-library-login");

    let mut env = configure_fake_cli_env(&home, &key_path, "cli-should-not-run@example.com");
    env.set(VENDOR_LIBRARY_OVERRIDE_ENV, override_path);
    env.set("OPKSSH_FAKE_EXIT_CODE", OsString::from("9"));

    let service_state = Arc::new(AsyncMutex::new(OpksshService::new()));
    let result = login::run_login_operation(
        service_state.clone(),
        OpksshLoginOptions {
            provider: Some("does-not-exist".to_string()),
            key_file_name: Some("id_ecdsa-real-wrapper-library-login".to_string()),
            ..Default::default()
        },
    )
    .await
    .expect("run wrapper-backed real login operation");

    assert!(!result.success);
    assert_eq!(result.provider.as_deref(), Some("does-not-exist"));
    assert_eq!(result.identity, None);
    assert_eq!(
        result.key_path.as_deref(),
        Some(key_path.to_string_lossy().as_ref())
    );
    assert!(!result.message.is_empty());
    assert!(result.raw_output.is_empty());

    let mut service = service_state.lock().await;
    let status = service.get_status().await;
    assert!(status.last_login.is_none());
    assert_eq!(status.last_error.as_deref(), Some(result.message.as_str()));
    assert_eq!(
        status.runtime.active_backend,
        Some(OpksshBackendKind::Library)
    );
    assert!(!status.runtime.using_fallback);
    assert!(status.runtime.library.available);
    assert!(status.runtime.library.login_supported);
}

#[tokio::test(flavor = "current_thread")]
#[ignore = "requires SORNG_OPKSSH_VENDOR_LIBRARY to point at a built vendor wrapper"]
async fn real_vendor_wrapper_override_can_complete_deterministic_fake_oidc_login_without_cli_fallback(
) {
    let _env_lock = env_lock()
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    let override_path = std::env::var_os(VENDOR_LIBRARY_OVERRIDE_ENV).expect(
        "set SORNG_OPKSSH_VENDOR_LIBRARY to a built vendor wrapper before running this test",
    );
    let home = unique_temp_dir("sorng-opkssh-login-home-real-wrapper-deterministic-success");
    let key_path = home
        .join(".ssh")
        .join("id_ecdsa-real-wrapper-deterministic-success");

    let mut env = configure_fake_cli_env(&home, &key_path, "cli-should-not-run@example.com");
    env.set(VENDOR_LIBRARY_OVERRIDE_ENV, override_path);
    enable_deterministic_fake_oidc_env(&mut env);
    env.set("OPKSSH_FAKE_EXIT_CODE", OsString::from("9"));

    let service_state = Arc::new(AsyncMutex::new(OpksshService::new()));
    let result = login::run_login_operation(
        service_state.clone(),
        OpksshLoginOptions {
            key_file_name: Some("id_ecdsa-real-wrapper-deterministic-success".to_string()),
            ..Default::default()
        },
    )
    .await
    .expect("run deterministic wrapper-backed login operation");

    assert!(result.success);
    assert!(result
        .provider
        .as_deref()
        .is_some_and(|provider| provider.starts_with("http://")));
    assert!(result
        .identity
        .as_deref()
        .is_some_and(|identity| !identity.trim().is_empty()));
    assert!(result
        .identity
        .as_deref()
        .is_some_and(|identity| !identity.contains("cli-should-not-run@example.com")));
    assert_eq!(
        result.key_path.as_deref(),
        Some(key_path.to_string_lossy().as_ref())
    );
    assert!(result.expires_at.is_some());
    assert_eq!(result.message, "Login successful");
    assert!(result.raw_output.is_empty());
    assert!(key_path.is_file());

    let mut service = service_state.lock().await;
    let status = service.get_status().await;
    assert!(status.last_login.is_some());
    assert!(status.last_error.is_none());
    assert_eq!(
        status.runtime.active_backend,
        Some(OpksshBackendKind::Library)
    );
    assert!(!status.runtime.using_fallback);
    assert!(status.runtime.library.available);
    assert!(status.runtime.library.login_supported);
    assert!(status.runtime.library.provider_owns_callback_listener);
    assert!(status.runtime.library.provider_owns_callback_shutdown);
}

#[tokio::test(flavor = "current_thread")]
async fn service_status_honors_backend_mode_from_env_without_disabling_cli_fallback() {
    let _env_lock = env_lock()
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    let home = unique_temp_dir("sorng-opkssh-login-home-env-mode");
    let key_path = home.join(".ssh").join("id_ecdsa-env");
    let vendor_dir = unique_temp_dir("sorng-opkssh-env-mode-wrapper");
    std::fs::create_dir_all(&vendor_dir).expect("create fake vendor dir");
    let vendor_path = vendor_dir.join(vendor_artifact_name());
    compile_fake_vendor_wrapper(&vendor_path, true, true, false, None, false, None);
    let mut env = configure_fake_cli_env(&home, &key_path, "env-mode@example.com");
    env.set("SORNG_OPKSSH_BACKEND", "library");
    env.set(
        VENDOR_LIBRARY_OVERRIDE_ENV,
        vendor_path.as_os_str().to_os_string(),
    );

    let mut service = OpksshService::new();
    let status = service.get_status().await;

    assert_eq!(status.runtime.mode, OpksshBackendMode::Library);
    assert_eq!(status.runtime.active_backend, Some(OpksshBackendKind::Cli));
    assert!(status.runtime.using_fallback);
    assert!(status
        .runtime
        .message
        .as_deref()
        .is_some_and(|message| message.contains("Library mode is requested.")));
    assert!(status
        .runtime
        .message
        .as_deref()
        .is_some_and(|message| message.contains("CLI fallback is active")));
}

#[tokio::test(flavor = "current_thread")]
async fn blocking_login_wrapper_returns_a_redacted_result_from_the_operation_path() {
    let _env_lock = env_lock()
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    let home = unique_temp_dir("sorng-opkssh-login-home-run");
    let key_path = home.join(".ssh").join("id_ecdsa-workflow");
    let identity = "workflow@example.com";
    let mut env = configure_fake_cli_env(&home, &key_path, identity);
    env.set("SORNG_OPKSSH_BACKEND", "cli");

    let service_state = Arc::new(AsyncMutex::new(OpksshService::new()));
    let result = login::run_login_operation(
        service_state.clone(),
        OpksshLoginOptions {
            provider: Some("google".to_string()),
            ..Default::default()
        },
    )
    .await
    .expect("run opkssh login operation");

    assert!(result.success);
    assert_eq!(result.provider.as_deref(), Some("google"));
    assert_eq!(result.identity.as_deref(), Some(identity));
    assert_eq!(
        result.key_path.as_deref(),
        Some(key_path.to_string_lossy().as_ref())
    );
    assert_eq!(result.message, "Login successful");
    assert!(result.raw_output.is_empty());

    let mut service = service_state.lock().await;
    let status = service.get_status().await;
    assert!(status.last_login.is_some());
    assert!(status.last_error.is_none());
    assert_eq!(status.runtime.mode, OpksshBackendMode::Cli);
    assert_eq!(status.runtime.active_backend, Some(OpksshBackendKind::Cli));
    assert!(!status.runtime.using_fallback);
}

#[test]
fn workspace_bundle_metadata_stays_truthful_about_the_revived_opkssh_dylib_contract() {
    let src_tauri = src_tauri_dir();
    let tauri_conf_path = src_tauri.join("tauri.conf.json");
    let vendored_path = src_tauri.join("crates").join("VENDORED.md");

    let tauri_conf: Value = serde_json::from_str(
        &std::fs::read_to_string(&tauri_conf_path).expect("read tauri.conf.json"),
    )
    .expect("parse tauri.conf.json");

    let bundle = tauri_conf
        .get("bundle")
        .and_then(Value::as_object)
        .expect("bundle config object");
    let resources = bundle
        .get("resources")
        .and_then(Value::as_object)
        .expect("bundle resources map");

    assert!(
        !bundle.get("externalBin").is_some_and(value_contains_opkssh),
        "tauri.conf.json should not use externalBin for the OPKSSH dylib contract"
    );
    assert_eq!(
        resources
            .get("crates/sorng-opkssh-vendor/bundle/opkssh/")
            .and_then(Value::as_str),
        Some("opkssh/"),
        "tauri.conf.json should map the OPKSSH vendor bundle staging dir into $RESOURCE/opkssh/"
    );

    let vendored_text = std::fs::read_to_string(&vendored_path).expect("read VENDORED.md");
    assert!(
        vendored_text.contains("`sorng-opkssh-vendor`")
            && vendored_text.contains("workspace member")
            && vendored_text.contains("runtime-load")
            && vendored_text.contains("typed client-config load")
            && vendored_text.contains("library-backed login")
            && vendored_text.contains("preserving CLI fallback"),
        "VENDORED.md should record the runtime-loadable OPKSSH wrapper gate, the typed client-config bridge, the truthful login bridge, and the preserved CLI fallback posture"
    );
}
