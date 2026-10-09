#![allow(dead_code, non_camel_case_types, private_interfaces)]
// Endpoint doubles only. The Node runner appends the unmodified production
// functions and callbacks. No CEF or Cargo target. The subresource runner is
// network-free; the redirect runner additionally exercises local socket gates.
use std::os::raw::c_int;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex, MutexGuard,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct ResourceType(u32);
impl ResourceType {
    const MAIN_FRAME: Self = Self(0);
    const SUB_FRAME: Self = Self(1);
    const STYLESHEET: Self = Self(2);
    const SCRIPT: Self = Self(3);
    const IMAGE: Self = Self(4);
    const FONT_RESOURCE: Self = Self(5);
    const SUB_RESOURCE: Self = Self(6);
    const OBJECT: Self = Self(7);
    const MEDIA: Self = Self(8);
    const WORKER: Self = Self(9);
    const SHARED_WORKER: Self = Self(10);
    const PREFETCH: Self = Self(11);
    const FAVICON: Self = Self(12);
    const XHR: Self = Self(13);
    const PING: Self = Self(14);
    const SERVICE_WORKER: Self = Self(15);
    const CSP_REPORT: Self = Self(16);
    const PLUGIN_RESOURCE: Self = Self(17);
    const NAVIGATION_PRELOAD_MAIN_FRAME: Self = Self(19);
    const NAVIGATION_PRELOAD_SUB_FRAME: Self = Self(20);
    const NUM_VALUES: Self = Self(21);
}

#[derive(Clone)]
struct CefString(Vec<u16>, bool, bool);
impl From<&str> for CefString {
    fn from(value: &str) -> Self {
        Self(value.encode_utf16().collect(), true, false)
    }
}
impl From<&CefString> for CefString {
    fn from(value: &CefString) -> Self {
        value.clone()
    }
}
impl std::fmt::Display for CefString {
    fn fmt(&self, out: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        out.write_str(&String::from_utf16(&self.0).unwrap())
    }
}
impl CefString {
    fn as_slice(&self) -> Option<&[u16]> {
        Some(&self.0)
    }
    fn try_set(&mut self, value: &str) -> bool {
        if !self.1 {
            return false;
        }
        if self.2 {
            return true;
        } // Simulated success without write: readback must catch it.
        *self = Self::from(value);
        true
    }
}

