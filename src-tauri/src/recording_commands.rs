mod service {
    pub use crate::recording::service::*;
}

mod types {
    pub use crate::recording::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-recording/src/commands.rs");
}

pub(crate) use inner::*;
