mod types {
    pub use crate::gpg_agent::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-gpg-agent/src/commands.rs");
}

pub(crate) use inner::*;