const SITE: &str = "https://fixture.invalid";
const CDN: &str = "https://cdn.invalid";
const XML: &str = "https://fixture.invalid/RDWeb/Pages/en-US/RDWAStrings.xml";
// Deliberately fixture-only origin parser; the production URL parser is not
// being tested or replaced. Unknown schemes/credentials/ports fail this double.
fn origin(url: &str) -> Result<String, ()> {
    for base in [SITE, CDN, "https://foreign.invalid"] {
        if url == base || url.starts_with(&format!("{base}/")) {
            return Ok(base.into());
        }
    }
    Err(())
}
fn canonical_browser_request_origin(value: &str) -> Result<String, ()> {
    let base = origin(value)?;
    if value == base || value == format!("{base}/") {
        Ok(base)
    } else {
        Err(())
    }
}
type BrowserIdentity = u64;
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum BrowserSessionFailure {
    NativeState,
    RedirectDenied,
}
struct AuthorizedUrl(String);
impl AuthorizedUrl {
    fn scheme(&self) -> &str {
        "https"
    }
    fn origin(&self) -> &Self {
        self
    }
    fn ascii_serialization(&self) -> String {
        self.0.clone()
    }
}
struct OriginBrowserSession {
    identity: u64,
    ready: bool,
    revoked: bool,
    failure: Option<BrowserSessionFailure>,
    observed: Mutex<Vec<String>>,
    capture_full: bool,
}
impl OriginBrowserSession {
    fn authorize_navigation(&self, identity: &u64, url: &str) -> Result<AuthorizedUrl, ()> {
        let base = origin(url)?;
        if *identity == self.identity
            && self.ready
            && !self.revoked
            && [SITE, CDN].contains(&base.as_str())
        {
            Ok(AuthorizedUrl(base))
        } else {
            Err(())
        }
    }
    fn policy(&self) -> &Self {
        self
    }
    fn source_origin(&self) -> &str {
        SITE
    }
    fn observe_network_origin(&self, origin: &str) {
        if self.capture_full {
            return;
        }
        self.observed.lock().unwrap().push(origin.into());
    }
    fn revoke(&mut self, identity: &u64) -> Result<(), ()> {
        if *identity != self.identity {
            return Err(());
        }
        self.revoked = true;
        Ok(())
    }
    fn revoke_for(&mut self, identity: &u64, reason: BrowserSessionFailure) -> Result<(), ()> {
        self.revoke(identity)?;
        self.failure.get_or_insert(reason);
        Ok(())
    }
}
#[derive(Debug, PartialEq, Eq)]
enum WebsitePermissionDecision {
    Allow,
    Deny,
}
struct EffectiveWebsitePermission {
    decision: WebsitePermissionDecision,
}
struct WebsitePermissionQuery<'a> {
    website_origin: &'a str,
    destination_origin: &'a str,
    request_class: &'a str,
    native_denied: bool,
}
#[derive(Clone)]
struct WebsitePermissionEngine {
    classes: Vec<&'static str>,
    deny_cdn: bool,
}
impl WebsitePermissionEngine {
    fn resolve(&self, query: WebsitePermissionQuery<'_>) -> EffectiveWebsitePermission {
        assert_eq!(query.website_origin, SITE);
        EffectiveWebsitePermission {
            decision: if !query.native_denied
                && self.classes.contains(&query.request_class)
                && !(self.deny_cdn && query.destination_origin == CDN)
            {
                WebsitePermissionDecision::Allow
            } else {
                WebsitePermissionDecision::Deny
            },
        }
    }
}
#[derive(Clone)]
struct Browser {
    valid: i32,
    id: i32,
}
impl Browser {
    fn is_valid(&self) -> i32 {
        self.valid
    }
    fn identifier(&self) -> i32 {
        self.id
    }
}
struct Frame {
    valid: i32,
    main: i32,
    owner: Option<Browser>,
}
impl Frame {
    fn is_valid(&self) -> i32 {
        self.valid
    }
    fn is_main(&self) -> i32 {
        self.main
    }
    fn browser(&self) -> Option<Browser> {
        self.owner.clone()
    }
}
struct Response(i32);
impl Response {
    fn status(&self) -> i32 {
        self.0
    }
}
struct Callback;
struct Request {
    kind: ResourceType,
    url: String,
}
impl Request {
    fn resource_type(&self) -> ResourceType {
        self.kind
    }
    fn url(&self) -> CefString {
        CefString::from(self.url.as_str())
    }
}
#[derive(Debug, PartialEq, Eq)]
enum ReturnValue {
    CONTINUE,
    CANCEL,
}
mod recording {
    pub struct Capture;
}
mod recording_callbacks {
    pub fn start<T, U, V>(_: T, _: U, _: V) {}
    pub fn redirect<T, U, V, W>(_: T, _: U, _: V, _: W, _: bool) {}
}
type ResourceRequestHandler = SessionResourceRequestHandler;
struct SessionResourceRequestHandler {
    session: Arc<Mutex<OriginBrowserSession>>,
    identity: BrowserIdentity,
    permissions: Arc<WebsitePermissionEngine>,
    scope: Option<ResourceScope>,
    denied: Arc<AtomicBool>,
    recording: Arc<Mutex<Option<recording::Capture>>>,
    isolate_redirect: bool,
}
impl SessionResourceRequestHandler {
    fn new(
        session: Arc<Mutex<OriginBrowserSession>>,
        identity: BrowserIdentity,
        permissions: Arc<WebsitePermissionEngine>,
        scope: Option<ResourceScope>,
        denied: Arc<AtomicBool>,
        recording: Arc<Mutex<Option<recording::Capture>>>,
        isolate_redirect: bool,
    ) -> Self {
        Self {
            session,
            identity,
            permissions,
            scope,
            denied,
            recording,
            isolate_redirect,
        }
    }
}
fn session() -> Arc<Mutex<OriginBrowserSession>> {
    Arc::new(Mutex::new(OriginBrowserSession {
        identity: 7,
        ready: true,
        revoked: false,
        failure: None,
        observed: Mutex::new(vec![]),
        capture_full: false,
    }))
}
fn engine(classes: &[&'static str], deny_cdn: bool) -> Arc<WebsitePermissionEngine> {
    Arc::new(WebsitePermissionEngine {
        classes: classes.to_vec(),
        deny_cdn,
    })
}
fn request(url: &str) -> Request {
    Request {
        kind: ResourceType::SUB_RESOURCE,
        url: url.into(),
    }
}
fn handler(
    session: Arc<Mutex<OriginBrowserSession>>,
    permissions: Arc<WebsitePermissionEngine>,
    request: &Request,
    initiator: Option<&str>,
    worker: bool,
) -> ResourceRequestHandler {
    let initiator = initiator.map(CefString::from);
    context_resource_handler(
        session,
        7,
        permissions,
        Some(request),
        0,
        0,
        initiator.as_ref(),
        worker,
        false,
        Some(&mut 0),
    )
}
fn load(handler: &ResourceRequestHandler, request: &mut Request) -> ReturnValue {
    handler.on_before_resource_load(None, None, Some(request), Some(&mut Callback))
}

#[test]
fn only_final_accepted_resources_expand_cookie_capture_scope() {
    for deny in [false, true] {
        let state = session();
        let mut req = request("https://cdn.invalid/source.js");
        let h = handler(
            state.clone(),
            engine(&["fetch-xhr"], deny),
            &req,
            Some(SITE),
            false,
        );
        // Factory admission and pure prechecks must not record a visit.
        assert!(state.lock().unwrap().observed.lock().unwrap().is_empty());
        let admitted = load(&h, &mut req);
        let retained = state.lock().unwrap();
        assert_eq!(admitted == ReturnValue::CONTINUE, !deny);
        let expected = if deny { vec![] } else { vec![CDN.to_owned()] };
        assert_eq!(*retained.observed.lock().unwrap(), expected);
    }
    // A pre-denied handler and a missing completion callback cannot record.
    for missing_callback in [false, true] {
        let state = session();
        let mut req = request(XML);
        let h = handler(
            state.clone(),
            engine(&["fetch-xhr"], false),
            &req,
            Some(SITE),
            false,
        );
        h.denied.store(!missing_callback, Ordering::Release);
        let mut callback = Callback;
        let result = h.on_before_resource_load(
            None,
            None,
            Some(&mut req),
            if missing_callback {
                None
            } else {
                Some(&mut callback)
            },
        );
        assert_eq!(result, ReturnValue::CANCEL);
        assert!(state.lock().unwrap().observed.lock().unwrap().is_empty());
    }
}

#[test]
fn cookie_capture_capacity_does_not_stop_permitted_networking() {
    let state = session();
    state.lock().unwrap().capture_full = true;
    let mut req = request(XML);
    let h = handler(
        state.clone(),
        engine(&["fetch-xhr"], false),
        &req,
        Some(SITE),
        false,
    );
    assert_eq!(load(&h, &mut req), ReturnValue::CONTINUE);
    assert!(state.lock().unwrap().observed.lock().unwrap().is_empty());
}

#[test]
fn complete_enum_mapping_changes_only_generic_fetch() {
    for value in 0..=32 {
        let expected = match value {
            0 => Some("navigation"),
            1 => Some("frame"),
            2 => Some("stylesheet"),
            3 => Some("script"),
            4 | 8 | 12 => Some("image-media"),
            5 => Some("font"),
            6 | 13 => Some("fetch-xhr"),
            9 | 10 | 15 => Some("worker"),
            _ => None,
        };
        assert_eq!(
            native_request_class(ResourceType(value)),
            expected,
            "native enum {value}"
        );
    }
}

#[test]
fn generic_fetch_needs_its_own_permission_independent_of_suffix() {
    for url in [
        XML,
        "https://fixture.invalid/no-extension",
        "https://fixture.invalid/file.js",
        "https://fixture.invalid/file.png",
        "https://cdn.invalid/manifest",
    ] {
        let mut req = request(url);
        for (classes, result) in [
            (vec!["fetch-xhr"], ReturnValue::CONTINUE),
            (
                vec!["stylesheet", "image-media", "script", "navigation", "frame"],
                ReturnValue::CANCEL,
            ),
            (vec![], ReturnValue::CANCEL),
        ] {
            assert_eq!(
                load(
                    &handler(session(), engine(&classes, false), &req, Some(SITE), false),
                    &mut req
                ),
                result
            );
        }
    }
}

#[test]
fn generic_fetch_rejects_bad_provenance_and_native_metadata() {
    for initiator in [
        None,
        Some(""),
        Some("null"),
        Some("https://foreign.invalid"),
        Some("https://fixture.invalid/path"),
        Some("https://user@fixture.invalid"),
        Some("file:///fixture"),
    ] {
        let mut req = request(XML);
        assert_eq!(
            load(
                &handler(
                    session(),
                    engine(&["fetch-xhr"], false),
                    &req,
                    initiator,
                    false
                ),
                &mut req
            ),
            ReturnValue::CANCEL
        );
    }
    let req = request(XML);
    let initiator = CefString::from(SITE);
    for (navigation, download, flag) in [
        (1, 0, true),
        (-1, 0, true),
        (2, 0, true),
        (0, -1, true),
        (0, 2, true),
        (0, 0, false),
    ] {
        let mut disabled = 0;
        let h = context_resource_handler(
            session(),
            7,
            engine(&["fetch-xhr"], false),
            Some(&req),
            navigation,
            download,
            Some(&initiator),
            false,
            true,
            flag.then_some(&mut disabled),
        );
        assert!(h.denied.load(Ordering::Acquire));
        if flag {
            assert_eq!(disabled, 1);
        }
    }
    // An opaque navigation origin does not authorize generic resources even
    // when the caller passes the independently verified navigation-frame flag.
    for navigation in [0, 1] {
        assert!(ResourceScope::from_native(
            ResourceType::SUB_RESOURCE,
            navigation,
            Some(&CefString::from("null")),
            false,
            true
        )
        .is_none());
    }
}

#[test]
fn generic_fetch_never_opens_other_schemes_routes_or_stale_attempts() {
    for url in [
        "http://fixture.invalid/",
        "https://foreign.invalid/RDWAStrings.xml",
        "https://fixture.invalid:444/",
        "https://user@fixture.invalid/",
        "ws://fixture.invalid/",
        "wss://fixture.invalid/",
        "file:///RDWAStrings.xml",
        "data:text/xml,x",
        "about:blank",
    ] {
        let mut req = request(url);
        assert_eq!(
            load(
                &handler(
                    session(),
                    engine(&["fetch-xhr", "websocket"], false),
                    &req,
                    Some(SITE),
                    false
                ),
                &mut req
            ),
            ReturnValue::CANCEL
        );
    }
    for state in 0..3 {
        let session = session();
        let mut req = request(XML);
        let h = handler(
            session.clone(),
            engine(&["fetch-xhr"], false),
            &req,
            Some(SITE),
            false,
        );
        assert_eq!(load(&h, &mut req), ReturnValue::CONTINUE);
        let mut s = session.lock().unwrap();
        match state {
            0 => s.ready = false,
            1 => s.revoked = true,
            _ => s.identity = 8,
        }
        drop(s);
        assert_eq!(load(&h, &mut req), ReturnValue::CANCEL);
    }
}

#[test]
fn generic_worker_fetch_needs_both_permissions_and_validated_native_initiator() {
    for initiator in [
        Some(SITE),
        Some(CDN),
        None,
        Some("null"),
        Some("https://foreign.invalid"),
    ] {
        for classes in [
            vec!["fetch-xhr"],
            vec!["worker"],
            vec!["worker", "fetch-xhr"],
        ] {
            let mut req = request("https://cdn.invalid/data");
            let expected = if matches!(initiator, Some(SITE | CDN)) && classes.len() == 2 {
                ReturnValue::CONTINUE
            } else {
                ReturnValue::CANCEL
            };
            assert_eq!(
                load(
                    &handler(session(), engine(&classes, false), &req, initiator, true),
                    &mut req
                ),
                expected
            );
        }
    }
}

#[test]
fn worker_scripts_require_own_initiator_origin_and_worker_permission() {
    for kind in [
        ResourceType::WORKER,
        ResourceType::SHARED_WORKER,
        ResourceType::SERVICE_WORKER,
    ] {
        for initiator in [
            Some(SITE),
            Some(CDN),
            None,
            Some("null"),
            Some("https://foreign.invalid"),
        ] {
            for target in [SITE, CDN] {
                for classes in [vec!["script"], vec!["worker"]] {
                    let mut req = Request {
                        kind,
                        url: format!("{target}/worker.js"),
                    };
                    let expected = if initiator == Some(target) && classes.contains(&"worker") {
                        ReturnValue::CONTINUE
                    } else {
                        ReturnValue::CANCEL
                    };
                    assert_eq!(
                        load(
                            &handler(session(), engine(&classes, false), &req, initiator, false),
                            &mut req
                        ),
                        expected
                    );
                }
            }
        }
    }
}

#[test]
fn worker_origin_deny_is_checked_even_when_fetch_destination_is_allowed() {
    let mut req = request(XML); // Resource destination is allowed, worker CDN is not.
    let h = handler(
        session(),
        engine(&["worker", "fetch-xhr"], true),
        &req,
        Some(CDN),
        true,
    );
    assert_eq!(load(&h, &mut req), ReturnValue::CANCEL);
    let h = handler(
        session(),
        engine(&["worker", "fetch-xhr"], false),
        &req,
        Some(CDN),
        true,
    );
    assert_eq!(load(&h, &mut req), ReturnValue::CONTINUE);
    for classes in [vec!["script"], vec!["script", "fetch-xhr"], vec!["worker"]] {
        let h = handler(session(), engine(&classes, false), &req, Some(CDN), true);
        assert_eq!(load(&h, &mut req), ReturnValue::CANCEL);
    }
}

#[test]
fn redirect_rechecks_fetch_destination_and_denial_cannot_revive() {
    for target in [
        "https://cdn.invalid/image.png",
        "https://foreign.invalid/RDWAStrings.xml",
        "http://fixture.invalid/",
        "wss://fixture.invalid/socket",
    ] {
        for mutable_target in [true, false] {
            let session = session();
            let mut req = request(XML);
            let h = handler(
                session.clone(),
                engine(&["fetch-xhr", "stylesheet", "websocket"], true),
                &req,
                Some(SITE),
                false,
            );
            assert_eq!(load(&h, &mut req), ReturnValue::CONTINUE);
            let mut destination = CefString::from(target);
            h.on_resource_redirect(
                None,
                None,
                Some(&mut req),
                Some(&mut Response(302)),
                mutable_target.then_some(&mut destination),
            );
            assert!(session.lock().unwrap().revoked);
            assert!(h.denied.load(Ordering::Acquire));
            if mutable_target {
                assert_eq!(
                    destination.to_string(),
                    "about:blank#blocked-native-request"
                );
            }
            assert_eq!(load(&h, &mut req), ReturnValue::CANCEL);
            let mut approved = CefString::from(XML);
            h.on_resource_redirect(
                None,
                None,
                Some(&mut req),
                Some(&mut Response(302)),
                Some(&mut approved),
            );
            assert_eq!(load(&h, &mut req), ReturnValue::CANCEL);
        }
    }
    let mut req = request(XML);
    let h = handler(
        session(),
        engine(&["fetch-xhr"], false),
        &req,
        Some(SITE),
        false,
    );
    let mut approved = CefString::from("https://cdn.invalid/data");
    h.on_resource_redirect(
        None,
        None,
        Some(&mut req),
        Some(&mut Response(302)),
        Some(&mut approved),
    );
    req.url = approved.to_string();
    assert_eq!(load(&h, &mut req), ReturnValue::CONTINUE);
    req.kind = ResourceType::XHR; // Even a type in the same class cannot replace native metadata.
    assert_eq!(load(&h, &mut req), ReturnValue::CANCEL);
}
