mod service {
    pub use crate::hetzner::service::*;
}

mod types {
    pub use crate::hetzner::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../../sorng-hetzner/src/commands.rs");
}

pub(crate) use inner::*;
