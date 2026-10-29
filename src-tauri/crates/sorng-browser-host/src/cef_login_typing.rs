//! Paced username/password/extra-input delivery, using the prior approved login
//! stage. Renderer requests contain only field roles, never credential text.
use super::*;
use std::collections::HashSet;
use zeroize::Zeroizing;

#[derive(Default)]
pub(super) struct State {
    used: HashSet<(String, String)>,
    pending: Option<Pending>,
    // Stages that were sent a native key in this attempt, and stages whose
    // typing stopped. A stopped stage without a key is settled into the budget.
    typed: HashSet<(String, NativeLoginStage)>,
    ended: Vec<(String, NativeLoginStage)>,
    // Releases whose document is still in place: frame, main frame, origin, stage.
    delivered: Vec<(String, String, String, NativeLoginStage)>,
}

struct Pending {
    nonce: String,
    role: String,
    url: String,
    frame: String,
    origin: String,
    stage: NativeLoginStage,
    generation: u64,
    input: NativeAuthTyping,
    next: usize,
    length: usize,
    expires: Instant,
    deadline: f64,
    held: Option<u64>,
}

impl State {
    /// Keys of a released stage are being sent right now.
    pub(super) fn busy(&self) -> bool {
        self.pending.is_some()
    }

    /// An explicit user credentials retry starts this attempt's typing record
    /// again, together with the login budget it settles into. Callers first
    /// check that nothing is being typed.
    pub(super) fn restart(&mut self) {
        if self.pending.is_none() {
            *self = Self::default();
        }
    }

    pub(super) fn cancel(&mut self) {
        if let Some(pending) = self.pending.take() {
            self.stopped(&pending.origin, pending.stage);
        }
    }

    pub(super) fn cancel_frame(&mut self, frame_id: &str) {
        if self.pending.as_ref().is_some_and(|p| p.frame == frame_id) {
            self.cancel();
        }
        // A navigating frame replaces its document, and a navigating main frame
        // every document below it. Their releases can no longer be used.
        let replaced: Vec<_> = self
            .delivered
            .extract_if(.., |(frame, main, ..)| frame == frame_id || main == frame_id)
            .collect();
        for (_, _, origin, stage) in replaced {
            self.stopped(&origin, stage);
        }
    }

    /// A stage was released to the document in this frame. The login budget
    /// allows two releases per origin and stage, which bounds the list.
    pub(super) fn released(
        &mut self,
        frame: String,
        main: String,
        origin: &str,
        stage: NativeLoginStage,
    ) {
        if self.delivered.len() < 256 {
            self.delivered.push((frame, main, origin.to_owned(), stage));
        }
    }

    // Typing for this stage stopped, or its document was replaced. Callers pass
    // only pairs the login budget has released, which bounds the list.
    fn stopped(&mut self, origin: &str, stage: NativeLoginStage) {
        let key = (origin.to_owned(), stage);
        if !self.ended.contains(&key) {
            self.ended.push(key);
        }
    }

    /// Stopped stages that were never sent a key, before or after they stopped:
    /// they entered nothing, so their release may be re-armed. A prepare stage
    /// is handed out only to settle a successor's prepare request, because the
    /// document it was released to may have survived a refused navigation and
    /// still be about to fill.
    pub(super) fn take_ended(&mut self, prepare: bool) -> Vec<(String, NativeLoginStage)> {
        let (ready, kept): (Vec<_>, Vec<_>) = std::mem::take(&mut self.ended)
            .into_iter()
            .partition(|(_, stage)| prepare || *stage != NativeLoginStage::FormPrepare);
        self.ended = kept;
        let typed = &self.typed;
        ready.into_iter().filter(|key| !typed.contains(key)).collect()
    }
}

