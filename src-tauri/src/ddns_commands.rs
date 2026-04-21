mod types {
    pub use crate::ddns::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-ddns/src/commands.rs");
}

pub(crate) use inner::*;
