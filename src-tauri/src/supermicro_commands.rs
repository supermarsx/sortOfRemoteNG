mod service {
    pub use crate::supermicro::service::*;
}

mod types {
    pub use crate::supermicro::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-supermicro/src/commands.rs");
}

pub(crate) use inner::*;
