mod service {
    pub use crate::hyperv::service::*;
}

mod types {
    pub use crate::hyperv::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../../sorng-hyperv/src/commands.rs");
}

pub(crate) use inner::*;
