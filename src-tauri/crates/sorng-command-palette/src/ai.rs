use uuid::Uuid;

use sorng_llm::{
    ChatMessage, ChatCompletionRequest, LlmServiceState,
};

use crate::types::*;

/// AI-powered completion and suggestion engine for the command palette.
/// Integrates with the sorng-llm crate for LLM calls.
pub struct AiEngine;

impl AiEngine {
    // ───────── Context building ─────────

    /// Build the system prompt for palette AI completions.
    fn system_prompt(ctx: &PaletteSessionContext) -> String {
        let mut prompt = String::from(
            "You are an expert SSH command assistant integrated into a remote management IDE. \
             Your task is to suggest shell commands based on the user's partial input and context.\n\n\
             Rules:\n\
             - Return ONLY a valid JSON array of objects.\n\
             - Each object has: \"command\" (string), \"description\" (string), \"confidence\" (0.0-1.0), \"risk\" (\"safe\"|\"low\"|\"medium\"|\"high\"|\"critical\").\n\
             - Suggest 3-6 commands, most relevant first.\n\
             - Commands must be valid for the target shell/OS.\n\
             - Be concise in descriptions (one sentence).\n\
             - Do NOT include markdown formatting, explanations, or anything outside the JSON array.\n"
        );

        if let Some(ref shell) = ctx.shell {
            prompt.push_str(&format!("\nTarget shell: {}", shell));
        }
        if let Some(ref os) = ctx.os {
            prompt.push_str(&format!("\nTarget OS: {}", os));
        }
        if let Some(ref cwd) = ctx.cwd {
            prompt.push_str(&format!("\nCurrent directory: {}", cwd));
        }
        if let Some(ref host) = ctx.host {
            prompt.push_str(&format!("\nHost: {}", host));
        }
        if !ctx.installed_tools.is_empty() {
            prompt.push_str(&format!("\nAvailable tools: {}", ctx.installed_tools.join(", ")));
        }

        prompt
    }

    /// Build the user prompt with the query and recent history context.
    fn user_prompt(
        input: &str,
        recent_history: &[String],
        available_snippets: &[String],
    ) -> String {
        let mut prompt = format!("The user is typing in their SSH terminal and has entered: \"{}\"\n", input);

        if !recent_history.is_empty() {
            prompt.push_str("\nRecent commands in this session:\n");
            for (i, cmd) in recent_history.iter().enumerate().take(10) {
                prompt.push_str(&format!("  {}. {}\n", i + 1, cmd));
            }
        }

        if !available_snippets.is_empty() {
            prompt.push_str("\nAvailable snippet triggers (for context, not to suggest directly):\n");
            for trigger in available_snippets.iter().take(10) {
                prompt.push_str(&format!("  - {}\n", trigger));
            }
        }

        prompt.push_str("\nSuggest relevant command completions as a JSON array:");
        prompt
    }

    // ───────── LLM call ─────────

    /// Generate AI-powered suggestions for a palette query.
    ///
    /// Returns an empty Vec if the LLM is unavailable or returns garbage.
    pub async fn suggest(
        llm: &LlmServiceState,
        input: &str,
        context: &PaletteSessionContext,
        recent_history: &[String],
        available_snippets: &[String],
    ) -> Vec<AiSuggestion> {
        if input.trim().is_empty() {
            return Vec::new();
        }

        let system = ChatMessage::system(&Self::system_prompt(context));
        let user = ChatMessage::user(&Self::user_prompt(input, recent_history, available_snippets));

        let request = ChatCompletionRequest {
            model: String::new(), // Use default from provider config.
            messages: vec![system, user],
            temperature: Some(0.4),
            max_tokens: Some(1024),
            top_p: None,
            stop: None,
            stream: false,
            tools: None,
            tool_choice: None,
            response_format: None,
            seed: None,
            frequency_penalty: None,
            presence_penalty: None,
            logprobs: None,
            top_logprobs: None,
            provider_id: None,
            extra: None,
        };

        let response = {
            let mut service = llm.0.write().await;
            match service.chat_completion(request).await {
                Ok(r) => r,
                Err(e) => {
                    log::warn!("AI palette completion failed: {}", e);
                    return Vec::new();
                }
            }
        };

        // Extract text from the first choice.
        let text = match response.choices.first() {
            Some(choice) => choice.message.text_content().to_string(),
            None => return Vec::new(),
        };

        // Parse JSON array.
        Self::parse_suggestions(&text)
    }

    /// Parse the LLM response text into suggestions.
    fn parse_suggestions(text: &str) -> Vec<AiSuggestion> {
        // Try to find a JSON array in the response (the model might wrap it).
        let trimmed = text.trim();
        let json_start = trimmed.find('[');
        let json_end = trimmed.rfind(']');

        let json_str = match (json_start, json_end) {
            (Some(start), Some(end)) if end > start => &trimmed[start..=end],
            _ => {
                log::debug!("AI response did not contain a JSON array");
                return Vec::new();
            }
        };

        match serde_json::from_str::<Vec<AiSuggestion>>(json_str) {
            Ok(suggestions) => suggestions,
            Err(e) => {
                log::debug!("Failed to parse AI suggestions: {} — raw: {}", e, json_str);
                Vec::new()
            }
        }
    }

    /// Convert AI suggestions into PaletteItems.
    pub fn into_palette_items(suggestions: Vec<AiSuggestion>) -> Vec<PaletteItem> {
        suggestions.into_iter().map(|s| {
            let risk = match s.risk.as_deref() {
                Some("safe") => PaletteRiskLevel::Safe,
                Some("low") => PaletteRiskLevel::Low,
                Some("medium") => PaletteRiskLevel::Medium,
                Some("high") => PaletteRiskLevel::High,
                Some("critical") => PaletteRiskLevel::Critical,
                _ => PaletteRiskLevel::Safe,
            };

            PaletteItem {
                id: format!("ai-{}", Uuid::new_v4()),
                label: s.command.clone(),
                description: Some(s.description.clone()),
                insert_text: s.command,
                category: PaletteCategory::AiSuggestion,
                kind: PaletteItemKind::AiCompletion,
                source: PaletteSource::Ai,
                score: s.confidence,
                risk_level: risk,
                tags: Vec::new(),
                documentation: s.explanation,
                icon: Some("ai".to_string()),
                shortcut: None,
                pinned: false,
                os_target: OsTarget::default(), // AI suggestions are context-aware already.
            }
        }).collect()
    }
}
