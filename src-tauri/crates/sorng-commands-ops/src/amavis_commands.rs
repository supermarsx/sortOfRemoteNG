mod service {
    pub use crate::amavis::service::*;
}

mod types {
    pub use crate::amavis::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../../sorng-amavis/src/commands.rs");
}

pub(crate) use inner::*;