fn parse(event: &str) -> Option<(&str, NativeLoginStage, &str, usize)> {
    let fields: Vec<_> = event.split('|').collect();
    if event.len() > 128
        || fields.len() != 5
        || fields[0] != "type"
        || !matches!(fields[1], "start" | "key" | "cancel")
    {
        return None;
    }
    let stage = NativeLoginStage::parse(fields[2])?;
    if stage.is_action() || stage == NativeLoginStage::FormPrepare {
        return None;
    }
    let field = fields[3];
    if !matches!(field, "username" | "password")
        && !field
            .strip_prefix("extra")
            .and_then(|v| v.parse::<usize>().ok())
            .is_some_and(|i| i < 16)
    {
        return None;
    }
    // A staged release types only its own field: an identifier stage the
    // username, a password stage the password. Only a form stage has both.
    if match stage {
        NativeLoginStage::Identifier => field != "username",
        NativeLoginStage::Password | NativeLoginStage::BoundPassword => field != "password",
        _ => false,
    } {
        return None;
    }
    let index = fields[4].parse::<usize>().ok().filter(|i| *i <= 4096)?;
    if fields[1] != "key" && index != 0 {
        return None;
    }
    Some((fields[1], stage, field, index))
}

fn field_value(
    credentials: &NativeLoginCredentials<'_>,
    options: Option<&str>,
    field: &str,
) -> Option<Zeroizing<String>> {
    let value = match field {
        "username" => Zeroizing::new(credentials.username.to_owned()),
        "password" => Zeroizing::new(credentials.password.to_owned()),
        _ => {
            let index = field.strip_prefix("extra")?.parse::<usize>().ok()?;
            // Parse only the native-owned options delivered under this grant.
            let options = crate::cef_renderer::parse_login_configuration(options?)?.dictionary()?;
            let fields = options.value(Some(&CefString::from("fields")))?.list()?;
            let field = fields.value(index)?.dictionary()?;
            if field.get_type(Some(&CefString::from("value"))) != ValueType::STRING {
                return None;
            }
            Zeroizing::new(
                CefString::from(&field.string(Some(&CefString::from("value")))).to_string(),
            )
        }
    };
    (!value.is_empty() && value.len() <= 16384 && !value.chars().any(char::is_control))
        .then_some(value)
}

