//! Resolved runtime configuration for the external REST API (t41).
//!
//! This module is the single source of truth for turning the three
//! overlapping config surfaces — the non-secret persisted `settings.restApi`
//! blob, native-only OS-vault secret overlays, the readme-advertised
//! environment variables (`API_KEY` / `JWT_SECRET` / `USER_STORE_PATH`), and
//! the hardcoded defaults — into one resolved
//! [`ApiRuntimeConfig`] the server startup path can consume directly.
//!
//! It is a **pure resolver**: no axum, tower, or Tauri dependencies, no I/O
//! beyond reading environment variables through an injected accessor, and no
//! binding of sockets. That keeps the precedence + security logic (which is a
//! genuine attack surface) trivially unit-testable in isolation.
//!
//! Secret precedence:
//!   env var (when present & non-empty) → native OS-vault overlay → missing.
//!
//! Security posture encoded here:
//!   * Bind loopback (`127.0.0.1`) unless `allowRemoteConnections` is set, in
//!     which case bind all interfaces (`0.0.0.0`).
//!   * Authentication is **forced on** whenever remote connections are allowed,
//!     regardless of the `authentication` toggle (defense in depth — D1).
//!   * Persisted settings are never consulted for API/JWT secret material.
//!     Generation and OS-vault persistence happen before this resolver runs.
//!   * Secret material is never emitted by the [`fmt::Debug`] impl.

use std::net::{IpAddr, Ipv4Addr};
use std::path::{Component, Path, PathBuf};

/// Default listening port when the setting is absent or invalid (Decision D6 —
/// standardize on the frontend/settings default rather than the legacy 3001).
pub const DEFAULT_PORT: u16 = 9876;
pub const DEFAULT_REQUIRED_RATE_LIMIT_PER_MINUTE: u32 = 120;
pub const MAX_RATE_LIMIT_PER_MINUTE: u32 = 10_000;
pub const DEFAULT_MAX_CONCURRENT_REQUESTS: usize = 4;
pub const MAX_CONCURRENT_REQUESTS: usize = 64;
pub const DEFAULT_REQUEST_TIMEOUT_SECS: u64 = 30;
pub const MAX_REQUEST_TIMEOUT_SECS: u64 = 300;

/// Default user-store filename joined onto the app data directory when neither
/// `USER_STORE_PATH` nor a settings override is supplied.
pub const DEFAULT_USER_STORE_FILE: &str = "users.json";

/// TLS provisioning mode, mirroring `settings.restApi.sslMode`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SslMode {
    /// Operator supplies cert + key paths directly.
    Manual,
    /// Generate a self-signed cert at startup (`sorng-auth::cert_gen`).
    SelfSigned,
    /// Obtain a cert via ACME / Let's Encrypt (`sorng-letsencrypt`).
    LetsEncrypt,
}

impl SslMode {
    fn parse(s: &str) -> Self {
        match s.trim().to_ascii_lowercase().as_str() {
            "self-signed" | "selfsigned" => SslMode::SelfSigned,
            "letsencrypt" | "lets-encrypt" | "acme" => SslMode::LetsEncrypt,
            // "manual" and anything unrecognised fall back to the safest,
            // non-network-touching mode.
            _ => SslMode::Manual,
        }
    }
}

/// Resolved TLS configuration. When `enabled` is false every other field is
/// meaningless and the server serves plain HTTP (loopback-only by default).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TlsConfig {
    pub enabled: bool,
    pub mode: SslMode,
    /// Manual mode only.
    pub cert_path: Option<PathBuf>,
    /// Manual mode only.
    pub key_path: Option<PathBuf>,
    /// Self-signed (CN) and Let's Encrypt (issued domain).
    pub domain: Option<String>,
    /// Let's Encrypt registration contact.
    pub email: Option<String>,
}

impl TlsConfig {
    fn disabled() -> Self {
        TlsConfig {
            enabled: false,
            mode: SslMode::Manual,
            cert_path: None,
            key_path: None,
            domain: None,
            email: None,
        }
    }
}

