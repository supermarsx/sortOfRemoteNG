//! Legacy ATEN-based CGI web API client for older Supermicro BMCs (X9–X12).
//!
//! Older Supermicro motherboards (pre-X11 or X11 with older firmware) expose
//! a proprietary CGI-based web interface built on the ATEN IPMI controller.
//! Common endpoints include:
//!
//! - `/cgi/login.cgi` — Session login
//! - `/cgi/logout.cgi` — Session logout
//! - `/cgi/ipmi.cgi` — IPMI SOL / virtual media operations
//! - `/cgi/op.cgi` — General BMC operations
//! - `/cgi/url_redirect.cgi` — iKVM / console redirect
//!
//! This client handles session cookies and CSRF tokens where needed.

use crate::error::{SmcError, SmcResult};
use crate::types::*;
use reqwest::Client;
use serde_json;

/// CGI web API client for older Supermicro BMCs.
pub struct LegacyWebClient {
    base_url: String,
    http: Client,
    session_cookie: Option<String>,
    csrf_token: Option<String>,
}

impl LegacyWebClient {
    pub fn new(host: &str, port: u16, use_ssl: bool) -> SmcResult<Self> {
        let scheme = if use_ssl { "https" } else { "http" };
        let base_url = format!("{}://{}:{}", scheme, host, port);

        let http = Client::builder()
            .danger_accept_invalid_certs(true)
            .cookie_store(true)
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|e| SmcError::legacy_web(format!("Failed to create HTTP client: {e}")))?;

