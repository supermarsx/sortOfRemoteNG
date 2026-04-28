use std::ffi::{c_char, CStr, CString};

pub const SORNG_OPKSSH_VENDOR_ABI_VERSION: u32 = 3;
pub const SORNG_OPKSSH_VENDOR_RESOURCE_ROOT: &str = "opkssh";

#[cfg(sorng_opkssh_vendor_bridge)]
mod bridge {
    use super::*;

    unsafe extern "C" {
        fn libopkssh_login_json(request_json: *const c_char) -> *mut c_char;
        fn libopkssh_load_client_config_json(config_path: *const c_char) -> *mut c_char;
        fn libopkssh_free_string(value: *mut c_char);
    }

    pub(crate) fn login_json(request_json: &str) -> Result<String, String> {
        let request_json = CString::new(request_json)
            .map_err(|_| "login request contains an interior NUL byte".to_string())?;

        let response = unsafe { libopkssh_login_json(request_json.as_ptr()) };
        if response.is_null() {
            return Err("embedded OPKSSH login bridge returned a null response".to_string());
        }

        let json = unsafe { CStr::from_ptr(response) }
            .to_string_lossy()
            .into_owned();
        unsafe { libopkssh_free_string(response) };
        Ok(json)
    }

    pub(crate) fn load_client_config_json(explicit_path: Option<&str>) -> Result<String, String> {
        let explicit_path = explicit_path
            .map(CString::new)
            .transpose()
            .map_err(|_| "client-config path contains an interior NUL byte".to_string())?;

        let response = unsafe {
            libopkssh_load_client_config_json(
                explicit_path
                    .as_ref()
                    .map_or(std::ptr::null(), |path| path.as_ptr()),
            )
        };

        if response.is_null() {
            return Err("embedded OPKSSH bridge returned a null response".to_string());
        }

        let json = unsafe { CStr::from_ptr(response) }
            .to_string_lossy()
            .into_owned();
        unsafe { libopkssh_free_string(response) };
        Ok(json)
    }
}

pub fn artifact_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "sorng_opkssh_vendor.dll"
    } else if cfg!(target_os = "macos") {
        "libsorng_opkssh_vendor.dylib"
    } else {
        "libsorng_opkssh_vendor.so"
    }
}

pub fn platform_dir() -> &'static str {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("windows", "aarch64") => "windows-arm64",
        ("windows", _) => "windows-amd64",
        ("macos", "aarch64") => "macos-arm64",
        ("macos", _) => "macos-amd64",
        ("linux", "aarch64") => "linux-arm64",
        ("linux", _) => "linux-amd64",
        (os, arch) => panic!("unsupported OPKSSH vendor target contract: {os}-{arch}"),
    }
}

pub fn resource_relative_path() -> String {
    format!(
        "{}/{}/{}",
        SORNG_OPKSSH_VENDOR_RESOURCE_ROOT,
        platform_dir(),
        artifact_name()
    )
}

pub fn abi_version() -> u32 {
    sorng_opkssh_vendor_abi_version()
}

pub fn embedded_runtime_present() -> bool {
    sorng_opkssh_vendor_embedded_runtime() != 0
}

pub fn backend_callable() -> bool {
    sorng_opkssh_vendor_backend_callable() != 0
}

pub fn config_load_supported() -> bool {
    sorng_opkssh_vendor_config_load_supported() != 0
}

pub fn login_supported() -> bool {
    sorng_opkssh_vendor_login_supported() != 0
}

pub fn login_json(request_json: &str) -> Result<String, String> {
    #[cfg(sorng_opkssh_vendor_bridge)]
    {
        bridge::login_json(request_json)
    }

    #[cfg(not(sorng_opkssh_vendor_bridge))]
    {
        let _ = request_json;
        Ok(error_envelope(
            "embedded OPKSSH runtime is not available in this wrapper build",
        ))
    }
}

pub fn load_client_config_json(explicit_path: Option<&str>) -> Result<String, String> {
    #[cfg(sorng_opkssh_vendor_bridge)]
    {
        bridge::load_client_config_json(explicit_path)
    }

    #[cfg(not(sorng_opkssh_vendor_bridge))]
    {
        let _ = explicit_path;
        Ok(error_envelope(
            "embedded OPKSSH runtime is not available in this wrapper build",
        ))
    }
}

