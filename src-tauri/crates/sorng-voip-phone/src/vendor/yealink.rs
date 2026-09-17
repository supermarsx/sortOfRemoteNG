//! Yealink T2x (T20P / T21P / T21P E2 …) web-admin driver.
//!
//! Two firmware generations (see [`crate::endpoints`]):
//! * **Legacy** — `/cgi-bin/ConfigManApp.com` behind HTTP Basic.
//! * **Servlet** — `/servlet?m=mod_listener…` login form, `JSESSIONID`
//!   cookie, and a password wrapped in AES under a per-session RSA key. The
//!   wire contract lives in [`super::yealink_servlet_auth`], shared with the
//!   proxy so the two cannot drift.
//!
//! Detection-first and tolerant on *status* pages: nothing here fails on a
//! missing field, and every auth failure carries the shape that was attempted.
//! Sign-in itself is the opposite — it fails closed, and only the phone's own
//! `authstatus` verdict counts as success.
//!
//! Secrets are never logged: `log::debug!` prints generation, auth shape,
//! HTTP status codes, the login outcome, and the phone model and firmware
//! (both readable from the login page without credentials).

use std::collections::BTreeMap;

use async_trait::async_trait;
use rand::SeedableRng;
use regex::Regex;
use reqwest::header::{HeaderMap, LOCATION, SET_COOKIE, WWW_AUTHENTICATE};
use reqwest::{RequestBuilder, Response, StatusCode};

use super::yealink_servlet_auth as auth;
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

