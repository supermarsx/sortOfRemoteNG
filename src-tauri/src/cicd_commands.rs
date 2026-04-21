mod service {
    pub use crate::cicd::service::*;
}

mod types {
    pub use crate::cicd::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-cicd/src/commands.rs");
}

pub(crate) use inner::*;
