mod error {
    pub use crate::dashboard::error::*;
}

mod service {
    pub use crate::dashboard::service::*;
}

mod types {
    pub use crate::dashboard::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../../sorng-dashboard/src/commands.rs");
}

pub(crate) use inner::*;
