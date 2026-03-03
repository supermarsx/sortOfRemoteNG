// ── sorng-ssh-scripts/src/engine.rs ──────────────────────────────────────────
//! Core execution engine that coordinates store, scheduler, hooks, history.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::types::*;
use crate::error::*;
use crate::store::{ScriptStore, trigger_type_name};
use crate::scheduler::Scheduler;
use crate::hooks::{SessionHookState, map_event_to_triggers};
use crate::history::ExecutionHistory;
use crate::variables::{resolve_variables, substitute_variables};
use crate::conditions::{evaluate_local_condition, ConditionResult};

pub type SshScriptEngineState = Arc<Mutex<SshScriptEngine>>;

/// The main script engine.
pub struct SshScriptEngine {
    pub store: ScriptStore,
    pub scheduler: Scheduler,
    pub history: ExecutionHistory,
    sessions: HashMap<String, SessionHookState>,
    /// Queued executions (for when the engine polls).
    pending_fires: Vec<PendingExecution>,
}

impl SshScriptEngine {
    /// Get number of active sessions.
    pub fn active_session_count(&self) -> usize {
        self.sessions.len()
    }
}

/// A pending execution to be picked up by the Tauri command layer.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingExecution {
    pub execution_id: String,
    pub script_id: String,
    pub script_name: String,
    pub session_id: String,
    pub connection_id: Option<String>,
    pub trigger_type: String,
    pub content: String,
    pub language: ScriptLanguage,
    pub execution_mode: ExecutionMode,
    pub timeout_ms: u64,
    pub run_as_user: Option<String>,
    pub working_directory: Option<String>,
    pub environment: HashMap<String, String>,
    pub resolved_variables: HashMap<String, String>,
    pub on_failure: OnFailure,
    pub max_retries: u32,
    pub retry_delay_ms: u64,
}

impl SshScriptEngine {
    pub fn new() -> Self {
        SshScriptEngine {
            store: ScriptStore::new(),
            scheduler: Scheduler::new(),
            history: ExecutionHistory::new(10000),
            sessions: HashMap::new(),
            pending_fires: Vec::new(),
        }
    }

    pub fn new_state() -> SshScriptEngineState {
        Arc::new(Mutex::new(Self::new()))
    }

    // ── Session Lifecycle ────────────────────────────────────────────────────

    /// Register a new SSH session with the engine.
    pub fn register_session(
        &mut self,
        session_id: &str,
        connection_id: Option<&str>,
        host: Option<&str>,
        username: Option<&str>,
    ) {
        let hook_state = SessionHookState::new(
            session_id.to_string(),
            connection_id.map(String::from),
            host.map(String::from),
            username.map(String::from),
        );
        self.sessions.insert(session_id.to_string(), hook_state);

        // Register time-based triggers
        let scripts = self.store.get_matching_scripts(
            "interval",
            connection_id,
            host,
        );
        for s in &scripts {
            self.scheduler.register(&s.id, &s.name, session_id, &s.trigger);
        }

        let cron_scripts = self.store.get_matching_scripts("cron", connection_id, host);
        for s in &cron_scripts {
            self.scheduler.register(&s.id, &s.name, session_id, &s.trigger);
        }

        let scheduled = self.store.get_matching_scripts("scheduled", connection_id, host);
        for s in &scheduled {
            self.scheduler.register(&s.id, &s.name, session_id, &s.trigger);
        }
    }

    /// Unregister a session (on disconnect).
    pub fn unregister_session(&mut self, session_id: &str) {
        self.sessions.remove(session_id);
        self.scheduler.unregister_session(session_id);
    }

    // ── Event Processing ─────────────────────────────────────────────────────