/// The value of a `Set-Cookie` the response issued. **Secret**: the session id
/// binds the encrypted password to the session, so it is never logged, never
/// put in an error and never returned to the frontend.
fn cookie_value(headers: &HeaderMap, name: &str) -> Option<String> {
    let prefix = format!("{name}=");
    headers
        .get_all(SET_COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .find_map(|c| {
            let c = c.trim_start().strip_prefix(&prefix)?;
            let value = c.split(';').next().unwrap_or("").trim();
            (!value.is_empty()).then(|| value.to_string())
        })
}

fn location_points_to_login(headers: &HeaderMap) -> bool {
    location(headers).is_some_and(|l| l.contains(servlet::MARKER))
}

async fn body_text(resp: Response) -> String {
    resp.text().await.unwrap_or_default()
}

fn classification_hint(status: StatusCode, body: &str) -> String {
    auth::response_hint(status.as_u16(), body)
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

    /// Servlet sign-in, per the attested contract (see
    /// [`auth`][crate::vendor::yealink_servlet_auth]). Exactly one attempt:
    /// the phone locks an account out after repeated failures, so a rejected
    /// or locked answer is terminal and nothing here retries or backs off.
    async fn login_servlet(&self, http: &PhoneHttp) -> VoipPhoneResult<VoipPhoneAuthShape> {
        // `StdRng` rather than `thread_rng()`: this future has to stay `Send`
        // across the two awaits below.
        let mut rng = rand::rngs::StdRng::from_entropy();
        // 1) GET the login form. It issues the JSESSIONID the ciphertext is
        //    bound to, and carries the per-session RSA public key.
        let form_url =
            auth::with_cache_buster(servlet::LOGIN_FORM, servlet::PARAM_FORM_NONCE, &mut rng);
        let form_resp = http
            .client
            .get(http.url(&form_url))
            .send()
            .await
            .map_err(|e| VoipPhoneError::http(e).with_shape(VoipPhoneAuthShape::FormRsaAes))?;
        let form_status = form_resp.status();
        let session_id = cookie_value(form_resp.headers(), servlet::SESSION_COOKIE);
        let form_body = body_text(form_resp).await;
        let facts = auth::parse_login_form(&form_body);
        // `phone_type` / `firmware` are readable without credentials and are
        // not secret. The session id is, so only its presence is printed.
        log::debug!(
            "yealink servlet loginForm -> HTTP {} (session={}, encrypted={}, phone={:?}, firmware={:?})",
            form_status.as_u16(),
            session_id.is_some(),
            facts.is_encrypted(),
            facts.phone_type,
            facts.firmware,
        );

        let shape = if facts.is_encrypted() {
            VoipPhoneAuthShape::FormRsaAes
        } else {
            VoipPhoneAuthShape::FormPlain
        };
        if !form_status.is_success() {
            return Err(VoipPhoneError::connection(format!(
                "The phone's login page returned HTTP {}",
                form_status.as_u16()
            ))
            .with_shape(shape));
        }
        if !auth::is_login_page(&form_body) && !facts.is_encrypted() {
            // Not a Yealink login form at all — never post a credential to it.
            return Err(VoipPhoneError::unsupported(format!(
                "Could not classify the phone's login page: {}",
                classification_hint(form_status, &form_body)
            ))
            .with_shape(shape));
        }

        // 2) POST the credentials in the detected shape.
        let form: Vec<(&str, String)> = if facts.is_encrypted() {
            let Some(session_id) = session_id else {
                return Err(VoipPhoneError::auth(
                    "The phone did not issue a web session cookie, so the sign-in cannot be encrypted for it",
                )
                .with_shape(shape));
            };
            auth::build_login_body(
                &http.username,
                &http.password,
                &session_id,
                &facts,
                &mut rng,
            )
            .map_err(|e| e.with_shape(shape))?
        } else {
            // Pre-RSA firmware: the page offers no key, so there is nothing to
            // encrypt with. This is the only path that posts a plain password,
            // and it is reached only from a page that has no `g_rsa_n` and no
            // legacy `rsakey` either.
            vec![
                (servlet::FIELD_USERNAME, http.username.clone()),
                (servlet::FIELD_PASSWORD, http.password.clone()),
            ]
        };
        let post_url =
            auth::with_cache_buster(servlet::LOGIN_POST, servlet::PARAM_LOGIN_NONCE, &mut rng);
        let resp = http
            .client
            .post(http.url(&post_url))
            .form(&form)
            .send()
            .await
            .map_err(|e| VoipPhoneError::http(e).with_shape(shape))?;
        let status = resp.status();
        let redirect = location(resp.headers()).map(str::to_string);
        let body = body_text(resp).await;

        // 3) The phone's own verdict decides, and only a positive one is
        //    success. A rejected login answers HTTP 200 carrying
        //    `{"authstatus":"none"}` and the cookie the form GET already set,
        //    which is why neither of those may count as a sign of success.
        let outcome = auth::classify_login_response(status.as_u16(), redirect.as_deref(), &body);
        log::debug!(
            "yealink servlet login POST ({}) -> HTTP {} outcome={}",
            shape.as_str(),
            status.as_u16(),
            outcome.as_str(),
        );
        if outcome == LoginOutcome::Done {
            return Ok(shape);
        }
        Err(auth::login_outcome_error(outcome).with_shape(shape))
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
                    "Web-form login. The page's own JavaScript encrypts the password (AES, \
                     RSA-wrapped) against a per-session key before submitting, so filling the \
                     fields and clicking Confirm is not enough on its own — the phone's scripts \
                     have to run. The phone is signed in natively where possible."
                        .into(),
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
            // The attested shape. A page that turns out to carry no RSA key at
            // all falls back to `FormPlain` at login time.
            VoipPhoneGeneration::Servlet => VoipPhoneAuthShape::FormRsaAes,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_cookie_value_is_extracted_without_attributes() {
        let mut headers = HeaderMap::new();
        headers.append(SET_COOKIE, "Path=/; Other=1".parse().unwrap());
        headers.append(
            SET_COOKIE,
            "JSESSIONID=abc123def456; Path=/; HttpOnly".parse().unwrap(),
        );
        assert_eq!(
            cookie_value(&headers, servlet::SESSION_COOKIE).as_deref(),
            Some("abc123def456")
        );
        assert!(cookie_value(&HeaderMap::new(), servlet::SESSION_COOKIE).is_none());

        let mut empty = HeaderMap::new();
        empty.append(SET_COOKIE, "JSESSIONID=; Path=/".parse().unwrap());
        assert!(cookie_value(&empty, servlet::SESSION_COOKIE).is_none());
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
