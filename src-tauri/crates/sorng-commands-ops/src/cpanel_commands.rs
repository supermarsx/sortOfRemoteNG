mod service {
    pub use crate::cpanel::service::*;
}

mod types {
    pub use crate::cpanel::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../../sorng-cpanel/src/commands.rs");
}

pub(crate) use inner::*;
