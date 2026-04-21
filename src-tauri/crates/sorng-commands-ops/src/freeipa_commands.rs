mod service {
    pub use crate::freeipa::service::*;
}

mod types {
    pub use crate::freeipa::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../../sorng-freeipa/src/commands.rs");
}

pub(crate) use inner::*;
