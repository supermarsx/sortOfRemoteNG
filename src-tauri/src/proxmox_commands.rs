mod service {
    pub use crate::proxmox::service::*;
}

mod types {
    pub use crate::proxmox::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-proxmox/src/commands.rs");
}

pub(crate) use inner::*;
