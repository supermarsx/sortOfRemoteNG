mod service {
    pub use crate::meshcentral_dedicated::service::*;
}

mod types {
    pub use crate::meshcentral_dedicated::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-meshcentral/src/meshcentral/commands.rs");
}

pub(crate) use inner::*;
