// ── sorng-ssh-scripts/src/scheduler.rs ───────────────────────────────────────
//! Timer and cron-based scheduler for SSH scripts.

use std::collections::HashMap;
use chrono::{DateTime, Utc, NaiveTime};

use crate::types::*;

/// State for a single scheduled timer.
#[derive(Debug, Clone)]
pub struct TimerState {
    pub script_id: String,
    pub script_name: String,
    pub session_id: String,
    pub trigger: ScriptTrigger,
    pub next_fire: Option<DateTime<Utc>>,
    pub last_fire: Option<DateTime<Utc>>,
    pub run_count: u64,
    pub max_runs: u64,
    pub active: bool,
    pub created_at: DateTime<Utc>,
}

/// The scheduler manages timers for interval, cron, and scheduled triggers.
#[derive(Debug, Default)]
pub struct Scheduler {
    timers: HashMap<String, TimerState>,
}

impl Scheduler {
    pub fn new() -> Self {
        Self::default()
    }

    /// Register a script with a time-based trigger for a session.
    pub fn register(
        &mut self,
        script_id: &str,
        script_name: &str,
        session_id: &str,
        trigger: &ScriptTrigger,
    ) -> Option<String> {
        let timer_id = format!("{}:{}", session_id, script_id);

        let (next_fire, max_runs) = match trigger {
            ScriptTrigger::Interval { interval_ms, max_runs, run_immediately } => {
                let next = if *run_immediately {
                    Utc::now()
                } else {
                    Utc::now() + chrono::Duration::milliseconds(*interval_ms as i64)
                };
                (Some(next), *max_runs)
            }
            ScriptTrigger::Cron { expression, timezone: _ } => {
                match compute_next_cron(expression) {
                    Some(next) => (Some(next), 0),
                    None => return None,
                }
            }
            ScriptTrigger::Scheduled { at, daily, timezone: _ } => {
                match compute_next_scheduled(at, *daily) {
                    Some(next) => (Some(next), if *daily { 0 } else { 1 }),
                    None => return None,
                }
            }
            _ => return None, // not a time-based trigger
        };

        self.timers.insert(timer_id.clone(), TimerState {
            script_id: script_id.to_string(),
            script_name: script_name.to_string(),
            session_id: session_id.to_string(),
            trigger: trigger.clone(),
            next_fire,
            last_fire: None,
            run_count: 0,
            max_runs,
            active: true,
            created_at: Utc::now(),
        });

        Some(timer_id)
    }

    /// Unregister all timers for a session.
    pub fn unregister_session(&mut self, session_id: &str) {
        self.timers.retain(|_, t| t.session_id != session_id);
    }

    /// Unregister a specific timer.
    pub fn unregister(&mut self, timer_id: &str) {
        self.timers.remove(timer_id);
    }

    /// Unregister all timers for a specific script.
    pub fn unregister_script(&mut self, script_id: &str) {
        self.timers.retain(|_, t| t.script_id != script_id);
    }

    /// Check which timers are due and return the script IDs + session IDs to fire.
    /// Updates the internal state (next_fire, run_count) for fired timers.
    pub fn tick(&mut self) -> Vec<TimerFire> {
        let now = Utc::now();
        let mut fires = Vec::new();

        for (timer_id, state) in self.timers.iter_mut() {
            if !state.active { continue; }

            let should_fire = state.next_fire
                .map(|nf| now >= nf)
                .unwrap_or(false);

            if !should_fire { continue; }

            fires.push(TimerFire {
                timer_id: timer_id.clone(),
                script_id: state.script_id.clone(),
                script_name: state.script_name.clone(),
                session_id: state.session_id.clone(),
            });

            state.last_fire = Some(now);
            state.run_count += 1;

            // Check max runs
            if state.max_runs > 0 && state.run_count >= state.max_runs {
                state.active = false;
                state.next_fire = None;
                continue;
            }

            // Compute next fire time
            state.next_fire = match &state.trigger {
                ScriptTrigger::Interval { interval_ms, .. } => {
                    Some(now + chrono::Duration::milliseconds(*interval_ms as i64))
                }
                ScriptTrigger::Cron { expression, .. } => {
                    compute_next_cron(expression)
                }
                ScriptTrigger::Scheduled { at, daily, .. } => {
                    if *daily {
                        compute_next_scheduled(at, true)
                    } else {
                        state.active = false;
                        None
                    }
                }
                _ => None,
            };
        }

        fires
    }

