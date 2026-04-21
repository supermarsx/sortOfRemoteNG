mod service {
    pub use crate::amavis::service::*;
}

mod types {
    pub use crate::amavis::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-amavis/src/commands.rs");
}

pub(crate) use inner::*;
