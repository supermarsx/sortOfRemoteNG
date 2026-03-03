// ── sorng-ssh-scripts/src/store.rs ───────────────────────────────────────────
//! In-memory script and chain store with CRUD operations.

use std::collections::HashMap;
use chrono::Utc;
use uuid::Uuid;

use crate::types::*;
use crate::error::*;

/// In-memory store for SSH event scripts for chains.
#[derive(Debug, Default)]
pub struct ScriptStore {
    scripts: HashMap<String, SshEventScript>,
    chains: HashMap<String, ScriptChain>,
}

impl ScriptStore {
    pub fn new() -> Self {
        Self::default()
    }

    // ── Scripts ──────────────────────────────────────────────────────────────

    pub fn create_script(&mut self, req: CreateScriptRequest) -> SshScriptResult<SshEventScript> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now();
        let script = SshEventScript {
            id: id.clone(),
            name: req.name,
            description: req.description,
            enabled: true,
            content: req.content,
            language: req.language,
            execution_mode: req.execution_mode,
            trigger: req.trigger,
            conditions: req.conditions,
            variables: req.variables,
            timeout_ms: req.timeout_ms,
            on_failure: req.on_failure,
            max_retries: req.max_retries,
            retry_delay_ms: req.retry_delay_ms,
            run_as_user: req.run_as_user,
            working_directory: req.working_directory,
            environment: req.environment,
            notifications: req.notifications,
            tags: req.tags,
            category: req.category,
            priority: req.priority,
            connection_ids: req.connection_ids,
            host_patterns: req.host_patterns,
            created_at: now,
            updated_at: now,
            author: None,
            version: 1,
        };
        self.scripts.insert(id, script.clone());
        Ok(script)
    }

    pub fn get_script(&self, id: &str) -> SshScriptResult<SshEventScript> {
        self.scripts.get(id).cloned().ok_or_else(|| SshScriptError::not_found(format!("Script not found: {}", id)))
    }

    pub fn list_scripts(&self) -> Vec<SshEventScript> {
        let mut list: Vec<_> = self.scripts.values().cloned().collect();
        list.sort_by(|a, b| a.priority.cmp(&b.priority).then_with(|| a.name.cmp(&b.name)));
        list
    }

    pub fn list_scripts_by_tag(&self, tag: &str) -> Vec<SshEventScript> {
        self.scripts.values()
            .filter(|s| s.tags.contains(&tag.to_string()))
            .cloned()
            .collect()
    }

    pub fn list_scripts_by_category(&self, category: &str) -> Vec<SshEventScript> {
        self.scripts.values()
            .filter(|s| s.category.as_deref() == Some(category))
            .cloned()
            .collect()
    }

    pub fn list_scripts_by_trigger(&self, trigger_type: &str) -> Vec<SshEventScript> {
        self.scripts.values()
            .filter(|s| trigger_type_name(&s.trigger) == trigger_type)
            .cloned()
            .collect()
    }

    pub fn update_script(&mut self, req: UpdateScriptRequest) -> SshScriptResult<SshEventScript> {
        let script = self.scripts.get_mut(&req.id)
            .ok_or_else(|| SshScriptError::not_found(format!("Script not found: {}", req.id)))?;

        if let Some(name) = req.name { script.name = name; }
        if let Some(desc) = req.description { script.description = Some(desc); }
        if let Some(content) = req.content { script.content = content; }
        if let Some(lang) = req.language { script.language = lang; }
        if let Some(mode) = req.execution_mode { script.execution_mode = mode; }
        if let Some(trigger) = req.trigger { script.trigger = trigger; }
        if let Some(conds) = req.conditions { script.conditions = conds; }
        if let Some(vars) = req.variables { script.variables = vars; }
        if let Some(t) = req.timeout_ms { script.timeout_ms = t; }
        if let Some(of) = req.on_failure { script.on_failure = of; }
        if let Some(mr) = req.max_retries { script.max_retries = mr; }
        if let Some(rd) = req.retry_delay_ms { script.retry_delay_ms = rd; }
        if let Some(user) = req.run_as_user { script.run_as_user = Some(user); }
        if let Some(wd) = req.working_directory { script.working_directory = Some(wd); }
        if let Some(env) = req.environment { script.environment = env; }
        if let Some(notifs) = req.notifications { script.notifications = notifs; }
        if let Some(tags) = req.tags { script.tags = tags; }
        if let Some(cat) = req.category { script.category = Some(cat); }
        if let Some(pri) = req.priority { script.priority = pri; }
        if let Some(en) = req.enabled { script.enabled = en; }
        if let Some(cids) = req.connection_ids { script.connection_ids = cids; }
        if let Some(hp) = req.host_patterns { script.host_patterns = hp; }

        script.updated_at = Utc::now();
        script.version += 1;

        Ok(script.clone())
    }

    pub fn delete_script(&mut self, id: &str) -> SshScriptResult<()> {
        self.scripts.remove(id)
            .ok_or_else(|| SshScriptError::not_found(format!("Script not found: {}", id)))?;
        Ok(())
    }

    pub fn duplicate_script(&mut self, id: &str) -> SshScriptResult<SshEventScript> {
        let orig = self.get_script(id)?;
        let new_id = Uuid::new_v4().to_string();
        let now = Utc::now();
        let mut copy = orig;
        copy.id = new_id.clone();
        copy.name = format!("{} (copy)", copy.name);
        copy.created_at = now;
        copy.updated_at = now;
        copy.version = 1;
        self.scripts.insert(new_id, copy.clone());
        Ok(copy)
    }

    pub fn toggle_script(&mut self, id: &str) -> SshScriptResult<bool> {
        let script = self.scripts.get_mut(id)
            .ok_or_else(|| SshScriptError::not_found(format!("Script not found: {}", id)))?;
        script.enabled = !script.enabled;
        script.updated_at = Utc::now();
        Ok(script.enabled)
    }

    /// Get all enabled scripts that match a given trigger type and optionally a connection/host.
    pub fn get_matching_scripts(
        &self,
        trigger_type: &str,
        connection_id: Option<&str>,
        host: Option<&str>,
    ) -> Vec<SshEventScript> {
        let mut matching: Vec<_> = self.scripts.values()
            .filter(|s| {
                if !s.enabled { return false; }
                if trigger_type_name(&s.trigger) != trigger_type { return false; }

                // Connection filter
                if !s.connection_ids.is_empty() {
                    if let Some(cid) = connection_id {
                        if !s.connection_ids.contains(&cid.to_string()) { return false; }
                    } else {
                        return false;
                    }
                }

                // Host pattern filter
                if !s.host_patterns.is_empty() {
                    if let Some(h) = host {
                        if !s.host_patterns.iter().any(|p| glob_match(p, h)) { return false; }
                    } else {
                        return false;
                    }
                }

                true
            })
            .cloned()
            .collect();

        matching.sort_by(|a, b| a.priority.cmp(&b.priority));
        matching
    }

    pub fn get_all_tags(&self) -> Vec<String> {
        let mut tags: Vec<String> = self.scripts.values()
            .flat_map(|s| s.tags.iter().cloned())
            .collect();
        tags.sort();
        tags.dedup();
        tags
    }

    pub fn get_all_categories(&self) -> Vec<String> {
        let mut cats: Vec<String> = self.scripts.values()
            .filter_map(|s| s.category.clone())
            .collect();
        cats.sort();
        cats.dedup();
        cats
    }

    // ── Chains ───────────────────────────────────────────────────────────────

    pub fn create_chain(&mut self, req: CreateChainRequest) -> SshScriptResult<ScriptChain> {
        // Validate all step script IDs exist
        for step in &req.steps {
            if !self.scripts.contains_key(&step.script_id) {
                return Err(SshScriptError::validation(
                    format!("Chain step references unknown script: {}", step.script_id)
                ));
            }
        }

        let id = Uuid::new_v4().to_string();
        let now = Utc::now();
        let chain = ScriptChain {
            id: id.clone(),
            name: req.name,
            description: req.description,
            enabled: true,
            trigger: req.trigger,
            steps: req.steps,
            abort_on_failure: req.abort_on_failure,
            tags: req.tags,
            created_at: now,
            updated_at: now,
        };
        self.chains.insert(id, chain.clone());
        Ok(chain)
    }

    pub fn get_chain(&self, id: &str) -> SshScriptResult<ScriptChain> {
        self.chains.get(id).cloned()
            .ok_or_else(|| SshScriptError::not_found(format!("Chain not found: {}", id)))
    }

    pub fn list_chains(&self) -> Vec<ScriptChain> {
        let mut list: Vec<_> = self.chains.values().cloned().collect();
        list.sort_by(|a, b| a.name.cmp(&b.name));
        list
    }

    pub fn update_chain(&mut self, req: UpdateChainRequest) -> SshScriptResult<ScriptChain> {
        let chain = self.chains.get_mut(&req.id)
            .ok_or_else(|| SshScriptError::not_found(format!("Chain not found: {}", req.id)))?;

        if let Some(name) = req.name { chain.name = name; }
        if let Some(desc) = req.description { chain.description = Some(desc); }
        if let Some(trigger) = req.trigger { chain.trigger = trigger; }
        if let Some(steps) = req.steps { chain.steps = steps; }
        if let Some(aof) = req.abort_on_failure { chain.abort_on_failure = aof; }
        if let Some(en) = req.enabled { chain.enabled = en; }
        if let Some(tags) = req.tags { chain.tags = tags; }

        chain.updated_at = Utc::now();

        Ok(chain.clone())
    }

    pub fn delete_chain(&mut self, id: &str) -> SshScriptResult<()> {
        self.chains.remove(id)
            .ok_or_else(|| SshScriptError::not_found(format!("Chain not found: {}", id)))?;
        Ok(())
    }

    pub fn toggle_chain(&mut self, id: &str) -> SshScriptResult<bool> {
        let chain = self.chains.get_mut(id)
            .ok_or_else(|| SshScriptError::not_found(format!("Chain not found: {}", id)))?;
        chain.enabled = !chain.enabled;
        chain.updated_at = Utc::now();
        Ok(chain.enabled)
    }

    // ── Import / Export ──────────────────────────────────────────────────────

    pub fn export_bundle(&self) -> ScriptBundle {
        ScriptBundle {
            version: "1.0.0".to_string(),
            exported_at: Utc::now(),
            scripts: self.list_scripts(),
            chains: self.list_chains(),
        }
    }

    pub fn import_bundle(&mut self, bundle: ScriptBundle, overwrite: bool) -> SshScriptResult<(usize, usize)> {
        let mut scripts_imported = 0usize;
        let mut chains_imported = 0usize;

        for script in bundle.scripts {
            if overwrite || !self.scripts.contains_key(&script.id) {
                self.scripts.insert(script.id.clone(), script);
                scripts_imported += 1;
            }
        }

        for chain in bundle.chains {
            if overwrite || !self.chains.contains_key(&chain.id) {
                self.chains.insert(chain.id.clone(), chain);
                chains_imported += 1;
            }
        }

        Ok((scripts_imported, chains_imported))
    }

    pub fn script_count(&self) -> usize {
        self.scripts.len()
    }

    pub fn chain_count(&self) -> usize {
        self.chains.len()
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/// Extract the trigger type name as a simple string.
pub fn trigger_type_name(trigger: &ScriptTrigger) -> &'static str {
    match trigger {
        ScriptTrigger::Login { .. } => "login",
        ScriptTrigger::Logout { .. } => "logout",
        ScriptTrigger::Reconnect => "reconnect",
        ScriptTrigger::ConnectionError { .. } => "connectionError",
        ScriptTrigger::Interval { .. } => "interval",
        ScriptTrigger::Cron { .. } => "cron",
        ScriptTrigger::OutputMatch { .. } => "outputMatch",
        ScriptTrigger::Idle { .. } => "idle",
        ScriptTrigger::FileWatch { .. } => "fileWatch",
        ScriptTrigger::Resize => "resize",
        ScriptTrigger::Manual => "manual",
        ScriptTrigger::Scheduled { .. } => "scheduled",
        ScriptTrigger::EnvChange { .. } => "envChange",
        ScriptTrigger::MetricThreshold { .. } => "metricThreshold",
        ScriptTrigger::AfterScript { .. } => "afterScript",
        ScriptTrigger::KeepaliveFailed => "keepaliveFailed",
        ScriptTrigger::PortForwardChange { .. } => "portForwardChange",
        ScriptTrigger::HostKeyChanged => "hostKeyChanged",
    }
}

/// Simple glob matcher (supports only `*` and `?` wildcards).
fn glob_match(pattern: &str, text: &str) -> bool {
    let regex_str = format!("^{}$",
        pattern.chars().map(|c| match c {
            '*' => ".*".to_string(),
            '?' => ".".to_string(),
            c if regex::escape(&c.to_string()) != c.to_string() => regex::escape(&c.to_string()),
            c => c.to_string(),
        }).collect::<String>()
    );
    regex::Regex::new(&regex_str).map(|r| r.is_match(text)).unwrap_or(false)
}
