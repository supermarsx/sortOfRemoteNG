mod service {
    pub use crate::fonts::service::*;
}

mod types {
    pub use crate::fonts::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-fonts/src/commands.rs");
}

pub(crate) use inner::*;