#[no_mangle]
pub extern "C" fn sorng_opkssh_vendor_abi_version() -> u32 {
    SORNG_OPKSSH_VENDOR_ABI_VERSION
}

#[no_mangle]
pub extern "C" fn sorng_opkssh_vendor_embedded_runtime() -> u32 {
    u32::from(cfg!(sorng_opkssh_vendor_bridge))
}

#[no_mangle]
pub extern "C" fn sorng_opkssh_vendor_backend_callable() -> u32 {
    u32::from(cfg!(sorng_opkssh_vendor_bridge))
}

#[no_mangle]
pub extern "C" fn sorng_opkssh_vendor_config_load_supported() -> u32 {
    u32::from(cfg!(sorng_opkssh_vendor_bridge))
}

#[no_mangle]
pub extern "C" fn sorng_opkssh_vendor_login_supported() -> u32 {
    u32::from(cfg!(sorng_opkssh_vendor_bridge))
}

#[no_mangle]
pub extern "C" fn sorng_opkssh_vendor_login_json(request_json: *const c_char) -> *mut c_char {
    let request_json = if request_json.is_null() {
        return string_into_raw(error_envelope("embedded login request must not be null"));
    } else {
        unsafe { CStr::from_ptr(request_json) }
            .to_string_lossy()
            .into_owned()
    };

    let json = match login_json(&request_json) {
        Ok(json) => json,
        Err(error) => error_envelope(&error),
    };

    string_into_raw(json)
}

#[no_mangle]
pub extern "C" fn sorng_opkssh_vendor_load_client_config_json(
    config_path: *const c_char,
) -> *mut c_char {
    let explicit_path = if config_path.is_null() {
        None
    } else {
        Some(
            unsafe { CStr::from_ptr(config_path) }
                .to_string_lossy()
                .into_owned(),
        )
    };

    let json = match load_client_config_json(explicit_path.as_deref()) {
        Ok(json) => json,
        Err(error) => error_envelope(&error),
    };

    string_into_raw(json)
}

#[no_mangle]
pub extern "C" fn sorng_opkssh_vendor_free_string(value: *mut c_char) {
    if value.is_null() {
        return;
    }

    let _ = unsafe { CString::from_raw(value) };
}

fn string_into_raw(value: String) -> *mut c_char {
    CString::new(value)
        .unwrap_or_else(|_| {
            CString::new(error_envelope("wrapper response contained an interior NUL byte"))
                .expect("valid fallback error envelope")
        })
        .into_raw()
}