#[allow(clippy::too_many_arguments)]
pub(super) fn receive(
    shared: &Arc<Shared>,
    browser: &Browser,
    frame: &Frame,
    nonce: &str,
    event: &str,
    url: &str,
    origin: &str,
    entry: Entry,
) {
    let Some((action, stage, field, index)) = parse(event) else {
        return;
    };
    if !stage_allowed(shared.login_adapter, stage, url)
        // Declarative steps carry no extra fields, and a key is typed only
        // where the steps put this stage (origin, live path, frame).
        || (shared.login_adapter == NativeLoginAdapter::Declarative
            && !matches!(field, "username" | "password"))
        || !shared.login_frames.declarative_allows(
            shared.login_adapter,
            stage,
            url,
            frame.is_main() == 1,
            None,
        )
        || !shared
            .login_budget
            .lock()
            .is_ok_and(|budget| budget.released(origin, stage))
    {
        return;
    }
    let Some(hooks) = &shared.hooks else {
        return;
    };
    let role = format!("type|{}|{field}", stage.wire());
    // Explicit manual entry owns the keyboard. A start repeats after the delay
    // without spending its one-shot grant; a key request is held further down.
    if entry.manual && action == "start" {
        reply(frame, nonce, origin, &role, "wait", INTERLOCK_WAIT_MS, 0.0, false);
        return;
    }
    let Ok(document_url) = url::Url::parse(url) else { return; };
    let Some(request_frame) = shared.login_frames.request_frame(shared.login_adapter, browser, frame) else { return; };
    let request = NativeLoginRequest {
        identity: &shared.identity,
        origin,
        adapter: shared.login_adapter,
        stage, path: document_url.path(), frame: request_frame.as_deref() };
    let frame_id = CefString::from(&frame.identifier()).to_string();
    let Some(generation) = shared
        .automation
        .lock()
        .ok()
        .filter(|s| s.available())
        .map(|s| s.generation)
    else {
        // The main frame is still loading or is being replaced. A start waits
        // for load end. Anything else ends the typing for this stage here: the
        // page gave up, or its request can no longer be honoured.
        if action == "start" {
            reply(frame, nonce, origin, &role, "wait", 200, 0.0, false);
            return;
        }
        if let Ok(mut state) = shared.login_totp.lock() {
            state.keyboard.cancel();
            state.keyboard.stopped(origin, stage);
        }
        reply(frame, nonce, origin, &role, "cancel", 0, 0.0, false);
        return;
    };
    let current = || {
        automatic_input_current(shared, browser)
            && frame.is_valid() == 1
            && shared.login_frames.origin(browser, frame).as_deref() == Some(origin)
            && CefString::from(&frame.url()).to_string() == url
            && shared
                .automation
                .lock()
                .is_ok_and(|s| s.available() && s.generation == generation)
            && shared.session.lock().is_ok_and(|s| {
                navigation_allowed(&s, &shared.identity, &shared.permissions, url, frame.is_main() == 1)
            })
    };
    let permitted = || {
        if !current() {
            return false;
        }
        let mut allowed = false;
        hooks.with_form_credentials(&request, &mut |credentials, _| {
            allowed |= credentials.identity == &shared.identity
                && credentials.origin == origin
                && credentials.valid_until > Instant::now();
        });
        allowed && current()
    };
    let outcome = catch_unwind(AssertUnwindSafe(|| {
        let Ok(mut state) = shared.login_totp.lock() else {
            return;
        };
        let state = &mut state.keyboard;
        // Typing that was cancelled or replaced while its key was held.
        if entry.held.is_some()
            && state.pending.as_ref().and_then(|pending| pending.held) != entry.held
        {
            reply(frame, nonce, origin, &role, "cancel", 0, 0.0, false);
            return;
        }
        if action == "cancel" || !permitted() {
            state.cancel();
            state.stopped(origin, stage);
            reply(frame, nonce, origin, &role, "cancel", 0, 0.0, false);
            return;
        }
        if action == "start" {
            if state.pending.is_some()
                || state.used.len() >= 64
                || !state.used.insert((nonce.into(), role.clone()))
            {
                state.cancel();
                // Answered, never dropped: the renderer must not wait for expiry.
                reply(frame, nonce, origin, &role, "cancel", 0, 0.0, false);
                return;
            }
            hooks.with_form_credentials(&request, &mut |credentials, options| {
                if state.pending.is_some() || !current() {
                    return;
                }
                let Some(value) = field_value(&credentials, options, field) else {
                    return;
                };
                let now = Instant::now();
                let expires = credentials.valid_until.min(now + Duration::from_secs(30));
                let length = value.encode_utf16().count();
                let Some(input) = NativeAuthTyping::new(
                    NativeAuthTarget {
                        identity: shared.identity.clone(),
                        browser_id: browser.identifier(),
                        frame_id: frame_id.clone(),
                        document_sequence: generation,
                        document_url: url.into(),
                        field_token: nonce.into(),
                    },
                    &value,
                    Duration::from_millis(20),
                    now,
                    expires,
                ) else {
                    return;
                };
                let Ok(wall) = (SystemTime::now() + expires.saturating_duration_since(now))
                    .duration_since(UNIX_EPOCH)
                else {
                    return;
                };
                let deadline = wall.as_millis() as f64;
                let mut expiry =
                    KeyboardExpiry::new(Arc::downgrade(shared), nonce.into(), role.clone());
                if post_delayed_task(
                    ThreadId::UI,
                    Some(&mut expiry),
                    expires.saturating_duration_since(now).as_millis() as i64 + 1,
                ) != 1
                {
                    return;
                }
                if reply(frame, nonce, origin, &role, "probe", 0, deadline, false) {
                    state.pending = Some(Pending {
                        nonce: nonce.into(),
                        role: role.clone(),
                        url: url.into(),
                        frame: frame_id.clone(),
                        origin: origin.into(),
                        stage,
                        generation,
                        input,
                        next: 0,
                        length,
                        expires,
                        deadline,
                        held: None,
                    });
                }
            });
            if state.pending.is_none() {
                state.stopped(origin, stage);
                reply(frame, nonce, origin, &role, "cancel", 0, 0.0, false);
            }
            return;
        }
        let Some(pending) = state.pending.as_mut() else {
            // Typing was cancelled natively (navigation, manual entry, expiry).
            reply(frame, nonce, origin, &role, "cancel", 0, 0.0, false);
            return;
        };
        if pending.nonce != nonce
            || pending.role != role
            || pending.url != url
            || pending.frame != frame_id
            || pending.generation != generation
            || pending.next != index
            || index >= pending.length
            || Instant::now() >= pending.expires
        {
            state.cancel();
            reply(frame, nonce, origin, &role, "cancel", 0, 0.0, false);
            return;
        }
        let now = Instant::now();
        match pace(entry.manual, pending.input.ready_in(now), pending.held, entry.held) {
            Pace::Send => pending.held = None,
            Pace::Hold(wait) => {
                let serial = next_hold();
                pending.held = Some(serial);
                if !hold(shared, browser, frame, nonce, event, url, origin, serial, wait) {
                    state.cancel();
                    reply(frame, nonce, origin, &role, "cancel", 0, 0.0, false);
                }
                return;
            }
            Pace::Reject => {
                state.cancel();
                reply(frame, nonce, origin, &role, "cancel", 0, 0.0, false);
                return;
            }
        }
        let typed = &mut state.typed;
        let status = pending.input.tick(
            now,
            |_| permitted(),
            |target, unit| {
                let sent = send_cef_login_character(browser, target, unit);
                // A stage that was sent a key is never re-armed.
                if sent && !typed.contains(&(origin.to_owned(), stage)) {
                    typed.insert((origin.to_owned(), stage));
                }
                sent
            },
        );
        if matches!(status, TypingStatus::Sent | TypingStatus::Complete) {
            pending.next = pending.input.units_sent();
            let (next, deadline) = (pending.next, pending.deadline);
            if status == TypingStatus::Complete {
                state.cancel();
            }
            reply(
                frame,
                nonce,
                origin,
                &role,
                "probe",
                next as i32,
                deadline,
                false,
            );
        } else {
            state.cancel();
            reply(frame, nonce, origin, &role, "cancel", 0, 0.0, false);
        }
    }));
    if outcome.is_err() {
        shared.fault(Some(browser), BrowserFault::Callback);
    }
}

