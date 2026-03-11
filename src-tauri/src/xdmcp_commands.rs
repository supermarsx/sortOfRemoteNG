mod service {
    pub use crate::xdmcp::service::*;
}

mod types {
    pub use crate::xdmcp::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-xdmcp/src/xdmcp/commands.rs");
}

