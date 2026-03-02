#![allow(dead_code, non_snake_case)]

pub mod error;
pub mod types;
pub mod context;
pub mod history;
pub mod suggestions;
pub mod completion;
pub mod explanation;
pub mod manpage;
pub mod natural_language;
pub mod shell_detect;
pub mod risk;
pub mod snippets;
pub mod session;
pub mod service;
pub mod commands;

pub use error::AiAssistError;
pub use types::*;
pub use service::{AiAssistService, AiAssistServiceState};
pub use commands::*;

/// Extract the text content from the first choice in a ChatCompletionResponse.
pub fn extract_response_text(response: &sorng_llm::types::ChatCompletionResponse) -> String {
    response.choices.first()
        .map(|c| match &c.message.content {
            sorng_llm::types::MessageContent::Text(s) => s.clone(),
            sorng_llm::types::MessageContent::Parts(parts) => {
                parts.iter().filter_map(|p| match p {
                    sorng_llm::types::ContentPart::Text { text } => Some(text.as_str()),
                    _ => None,
                }).collect::<Vec<_>>().join("")
            }
        })
        .unwrap_or_default()
}
