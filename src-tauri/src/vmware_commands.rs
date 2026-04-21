mod metrics {
    pub use crate::vmware::metrics::*;
}

mod service {
    pub use crate::vmware::service::*;
}

mod types {
    pub use crate::vmware::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-vmware/src/commands.rs");
}

pub(crate) use inner::*;
