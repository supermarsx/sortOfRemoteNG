//! Explicit user retry of automatic login on the CURRENT document. Never a
//! reload, navigation or reconnect: the renderer re-detects and refills the
//! page that is open now, through the same consent, origin and step checks
//! as the first sign-in. The allowance is a fresh renderer document scope
//! (new nonce, nothing requested or delivered) plus a fresh login budget;
//! credentials still come only from the owner's live, re-armed grant.
use super::*;
use crate::cef_renderer::LOGIN_RETRY;
use crate::native_features::{LoginBudget, NativeLoginRetryRefusal, NativeLoginRetryStep};

impl CefBrowserHost<'_> {
    /// UI thread only. `admit` receives the page's exact login origin once
    /// every host check passed; it re-arms the owner's grant and returns
    /// false to refuse. Nothing in the host changes before it agrees.
    pub fn retry_login(
        &self,
        identity: &BrowserIdentity,
        step: NativeLoginRetryStep,
        admit: &mut dyn FnMut(&str) -> bool,
    ) -> Result<Result<(), NativeLoginRetryRefusal>, BrowserError> {
        let browser = self.check(identity)?;
        let shared = &self.shared;
        if !shared.accepts(Some(&browser)) {
            return Err(BrowserError::SessionUnavailable);
        }
        Ok(retry_on_document(shared, &browser, step, admit))
    }
}

fn retry_on_document(
    shared: &Arc<Shared>,
    browser: &Browser,
    step: NativeLoginRetryStep,
    admit: &mut dyn FnMut(&str) -> bool,
) -> Result<(), NativeLoginRetryRefusal> {
    use NativeLoginRetryRefusal::{Busy, NoForm, Owner};
    if !shared.login_adapter.supported() || shared.login_adapter == NativeLoginAdapter::Manual {
        return Err(NoForm);
    }
    // Explicit manual entry, or native typing a credential or code, owns the
    // keyboard. A held stage request is about to type as well.
    if manual_input::active(shared)
        || shared
            .login_totp
            .lock()
            .map_or(true, |state| state.entering())
    {
        return Err(Busy);
    }
    // A document that has not finished loading has no settled form yet.
    if !shared
        .automation
        .lock()
        .is_ok_and(|state| state.available())
    {
        return Err(Busy);
    }
    let Some(frame) = browser
        .main_frame()
        .filter(|frame| frame.is_valid() == 1 && frame.is_main() == 1)
    else {
        return Err(NoForm);
    };
    let url = CefString::from(&frame.url()).to_string();
    let Some(origin) = shared.login_frames.origin(browser, &frame) else {
        return Err(NoForm);
    };
    if browser_origin(&url).as_deref() != Some(origin.as_str())
        || !shared.session.lock().is_ok_and(|session| {
            navigation_allowed(&session, &shared.identity, &shared.permissions, &url, true)
        })
    {
        return Err(NoForm);
    }
    if !admit(&origin) {
        return Err(Owner);
    }
    // The owner callback may have revoked the attempt or replaced the page.
    if !shared.current()
        || !shared.accepts(Some(browser))
        || frame.is_valid() != 1
        || CefString::from(&frame.url()).to_string() != url
    {
        return Err(NoForm);
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
    {
        let Ok(mut entry) = shared.login_totp.lock() else {
            return Err(Busy);
        };
        if entry.entering() {
            return Err(Busy);
        }
        if step == NativeLoginRetryStep::Credentials {
            let Ok(mut budget) = shared.login_budget.lock() else {
                return Err(Busy);
            };
            *budget = LoginBudget::default();
            entry.restart_typing();
        }
        entry.rearm_code_entry();
    }
    frame.send_process_message(ProcessId::RENDERER, Some(&mut message));
    Ok(())
}
