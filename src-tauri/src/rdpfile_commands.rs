mod error {
    pub use crate::rdpfile::error::*;
}

mod service {
    pub use crate::rdpfile::service::*;
}

mod types {
    pub use crate::rdpfile::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-rdpfile/src/commands.rs");
}

pub(crate) use inner::*;
