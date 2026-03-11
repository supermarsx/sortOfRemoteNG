mod service {
    pub use crate::terraform::service::*;
}

mod types {
    pub use crate::terraform::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-terraform/src/commands.rs");
}

pub(crate) use inner::*;
