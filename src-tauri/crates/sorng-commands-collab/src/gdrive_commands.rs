mod service {
    pub use crate::gdrive::service::*;
}

mod types {
    pub use crate::gdrive::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../../sorng-gdrive/src/commands.rs");
}

pub(crate) use inner::*;
