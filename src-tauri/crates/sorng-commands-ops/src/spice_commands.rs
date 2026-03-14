mod service {
    pub use crate::spice::service::*;
}

mod types {
    pub use crate::spice::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../../sorng-spice/src/spice/commands.rs");
}

