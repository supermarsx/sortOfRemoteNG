mod service {
    pub use crate::k8s::service::*;
}

mod types {
    pub use crate::k8s::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../../sorng-k8s/src/commands.rs");
}

pub(crate) use inner::*;