        Ok(Self {
            base_url,
            http,
            session_cookie: None,
            csrf_token: None,
        })
    }

    /// Login via CGI endpoint. Returns session cookie.
    pub async fn login(&mut self, username: &str, password: &str) -> SmcResult<()> {
        let url = format!("{}/cgi/login.cgi", self.base_url);
        let form = [("name", username), ("pwd", password)];

        let resp = self
            .http
            .post(&url)
            .form(&form)
            .send()
            .await
            .map_err(|e| SmcError::legacy_web(format!("Login request failed: {e}")))?;

        if !resp.status().is_success() && resp.status().as_u16() != 302 {
            return Err(SmcError::legacy_web(format!(
                "Login failed with status {}",
                resp.status()
            )));
        }

        // Extract session cookie from response
        if let Some(cookie) = resp.headers().get("set-cookie") {
            self.session_cookie = cookie
                .to_str()
                .ok()
                .map(|s| s.split(';').next().unwrap_or(s).to_string());
        }

        // Some BMCs return CSRF token in the body or headers
        let body = resp.text().await.unwrap_or_default();
        if let Some(token_pos) = body.find("CSRF_TOKEN") {
            // Parse out the token value
            if let Some(val_start) = body[token_pos..].find('\"') {
                let rest = &body[token_pos + val_start + 1..];
                if let Some(val_end) = rest.find('\"') {
                    self.csrf_token = Some(rest[..val_end].to_string());
                }
            }
        }

        if self.session_cookie.is_none() {
            return Err(SmcError::legacy_web(
                "No session cookie received after login",
            ));
        }

        Ok(())
    }

    /// Logout and invalidate the session.
    pub async fn logout(&mut self) -> SmcResult<()> {
        let url = format!("{}/cgi/logout.cgi", self.base_url);
        let _ = self.get_raw(&url).await;
        self.session_cookie = None;
        self.csrf_token = None;
        Ok(())
    }

    /// Check if we have an active session.
    pub fn is_connected(&self) -> bool {
        self.session_cookie.is_some()
    }

    /// Perform a GET request with session authentication.
    async fn get_raw(&self, url: &str) -> SmcResult<String> {
        let mut req = self.http.get(url);

        if let Some(ref cookie) = self.session_cookie {
            req = req.header("Cookie", cookie);
        }
        if let Some(ref token) = self.csrf_token {
            req = req.header("X-CSRF-Token", token);
        }

        let resp = req
            .send()
            .await
            .map_err(|e| SmcError::legacy_web(format!("GET {} failed: {e}", url)))?;

        if !resp.status().is_success() {
            return Err(SmcError::legacy_web(format!(
                "GET {} returned {}",
                url,
                resp.status()
            )));
        }

        resp.text()
            .await
            .map_err(|e| SmcError::legacy_web(format!("Failed to read response body: {e}")))
    }

    /// Perform a GET and parse as JSON.
    async fn get_json(&self, path: &str) -> SmcResult<serde_json::Value> {
        let url = format!("{}{}", self.base_url, path);
        let body = self.get_raw(&url).await?;
        serde_json::from_str(&body)
            .map_err(|e| SmcError::legacy_web(format!("JSON parse error: {e}")))
    }

    /// Perform a POST request with form data.
    async fn post_form(&self, path: &str, params: &[(&str, &str)]) -> SmcResult<String> {
        let url = format!("{}{}", self.base_url, path);
        let mut req = self.http.post(&url).form(params);

        if let Some(ref cookie) = self.session_cookie {
            req = req.header("Cookie", cookie);
        }
        if let Some(ref token) = self.csrf_token {
            req = req.header("X-CSRF-Token", token);
        }

        let resp = req
            .send()
            .await
            .map_err(|e| SmcError::legacy_web(format!("POST {} failed: {e}", url)))?;

        if !resp.status().is_success() {
            return Err(SmcError::legacy_web(format!(
                "POST {} returned {}",
                url,
                resp.status()
            )));
        }

        resp.text()
            .await
            .map_err(|e| SmcError::legacy_web(format!("Failed to read POST response: {e}")))
    }

    // ── System info ─────────────────────────────────────────────────

    /// Get basic system information via CGI API.
    pub async fn get_system_info(&self) -> SmcResult<SystemInfo> {
        let data = self.get_json("/cgi/ipmi.cgi?op=SYSINFO").await?;

        Ok(SystemInfo {
            manufacturer: Some("Supermicro".into())
                .or_else(|| {
                    data.get("Manufacturer")
                        .and_then(|v| v.as_str())
                        .map(String::from)
                })
                .unwrap_or_else(|| "Supermicro".into()),
            model: data
                .get("ProductName")
                .or_else(|| data.get("Model"))
                .and_then(|v| v.as_str())
                .unwrap_or("Unknown")
                .to_string(),
            serial_number: data
                .get("SerialNumber")
                .and_then(|v| v.as_str())
                .map(String::from),
            sku: None,
            bios_version: data
                .get("BiosVersion")
                .and_then(|v| v.as_str())
                .map(String::from),
            hostname: None,
            power_state: data.get("PowerStatus").and_then(|v| v.as_str()).map(|s| {
                if s == "1" {
                    "On".into()
                } else {
                    "Off".into()
                }
            }),
            indicator_led: None,
            asset_tag: None,
            uuid: data.get("UUID").and_then(|v| v.as_str()).map(String::from),
            service_tag: None,
            os_name: None,
            os_version: None,
            total_memory_gib: None,
            processor_count: None,
            processor_model: None,
        })
    }

    /// Get BMC controller information via CGI API.
    pub async fn get_bmc_info(&self) -> SmcResult<SmcBmcInfo> {
        let data = self.get_json("/cgi/ipmi.cgi?op=BMCINFO").await?;

        Ok(SmcBmcInfo {
            platform: SmcPlatform::Unknown,
            firmware_version: data
                .get("FirmwareVersion")
                .or_else(|| data.get("BMCVersion"))
                .and_then(|v| v.as_str())
                .unwrap_or("Unknown")
                .to_string(),
            firmware_build_date: data
                .get("BuildDate")
                .and_then(|v| v.as_str())
                .map(String::from),
            bmc_mac_address: data
                .get("MACAddress")
                .or_else(|| data.get("BMC_MAC"))
                .and_then(|v| v.as_str())
                .map(String::from),
            ipmi_version: data
                .get("IPMIVersion")
                .and_then(|v| v.as_str())
                .map(String::from),
            bmc_model: data
                .get("BMCModel")
                .or_else(|| data.get("ControllerModel"))
                .and_then(|v| v.as_str())
                .map(String::from),
            unique_id: None,
        })
    }

    // ── Power management ────────────────────────────────────────────

    /// Execute a power action via CGI API.
    pub async fn power_action(&self, action: &PowerAction) -> SmcResult<()> {
        let op = match action {
            PowerAction::On => "POWER_ON",
            PowerAction::ForceOff => "POWER_OFF",
            PowerAction::GracefulShutdown => "POWER_SOFT_OFF",
            PowerAction::ForceRestart => "POWER_RESET",
            PowerAction::PowerCycle => "POWER_CYCLE",
            PowerAction::Nmi => "POWER_NMI",
            PowerAction::GracefulRestart => "POWER_RESET",
            PowerAction::PushPowerButton => "POWER_ON",
        };

        self.post_form("/cgi/ipmi.cgi", &[("op", op)]).await?;
        Ok(())
    }

    // ── Event log ───────────────────────────────────────────────────

    /// Get System Event Log entries via CGI API.
    pub async fn get_event_log(&self) -> SmcResult<Vec<EventLogEntry>> {
        let data = self
            .get_json("/cgi/ipmi.cgi?op=SYSLOG&start=0&count=100")
            .await?;

        let mut entries = Vec::new();
        if let Some(events) = data
            .get("Events")
            .or_else(|| data.get("SEL"))
            .and_then(|v| v.as_array())
        {
            for (i, event) in events.iter().enumerate() {
                entries.push(EventLogEntry {
                    id: event
                        .get("Id")
                        .and_then(|v| v.as_str())
                        .map(String::from)
                        .unwrap_or_else(|| format!("{}", i + 1)),
                    timestamp: event
                        .get("Timestamp")
                        .or_else(|| event.get("Date"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("Unknown")
                        .to_string(),
                    severity: event
                        .get("Severity")
                        .or_else(|| event.get("Type"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("Unknown")
                        .to_string(),
                    message: event
                        .get("Message")
                        .or_else(|| event.get("Description"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("No message")
                        .to_string(),
                    message_id: None,
                    source: event
                        .get("SensorType")
                        .and_then(|v| v.as_str())
                        .map(String::from),
                    category: event
                        .get("EventType")
                        .and_then(|v| v.as_str())
                        .map(String::from),
                });
            }
        }

        Ok(entries)
    }

    /// Clear the System Event Log.
    pub async fn clear_event_log(&self) -> SmcResult<()> {
        self.post_form("/cgi/ipmi.cgi", &[("op", "CLEAR_SEL")])
            .await?;
        Ok(())
    }

    // ── Sensor data ─────────────────────────────────────────────────

    /// Get sensor readings (temperature, fans, voltages) via CGI API.
    pub async fn get_sensor_data(&self) -> SmcResult<serde_json::Value> {
        self.get_json("/cgi/ipmi.cgi?op=SENSOR_INFO").await
    }
}
