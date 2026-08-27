mod service {
    pub use crate::portainer::service::*;
}

mod types {
    pub use crate::portainer::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../../sorng-portainer/src/commands.rs");
}

pub(crate) use inner::*;
