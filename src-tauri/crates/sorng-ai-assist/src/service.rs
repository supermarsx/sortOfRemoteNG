use crate::completion::CompletionEngine;
use crate::error::AiAssistError;
use crate::explanation::ErrorExplainer;
use crate::history::HistoryAnalyzer;
use crate::manpage::ManPageLookup;
use crate::natural_language::NaturalLanguageTranslator;
use crate::risk::RiskAnalyzer;
use crate::session::SessionManager;
use crate::snippets::SnippetManager;
use crate::types::*;

use sorng_llm::LlmServiceState;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

/// Main AI Assist service that orchestrates all sub-engines.
pub struct AiAssistService {
    config: AiAssistConfig,
    sessions: SessionManager,
    manpages: ManPageLookup,
    snippets: SnippetManager,
    llm: Option<LlmServiceState>,
}

impl AiAssistService {
    pub fn new(config: AiAssistConfig, llm: Option<LlmServiceState>) -> Self {
        Self {
            config,
            sessions: SessionManager::new(),
            manpages: ManPageLookup::new(),
            snippets: SnippetManager::new(),
            llm,
        }
    }

    // ─── Session management ──────────────────────────────────

    pub fn create_session(
        &mut self,
        session_id: &str,
        host: &str,
        username: &str,
    ) -> SessionContext {
        self.sessions
            .create_session(session_id, host, username)
            .clone()
    }

    pub fn get_session(&self, session_id: &str) -> Option<&SessionContext> {
        self.sessions.get_session(session_id)
    }

    pub fn remove_session(&mut self, session_id: &str) {
        self.sessions.remove_session(session_id);
    }

    pub fn list_sessions(&self) -> Vec<String> {
        self.sessions.list_sessions()
    }

    pub fn update_session_context(
        &mut self,
        session_id: &str,
        cwd: Option<String>,
        shell: Option<String>,
        uname: Option<String>,
        env_vars: Option<Vec<(String, String)>>,
    ) -> Result<(), AiAssistError> {
        self.sessions
            .update_context(session_id, cwd, shell, uname, env_vars)
    }

    pub fn record_command(
        &mut self,
        session_id: &str,
        command: &str,
        exit_code: Option<i32>,
        output: Option<String>,
        duration_ms: Option<u64>,
    ) -> Result<(), AiAssistError> {
        self.sessions
            .record_command(session_id, command, exit_code, output, duration_ms)
    }

    pub fn set_installed_tools(
        &mut self,
        session_id: &str,
        tools: Vec<String>,
    ) -> Result<(), AiAssistError> {
        self.sessions.set_installed_tools(session_id, tools)
    }

    // ─── Completions ─────────────────────────────────────────

    pub async fn complete(
        &self,
        session_id: &str,
        input: &str,
        cursor_position: usize,
    ) -> Result<CompletionResponse, AiAssistError> {
        let ctx = self.sessions.get_session(session_id).ok_or_else(|| {
            AiAssistError::session_error(&format!("Session '{}' not found", session_id))
        })?;

        let request = CompletionRequest {
            session_id: session_id.to_string(),
            input: input.to_string(),
            cursor_position,
            cwd: Some(ctx.cwd.clone()),
            shell: ctx.shell.clone(),
            os: ctx.os.clone(),
            env_vars: ctx.env_vars.clone(),
            recent_commands: ctx.recent_commands(self.config.history_context_size),
            recent_output: ctx.last_output.clone(),
            max_suggestions: self.config.max_suggestions,
        };

        CompletionEngine::complete(&request, ctx, &self.config, self.llm.as_ref()).await
    }

    // ─── Error explanation ───────────────────────────────────

    pub async fn explain_error(
        &self,
        session_id: &str,
        error_output: &str,
        command: Option<&str>,
    ) -> Result<ErrorExplanation, AiAssistError> {
        let ctx = self.sessions.get_session(session_id).ok_or_else(|| {
            AiAssistError::session_error(&format!("Session '{}' not found", session_id))
        })?;

        ErrorExplainer::explain(error_output, command, ctx, self.llm.as_ref()).await
    }