/// Fully-resolved runtime configuration for the REST API server.
///
/// Constructed via [`ApiRuntimeConfig::resolve`] (production, real env) or
/// [`ApiRuntimeConfig::resolve_with_env`] (tests / injected env). Cloneable so
/// the controller can hold a snapshot alongside the running server.
#[derive(Clone)]
pub struct ApiRuntimeConfig {
    /// Master opt-in switch (`restApi.enabled`). Default `false`.
    pub enabled: bool,
    /// Whether to start the server automatically on app launch.
    pub start_on_launch: bool,
    /// Resolved bind address: loopback unless `allow_remote`.
    pub bind_ip: IpAddr,
    /// Configured port (retained even when `use_random_port` is set so it can
    /// be displayed / persisted). Use [`bind_port`](Self::bind_port) for the
    /// value to actually bind.
    pub port: u16,
    /// When set, bind an OS-assigned ephemeral port instead of `port`.
    pub use_random_port: bool,
    /// Raw `allowRemoteConnections` toggle (drives `bind_ip` + forced auth).
    pub allow_remote: bool,
    /// Whether callers must authenticate. Forced `true` when `allow_remote`.
    pub auth_required: bool,
    /// Resolved static API key (`X-API-Key`).
    pub api_key: String,
    /// Resolved HMAC secret for signing internal JWTs.
    pub jwt_secret: String,
    /// Resolved path to the file-backed user/role store.
    pub user_store_path: PathBuf,
    /// Requests-per-minute cap. `0` is permitted only for local debug runs;
    /// remote and release resolution always supplies a non-zero safe baseline.
    pub rate_limit_per_minute: u32,
    /// Whether cross-origin requests are permitted.
    pub cors_enabled: bool,
    /// Resolved TLS configuration.
    pub tls: TlsConfig,
    /// Enforced maximum number of concurrently executing REST requests.
    pub max_threads: usize,
    /// Best-effort per-request timeout hint, in seconds (Decision D5).
    pub request_timeout_secs: u64,
}

impl ApiRuntimeConfig {
    /// Reject configurations that could expose an insecure or ephemeral API.
    ///
    /// Loopback with authentication disabled intentionally remains available
    /// for local development.
    pub fn validate_for_start(&self) -> Result<(), String> {
        if self.allow_remote && !self.tls.enabled {
            return Err(
                "remote REST API access requires TLS; refusing to bind without encryption"
                    .to_string(),
            );
        }
        if self.allow_remote && !self.auth_required {
            return Err(
                "remote REST API access requires authentication; refusing to bind".to_string(),
            );
        }
        if self.allow_remote && !self.tls.enabled {
            return Err(
                "remote REST API access requires TLS; refusing to transmit credentials over plaintext HTTP"
                    .to_string(),
            );
        }
        if self.auth_required && self.api_key.len() < 32 {
            return Err(
                "REST API authentication requires an API key of at least 32 bytes from the OS vault or API_KEY"
                    .to_string(),
            );
        }
        if (self.allow_remote || !cfg!(debug_assertions)) && self.rate_limit_per_minute == 0 {
            return Err(
                "REST API rate limiting is mandatory for remote and release exposure".to_string(),
            );
        }
        if !(1..=MAX_CONCURRENT_REQUESTS).contains(&self.max_threads) {
            return Err("REST API concurrency limit is outside the safe range".to_string());
        }
        if !(1..=MAX_REQUEST_TIMEOUT_SECS).contains(&self.request_timeout_secs) {
            return Err("REST API request timeout is outside the safe range".to_string());
        }
        if self.jwt_secret.len() < 32 {
            return Err(
                "REST API JWT signing requires at least 32 bytes from the OS vault or JWT_SECRET"
                    .to_string(),
            );
        }
        Ok(())
    }

    /// Resolve using the real process environment.
    pub fn resolve(settings: &serde_json::Value, app_dir: &Path) -> Self {
        Self::resolve_with_env(settings, app_dir, |k| std::env::var(k).ok())
    }

    /// Resolve with native-only secrets loaded from the OS credential vault.
    /// Process environment values still take precedence.
    pub fn resolve_with_native_secrets(
        settings: &serde_json::Value,
        app_dir: &Path,
        api_key: Option<&str>,
        jwt_secret: Option<&str>,
    ) -> Self {
        Self::resolve_with_env_and_secrets(
            settings,
            app_dir,
            |key| std::env::var(key).ok(),
            api_key,
            jwt_secret,
        )
    }

    /// Resolve using an injected environment accessor (for tests / headless
    /// callers). `env(key)` returns the raw value of an env var if set.
    pub fn resolve_with_env<F>(settings: &serde_json::Value, app_dir: &Path, env: F) -> Self
    where
        F: Fn(&str) -> Option<String>,
    {
        Self::resolve_with_env_and_secrets(settings, app_dir, env, None, None)
    }

