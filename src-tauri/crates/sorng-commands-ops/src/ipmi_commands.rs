mod service {
    pub use crate::ipmi::service::*;
}

mod types {
    pub use crate::ipmi::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../../sorng-ipmi/src/commands.rs");
}