fn error_envelope(error: &str) -> String {
    format!(r#"{{"ok":false,"error":"{}"}}"#, escape_json(error))
}

fn escape_json(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for character in value.chars() {
        match character {
            '"' => escaped.push_str("\\\""),
            '\\' => escaped.push_str("\\\\"),
            '\n' => escaped.push_str("\\n"),
            '\r' => escaped.push_str("\\r"),
            '\t' => escaped.push_str("\\t"),
            character if character.is_control() => {
                escaped.push_str(&format!("\\u{:04x}", character as u32));
            }
            _ => escaped.push(character),
        }
    }
    escaped
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    use std::ffi::{CString, OsString};
    use std::path::{Path, PathBuf};
    use std::sync::{Mutex, OnceLock};
    use std::time::{SystemTime, UNIX_EPOCH};

    const DETERMINISTIC_FAKE_OIDC_ENV: &str = "SORNG_OPKSSH_TEST_FAKE_OIDC_LOGIN";
    const DETERMINISTIC_FAKE_OIDC_USERNAME_ENV: &str = "SORNG_OPKSSH_TEST_FAKE_OIDC_USERNAME";
    const DETERMINISTIC_FAKE_OIDC_PASSWORD_ENV: &str = "SORNG_OPKSSH_TEST_FAKE_OIDC_PASSWORD";

    fn env_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
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

    fn configure_deterministic_fake_oidc_env(home: &Path, key_path: &Path) -> EnvGuard {
        let mut guard = EnvGuard::new();
        std::fs::create_dir_all(key_path.parent().expect("key dir")).expect("create key dir");
        set_home_env(&mut guard, home);
        guard.set(DETERMINISTIC_FAKE_OIDC_ENV, OsString::from("1"));
        guard.set(
            DETERMINISTIC_FAKE_OIDC_USERNAME_ENV,
            OsString::from("test-user@localhost"),
        );
        guard.set(
            DETERMINISTIC_FAKE_OIDC_PASSWORD_ENV,
            OsString::from("verysecure"),
        );
        guard
    }

    #[test]
    fn contract_exports_native_dylib_filename_and_resource_path() {
        let artifact = artifact_name();
        let platform = platform_dir();
        let resource = resource_relative_path();

        assert!(artifact.contains("sorng_opkssh_vendor") || artifact.contains("libsorng_opkssh_vendor"));
        assert!(platform.contains('-'));
        assert_eq!(
            resource,
            format!("{}/{}/{}", SORNG_OPKSSH_VENDOR_RESOURCE_ROOT, platform, artifact)
        );
    }

    #[test]
    fn exported_contract_flags_match_the_current_bridge_state() {
        let embedded_runtime_built = option_env!("SORNG_OPKSSH_VENDOR_EMBEDDED_RUNTIME") == Some("1");

        assert_eq!(sorng_opkssh_vendor_abi_version(), SORNG_OPKSSH_VENDOR_ABI_VERSION);
        assert_eq!(
            sorng_opkssh_vendor_embedded_runtime(),
            u32::from(embedded_runtime_built)
        );
        assert_eq!(
            sorng_opkssh_vendor_backend_callable(),
            u32::from(embedded_runtime_built)
        );
        assert_eq!(
            sorng_opkssh_vendor_config_load_supported(),
            u32::from(embedded_runtime_built)
        );
        assert_eq!(
            sorng_opkssh_vendor_login_supported(),
            u32::from(embedded_runtime_built)
        );
        assert_eq!(abi_version(), SORNG_OPKSSH_VENDOR_ABI_VERSION);
        assert_eq!(embedded_runtime_present(), embedded_runtime_built);
        assert_eq!(backend_callable(), embedded_runtime_built);
        assert_eq!(config_load_supported(), embedded_runtime_built);
        assert_eq!(login_supported(), embedded_runtime_built);
    }

    #[test]
    fn client_config_export_returns_a_wrapper_owned_json_envelope() {
        let config_path = unique_temp_dir("sorng-opkssh-vendor-config")
            .join("config.yml");
        std::fs::create_dir_all(config_path.parent().expect("config dir"))
            .expect("create config dir");
        std::fs::write(
            &config_path,
            r#"default_provider: google
providers:
  - alias: google workspace
    issuer: https://accounts.google.com
    client_id: file-client
    client_secret: file-secret
    scopes: openid email
"#,
        )
        .expect("write config file");

        let explicit_path = CString::new(config_path.to_string_lossy().to_string())
            .expect("config path c string");
        let response = sorng_opkssh_vendor_load_client_config_json(explicit_path.as_ptr());
        assert!(!response.is_null(), "wrapper should always return a JSON envelope");

        let envelope = unsafe { CStr::from_ptr(response) }
            .to_string_lossy()
            .into_owned();
        sorng_opkssh_vendor_free_string(response);

        let payload: Value = serde_json::from_str(&envelope).expect("parse wrapper envelope");
        let embedded_runtime_built = option_env!("SORNG_OPKSSH_VENDOR_EMBEDDED_RUNTIME") == Some("1");

        if embedded_runtime_built {
            assert_eq!(payload.get("ok").and_then(Value::as_bool), Some(true));
            assert_eq!(
                payload
                    .get("config")
                    .and_then(|config| config.get("defaultProvider"))
                    .and_then(Value::as_str),
                Some("google")
            );
            assert_eq!(
                payload
                    .get("config")
                    .and_then(|config| config.get("providers"))
                    .and_then(Value::as_array)
                    .map(Vec::len),
                Some(1)
            );
        } else {
            assert_eq!(payload.get("ok").and_then(Value::as_bool), Some(false));
            assert!(payload
                .get("error")
                .and_then(Value::as_str)
                .is_some_and(|error| error.contains("embedded OPKSSH runtime")));
        }
    }

    #[test]
    fn login_export_returns_a_wrapper_owned_json_envelope() {
        let request = CString::new("{}").expect("login request c string");
        let response = sorng_opkssh_vendor_login_json(request.as_ptr());
        assert!(!response.is_null(), "wrapper should always return a login envelope");

        let envelope = unsafe { CStr::from_ptr(response) }
            .to_string_lossy()
            .into_owned();
        sorng_opkssh_vendor_free_string(response);

        let payload: Value = serde_json::from_str(&envelope).expect("parse login envelope");
        let embedded_runtime_built = option_env!("SORNG_OPKSSH_VENDOR_EMBEDDED_RUNTIME") == Some("1");

        if embedded_runtime_built {
            assert_eq!(payload.get("ok").and_then(Value::as_bool), Some(true));
            assert_eq!(
                payload
                    .get("result")
                    .and_then(|result| result.get("success"))
                    .and_then(Value::as_bool),
                Some(false)
            );
            assert!(payload
                .get("result")
                .and_then(|result| result.get("message"))
                .and_then(Value::as_str)
                .is_some_and(|message| message.contains("key path is required")));
        } else {
            assert_eq!(payload.get("ok").and_then(Value::as_bool), Some(false));
            assert!(payload
                .get("error")
                .and_then(Value::as_str)
                .is_some_and(|error| error.contains("embedded OPKSSH runtime")));
        }
    }

    #[test]
    fn login_export_can_complete_a_deterministic_fake_oidc_login() {
        let embedded_runtime_built = option_env!("SORNG_OPKSSH_VENDOR_EMBEDDED_RUNTIME") == Some("1");
        if !embedded_runtime_built {
            return;
        }

        let _env_lock = env_lock()
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let home = unique_temp_dir("sorng-opkssh-vendor-fake-oidc");
        let key_path = home.join(".ssh").join("id_ecdsa-vendor-fake-oidc");
        let _env = configure_deterministic_fake_oidc_env(&home, &key_path);

        let request = CString::new(
            serde_json::json!({
                "keyPath": key_path.to_string_lossy(),
                "keyType": "ecdsa"
            })
            .to_string(),
        )
        .expect("login request c string");
        let response = sorng_opkssh_vendor_login_json(request.as_ptr());
        assert!(!response.is_null(), "wrapper should always return a login envelope");

        let envelope = unsafe { CStr::from_ptr(response) }
            .to_string_lossy()
            .into_owned();
        sorng_opkssh_vendor_free_string(response);

        let payload: Value = serde_json::from_str(&envelope).expect("parse login envelope");
        assert_eq!(payload.get("ok").and_then(Value::as_bool), Some(true));
        assert_eq!(
            payload
                .get("result")
                .and_then(|result| result.get("success"))
                .and_then(Value::as_bool),
            Some(true)
        );
        assert_eq!(
            payload
                .get("result")
                .and_then(|result| result.get("keyPath"))
                .and_then(Value::as_str),
            Some(key_path.to_string_lossy().as_ref())
        );
        assert!(payload
            .get("result")
            .and_then(|result| result.get("provider"))
            .and_then(Value::as_str)
            .is_some_and(|provider| provider.starts_with("http://")));
        assert!(payload
            .get("result")
            .and_then(|result| result.get("identity"))
            .and_then(Value::as_str)
            .is_some_and(|identity| !identity.trim().is_empty()));
        assert!(payload
            .get("result")
            .and_then(|result| result.get("expiresAt"))
            .and_then(Value::as_str)
            .is_some_and(|expires_at| !expires_at.is_empty()));
        assert_eq!(
            payload
                .get("result")
                .and_then(|result| result.get("message"))
                .and_then(Value::as_str),
            Some("Login successful")
        );
        assert!(key_path.is_file());
    }

    fn unique_temp_dir(prefix: &str) -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        std::env::temp_dir().join(format!("{prefix}-{}-{stamp}", std::process::id()))
    }
}