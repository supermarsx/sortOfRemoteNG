//! Yealink T2x (T20P / T21P / T21P E2 …) web-admin driver.
//!
//! Two firmware generations (see [`crate::endpoints`]):
//! * **Legacy** — `/cgi-bin/ConfigManApp.com` behind HTTP Basic.
//! * **Servlet** — `/servlet?m=mod_listener…` login form, `JSESSIONID`
//!   cookie, optional client-side RSA (v8x+).
//!
//! Detection-first and tolerant: nothing here fails on a missing status
//! field, and every auth failure carries the shape that was attempted.
//! Passwords are never logged; `log::debug!` only prints generation,
//! auth shape and HTTP status codes.

use std::collections::BTreeMap;

use async_trait::async_trait;
use base64::Engine;
use regex::Regex;
use reqwest::header::{HeaderMap, LOCATION, SET_COOKIE, WWW_AUTHENTICATE};
use reqwest::{RequestBuilder, Response, StatusCode};

use super::{PhoneHttp, VendorDriver};
use crate::endpoints::{labels, legacy, servlet};
use crate::error::{VoipPhoneError, VoipPhoneResult};
use crate::types::*;

pub struct YealinkDriver;

// ── helpers ──────────────────────────────────────────────────────────────────

fn with_basic(req: RequestBuilder, http: &PhoneHttp) -> RequestBuilder {
    req.basic_auth(&http.username, Some(&http.password))
}

fn header_str<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers.get(name).and_then(|v| v.to_str().ok())
}

fn location(headers: &HeaderMap) -> Option<&str> {
    header_str(headers, LOCATION.as_str())
}

fn sets_cookie(headers: &HeaderMap, name: &str) -> bool {
    headers
        .get_all(SET_COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .any(|c| c.trim_start().starts_with(&format!("{name}=")))
}

fn location_points_to_login(headers: &HeaderMap) -> bool {
    location(headers).is_some_and(|l| l.contains(servlet::MARKER))
}

async fn body_text(resp: Response) -> String {
    resp.text().await.unwrap_or_default()
}

fn classification_hint(status: StatusCode, body: &str) -> String {
    let snippet: String = body.chars().take(200).collect();
    let snippet = snippet.replace(['\r', '\n'], " ");
    format!("HTTP {} — first bytes: {snippet:?}", status.as_u16())
}

/// Find the RSA public modulus (hex) in the servlet login page.
fn find_rsa_modulus(body: &str) -> Option<String> {
    servlet::RSA_KEY_PATTERNS.iter().find_map(|pat| {
        Regex::new(pat)
            .ok()?
            .captures(body)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str().to_string())
    })
}

/// RSA-PKCS#1 v1.5 encrypt `plain` with the page's hex modulus (e = 0x10001),
/// base64-encoded — what the phone's own JavaScript does before submitting.
fn rsa_encrypt_password(modulus_hex: &str, plain: &str) -> VoipPhoneResult<String> {
    use rsa::{BigUint, Pkcs1v15Encrypt, RsaPublicKey};
    let n = BigUint::parse_bytes(modulus_hex.as_bytes(), 16)
        .ok_or_else(|| VoipPhoneError::parse("RSA modulus in login page is not hex"))?;
    let e = BigUint::parse_bytes(servlet::RSA_EXPONENT_HEX.as_bytes(), 16)
        .ok_or_else(|| VoipPhoneError::parse("bad RSA exponent constant"))?;
    let key = RsaPublicKey::new(n, e)
        .map_err(|e| VoipPhoneError::parse(format!("RSA public key rejected: {e}")))?;
    let mut rng = rand::thread_rng();
    let cipher = key
        .encrypt(&mut rng, Pkcs1v15Encrypt, plain.as_bytes())
        .map_err(|e| VoipPhoneError::parse(format!("RSA encryption failed: {e}")))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(cipher))
}

// ── status-page scraping ─────────────────────────────────────────────────────

