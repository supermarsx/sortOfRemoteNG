mod service {
    pub use crate::opendkim::service::*;
}

mod types {
    pub use crate::opendkim::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../../sorng-opendkim/src/commands.rs");
}

pub(crate) use inner::*;