wrap_task! {
    struct KeyboardExpiry { shared: std::sync::Weak<Shared>, nonce: String, role: String }
    impl Task {
        fn execute(&self) {
            if let Some(shared) = self.shared.upgrade() {
                if let Ok(mut state) = shared.login_totp.lock() {
                    if state.keyboard.pending.as_ref().is_some_and(|p| p.nonce == self.nonce && p.role == self.role && Instant::now() >= p.expires) { state.keyboard.cancel(); }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::tests::{login_document, native_api, reply_frame, Replies};

    const ILO: &str = "http://ilo.test:8080";

    fn pending(identity: &BrowserIdentity, origin: &str, field: &str, frame: &str) -> Pending {
        let now = Instant::now();
        let url = format!("{origin}/login.html");
        Pending {
            nonce: "document-1".into(), role: format!("type|form|{field}"), url: url.clone(),
            frame: frame.into(), origin: origin.into(), stage: NativeLoginStage::Form, generation: 0,
            input: NativeAuthTyping::new(NativeAuthTarget {
                identity: identity.clone(), browser_id: 1, frame_id: frame.into(),
                document_sequence: 0, document_url: url, field_token: "document-1".into(),
            }, "synthetic", Duration::from_millis(20), now, now + Duration::from_secs(10)).unwrap(),
            next: 0, length: 9, expires: now + Duration::from_secs(10), deadline: 1.0, held: None,
        }
    }

    fn ilo_identity() -> BrowserIdentity {
        sorng_protocols::origin_browser::OriginBrowserPolicy::new("db", "ilo", "tab", ILO)
            .unwrap().identity().clone()
    }

    #[test]
    fn navigating_a_login_frame_cancels_only_its_pending_keys_without_resetting_replay_guard() {
        let role = "type|form|password";
        let mut state = State::default();
        state.used.insert(("document-1".into(), role.into()));
        state.pending = Some(pending(&ilo_identity(), ILO, "password", "ilo-frame"));
        state.cancel_frame("unrelated-child");
        assert!(state.pending.is_some());
        state.cancel_frame("ilo-frame");
        assert!(state.pending.is_none());
        assert!(state.used.contains(&("document-1".into(), role.into())));
    }

    // Finding M2: the host reports exactly the stages it never sent a key for,
    // whichever path stopped their typing (page, navigation, manual entry, expiry).
    #[test]
    fn typing_that_stops_before_its_first_key_is_reported_once_and_never_for_a_typed_stage() {
        let identity = ilo_identity();
        let form = (ILO.to_owned(), NativeLoginStage::Form);
        let mut state = State::default();
        assert!(state.take_ended(false).is_empty());
        state.pending = Some(pending(&identity, ILO, "username", "ilo-frame"));
        state.cancel_frame("ilo-frame");
        state.cancel();
        state.stopped(ILO, NativeLoginStage::Form);
        assert_eq!(state.take_ended(false), vec![form.clone()]);
        assert!(state.take_ended(false).is_empty());
        // A key sent after the stop was recorded withdraws the report.
        state.stopped(ILO, NativeLoginStage::Form);
        state.typed.insert(form.clone());
        assert!(state.take_ended(false).is_empty());
        // Username typed, password stopped before its first key: the stage has
        // entered text, so it is not reported.
        state.pending = Some(pending(&identity, ILO, "password", "ilo-frame"));
        state.cancel();
        state.stopped(ILO, NativeLoginStage::Form);
        assert!(state.take_ended(false).is_empty());
        // Another origin's untyped stage is still reported on its own.
        state.stopped("https://other.test", NativeLoginStage::Form);
        assert_eq!(
            state.take_ended(false),
            vec![("https://other.test".to_owned(), NativeLoginStage::Form)]
        );
    }

    // A document that was released a stage and is then replaced, without its
    // typing ever starting, sends nothing on the typing channel. The host sees
    // its frame navigate instead.
    #[test]
    fn a_release_whose_document_is_replaced_before_any_key_is_reported() {
        use NativeLoginStage::{Form, FormPrepare};
        let (prepare, form) = ((ILO.to_owned(), FormPrepare), (ILO.to_owned(), Form));
        let mut state = State::default();
        state.released("child".into(), "main".into(), ILO, FormPrepare);
        // Another frame navigating, or pending typing being cancelled, says
        // nothing about this document.
        state.cancel_frame("other");
        state.cancel();
        assert!(state.take_ended(true).is_empty());
        // Its own frame navigates: the prepare-only release ended unused. It is
        // handed out only to settle a successor's prepare request.
        state.cancel_frame("child");
        assert!(state.take_ended(false).is_empty());
        assert_eq!(state.take_ended(true), vec![prepare.clone()]);
        assert!(state.take_ended(true).is_empty());
        // One navigation ends a release once.
        state.cancel_frame("child");
        assert!(state.take_ended(true).is_empty());
        // A main-frame navigation replaces every document below it.
        state.released("child".into(), "main".into(), ILO, FormPrepare);
        state.released("child".into(), "main".into(), ILO, Form);
        state.cancel_frame("main");
        assert_eq!(state.take_ended(false), vec![form.clone()]);
        assert_eq!(state.take_ended(true), vec![prepare]);
        // A stage that was sent a key is never reported, however it ends.
        state.released("child".into(), "main".into(), ILO, Form);
        state.typed.insert(form);
        state.cancel_frame("child");
        assert!(state.take_ended(true).is_empty());
    }

    // A page that waited for load end and then gave up sends its cancel while
    // the main frame is still loading. That stage was never sent a key.
    #[tokio::test]
    async fn a_cancel_while_the_main_frame_is_loading_reports_the_untyped_stage() {
        struct Sink;
        impl BrowserEventSink for Sink { fn on_event(&self, _: BrowserEvent) {} }
        struct Hooks;
        impl NativeDocumentHooks for Hooks { fn on_main_document(&self, _: &BrowserIdentity, _: u64) {} }
        native_api();
        let mut shared = super::super::super::tests::fixture(Arc::new(Sink)).await;
        shared.hooks = Some(Arc::new(Hooks));
        shared.state.lock().unwrap().browser_id = Some(41);
        let (origin, url) = ("https://fixture.invalid", "https://fixture.invalid/login.html");
        let identity = shared.identity.clone();
        assert!(shared.login_budget.lock().unwrap().reserve(
            &NativeLoginRequest { identity: &identity, origin, adapter: shared.login_adapter, stage: NativeLoginStage::Form , path: "/", frame: None },
            &NativeLoginCredentials { identity: &identity, origin, valid_until: Instant::now() + Duration::from_secs(30),
                username: "synthetic-user", password: "synthetic-password", auto_submit: true },
        ));
        let shared = Arc::new(shared);
        let browser = super::super::super::tests::focus_browser(1, 41);
        let replies = Replies::default();
        let frame = reply_frame(replies.clone());
        let send = |event: &str| receive(&shared, &browser, &frame, "document-1", event, url, origin,
            Entry { manual: false, held: None });
        let ended = || shared.login_totp.lock().unwrap().keyboard.take_ended(false);
        let reply = |action: &str, index| Some((action.to_owned(), index, "type|form|username".to_owned()));
        let form = vec![(origin.to_owned(), NativeLoginStage::Form)];

        shared.automation.lock().unwrap().navigating = true;
        // A start only waits for load end: nothing has stopped.
        send("type|start|form|username|0");
        assert_eq!(replies.lock().unwrap().last().cloned(), reply("wait", 200));
        assert!(ended().is_empty());
        // The page's deadline passes before load end and it cancels.
        send("type|cancel|form|username|0");
        assert_eq!(replies.lock().unwrap().last().cloned(), reply("cancel", 0));
        assert_eq!(ended(), form);
        // A key that can no longer be honoured ends its typing the same way.
        shared.login_totp.lock().unwrap().keyboard.pending =
            Some(pending(&identity, origin, "username", "login-frame"));
        send("type|key|form|username|0");
        assert_eq!(replies.lock().unwrap().len(), 3);
        assert_eq!(replies.lock().unwrap().last().cloned(), reply("cancel", 0));
        assert!(shared.login_totp.lock().unwrap().keyboard.pending.is_none());
        assert_eq!(ended(), form);
    }

    // Real-engine observation at HEAD (t101-e1r): a visible view with input
    // blocked received both grants and zero key events, and the page reported
    // the login rejected 6 ms later. Its typing start was refused here, at the
    // gate, before consent was consulted. The harness has no CEF UI thread, so
    // this pins the request up to the field grant, not the keys themselves.
    #[tokio::test]
    async fn a_visible_input_blocked_view_passes_the_typing_gate_to_its_field_grant() {
        use crate::domain_permissions::{
            WebsitePermissionDecision, WebsitePermissionEngine, WebsiteRequestClass,
        };
        use sorng_protocols::origin_browser::NativeHostReadiness;
        use std::sync::atomic::AtomicUsize;
        struct Sink;
        impl BrowserEventSink for Sink { fn on_event(&self, _: BrowserEvent) {} }
        struct Hooks(AtomicUsize);
        impl NativeDocumentHooks for Hooks {
            fn on_main_document(&self, _: &BrowserIdentity, _: u64) {}
            fn with_form_credentials(
                &self,
                request: &NativeLoginRequest<'_>,
                deliver: &mut dyn FnMut(NativeLoginCredentials<'_>, Option<&str>),
            ) {
                self.0.fetch_add(1, Ordering::Relaxed);
                deliver(NativeLoginCredentials {
                    identity: request.identity, origin: request.origin,
                    valid_until: Instant::now() + Duration::from_secs(30),
                    username: "synthetic-user", password: "synthetic-password", auto_submit: true,
                }, None);
            }
        }
        native_api();
        let hooks = Arc::new(Hooks(AtomicUsize::new(0)));
        let mut shared = super::super::super::tests::fixture(Arc::new(Sink)).await;
        shared.hooks = Some(hooks.clone());
        shared.permissions = Arc::new(WebsitePermissionEngine::new(None, None,
            &[(WebsiteRequestClass::Navigation, WebsitePermissionDecision::Allow)].into_iter().collect(),
        ).unwrap());
        shared.state.lock().unwrap().browser_id = Some(41);
        {
            // Pure admission fixture, never evidence of live containment.
            let mut session = shared.session.lock().unwrap();
            let report = NativeHostReadiness::Ready {
                profile_key: session.policy().profile_key().to_owned(),
                proxy_endpoint: session.proxy_endpoint(),
            };
            session.report_host(&shared.identity, report).unwrap();
        }
        let (origin, url) = ("https://fixture.invalid", "https://fixture.invalid/login.html");
        let identity = shared.identity.clone();
        assert!(shared.login_budget.lock().unwrap().reserve(
            &NativeLoginRequest { identity: &identity, origin, adapter: shared.login_adapter, stage: NativeLoginStage::Form , path: "/", frame: None },
            &NativeLoginCredentials { identity: &identity, origin, valid_until: Instant::now() + Duration::from_secs(30),
                username: "synthetic-user", password: "synthetic-password", auto_submit: true },
        ));
        let shared = Arc::new(shared);
        let replies = Replies::default();
        let (browser, frame) = login_document(replies.clone(), url);
        let start = |nonce: &str| receive(&shared, &browser, &frame, nonce,
            "type|start|form|username|0", url, origin, Entry { manual: false, held: None });
        let granted = |nonce: &str| shared.login_totp.lock().unwrap().keyboard.used
            .contains(&(nonce.to_owned(), "type|form|username".to_owned()));

        // Attached and visible, while a shell dialog or menu blocks its input.
        assert_eq!(shared.state.lock().unwrap().control.lifecycle(), Lifecycle::Attached);
        shared.input_blocked.store(true, Ordering::Release);
        assert!(!shared.focus_allowed(Some(&browser)));
        start("document-1");
        // Consent was consulted, then the field value was granted for typing.
        // (The expiry task that follows cannot be posted without a UI thread,
        // so the reply to this start is not part of the assertion.)
        assert_eq!(hooks.0.load(Ordering::Relaxed), 2);
        assert!(granted("document-1"));

        // The fences that do stop a start are unchanged: a closing view is
        // refused before consent, whatever the overlay state.
        shared.input_blocked.store(false, Ordering::Release);
        shared.state.lock().unwrap().control.begin_close(&shared.identity).unwrap();
        start("document-2");
        assert_eq!(hooks.0.load(Ordering::Relaxed), 2);
        assert!(!granted("document-2"));
        assert_eq!(replies.lock().unwrap().last(), Some(&("cancel".to_owned(), 0, "type|form|username".to_owned())));
    }

    // Finding C7 for the typing channel, through the production receive path.
    #[tokio::test]
    async fn manual_entry_defers_a_typing_start_with_wait_and_still_honours_cancel() {
        struct Sink;
        impl BrowserEventSink for Sink { fn on_event(&self, _: BrowserEvent) {} }
        struct Hooks;
        impl NativeDocumentHooks for Hooks { fn on_main_document(&self, _: &BrowserIdentity, _: u64) {} }
        native_api();
        let mut shared = super::super::super::tests::fixture(Arc::new(Sink)).await;
        shared.hooks = Some(Arc::new(Hooks));
        shared.state.lock().unwrap().browser_id = Some(41);
        let (origin, url) = ("https://fixture.invalid", "https://fixture.invalid/login.html");
        let identity = shared.identity.clone();
        assert!(shared.login_budget.lock().unwrap().reserve(
            &NativeLoginRequest { identity: &identity, origin, adapter: shared.login_adapter, stage: NativeLoginStage::Form , path: "/", frame: None },
            &NativeLoginCredentials { identity: &identity, origin, valid_until: Instant::now() + Duration::from_secs(30),
                username: "synthetic-user", password: "synthetic-password", auto_submit: true },
        ));
        let shared = Arc::new(shared);
        let browser = super::super::super::tests::focus_browser(1, 41);
        let replies = Replies::default();
        let frame = reply_frame(replies.clone());
        let manual = Entry { manual: true, held: None };
        let role = "type|form|username".to_owned();
        let send = |event: &str, entry| receive(&shared, &browser, &frame, "document-1", event, url, origin, entry);

        send("type|start|form|username|0", manual);
        assert_eq!(*replies.lock().unwrap(), vec![("wait".to_owned(), INTERLOCK_WAIT_MS, role.clone())]);
        // Nothing was consumed: the repeated start is still the first start.
        {
            let state = shared.login_totp.lock().unwrap();
            assert!(state.keyboard.used.is_empty() && state.keyboard.pending.is_none());
        }
        // A stage that was never released gets no answer, interlocked or not.
        send("type|start|password|password|0", manual);
        send("type|start|password|password|0", Entry { manual: false, held: None });
        assert_eq!(replies.lock().unwrap().len(), 1);

        // A cancel is never deferred: it clears the pending keys and is answered.
        shared.login_totp.lock().unwrap().keyboard.pending =
            Some(pending(&identity, origin, "username", "login-frame"));
        send("type|cancel|form|username|0", manual);
        assert_eq!(replies.lock().unwrap().last(), Some(&("cancel".to_owned(), 0, role.clone())));
        let mut state = shared.login_totp.lock().unwrap();
        assert!(state.keyboard.pending.is_none());
        // Stopped before its first key: the release can be re-armed.
        assert_eq!(state.keyboard.take_ended(false), vec![(origin.to_owned(), NativeLoginStage::Form)]);
        drop(state);

        // A key request the host cannot honour is answered, never dropped.
        send("type|key|form|username|0", Entry { manual: false, held: None });
        assert_eq!(replies.lock().unwrap().len(), 3);
        assert_eq!(replies.lock().unwrap().last(), Some(&("cancel".to_owned(), 0, role)));
    }

    #[test]
    fn typing_requests_only_name_previously_approved_fields_not_values() {
        assert!(parse("type|start|form|username|0").is_some());
        assert!(parse("type|key|password|password|31").is_some());
        for event in [
            "type|start|form-submit|password|0",
            "type|start|form|secret-value|0",
            "type|start|form|password|1",
            "type|key|form|extra16|0",
            "type|key|form|password|4097",
        ] {
            assert!(parse(event).is_none());
        }
    }

    #[test]
    fn a_staged_release_types_only_its_own_field() {
        for event in [
            "type|start|identifier|username|0",
            "type|key|identifier|username|3",
            "type|start|password|password|0",
            "type|start|bound-password|password|0",
            "type|start|form|username|0",
            "type|start|form|extra0|0",
        ] {
            assert!(parse(event).is_some(), "{event}");
        }
        for event in [
            "type|start|identifier|password|0",
            "type|key|identifier|password|2",
            "type|start|identifier|extra0|0",
            "type|start|password|username|0",
            "type|key|password|extra1|0",
            "type|start|bound-password|username|0",
        ] {
            assert!(parse(event).is_none(), "{event}");
        }
    }
}
