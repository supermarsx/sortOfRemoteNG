mod service {
    pub use crate::consul::service::*;
}

mod types {
    pub use crate::consul::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../../sorng-consul/src/commands.rs");
}

#[allow(unused_imports)]
pub(crate) use inner::*;
