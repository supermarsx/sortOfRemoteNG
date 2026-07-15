mod raw_socket {
    pub use crate::raw_socket::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-protocols/src/raw_socket_cmds.rs");
}

// Commands are exported for the shared registry integrator.  Until that lane
// enables the Raw entries in core_handler.rs this re-export is intentionally
// unused inside the command crate itself.
#[allow(unused_imports)]
pub(crate) use inner::*;
