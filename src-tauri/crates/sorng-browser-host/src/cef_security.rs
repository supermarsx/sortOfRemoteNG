//! Current-document certificate inspection through CEF, never a new socket.
//! CEF's NavigationEntry survives valid certificates and cached page loads.
//! A fixed local Security.enable query fills the cipher CEF SSLStatus omits.
use super::*;
use crate::native_security::{self, MAX_CERT, MAX_EVENT};
use std::cell::RefCell;
use std::sync::Weak;

const QUERY_MS: i64 = 3_000;
const MAX_VIEWS: usize = 128;
static NEXT: AtomicU64 = AtomicU64::new(1);

#[derive(Clone)]
pub struct NativeSecurityEvidence {
    pub identity: BrowserIdentity,
    pub view_id: Option<String>,
    pub sequence: u64,
    pub inspection_id: u64,
    pub origin: String,
    pub chain_der: Vec<Vec<u8>>,
    pub system_ca_valid: bool,
    pub tls_version: Option<String>,
    pub cipher_suite: Option<String>,
    pub transport_pending: bool,
}

struct Pending {
    owner: Weak<Shared>,
    browser: Browser,
    serial: u64,
    generation: u64,
    evidence: NativeSecurityEvidence,
    deadline: Instant,
}
struct Cached {
    generation: u64,
    origin: String,
    leaf: Vec<u8>,
    protocol: String,
    cipher: String,
}
struct Listener {
    owner: Weak<Shared>,
    _registration: Registration,
    cached: Option<Cached>,
}
thread_local! { static PENDING: RefCell<HashMap<usize, Pending>> = RefCell::new(HashMap::new()); }
thread_local! { static LISTENERS: RefCell<HashMap<usize, Listener>> = RefCell::new(HashMap::new()); }

fn key(shared: &Shared) -> usize {
    shared as *const Shared as usize
}
fn generation(shared: &Shared) -> Option<u64> {
    shared
        .automation
        .lock()
        .ok()
        .and_then(|state| state.available().then_some(state.generation))
}
fn event_generation(shared: &Shared) -> Option<u64> {
    shared
        .automation
        .lock()
        .ok()
        .and_then(|state| (state.generation != u64::MAX).then_some(state.generation))
}
pub(super) fn close(shared: &Shared) {
    PENDING.with(|slots| {
        slots.borrow_mut().remove(&key(shared));
    });
    LISTENERS.with(|slots| {
        slots.borrow_mut().remove(&key(shared));
    });
}
fn binary(value: BinaryValue) -> Option<Vec<u8>> {
    let size = value.size();
    if size == 0 || size > MAX_CERT {
        return None;
    }
    let mut bytes = vec![0; size];
    (value.data(Some(&mut bytes), 0) == size).then_some(bytes)
}
fn version(value: SslVersion) -> Option<String> {
    Some(
        match value {
            SslVersion::SSL2 => "SSL 2.0",
            SslVersion::SSL3 => "SSL 3.0",
            SslVersion::TLS1 => "TLS 1.0",
            SslVersion::TLS1_1 => "TLS 1.1",
            SslVersion::TLS1_2 => "TLS 1.2",
            SslVersion::TLS1_3 => "TLS 1.3",
            SslVersion::QUIC => "QUIC",
            _ => return None,
        }
        .into(),
    )
}
fn bounded_url(value: CefStringUserfree) -> Option<String> {
    let value = CefString::from(&value);
    (value.as_slice()?.len() <= 16_384).then(|| value.to_string())
}

