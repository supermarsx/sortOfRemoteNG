mod service {
    pub use crate::about::service::AboutService;
}

mod types {
    pub use crate::about::types::*;
}

#[allow(dead_code)]
mod inner;

pub(crate) use inner::*;
