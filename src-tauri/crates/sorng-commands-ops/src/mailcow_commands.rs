mod service {
    pub use crate::mailcow::service::*;
}

mod types {
    pub use crate::mailcow::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../../sorng-mailcow/src/commands.rs");
}

pub(crate) use inner::*;
