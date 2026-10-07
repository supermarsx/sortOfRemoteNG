//! Event-driven CEF work scheduling shared by all three desktop platforms.
//! The scheduler is not a timer thread: the native shell owns its wake-up and
//! calls CEF on the initialization thread. Stale timers cannot revive a stopped
//! runtime and re-entrant callbacks cannot recursively enter CEF.

use std::time::{Duration, Instant};

// Match the pinned CEF external-pump example, including its idle fallback.
// https://github.com/chromiumembedded/cef/blob/682c378/tests/shared/browser/main_message_loop_external_pump.cc
// CEF's external callbacks alone do not guarantee all IPC/native work progresses.
const MAX_PUMP_DELAY: Duration = Duration::from_millis(1000 / 30);

#[derive(Default)]
pub struct MessagePump {
    due: Option<Instant>,
    working: bool,
    stopped: bool,
}

impl MessagePump {
    /// CEF can request work from any thread; the owner serializes this state.
    /// CEF's positive delays replace pending work, including earlier deadlines.
    /// Immediate work also replaces the pending timer. A periodic fallback
    /// bounds the interval even when CEF schedules no further explicit work.
    pub fn schedule(&mut self, now: Instant, delay_ms: i64) -> Option<Instant> {
        if self.stopped {
            return None;
        }
        let delay = Duration::from_millis(delay_ms.max(0) as u64).min(MAX_PUMP_DELAY);
        let requested = now.checked_add(delay).unwrap_or(now);
        self.due = Some(requested);
        self.deadline()
    }

    pub fn deadline(&self) -> Option<Instant> {
        if self.stopped || self.working {
            None
        } else {
            self.due
        }
    }

    /// The native event-loop callback must release the state lock BEFORE
    /// calling CefDoMessageLoopWork: CEF may immediately schedule more work.
    pub fn begin_work(&mut self, now: Instant) -> bool {
        if self.stopped || self.working || !self.due.is_some_and(|due| due <= now) {
            return false;
        }
        self.due = None;
        self.working = true;
        true
    }

    pub fn finish_work(&mut self, now: Instant) -> Option<Instant> {
        self.working = false;
        if !self.stopped && self.due.is_none() {
            self.due = now.checked_add(MAX_PUMP_DELAY).or(Some(now));
        }
        self.deadline()
    }

    pub fn stop(&mut self) {
        self.stopped = true;
        self.due = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn positive_delay_replaces_pending_work_and_idle_work_rearms_fallback() {
        let now = Instant::now();
        let mut pump = MessagePump::default();
        assert_eq!(pump.deadline(), None);
        let early = now + Duration::from_millis(10);
        assert_eq!(pump.schedule(now, 10), Some(early));
        let later = now + Duration::from_millis(20);
        assert_eq!(pump.schedule(now, 20), Some(later));
        assert!(!pump.begin_work(now));
        assert!(!pump.begin_work(early));
        assert!(pump.begin_work(later));
        assert_eq!(pump.finish_work(later), Some(later + MAX_PUMP_DELAY));
    }

    #[test]
    fn scheduling_during_work_never_recurses_or_loses_the_wakeup() {
        let now = Instant::now();
        let mut pump = MessagePump::default();
        pump.schedule(now, 0);
        assert!(pump.begin_work(now));
        assert_eq!(pump.schedule(now, -1), None);
        assert!(!pump.begin_work(now));
        assert_eq!(pump.finish_work(now), Some(now));
        assert!(pump.begin_work(now));
        assert_eq!(pump.finish_work(now), Some(now + MAX_PUMP_DELAY));
    }

    #[test]
    fn shutdown_discards_pending_and_reentrant_work() {
        let now = Instant::now();
        let mut pump = MessagePump::default();
        pump.schedule(now, 0);
        assert!(pump.begin_work(now));
        pump.schedule(now, 0);
        pump.stop();
        assert_eq!(pump.finish_work(now), None);
        assert_eq!(pump.schedule(now, 0), None);
        assert!(!pump.begin_work(now));
    }

    #[test]
    fn extreme_delays_cannot_overflow() {
        let now = Instant::now();
        let mut pump = MessagePump::default();
        assert_eq!(pump.schedule(now, i64::MAX), Some(now + MAX_PUMP_DELAY));
        assert_eq!(pump.schedule(now, i64::MIN), Some(now));
    }

    #[test]
    fn native_work_keeps_progressing_without_another_cef_schedule_callback() {
        let mut now = Instant::now();
        let mut pump = MessagePump::default();
        pump.schedule(now, 0);
        for _ in 0..20 {
            assert!(pump.begin_work(now));
            assert_eq!(pump.finish_work(now), Some(now + MAX_PUMP_DELAY));
            assert!(!pump.begin_work(now));
            now += MAX_PUMP_DELAY;
        }
        pump.stop();
        assert!(!pump.begin_work(now));
        assert_eq!(pump.finish_work(now), None);
    }

    #[test]
    fn fallback_does_not_replace_work_requested_while_cef_is_running() {
        let now = Instant::now();
        let mut pump = MessagePump::default();
        pump.schedule(now, 0);
        assert!(pump.begin_work(now));
        pump.schedule(now, 7);
        assert_eq!(pump.finish_work(now), Some(now + Duration::from_millis(7)));
    }
}