fn collect(shared: &Shared, browser: &Browser) -> Option<NativeSecurityEvidence> {
    if !shared.current() || !shared.accepts(Some(browser)) {
        return None;
    }
    let state = shared.state.lock().ok()?;
    if state.page.load_failure.is_some() || !state.page.document_loaded {
        return None;
    }
    let sequence = state.sequence;
    drop(state);
    let session = shared.session.lock().ok()?;
    // The navigation entry of an intercepted browser describes the app proxy's
    // minted leaf, not the upstream website. Only the proxy reports that leg.
    if session.intercept_authority().is_some() {
        return None;
    }
    drop(session);
    let frame = browser.main_frame()?;
    if frame.is_valid() != 1 || frame.is_main() != 1 {
        return None;
    }
    let url = bounded_url(frame.url())?;
    let origin = https_origin(&url)?;
    if !shared
        .session
        .lock()
        .ok()?
        .authorize_navigation(&shared.identity, &url)
        .is_ok()
    {
        return None;
    }
    let entry = browser.host()?.visible_navigation_entry()?;
    if entry.is_valid() != 1 || bounded_url(entry.url())? != url {
        return None;
    }
    let ssl = entry.sslstatus()?;
    if ssl.is_secure_connection() != 1 {
        return None;
    }
    let cert = ssl.x509_certificate()?;
    if cert.issuer_chain_size() > 31 {
        return None;
    }
    let mut chain_der = vec![binary(cert.derencoded()?)?];
    let mut issuers = Vec::new();
    cert.derencoded_issuer_chain(Some(&mut issuers));
    if issuers.len() > 31 {
        return None;
    }
    let mut total = chain_der[0].len();
    for issuer in issuers {
        let bytes = binary(issuer?)?;
        total = total.checked_add(bytes.len())?;
        if total > 2 * 1024 * 1024 {
            return None;
        }
        chain_der.push(bytes);
    }
    let system_ca_valid = is_cert_status_error(ssl.cert_status()) == 0;
    Some(NativeSecurityEvidence {
        identity: shared.identity.clone(),
        view_id: shared.popup.view_id(),
        sequence,
        inspection_id: 0,
        origin,
        chain_der,
        system_ca_valid,
        tls_version: version(ssl.sslversion()),
        cipher_suite: None,
        transport_pending: false,
    })
}

fn emit(shared: &Shared, evidence: NativeSecurityEvidence) {
    // An observer must never alter native admission or turn metadata parsing
    // into a browser failure. The app sink performs its own current-owner fence.
    let _ = catch_unwind(AssertUnwindSafe(|| shared.sink.on_security(evidence)));
}

fn finish(shared: &Shared, serial: u64, transport: Option<(String, String)>) {
    let pending = PENDING.with(|slots| {
        let mut slots = slots.borrow_mut();
        if slots.get(&key(shared))?.serial != serial {
            return None;
        }
        slots.remove(&key(shared))
    });
    let Some(mut pending) = pending else {
        return;
    };
    if !shared.current()
        || generation(shared) != Some(pending.generation)
        || !shared.accepts(Some(&pending.browser))
    {
        return;
    }
    let Some(current) = collect(shared, &pending.browser) else {
        return;
    };
    if current.origin != pending.evidence.origin
        || current.chain_der.first() != pending.evidence.chain_der.first()
    {
        return;
    }
    pending.evidence.transport_pending = false;
    if let Some((protocol, cipher)) = transport {
        pending.evidence.tls_version = Some(protocol);
        pending.evidence.cipher_suite = Some(cipher);
    }
    emit(shared, pending.evidence);
}

