mod service {
    pub use crate::synology::service::*;
}

mod types {
    pub use crate::synology::types::*;
}

#[allow(dead_code)]
mod inner;

pub(crate) use inner::*;