    // ─── Man page lookup ─────────────────────────────────────

    pub async fn lookup_command(&mut self, command: &str) -> Result<ManPageInfo, AiAssistError> {
        self.manpages.lookup(command, self.llm.as_ref()).await
    }

    pub fn search_commands(&self, query: &str) -> Vec<ManPageInfo> {
        self.manpages.search(query).into_iter().cloned().collect()
    }

    // ─── Natural language ────────────────────────────────────

    pub async fn translate_natural_language(
        &self,
        session_id: &str,
        query: &str,
        constraints: Vec<String>,
    ) -> Result<NaturalLanguageResult, AiAssistError> {
        let ctx = self.sessions.get_session(session_id).ok_or_else(|| {
            AiAssistError::session_error(&format!("Session '{}' not found", session_id))
        })?;

        let llm = self.llm.as_ref().ok_or_else(|| {
            AiAssistError::llm_error("No LLM configured for natural language translation")
        })?;

        let nl_query = NaturalLanguageQuery {
            query: query.to_string(),
            shell: ctx.shell.clone(),
            os: ctx.os.clone(),
            cwd: Some(ctx.cwd.clone()),
            constraints,
        };

        NaturalLanguageTranslator::translate(&nl_query, ctx, llm).await
    }

    // ─── Risk assessment ─────────────────────────────────────

    pub async fn assess_risk(
        &self,
        session_id: &str,
        command: &str,
    ) -> Result<RiskAssessment, AiAssistError> {
        let ctx = self.sessions.get_session(session_id).ok_or_else(|| {
            AiAssistError::session_error(&format!("Session '{}' not found", session_id))
        })?;

        RiskAnalyzer::assess(command, ctx, self.llm.as_ref()).await
    }

    /// Quick risk assessment without session context (local rules only).
    pub fn quick_risk_assessment(&self, command: &str) -> RiskAssessment {
        let dummy_ctx = SessionContext::new("", "", "");
        RiskAnalyzer::local_assess(command, &dummy_ctx)
    }

    // ─── Snippets ────────────────────────────────────────────

    pub fn list_snippets(&self) -> Vec<&CommandSnippet> {
        self.snippets.list()
    }

    pub fn search_snippets(&self, query: &str) -> Vec<&CommandSnippet> {
        self.snippets.search(query)
    }

    pub fn get_snippet(&self, id: &str) -> Option<&CommandSnippet> {
        self.snippets.get(id)
    }

    pub fn render_snippet(
        &self,
        id: &str,
        params: &HashMap<String, String>,
    ) -> Result<String, AiAssistError> {
        self.snippets.render(id, params)
    }

    pub fn add_snippet(&mut self, snippet: CommandSnippet) {
        self.snippets.add(snippet);
    }

    pub fn remove_snippet(&mut self, id: &str) -> Option<CommandSnippet> {
        self.snippets.remove(id)
    }

    // ─── History analysis ────────────────────────────────────

    pub fn analyze_history(&self, session_id: &str) -> Result<HistoryAnalysis, AiAssistError> {
        let ctx = self.sessions.get_session(session_id).ok_or_else(|| {
            AiAssistError::session_error(&format!("Session '{}' not found", session_id))
        })?;

        Ok(HistoryAnalyzer::analyze(&ctx.history))
    }

    // ─── Config ──────────────────────────────────────────────

    pub fn get_config(&self) -> &AiAssistConfig {
        &self.config
    }

    pub fn update_config(&mut self, config: AiAssistConfig) {
        self.config = config;
    }

    pub fn set_llm(&mut self, llm: LlmServiceState) {
        self.llm = Some(llm);
    }
}

/// Thread-safe shared state for Tauri commands.
pub type AiAssistServiceState = Arc<RwLock<AiAssistService>>;

pub fn create_ai_assist_state(
    config: AiAssistConfig,
    llm: Option<LlmServiceState>,
) -> AiAssistServiceState {
    Arc::new(RwLock::new(AiAssistService::new(config, llm)))
}
