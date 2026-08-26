//! DrayOS web-admin session client using reqwest with a cookie jar
//! (`SESSION_ID_VIGOR`). Mirrors `PfsenseClient` including the insecure-TLS
//! runtime-acknowledgement contract.

use crate::error::{DraytekError, DraytekResult};
use crate::types::{DraytekConnectionConfig, DraytekConnectionSummary};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use log::debug;
use regex::Regex;
use reqwest::Client as HttpClient;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

pub const LOGIN_PAGE_PATH: &str = "/weblogin.htm";
pub const LOGIN_CGI_PATH: &str = "/cgi-bin/wlogin.cgi";
pub const SESSION_COOKIE: &str = "SESSION_ID_VIGOR";

pub struct DraytekClient {
    pub config: DraytekConnectionConfig,
    http: HttpClient,
    session_cookie_seen: AtomicBool,
    logged_in: AtomicBool,
    /// Last scraped anti-CSRF token (≥ 4.4 firmware); re-used by actions.
    form_auth: Mutex<Option<String>>,
}

/// What the login page told us about the firmware's login scheme.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct LoginPageInfo {
    pub form_auth_str: Option<String>,
    pub rsa_encrypted_password: bool,
}

fn re(cell: &'static OnceLock<Regex>, pattern: &str) -> &'static Regex {
    cell.get_or_init(|| Regex::new(pattern).expect("static regex"))
}

/// Scrape `sFormAuthStr` (either attribute order) and detect a client-side
/// RSA password-encryption scheme from a served login page.
pub fn inspect_login_page(html: &str) -> LoginPageInfo {
    static TOKEN_NAME_FIRST: OnceLock<Regex> = OnceLock::new();
    static TOKEN_VALUE_FIRST: OnceLock<Regex> = OnceLock::new();
    static TOKEN_JS: OnceLock<Regex> = OnceLock::new();
    static RSA: OnceLock<Regex> = OnceLock::new();
    let name_first = re(
        &TOKEN_NAME_FIRST,
        r#"(?is)<input[^>]*\bname\s*=\s*["']?sFormAuthStr["']?[^>]*\bvalue\s*=\s*["']([^"'>]+)["']?"#,
    );
    let value_first = re(
        &TOKEN_VALUE_FIRST,
        r#"(?is)<input[^>]*\bvalue\s*=\s*["']([^"'>]+)["']?[^>]*\bname\s*=\s*["']?sFormAuthStr["']?"#,
    );
    let js = re(&TOKEN_JS, r#"(?i)sFormAuthStr\s*[=:]\s*["']([^"']+)["']"#);
    let rsa = re(
        &RSA,
        r"(?i)\bRSAKey\b|\bsetPublic\s*\(|\bencryptedString\s*\(|\brsa_public_key\b|\bRSA_PUBLIC\b|\bpubkey\s*=\s*['\x22][0-9A-Fa-f]{32,}|\bmodulus\s*[:=]",
    );
    let form_auth_str = name_first
        .captures(html)
        .or_else(|| value_first.captures(html))
        .or_else(|| js.captures(html))
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().trim().to_string())
        .filter(|s| !s.is_empty());
    LoginPageInfo {
        form_auth_str,
        rsa_encrypted_password: rsa.is_match(html),
    }
}

/// True when the HTML still contains the DrayOS login form (`aa`/`ab`
/// inputs or the `wlogin.cgi` action), i.e. the credentials were rejected.
pub fn contains_login_form(html: &str) -> bool {
    static FORM: OnceLock<Regex> = OnceLock::new();
    let form = re(
        &FORM,
        r#"(?is)<form[^>]*wlogin\.cgi|<input[^>]*\bname\s*=\s*["']?a[ab]["']?[\s>]|id\s*=\s*["']?(?:sUsername|sPassword|tUsername|tPassword)["']?"#,
    );
    form.is_match(html)
}

/// Encode a credential the DrayOS way: base64 of the raw bytes. URL-encoding
/// is applied by the form serialiser.
pub fn encode_credential(value: &str) -> String {
    BASE64.encode(value.as_bytes())
}

impl DraytekClient {
    pub fn new(mut config: DraytekConnectionConfig) -> DraytekResult<Self> {
        if config.host.trim().is_empty() {
            return Err(DraytekError::invalid_request("host must not be empty"));
        }
        if config.timeout_secs == 0 {
            return Err(DraytekError::invalid_request(
                "request timeout must be greater than zero",
            ));
        }
        if config.username.trim().is_empty() {
            return Err(DraytekError::auth("username must be provided"));
        }
        if config.vendor.trim().is_empty() {
            config.vendor = crate::types::DEFAULT_VENDOR.to_string();
        }
        let acknowledged = std::mem::take(&mut config.acknowledge_invalid_cert_risk);
        let effective_tls_skip = config.use_tls && config.accept_invalid_certs;
        if effective_tls_skip != acknowledged {
            return Err(DraytekError::invalid_request(
                "TLS certificate verification bypass requires an explicit runtime acknowledgement for this connection attempt",
            ));
        }

        let mut builder = HttpClient::builder()
            .danger_accept_invalid_certs(effective_tls_skip)
            .cookie_store(true)
            .timeout(Duration::from_secs(config.timeout_secs));
        if let Some(proxy_url) = config
            .proxy_url
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            let proxy = reqwest::Proxy::all(proxy_url)
                .map_err(|e| DraytekError::connection(format!("invalid proxy URL: {e}")))?;
            builder = builder.proxy(proxy);
        }
        let http = builder
            .build()
            .map_err(|e| DraytekError::connection(format!("HTTP client build: {e}")))?;
        Ok(Self {
            config,
            http,
            session_cookie_seen: AtomicBool::new(false),
            logged_in: AtomicBool::new(false),
            form_auth: Mutex::new(None),
        })
    }

    fn scheme(&self) -> &str {
        if self.config.use_tls {
            "https"
        } else {
            "http"
        }
    }

    pub fn base_url(&self) -> String {
        format!(
            "{}://{}:{}",
            self.scheme(),
            self.config.host,
            self.config.port
        )
    }

    pub fn url(&self, path: &str) -> String {
        format!("{}/{}", self.base_url(), path.trim_start_matches('/'))
    }

    pub fn is_logged_in(&self) -> bool {
        self.logged_in.load(Ordering::SeqCst)
    }

    pub fn form_auth_str(&self) -> Option<String> {
        self.form_auth.lock().ok().and_then(|g| g.clone())
    }

    fn note_cookies(&self, resp: &reqwest::Response) {
        let seen = resp
            .headers()
            .get_all(reqwest::header::SET_COOKIE)
            .iter()
            .filter_map(|v| v.to_str().ok())
            .any(|v| v.trim_start().starts_with(SESSION_COOKIE));
        if seen {
            self.session_cookie_seen.store(true, Ordering::SeqCst);
        }
    }

    fn request_error(context: String, error: reqwest::Error) -> DraytekError {
        let message = format!("{context}: {error}");
        if error.is_timeout() {
            DraytekError::timeout(message)
        } else if error.is_connect() {
            DraytekError::connection(message)
        } else {
            DraytekError::http(message)
        }
    }

    fn map_status_error(status: u16, body: &str) -> DraytekError {
        match status {
            401 | 403 => DraytekError::auth(format!("Access denied (HTTP {status}): {body}")),
            404 => DraytekError::api(format!("Not found (HTTP 404): {body}")),
            _ => DraytekError::http(format!("HTTP {status}: {body}")),
        }
    }

    // ── Raw helpers ──────────────────────────────────────────────

    /// GET a path and return the body text (session cookie sent from the jar).
    pub async fn get_text(&self, path: &str) -> DraytekResult<String> {
        let url = self.url(path);
        debug!("DRAYTEK GET {url}");
        let resp = self
            .http
            .get(&url)
            .send()
            .await
            .map_err(|e| Self::request_error(format!("GET {url}"), e))?;
        self.note_cookies(&resp);
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(Self::map_status_error(status.as_u16(), &body));
        }
        Ok(body)
    }

    /// POST an `application/x-www-form-urlencoded` body and return the text.
    pub async fn post_form(&self, path: &str, form: &[(&str, String)]) -> DraytekResult<String> {
        let url = self.url(path);
        debug!("DRAYTEK POST {url}");
        let resp = self
            .http
            .post(&url)
            .form(form)
            .send()
            .await
            .map_err(|e| Self::request_error(format!("POST {url}"), e))?;
        self.note_cookies(&resp);
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(Self::map_status_error(status.as_u16(), &body));
        }
        Ok(body)
    }

    // ── Login ────────────────────────────────────────────────────

    /// Perform the DrayOS login (classic `aa`/`ab` base64 or ≥ 4.4 with a
    /// scraped `sFormAuthStr`). RSA-encrypted schemes are refused with
    /// `UnsupportedFirmwareLogin`.
    pub async fn login(&self) -> DraytekResult<()> {
        let page = self.get_text(LOGIN_PAGE_PATH).await?;
        let info = inspect_login_page(&page);
        if info.rsa_encrypted_password {
            return Err(DraytekError::unsupported_firmware_login(
                "This firmware encrypts the password in the browser (RSA login scheme); the session login is not supported yet. Use \"Open Web UI\" to log in through the browser.",
            ));
        }
        if let Ok(mut guard) = self.form_auth.lock() {
            *guard = info.form_auth_str.clone();
        }

        let mut form: Vec<(&str, String)> = vec![
            ("aa", encode_credential(&self.config.username)),
            ("ab", encode_credential(&self.config.password)),
        ];
        if let Some(token) = info.form_auth_str.as_deref() {
            form.push(("sFormAuthStr", token.to_string()));
        }
        let body = self.post_form(LOGIN_CGI_PATH, &form).await?;

        if contains_login_form(&body) {
            self.logged_in.store(false, Ordering::SeqCst);
            return Err(DraytekError::auth(
                "DrayTek login rejected: the device returned the login form again (check username/password)",
            ));
        }
        if !self.session_cookie_seen.load(Ordering::SeqCst) {
            self.logged_in.store(false, Ordering::SeqCst);
            return Err(DraytekError::auth(format!(
                "DrayTek login did not issue a {SESSION_COOKIE} session cookie"
            )));
        }
        self.logged_in.store(true, Ordering::SeqCst);
        Ok(())
    }

    /// Log in (if needed) and probe the status page for a summary.
    pub async fn ping(&self) -> DraytekResult<DraytekConnectionSummary> {
        if !self.is_logged_in() {
            self.login().await?;
        }
        let status = crate::status::fetch_status(self).await?;
        Ok(DraytekConnectionSummary {
            host: self.config.host.clone(),
            vendor: self.config.vendor.clone(),
            model: status.model,
            firmware: status.firmware,
            hostname: status.hostname,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credential_encoding_is_plain_base64() {
        assert_eq!(encode_credential("admin"), "YWRtaW4=");
        assert_eq!(encode_credential("p@ss w0rd"), "cEBzcyB3MHJk");
    }

    #[test]
    fn login_page_inspection_scrapes_token_in_both_attribute_orders() {
        let a = r#"<form action="/cgi-bin/wlogin.cgi"><input type="hidden" name="sFormAuthStr" value="abc123"></form>"#;
        let b = r#"<input type="hidden" value="xyz789" name='sFormAuthStr'>"#;
        assert_eq!(
            inspect_login_page(a).form_auth_str.as_deref(),
            Some("abc123")
        );
        assert_eq!(
            inspect_login_page(b).form_auth_str.as_deref(),
            Some("xyz789")
        );
        assert!(!inspect_login_page(a).rsa_encrypted_password);
    }

    #[test]
    fn login_page_inspection_detects_rsa_scheme() {
        let html = r#"<script>var rsa = new RSAKey(); rsa.setPublic(modulus, "10001");</script>"#;
        assert!(inspect_login_page(html).rsa_encrypted_password);
    }

    #[test]
    fn login_form_detection() {
        assert!(contains_login_form(
            r#"<form method="post" action="/cgi-bin/wlogin.cgi">"#
        ));
        assert!(contains_login_form(r#"<input name="aa" type="text">"#));
        assert!(!contains_login_form("<html><body>Dashboard</body></html>"));
    }
}
