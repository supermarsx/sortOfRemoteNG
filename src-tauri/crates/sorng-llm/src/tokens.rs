/// Approximate token counter for LLM requests.
///
/// Uses character-based heuristics (≈4 chars per token for English)
/// since we don't bundle tiktoken. Provides model-specific adjustments.
pub struct TokenCounter;

impl TokenCounter {
    /// Estimate token count for a string using character heuristic
    pub fn estimate(text: &str) -> u32 {
        // Average ~4 chars per token for English text
        // Adjust for code (more tokens per char) vs prose
        let char_count = text.len() as f64;
        let code_ratio = Self::code_density(text);
        let chars_per_token = 4.0 - (code_ratio * 0.8); // code ≈ 3.2 chars/tok
        (char_count / chars_per_token).ceil() as u32
    }

    /// Estimate tokens for a set of messages using OpenAI's structure overhead
    pub fn estimate_messages(messages: &[crate::types::ChatMessage]) -> u32 {
        let mut total: u32 = 3; // every reply is primed with <|start|>assistant<|message|>
        for msg in messages {
            total += 4; // role overhead + separators
            total += Self::estimate(msg.text_content());
            if msg.name.is_some() {
                total += 1; // name takes a token
            }
            if let Some(ref tool_calls) = msg.tool_calls {
                for tc in tool_calls {
                    total += 3; // function call overhead
                    total += Self::estimate(&tc.function.name);
                    total += Self::estimate(&tc.function.arguments);
                }
            }
        }
        total
    }

    /// Estimate tokens for tools/functions definitions
    pub fn estimate_tools(tools: &[crate::types::ToolDefinition]) -> u32 {
        let mut total: u32 = 0;
        for tool in tools {
            total += 8; // overhead per tool definition
            total += Self::estimate(&tool.function.name);
            total += Self::estimate(&tool.function.description);
            total += Self::estimate(&tool.function.parameters.to_string());
        }
        total
    }

    /// Check if a request fits within a model's context window
    pub fn fits_context(
        messages: &[crate::types::ChatMessage],
        tools: Option<&[crate::types::ToolDefinition]>,
        max_context: u32,
        reserved_output: u32,
    ) -> (bool, u32) {
        let msg_tokens = Self::estimate_messages(messages);
        let tool_tokens = tools.map(Self::estimate_tools).unwrap_or(0);
        let total = msg_tokens + tool_tokens;
        let available = max_context.saturating_sub(reserved_output);
        (total <= available, total)
    }

    /// Detect code density (0.0 = prose, 1.0 = pure code)
    fn code_density(text: &str) -> f64 {
        if text.is_empty() {
            return 0.0;
        }
        let code_chars: usize = text
            .chars()
            .filter(|c| {
                matches!(
                    c,
                    '{' | '}'
                        | '('
                        | ')'
                        | '['
                        | ']'
                        | ';'
                        | '='
                        | '<'
                        | '>'
                        | '/'
                        | '\\'
                        | '|'
                        | '&'
                        | '#'
                        | '$'
                )
            })
            .count();
        let ratio = code_chars as f64 / text.len() as f64;
        (ratio * 10.0).min(1.0) // scale up since code chars are sparse
    }

    /// Model-specific multiplier for better accuracy
    pub fn model_multiplier(model: &str) -> f64 {
        if model.contains("claude") {
            1.05 // Anthropic tokenizer is slightly different
        } else if model.contains("gemini") {
            0.95 // Gemini tends to use fewer tokens
        } else if model.contains("llama") || model.contains("mixtral") {
            1.1 // Open-source models vary
        } else {
            1.0
        }
    }

    /// Estimate with model-specific adjustment
    pub fn estimate_for_model(text: &str, model: &str) -> u32 {
        let base = Self::estimate(text);
        (base as f64 * Self::model_multiplier(model)).ceil() as u32
    }
}

/// Track token usage across sessions
#[derive(Debug, Default)]
pub struct TokenBudget {
    pub limit: Option<u32>,
    pub used: u32,
}

impl TokenBudget {
    pub fn new(limit: Option<u32>) -> Self {
        Self { limit, used: 0 }
    }

    pub fn consume(&mut self, tokens: u32) -> bool {
        if let Some(limit) = self.limit {
            if self.used + tokens > limit {
                return false;
            }
        }
        self.used += tokens;
        true
    }

    pub fn remaining(&self) -> Option<u32> {
        self.limit.map(|l| l.saturating_sub(self.used))
    }

    pub fn exhausted(&self) -> bool {
        self.limit.map(|l| self.used >= l).unwrap_or(false)
    }
}