    /// Process an SSH lifecycle event — fires matching scripts.
    pub fn process_event(&mut self, event: &SshLifecycleEvent) -> Vec<PendingExecution> {
        let trigger_types = map_event_to_triggers(event);
        let mut executions = Vec::new();

        for trigger_type in trigger_types {
            let scripts = self.store.get_matching_scripts(
                trigger_type,
                event.connection_id.as_deref(),
                event.host.as_deref(),
            );

            for script in scripts {
                // Check login delay
                if let ScriptTrigger::Login { delay_ms } = &script.trigger {
                    if *delay_ms > 0 {
                        // The caller should delay execution
                    }
                }

                // Check logout error condition
                if let ScriptTrigger::Logout { run_on_error } = &script.trigger {
                    if event.event_type == SshLifecycleEventType::ConnectionError && !run_on_error {
                        continue;
                    }
                }

                if let Some(exec) = self.prepare_execution(
                    &script,
                    &event.session_id,
                    event.connection_id.as_deref(),
                    event.host.as_deref(),
                    event.username.as_deref(),
                    trigger_type,
                    &HashMap::new(),
                ) {
                    executions.push(exec);
                }
            }
        }

        executions
    }

    /// Process terminal output for output-match triggers.
    pub fn process_output(&mut self, session_id: &str, data: &str) -> Vec<PendingExecution> {
        let mut executions = Vec::new();

        // First, update session output buffer and collect matches
        let mut matched_scripts: Vec<(String, Option<String>, Option<String>, Option<String>)> = Vec::new();

        if let Some(session) = self.sessions.get_mut(session_id) {
            session.append_output(data);

            let connection_id = session.connection_id.clone();
            let host = session.host.clone();
            let username = session.username.clone();

            // Check output-match scripts
            let scripts = self.store.get_matching_scripts(
                "outputMatch",
                connection_id.as_deref(),
                host.as_deref(),
            );

            for script in scripts {
                if let ScriptTrigger::OutputMatch { ref pattern, max_triggers, cooldown_ms } = script.trigger {
                    let matched = session.check_output_match(
                        &script.id,
                        pattern,
                        max_triggers,
                        cooldown_ms,
                    );

                    if matched {
                        matched_scripts.push((script.id.clone(), connection_id.clone(), host.clone(), username.clone()));
                    }
                }
            }
        }

        // Then, prepare executions (no mutable borrow on sessions needed)
        for (script_id, connection_id, host, username) in matched_scripts {
            if let Ok(script) = self.store.get_script(&script_id) {
                if let Some(exec) = self.prepare_execution(
                    &script,
                    session_id,
                    connection_id.as_deref(),
                    host.as_deref(),
                    username.as_deref(),
                    "outputMatch",
                    &HashMap::new(),
                ) {
                    executions.push(exec);
                }
            }
        }

        executions
    }

    /// Scheduler tick — returns any timer-fired executions.
    pub fn tick(&mut self) -> Vec<PendingExecution> {
        let fires = self.scheduler.tick();
        let mut executions = Vec::new();

        for fire in fires {
            if let Ok(script) = self.store.get_script(&fire.script_id) {
                let session = self.sessions.get(&fire.session_id);
                let connection_id = session.and_then(|s| s.connection_id.as_deref());
                let host = session.and_then(|s| s.host.as_deref());
                let username = session.and_then(|s| s.username.as_deref());

                if let Some(exec) = self.prepare_execution(
                    &script,
                    &fire.session_id,
                    connection_id,
                    host,
                    username,
                    trigger_type_name(&script.trigger),
                    &HashMap::new(),
                ) {
                    executions.push(exec);
                }
            }
        }

        executions
    }

