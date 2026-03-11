mod service {
    pub use crate::procmail::service::*;
}

mod types {
    pub use crate::procmail::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-procmail/src/commands.rs");
}

pub(crate) use inner::*;
