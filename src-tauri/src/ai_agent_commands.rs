mod types {
    pub use crate::ai_agent::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-ai-agent/src/ai_agent/commands.rs");
}

pub(crate) use inner::*;
