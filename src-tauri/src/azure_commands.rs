mod service {
    pub use crate::azure::service::*;
}

mod types {
    pub use crate::azure::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-azure/src/commands.rs");
}

pub(crate) use inner::*;