wrap_dev_tools_message_observer! {
    struct Observer { owner: Weak<Shared>, queued: Arc<AtomicU32> }
    impl DevToolsMessageObserver {
        fn on_dev_tools_event(&self, browser: Option<&mut Browser>, method: Option<&CefString>, params: Option<&[u8]>) {
            if !method.is_some_and(|method| method.as_slice().is_some_and(|s| s.len() <= 64) && method.to_string() == "Security.visibleSecurityStateChanged") { return; }
            let Some(bytes) = params.filter(|bytes| bytes.len() <= MAX_EVENT) else { return; };
            let Some(shared) = self.owner.upgrade().filter(|shared| shared.current() && shared.accepts(browser.as_deref())) else { return; };
            let Some(generation) = event_generation(&shared) else { return; };
            let Some(origin) = browser.as_ref().and_then(|browser| browser.main_frame()).and_then(|frame| bounded_url(frame.url())).and_then(|url| https_origin(&url)) else { return; };
            // A page changing its security state repeatedly cannot create an
            // unbounded queue of large native events during this short query.
            if self.queued.fetch_update(Ordering::AcqRel, Ordering::Acquire, |count| (count < 4).then_some(count + 1)).is_err() { return; }
            let mut reply = Reply::new(self.owner.clone(), generation, origin, browser.cloned(), Arc::new(bytes.to_vec()), self.queued.clone());
            // DevTools can synchronously reenter while the app registry is
            // borrowed. Deliver the observation on a separate UI turn.
            if post_task(ThreadId::UI, Some(&mut reply)) != 1 { self.queued.fetch_sub(1, Ordering::AcqRel); }
        }
    }
}
wrap_task! {
    struct Reply { owner: Weak<Shared>, generation: u64, origin: String, browser: Option<Browser>, bytes: Arc<Vec<u8>>, queued: Arc<AtomicU32> }
    impl Task {
        fn execute(&self) {
            self.queued.fetch_sub(1, Ordering::AcqRel);
            let Some(shared) = self.owner.upgrade() else { return; };
            if !shared.current() || !shared.accepts(self.browser.as_ref()) || event_generation(&shared) != Some(self.generation) { return; }
            let Some((leaf, protocol, cipher)) = native_security::read_transport(&self.bytes) else { return; };
            let transport = PENDING.with(|slots| {
                let slots = slots.borrow();
                let pending = slots.get(&key(&shared))?;
                (pending.generation == self.generation && pending.evidence.origin == self.origin
                    && pending.evidence.chain_der.first() == Some(&leaf) && Instant::now() < pending.deadline)
                    .then(|| (pending.serial, (protocol.clone(), cipher.clone())))
            });
            LISTENERS.with(|slots| {
                if let Some(listener) = slots.borrow_mut().get_mut(&key(&shared)) {
                    listener.cached = Some(Cached { generation: self.generation, origin: self.origin.clone(), leaf, protocol, cipher });
                }
            });
            if let Some((serial, transport)) = transport { finish(&shared, serial, Some(transport)); }
        }
    }
}
wrap_task! {
    struct Expire { owner: Weak<Shared>, serial: u64 }
    impl Task {
        fn execute(&self) {
            if let Some(shared) = self.owner.upgrade() { finish(&shared, self.serial, None); }
            PENDING.with(|slots| slots.borrow_mut().retain(|_, pending| pending.owner.strong_count() != 0));
            LISTENERS.with(|slots| slots.borrow_mut().retain(|_, listener| listener.owner.strong_count() != 0));
        }
    }
}

