//! Native owner-fenced, anonymous origin-root diagnostic. No CEF objects or
//! borrowed database locks survive an await; no renderer-selected route exists.
use super::*;
use crate::origin_browser_diagnostics::{DiagnoseRequest, DiagnoseResponse, ProbeBusyGuard};
use sorng_browser_host::domain_permissions::{WebsitePermissionDecision, WebsitePermissionQuery};
use sorng_protocols::origin_browser_diagnostics::{
    canonical_origin_root, AnonymousOriginProbe, ProbeOutcome, ProbeResponse,
};

const INVALID: &str = "Choose a canonical HTTP(S) origin for the native diagnostic.";
const DENIED: &str = "This origin is not permitted for navigation by the active native attempt.";
const COMMAND_TIMEOUT: Duration = Duration::from_secs(10);

// BEGIN std-only probe session lock
// Never block the async executor: timeout/cancellation cannot interrupt a
// synchronous mutex wait. Poison is unavailable evidence, not permission to
// recover a possibly inconsistent native session.
fn try_session<T>(
    session: &std::sync::Mutex<T>,
) -> Result<std::sync::MutexGuard<'_, T>, ProbeOutcome> {
    match session.try_lock() {
        Ok(session) => Ok(session),
        Err(std::sync::TryLockError::WouldBlock) => Err(ProbeOutcome::Busy),
        Err(std::sync::TryLockError::Poisoned(_)) => Err(ProbeOutcome::OwnerUnavailable),
    }
}
// END std-only probe session lock

fn live(attempt: &Attempt) -> bool {
    attempt.current() && shared().admission.ready()
}

fn navigation_allowed(attempt: &Attempt, session: &OriginBrowserSession, root: &str) -> bool {
    let Ok(url) = session.authorize_navigation(&attempt.identity, root) else {
        return false;
    };
    attempt
        .permissions
        .resolve(WebsitePermissionQuery {
            website_origin: session.policy().source_origin(),
            destination_origin: &url.origin().ascii_serialization(),
            request_class: "navigation",
            native_denied: false,
        })
        .decision
        == WebsitePermissionDecision::Allow
}

pub(crate) async fn diagnose(
    window: WebviewWindow,
    state: &EncryptionState,
    request: DiagnoseRequest,
) -> Result<DiagnoseResponse, String> {
    request.identity.validate().map_err(|_| STALE)?;
    let root = canonical_origin_root(&request.origin).ok_or(INVALID)?;
    // The native registry verifies the full owner identity and invoking window.
    let attempt = lookup(&window, &request.identity)?;
    let started = Instant::now();
    let unavailable =
        || ProbeResponse::without_response(ProbeOutcome::OwnerUnavailable, started.elapsed());
    if !live(&attempt) {
        return Ok(unavailable());
    }
    let Some(_busy) = ProbeBusyGuard::enter(&attempt.diagnostics_busy) else {
        return Ok(ProbeResponse::without_response(
            ProbeOutcome::Busy,
            Duration::ZERO,
        ));
    };
    let result = tokio::time::timeout(COMMAND_TIMEOUT, async {
        if !live(&attempt)
            || attempt.lease.recheck(&window, state).await.is_err()
            || !live(&attempt)
        {
            return Ok(unavailable());
        }
        let prepared = {
            let session = match try_session(&attempt.session) {
                Ok(session) => session,
                Err(outcome) => return Ok(ProbeResponse::without_response(outcome, started.elapsed())),
            };
            if !live(&attempt) {
                return Ok(unavailable());
            }
            if !navigation_allowed(&attempt, &session, root.as_str()) {
                return Err(DENIED.to_owned());
            }
            // No credential ever enters a DTO, URL, log, or renderer callback.
            // Prepare only inside the native session's credential callback.
            session.with_proxy_credentials(|username, password| {
                AnonymousOriginProbe::prepare(
                    &request.origin,
                    session.proxy_endpoint(),
                    username,
                    password,
                )
            })
        };
        let probe = match prepared {
            Some(Ok(probe)) => probe,
            Some(Err(outcome)) => {
                return Ok(ProbeResponse::without_response(outcome, started.elapsed()))
            }
            None => {
                return Ok(ProbeResponse::without_response(
                    ProbeOutcome::RouteUnavailable,
                    started.elapsed(),
                ))
            }
        };
        if !live(&attempt) {
            return Ok(unavailable());
        }
        // The native relay is revoked with the attempt. Also drop the pending
        // HTTP future promptly on document/lease/runtime revocation; no request
        // is detached and no body stream or response escapes this command.
        let mut response = tokio::select! {
            biased;
            _ = async {
                loop {
                    if !live(&attempt) { break; }
                    tokio::time::sleep(Duration::from_millis(100)).await;
                }
            } => return Ok(unavailable()),
            response = probe.run() => response,
        };
        if attempt.lease.recheck(&window, state).await.is_err() || !live(&attempt) {
            return Ok(unavailable());
        }
        // Recheck exact navigation authority at publication as well as dispatch.
        let session = match try_session(&attempt.session) {
            Ok(session) => session,
            Err(outcome) => return Ok(ProbeResponse::without_response(outcome, started.elapsed())),
        };
        if !live(&attempt) || !navigation_allowed(&attempt, &session, root.as_str()) {
            return Ok(unavailable());
        }
        response.elapsed_ms = started.elapsed().as_millis().min(u32::MAX as u128) as u32;
        Ok(response)
    })
    .await;
    // Timeouts and early failures are fenced too, not only successful headers.
    if !live(&attempt) {
        return Ok(unavailable());
    }
    match result {
        Ok(result) => result,
        Err(_) => Ok(ProbeResponse::without_response(
            ProbeOutcome::Timeout,
            started.elapsed(),
        )),
    }
}

#[cfg(test)]
mod session_lock_tests {
    use super::{try_session, ProbeOutcome};
    use std::sync::{Mutex, TryLockError};

    #[test]
    fn contended_session_returns_busy_without_waiting_for_the_holder() {
        let session = Mutex::new(0u8);
        let _held = session.lock().unwrap();
        assert!(matches!(try_session(&session), Err(ProbeOutcome::Busy)));
        assert!(!session.is_poisoned());
    }

    #[test]
    fn poisoned_session_stays_unavailable_and_is_never_recovered() {
        let session = Mutex::new(0u8);
        let poisoned = std::panic::catch_unwind(|| {
            let _held = session.lock().unwrap();
            panic!("fixture poison");
        });
        assert!(poisoned.is_err());
        for _ in 0..2 {
            assert!(matches!(try_session(&session), Err(ProbeOutcome::OwnerUnavailable)));
            assert!(session.is_poisoned());
        }
        assert!(matches!(session.try_lock(), Err(TryLockError::Poisoned(_))));
    }

    #[test]
    fn one_contended_session_does_not_block_an_independent_session() {
        let first = Mutex::new(0u8);
        let second = Mutex::new(1u8);
        let _held = first.lock().unwrap();
        assert!(matches!(try_session(&first), Err(ProbeOutcome::Busy)));
        let mut independent = try_session(&second).unwrap();
        *independent = 2;
        drop(independent);
        assert_eq!(*try_session(&second).unwrap(), 2);
    }

    #[test]
    fn released_contention_allows_a_fresh_guard_without_poison_repair() {
        let session = Mutex::new(0u8);
        let held = session.lock().unwrap();
        assert!(matches!(try_session(&session), Err(ProbeOutcome::Busy)));
        drop(held);
        assert!(try_session(&session).is_ok());
        assert!(!session.is_poisoned());
    }
}
