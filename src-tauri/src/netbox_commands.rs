mod service {
    pub use crate::netbox::service::*;
}

mod types {
    pub use crate::netbox::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-netbox/src/commands.rs");
}

pub(crate) use inner::*;
