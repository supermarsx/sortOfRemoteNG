mod service {
    pub use crate::idrac::service::*;
}

mod types {
    pub use crate::idrac::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../../sorng-idrac/src/commands.rs");
}

pub(crate) use inner::*;
