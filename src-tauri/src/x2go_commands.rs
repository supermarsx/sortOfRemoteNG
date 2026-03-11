mod service {
    pub use crate::x2go::service::*;
}

mod types {
    pub use crate::x2go::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-x2go/src/x2go/commands.rs");
}

