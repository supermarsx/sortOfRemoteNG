mod service {
    pub use crate::haproxy::service::*;
}

mod types {
    pub use crate::haproxy::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-haproxy/src/commands.rs");
}

pub(crate) use inner::*;
