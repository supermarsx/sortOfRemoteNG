mod service {
    pub use crate::os_detect::service::*;
}

mod types {
    pub use crate::os_detect::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-os-detect/src/commands.rs");
}

pub(crate) use inner::*;
