mod service {
    pub use crate::spamassassin::service::*;
}

mod types {
    pub use crate::spamassassin::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-spamassassin/src/commands.rs");
}

pub(crate) use inner::*;
