mod error {
    pub use crate::ceph::error::*;
}

mod service {
    pub use crate::ceph::service::*;
}

mod types {
    pub use crate::ceph::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../../sorng-ceph/src/commands.rs");
}

