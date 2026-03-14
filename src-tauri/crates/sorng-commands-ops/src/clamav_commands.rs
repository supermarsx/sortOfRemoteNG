mod service {
    pub use crate::clamav::service::*;
}

mod types {
    pub use crate::clamav::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../../sorng-clamav/src/commands.rs");
}

pub(crate) use inner::*;
