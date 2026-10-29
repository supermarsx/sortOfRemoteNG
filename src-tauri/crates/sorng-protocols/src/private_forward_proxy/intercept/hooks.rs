//! K5: native exchange hooks (owner: x1).
//!
//! Hooks are native only, registered at attempt start in a fixed order, never
//! defined from IPC or page script. Views see heads only (body hooks are not
//! in v1) and refuse edits to the authority, scheme, `Host`, `Proxy-*`,
//! framing headers, and adding `Set-Cookie`.

use crate::private_forward_proxy::Authority;
use hyper::http::{header, HeaderMap, HeaderName, HeaderValue, Method, StatusCode, Uri};

/// Per-exchange context visible to hooks.
#[derive(Clone, Debug)]
pub struct ExchangeCtx {
    /// The tunnel (CONNECT) or plain-HTTP authority of this exchange.
    pub authority: Authority,
    /// True inside an intercepted TLS tunnel, false for plain `http://`.
    pub secure: bool,
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

/// Request head; method and URI (authority, scheme) are read-only.
#[derive(Debug)]
pub struct RequestHeadView {
    method: Method,
    uri: Uri,
    headers: HeaderMap,
}

impl RequestHeadView {
    // Constructed by x1's exchange pipeline.
    #[allow(dead_code)]
    pub(crate) fn new(method: Method, uri: Uri, headers: HeaderMap) -> Self {
        Self {
            method,
            uri,
            headers,
        }
    }

    // Consumed by x1's exchange pipeline.
    #[allow(dead_code)]
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
#[derive(Debug)]
pub struct ResponseHeadView {
    status: StatusCode,
    headers: HeaderMap,
}

impl ResponseHeadView {
    // Constructed by x1's exchange pipeline.
    #[allow(dead_code)]
    pub(crate) fn new(status: StatusCode, headers: HeaderMap) -> Self {
        Self { status, headers }
    }

    // Consumed by x1's exchange pipeline.
    #[allow(dead_code)]
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
}
