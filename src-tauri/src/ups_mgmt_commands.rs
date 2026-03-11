mod service {
    pub use crate::ups_mgmt::service::*;
}

mod types {
    pub use crate::ups_mgmt::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-ups/src/commands.rs");
}

pub(crate) use inner::*;
