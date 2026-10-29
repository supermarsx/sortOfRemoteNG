//! Explicit user retry of automatic login on the CURRENT document. Never a
//! reload, navigation or reconnect: the renderer re-detects and refills the
//! page that is open now, through the same consent, origin and step checks
//! as the first sign-in. The allowance is a fresh renderer document scope
//! (new nonce, nothing requested or delivered) plus a fresh login budget;
//! credentials still come only from the owner's live, re-armed grant.
//!
//! Detection is the first attempt's own: the re-run client looks for its form
//! with the same matching and the same bounded wait (a form that renders late
//! is still found). The browser answers the retry when that client asks for
//! its first step, or with "no form" once the whole bound has passed without
//! a request (`native_features::RetryWait`).
use super::*;
use crate::cef_renderer::LOGIN_RETRY;
use crate::native_features::{
    retry_detection_bound, LoginBudget, NativeLoginRetryRefusal, NativeLoginRetryStep,
    RetryVerdict,
};

/// One-shot answer of a retry that started waiting for its form. Dropped
/// unanswered only when the browser itself goes away.
pub type NativeLoginRetryReply = Box<dyn FnOnce(RetryVerdict) + Send + 'static>;

impl CefBrowserHost<'_> {
    /// UI thread only. `admit` receives the page's exact login origin once
    /// every host check passed; it re-arms the owner's grant and returns
    /// false to refuse. Nothing in the host changes before it agrees.
    ///
    /// `Ok(Err(_))` is an immediate refusal and `reply` is never called.
    /// `Ok(Ok(()))`: the login client runs again on this page and `reply`
    /// later receives `Ok(())` when it asks for its first step, or
    /// `Err(NoForm)` once the first attempt's detection bound has passed.
    pub fn retry_login(
        &self,
        identity: &BrowserIdentity,
        step: NativeLoginRetryStep,
        admit: &mut dyn FnMut(&str) -> bool,
        reply: NativeLoginRetryReply,
    ) -> Result<Result<(), NativeLoginRetryRefusal>, BrowserError> {
        let browser = self.check(identity)?;
        let shared = &self.shared;
        if !shared.accepts(Some(&browser)) {
            return Err(BrowserError::SessionUnavailable);
        }
        Ok(retry_on_document(shared, &browser, step, admit, reply))
    }
}

fn retry_on_document(
    shared: &Arc<Shared>,
    browser: &Browser,
    step: NativeLoginRetryStep,
    admit: &mut dyn FnMut(&str) -> bool,
    reply: NativeLoginRetryReply,
) -> Result<(), NativeLoginRetryRefusal> {
    use NativeLoginRetryRefusal::{Busy, NoLogin, NotCurrent, Owner};
    if !shared.login_adapter.supported() || shared.login_adapter == NativeLoginAdapter::Manual {
        return Err(NoLogin);
    }
    // Explicit manual entry, or native typing a credential or code, owns the
    // keyboard. A held stage request is about to type as well. A retry that
    // is still looking for its form is not started twice.
    if manual_input::active(shared)
        || shared
            .login_totp
            .lock()
            .map_or(true, |state| state.entering())
        || shared.login_retry.lock().map_or(true, |wait| wait.waiting())
    {
        return Err(Busy);
    }
    // A document that has not finished loading is still running its first
    // attempt's detection; that attempt answers for it.
    if !shared
        .automation
        .lock()
        .is_ok_and(|state| state.available())
    {
        return Err(Busy);
    }
    // These describe the document, not whether it shows a form: a missing or
    // replaced main frame is a page that changed under the retry.
    let Some(frame) = browser
        .main_frame()
        .filter(|frame| frame.is_valid() == 1 && frame.is_main() == 1)
    else {
        return Err(NotCurrent);
    };
    let url = CefString::from(&frame.url()).to_string();
    let Some(origin) = shared.login_frames.origin(browser, &frame) else {
        return Err(NotCurrent);
    };
    if browser_origin(&url).as_deref() != Some(origin.as_str())
        || !shared.session.lock().is_ok_and(|session| {
            navigation_allowed(&session, &shared.identity, &shared.permissions, &url, true)
        })
    {
        return Err(NotCurrent);
    }
    // The owner matches the origin exactly as it does for the first
    // attempt's credential release, and names its own refusal.
    if !admit(&origin) {
        return Err(Owner);
    }
    // The owner callback may have revoked the attempt or replaced the page.
    if !shared.current()
        || !shared.accepts(Some(browser))
        || frame.is_valid() != 1
        || CefString::from(&frame.url()).to_string() != url
    {
        return Err(NotCurrent);
    }
    let Some(mut message) = process_message_create(Some(&CefString::from(LOGIN_RETRY))) else {
        return Err(Busy);
    };
    let Some(args) = message.argument_list() else {
        return Err(Busy);
    };
    if args.set_string(0, Some(&CefString::from(origin.as_str()))) != 1
        || args.set_string(1, Some(&CefString::from(step.wire()))) != 1
    {
        return Err(Busy);
    }
    let (fill, submit) = configured_delays(shared);
    let bound = retry_detection_bound(fill, submit);
    let id = {
        let Ok(mut wait) = shared.login_retry.lock() else {
            return Err(Busy);
        };
        match wait.begin(step, Instant::now(), bound, reply) {
            Ok(id) => id,
            Err(_) => return Err(Busy),
        }
    };
    let mut timeout = RetryTimeout::new(Arc::downgrade(shared), id);
    let delay = i64::try_from(bound.as_millis()).unwrap_or(i64::MAX);
    if post_delayed_task(ThreadId::UI, Some(&mut timeout), delay) != 1 {
        shared.abandon_retry(id, Busy);
        return Ok(());
    }
    {
        let Ok(mut entry) = shared.login_totp.lock() else {
            shared.abandon_retry(id, Busy);
            return Ok(());
        };
        if entry.entering() {
            drop(entry);
            shared.abandon_retry(id, Busy);
            return Ok(());
        }
        if step == NativeLoginRetryStep::Credentials {
            let Ok(mut budget) = shared.login_budget.lock() else {
                drop(entry);
                shared.abandon_retry(id, Busy);
                return Ok(());
            };
            *budget = LoginBudget::default();
            entry.restart_typing();
        }
        entry.rearm_code_entry();
    }
    frame.send_process_message(ProcessId::RENDERER, Some(&mut message));
    Ok(())
}