fn strip_tags(html: &str) -> String {
    let no_tags = Regex::new(r"(?s)<[^>]*>").unwrap().replace_all(html, " ");
    let decoded = no_tags
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'");
    decoded.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn norm_label(s: &str) -> String {
    s.trim().trim_end_matches(':').trim().to_ascii_lowercase()
}

/// Scrape label/value pairs from table rows (`<tr><td>Label</td><td>Value</td>`)
/// and from `Label: Value` list/paragraph lines.
pub fn scrape_pairs(html: &str) -> Vec<(String, Vec<String>)> {
    let cleaned = Regex::new(r"(?is)<script[^>]*>.*?</script>|<style[^>]*>.*?</style>")
        .unwrap()
        .replace_all(html, "");
    let row_re = Regex::new(r"(?is)<tr[^>]*>(.*?)</tr>").unwrap();
    let cell_re = Regex::new(r"(?is)<t[dh][^>]*>(.*?)</t[dh]>").unwrap();
    let mut pairs = Vec::new();
    for row in row_re.captures_iter(&cleaned) {
        let cells: Vec<String> = cell_re
            .captures_iter(&row[1])
            .map(|c| strip_tags(&c[1]))
            .filter(|c| !c.is_empty())
            .collect();
        if cells.len() >= 2 {
            let label = cells[0].trim_end_matches(':').trim().to_string();
            pairs.push((label, cells[1..].to_vec()));
        } else if cells.len() == 1 {
            if let Some((l, v)) = cells[0].split_once(':') {
                if !v.trim().is_empty() {
                    pairs.push((l.trim().to_string(), vec![v.trim().to_string()]));
                }
            }
        }
    }
    let line_re = Regex::new(r"(?is)<(?:li|p|span|div)[^>]*>(.*?)</(?:li|p|span|div)>").unwrap();
    for cap in line_re.captures_iter(&cleaned) {
        let text = strip_tags(&cap[1]);
        if let Some((l, v)) = text.split_once(':') {
            let (l, v) = (l.trim(), v.trim());
            if !l.is_empty() && !v.is_empty() && l.len() < 40 && !text.contains('<') {
                pairs.push((l.to_string(), vec![v.to_string()]));
            }
        }
    }
    pairs
}

fn pick(fields: &BTreeMap<String, String>, candidates: &[&str]) -> Option<String> {
    for cand in candidates {
        if let Some(v) = fields.iter().find(|(k, _)| norm_label(k) == *cand) {
            if !v.1.is_empty() {
                return Some(v.1.clone());
            }
        }
    }
    None
}

pub fn parse_status(
    html: &str,
    generation: VoipPhoneGeneration,
    auth_shape: VoipPhoneAuthShape,
) -> VoipPhoneStatus {
    let account_re = Regex::new(labels::ACCOUNT_ROW).unwrap();
    let mut raw_fields = BTreeMap::new();
    let mut accounts: Vec<VoipAccountStatus> = Vec::new();

    for (label, values) in scrape_pairs(html) {
        let joined = values.join(" | ");
        raw_fields.entry(label.clone()).or_insert(joined.clone());

        if let Some(cap) = account_re.captures(&label) {
            let index: u32 = cap[1].parse().unwrap_or(0);
            if accounts.iter().any(|a| a.index == index) {
                continue;
            }
            let lower = joined.to_ascii_lowercase();
            let registered = labels::REGISTERED_MARKERS.iter().any(|m| lower.contains(m))
                && !labels::UNREGISTERED_MARKERS
                    .iter()
                    .any(|m| lower.contains(m));
            let user_cell = values.iter().find(|v| v.contains('@'));
            let (user, server) = match user_cell {
                Some(cell) => {
                    let (u, s) = cell.split_once('@').unwrap_or((cell, ""));
                    let u = u.trim().to_string();
                    let s = s.trim().to_string();
                    ((!u.is_empty()).then_some(u), (!s.is_empty()).then_some(s))
                }
                None => (None, None),
            };
            let raw_state = values
                .iter()
                .find(|v| {
                    let l = v.to_ascii_lowercase();
                    labels::REGISTERED_MARKERS
                        .iter()
                        .chain(labels::UNREGISTERED_MARKERS.iter())
                        .any(|m| l.contains(m))
                })
                .cloned()
                .unwrap_or_else(|| joined.clone());
            accounts.push(VoipAccountStatus {
                index,
                label,
                user,
                server,
                registered,
                raw_state,
            });
        }
    }
    accounts.sort_by_key(|a| a.index);

    VoipPhoneStatus {
        vendor: VoipPhoneVendor::Yealink,
        model: pick(&raw_fields, labels::MODEL),
        firmware: pick(&raw_fields, labels::FIRMWARE),
        hardware: pick(&raw_fields, labels::HARDWARE),
        mac: pick(&raw_fields, labels::MAC),
        ip: pick(&raw_fields, labels::IP),
        uptime: pick(&raw_fields, labels::UPTIME),
        generation,
        auth_shape,
        accounts,
        raw_fields,
    }
}

// ── driver ───────────────────────────────────────────────────────────────────

impl YealinkDriver {
    async fn login_legacy(&self, http: &PhoneHttp) -> VoipPhoneResult<VoipPhoneAuthShape> {
        let shape = VoipPhoneAuthShape::Basic;
        let resp = with_basic(http.client.get(http.url(legacy::LOGIN_PROBE)), http)
            .send()
            .await
            .map_err(|e| VoipPhoneError::http(e).with_shape(shape))?;
        let status = resp.status();
        log::debug!("yealink legacy login probe -> HTTP {}", status.as_u16());
        match status {
            s if s.is_success() => Ok(shape),
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => Err(VoipPhoneError::auth(
                "Phone rejected the HTTP Basic credentials",
            )
            .with_shape(shape)),
            s => Err(VoipPhoneError::unsupported(format!(
                "Unexpected HTTP {} from the legacy web UI",
                s.as_u16()
            ))
            .with_shape(shape)),
        }
    }

    async fn login_servlet(&self, http: &PhoneHttp) -> VoipPhoneResult<VoipPhoneAuthShape> {
        // 1) GET the login form (may already set JSESSIONID; may carry an RSA key).
        let form_resp = http
            .client
            .get(http.url(servlet::LOGIN_FORM))
            .send()
            .await
            .map_err(|e| VoipPhoneError::http(e).with_shape(VoipPhoneAuthShape::FormPlain))?;
        let form_status = form_resp.status();
        let mut cookie_seen = sets_cookie(form_resp.headers(), servlet::SESSION_COOKIE);
        let form_body = body_text(form_resp).await;
        log::debug!(
            "yealink servlet loginForm -> HTTP {} (cookie_seen={cookie_seen})",
            form_status.as_u16()
        );

        let modulus = find_rsa_modulus(&form_body);
        let shape = if modulus.is_some() {
            VoipPhoneAuthShape::FormRsa
        } else {
            VoipPhoneAuthShape::FormPlain
        };

        // 2) POST the credentials in the detected shape.
        let mut form: Vec<(&str, String)> = vec![(servlet::FIELD_USERNAME, http.username.clone())];
        match &modulus {
            Some(hex) => {
                let enc =
                    rsa_encrypt_password(hex, &http.password).map_err(|e| e.with_shape(shape))?;
                form.push((servlet::FIELD_PASSWORD, enc));
                form.push((servlet::FIELD_RSAKEY, hex.clone()));
            }
            None => form.push((servlet::FIELD_PASSWORD, http.password.clone())),
        }
        let resp = http
            .client
            .post(http.url(servlet::LOGIN_POST))
            .form(&form)
            .send()
            .await
            .map_err(|e| VoipPhoneError::http(e).with_shape(shape))?;
        let status = resp.status();
        cookie_seen |= sets_cookie(resp.headers(), servlet::SESSION_COOKIE);
        let redirected_to_data =
            location(resp.headers()).is_some_and(|l| l.contains(servlet::DATA_MARKER));
        let redirected_to_login = location_points_to_login(resp.headers());
        let body = body_text(resp).await;
        log::debug!(
            "yealink servlet login POST ({}) -> HTTP {} cookie_seen={cookie_seen} to_data={redirected_to_data}",
            shape.as_str(),
            status.as_u16()
        );

        let ok = cookie_seen
            && !redirected_to_login
            && (redirected_to_data
                || (status.is_success() && !body.contains(servlet::LOGIN_FORM_MARKER)));
        if ok {
            return Ok(shape);
        }
        let mut msg = String::from("Phone rejected the web-form login");
        if shape == VoipPhoneAuthShape::FormRsa {
            msg.push_str("; this firmware encrypts the password client-side — use Open Web UI (auto-login) if native login keeps failing");
        }
        if !cookie_seen {
            msg.push_str(" (no JSESSIONID cookie issued)");
        }
        Err(VoipPhoneError::auth(msg).with_shape(shape))
    }

    async fn fetch_status_page(
        &self,
        http: &PhoneHttp,
        generation: VoipPhoneGeneration,
    ) -> VoipPhoneResult<String> {
        let (path, req) = match generation {
            VoipPhoneGeneration::Legacy => (
                legacy::STATUS,
                with_basic(http.client.get(http.url(legacy::STATUS)), http),
            ),
            VoipPhoneGeneration::Servlet => {
                (servlet::STATUS, http.client.get(http.url(servlet::STATUS)))
            }
        };
        let resp = req.send().await.map_err(VoipPhoneError::http)?;
        let status = resp.status();
        log::debug!("yealink status page {path} -> HTTP {}", status.as_u16());
        if status == StatusCode::UNAUTHORIZED || location_points_to_login(resp.headers()) {
            return Err(VoipPhoneError::auth(
                "Phone session is no longer authenticated (re-connect)",
            ));
        }
        if !status.is_success() {
            return Err(VoipPhoneError::connection(format!(
                "Status page returned HTTP {}",
                status.as_u16()
            )));
        }
        Ok(body_text(resp).await)
    }

    async fn reboot_action_uri(
        &self,
        http: &PhoneHttp,
        generation: VoipPhoneGeneration,
    ) -> VoipPhoneResult<Option<VoipRebootResult>> {
        let path = match generation {
            VoipPhoneGeneration::Legacy => legacy::REBOOT_ACTION_URI,
            VoipPhoneGeneration::Servlet => servlet::REBOOT_ACTION_URI,
        };
        let resp = with_basic(http.client.get(http.url(path)), http)
            .send()
            .await
            .map_err(VoipPhoneError::http)?;
        let status = resp.status();
        log::debug!("yealink reboot action-URI -> HTTP {}", status.as_u16());
        if status.is_success() && !location_points_to_login(resp.headers()) {
            return Ok(Some(VoipRebootResult {
                method: VoipRebootMethod::ActionUri,
                accepted: true,
            }));
        }
        // 401/403/404 (Action URI disabled or caller not in the allow list),
        // or anything else → let the caller fall back to the web form.
        Ok(None)
    }

    async fn reboot_web_form(
        &self,
        http: &PhoneHttp,
        generation: VoipPhoneGeneration,
    ) -> VoipPhoneResult<VoipRebootResult> {
        let (req, fields) = match generation {
            VoipPhoneGeneration::Legacy => (
                with_basic(http.client.post(http.url(legacy::REBOOT_FORM)), http),
                legacy::REBOOT_FORM_FIELDS,
            ),
            VoipPhoneGeneration::Servlet => (
                http.client.post(http.url(servlet::REBOOT_FORM)),
                servlet::REBOOT_FORM_FIELDS,
            ),
        };
        let resp = req
            .form(fields)
            .send()
            .await
            .map_err(VoipPhoneError::http)?;
        let status = resp.status();
        log::debug!("yealink reboot web-form -> HTTP {}", status.as_u16());
        if status == StatusCode::UNAUTHORIZED || location_points_to_login(resp.headers()) {
            return Err(VoipPhoneError::auth(
                "Phone session is no longer authenticated (re-connect)",
            ));
        }
        if status == StatusCode::FORBIDDEN {
            return Err(VoipPhoneError::forbidden(
                "Phone refused the reboot request (HTTP 403)",
            ));
        }
        if status.is_success() || status.is_redirection() {
            return Ok(VoipRebootResult {
                method: VoipRebootMethod::WebForm,
                accepted: true,
            });
        }
        Err(VoipPhoneError::unsupported(format!(
            "Neither the Action URI nor the web reboot form was accepted (HTTP {}). Enable Features → Remote Control → Action URI on the phone, or reboot from Open Web UI.",
            status.as_u16()
        )))
    }
}

#[async_trait]
impl VendorDriver for YealinkDriver {
    fn vendor(&self) -> VoipPhoneVendor {
        VoipPhoneVendor::Yealink
    }

    async fn detect(&self, http: &PhoneHttp) -> VoipPhoneResult<VoipPhoneGeneration> {
        match http.auth_mode {
            VoipPhoneAuthMode::Basic => return Ok(VoipPhoneGeneration::Legacy),
            VoipPhoneAuthMode::Form => return Ok(VoipPhoneGeneration::Servlet),
            VoipPhoneAuthMode::Auto => {}
        }
        let resp = http
            .client
            .get(http.url("/"))
            .send()
            .await
            .map_err(VoipPhoneError::http)?;
        let status = resp.status();
        let headers = resp.headers().clone();
        let body = body_text(resp).await;
        log::debug!("yealink probe GET / -> HTTP {}", status.as_u16());

        if location(&headers).is_some_and(|l| l.contains(servlet::MARKER))
            || body.contains(servlet::MARKER)
        {
            return Ok(VoipPhoneGeneration::Servlet);
        }
        if status == StatusCode::UNAUTHORIZED {
            let realm = header_str(&headers, WWW_AUTHENTICATE.as_str())
                .unwrap_or_default()
                .to_ascii_lowercase();
            if realm.starts_with("basic")
                && (legacy::REALM_MARKERS.iter().any(|m| realm.contains(m))
                    || body.contains(legacy::BODY_MARKER))
            {
                return Ok(VoipPhoneGeneration::Legacy);
            }
            if realm.starts_with("basic") {
                // Basic challenge with an unfamiliar realm — still the best guess.
                log::debug!("yealink probe: Basic challenge with unfamiliar realm");
                return Ok(VoipPhoneGeneration::Legacy);
            }
        }
        if status.is_success() && body.contains(legacy::BODY_MARKER)
            || location(&headers).is_some_and(|l| l.contains(legacy::BODY_MARKER))
        {
            return Ok(VoipPhoneGeneration::Legacy);
        }
        Err(VoipPhoneError::unsupported(format!(
            "Could not classify the phone's web UI: {}",
            classification_hint(status, &body)
        )))
    }

    async fn login(
        &self,
        http: &PhoneHttp,
        generation: VoipPhoneGeneration,
    ) -> VoipPhoneResult<VoipPhoneAuthShape> {
        match generation {
            VoipPhoneGeneration::Legacy => self.login_legacy(http).await,
            VoipPhoneGeneration::Servlet => self.login_servlet(http).await,
        }
    }

    async fn status(
        &self,
        http: &PhoneHttp,
        generation: VoipPhoneGeneration,
        auth_shape: VoipPhoneAuthShape,
    ) -> VoipPhoneResult<VoipPhoneStatus> {
        let html = self.fetch_status_page(http, generation).await?;
        Ok(parse_status(&html, generation, auth_shape))
    }

    async fn reboot(
        &self,
        http: &PhoneHttp,
        generation: VoipPhoneGeneration,
    ) -> VoipPhoneResult<VoipRebootResult> {
        if http.action_uri_enabled {
            if let Some(done) = self.reboot_action_uri(http, generation).await? {
                return Ok(done);
            }
            log::debug!("yealink reboot: action-URI refused, falling back to web form");
        }
        self.reboot_web_form(http, generation).await
    }

    async fn logout(
        &self,
        http: &PhoneHttp,
        generation: VoipPhoneGeneration,
    ) -> VoipPhoneResult<()> {
        if generation == VoipPhoneGeneration::Servlet {
            // Best-effort; the session is dropped regardless.
            let _ = http.client.get(http.url(servlet::LOGOUT)).send().await;
        }
        Ok(())
    }

    fn web_login_hint(&self, http: &PhoneHttp, generation: VoipPhoneGeneration) -> WebLoginHint {
        match generation {
            VoipPhoneGeneration::Legacy => WebLoginHint {
                form_login: false,
                login_url: http.url(legacy::CGI),
                username_selector: None,
                password_selector: None,
                submit_selector: None,
                note: Some("HTTP Basic: the proxy injects the Authorization header".into()),
            },
            VoipPhoneGeneration::Servlet => WebLoginHint {
                form_login: true,
                login_url: http.url(servlet::LOGIN_FORM),
                username_selector: Some(servlet::SEL_USERNAME.into()),
                password_selector: Some(servlet::SEL_PASSWORD.into()),
                submit_selector: Some(servlet::SEL_SUBMIT.into()),
                note: Some(
                    "Web-form login; v8x+ firmware encrypts the password in the page's JavaScript, which the browser auto-login runs as-is".into(),
                ),
            },
        }
    }

    fn web_ui_url(&self, http: &PhoneHttp, generation: VoipPhoneGeneration) -> String {
        match generation {
            VoipPhoneGeneration::Legacy => http.url(legacy::CGI),
            VoipPhoneGeneration::Servlet => http.url(servlet::LOGIN_FORM),
        }
    }

    fn expected_auth_shape(&self, generation: VoipPhoneGeneration) -> VoipPhoneAuthShape {
        match generation {
            VoipPhoneGeneration::Legacy => VoipPhoneAuthShape::Basic,
            VoipPhoneGeneration::Servlet => VoipPhoneAuthShape::FormPlain,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rsa_modulus_is_found_in_either_page_shape() {
        let m = "ab".repeat(64);
        assert_eq!(
            find_rsa_modulus(&format!("var rsakey = \"{m}\";")).as_deref(),
            Some(m.as_str())
        );
        assert_eq!(
            find_rsa_modulus(&format!("rsa.setPublic('{m}', '10001')")).as_deref(),
            Some(m.as_str())
        );
        assert!(find_rsa_modulus("<form name=loginForm>").is_none());
    }

    #[test]
    fn status_parse_never_fails_on_empty_page() {
        let s = parse_status("", VoipPhoneGeneration::Legacy, VoipPhoneAuthShape::Basic);
        assert!(s.model.is_none() && s.accounts.is_empty() && s.raw_fields.is_empty());
    }

    #[test]
    fn account_rows_with_user_and_server() {
        let html =
            "<table><tr><td>Account 2</td><td>201@sip.example.net</td><td>Registered</td></tr>\
                    <tr><td>Account 1</td><td>Unregistered</td></tr></table>";
        let s = parse_status(
            html,
            VoipPhoneGeneration::Servlet,
            VoipPhoneAuthShape::FormPlain,
        );
        assert_eq!(s.accounts.len(), 2);
        assert_eq!(s.accounts[0].index, 1);
        assert!(!s.accounts[0].registered);
        assert_eq!(s.accounts[1].user.as_deref(), Some("201"));
        assert_eq!(s.accounts[1].server.as_deref(), Some("sip.example.net"));
        assert!(s.accounts[1].registered);
    }
}