    /// Get all active timer entries for display.
    pub fn get_entries(&self) -> Vec<SchedulerEntry> {
        self.timers.values()
            .map(|t| SchedulerEntry {
                script_id: t.script_id.clone(),
                script_name: t.script_name.clone(),
                trigger_type: trigger_type_str(&t.trigger).to_string(),
                next_fire: t.next_fire,
                last_fire: t.last_fire,
                run_count: t.run_count,
                is_active: t.active,
            })
            .collect()
    }

    /// Get entries for a specific session.
    pub fn get_session_entries(&self, session_id: &str) -> Vec<SchedulerEntry> {
        self.timers.values()
            .filter(|t| t.session_id == session_id)
            .map(|t| SchedulerEntry {
                script_id: t.script_id.clone(),
                script_name: t.script_name.clone(),
                trigger_type: trigger_type_str(&t.trigger).to_string(),
                next_fire: t.next_fire,
                last_fire: t.last_fire,
                run_count: t.run_count,
                is_active: t.active,
            })
            .collect()
    }

    /// Pause a timer.
    pub fn pause(&mut self, timer_id: &str) -> bool {
        if let Some(t) = self.timers.get_mut(timer_id) {
            t.active = false;
            true
        } else {
            false
        }
    }

    /// Resume a timer.
    pub fn resume(&mut self, timer_id: &str) -> bool {
        if let Some(t) = self.timers.get_mut(timer_id) {
            t.active = true;
            // Recompute next fire
            let now = Utc::now();
            t.next_fire = match &t.trigger {
                ScriptTrigger::Interval { interval_ms, .. } => {
                    Some(now + chrono::Duration::milliseconds(*interval_ms as i64))
                }
                ScriptTrigger::Cron { expression, .. } => {
                    compute_next_cron(expression)
                }
                ScriptTrigger::Scheduled { at, daily, .. } => {
                    compute_next_scheduled(at, *daily)
                }
                _ => None,
            };
            true
        } else {
            false
        }
    }

    pub fn active_count(&self) -> usize {
        self.timers.values().filter(|t| t.active).count()
    }

    pub fn total_count(&self) -> usize {
        self.timers.len()
    }
}

/// A timer fire event.
#[derive(Debug, Clone)]
pub struct TimerFire {
    pub timer_id: String,
    pub script_id: String,
    pub script_name: String,
    pub session_id: String,
}

/// Compute the next fire time for a cron expression.
fn compute_next_cron(expression: &str) -> Option<DateTime<Utc>> {
    use cron::Schedule;
    use std::str::FromStr;

    // cron crate expects 6 or 7 fields; standard 5-field needs a prepended "0"
    let padded = if expression.split_whitespace().count() == 5 {
        format!("0 {}", expression)
    } else {
        expression.to_string()
    };

    Schedule::from_str(&padded).ok()
        .and_then(|sched| sched.upcoming(Utc).next())
}

/// Compute the next fire time for a scheduled trigger.
fn compute_next_scheduled(at: &str, daily: bool) -> Option<DateTime<Utc>> {
    // Try parsing as HH:MM or HH:MM:SS for daily
    if daily {
        let time = NaiveTime::parse_from_str(at, "%H:%M:%S")
            .or_else(|_| NaiveTime::parse_from_str(at, "%H:%M"))
            .ok()?;

        let today = Utc::now().date_naive();
        let candidate = today.and_time(time).and_utc();

        if candidate > Utc::now() {
            Some(candidate)
        } else {
            // next day
            let tomorrow = today.succ_opt()?;
            Some(tomorrow.and_time(time).and_utc())
        }
    } else {
        // One-shot: parse as ISO 8601
        DateTime::parse_from_rfc3339(at).ok().map(|dt| dt.with_timezone(&Utc))
    }
}

fn trigger_type_str(trigger: &ScriptTrigger) -> &'static str {
    crate::store::trigger_type_name(trigger)
}
