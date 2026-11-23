//! Pure lease/handoff state machine for the display-only reparent of a native
//! browser page. It never touches a window, a lease or a CEF object: it only
//! decides what the one native owner (the `main` window) may do next. Owner
//! label, `NativeOwnerLease`, event sink, downloads and certificate hooks all
//! stay on the owner for every state; a target window only ever *displays* the
//! page and gains no authority.
//!
//! Held -> HandedOff -> Claimed -> (TimedOut) -> park (back on the owner) or
//! close, always with a notice the owner shell shows as a floating popup.

use std::time::{Duration, Instant};

/// How long a target window has to report a usable slot after a handoff.
pub(crate) const CLAIM_DEADLINE: Duration = Duration::from_secs(10);

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Notice {
    /// The target never reported a slot; the page was returned to its window.
    ClaimTimedOut,
    /// The target window went away; the page was returned to its window.
    TargetClosed,
    /// Returning the page to its owner window failed, so it was closed.
    ReturnFailed,
    /// A handoff was refused (wrong target, already handed off, ...).
    Refused,
}

impl Notice {
    pub(crate) fn code(&self) -> &'static str {
        match self {
            Notice::ClaimTimedOut => "claim-timed-out",
            Notice::TargetClosed => "target-closed",
            Notice::ReturnFailed => "return-failed",
            Notice::Refused => "refused",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum State {
    /// Displayed in the owner window.
    Held,
    /// Reparented onto `target`, which has not reported a slot yet.
    HandedOff { target: String, deadline: Instant },
    /// `target` reported a slot and displays the page.
    Claimed { target: String },
    /// The claim deadline passed; the owner must take the page back.
    TimedOut { target: String },
    /// Terminal: the owner could not take the page back and closed it.
    Closed,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Event {
    Handoff { target: String, now: Instant },
    Claim { target: String },
    Tick { now: Instant },
    TargetClosed { target: String },
    /// The user (or the owner shell) wants the page back in its own window.
    Release,
    /// The previous `ReturnToOwner` action succeeded.
    ReturnDone,
    /// The previous `ReturnToOwner` action failed.
    ReturnFailed,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Action {
    None,
    /// Reparent the host onto this target window (hidden until it is claimed).
    MoveTo(String),
    /// Reparent the host back to the owner window, hidden, then report
    /// `ReturnDone` or `ReturnFailed`.
    ReturnToOwner(Option<Notice>),
    /// Close the page and tell the owner shell why.
    Close(Notice),
    /// The event was not valid in this state; nothing changes.
    Refuse(Notice),
}

impl State {
    pub(crate) fn target(&self) -> Option<&str> {
        match self {
            State::HandedOff { target, .. }
            | State::Claimed { target }
            | State::TimedOut { target } => Some(target),
            State::Held | State::Closed => None,
        }
    }

    pub(crate) fn displayed_elsewhere(&self) -> bool {
        self.target().is_some()
    }

    /// Advance the machine. The caller performs the returned action and, for
    /// `ReturnToOwner`, feeds back `ReturnDone` / `ReturnFailed`.
    pub(crate) fn step(&mut self, event: Event) -> Action {
        match (&*self, event) {
            (State::Closed, _) => Action::None,
            (State::Held, Event::Handoff { target, now }) => {
                *self = State::HandedOff {
                    target: target.clone(),
                    deadline: now + CLAIM_DEADLINE,
                };
                Action::MoveTo(target)
            }
            // One handoff at a time; a second one never moves the page again.
            (_, Event::Handoff { .. }) => Action::Refuse(Notice::Refused),
            (State::HandedOff { target, .. }, Event::Claim { target: claimed })
                if *target == claimed =>
            {
                *self = State::Claimed { target: claimed };
                Action::None
            }
            // A claim from anyone but the handed-off target is ignored.
            (_, Event::Claim { .. }) => Action::Refuse(Notice::Refused),
            (State::HandedOff { deadline, target }, Event::Tick { now }) if now >= *deadline => {
                *self = State::TimedOut {
                    target: target.clone(),
                };
                Action::ReturnToOwner(Some(Notice::ClaimTimedOut))
            }
            (_, Event::Tick { .. }) => Action::None,
            (
                State::HandedOff { target, .. } | State::Claimed { target },
                Event::TargetClosed { target: closed },
            ) if *target == closed => {
                *self = State::TimedOut { target: closed };
                Action::ReturnToOwner(Some(Notice::TargetClosed))
            }
            (_, Event::TargetClosed { .. }) => Action::None,
            (State::HandedOff { target, .. } | State::Claimed { target }, Event::Release) => {
                *self = State::TimedOut {
                    target: target.clone(),
                };
                Action::ReturnToOwner(None)
            }
            (State::Held, Event::Release) => Action::None,
            (State::TimedOut { .. }, Event::Release) => Action::None,
            (State::TimedOut { .. }, Event::ReturnDone) => {
                *self = State::Held;
                Action::None
            }
            (State::TimedOut { .. }, Event::ReturnFailed) => {
                *self = State::Closed;
                Action::Close(Notice::ReturnFailed)
            }
            (_, Event::ReturnDone | Event::ReturnFailed) => Action::None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t0() -> Instant {
        Instant::now()
    }

    fn target() -> String {
        "detached-s1".to_owned()
    }

    #[test]
    fn handoff_then_claim_displays_on_the_target() {
        let now = t0();
        let mut state = State::Held;
        assert_eq!(
            state.step(Event::Handoff { target: target(), now }),
            Action::MoveTo(target())
        );
        assert!(state.displayed_elsewhere());
        assert_eq!(state.step(Event::Claim { target: target() }), Action::None);
        assert_eq!(state, State::Claimed { target: target() });
    }

    #[test]
    fn a_claim_from_another_window_is_refused_and_changes_nothing() {
        let now = t0();
        let mut state = State::Held;
        state.step(Event::Handoff { target: target(), now });
        let before = state.clone();
        assert_eq!(
            state.step(Event::Claim { target: "detached-other".into() }),
            Action::Refuse(Notice::Refused)
        );
        assert_eq!(state, before);
        // A claim without any handoff is also refused.
        let mut held = State::Held;
        assert_eq!(
            held.step(Event::Claim { target: target() }),
            Action::Refuse(Notice::Refused)
        );
        assert_eq!(held, State::Held);
    }

    #[test]
    fn a_second_handoff_never_moves_the_page_again() {
        let now = t0();
        let mut state = State::Held;
        state.step(Event::Handoff { target: target(), now });
        assert_eq!(
            state.step(Event::Handoff { target: "detached-s2".into(), now }),
            Action::Refuse(Notice::Refused)
        );
        assert_eq!(state.target(), Some("detached-s1"));
        state.step(Event::Claim { target: target() });
        assert_eq!(
            state.step(Event::Handoff { target: "detached-s2".into(), now }),
            Action::Refuse(Notice::Refused)
        );
        assert_eq!(state.target(), Some("detached-s1"));
    }

    #[test]
    fn an_unclaimed_handoff_times_out_and_returns_to_the_owner_with_a_notice() {
        let now = t0();
        let mut state = State::Held;
        state.step(Event::Handoff { target: target(), now });
        assert_eq!(
            state.step(Event::Tick { now: now + CLAIM_DEADLINE - Duration::from_millis(1) }),
            Action::None
        );
        assert_eq!(
            state.step(Event::Tick { now: now + CLAIM_DEADLINE }),
            Action::ReturnToOwner(Some(Notice::ClaimTimedOut))
        );
        assert!(matches!(state, State::TimedOut { .. }));
        // The timeout is not repeated while the return is in flight.
        assert_eq!(state.step(Event::Tick { now: now + CLAIM_DEADLINE * 3 }), Action::None);
        assert_eq!(state.step(Event::ReturnDone), Action::None);
        assert_eq!(state, State::Held);
    }

    #[test]
    fn a_claimed_page_never_times_out() {
        let now = t0();
        let mut state = State::Held;
        state.step(Event::Handoff { target: target(), now });
        state.step(Event::Claim { target: target() });
        assert_eq!(state.step(Event::Tick { now: now + CLAIM_DEADLINE * 100 }), Action::None);
        assert_eq!(state, State::Claimed { target: target() });
    }

    #[test]
    fn a_failed_return_closes_the_page_with_a_notice_and_stays_closed() {
        let now = t0();
        let mut state = State::Held;
        state.step(Event::Handoff { target: target(), now });
        state.step(Event::Claim { target: target() });
        assert_eq!(
            state.step(Event::TargetClosed { target: target() }),
            Action::ReturnToOwner(Some(Notice::TargetClosed))
        );
        assert_eq!(state.step(Event::ReturnFailed), Action::Close(Notice::ReturnFailed));
        assert_eq!(state, State::Closed);
        for event in [
            Event::Handoff { target: target(), now },
            Event::Claim { target: target() },
            Event::Release,
            Event::Tick { now },
        ] {
            assert_eq!(state.step(event), Action::None);
            assert_eq!(state, State::Closed);
        }
    }

    #[test]
    fn closing_an_unrelated_window_changes_nothing() {
        let now = t0();
        let mut state = State::Held;
        state.step(Event::Handoff { target: target(), now });
        state.step(Event::Claim { target: target() });
        assert_eq!(
            state.step(Event::TargetClosed { target: "detached-other".into() }),
            Action::None
        );
        assert_eq!(state, State::Claimed { target: target() });
    }

    #[test]
    fn an_explicit_release_returns_silently_and_is_reversible() {
        let now = t0();
        let mut state = State::Held;
        state.step(Event::Handoff { target: target(), now });
        state.step(Event::Claim { target: target() });
        assert_eq!(state.step(Event::Release), Action::ReturnToOwner(None));
        assert_eq!(state.step(Event::Release), Action::None);
        state.step(Event::ReturnDone);
        assert_eq!(state, State::Held);
        assert_eq!(state.step(Event::Release), Action::None);
        // Held again: the page can be handed off once more.
        assert_eq!(
            state.step(Event::Handoff { target: target(), now }),
            Action::MoveTo(target())
        );
    }

    #[test]
    fn release_while_unclaimed_also_returns() {
        let now = t0();
        let mut state = State::Held;
        state.step(Event::Handoff { target: target(), now });
        assert_eq!(state.step(Event::Release), Action::ReturnToOwner(None));
    }
}