/// The saved fill and submit delays the login client also reads. A
/// configuration the host cannot read waits for the longest delays.
fn configured_delays(shared: &Shared) -> (u64, u64) {
    const UNREADABLE: (u64, u64) = (u64::MAX, u64::MAX);
    let Some(hooks) = &shared.hooks else {
        return (0, 0);
    };
    let Ok(json) = catch_unwind(AssertUnwindSafe(|| hooks.form_configuration())) else {
        return UNREADABLE;
    };
    let Some(json) = json else {
        return (0, 0);
    };
    let Some(root) = crate::cef_renderer::parse_login_configuration(&json)
        .and_then(|value| value.dictionary())
    else {
        return UNREADABLE;
    };
    let key = CefString::from("timing");
    if root.get_type(Some(&key)) != ValueType::DICTIONARY {
        return (0, 0);
    }
    let Some(timing) = root.dictionary(Some(&key)) else {
        return UNREADABLE;
    };
    let read = |name: &str| -> u64 {
        let key = CefString::from(name);
        match timing.get_type(Some(&key)) {
            ValueType::INT => u64::try_from(timing.int(Some(&key))).unwrap_or(0),
            ValueType::DOUBLE => {
                let value = timing.double(Some(&key));
                if value.is_finite() && value > 0.0 {
                    value.ceil() as u64
                } else {
                    0
                }
            }
            _ => 0,
        }
    };
    (read("fillDelayMs"), read("submitDelayMs"))
}

fn complete_retry(reply: NativeLoginRetryReply, verdict: RetryVerdict) {
    // An owner reply that panics must not unwind through a CEF callback.
    let _ = catch_unwind(AssertUnwindSafe(|| reply(verdict)));
}

impl Shared {
    /// The re-run login client asked for a step that passed the same checks
    /// as a first attempt's request: its form was found.
    pub(super) fn retry_found(&self, kind: NativeLoginRetryStep) {
        let answer = self
            .login_retry
            .lock()
            .ok()
            .and_then(|mut wait| wait.found(kind, Instant::now()));
        if let Some((reply, verdict)) = answer {
            complete_retry(reply, verdict);
        }
    }

    fn expire_retry(self: &Arc<Self>, id: u64) {
        let now = Instant::now();
        let (answer, early) = match self.login_retry.lock() {
            Ok(mut wait) => {
                let answer = wait.expire(id, now);
                let early = if answer.is_none() { wait.remaining(id, now) } else { None };
                (answer, early)
            }
            Err(_) => (None, None),
        };
        if let Some((reply, verdict)) = answer {
            complete_retry(reply, verdict);
            return;
        }
        // A timer that ran before the bound (clock granularity) runs again
        // for the rest; "no form" never comes early.
        if let Some(rest) = early {
            let mut timeout = RetryTimeout::new(Arc::downgrade(self), id);
            let delay = i64::try_from(rest.as_millis()).unwrap_or(i64::MAX).saturating_add(1);
            if post_delayed_task(ThreadId::UI, Some(&mut timeout), delay) != 1 {
                self.abandon_retry(id, NativeLoginRetryRefusal::Busy);
            }
        }
    }

    fn abandon_retry(&self, id: u64, refusal: NativeLoginRetryRefusal) {
        let answer = self
            .login_retry
            .lock()
            .ok()
            .and_then(|mut wait| wait.abandon(id, refusal));
        if let Some((reply, verdict)) = answer {
            complete_retry(reply, verdict);
        }
    }
}

wrap_task! {
    struct RetryTimeout { shared: std::sync::Weak<Shared>, id: u64 }
    impl Task {
        fn execute(&self) {
            if let Some(shared) = self.shared.upgrade() { shared.expire_retry(self.id); }
        }
    }
}
