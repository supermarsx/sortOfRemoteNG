mod service {
    pub use crate::prometheus::service::*;
}

mod types {
    pub use crate::prometheus::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-prometheus/src/commands.rs");
}

pub(crate) use inner::*;
