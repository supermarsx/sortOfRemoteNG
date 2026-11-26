//! Shared self-contained controls and compact app palette styling.
use base64::Engine;
use sha2::{Digest, Sha256};
pub const SCRIPT: &str = include_str!("internal_page.js");

pub fn script_hash() -> String {
    // HTML parsing normalizes Windows and standalone CR line endings before
    // CSP hashes script text. Match that canonical text on every build host.
    let canonical = SCRIPT.replace("\r\n", "\n").replace('\r', "\n");
    base64::engine::general_purpose::STANDARD.encode(Sha256::digest(canonical.as_bytes()))
}
fn escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}
pub fn controls(short: &str, full: &str) -> String {
    format!(
        r#"<div class="proxy-actions" aria-label="Error actions"><button type="button" id="retry" class="primary">Retry</button><button type="button" id="copy-error">Copy error</button><button type="button" id="copy-full">Copy full page</button></div><p id="action-status" role="status" aria-live="polite"></p><pre id="short-report" hidden>{}</pre><pre id="full-report" hidden>{}</pre><script>{SCRIPT}</script>"#,
        escape(short),
        escape(full)
    )
}
pub const ACTION_STYLE: &str = r#".proxy-actions{display:flex;flex-wrap:wrap;gap:8px;margin:22px 0 0}.proxy-actions button{appearance:none;font:inherit;font-size:13px;font-weight:500;border:1px solid var(--proxy-border);border-radius:6px;padding:7px 12px;background:transparent;color:var(--proxy-text);cursor:pointer}.proxy-actions button:hover{background:color-mix(in srgb,var(--proxy-text) 6%,transparent)}.proxy-actions .primary{background:var(--proxy-primary);border-color:var(--proxy-primary);color:#fff}.proxy-actions button:focus-visible,summary:focus-visible{outline:2px solid var(--proxy-primary);outline-offset:3px}#action-status{min-height:18px;margin:7px 0;color:var(--proxy-muted);font-size:12px}pre[hidden]{display:none!important}"#;
pub const COMPACT_STYLE: &str = r#"body{display:block;height:auto;min-height:100dvh;padding:24px;background:var(--proxy-bg)}main.card{align-items:stretch;text-align:left;margin:8vh auto 24px;max-width:44rem;padding:24px;background:var(--proxy-surface);border:1px solid var(--proxy-border);border-radius:8px;box-shadow:none}.card>.icon{display:none}.card h1{text-align:left;font-size:20px;font-weight:600;letter-spacing:-.02em}.card .target{text-align:left;font-size:12px;color:var(--proxy-muted)}.card .hint{max-width:none;font-size:13px}.card .detail{background:transparent;border-color:var(--proxy-border);padding:12px;border-radius:6px}.card .code-pill{align-self:flex-start;border-radius:4px;font-weight:400;letter-spacing:0;margin-bottom:12px}.card .footer{font-size:11px;color:var(--proxy-muted)}@media(max-width:480px){body{padding:12px}main.card{margin:20px auto;padding:18px}}"#;