    /// Check idle sessions and fire idle scripts.
    pub fn check_idle(&mut self) -> Vec<PendingExecution> {
        let mut executions = Vec::new();
        let session_ids: Vec<_> = self.sessions.keys().cloned().collect();

        for session_id in session_ids {
            let connection_id;
            let host;
            let username;

            // Get idle scripts for this session
            {
                let session = match self.sessions.get(&session_id) {
                    Some(s) => s,
                    None => continue,
                };
                connection_id = session.connection_id.clone();
                host = session.host.clone();
                username = session.username.clone();
            }

            let idle_scripts = self.store.get_matching_scripts(
                "idle",
                connection_id.as_deref(),
                host.as_deref(),
            );

            for script in idle_scripts {
                if let ScriptTrigger::Idle { idle_ms, repeat: _ } = &script.trigger {
                    let session = match self.sessions.get_mut(&session_id) {
                        Some(s) => s,
                        None => continue,
                    };

                    if session.check_idle(*idle_ms) {
                        if let Some(exec) = self.prepare_execution(
                            &script,
                            &session_id,
                            connection_id.as_deref(),
                            host.as_deref(),
                            username.as_deref(),
                            "idle",
                            &HashMap::new(),
                        ) {
                            executions.push(exec);
                        }
                    }
                }
            }
        }

        executions
    }

    // ── Manual Execution ─────────────────────────────────────────────────────

    /// Manually trigger a script.
    pub fn run_script(
        &mut self,
        req: &RunScriptRequest,
    ) -> SshScriptResult<PendingExecution> {
        let script = self.store.get_script(&req.script_id)?;
        let session_id = req.session_id.as_deref().unwrap_or("manual");

        let session = self.sessions.get(session_id);
        let connection_id = req.connection_id.as_deref()
            .or_else(|| session.and_then(|s| s.connection_id.as_deref()));
        let host = session.and_then(|s| s.host.as_deref());
        let username = session.and_then(|s| s.username.as_deref());

        self.prepare_execution(
            &script,
            session_id,
            connection_id,
            host,
            username,
            "manual",
            &req.variable_overrides,
        ).ok_or_else(|| SshScriptError::condition("Conditions not met for script execution"))
    }

    /// Run a chain manually.
    pub fn run_chain(
        &mut self,
        req: &RunChainRequest,
    ) -> SshScriptResult<Vec<PendingExecution>> {
        let chain = self.store.get_chain(&req.chain_id)?;
        let session_id = req.session_id.as_deref().unwrap_or("manual");

        let session = self.sessions.get(session_id);
        let connection_id = req.connection_id.as_deref()
            .or_else(|| session.and_then(|s| s.connection_id.as_deref()));
        let host = session.and_then(|s| s.host.as_deref());
        let username = session.and_then(|s| s.username.as_deref());

        let chain_execution_id = Uuid::new_v4().to_string();
        let mut executions = Vec::new();

        for (idx, step) in chain.steps.iter().enumerate() {
            let script = self.store.get_script(&step.script_id)?;

            if let Some(mut exec) = self.prepare_execution(
                &script,
                session_id,
                connection_id,
                host,
                username,
                "chain",
                &req.variable_overrides,
            ) {
                // Tag with chain info
                exec.environment.insert("CHAIN_ID".to_string(), chain.id.clone());
                exec.environment.insert("CHAIN_NAME".to_string(), chain.name.clone());
                exec.environment.insert("CHAIN_STEP".to_string(), idx.to_string());
                exec.environment.insert("CHAIN_EXECUTION_ID".to_string(), chain_execution_id.clone());
                executions.push(exec);
            } else if chain.abort_on_failure && !step.continue_on_failure {
                return Err(SshScriptError::chain_aborted(
                    format!("Step {} conditions not met", idx)
                ));
            }
        }

        Ok(executions)
    }

    // ── History ──────────────────────────────────────────────────────────────

