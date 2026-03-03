// ── sorng-ssh-scripts/src/conditions.rs ──────────────────────────────────────
//! Condition evaluation engine.

use chrono::{Utc, NaiveTime};
use std::collections::HashMap;

use crate::types::*;

/// Context available for condition evaluation.
pub struct ConditionContext {
    pub os_type: Option<String>,
    pub session_started_at: Option<chrono::DateTime<Utc>>,
    pub variables: HashMap<String, String>,
    pub connection_id: Option<String>,
    pub host: Option<String>,
}

impl Default for ConditionContext {
    fn default() -> Self {
        ConditionContext {
            os_type: None,
            session_started_at: None,
            variables: HashMap::new(),
            connection_id: None,
            host: None,
        }
    }
}

/// Evaluate a condition. For conditions that need remote command execution
/// (CommandSucceeds, CommandOutputMatches, FileExists, EnvEquals), we
/// return a struct indicating what needs to be checked remotely.
/// The actual evaluation is deferred to the engine which has SSH access.
pub fn evaluate_local_condition(
    condition: &ScriptCondition,
    ctx: &ConditionContext,
) -> ConditionResult {
    match condition {
        ScriptCondition::OsMatch { os } => {
            if let Some(ref detected) = ctx.os_type {
                ConditionResult::Resolved(detected.to_lowercase().contains(&os.to_lowercase()))
            } else {
                ConditionResult::Resolved(true) // pass if unknown
            }
        }

        ScriptCondition::TimeWindow { start, end, timezone: _ } => {
            let now = Utc::now().time();
            let parse = |s: &str| -> Option<NaiveTime> {
                NaiveTime::parse_from_str(s, "%H:%M").ok()
                    .or_else(|| NaiveTime::parse_from_str(s, "%H:%M:%S").ok())
            };
            match (parse(start), parse(end)) {
                (Some(s), Some(e)) => {
                    let in_window = if s <= e {
                        now >= s && now <= e
                    } else {
                        // wraps midnight
                        now >= s || now <= e
                    };
                    ConditionResult::Resolved(in_window)
                }
                _ => ConditionResult::Resolved(true),
            }
        }

        ScriptCondition::SessionAge { min_age_ms } => {
            if let Some(started) = ctx.session_started_at {
                let age_ms = Utc::now().signed_duration_since(started).num_milliseconds() as u64;
                ConditionResult::Resolved(age_ms >= *min_age_ms)
            } else {
                ConditionResult::Resolved(true)
            }
        }

        ScriptCondition::VariableEquals { name, value } => {
            let matches = ctx.variables.get(name).map(|v| v == value).unwrap_or(false);
            ConditionResult::Resolved(matches)
        }

        ScriptCondition::PreviousExitCode { script_id, exit_code } => {
            // Needs history lookup — deferred
            ConditionResult::NeedsHistoryLookup {
                script_id: script_id.clone(),
                expected_exit_code: *exit_code,
            }
        }

        ScriptCondition::CommandSucceeds { command } => {
            ConditionResult::NeedsRemoteExec {
                command: command.clone(),
                check_type: RemoteCheckType::ExitCodeZero,
            }
        }

        ScriptCondition::CommandOutputMatches { command, pattern } => {
            ConditionResult::NeedsRemoteExec {
                command: command.clone(),
                check_type: RemoteCheckType::OutputMatches(pattern.clone()),
            }
        }

        ScriptCondition::FileExists { path } => {
            ConditionResult::NeedsRemoteExec {
                command: format!("test -e {} && echo EXISTS || echo MISSING", shell_escape(path)),
                check_type: RemoteCheckType::OutputMatches("EXISTS".to_string()),
            }
        }

        ScriptCondition::EnvEquals { variable, value } => {
            ConditionResult::NeedsRemoteExec {
                command: format!("echo \"${}\"", variable),
                check_type: RemoteCheckType::OutputMatches(regex::escape(value)),
            }
        }

        ScriptCondition::All { conditions } => {
            let results: Vec<_> = conditions.iter()
                .map(|c| evaluate_local_condition(c, ctx))
                .collect();

            // If any needs remote, the whole thing needs remote
            if results.iter().any(|r| matches!(r, ConditionResult::NeedsRemoteExec { .. } | ConditionResult::NeedsHistoryLookup { .. })) {
                ConditionResult::NeedsCompositeEval { conditions: conditions.clone(), mode: CompositeMode::All }
            } else {
                let all_pass = results.iter().all(|r| matches!(r, ConditionResult::Resolved(true)));
                ConditionResult::Resolved(all_pass)
            }
        }

        ScriptCondition::Any { conditions } => {
            let results: Vec<_> = conditions.iter()
                .map(|c| evaluate_local_condition(c, ctx))
                .collect();

            if results.iter().any(|r| matches!(r, ConditionResult::NeedsRemoteExec { .. } | ConditionResult::NeedsHistoryLookup { .. })) {
                ConditionResult::NeedsCompositeEval { conditions: conditions.clone(), mode: CompositeMode::Any }
            } else {
                let any_pass = results.iter().any(|r| matches!(r, ConditionResult::Resolved(true)));
                ConditionResult::Resolved(any_pass)
            }
        }

        ScriptCondition::Not { condition } => {
            match evaluate_local_condition(condition, ctx) {
                ConditionResult::Resolved(v) => ConditionResult::Resolved(!v),
                other => other, // can't negate deferred
            }
        }
    }
}

/// Result of condition evaluation.
pub enum ConditionResult {
    /// Fully evaluated.
    Resolved(bool),
    /// Needs a remote command to be executed.
    NeedsRemoteExec {
        command: String,
        check_type: RemoteCheckType,
    },
    /// Needs a history lookup.
    NeedsHistoryLookup {
        script_id: String,
        expected_exit_code: i32,
    },
    /// Needs composite evaluation (All/Any with deferred children).
    NeedsCompositeEval {
        conditions: Vec<ScriptCondition>,
        mode: CompositeMode,
    },
}

pub enum RemoteCheckType {
    ExitCodeZero,
    OutputMatches(String),
}

pub enum CompositeMode {
    All,
    Any,
}

fn shell_escape(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}
