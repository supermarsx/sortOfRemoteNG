mod authenticate {
    pub use crate::biometrics::authenticate::{verify, verify_and_derive_key};
}

mod availability {
    pub use crate::biometrics::availability::{check, is_available};
}

mod types {
    pub use crate::biometrics::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-biometrics/src/commands.rs");
}

pub(crate) use inner::*;
