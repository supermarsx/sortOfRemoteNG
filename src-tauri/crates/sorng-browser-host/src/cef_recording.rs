//! CEF IO-thread metadata observer; no admission decisions, IO, or body access.
use super::recording::{self, Capture, Outcome};
use cef::*;
use sorng_protocols::origin_browser::BrowserIdentity;
use std::sync::Mutex;

pub(super) fn start(
    slot: &Mutex<Option<Capture>>,
    identity: &BrowserIdentity,
    request: Option<&Request>,
) {
    let Some(request) = request else {
        return;
    };
    let Ok(mut slot) = slot.lock() else {
        return;
    };
    if slot.is_none() {
        *slot = recording::begin(
            identity,
            &CefString::from(&request.url()).to_string(),
            &CefString::from(&request.method()).to_string(),
        );
    }
}

pub(super) fn redirect(
    slot: &Mutex<Option<Capture>>,
    request: Option<&Request>,
    response: Option<&Response>,
    new_url: Option<&CefString>,
    allowed: bool,
) {
    let Ok(mut slot) = slot.lock() else {
        return;
    };
    let Some(capture) = slot.take() else {
        return;
    };
    let status = response.map(|r| r.status()).unwrap_or(0);
    if allowed {
        if let (Some(request), Some(url)) = (request, new_url) {
            *slot = capture.redirect(
                status,
                &url.to_string(),
                &CefString::from(&request.method()).to_string(),
            );
            return;
        }
    }
    capture.complete(status, 0, Outcome::Redirect);
}

pub(super) fn complete(
    slot: &Mutex<Option<Capture>>,
    response: Option<&Response>,
    status: UrlrequestStatus,
    received: i64,
) {
    let Ok(mut slot) = slot.lock() else {
        return;
    };
    if let Some(capture) = slot.take() {
        let outcome = if status == UrlrequestStatus::SUCCESS {
            Outcome::Success
        } else if status == UrlrequestStatus::CANCELED {
            Outcome::Cancelled
        } else {
            Outcome::Failed
        };
        capture.complete(response.map(|r| r.status()).unwrap_or(0), received, outcome);
    }
}
