mod service {
    pub use crate::about::service::AboutService;
}

mod types {
    pub use crate::about::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-about/src/commands.rs");
}

pub(crate) use inner::*;
