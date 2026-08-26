//! Status page fetch + tolerant parsing (model / firmware / build / WAN).

use crate::client::DraytekClient;
use crate::error::DraytekResult;
use crate::types::{DraytekStatus, WanStatus};
use regex::Regex;
use std::sync::OnceLock;

/// Candidate DrayOS status pages, tried in order; the first one that yields
/// any parsed field wins. Later ones are fallbacks for older/newer layouts.
pub const STATUS_PAGE_PATHS: &[&str] = &["/doc/status.sht", "/doc/online.sht", "/doc/index.sht"];

fn re(cell: &'static OnceLock<Regex>, pattern: &str) -> &'static Regex {
    cell.get_or_init(|| Regex::new(pattern).expect("static regex"))
}

/// Strip tags/scripts and collapse whitespace, keeping line structure so
/// table rows become one line each.
pub fn html_to_text(html: &str) -> String {
    static SCRIPT: OnceLock<Regex> = OnceLock::new();
    static ROW_BREAK: OnceLock<Regex> = OnceLock::new();
    static TAG: OnceLock<Regex> = OnceLock::new();
    static SPACES: OnceLock<Regex> = OnceLock::new();
    let script = re(
        &SCRIPT,
        r"(?is)<(script|style)[^>]*>.*?</\s*(script|style)\s*>",
    );
    let row_break = re(
        &ROW_BREAK,
        r"(?i)</\s*(tr|p|div|li|h[1-6]|table)\s*>|<br\s*/?>",
    );
    let tag = re(&TAG, r"(?s)<[^>]+>");
    let spaces = re(&SPACES, r"[ \t\r\x{a0}]+");
    let no_script = script.replace_all(html, " ");
    let with_lines = row_break.replace_all(&no_script, "\n");
    let no_tags = tag.replace_all(&with_lines, " ");
    let decoded = no_tags
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"");
    decoded
        .lines()
        .map(|l| spaces.replace_all(l, " ").trim().to_string())
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn clean(value: &str) -> Option<String> {
    let trimmed = value.trim().trim_matches(|c| c == ':' || c == ',').trim();
    if trimmed.is_empty() || trimmed == "---" || trimmed == "-" {
        None
    } else {
        Some(trimmed.to_string())
    }
}

/// Parse a DrayOS status page (HTML or JS-variable style) into a status.
pub fn parse_status_page(html: &str) -> DraytekStatus {
    static JS_MODEL: OnceLock<Regex> = OnceLock::new();
    static JS_FIRMWARE: OnceLock<Regex> = OnceLock::new();
    static JS_BUILD: OnceLock<Regex> = OnceLock::new();
    static TXT_MODEL: OnceLock<Regex> = OnceLock::new();
    static TXT_FIRMWARE: OnceLock<Regex> = OnceLock::new();
    static TXT_BUILD: OnceLock<Regex> = OnceLock::new();
    static TXT_HOSTNAME: OnceLock<Regex> = OnceLock::new();
    static TXT_UPTIME: OnceLock<Regex> = OnceLock::new();
    static TITLE_MODEL: OnceLock<Regex> = OnceLock::new();

    let js_model = re(
        &JS_MODEL,
        r#"(?i)\b(?:model|modelname|sModel|router_model)\s*=\s*["']([^"']+)["']"#,
    );
    let js_firmware = re(
        &JS_FIRMWARE,
        r#"(?i)\b(?:fw_ver|fwver|firmware|version|sVersion|fw_version)\s*=\s*["']v?([0-9][^"']*)["']"#,
    );
    let js_build = re(
        &JS_BUILD,
        r#"(?i)\b(?:build|build_date|buildtime|sBuild)\s*=\s*["']([^"']+)["']"#,
    );
    let txt_model = re(
        &TXT_MODEL,
        r"(?im)^(?:Router\s+|Device\s+)?Model(?:\s*Name)?\s*[:：]?\s*([A-Za-z0-9][A-Za-z0-9\-\+ ]*?)\s*$",
    );
    let txt_firmware = re(
        &TXT_FIRMWARE,
        r"(?im)^(?:Firmware\s+)?Version\s*[:：]?\s*v?([0-9][0-9A-Za-z\._ ]*?)\s*$",
    );
    let txt_build = re(
        &TXT_BUILD,
        r"(?im)^(?:Firmware\s+)?Build\s*(?:Date(?:\s*/?\s*Time)?)?\s*[:：]?\s*(.+?)\s*$",
    );
    let txt_hostname = re(
        &TXT_HOSTNAME,
        r"(?im)^(?:Router\s+|Device\s+|Host\s*)?(?:Name|Hostname)\s*[:：]?\s*([A-Za-z0-9][A-Za-z0-9\-\._]*)\s*$",
    );
    let txt_uptime = re(
        &TXT_UPTIME,
        r"(?im)^(?:System\s+)?Up\s*Time\s*[:：]?\s*(.+?)\s*$",
    );
    let title_model = re(
        &TITLE_MODEL,
        r"(?is)<title>\s*(Vigor[A-Za-z0-9\-\+ ]*?)\s*</title>",
    );

    let text = html_to_text(html);
    let first = |r: &Regex, hay: &str| r.captures(hay).and_then(|c| clean(c.get(1)?.as_str()));

    let model = first(js_model, html)
        .or_else(|| first(txt_model, &text))
        .or_else(|| first(title_model, html));
    let firmware = first(js_firmware, html).or_else(|| first(txt_firmware, &text));
    let build = first(js_build, html).or_else(|| first(txt_build, &text));
    let hostname = first(txt_hostname, &text);
    let uptime = first(txt_uptime, &text);
    let wan = parse_wan_rows(&text);

    DraytekStatus {
        model,
        firmware,
        build,
        hostname,
        uptime,
        wan,
    }
}

/// Parse WAN rows from the status page's plain text (shares the tolerant
/// CLI record parser, which also handles unlabeled table columns).
pub fn parse_wan_rows(text: &str) -> Vec<WanStatus> {
    crate::cli::parse_wan_status(text)
}

/// Fetch and parse the first status page that yields anything useful.
pub async fn fetch_status(client: &DraytekClient) -> DraytekResult<DraytekStatus> {
    let mut last_err = None;
    for path in STATUS_PAGE_PATHS {
        match client.get_text(path).await {
            Ok(body) => {
                if crate::client::contains_login_form(&body) {
                    return Err(crate::error::DraytekError::auth(
                        "DrayTek session expired: status page returned the login form",
                    ));
                }
                let status = parse_status_page(&body);
                if status != DraytekStatus::default() {
                    return Ok(status);
                }
                // Page served but nothing parsed; try the next candidate.
                last_err = Some(crate::error::DraytekError::parse(format!(
                    "no recognised status fields on {path}"
                )));
            }
            Err(e) => last_err = Some(e),
        }
    }
    // Every candidate failed or was empty: return an empty status rather than
    // hard-failing so the panel can still show the connection, unless the
    // failure was transport/auth-level.
    match last_err {
        Some(e) if !matches!(e.kind, crate::error::DraytekErrorKind::ParseError) => Err(e),
        _ => Ok(DraytekStatus::default()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_html_table_status_page() {
        let html = r#"<html><head><title>Vigor2862</title></head><body>
<table><tr><td>Model Name</td><td>Vigor2862ac</td></tr>
<tr><td>Firmware Version</td><td>3.9.7.1</td></tr>
<tr><td>Build Date/Time</td><td>Feb 17 2022 12:21:04</td></tr>
<tr><td>Router Name</td><td>edge-vigor</td></tr>
<tr><td>System Up Time</td><td>3d 04:12:55</td></tr></table>
<table><tr><th>Interface</th><th>Status</th><th>IP Address</th><th>Gateway</th></tr>
<tr><td>WAN1</td><td>Up</td><td>203.0.113.5</td><td>203.0.113.1</td></tr>
<tr><td>WAN2</td><td>Down</td><td>---</td><td>---</td></tr></table></body></html>"#;
        let status = parse_status_page(html);
        assert_eq!(status.model.as_deref(), Some("Vigor2862ac"));
        assert_eq!(status.firmware.as_deref(), Some("3.9.7.1"));
        assert_eq!(status.build.as_deref(), Some("Feb 17 2022 12:21:04"));
        assert_eq!(status.hostname.as_deref(), Some("edge-vigor"));
        assert_eq!(status.uptime.as_deref(), Some("3d 04:12:55"));
        assert_eq!(status.wan.len(), 2);
        assert_eq!(status.wan[0].ip.as_deref(), Some("203.0.113.5"));
        assert_eq!(status.wan[0].gateway.as_deref(), Some("203.0.113.1"));
        assert!(status.wan[0].is_up());
        assert!(!status.wan[1].is_up());
    }

    #[test]
    fn parses_js_variable_status_page() {
        let html = r#"<script>var model="Vigor2927"; var fw_ver="4.4.3.1"; var build="Oct 2 2023";</script>"#;
        let status = parse_status_page(html);
        assert_eq!(status.model.as_deref(), Some("Vigor2927"));
        assert_eq!(status.firmware.as_deref(), Some("4.4.3.1"));
        assert_eq!(status.build.as_deref(), Some("Oct 2 2023"));
    }

    #[test]
    fn empty_page_yields_default_status() {
        assert_eq!(parse_status_page("<html></html>"), DraytekStatus::default());
    }
}