pub(super) fn inspect(
    host: &CefBrowserHost<'_>,
    identity: &BrowserIdentity,
    inspection_id: u64,
) -> Result<(), BrowserError> {
    let browser = host.check(identity)?;
    let shared = &host.shared;
    let coalesced = PENDING.with(|slots| {
        let mut slots = slots.borrow_mut();
        let pending = slots.get_mut(&key(shared))?;
        if Instant::now() >= pending.deadline || generation(shared) != Some(pending.generation) {
            return None;
        }
        let updated = (pending.evidence.inspection_id != inspection_id).then(|| {
            pending.evidence.inspection_id = inspection_id;
            pending.evidence.clone()
        });
        Some(updated)
    });
    if let Some(updated) = coalesced {
        if let Some(evidence) = updated {
            emit(shared, evidence);
        }
        return Ok(());
    }
    let Some(mut evidence) = collect(shared, &browser) else {
        return Ok(());
    };
    evidence.inspection_id = inspection_id;
    let Some(generation) = generation(shared) else {
        return Err(BrowserError::StateUnavailable);
    };
    let cached = LISTENERS.with(|slots| {
        let slots = slots.borrow();
        let cached = slots.get(&key(shared))?.cached.as_ref()?;
        (cached.generation == generation
            && cached.origin == evidence.origin
            && evidence.chain_der.first() == Some(&cached.leaf))
        .then(|| (cached.protocol.clone(), cached.cipher.clone()))
    });
    if let Some((protocol, cipher)) = cached {
        evidence.tls_version = Some(protocol);
        evidence.cipher_suite = Some(cipher);
        emit(shared, evidence);
        return Ok(());
    }
    let serial = NEXT.fetch_add(1, Ordering::Relaxed);
    let native = browser.host().ok_or(BrowserError::StateUnavailable)?;
    // Keep the bounded native observer until OnBeforeClose. Security.enable
    // need not re-send an event when already enabled. A listener retained over
    // navigation also captures the new document before its popup opens.
    let mut listening = LISTENERS.with(|slots| slots.borrow().contains_key(&key(shared)));
    if !listening {
        let room = LISTENERS.with(|slots| {
            let mut slots = slots.borrow_mut();
            slots.retain(|_, listener| listener.owner.strong_count() != 0);
            slots.len() < MAX_VIEWS
        });
        if room {
            let mut observer = Observer::new(Arc::downgrade(shared), Arc::new(AtomicU32::new(0)));
            if let Some(registration) = native.add_dev_tools_message_observer(Some(&mut observer)) {
                LISTENERS.with(|slots| {
                    slots.borrow_mut().insert(
                        key(shared),
                        Listener {
                            owner: Arc::downgrade(shared),
                            _registration: registration,
                            cached: None,
                        },
                    )
                });
                listening = true;
            }
        }
    }
    let accepted = PENDING.with(|slots| {
        let mut slots = slots.borrow_mut();
        slots.retain(|_, p| p.owner.strong_count() != 0);
        if !listening || (slots.len() >= MAX_VIEWS && !slots.contains_key(&key(shared))) {
            return false;
        }
        evidence.transport_pending = true;
        slots.insert(
            key(shared),
            Pending {
                owner: Arc::downgrade(shared),
                browser: browser.clone(),
                serial,
                generation,
                evidence: evidence.clone(),
                deadline: Instant::now() + Duration::from_millis(QUERY_MS as u64),
            },
        );
        true
    });
    emit(shared, evidence);
    if !accepted {
        return Ok(());
    }
    LISTENERS.with(|slots| {
        if let Some(listener) = slots.borrow_mut().get_mut(&key(shared)) {
            listener.cached = None;
        }
    });
    let mut expiry = Expire::new(Arc::downgrade(shared), serial);
    if post_delayed_task(ThreadId::UI, Some(&mut expiry), QUERY_MS) != 1 {
        finish(shared, serial, None);
        return Ok(());
    }
    // This private CEF DevTools channel has no certificate-error override
    // client. Refresh only its Security observation subscription; the native
    // socket admission hook remains authoritative and is never modified.
    if !native_security::refresh_subscription(|method| {
        native.execute_dev_tools_method(0, Some(&CefString::from(method)), None) > 0
    }) {
        finish(shared, serial, None);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use cef::rc::{ConvertParam, ConvertReturnValue, RcImpl};
    use cef::sys::*;

    struct Sink;
    impl BrowserEventSink for Sink {
        fn on_event(&self, _: BrowserEvent) {}
    }
    fn text(value: &str) -> cef_string_userfree_t {
        let units: Vec<_> = value.encode_utf16().collect();
        unsafe {
            let output = cef_string_userfree_utf16_alloc();
            cef_string_utf16_set(units.as_ptr(), units.len(), output, 1);
            output
        }
    }
    fn leaf() -> BinaryValue {
        extern "C" fn size(_: *mut _cef_binary_value_t) -> usize {
            4
        }
        extern "C" fn data(
            _: *mut _cef_binary_value_t,
            buffer: *mut std::ffi::c_void,
            size: usize,
            offset: usize,
        ) -> usize {
            if size < 4 || offset != 0 {
                return 0;
            }
            unsafe {
                std::ptr::copy_nonoverlapping(b"leaf".as_ptr(), buffer.cast::<u8>(), 4);
            }
            4
        }
        let raw = _cef_binary_value_t {
            get_size: Some(size),
            get_data: Some(data),
            ..unsafe { std::mem::zeroed() }
        };
        let raw: *mut _cef_binary_value_t = RcImpl::new(raw, ()).cast();
        raw.wrap_result()
    }
    fn certificate() -> X509Certificate {
        extern "C" fn der(_: *mut _cef_x509_certificate_t) -> *mut _cef_binary_value_t {
            leaf().into_raw()
        }
        let raw = _cef_x509_certificate_t {
            get_derencoded: Some(der),
            ..unsafe { std::mem::zeroed() }
        };
        let raw: *mut _cef_x509_certificate_t = RcImpl::new(raw, ()).cast();
        raw.wrap_result()
    }
    fn ssl() -> Sslstatus {
        extern "C" fn secure(_: *mut _cef_sslstatus_t) -> i32 {
            1
        }
        extern "C" fn certificate(_: *mut _cef_sslstatus_t) -> *mut _cef_x509_certificate_t {
            self::certificate().into_raw()
        }
        extern "C" fn version(_: *mut _cef_sslstatus_t) -> cef_ssl_version_t {
            cef_ssl_version_t::SSL_CONNECTION_VERSION_TLS1_3
        }
        let raw = _cef_sslstatus_t {
            is_secure_connection: Some(secure),
            get_x509_certificate: Some(certificate),
            get_sslversion: Some(version),
            ..unsafe { std::mem::zeroed() }
        };
        let raw: *mut _cef_sslstatus_t = RcImpl::new(raw, ()).cast();
        raw.wrap_result()
    }
    fn browser(entry_url: &'static str) -> Browser {
        extern "C" fn frame_url(_: *mut _cef_frame_t) -> cef_string_userfree_t {
            text("https://fixture.invalid/cached")
        }
        extern "C" fn valid_frame(_: *mut _cef_frame_t) -> i32 {
            1
        }
        let frame = _cef_frame_t {
            is_valid: Some(valid_frame),
            is_main: Some(valid_frame),
            get_url: Some(frame_url),
            ..unsafe { std::mem::zeroed() }
        };
        let frame: *mut _cef_frame_t = RcImpl::new(frame, ()).cast();
        let frame: Frame = frame.wrap_result();
        extern "C" fn entry_address(this: *mut _cef_navigation_entry_t) -> cef_string_userfree_t {
            text(RcImpl::<_cef_navigation_entry_t, &'static str>::get(this).interface)
        }
        extern "C" fn valid_entry(_: *mut _cef_navigation_entry_t) -> i32 {
            1
        }
        extern "C" fn entry_ssl(_: *mut _cef_navigation_entry_t) -> *mut _cef_sslstatus_t {
            ssl().into_raw()
        }
        let entry = _cef_navigation_entry_t {
            is_valid: Some(valid_entry),
            get_url: Some(entry_address),
            get_sslstatus: Some(entry_ssl),
            ..unsafe { std::mem::zeroed() }
        };
        let entry: *mut _cef_navigation_entry_t = RcImpl::new(entry, entry_url).cast();
        let entry: NavigationEntry = entry.wrap_result();
        extern "C" fn navigation(this: *mut _cef_browser_host_t) -> *mut _cef_navigation_entry_t {
            RcImpl::<_cef_browser_host_t, NavigationEntry>::get(this)
                .interface
                .clone()
                .into_raw()
        }
        let host = _cef_browser_host_t {
            get_visible_navigation_entry: Some(navigation),
            ..unsafe { std::mem::zeroed() }
        };
        let host: *mut _cef_browser_host_t = RcImpl::new(host, entry).cast();
        let host: BrowserHost = host.wrap_result();
        type Facts = (Frame, BrowserHost);
        extern "C" fn main(this: *mut _cef_browser_t) -> *mut _cef_frame_t {
            RcImpl::<_cef_browser_t, Facts>::get(this)
                .interface
                .0
                .clone()
                .into_raw()
        }
        extern "C" fn native_host(this: *mut _cef_browser_t) -> *mut _cef_browser_host_t {
            RcImpl::<_cef_browser_t, Facts>::get(this)
                .interface
                .1
                .clone()
                .into_raw()
        }
        extern "C" fn valid(_: *mut _cef_browser_t) -> i32 {
            1
        }
        extern "C" fn id(_: *mut _cef_browser_t) -> i32 {
            41
        }
        let raw = _cef_browser_t {
            is_valid: Some(valid),
            get_identifier: Some(id),
            get_main_frame: Some(main),
            get_host: Some(native_host),
            ..unsafe { std::mem::zeroed() }
        };
        let raw: *mut _cef_browser_t = RcImpl::new(raw, (frame, host)).cast();
        raw.wrap_result()
    }
    async fn owner() -> Shared {
        #[cfg(target_os = "macos")]
        crate::platform::test_runtime::ensure_loaded();
        crate::bootstrap_platform::select_pinned_api().unwrap();
        let shared = super::super::tests::fixture(Arc::new(Sink)).await;
        {
            let mut session = shared.session.lock().unwrap();
            let readiness = sorng_protocols::origin_browser::NativeHostReadiness::Ready {
                profile_key: session.policy().profile_key().into(),
                proxy_endpoint: session.proxy_endpoint(),
            };
            session.report_host(&shared.identity, readiness).unwrap();
        }
        {
            let mut state = shared.state.lock().unwrap();
            state.browser_id = Some(41);
            state.page.document_loaded = true;
            state.sequence = 12;
        }
        shared
    }
    #[tokio::test]
    async fn valid_cached_navigation_produces_certificate_and_version_without_error_or_handshake_callback(
    ) {
        let shared = owner().await;
        let value = collect(&shared, &browser("https://fixture.invalid/cached")).unwrap();
        assert_eq!(value.chain_der, vec![b"leaf".to_vec()]);
        assert_eq!(value.tls_version.as_deref(), Some("TLS 1.3"));
        assert!(value.system_ca_valid);
        assert_eq!(value.sequence, 12);
        assert_eq!(value.origin, "https://fixture.invalid");
        assert!(!value.transport_pending);
        assert_eq!(value.view_id, None);
    }
    #[tokio::test]
    async fn provisional_or_failed_documents_never_reuse_the_previous_navigation_certificate() {
        let shared = owner().await;
        assert!(collect(&shared, &browser("https://fixture.invalid/previous")).is_none());
        shared.state.lock().unwrap().page.document_loaded = false;
        assert!(collect(&shared, &browser("https://fixture.invalid/cached")).is_none());
        shared.state.lock().unwrap().page.document_loaded = true;
        shared.state.lock().unwrap().page.load_failure =
            crate::native_navigation::classify_load_error(-20, true);
        assert!(collect(&shared, &browser("https://fixture.invalid/cached")).is_none());
    }
    #[derive(Default)]
    struct Observations(Mutex<Vec<NativeSecurityEvidence>>);
    impl BrowserEventSink for Observations {
        fn on_event(&self, _: BrowserEvent) {}
        fn on_security(&self, evidence: NativeSecurityEvidence) {
            self.0.lock().unwrap().push(evidence);
        }
    }
    #[tokio::test]
    async fn deferred_transport_reply_is_fenced_even_when_replacement_uses_same_origin_url_and_leaf(
    ) {
        let mut shared = owner().await;
        let sink = Arc::new(Observations::default());
        shared.sink = sink.clone();
        let shared = Arc::new(shared);
        let browser = browser("https://fixture.invalid/cached");
        let mut evidence = collect(&shared, &browser).unwrap();
        evidence.inspection_id = 17;
        evidence.transport_pending = true;
        PENDING.with(|slots| {
            slots.borrow_mut().insert(
                key(&shared),
                Pending {
                    owner: Arc::downgrade(&shared),
                    browser,
                    serial: 41,
                    generation: generation(&shared).unwrap(),
                    evidence,
                    deadline: Instant::now() + Duration::from_secs(3),
                },
            )
        });
        // Main-frame BeforeBrowse uses this exact invalidation operation even
        // when the replacement has the same URL and certificate.
        shared.automation.lock().unwrap().invalidate();
        finish(&shared, 41, Some(("TLS 1.3".into(), "AES_256_GCM".into())));
        assert!(sink.0.lock().unwrap().is_empty());
        assert!(!PENDING.with(|slots| slots.borrow().contains_key(&key(&shared))));
    }
    #[tokio::test]
    async fn timeout_retains_certificate_and_version_but_terminates_pending_metadata() {
        let mut shared = owner().await;
        let sink = Arc::new(Observations::default());
        shared.sink = sink.clone();
        let shared = Arc::new(shared);
        let browser = browser("https://fixture.invalid/cached");
        let mut evidence = collect(&shared, &browser).unwrap();
        evidence.inspection_id = 18;
        evidence.transport_pending = true;
        PENDING.with(|slots| {
            slots.borrow_mut().insert(
                key(&shared),
                Pending {
                    owner: Arc::downgrade(&shared),
                    browser,
                    serial: 42,
                    generation: generation(&shared).unwrap(),
                    evidence,
                    deadline: Instant::now(),
                },
            )
        });
        finish(&shared, 42, None);
        let values = sink.0.lock().unwrap();
        assert_eq!(values.len(), 1);
        assert!(!values[0].transport_pending);
        assert_eq!(values[0].inspection_id, 18);
        assert_eq!(values[0].chain_der.first().unwrap(), b"leaf");
        assert_eq!(values[0].tls_version.as_deref(), Some("TLS 1.3"));
        assert_eq!(values[0].cipher_suite, None);
    }
}
