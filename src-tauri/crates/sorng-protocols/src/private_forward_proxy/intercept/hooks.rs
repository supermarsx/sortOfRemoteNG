//! K5: native exchange hooks (owner: x1).
//!
//! Request hooks run before the cache lookup; response hooks run on what is
//! served (cache hit or upstream). A panicking hook turns the exchange into a
//! synthetic 500; a hook is never skipped. After every response hook the
//! pipeline strips `Alt-Svc` (no QUIC around the interception).
//!
//! Hooks are native only, registered at attempt start in a fixed order, never
//! defined from IPC or page script. Views see heads only (body hooks are not
//! in v1) and refuse edits to the authority, scheme, `Host`, `Proxy-*`,
//! framing headers, and adding `Set-Cookie`.

use crate::private_forward_proxy::Authority;
use hyper::http::{header, HeaderMap, HeaderName, HeaderValue, Method, StatusCode, Uri};

/// Per-exchange context visible to hooks. `Debug` omits the authority.
#[derive(Clone)]
pub struct ExchangeCtx {
    /// The tunnel (CONNECT) or plain-HTTP authority of this exchange.
    pub authority: Authority,
    /// True inside an intercepted TLS tunnel, false for plain `http://`.
    pub secure: bool,
}

impl std::fmt::Debug for ExchangeCtx {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ExchangeCtx")
            .field("secure", &self.secure)
            .finish_non_exhaustive()
    }
}

/// A static, script-free, form-free response a hook may answer with.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct StaticResponse {
    pub status: StatusCode,
    pub content_type: &'static str,
    pub body: &'static [u8],
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum HookVerdict {
    Continue,
    Respond(StaticResponse),
    Block,
}

/// A view refused an edit to a protected header.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct HeadEditRefused;

pub trait ExchangeHook: Send + Sync + 'static {
    fn on_request(&self, ctx: &ExchangeCtx, head: &mut RequestHeadView) -> HookVerdict;
    fn on_response(&self, ctx: &ExchangeCtx, head: &mut ResponseHeadView);
}

fn protected(name: &HeaderName) -> bool {
    name == header::HOST
        || name == header::CONTENT_LENGTH
        || name == header::TRANSFER_ENCODING
        || name.as_str().starts_with("proxy-")
}

/// Request head; method and URI (authority, scheme) are read-only. `Debug`
/// shows only the method and the header count: never the URI or headers.
pub struct RequestHeadView {
    method: Method,
    uri: Uri,
    headers: HeaderMap,
}

impl std::fmt::Debug for RequestHeadView {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RequestHeadView")
            .field("method", &self.method)
            .field("header_count", &self.headers.len())
            .finish_non_exhaustive()
    }
}

impl RequestHeadView {
    pub(crate) fn new(method: Method, uri: Uri, headers: HeaderMap) -> Self {
        Self {
            method,
            uri,
            headers,
        }
    }

    pub(crate) fn into_parts(self) -> (Method, Uri, HeaderMap) {
        (self.method, self.uri, self.headers)
    }

    pub fn method(&self) -> &Method {
        &self.method
    }

    pub fn uri(&self) -> &Uri {
        &self.uri
    }

    pub fn headers(&self) -> &HeaderMap {
        &self.headers
    }

    pub fn set_header(
        &mut self,
        name: HeaderName,
        value: HeaderValue,
    ) -> Result<(), HeadEditRefused> {
        if protected(&name) {
            return Err(HeadEditRefused);
        }
        self.headers.insert(name, value);
        Ok(())
    }

    pub fn remove_header(&mut self, name: &HeaderName) -> Result<(), HeadEditRefused> {
        if protected(name) {
            return Err(HeadEditRefused);
        }
        self.headers.remove(name);
        Ok(())
    }
}

/// Response head; status is read-only and `Set-Cookie` may only be removed.
/// `Debug` shows only the status and the header count.
pub struct ResponseHeadView {
    status: StatusCode,
    headers: HeaderMap,
}

impl std::fmt::Debug for ResponseHeadView {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ResponseHeadView")
            .field("status", &self.status)
            .field("header_count", &self.headers.len())
            .finish_non_exhaustive()
    }
}

impl ResponseHeadView {
    pub(crate) fn new(status: StatusCode, headers: HeaderMap) -> Self {
        Self { status, headers }
    }

