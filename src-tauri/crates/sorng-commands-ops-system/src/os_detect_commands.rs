mod service {
    pub use crate::os_detect::service::*;
}

mod types {
    pub use crate::os_detect::types::*;
}

#[allow(dead_code)]
mod inner;

pub(crate) use inner::*;
