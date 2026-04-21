mod service {
    pub use crate::opendkim::service::*;
}

mod types {
    pub use crate::opendkim::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-opendkim/src/commands.rs");
}

pub(crate) use inner::*;
