// ── Code Assistance Module ───────────────────────────────────────────────────
//
// AI-powered code generation, review, refactoring, explanation, bug detection,
// documentation generation, and more — leveraging the LLM providers.

use std::collections::HashMap;
use chrono::Utc;
use uuid::Uuid;

use super::types::*;
use super::providers::LlmProvider;

// ── Code Assist Runner ───────────────────────────────────────────────────────

/// Processes a code assistance request via an LLM provider.
pub async fn run_code_assist(
    request: &CodeAssistRequest,
    provider: &dyn LlmProvider,
) -> Result<CodeAssistResult, String> {
    let start = std::time::Instant::now();

    let system_prompt = build_system_prompt(&request.action);
    let user_prompt = build_user_prompt(request);

    let params = InferenceParams {
        temperature: match &request.action {
            CodeAssistAction::Generate | CodeAssistAction::Complete => 0.3,
            CodeAssistAction::Review | CodeAssistAction::FindBugs => 0.1,
            _ => 0.2,
        },
        max_tokens: request.params.max_tokens,
        ..Default::default()
    };

    let messages = vec![
        ChatMessage {
            id: "code-system".into(), role: MessageRole::System,
            content: vec![ContentBlock::Text { text: system_prompt }],
            tool_call_id: None, tool_calls: Vec::new(), name: None,
            created_at: Utc::now(), token_count: None, metadata: HashMap::new(),
        },
        ChatMessage {
            id: "code-user".into(), role: MessageRole::User,
            content: vec![ContentBlock::Text { text: user_prompt }],
            tool_call_id: None, tool_calls: Vec::new(), name: None,
            created_at: Utc::now(), token_count: None, metadata: HashMap::new(),
        },
    ];

    let response = provider.chat_completion(&messages, &request.model, &params, &[]).await?;
    let output = response.message.content.iter()
        .filter_map(|b| match b { ContentBlock::Text { text } => Some(text.clone()), _ => None })
        .collect::<Vec<_>>().join("");

    let suggestions = parse_suggestions(&output, &request.action);

    Ok(CodeAssistResult {
        id: Uuid::new_v4().to_string(),
        action: request.action.clone(),
        result: output,
        language: request.language.clone(),
        suggestions,
        usage: response.usage,
        latency_ms: start.elapsed().as_millis() as u64,
    })
}

// ── System Prompts ───────────────────────────────────────────────────────────

fn build_system_prompt(action: &CodeAssistAction) -> String {
    match action {
        CodeAssistAction::Generate =>
            "You are an expert programmer. Generate clean, well-documented code based on the user's requirements. \
            Include comments explaining key design decisions. Follow best practices and idiomatic patterns for the language.".into(),
        CodeAssistAction::Complete =>
            "You are a code completion engine. Complete the partial code naturally and correctly. \
            Match the existing style, indentation, and naming conventions.".into(),
        CodeAssistAction::Review =>
            "You are a senior code reviewer. Analyse the code for:\n\
            - Correctness and potential bugs\n\
            - Performance issues\n\
            - Security vulnerabilities\n\
            - Code style and readability\n\
            - Best practice violations\n\
            Provide actionable feedback with severity levels (critical, warning, info).".into(),
        CodeAssistAction::Refactor =>
            "You are a refactoring expert. Improve the code's structure, readability, and maintainability \
            while preserving its behaviour. Explain each refactoring step.".into(),
        CodeAssistAction::Explain =>
            "You are a code educator. Explain what the code does clearly and concisely. \
            Cover the purpose, key logic, control flow, and any notable patterns or techniques.".into(),
        CodeAssistAction::FindBugs =>
            "You are a bug detection specialist. Analyse the code for:\n\
            - Logic errors\n\
            - Off-by-one errors\n\
            - Null/undefined handling\n\
            - Race conditions\n\
            - Resource leaks\n\
            - Edge cases\n\
            Rate each finding as critical, warning, or info.".into(),
        CodeAssistAction::Optimize =>
            "You are a performance optimization expert. Analyse the code and suggest optimizations for:\n\
            - Time complexity\n\
            - Space complexity\n\
            - I/O efficiency\n\
            - Caching opportunities\n\
            Provide before/after comparisons where possible.".into(),
        CodeAssistAction::Document =>
            "You are a documentation expert. Generate comprehensive documentation for the code including:\n\
            - Module/class doc comments\n\
            - Function/method signatures with parameter descriptions\n\
            - Return value descriptions\n\
            - Usage examples\n\
            Follow the documentation conventions of the language.".into(),
        CodeAssistAction::WriteTests =>
            "You are a test engineering expert. Generate comprehensive test cases for the code including:\n\
            - Happy path tests\n\
            - Edge cases\n\
            - Error handling\n\
            - Boundary conditions\n\
            Use the appropriate testing framework for the language.".into(),
        CodeAssistAction::ConvertLanguage =>
            "You are a code translation expert. Convert the code to the target language while:\n\
            - Preserving the same logic and behaviour\n\
            - Using idiomatic patterns of the target language\n\
            - Mapping equivalent libraries/APIs\n\
            - Maintaining readability".into(),
        CodeAssistAction::FixError =>
            "You are a debugging expert. Analyse the error in context of the code and provide a fix. \
            Explain the root cause and how the fix addresses it.".into(),
    }
}

