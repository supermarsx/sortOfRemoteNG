//! Resolved runtime configuration for the external REST API (t41).
//!
//! This module is the single source of truth for turning the three
//! overlapping config surfaces — the persisted `settings.restApi` blob, the
//! readme-advertised environment variables (`API_KEY` / `JWT_SECRET` /
//! `USER_STORE_PATH`), and the hardcoded defaults — into one resolved
//! [`ApiRuntimeConfig`] the server startup path can consume directly.
//!
//! It is a **pure resolver**: no axum, tower, or Tauri dependencies, no I/O
//! beyond reading environment variables through an injected accessor, and no
//! binding of sockets. That keeps the precedence + security logic (which is a
//! genuine attack surface) trivially unit-testable in isolation.
//!
//! Precedence (Decision D2 — settings-source-of-truth + env override):
//!   env var (when present & non-empty) → `settings.restApi.*` → generated/default.
//!
//! Security posture encoded here:
//!   * Bind loopback (`127.0.0.1`) unless `allowRemoteConnections` is set, in
//!     which case bind all interfaces (`0.0.0.0`).
//!   * Authentication is **forced on** whenever remote connections are allowed,
//!     regardless of the `authentication` toggle (defense in depth — D1).
//!   * `api_key` / `jwt_secret` are auto-generated with a CSPRNG (`OsRng`,
//!     ≥256-bit) when neither env nor settings supply them; the caller learns
//!     via the `*_generated` flags that it should persist them.
//!   * Secret material is never emitted by the [`fmt::Debug`] impl.

use std::net::{IpAddr, Ipv4Addr};
use std::path::{Path, PathBuf};

use rand::rngs::OsRng;
use rand::RngCore;

/// Default listening port when the setting is absent or invalid (Decision D6 —
/// standardize on the frontend/settings default rather than the legacy 3001).
pub const DEFAULT_PORT: u16 = 9876;

/// Default user-store filename joined onto the app data directory when neither
/// `USER_STORE_PATH` nor a settings override is supplied.
pub const DEFAULT_USER_STORE_FILE: &str = "users.json";

/// Number of random bytes used for auto-generated secrets. 32 bytes = 256 bits
/// of entropy, satisfying the "≥256-bit" JWT-secret invariant with margin once
/// hex-encoded (64 chars).
const SECRET_BYTES: usize = 32;

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
    /// Resolved static API key (`X-API-Key`). Always non-empty.
    pub api_key: String,
    /// True when `api_key` was freshly generated (caller should persist it).
    pub api_key_generated: bool,
    /// Resolved HMAC secret for signing internal JWTs. Always ≥256-bit.
    pub jwt_secret: String,
    /// True when `jwt_secret` was freshly generated (caller should persist it).
    pub jwt_secret_generated: bool,
    /// Resolved path to the file-backed user/role store.
    pub user_store_path: PathBuf,
    /// Requests-per-minute cap; `0` disables rate limiting. Already accounts
    /// for the `rateLimiting` on/off toggle.
    pub rate_limit_per_minute: u32,
    /// Whether cross-origin requests are permitted.
    pub cors_enabled: bool,
    /// Resolved TLS configuration.
    pub tls: TlsConfig,
    /// Best-effort worker/concurrency hint (Decision D5 — may be a no-op).
    pub max_threads: usize,
    /// Best-effort per-request timeout hint, in seconds (Decision D5).
    pub request_timeout_secs: u64,
}

impl ApiRuntimeConfig {
    /// Resolve using the real process environment.
    pub fn resolve(settings: &serde_json::Value, app_dir: &Path) -> Self {
        Self::resolve_with_env(settings, app_dir, |k| std::env::var(k).ok())
    }

    /// Resolve using an injected environment accessor (for tests / headless
    /// callers). `env(key)` returns the raw value of an env var if set.
    pub fn resolve_with_env<F>(settings: &serde_json::Value, app_dir: &Path, env: F) -> Self
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
        let auth_configured = get_bool(r, "authentication").unwrap_or(false);
        let auth_required = auth_configured || allow_remote;