    pub fn resolve_with_env_and_secrets<F>(
        settings: &serde_json::Value,
        app_dir: &Path,
        env: F,
        native_api_key: Option<&str>,
        native_jwt_secret: Option<&str>,
    ) -> Self
    where
        F: Fn(&str) -> Option<String>,
    {
        // The `restApi` sub-object; treat a missing object as "all defaults".
        let r = settings.get("restApi").unwrap_or(&serde_json::Value::Null);

        let enabled = get_bool(r, "enabled").unwrap_or(false);
        let start_on_launch = get_bool(r, "startOnLaunch").unwrap_or(false);
        let allow_remote = get_bool(r, "allowRemoteConnections").unwrap_or(false);

        // Bind loopback unless the operator explicitly opts into remote access.
        let bind_ip = if allow_remote {
            IpAddr::V4(Ipv4Addr::UNSPECIFIED) // 0.0.0.0
        } else {
            IpAddr::V4(Ipv4Addr::LOCALHOST) // 127.0.0.1
        };

        // Auth is forced on whenever the server is remotely reachable, even if
        // the `authentication` toggle is off — mirrors the mandatory-capability
        // pattern and prevents an unauthenticated 0.0.0.0 exposure.
        // Release builds always require authentication, including on loopback.
        // A local unauthenticated server is available only to debug builds via
        // an explicit process-local override; persisted settings cannot weaken
        // the production authentication boundary.
        let debug_unauthenticated_loopback = cfg!(debug_assertions)
            && env("SORNG_ALLOW_UNAUTHENTICATED_REST_API")
                .map(|value| {
                    matches!(
                        value.trim().to_ascii_lowercase().as_str(),
                        "1" | "true" | "yes" | "on"
                    )
                })
                .unwrap_or(false);
        let auth_required = allow_remote || !debug_unauthenticated_loopback;

        // Port: honor the configured value when valid, else the default. A
        // configured `0` is treated as "unset" (the OS-ephemeral case is
        // expressed via `use_random_port`, not a literal 0).
        let port = match get_u64(r, "port") {
            Some(p) if p >= 1 && p <= u16::MAX as u64 => p as u16,
            _ => DEFAULT_PORT,
        };
        let use_random_port = get_bool(r, "useRandomPort").unwrap_or(false);

        // Secrets never come from persisted settings. Explicit environment
        // values override the native OS-vault overlay.
        let api_key = env_nonempty(&env, "API_KEY")
            .or_else(|| secret_override_nonempty(native_api_key))
            .unwrap_or_default();
        let jwt_secret = env_nonempty(&env, "JWT_SECRET")
            .or_else(|| secret_override_nonempty(native_jwt_secret))
            .unwrap_or_default();

        // User store path: env → settings (`userStorePath`) → app_dir/users.json.
        let user_store_path = env_nonempty(&env, "USER_STORE_PATH")
            .map(PathBuf::from)
            .or_else(|| {
                get_str_nonempty(r, "userStorePath")
                    .and_then(|path| safe_settings_user_store_path(&path, app_dir))
            })
            .unwrap_or_else(|| app_dir.join(DEFAULT_USER_STORE_FILE));

        // Rate limiting is optional only for explicit local debug operation.
        // Remote listeners and every release build receive a non-zero baseline
        // even if persisted settings attempt to disable the control.
        let rate_limiting_on = get_bool(r, "rateLimiting").unwrap_or(false);
        let configured_rate_limit =
            get_u64(r, "maxRequestsPerMinute").map(|value| value.min(u32::MAX as u64) as u32);
        let rate_limit_required = allow_remote || !cfg!(debug_assertions);
        let rate_limit_per_minute = resolve_rate_limit_per_minute(
            configured_rate_limit,
            rate_limiting_on,
            rate_limit_required,
        );

        let cors_enabled = get_bool(r, "corsEnabled").unwrap_or(false);

        // TLS: everything is inert unless `sslEnabled`. Within an enabled
        // config, only the fields relevant to the selected mode are populated,
        // so downstream consumers can't accidentally act on a stale path from a
        // different mode.
        let tls = if get_bool(r, "sslEnabled").unwrap_or(false) {
            let mode = SslMode::parse(get_str(r, "sslMode").unwrap_or_default().as_str());
            match mode {
                SslMode::Manual => TlsConfig {
                    enabled: true,
                    mode,
                    cert_path: get_str_nonempty(r, "sslCertPath").map(PathBuf::from),
                    key_path: get_str_nonempty(r, "sslKeyPath").map(PathBuf::from),
                    domain: None,
                    email: None,
                },
                SslMode::SelfSigned => TlsConfig {
                    enabled: true,
                    mode,
                    cert_path: None,
                    key_path: None,
                    domain: get_str_nonempty(r, "sslDomain"),
                    email: None,
                },
                SslMode::LetsEncrypt => TlsConfig {
                    enabled: true,
                    mode,
                    cert_path: None,
                    key_path: None,
                    domain: get_str_nonempty(r, "sslDomain"),
                    email: get_str_nonempty(r, "sslEmail"),
                },
            }
        } else {
            TlsConfig::disabled()
        };

        let max_threads = get_u64(r, "maxThreads")
            .unwrap_or(DEFAULT_MAX_CONCURRENT_REQUESTS as u64)
            .clamp(1, MAX_CONCURRENT_REQUESTS as u64) as usize;
        let request_timeout_secs = get_u64(r, "requestTimeout")
            .unwrap_or(DEFAULT_REQUEST_TIMEOUT_SECS)
            .clamp(1, MAX_REQUEST_TIMEOUT_SECS);

        ApiRuntimeConfig {
            enabled,
            start_on_launch,
            bind_ip,
            port,
            use_random_port,
            allow_remote,
            auth_required,
            api_key,
            jwt_secret,
            user_store_path,
            rate_limit_per_minute,
            cors_enabled,
            tls,
            max_threads,
            request_timeout_secs,
        }
    }

