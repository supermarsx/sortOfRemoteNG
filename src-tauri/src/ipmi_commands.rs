mod service {
    pub use crate::ipmi::service::*;
}

mod types {
    pub use crate::ipmi::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-ipmi/src/commands.rs");
}

pub(crate) use inner::*;