        // Port: honor the configured value when valid, else the default. A
        // configured `0` is treated as "unset" (the OS-ephemeral case is
        // expressed via `use_random_port`, not a literal 0).
        let port = match get_u64(r, "port") {
            Some(p) if p >= 1 && p <= u16::MAX as u64 => p as u16,
            _ => DEFAULT_PORT,
        };
        let use_random_port = get_bool(r, "useRandomPort").unwrap_or(false);

        // API key: env → settings → generated.
        let (api_key, api_key_generated) =
            match env_nonempty(&env, "API_KEY").or_else(|| get_str_nonempty(r, "apiKey")) {
                Some(k) => (k, false),
                None => (gen_secret_hex(), true),
            };

        // JWT secret: env → settings (`jwtSecret`, read defensively though not
        // in the current settings type) → generated (≥256-bit).
        let (jwt_secret, jwt_secret_generated) =
            match env_nonempty(&env, "JWT_SECRET").or_else(|| get_str_nonempty(r, "jwtSecret")) {
                Some(s) => (s, false),
                None => (gen_secret_hex(), true),
            };

        // User store path: env → settings (`userStorePath`) → app_dir/users.json.
        let user_store_path = env_nonempty(&env, "USER_STORE_PATH")
            .or_else(|| get_str_nonempty(r, "userStorePath"))
            .map(PathBuf::from)
            .unwrap_or_else(|| app_dir.join(DEFAULT_USER_STORE_FILE));

        // Rate limit: gated by the `rateLimiting` toggle; `0` = off.
        let rate_limiting_on = get_bool(r, "rateLimiting").unwrap_or(false);
        let rate_limit_per_minute = if rate_limiting_on {
            get_u64(r, "maxRequestsPerMinute").unwrap_or(0) as u32
        } else {
            0
        };

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

        let max_threads = get_u64(r, "maxThreads").unwrap_or(4).max(1) as usize;
        let request_timeout_secs = get_u64(r, "requestTimeout").unwrap_or(30);

        ApiRuntimeConfig {
            enabled,
            start_on_launch,
            bind_ip,
            port,
            use_random_port,
            allow_remote,
            auth_required,
            api_key,
            api_key_generated,
            jwt_secret,
            jwt_secret_generated,
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

/// Redacting Debug impl — never emit `api_key` / `jwt_secret` (§6 invariant:
/// secrets must never be logged). We surface only whether each was generated.
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
            .field("api_key_generated", &self.api_key_generated)
            .field("jwt_secret", &"<redacted>")
            .field("jwt_secret_generated", &self.jwt_secret_generated)
            .field("user_store_path", &self.user_store_path)
            .field("rate_limit_per_minute", &self.rate_limit_per_minute)
            .field("cors_enabled", &self.cors_enabled)
            .field("tls", &self.tls)
            .field("max_threads", &self.max_threads)
            .field("request_timeout_secs", &self.request_timeout_secs)
            .finish()
    }
}

// --- helpers -------------------------------------------------------------

