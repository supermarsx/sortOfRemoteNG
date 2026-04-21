mod service {
    pub use crate::lxd::service::*;
}

mod types {
    pub use crate::lxd::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-lxd/src/commands.rs");
}

pub(crate) use inner::*;
