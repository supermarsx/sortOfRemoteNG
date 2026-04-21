mod service {
    pub use crate::vnc::service::*;
}

mod types {
    pub use crate::vnc::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-vnc/src/vnc/commands.rs");
}

pub(crate) use inner::*;
