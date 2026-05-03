mod service {
    pub use crate::spice::service::*;
}

mod types {
    pub use crate::spice::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-spice/src/spice/commands.rs");
}

pub(crate) use inner::*;
