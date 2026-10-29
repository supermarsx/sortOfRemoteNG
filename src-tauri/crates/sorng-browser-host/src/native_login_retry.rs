//! The bounded wait of an explicit user retry. The retry re-runs the same
//! login client the first attempt runs, on the open document, and that client
//! looks for its form for at most its detection bound. The browser waits the
//! same bound for the client's first step request: a request means the form
//! was found (the retry started), none means the page has no form for this
//! step. "No form" is only ever the result of the whole wait.
//!
//! Pure state, no CEF handles: the browser host keeps one per browser and
//! drives it from its stage-request handlers and a delayed UI task.
use super::NativeLoginRetryRefusal;
use super::NativeLoginRetryStep;
use std::time::{Duration, Instant};

/// The renderer login clients' detection bound before any timing delay:
/// provider clients look for 60 s, form and step clients settle for 60 s,
/// and every saved detection timeout is at most 60 s.
pub const RETRY_SETTLE_MS: u64 = 60_000;
/// The longest saved fill or submit delay a client accepts.
const MAX_DELAY_MS: u64 = 30_000;
/// Margin for the request to travel from the renderer once the client finds
/// the form at the very end of its own bound.
const RETRY_SLACK_MS: u64 = 2_000;

/// How long the browser waits for a re-run client's first request. Provider
/// clients stop looking at `60 s + 2 × (fill + submit)` after they start; the
/// form and step clients stop earlier. Waiting for the longest of these never
/// reports "no form" while any first-attempt client could still find one.
pub fn retry_detection_bound(fill_delay_ms: u64, submit_delay_ms: u64) -> Duration {
    let fill = fill_delay_ms.min(MAX_DELAY_MS);
    let submit = submit_delay_ms.min(MAX_DELAY_MS);
    Duration::from_millis(RETRY_SETTLE_MS + 2 * (fill + submit) + RETRY_SLACK_MS)
}

/// The final answer of one retry. `Ok(())`: the client found the step's form
/// and asked for it, so the login runs again on this page.
pub type RetryVerdict = Result<(), NativeLoginRetryRefusal>;

struct Pending<R> {
    id: u64,
    step: NativeLoginRetryStep,
    deadline: Instant,
    reply: R,
}

/// At most one retry waits per browser. `R` is the one-shot answer channel;
/// the host invokes the reply returned here outside its own locks.
pub struct RetryWait<R> {
    next: u64,
    pending: Option<Pending<R>>,
}

impl<R> Default for RetryWait<R> {
    fn default() -> Self {
        Self {
            next: 0,
            pending: None,
        }
    }
}

impl<R> RetryWait<R> {
    /// A retry is still looking for its form.
    pub fn waiting(&self) -> bool {
        self.pending.is_some()
    }

    /// Start waiting. A second retry while one waits is refused (`Busy`) and
    /// gets its reply back; the first one keeps its wait.
    pub fn begin(
        &mut self,
        step: NativeLoginRetryStep,
        now: Instant,
        bound: Duration,
        reply: R,
    ) -> Result<u64, R> {
        if self.pending.is_some() {
            return Err(reply);
        }
        self.next = self.next.wrapping_add(1);
        let id = self.next;
        self.pending = Some(Pending {
            id,
            step,
            deadline: now + bound,
            reply,
        });
        Ok(id)
    }

    /// The re-run client asked for a step. A credentials retry is answered by
    /// any credential or action stage request, a 2FA retry by a one-time-code
    /// request; the other kind leaves the wait running.
    pub fn found(&mut self, kind: NativeLoginRetryStep, now: Instant) -> Option<(R, RetryVerdict)> {
        let pending = self.pending.as_ref()?;
        if pending.step != kind || now > pending.deadline {
            return None;
        }
        self.pending.take().map(|pending| (pending.reply, Ok(())))
    }

    /// The delayed task of wait `id` ran. Only that wait, and only once its
    /// whole bound has passed, ends as "no form".
    pub fn expire(&mut self, id: u64, now: Instant) -> Option<(R, RetryVerdict)> {
        let pending = self.pending.as_ref()?;
        if pending.id != id || now < pending.deadline {
            return None;
        }
        self.pending
            .take()
            .map(|pending| (pending.reply, Err(NativeLoginRetryRefusal::NoForm)))
    }

