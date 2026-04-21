mod service {
    pub use crate::postfix::service::*;
}

mod types {
    pub use crate::postfix::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-postfix/src/commands.rs");
}

pub(crate) use inner::*;
