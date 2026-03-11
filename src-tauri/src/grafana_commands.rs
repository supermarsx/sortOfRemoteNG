mod service {
    pub use crate::grafana::service::*;
}

mod types {
    pub use crate::grafana::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-grafana/src/commands.rs");
}

pub(crate) use inner::*;
