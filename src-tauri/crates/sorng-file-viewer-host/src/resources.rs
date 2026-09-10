use crate::protocol::Document;
use std::borrow::Cow;

pub const ORIGIN: &str = "https://sorng-viewer.invalid";
pub const START_URL: &str = "https://sorng-viewer.invalid/";
pub const CSP: &str = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob:; font-src blob:; worker-src 'self'; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
pub struct Resource<'a> {
    pub mime: &'static str,
    pub bytes: Cow<'a, [u8]>,
}

pub fn allowed_resource(url: &str, method: &str) -> bool {
    method == "GET"
        && matches!(
            url.strip_prefix(ORIGIN),
            Some(
                "/" | "/viewer.js"
                    | "/viewer.css"
                    | "/metadata.json"
                    | "/document"
                    | "/pdf.min.mjs"
                    | "/pdf.worker.min.mjs"
            )
        )
}

pub fn resource<'a>(doc: &'a Document, url: &str, method: &str) -> Option<Resource<'a>> {
    if !allowed_resource(url, method) {
        return None;
    }
    let (mime, bytes): (_, Cow<'a, [u8]>) = match &url[ORIGIN.len()..] {
        "/" => (
            "text/html; charset=utf-8",
            Cow::Borrowed(include_bytes!("../assets/viewer.html")),
        ),
        "/viewer.js" => (
            "text/javascript; charset=utf-8",
            Cow::Borrowed(include_bytes!("../assets/viewer.js")),
        ),
        "/viewer.css" => (
            "text/css; charset=utf-8",
            Cow::Borrowed(include_bytes!("../assets/viewer.css")),
        ),
        "/pdf.min.mjs" => (
            "text/javascript; charset=utf-8",
            Cow::Borrowed(include_bytes!(concat!(env!("OUT_DIR"), "/pdf.min.mjs"))),
        ),
        "/pdf.worker.min.mjs" => (
            "text/javascript; charset=utf-8",
            Cow::Borrowed(include_bytes!(concat!(
                env!("OUT_DIR"),
                "/pdf.worker.min.mjs"
            ))),
        ),
        "/metadata.json" => (
            "application/json",
            Cow::Owned(serde_json::to_vec(&doc.header).ok()?),
        ),
        "/document" => (doc.mime, Cow::Borrowed(&doc.bytes)),
        _ => return None,
    };
    Some(Resource { mime, bytes })
}
pub const PDFJS_LICENSE: &str = include_str!(concat!(env!("OUT_DIR"), "/pdfjs-LICENSE"));

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn policy_allows_only_exact_get_assets_no_queries_or_escapes() {
        assert!(allowed_resource(START_URL, "GET"));
        for url in [
            "file:///secret",
            "http://sorng-viewer.invalid/",
            "https://sorng-viewer.invalid.evil/",
            "https://sorng-viewer.invalid@evil/",
            "https://sorng-viewer.invalid/document?secret=x",
            "https://sorng-viewer.invalid/%64ocument",
            "https://sorng-viewer.invalid/../document",
            "https://evil/",
            "data:text/html,bad",
            "blob:https://evil/1",
        ] {
            assert!(!allowed_resource(url, "GET"), "{url}");
        }
        for method in ["POST", "HEAD", "PUT", "CONNECT"] {
            assert!(!allowed_resource(START_URL, method));
        }
    }
    #[test]
    fn trusted_viewer_has_no_html_insertion_host_bridge_or_live_pdf_embed() {
        let js = include_str!("../assets/viewer.js");
        for forbidden in [
            "innerHTML",
            "document.write",
            "window.ipc",
            "chrome.webview",
            "<iframe",
            "<object",
            "getJSActions",
        ] {
            assert!(!js.contains(forbidden));
        }
        assert!(js.contains("textContent"));
        assert!(js.contains("isEvalSupported: false"));
        assert!(CSP.contains("frame-src 'none'"));
    }
}