/// Generate a hex-encoded CSPRNG secret (`SECRET_BYTES` bytes → 64 hex chars).
fn gen_secret_hex() -> String {
    let mut buf = [0u8; SECRET_BYTES];
    OsRng.fill_bytes(&mut buf);
    hex::encode(buf)
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
        assert!(!cfg.auth_required);
        // Both secrets generated in the absence of env/settings.
        assert!(cfg.api_key_generated);
        assert!(cfg.jwt_secret_generated);
        assert_eq!(cfg.api_key.len(), SECRET_BYTES * 2);
        assert_eq!(cfg.jwt_secret.len(), SECRET_BYTES * 2);
        assert_eq!(cfg.user_store_path, app_dir().join("users.json"));
        assert_eq!(cfg.rate_limit_per_minute, 0);
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
        assert!(cfg.auth_required, "auth must be forced on for remote exposure");
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
    fn no_auth_when_local_and_toggle_off() {
        let cfg = resolve(&json!({ "restApi": { "authentication": false } }));
        assert!(!cfg.auth_required);
    }

    #[test]
    fn api_key_env_overrides_settings() {
        let settings = json!({ "restApi": { "apiKey": "from-settings" } });
        let cfg = ApiRuntimeConfig::resolve_with_env(
            &settings,
            &app_dir(),
            env_from(&[("API_KEY", "from-env")]),
        );
        assert_eq!(cfg.api_key, "from-env");
        assert!(!cfg.api_key_generated);
    }

    #[test]
    fn api_key_from_settings_when_no_env() {
        let cfg = resolve(&json!({ "restApi": { "apiKey": "settings-key" } }));
        assert_eq!(cfg.api_key, "settings-key");
        assert!(!cfg.api_key_generated);
    }

    #[test]
    fn api_key_generated_when_absent_and_is_random() {
        let a = resolve(&json!({}));
        let b = resolve(&json!({}));
        assert!(a.api_key_generated && b.api_key_generated);
        // 256-bit hex-encoded.
        assert_eq!(a.api_key.len(), 64);
        assert!(a.api_key.chars().all(|c| c.is_ascii_hexdigit()));
        // Overwhelmingly likely to differ — guards against a constant.
        assert_ne!(a.api_key, b.api_key);
    }

    #[test]
    fn empty_env_key_falls_through_to_generation() {
        // API_KEY set but empty must not mask the fallback.
        let cfg = ApiRuntimeConfig::resolve_with_env(
            &json!({}),
            &app_dir(),
            env_from(&[("API_KEY", "   ")]),
        );
        assert!(cfg.api_key_generated);
        assert_eq!(cfg.api_key.len(), 64);
    }

    #[test]
    fn empty_settings_key_falls_through_to_generation() {
        // The frontend default is `apiKey: ""` — must be treated as unset.
        let cfg = resolve(&json!({ "restApi": { "apiKey": "" } }));
        assert!(cfg.api_key_generated);
    }

    #[test]
    fn jwt_secret_precedence_env_over_settings_over_gen() {
        // env wins
        let cfg = ApiRuntimeConfig::resolve_with_env(
            &json!({ "restApi": { "jwtSecret": "s-secret" } }),
            &app_dir(),
            env_from(&[("JWT_SECRET", "e-secret")]),
        );
        assert_eq!(cfg.jwt_secret, "e-secret");
        assert!(!cfg.jwt_secret_generated);

        // settings when no env
        let cfg = resolve(&json!({ "restApi": { "jwtSecret": "s-secret" } }));
        assert_eq!(cfg.jwt_secret, "s-secret");
        assert!(!cfg.jwt_secret_generated);

        // generated when neither
        let cfg = resolve(&json!({}));
        assert!(cfg.jwt_secret_generated);
    }

    #[test]
    fn generated_jwt_secret_is_at_least_256_bit() {
        let cfg = resolve(&json!({}));
        // hex chars / 2 = bytes; * 8 = bits.
        let bits = (cfg.jwt_secret.len() / 2) * 8;
        assert!(bits >= 256, "jwt secret was {bits} bits");
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

        // settings when no env
        let cfg = resolve(&json!({ "restApi": { "userStorePath": "/settings/users.json" } }));
        assert_eq!(cfg.user_store_path, PathBuf::from("/settings/users.json"));

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
            env_from(&[("API_KEY", "supersecretkey"), ("JWT_SECRET", "supersecretjwt")]),
        );
        let dbg = format!("{cfg:?}");
        assert!(!dbg.contains("supersecretkey"), "api_key leaked in Debug");
        assert!(!dbg.contains("supersecretjwt"), "jwt_secret leaked in Debug");
        assert!(dbg.contains("<redacted>"));
    }
}
