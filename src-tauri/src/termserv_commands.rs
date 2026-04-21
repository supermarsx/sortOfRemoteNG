mod service {
    pub use crate::termserv::service::*;
}

mod types {
    pub use crate::termserv::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-termserv/src/commands.rs");
}

pub(crate) use inner::*;
