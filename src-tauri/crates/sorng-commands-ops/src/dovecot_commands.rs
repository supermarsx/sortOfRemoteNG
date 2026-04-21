mod service {
    pub use crate::dovecot::service::*;
}

mod types {
    pub use crate::dovecot::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../../sorng-dovecot/src/commands.rs");
}

pub(crate) use inner::*;