fn build_user_prompt(request: &CodeAssistRequest) -> String {
    let mut prompt = String::new();

    if let Some(ref lang) = request.language {
        prompt.push_str(&format!("Language: {}\n", lang));
    }

    if let Some(ref instructions) = request.instructions {
        prompt.push_str(&format!("\n## Instructions\n{}\n", instructions));
    }

    if !request.code.is_empty() {
        let lang_hint = request.language.as_deref().unwrap_or("");
        prompt.push_str(&format!("\n## Code\n```{}\n{}\n```\n", lang_hint, request.code));
    }

    // Include additional context files
    for ctx in &request.context {
        prompt.push_str(&format!("\n## Context: {}\n```{}\n{}\n```\n",
            ctx.filename,
            ctx.language.as_deref().unwrap_or(""),
            ctx.content
        ));
    }

    prompt
}

// ── Suggestion Parsing ───────────────────────────────────────────────────────

fn parse_suggestions(output: &str, action: &CodeAssistAction) -> Vec<CodeSuggestion> {
    let mut suggestions = Vec::new();

    match action {
        CodeAssistAction::Review | CodeAssistAction::FindBugs => {
            for line in output.lines() {
                let trimmed = line.trim();
                if trimmed.is_empty() { continue; }

                let severity = if trimmed.to_lowercase().contains("critical") {
                    SuggestionSeverity::Critical
                } else if trimmed.to_lowercase().contains("error") {
                    SuggestionSeverity::Error
                } else if trimmed.to_lowercase().contains("warning") || trimmed.to_lowercase().contains("warn") {
                    SuggestionSeverity::Warning
                } else if trimmed.starts_with('-') || trimmed.starts_with('*') || trimmed.starts_with("•") {
                    SuggestionSeverity::Info
                } else {
                    continue;
                };

                suggestions.push(CodeSuggestion {
                    description: trimmed.trim_start_matches(|c: char| c == '-' || c == '*' || c == '•').trim().to_string(),
                    severity,
                    start_line: None,
                    end_line: None,
                    original: None,
                    replacement: None,
                });
            }
        }
        _ => {
            if !output.is_empty() {
                suggestions.push(CodeSuggestion {
                    description: "Code assistance result available".into(),
                    severity: SuggestionSeverity::Info,
                    start_line: None,
                    end_line: None,
                    original: None,
                    replacement: Some(output.to_string()),
                });
            }
        }
    }

    suggestions
}

// ── Convenience Functions ────────────────────────────────────────────────────

/// Quick code generation.
pub async fn generate_code(
    provider: &dyn LlmProvider, provider_id: &str, model: &str,
    instructions: &str, language: &str,
) -> Result<CodeAssistResult, String> {
    run_code_assist(&CodeAssistRequest {
        provider_id: provider_id.to_string(),
        model: model.to_string(),
        action: CodeAssistAction::Generate,
        code: String::new(),
        language: Some(language.to_string()),
        instructions: Some(instructions.to_string()),
        context: Vec::new(),
        params: InferenceParams::default(),
    }, provider).await
}

/// Quick code review.
pub async fn review_code(
    provider: &dyn LlmProvider, provider_id: &str, model: &str,
    code: &str, language: &str,
) -> Result<CodeAssistResult, String> {
    run_code_assist(&CodeAssistRequest {
        provider_id: provider_id.to_string(),
        model: model.to_string(),
        action: CodeAssistAction::Review,
        code: code.to_string(),
        language: Some(language.to_string()),
        instructions: Some("Review this code for issues, bugs, and improvements.".into()),
        context: Vec::new(),
        params: InferenceParams::default(),
    }, provider).await
}

/// Quick code explanation.
pub async fn explain_code(
    provider: &dyn LlmProvider, provider_id: &str, model: &str,
    code: &str, language: &str,
) -> Result<CodeAssistResult, String> {
    run_code_assist(&CodeAssistRequest {
        provider_id: provider_id.to_string(),
        model: model.to_string(),
        action: CodeAssistAction::Explain,
        code: code.to_string(),
        language: Some(language.to_string()),
        instructions: Some("Explain what this code does.".into()),
        context: Vec::new(),
        params: InferenceParams::default(),
    }, provider).await
}

/// Quick test generation.
pub async fn generate_tests(
    provider: &dyn LlmProvider, provider_id: &str, model: &str,
    code: &str, language: &str,
) -> Result<CodeAssistResult, String> {
    run_code_assist(&CodeAssistRequest {
        provider_id: provider_id.to_string(),
        model: model.to_string(),
        action: CodeAssistAction::WriteTests,
        code: code.to_string(),
        language: Some(language.to_string()),
        instructions: Some("Generate comprehensive tests for this code.".into()),
        context: Vec::new(),
        params: InferenceParams::default(),
    }, provider).await
}
