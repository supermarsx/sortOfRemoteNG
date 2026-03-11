mod service {
    pub use crate::vmware_desktop::service::*;
}

mod types {
    pub use crate::vmware_desktop::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-vmware-desktop/src/commands.rs");
}

pub(crate) use inner::*;
