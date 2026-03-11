mod service {
    pub use crate::cups::service::*;
}

mod types {
    pub use crate::cups::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-cups/src/commands.rs");
}