    /// The port to actually bind: `0` (OS-assigned ephemeral) when
    /// `use_random_port` is set, otherwise the configured [`port`](Self::port).
    pub fn bind_port(&self) -> u16 {
        if self.use_random_port {
            0
        } else {
            self.port
        }
    }

    /// The full `ip:port` socket address string to bind, using [`bind_port`].
    pub fn bind_addr(&self) -> std::net::SocketAddr {
        std::net::SocketAddr::new(self.bind_ip, self.bind_port())
    }
}

/// Redacting Debug impl — never emit `api_key` / `jwt_secret`.
impl std::fmt::Debug for ApiRuntimeConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ApiRuntimeConfig")
            .field("enabled", &self.enabled)
            .field("start_on_launch", &self.start_on_launch)
            .field("bind_ip", &self.bind_ip)
            .field("port", &self.port)
            .field("use_random_port", &self.use_random_port)
            .field("allow_remote", &self.allow_remote)
            .field("auth_required", &self.auth_required)
            .field("api_key", &"<redacted>")
            .field("jwt_secret", &"<redacted>")
            .field("user_store_path", &"<redacted>")
            .field("rate_limit_per_minute", &self.rate_limit_per_minute)
            .field("cors_enabled", &self.cors_enabled)
            .field("tls", &self.tls)
            .field("max_threads", &self.max_threads)
            .field("request_timeout_secs", &self.request_timeout_secs)
            .finish()
    }
}

/// Persisted UI settings are untrusted application data. Keep their user-store
/// override beneath the application directory so the API cannot become an
/// arbitrary-file write deputy. The environment override remains available to
/// trusted operators for deployments that deliberately store users elsewhere.
fn safe_settings_user_store_path(raw: &str, app_dir: &Path) -> Option<PathBuf> {
    let relative = Path::new(raw);
    if relative.as_os_str().is_empty()
        || relative.is_absolute()
        || !relative
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
    {
        return None;
    }

    Some(app_dir.join(relative))
}

// --- helpers -------------------------------------------------------------

fn resolve_rate_limit_per_minute(configured: Option<u32>, enabled: bool, required: bool) -> u32 {
    let configured = configured.map(|limit| limit.min(MAX_RATE_LIMIT_PER_MINUTE));
    if required {
        configured
            .filter(|limit| *limit > 0)
            .unwrap_or(DEFAULT_REQUIRED_RATE_LIMIT_PER_MINUTE)
    } else if enabled {
        configured.unwrap_or(DEFAULT_REQUIRED_RATE_LIMIT_PER_MINUTE)
    } else {
        0
    }
}

fn get_bool(v: &serde_json::Value, key: &str) -> Option<bool> {
    v.get(key).and_then(|x| x.as_bool())
}

fn get_u64(v: &serde_json::Value, key: &str) -> Option<u64> {
    v.get(key).and_then(|x| x.as_u64())
}

fn get_str(v: &serde_json::Value, key: &str) -> Option<String> {
    v.get(key).and_then(|x| x.as_str()).map(|s| s.to_string())
}

