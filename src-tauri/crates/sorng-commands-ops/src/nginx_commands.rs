mod service {
    pub use crate::nginx::service::*;
}

mod types {
    pub use crate::nginx::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../../sorng-nginx/src/commands.rs");
}

pub(crate) use inner::*;
