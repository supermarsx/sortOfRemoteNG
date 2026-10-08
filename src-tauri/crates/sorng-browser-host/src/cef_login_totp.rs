//! Browser-process OTP keyboard pipeline. No seed or code in renderer IPC.
use super::*;
use crate::cef_renderer::message_text;
use crate::native_totp::input::{
    send_cef_character, NativeAuthTarget, NativeAuthTyping, TypingStatus,
};
use crate::native_totp::{self, NativeTotpCode, NativeTotpRequest};
use std::time::{SystemTime, UNIX_EPOCH};

#[path = "cef_login_typing.rs"]
mod keyboard;

#[derive(Default)]
pub(super) struct State {
    keyboard: keyboard::State,
    pending: Option<Pending>,
    starts: u8,
}

struct Pending {
    nonce: String,
    url: String,
    frame_id: String,
    generation: u64,
    challenge: String,
    typing: NativeAuthTyping,
    digits: u8,
    next: u8,
    expires: Instant,
    deadline: f64,
    auto_submit: bool,
}

impl State {
    pub(super) fn cancel(&mut self) {
        self.pending = None;
        self.keyboard.cancel();
    }
}

/// Keep document checks separate from the non-reentrant consent boundary.
/// `document_current` must not call authority hooks: `with_totp` holds consent
/// valid throughout its synchronous delivery, including this document check.
struct TotpGate<'a> {
    hooks: &'a dyn NativeDocumentHooks,
    request: &'a NativeTotpRequest<'a>,
    document_current: &'a dyn Fn() -> bool,
}

impl TotpGate<'_> {
    fn current(&self, submit: bool) -> bool {
        (self.document_current)() && self.hooks.totp_current(self.request, submit)
    }

    fn with_code(&self, deliver: &mut dyn FnMut(NativeTotpCode<'_>)) -> Option<Duration> {
        if !(self.document_current)() {
            return None;
        }
        self.hooks.with_totp(self.request, &mut |code| {
            // Do not call current()/totp_current() here: the consent mutex is
            // already held by with_totp. Keep it held through borrowed delivery.
            if (self.document_current)() && Instant::now() < code.valid_until {
                deliver(code);
            }
        })
    }
}

fn command(event: &str) -> Option<(&str, &str, u8)> {
    if event.len() > 256 {
        return None;
    }
    let fields: Vec<_> = event.split('|').collect();
    if fields.len() != 4
        || fields[0] != "totp"
        || !matches!(fields[1], "start" | "key" | "finish" | "cancel")
        || fields[2].is_empty()
        || fields[2].len() > 128
        || !fields[2]
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
    {
        return None;
    }
    let index = fields[3].parse::<u8>().ok().filter(|i| *i <= 8)?;
    if matches!(fields[1], "start" | "cancel") && index != 0 {
        return None;
    }
    Some((fields[1], fields[2], index))
}

fn reply(
    frame: &Frame,
    nonce: &str,
    origin: &str,
    challenge: &str,
    action: &str,
    index: i32,
    deadline: f64,
    submit: bool,
) -> bool {
    let Some(mut message) = process_message_create(Some(&CefString::from(native_totp::DELIVERY)))
    else {
        return false;
    };
    let Some(args) = message.argument_list() else {
        return false;
    };
    if args.set_string(0, Some(&CefString::from(nonce))) != 1
        || args.set_string(1, Some(&CefString::from(origin))) != 1
        || args.set_string(2, Some(&CefString::from(action))) != 1
        || args.set_int(3, index) != 1
        || args.set_double(4, deadline) != 1
        || args.set_bool(5, i32::from(submit)) != 1
        || args.set_string(6, Some(&CefString::from(challenge))) != 1
    {
        return false;
    }
    frame.send_process_message(ProcessId::RENDERER, Some(&mut message));
    true
}

