mod service {
    pub use crate::pfsense::service::*;
}

mod types {
    pub use crate::pfsense::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../../sorng-pfsense/src/commands.rs");
}

pub(crate) use inner::*;
