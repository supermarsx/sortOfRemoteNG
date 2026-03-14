mod service {
    pub use crate::roundcube::service::*;
}

mod types {
    pub use crate::roundcube::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../../sorng-roundcube/src/commands.rs");
}

pub(crate) use inner::*;