impl Shared {
    pub(super) fn totp_message(
        self: &Arc<Self>,
        browser: &Browser,
        frame: &Frame,
        args: &ListValue,
        url: &str,
        origin: &str,
    ) {
        let (Some(nonce), Some(event)) = (message_text(args, 0, 80), message_text(args, 2, 256))
        else {
            return;
        };
        if nonce.is_empty() || message_text(args, 1, 1024).as_deref() != Some(origin) {
            return;
        }
        if event.starts_with("type|") {
            keyboard::receive(self, browser, frame, &nonce, &event, url, origin);
            return;
        }
        let Some((action, challenge, index)) = command(&event) else {
            return;
        };
        let Some(hooks) = &self.hooks else {
            return;
        };
        let request = NativeTotpRequest {
            identity: &self.identity,
            origin,
            document_url: url,
            challenge,
        };
        let generation = self
            .automation
            .lock()
            .ok()
            .filter(|s| s.available())
            .map(|s| s.generation);
        let Some(generation) = generation else {
            // The renderer can discover a challenge before load-end. Wait
            // without generating/caching a code or spending the one-shot grant.
            reply(
                frame,
                &nonce,
                origin,
                challenge,
                if action == "start" { "wait" } else { "cancel" },
                if action == "start" { 200 } else { 0 },
                0.0,
                false,
            );
            return;
        };
        let frame_id = CefString::from(&frame.identifier()).to_string();
        let document_current = || {
            self.current()
                && !self.input_blocked.load(Ordering::Acquire)
                && self.state.lock().is_ok_and(|state| {
                    state.browser_id == Some(browser.identifier())
                        && state.control.lifecycle() == Lifecycle::Attached
                })
                && frame.is_valid() == 1
                && frame.is_main() == 1
                && CefString::from(&frame.url()).to_string() == url
                && self
                    .automation
                    .lock()
                    .is_ok_and(|s| s.available() && s.generation == generation)
                && self.session.lock().is_ok_and(|s| {
                    navigation_allowed(&s, &self.identity, &self.permissions, url, true)
                })
        };
        let gate = TotpGate {
            hooks: hooks.as_ref(),
            request: &request,
            document_current: &document_current,
        };
        let current = || gate.current(false);
        let result = catch_unwind(AssertUnwindSafe(|| {
            let Ok(mut state) = self.login_totp.lock() else {
                return;
            };
            if action == "cancel" {
                if state.pending.as_ref().is_some_and(|p| p.nonce == nonce) {
                    state.cancel();
                }
                return;
            }
            if !current() {
                state.cancel();
                reply(frame, &nonce, origin, challenge, "cancel", 0, 0.0, false);
                return;
            }
            if action == "start" {
                if state.pending.is_some() || state.starts >= 2 {
                    state.cancel();
                    return;
                }
                state.starts += 1;
                let mut granted = false;
                let wait = gate.with_code(&mut |code| {
                    if granted
                        || !(6..=8).contains(&code.code.len())
                        || !code.code.bytes().all(|b| b.is_ascii_digit())
                    {
                        return;
                    }
                    granted = true;
                    let now = Instant::now();
                    let Some(typing) = NativeAuthTyping::new(
                        NativeAuthTarget {
                            identity: self.identity.clone(),
                            browser_id: browser.identifier(),
                            frame_id: frame_id.clone(),
                            document_sequence: generation,
                            document_url: url.into(),
                            field_token: nonce.clone(),
                        },
                        code.code,
                        Duration::from_millis(30),
                        now,
                        code.valid_until,
                    ) else {
                        return;
                    };
                    let Ok(wall) = (SystemTime::now()
                        + code.valid_until.saturating_duration_since(now))
                    .duration_since(UNIX_EPOCH) else {
                        return;
                    };
                    let deadline = wall.as_millis() as f64;
                    let pending = Pending {
                        nonce: nonce.clone(),
                        url: url.into(),
                        frame_id: frame_id.clone(),
                        generation,
                        challenge: challenge.into(),
                        typing,
                        digits: code.code.len() as u8,
                        next: 0,
                        expires: code.valid_until,
                        deadline,
                        auto_submit: code.auto_submit,
                    };
                    let mut expiry = OtpExpiry::new(Arc::downgrade(self), nonce.clone());
                    if post_delayed_task(
                        ThreadId::UI,
                        Some(&mut expiry),
                        code.valid_until
                            .saturating_duration_since(now)
                            .as_millis()
                            .min(3_600_000) as i64
                            + 1,
                    ) != 1
                    {
                        return;
                    }
                    if reply(
                        frame,
                        &nonce,
                        origin,
                        challenge,
                        "probe",
                        0,
                        deadline,
                        code.auto_submit,
                    ) {
                        state.pending = Some(pending);
                    }
                });
                if state.pending.is_none() {
                    if let Some(wait) =
                        wait.filter(|w| !granted && !w.is_zero() && *w <= Duration::from_millis(33020))
                    {
                        reply(
                            frame,
                            &nonce,
                            origin,
                            challenge,
                            "wait",
                            wait.as_millis() as i32,
                            0.0,
                            false,
                        );
                    } else {
                        reply(frame, &nonce, origin, challenge, "cancel", 0, 0.0, false);
                    }
                }
                return;
            }
            let Some(pending) = state.pending.as_mut() else {
                return;
            };
            if pending.nonce != nonce
                || pending.url != url
                || pending.frame_id != frame_id
                || pending.generation != generation
                || pending.challenge != challenge
                || pending.next != index
                || Instant::now() >= pending.expires
            {
                state.cancel();
                reply(frame, &nonce, origin, challenge, "cancel", 0, 0.0, false);
                return;
            }
            if action == "key" && index < pending.digits {
                let status = pending.typing.tick(
                    Instant::now(),
                    |target| {
                        target.identity == self.identity
                            && target.document_sequence == generation
                            && target.field_token == nonce
                            && current()
                    },
                    |target, unit| send_cef_character(browser, target, unit),
                );
                if matches!(status, TypingStatus::Sent | TypingStatus::Complete) {
                    pending.next += 1;
                    if !reply(
                        frame,
                        &nonce,
                        origin,
                        challenge,
                        "probe",
                        pending.next.into(),
                        pending.deadline,
                        pending.auto_submit,
                    ) {
                        state.cancel();
                    }
                } else {
                    state.cancel();
                    reply(frame, &nonce, origin, challenge, "cancel", 0, 0.0, false);
                }
            } else if action == "finish"
                && index == pending.digits
                && pending.auto_submit
                && hooks.totp_current(&request, true)
            {
                let deadline = pending.deadline;
                state.cancel();
                if current() {
                    reply(
                        frame,
                        &nonce,
                        origin,
                        challenge,
                        "submit",
                        index.into(),
                        deadline,
                        true,
                    );
                }
            } else {
                state.cancel();
            }
        }));
        if result.is_err() {
            self.fault(Some(browser), BrowserFault::Callback);
        }
    }
}

