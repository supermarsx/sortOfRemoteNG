mod service {
    pub use crate::ilo::service::*;
}

mod types {
    pub use crate::ilo::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-ilo/src/commands.rs");
}

pub(crate) use inner::*;