    /// Time left in wait `id`, when it still waits and its bound has not
    /// passed (a timer that ran early is scheduled again for the rest).
    pub fn remaining(&self, id: u64, now: Instant) -> Option<Duration> {
        let pending = self.pending.as_ref().filter(|pending| pending.id == id)?;
        (now < pending.deadline).then(|| pending.deadline - now)
    }

    /// The wait could not be armed or its document is gone.
    pub fn abandon(
        &mut self,
        id: u64,
        refusal: NativeLoginRetryRefusal,
    ) -> Option<(R, RetryVerdict)> {
        if self.pending.as_ref()?.id != id {
            return None;
        }
        self.pending
            .take()
            .map(|pending| (pending.reply, Err(refusal)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use NativeLoginRetryStep::{Credentials, Mfa};

    fn wait() -> (RetryWait<&'static str>, Instant, Duration) {
        (
            RetryWait::default(),
            Instant::now(),
            retry_detection_bound(0, 0),
        )
    }

    #[test]
    fn the_wait_is_at_least_the_longest_first_attempt_detection_bound() {
        assert_eq!(retry_detection_bound(0, 0), Duration::from_millis(62_000));
        // Provider clients: 60 s + 2 × (fill + submit), saved delays ≤ 30 s.
        assert_eq!(
            retry_detection_bound(1_000, 500),
            Duration::from_millis(60_000 + 3_000 + 2_000)
        );
        assert_eq!(
            retry_detection_bound(u64::MAX, u64::MAX),
            Duration::from_millis(60_000 + 120_000 + 2_000)
        );
    }

    #[test]
    fn a_form_rendered_late_within_the_wait_starts_the_retry() {
        let (mut wait, now, bound) = wait();
        let id = wait.begin(Credentials, now, bound, "reply").unwrap();
        // Not yet: the page is still rendering, nothing was asked.
        assert!(wait.expire(id, now + Duration::from_secs(5)).is_none());
        assert!(wait.waiting());
        // The DSM login root mounts 40 s in; the client asks for the username.
        assert_eq!(
            wait.found(Credentials, now + Duration::from_secs(40)),
            Some(("reply", Ok(())))
        );
        assert!(!wait.waiting());
        // The scheduled task finds nothing left to answer.
        assert!(wait.expire(id, now + bound).is_none());
    }

    #[test]
    fn no_form_is_reported_only_after_the_whole_bound() {
        let (mut wait, now, bound) = wait();
        let id = wait.begin(Credentials, now, bound, "reply").unwrap();
        // A timer that ran 1 ms early is told to wait the rest.
        assert!(wait
            .expire(id, now + bound - Duration::from_millis(1))
            .is_none());
        assert_eq!(
            wait.remaining(id, now + bound - Duration::from_millis(1)),
            Some(Duration::from_millis(1))
        );
        assert_eq!(wait.remaining(id, now + bound), None);
        assert_eq!(wait.remaining(id + 1, now), None);
        assert_eq!(
            wait.expire(id, now + bound),
            Some(("reply", Err(NativeLoginRetryRefusal::NoForm)))
        );
        // A request after the answer changes nothing.
        assert!(wait.found(Credentials, now + bound).is_none());
    }

    #[test]
    fn a_step_answers_only_its_own_kind_of_retry() {
        let (mut wait, now, bound) = wait();
        wait.begin(Mfa, now, bound, "mfa").unwrap();
        assert!(wait.found(Credentials, now).is_none());
        assert_eq!(wait.found(Mfa, now), Some(("mfa", Ok(()))));
    }

    #[test]
    fn a_second_retry_while_one_waits_gets_its_reply_back() {
        let (mut wait, now, bound) = wait();
        let first = wait.begin(Credentials, now, bound, "first").unwrap();
        assert_eq!(wait.begin(Credentials, now, bound, "second"), Err("second"));
        // A stale task of another wait never answers this one.
        assert!(wait.expire(first + 1, now + bound).is_none());
        assert!(wait
            .abandon(first + 1, NativeLoginRetryRefusal::NotCurrent)
            .is_none());
        assert_eq!(
            wait.abandon(first, NativeLoginRetryRefusal::Busy),
            Some(("first", Err(NativeLoginRetryRefusal::Busy)))
        );
        // The next retry gets a new id; the old task cannot end it.
        let next = wait.begin(Credentials, now, bound, "next").unwrap();
        assert_ne!(next, first);
        assert!(wait.expire(first, now + bound).is_none());
        assert!(wait.waiting());
    }
}