    pub(crate) fn into_parts(self) -> (StatusCode, HeaderMap) {
        (self.status, self.headers)
    }

    pub fn status(&self) -> StatusCode {
        self.status
    }

    pub fn headers(&self) -> &HeaderMap {
        &self.headers
    }

    pub fn set_header(
        &mut self,
        name: HeaderName,
        value: HeaderValue,
    ) -> Result<(), HeadEditRefused> {
        if protected(&name) || name == header::SET_COOKIE || name.as_str() == "set-cookie2" {
            return Err(HeadEditRefused);
        }
        self.headers.insert(name, value);
        Ok(())
    }

    pub fn remove_header(&mut self, name: &HeaderName) -> Result<(), HeadEditRefused> {
        if protected(name) {
            return Err(HeadEditRefused);
        }
        self.headers.remove(name);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn views_refuse_protected_edits() {
        let mut req = RequestHeadView::new(Method::GET, Uri::from_static("/"), HeaderMap::new());
        let v = HeaderValue::from_static("x");
        assert_eq!(
            req.set_header(header::HOST, v.clone()),
            Err(HeadEditRefused)
        );
        assert_eq!(
            req.set_header(header::PROXY_AUTHORIZATION, v.clone()),
            Err(HeadEditRefused)
        );
        assert_eq!(
            req.remove_header(&header::TRANSFER_ENCODING),
            Err(HeadEditRefused)
        );
        assert_eq!(req.set_header(header::ACCEPT, v.clone()), Ok(()));

        let mut resp = ResponseHeadView::new(StatusCode::OK, HeaderMap::new());
        assert_eq!(
            resp.set_header(header::SET_COOKIE, v.clone()),
            Err(HeadEditRefused)
        );
        assert_eq!(
            resp.set_header(header::CONTENT_LENGTH, v.clone()),
            Err(HeadEditRefused)
        );
        assert_eq!(resp.remove_header(&header::SET_COOKIE), Ok(()));
        assert_eq!(resp.remove_header(&header::ALT_SVC), Ok(()));
    }

    const SENTINEL_HOST: &str = "sentinel-host.invalid";
    const SENTINEL_VALUE: &str = "sentinel-secret-7f3a";

    fn sentinel_headers() -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(header::HOST, HeaderValue::from_static(SENTINEL_HOST));
        headers.insert(header::COOKIE, HeaderValue::from_static(SENTINEL_VALUE));
        headers.insert(
            header::AUTHORIZATION,
            HeaderValue::from_static(SENTINEL_VALUE),
        );
        headers.insert(header::SET_COOKIE, HeaderValue::from_static(SENTINEL_VALUE));
        headers
    }

    fn assert_redacted(debug: &str) {
        assert!(!debug.contains(SENTINEL_HOST), "host leaked: {debug}");
        assert!(
            !debug.contains(SENTINEL_VALUE),
            "header value leaked: {debug}"
        );
        for name in ["cookie", "authorization", "set-cookie", "host"] {
            assert!(
                !debug.to_ascii_lowercase().contains(name),
                "header name leaked: {debug}"
            );
        }
    }

    #[test]
    fn request_head_debug_is_redacted() {
        let uri: Uri = format!("https://{SENTINEL_HOST}/{SENTINEL_VALUE}?q={SENTINEL_VALUE}")
            .parse()
            .expect("uri");
        let view = RequestHeadView::new(Method::POST, uri, sentinel_headers());
        let debug = format!("{view:?} {view:#?}");
        assert_redacted(&debug);
        assert!(debug.contains("POST"), "{debug}");
        assert!(debug.contains("header_count: 4"), "{debug}");
    }

    #[test]
    fn response_head_debug_is_redacted() {
        let view = ResponseHeadView::new(StatusCode::FOUND, sentinel_headers());
        let debug = format!("{view:?} {view:#?}");
        assert_redacted(&debug);
        assert!(debug.contains("302"), "{debug}");
        assert!(debug.contains("header_count: 4"), "{debug}");
    }

    #[test]
    fn exchange_ctx_debug_omits_the_authority() {
        let ctx = ExchangeCtx {
            authority: Authority::parse(&format!("{SENTINEL_HOST}:443")).expect("authority"),
            secure: true,
        };
        let debug = format!("{ctx:?} {ctx:#?}");
        assert_redacted(&debug);
        assert!(debug.contains("secure: true"), "{debug}");
    }
}