wrap_task! {
    struct OtpExpiry { shared: std::sync::Weak<Shared>, nonce: String }
    impl Task {
        fn execute(&self) {
            if let Some(shared) = self.shared.upgrade() {
                if let Ok(mut state) = shared.login_totp.lock() {
                    if state.pending.as_ref().is_some_and(|p| p.nonce == self.nonce && Instant::now() >= p.expires) { state.cancel(); }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sorng_protocols::origin_browser::OriginBrowserPolicy;
    use std::sync::atomic::AtomicUsize;

    struct LockedConsentHooks {
        active: Mutex<bool>,
        document_current: AtomicBool,
        invalidate_document_on_delivery: bool,
        expired: bool,
        consent_checks: AtomicUsize,
    }

    impl LockedConsentHooks {
        fn new() -> Self {
            Self {
                active: Mutex::new(true),
                document_current: AtomicBool::new(true),
                invalidate_document_on_delivery: false,
                expired: false,
                consent_checks: AtomicUsize::new(0),
            }
        }
    }

    impl NativeDocumentHooks for LockedConsentHooks {
        fn on_main_document(&self, _: &BrowserIdentity, _: u64) {}

        fn totp_current(&self, _: &NativeTotpRequest<'_>, submit: bool) -> bool {
            self.consent_checks.fetch_add(1, Ordering::Relaxed);
            // Fail immediately instead of hanging the suite if the production
            // gate ever re-enters consent while borrowed delivery holds it.
            let active = self.active.try_lock().expect("reentrant consent check");
            *active && !self.expired && !submit
        }

        fn with_totp(
            &self,
            _: &NativeTotpRequest<'_>,
            deliver: &mut dyn FnMut(NativeTotpCode<'_>),
        ) -> Option<Duration> {
            let active = self.active.try_lock().expect("reentrant consent delivery");
            if *active {
                if self.invalidate_document_on_delivery {
                    self.document_current.store(false, Ordering::Release);
                }
                deliver(NativeTotpCode {
                    code: "123456",
                    valid_until: if self.expired {
                        Instant::now() - Duration::from_secs(1)
                    } else {
                        Instant::now() + Duration::from_secs(30)
                    },
                    auto_submit: false,
                });
            }
            None
        }
    }

    fn gate_request(identity: &BrowserIdentity) -> NativeTotpRequest<'_> {
        NativeTotpRequest {
            identity,
            origin: "https://fixture.invalid",
            document_url: "https://fixture.invalid/user/two_factor",
            challenge: "gitea-totp",
        }
    }

    #[test]
    fn otp_delivery_keeps_consent_locked_without_reentering_it() {
        let policy = OriginBrowserPolicy::new(
            "owner", "connection", "tab", "https://fixture.invalid",
        ).unwrap();
        let request = gate_request(policy.identity());
        let hooks = LockedConsentHooks::new();
        let document_checks = AtomicUsize::new(0);
        let document_current = || {
            document_checks.fetch_add(1, Ordering::Relaxed);
            hooks.document_current.load(Ordering::Acquire)
        };
        let gate = TotpGate { hooks: &hooks, request: &request, document_current: &document_current };
        let state = Mutex::new(State::default());
        let _state = state.lock().unwrap(); // Same outer lock as totp_message.
        assert!(gate.current(false));
        let mut deliveries = 0;
        assert!(gate.with_code(&mut |code| {
            assert!(hooks.active.try_lock().is_err(), "consent must cover delivery");
            assert_eq!(code.code.len(), 6);
            assert!(!code.auto_submit);
            deliveries += 1;
        }).is_none());
        assert_eq!(deliveries, 1);
        assert_eq!(document_checks.load(Ordering::Relaxed), 3);
        assert_eq!(hooks.consent_checks.load(Ordering::Relaxed), 1);
        assert!(gate.current(false)); // Subsequent keys still recheck consent.
        assert!(!gate.current(true)); // Manual-submit grant cannot submit.
        *hooks.active.lock().unwrap() = false;
        assert!(!gate.current(false));
        assert!(!gate.current(true));
        gate.with_code(&mut |_| panic!("revoked consent delivered"));
    }

    #[test]
    fn otp_delivery_rechecks_document_and_expiry_inside_the_consent_boundary() {
        let policy = OriginBrowserPolicy::new(
            "owner", "connection", "tab", "https://fixture.invalid",
        ).unwrap();
        let request = gate_request(policy.identity());
        for mode in 0..3 {
            let mut hooks = LockedConsentHooks::new();
            hooks.document_current.store(mode != 0, Ordering::Release);
            hooks.invalidate_document_on_delivery = mode == 1;
            hooks.expired = mode == 2;
            let document_current = || hooks.document_current.load(Ordering::Acquire);
            let gate = TotpGate { hooks: &hooks, request: &request, document_current: &document_current };
            gate.with_code(&mut |_| panic!("stale document or expired code delivered"));
            assert!(hooks.active.try_lock().is_ok());
        }
    }

    #[test]
    fn otp_start_cannot_reuse_consent_revoked_after_the_initial_check() {
        let policy = OriginBrowserPolicy::new(
            "owner", "connection", "tab", "https://fixture.invalid",
        ).unwrap();
        let request = gate_request(policy.identity());
        let hooks = LockedConsentHooks::new();
        let gate = TotpGate { hooks: &hooks, request: &request, document_current: &|| true };
        assert!(gate.current(false));
        *hooks.active.lock().unwrap() = false;
        gate.with_code(&mut |_| panic!("initial check must not cache consent"));
        assert!(!gate.current(false));
    }

    #[test]
    fn otp_messages_are_bounded_and_cannot_smuggle_credentials_or_another_stage() {
        assert_eq!(
            command("totp|key|gitea-totp|5"),
            Some(("key", "gitea-totp", 5))
        );
        for invalid in [
            "totp|start|gitea-totp|1",
            "totp|password|gitea-totp|0",
            "totp|key|gitea-totp|9",
            "totp|key|gitea-totp|0|secret",
            "totp|key||0",
            "totp|key|UPPER|0",
        ] {
            assert!(command(invalid).is_none());
        }
    }
}