/// Read a string field, returning `None` when absent or (after trimming) empty.
fn get_str_nonempty(v: &serde_json::Value, key: &str) -> Option<String> {
    v.get(key)
        .and_then(|x| x.as_str())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

/// Read an env var via the injected accessor, treating a trimmed-empty value as
/// absent (so `API_KEY=` never masks the settings/generated fallbacks).
fn env_nonempty<F>(env: &F, key: &str) -> Option<String>
where
    F: Fn(&str) -> Option<String>,
{
    env(key)
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn secret_override_nonempty(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::collections::HashMap;

    /// Build an env accessor from a static list of pairs.
    fn env_from(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
        let map: HashMap<String, String> = pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        move |k: &str| map.get(k).cloned()
    }

    fn no_env() -> impl Fn(&str) -> Option<String> {
        |_: &str| None
    }

    fn app_dir() -> PathBuf {
        PathBuf::from("/opt/app")
    }

    fn resolve(settings: &serde_json::Value) -> ApiRuntimeConfig {
        ApiRuntimeConfig::resolve_with_env(settings, &app_dir(), no_env())
    }

    #[test]
    fn defaults_when_settings_empty() {
        let cfg = resolve(&json!({}));
        assert!(!cfg.enabled);
        assert!(!cfg.start_on_launch);
        assert!(!cfg.allow_remote);
        assert_eq!(cfg.bind_ip, IpAddr::V4(Ipv4Addr::LOCALHOST));
        assert_eq!(cfg.port, DEFAULT_PORT);
        assert!(!cfg.use_random_port);
        assert!(cfg.auth_required);
        assert!(cfg.api_key.is_empty());
        assert!(cfg.jwt_secret.is_empty());
        assert_eq!(cfg.user_store_path, app_dir().join("users.json"));
        assert_eq!(
            cfg.rate_limit_per_minute,
            if cfg!(debug_assertions) {
                0
            } else {
                DEFAULT_REQUIRED_RATE_LIMIT_PER_MINUTE
            }
        );
        assert!(!cfg.cors_enabled);
        assert!(!cfg.tls.enabled);
    }

    #[test]
    fn missing_rest_api_object_is_all_defaults() {
        // A settings blob with unrelated keys but no `restApi` must not panic
        // and must resolve to the safe defaults.
        let cfg = resolve(&json!({ "somethingElse": true }));
        assert!(!cfg.enabled);
        assert_eq!(cfg.bind_ip, IpAddr::V4(Ipv4Addr::LOCALHOST));
        assert_eq!(cfg.port, DEFAULT_PORT);
    }

    #[test]
    fn remote_binds_all_interfaces() {
        let cfg = resolve(&json!({ "restApi": { "allowRemoteConnections": true } }));
        assert_eq!(cfg.bind_ip, IpAddr::V4(Ipv4Addr::UNSPECIFIED));
        assert!(cfg.allow_remote);
    }

    #[test]
    fn auth_forced_when_remote_even_if_toggle_off() {
        let cfg = resolve(&json!({
            "restApi": { "allowRemoteConnections": true, "authentication": false }
        }));
        assert!(
            cfg.auth_required,
            "auth must be forced on for remote exposure"
        );
    }

    #[test]
    fn auth_required_from_toggle_stays_loopback() {
        let cfg = resolve(&json!({
            "restApi": { "authentication": true, "allowRemoteConnections": false }
        }));
        assert!(cfg.auth_required);
        assert_eq!(cfg.bind_ip, IpAddr::V4(Ipv4Addr::LOCALHOST));
    }

    #[test]
    fn auth_required_when_local_even_if_toggle_off() {
        let cfg = resolve(&json!({ "restApi": { "authentication": false } }));
        assert!(cfg.auth_required);
    }

    #[test]
    fn api_key_env_overrides_native_vault_overlay() {
        let settings = json!({ "restApi": { "apiKey": "plaintext-must-be-ignored" } });
        let cfg = ApiRuntimeConfig::resolve_with_env_and_secrets(
            &settings,
            &app_dir(),
            env_from(&[("API_KEY", "from-env")]),
            Some("from-vault"),
            Some("0123456789abcdef0123456789abcdef"),
        );
        assert_eq!(cfg.api_key, "from-env");
    }

    #[test]
    fn plaintext_settings_secrets_are_ignored() {
        let cfg = resolve(&json!({
            "restApi": {
                "apiKey": "plaintext-api-key",
                "jwtSecret": "plaintext-jwt-secret"
            }
        }));
        assert!(cfg.api_key.is_empty());
        assert!(cfg.jwt_secret.is_empty());
    }

    #[test]
    fn native_vault_secrets_overlay_non_secret_settings() {
        let cfg = ApiRuntimeConfig::resolve_with_env_and_secrets(
            &json!({}),
            &app_dir(),
            no_env(),
            Some("vault-api-key"),
            Some("0123456789abcdef0123456789abcdef"),
        );
        assert_eq!(cfg.api_key, "vault-api-key");
        assert_eq!(cfg.jwt_secret, "0123456789abcdef0123456789abcdef");
    }

    #[test]
    fn empty_env_key_falls_through_to_native_vault_overlay() {
        let cfg = ApiRuntimeConfig::resolve_with_env_and_secrets(
            &json!({}),
            &app_dir(),
            env_from(&[("API_KEY", "   ")]),
            Some("vault-api-key"),
            Some("0123456789abcdef0123456789abcdef"),
        );
        assert_eq!(cfg.api_key, "vault-api-key");
    }

    #[test]
    fn jwt_secret_precedence_is_env_over_native_vault() {
        let cfg = ApiRuntimeConfig::resolve_with_env_and_secrets(
            &json!({ "restApi": { "jwtSecret": "plaintext-must-be-ignored" } }),
            &app_dir(),
            env_from(&[("JWT_SECRET", "environment-secret-32-bytes-long!!")]),
            Some("vault-api-key"),
            Some("vault-secret-0123456789abcdef0123"),
        );
        assert_eq!(cfg.jwt_secret, "environment-secret-32-bytes-long!!");
    }

    #[test]
    fn start_validation_fails_closed_without_secure_secrets() {
        let cfg = resolve(&json!({ "restApi": { "authentication": true } }));
        assert!(cfg.validate_for_start().is_err());

        let weak_api_key = ApiRuntimeConfig::resolve_with_env_and_secrets(
            &json!({}),
            &app_dir(),
            no_env(),
            Some("too-short"),
            Some("0123456789abcdef0123456789abcdef"),
        );
        assert!(weak_api_key.validate_for_start().is_err());

        let short_jwt = ApiRuntimeConfig::resolve_with_env_and_secrets(
            &json!({}),
            &app_dir(),
            no_env(),
            Some("vault-api-key"),
            Some("too-short"),
        );
        assert!(short_jwt.validate_for_start().is_err());
    }

    #[test]
    fn remote_start_requires_tls() {
        let cfg = ApiRuntimeConfig::resolve_with_env_and_secrets(
            &json!({ "restApi": { "allowRemoteConnections": true } }),
            &app_dir(),
            no_env(),
            Some("0123456789abcdef0123456789abcdef"),
            Some("0123456789abcdef0123456789abcdef"),
        );
        let error = cfg.validate_for_start().unwrap_err();
        assert!(error.contains("requires TLS"), "got: {error}");
    }

    #[test]
    fn remote_rate_limit_cannot_be_disabled() {
        let cfg = resolve(&json!({
            "restApi": {
                "allowRemoteConnections": true,
                "rateLimiting": false,
                "maxRequestsPerMinute": 0
            }
        }));
        assert_eq!(
            cfg.rate_limit_per_minute,
            DEFAULT_REQUIRED_RATE_LIMIT_PER_MINUTE
        );
    }

    #[test]
    fn request_resource_limits_are_clamped() {
        let low = resolve(&json!({
            "restApi": { "maxThreads": 0, "requestTimeout": 0 }
        }));
        assert_eq!(low.max_threads, 1);
        assert_eq!(low.request_timeout_secs, 1);

        let high = resolve(&json!({
            "restApi": {
                "maxThreads": u64::MAX,
                "requestTimeout": u64::MAX,
                "rateLimiting": true,
                "maxRequestsPerMinute": u64::MAX
            }
        }));
        assert_eq!(high.max_threads, MAX_CONCURRENT_REQUESTS);
        assert_eq!(high.request_timeout_secs, MAX_REQUEST_TIMEOUT_SECS);
        assert_eq!(high.rate_limit_per_minute, MAX_RATE_LIMIT_PER_MINUTE);
    }

    #[test]
    fn user_store_path_precedence() {
        // env wins
        let cfg = ApiRuntimeConfig::resolve_with_env(
            &json!({ "restApi": { "userStorePath": "/settings/users.json" } }),
            &app_dir(),
            env_from(&[("USER_STORE_PATH", "/env/users.json")]),
        );
        assert_eq!(cfg.user_store_path, PathBuf::from("/env/users.json"));

        // A relative settings path is anchored beneath the app directory.
        let cfg = resolve(&json!({ "restApi": { "userStorePath": "data/users.json" } }));
        assert_eq!(cfg.user_store_path, app_dir().join("data/users.json"));

        // Absolute and traversing settings paths fail closed to the default.
        let cfg = resolve(&json!({ "restApi": { "userStorePath": "/outside/users.json" } }));
        assert_eq!(cfg.user_store_path, app_dir().join("users.json"));
        let cfg = resolve(&json!({ "restApi": { "userStorePath": "../outside/users.json" } }));
        assert_eq!(cfg.user_store_path, app_dir().join("users.json"));

        // default when neither
        let cfg = resolve(&json!({}));
        assert_eq!(cfg.user_store_path, app_dir().join("users.json"));
    }

    #[test]
    fn port_resolution_and_random() {
        let cfg = resolve(&json!({ "restApi": { "port": 1234 } }));
        assert_eq!(cfg.port, 1234);
        assert_eq!(cfg.bind_port(), 1234);

        // random port keeps the configured value but binds ephemeral 0.
        let cfg = resolve(&json!({ "restApi": { "port": 1234, "useRandomPort": true } }));
        assert_eq!(cfg.port, 1234);
        assert_eq!(cfg.bind_port(), 0);

        // out-of-range / zero → default.
        let cfg = resolve(&json!({ "restApi": { "port": 0 } }));
        assert_eq!(cfg.port, DEFAULT_PORT);
        let cfg = resolve(&json!({ "restApi": { "port": 70000 } }));
        assert_eq!(cfg.port, DEFAULT_PORT);
    }

    #[test]
    fn bind_addr_composes_ip_and_port() {
        let cfg = resolve(&json!({ "restApi": { "port": 4321 } }));
        assert_eq!(cfg.bind_addr().to_string(), "127.0.0.1:4321");

        let cfg = resolve(&json!({
            "restApi": { "allowRemoteConnections": true, "port": 4321 }
        }));
        assert_eq!(cfg.bind_addr().to_string(), "0.0.0.0:4321");
    }

    #[test]
    fn rate_limit_gated_by_toggle() {
        // toggle on → honored
        let cfg = resolve(&json!({
            "restApi": { "rateLimiting": true, "maxRequestsPerMinute": 120 }
        }));
        assert_eq!(cfg.rate_limit_per_minute, 120);

        // toggle off → forced 0 even with a configured count
        let cfg = resolve(&json!({
            "restApi": { "rateLimiting": false, "maxRequestsPerMinute": 120 }
        }));
        assert_eq!(cfg.rate_limit_per_minute, 0);

        // toggle on but count 0 → off
        let cfg = resolve(&json!({
            "restApi": { "rateLimiting": true, "maxRequestsPerMinute": 0 }
        }));
        assert_eq!(cfg.rate_limit_per_minute, 0);
    }

    #[test]
    fn rate_limit_policy_matrix_covers_required_and_optional_modes() {
        let oversized = Some(u32::MAX);
        let required_cases = [
            ("absent", None, DEFAULT_REQUIRED_RATE_LIMIT_PER_MINUTE),
            ("zero", Some(0), DEFAULT_REQUIRED_RATE_LIMIT_PER_MINUTE),
            ("positive", Some(37), 37),
            ("oversized", oversized, MAX_RATE_LIMIT_PER_MINUTE),
        ];
        for (case, configured, expected) in required_cases {
            for enabled in [false, true] {
                assert_eq!(
                    resolve_rate_limit_per_minute(configured, enabled, true),
                    expected,
                    "required/{case}/enabled={enabled}",
                );
            }
        }

        let optional_enabled_cases = [
            ("absent", None, DEFAULT_REQUIRED_RATE_LIMIT_PER_MINUTE),
            ("zero", Some(0), 0),
            ("positive", Some(37), 37),
            ("oversized", oversized, MAX_RATE_LIMIT_PER_MINUTE),
        ];
        for (case, configured, expected) in optional_enabled_cases {
            assert_eq!(
                resolve_rate_limit_per_minute(configured, true, false),
                expected,
                "optional/enabled/{case}",
            );
        }

        for (case, configured) in [
            ("absent", None),
            ("zero", Some(0)),
            ("positive", Some(37)),
            ("oversized", oversized),
        ] {
            assert_eq!(
                resolve_rate_limit_per_minute(configured, false, false),
                0,
                "optional/disabled/{case}",
            );
        }
    }

    #[test]
    fn cors_flag() {
        assert!(resolve(&json!({ "restApi": { "corsEnabled": true } })).cors_enabled);
        assert!(!resolve(&json!({ "restApi": { "corsEnabled": false } })).cors_enabled);
    }

    #[test]
    fn tls_disabled_ignores_mode() {
        let cfg = resolve(&json!({
            "restApi": { "sslEnabled": false, "sslMode": "letsencrypt", "sslDomain": "x.example" }
        }));
        assert!(!cfg.tls.enabled);
        assert_eq!(cfg.tls.domain, None);
    }

    #[test]
    fn tls_manual_populates_cert_and_key() {
        let cfg = resolve(&json!({
            "restApi": {
                "sslEnabled": true,
                "sslMode": "manual",
                "sslCertPath": "/certs/server.crt",
                "sslKeyPath": "/certs/server.key",
                "sslDomain": "ignored.example"
            }
        }));
        assert!(cfg.tls.enabled);
        assert_eq!(cfg.tls.mode, SslMode::Manual);
        assert_eq!(cfg.tls.cert_path, Some(PathBuf::from("/certs/server.crt")));
        assert_eq!(cfg.tls.key_path, Some(PathBuf::from("/certs/server.key")));
        // Manual mode ignores domain/email.
        assert_eq!(cfg.tls.domain, None);
        assert_eq!(cfg.tls.email, None);
    }

    #[test]
    fn tls_self_signed_uses_domain_only() {
        let cfg = resolve(&json!({
            "restApi": {
                "sslEnabled": true,
                "sslMode": "self-signed",
                "sslDomain": "host.local",
                "sslCertPath": "/ignored.crt"
            }
        }));
        assert!(cfg.tls.enabled);
        assert_eq!(cfg.tls.mode, SslMode::SelfSigned);
        assert_eq!(cfg.tls.domain, Some("host.local".to_string()));
        assert_eq!(cfg.tls.cert_path, None);
        assert_eq!(cfg.tls.key_path, None);
        assert_eq!(cfg.tls.email, None);
    }

    #[test]
    fn tls_letsencrypt_uses_domain_and_email() {
        let cfg = resolve(&json!({
            "restApi": {
                "sslEnabled": true,
                "sslMode": "letsencrypt",
                "sslDomain": "api.example.com",
                "sslEmail": "admin@example.com"
            }
        }));
        assert!(cfg.tls.enabled);
        assert_eq!(cfg.tls.mode, SslMode::LetsEncrypt);
        assert_eq!(cfg.tls.domain, Some("api.example.com".to_string()));
        assert_eq!(cfg.tls.email, Some("admin@example.com".to_string()));
        assert_eq!(cfg.tls.cert_path, None);
    }

    #[test]
    fn unknown_ssl_mode_falls_back_to_manual() {
        let cfg = resolve(&json!({
            "restApi": { "sslEnabled": true, "sslMode": "bogus" }
        }));
        assert_eq!(cfg.tls.mode, SslMode::Manual);
    }

    #[test]
    fn perf_hints_have_sane_defaults() {
        let cfg = resolve(&json!({}));
        assert_eq!(cfg.max_threads, 4);
        assert_eq!(cfg.request_timeout_secs, 30);

        let cfg = resolve(&json!({
            "restApi": { "maxThreads": 8, "requestTimeout": 60 }
        }));
        assert_eq!(cfg.max_threads, 8);
        assert_eq!(cfg.request_timeout_secs, 60);

        // maxThreads is clamped to at least 1.
        let cfg = resolve(&json!({ "restApi": { "maxThreads": 0 } }));
        assert_eq!(cfg.max_threads, 1);
    }

    #[test]
    fn debug_redacts_secrets() {
        let cfg = ApiRuntimeConfig::resolve_with_env(
            &json!({}),
            &app_dir(),
            env_from(&[
                ("API_KEY", "supersecretkey"),
                ("JWT_SECRET", "supersecretjwt"),
            ]),
        );
        let dbg = format!("{cfg:?}");
        assert!(!dbg.contains("supersecretkey"), "api_key leaked in Debug");
        assert!(
            !dbg.contains("supersecretjwt"),
            "jwt_secret leaked in Debug"
        );
        assert!(dbg.contains("<redacted>"));
    }
}