    /// Record a completed execution.
    pub fn record_execution(&mut self, record: ExecutionRecord) {
        // Check for AfterScript triggers
        let script_id = record.script_id.clone();
        let status = record.status.clone();
        let session_id = record.session_id.clone();

        self.history.add_record(record);

        // Fire AfterScript triggers if succeeded
        if status == ExecutionStatus::Success {
            let after_scripts: Vec<_> = self.store.list_scripts().into_iter()
                .filter(|s| {
                    if let ScriptTrigger::AfterScript { script_id: ref sid, require_success: _ } = s.trigger {
                        *sid == script_id && s.enabled
                    } else {
                        false
                    }
                })
                .collect();

            for script in after_scripts {
                if let Some(sid) = &session_id {
                    let session = self.sessions.get(sid);
                    let connection_id = session.and_then(|s| s.connection_id.as_deref());
                    let host = session.and_then(|s| s.host.as_deref());
                    let username = session.and_then(|s| s.username.as_deref());

                    if let Some(exec) = self.prepare_execution(
                        &script,
                        sid,
                        connection_id,
                        host,
                        username,
                        "afterScript",
                        &HashMap::new(),
                    ) {
                        self.pending_fires.push(exec);
                    }
                }
            }
        }
    }

    /// Drain pending fires (called from the command layer).
    pub fn drain_pending(&mut self) -> Vec<PendingExecution> {
        std::mem::take(&mut self.pending_fires)
    }

    // ── Internal ─────────────────────────────────────────────────────────────

    fn prepare_execution(
        &self,
        script: &SshEventScript,
        session_id: &str,
        connection_id: Option<&str>,
        host: Option<&str>,
        username: Option<&str>,
        trigger_type: &str,
        variable_overrides: &HashMap<String, String>,
    ) -> Option<PendingExecution> {
        if !script.enabled {
            return None;
        }

        // Build connection metadata
        let mut conn_meta = HashMap::new();
        if let Some(h) = host { conn_meta.insert("host".to_string(), h.to_string()); }
        if let Some(u) = username { conn_meta.insert("username".to_string(), u.to_string()); }
        if let Some(c) = connection_id { conn_meta.insert("connection_id".to_string(), c.to_string()); }
        conn_meta.insert("session_id".to_string(), session_id.to_string());

        // Evaluate local conditions
        let condition_ctx = crate::conditions::ConditionContext {
            os_type: None, // TODO: detect OS
            session_started_at: self.sessions.get(session_id).map(|s| s.connected_at),
            variables: HashMap::new(),
            connection_id: connection_id.map(String::from),
            host: host.map(String::from),
        };

        for condition in &script.conditions {
            match evaluate_local_condition(condition, &condition_ctx) {
                ConditionResult::Resolved(false) => return None,
                ConditionResult::Resolved(true) => {},
                _ => {} // deferred conditions pass for now (evaluated at execution time)
            }
        }

        // Resolve variables
        let previous_outputs = HashMap::new(); // TODO: wire up chain outputs
        let (mut resolved_vars, pending_vars) = resolve_variables(
            script,
            variable_overrides,
            &conn_meta,
            &previous_outputs,
        );

        // For pending vars, use defaults (remote resolution happens in execution)
        for pv in &pending_vars {
            resolved_vars.entry(pv.name.clone()).or_insert_with(|| pv.default_value.clone());
        }

        // Substitute variables in content
        let content = substitute_variables(&script.content, &resolved_vars);

        // Merge environments
        let mut env = script.environment.clone();
        for (k, v) in &resolved_vars {
            env.insert(k.clone(), v.clone());
        }

        Some(PendingExecution {
            execution_id: Uuid::new_v4().to_string(),
            script_id: script.id.clone(),
            script_name: script.name.clone(),
            session_id: session_id.to_string(),
            connection_id: connection_id.map(String::from),
            trigger_type: trigger_type.to_string(),
            content,
            language: script.language.clone(),
            execution_mode: script.execution_mode.clone(),
            timeout_ms: script.timeout_ms,
            run_as_user: script.run_as_user.clone(),
            working_directory: script.working_directory.clone(),
            environment: env,
            resolved_variables: resolved_vars,
            on_failure: script.on_failure.clone(),
            max_retries: script.max_retries,
            retry_delay_ms: script.retry_delay_ms,
        })
    }
}
