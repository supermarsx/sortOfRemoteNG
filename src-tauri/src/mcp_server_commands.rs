mod logging {
    pub use crate::mcp_server::logging::*;
}

mod service {
    pub use crate::mcp_server::service::*;
}

mod types {
    pub use crate::mcp_server::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-mcp/src/commands.rs");
}

pub(crate) use inner::*;
