mod service {
    pub use crate::mremoteng_dedicated::service::*;
}

mod types {
    pub use crate::mremoteng_dedicated::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../../sorng-mremoteng/src/mremoteng/commands.rs");
}

pub(crate) use inner::*;
