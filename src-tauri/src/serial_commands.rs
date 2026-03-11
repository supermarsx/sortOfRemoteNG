mod modem {
    pub use crate::serial::modem::*;
}
mod port_scanner {
    pub use crate::serial::port_scanner::*;
}
mod service {
    pub use crate::serial::service::*;
}
mod types {
    pub use crate::serial::types::*;
}
mod transport {
    pub use crate::serial::transport::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-serial/src/serial/commands.rs");
}
pub(crate) use inner::*;
